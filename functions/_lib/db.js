import { SEED_TREATMENTS } from './seed.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS treatments (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    efectivo REAL NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export const DEFAULT_SETTINGS = {
  desc_efectivo: '20',
  desc_transferencia: '10',
  recargo_3_cuotas: '0',
  recargo_6_cuotas: '10',
  recargo_12_cuotas: '20',
  validez_dias: '30',
  // Qué partes se ven en el presupuesto (1 = se ve, 0 = oculto).
  ver_codigo: '1',
  ver_nota_lista: '1',
  ver_lista: '1',
  ver_cuotas_3: '1',
  ver_efectivo: '1',
  ver_transf: '1',
  ver_6: '1',
  ver_cuotas_6: '1',
  ver_12: '0',
  ver_cuotas_12: '1',
  ver_total: '1',
  ver_recuadro_efectivo: '1',
  ver_recuadro_transf: '1',
  ver_validez: '1',
};

let ready = false;

// Crea las tablas la primera vez y carga la lista de precios inicial,
// así no hace falta correr SQL a mano en Cloudflare.
export async function ensureDb(db) {
  if (ready) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  const seeded = await db.prepare(`SELECT value FROM settings WHERE key = 'seeded'`).first();
  if (!seeded) {
    const stmts = Object.entries(DEFAULT_SETTINGS).map(([k, v]) =>
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(k, v)
    );
    for (const [code, name, efectivo, category, sort] of SEED_TREATMENTS) {
      stmts.push(
        db.prepare('INSERT OR IGNORE INTO treatments (code, name, efectivo, category, sort) VALUES (?, ?, ?, ?, ?)')
          .bind(code, name, efectivo, category, sort)
      );
    }
    stmts.push(db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded', '1')`));
    await db.batch(stmts);
  }
  ready = true;
}
