import { ensureDb, DEFAULT_SETTINGS } from '../_lib/db.js';
import { hashPassword, verifyPassword, createSession, currentUser, readCookie, sessionCookie } from '../_lib/auth.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const fail = (status, error) => json({ error }, status);

const PERCENT_KEYS = ['desc_efectivo', 'desc_transferencia', 'recargo_3_cuotas', 'recargo_6_cuotas'];

function cleanTreatment(t) {
  const code = String(t.code ?? '').trim();
  const name = String(t.name ?? '').trim();
  const efectivo = Number(String(t.efectivo ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!code) return { error: 'Falta el código' };
  if (!name) return { error: `Falta el nombre del tratamiento (código ${code})` };
  if (!Number.isFinite(efectivo) || efectivo <= 0) return { error: `Precio en efectivo inválido (código ${code})` };
  return { code, name, efectivo, category: String(t.category ?? '').trim() };
}

function cleanCredentials(body) {
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!/^[\w.@-]{3,40}$/.test(username)) return { error: 'El usuario debe tener entre 3 y 40 letras, números o . _ - @' };
  if (password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres' };
  return { username, password };
}

async function readSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) if (r.key in s) s[r.key] = r.value;
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
}

export async function onRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return fail(500, 'Falta conectar la base de datos D1 con el nombre DB en Cloudflare.');
  await ensureDb(db);

  const method = request.method;
  const path = (params.path || []).join('/');
  const body = ['POST', 'PUT'].includes(method) ? await request.json().catch(() => ({})) : {};
  const secure = new URL(request.url).protocol === 'https:';
  const userCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n;

  // --- Rutas públicas ---
  if (path === 'status' && method === 'GET') {
    return json({ needsSetup: (await userCount()) === 0, user: await currentUser(db, request) });
  }

  if (path === 'setup' && method === 'POST') {
    if ((await userCount()) > 0) return fail(403, 'Ya existe un administrador.');
    const c = cleanCredentials(body);
    if (c.error) return fail(400, c.error);
    const r = await db.prepare(`INSERT INTO users (username, pass_hash, role) VALUES (?, ?, 'admin')`)
      .bind(c.username, await hashPassword(c.password)).run();
    const s = await createSession(db, r.meta.last_row_id);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(s.token, s.maxAge, secure) });
  }

  if (path === 'login' && method === 'POST') {
    const u = await db.prepare('SELECT id, pass_hash FROM users WHERE username = ?').bind(String(body.username ?? '').trim()).first();
    if (!u || !(await verifyPassword(String(body.password ?? ''), u.pass_hash))) return fail(401, 'Usuario o contraseña incorrectos.');
    const s = await createSession(db, u.id);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(s.token, s.maxAge, secure) });
  }

  if (path === 'logout' && method === 'POST') {
    const token = readCookie(request);
    if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, secure) });
  }

  // --- Usuarios con sesión ---
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Tenés que iniciar sesión.');

  if (path === 'data' && method === 'GET') {
    const { results } = await db.prepare('SELECT code, name, efectivo, category FROM treatments ORDER BY sort, code').all();
    return json({ user, settings: await readSettings(db), treatments: results });
  }

  if (path === 'password' && method === 'POST') {
    const u = await db.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(user.id).first();
    if (!(await verifyPassword(String(body.current ?? ''), u.pass_hash))) return fail(400, 'La contraseña actual no es correcta.');
    const c = cleanCredentials({ username: user.username, password: body.password });
    if (c.error) return fail(400, c.error);
    await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(c.password), user.id).run();
    return json({ ok: true });
  }

  // --- Solo administrador ---
  if (user.role !== 'admin') return fail(403, 'Solo un administrador puede hacer esto.');

  if (path === 'settings' && method === 'PUT') {
    const stmts = [];
    for (const key of [...PERCENT_KEYS, 'validez_dias']) {
      if (!(key in body)) continue;
      const v = Number(body[key]);
      const max = key === 'desc_efectivo' ? 99 : key === 'validez_dias' ? 365 : 100;
      if (!Number.isFinite(v) || v < 0 || v > max) return fail(400, `Valor inválido para ${key}`);
      stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(v)));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ settings: await readSettings(db) });
  }

  if (path === 'treatments' && method === 'POST') {
    const t = cleanTreatment(body);
    if (t.error) return fail(400, t.error);
    const original = String(body.originalCode ?? t.code).trim();
    const existing = await db.prepare('SELECT sort FROM treatments WHERE code = ?').bind(original).first();
    if (original !== t.code && (await db.prepare('SELECT 1 FROM treatments WHERE code = ?').bind(t.code).first())) {
      return fail(400, `Ya existe un tratamiento con el código ${t.code}.`);
    }
    const sort = existing ? existing.sort : ((await db.prepare('SELECT MAX(sort) AS m FROM treatments').first()).m || 0) + 1;
    await db.batch([
      db.prepare('DELETE FROM treatments WHERE code = ?').bind(original),
      db.prepare('INSERT OR REPLACE INTO treatments (code, name, efectivo, category, sort) VALUES (?, ?, ?, ?, ?)')
        .bind(t.code, t.name, t.efectivo, t.category, sort),
    ]);
    return json({ ok: true });
  }

  if (path.startsWith('treatments/') && method === 'DELETE') {
    await db.prepare('DELETE FROM treatments WHERE code = ?').bind(decodeURIComponent(path.slice(11))).run();
    return json({ ok: true });
  }

  if (path === 'treatments/import' && method === 'POST') {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return fail(400, 'El archivo no tiene tratamientos.');
    const clean = [];
    const seen = new Set();
    for (const [i, r] of rows.entries()) {
      const t = cleanTreatment(r);
      if (t.error) return fail(400, `Fila ${i + 2}: ${t.error}`);
      if (seen.has(t.code)) return fail(400, `Fila ${i + 2}: el código ${t.code} está repetido.`);
      seen.add(t.code);
      clean.push(t);
    }
    const stmts = body.replace ? [db.prepare('DELETE FROM treatments')] : [];
    const base = body.replace ? 0 : ((await db.prepare('SELECT MAX(sort) AS m FROM treatments').first()).m || 0);
    clean.forEach((t, i) =>
      stmts.push(
        db.prepare(
          `INSERT INTO treatments (code, name, efectivo, category, sort) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET name = excluded.name, efectivo = excluded.efectivo, category = excluded.category`
        ).bind(t.code, t.name, t.efectivo, t.category, base + i + 1)
      )
    );
    await db.batch(stmts);
    return json({ ok: true, count: clean.length });
  }

  if (path === 'users' && method === 'GET') {
    const { results } = await db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
    return json({ users: results });
  }

  if (path === 'users' && method === 'POST') {
    const c = cleanCredentials(body);
    if (c.error) return fail(400, c.error);
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (await db.prepare('SELECT 1 FROM users WHERE username = ?').bind(c.username).first()) return fail(400, 'Ese usuario ya existe.');
    await db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)').bind(c.username, await hashPassword(c.password), role).run();
    return json({ ok: true });
  }

  const userMatch = path.match(/^users\/(\d+)$/);
  if (userMatch) {
    const id = Number(userMatch[1]);
    const target = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(id).first();
    if (!target) return fail(404, 'Usuario no encontrado.');
    const admins = (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).first()).n;

    if (method === 'DELETE') {
      if (id === user.id) return fail(400, 'No podés borrar tu propio usuario.');
      if (target.role === 'admin' && admins <= 1) return fail(400, 'Tiene que quedar al menos un administrador.');
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }

    if (method === 'PUT') {
      const stmts = [];
      if (body.role) {
        const role = body.role === 'admin' ? 'admin' : 'user';
        if (target.role === 'admin' && role === 'user' && admins <= 1) return fail(400, 'Tiene que quedar al menos un administrador.');
        stmts.push(db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id));
      }
      if (body.password) {
        const c = cleanCredentials({ username: target.username, password: body.password });
        if (c.error) return fail(400, c.error);
        stmts.push(db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(c.password), id));
        stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').bind(id, user.id));
      }
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true });
    }
  }

  return fail(404, 'No encontrado.');
}
