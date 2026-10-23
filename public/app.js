const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
const pct = (n) => `${Number(n).toLocaleString('es-AR')}%`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const DEFAULT_ROWS = 5;
const DRAFT_KEY = 'sp_presupuesto_borrador';

const state = { user: null, settings: null, treatments: [], byCode: new Map() };

async function api(path, options = {}) {
  const res = await fetch('/api/' + path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !['login', 'setup', 'password'].includes(path)) {
    showLogin(false);
    throw new Error(data.error || 'Sesión vencida');
  }
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

// ---------- Precios ----------
// Mismas fórmulas que la planilla: la lista sale del precio en efectivo.
function prices(efectivo) {
  const s = state.settings;
  const lista = efectivo / (1 - s.desc_efectivo / 100);
  return {
    efectivo,
    lista: lista * (1 + s.recargo_3_cuotas / 100),
    transf: lista * (1 - s.desc_transferencia / 100),
    seis: lista * (1 + s.recargo_6_cuotas / 100),
  };
}

function findTreatment(raw) {
  const code = String(raw ?? '').trim();
  if (!code) return null;
  if (state.byCode.has(code)) return state.byCode.get(code);
  // Como en la planilla: "2" busca "002".
  if (/^\d+$/.test(code)) return state.byCode.get(code.padStart(3, '0')) || null;
  return state.byCode.get(code.toUpperCase()) || null;
}

// ---------- Ingreso ----------
let setupMode = false;

function showLogin(needsSetup) {
  setupMode = needsSetup;
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  $('#login-title').textContent = needsSetup ? 'Crear administrador' : 'Ingresar';
  $('#login-help').textContent = needsSetup
    ? 'Es la primera vez que se usa la aplicación. Elegí el usuario y la contraseña del administrador.'
    : '';
  $('#login-submit').textContent = needsSetup ? 'Crear y entrar' : 'Ingresar';
  $('#login-form [name=password]').autocomplete = needsSetup ? 'new-password' : 'current-password';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    await api(setupMode ? 'setup' : 'login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    e.target.reset();
    await loadApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  showLogin(false);
});

async function start() {
  try {
    const st = await fetch('/api/status').then((r) => r.json());
    if (st.error) throw new Error(st.error);
    if (st.user) await loadApp();
    else showLogin(st.needsSetup);
  } catch (err) {
    document.body.innerHTML = `<p style="padding:16px">No se pudo conectar con el servidor: ${esc(err.message)}</p>`;
  }
}

async function loadApp() {
  const data = await api('data');
  state.user = data.user;
  state.settings = data.settings;
  setTreatments(data.treatments);
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#who-name').textContent = state.user.username;
  $('#who-role').textContent = state.user.role === 'admin' ? 'Administrador' : 'Usuario';
  $$('.admin-only').forEach((el) => (el.hidden = state.user.role !== 'admin'));
  showView('budget');
  renderLabels();
  restoreDraft();
  renderSearch();
}

function setTreatments(list) {
  state.treatments = list;
  state.byCode = new Map(list.map((t) => [t.code, t]));
  state.byCode.forEach((t, k) => state.byCode.set(k.toUpperCase(), t));
}

// ---------- Navegación ----------
function showView(view) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['budget', 'admin', 'account'].forEach((v) => ($('#panel-' + v).hidden = v !== view));
  if (view === 'admin') {
    renderAdminTreatments();
    fillSettingsForm();
    loadUsers();
  }
}
$$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$$('.subtab').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.subtab').forEach((x) => x.classList.toggle('active', x === b));
    ['treatments', 'settings', 'users'].forEach((s) => ($('#sub-' + s).hidden = s !== b.dataset.sub));
  })
);

// ---------- Presupuesto ----------
function renderLabels() {
  const s = state.settings;
  const r3 = s.recargo_3_cuotas ? `recargo ${pct(s.recargo_3_cuotas)}` : 'sin interés';
  $('#h-lista').innerHTML = `PRECIO DE LISTA<small>hasta 3 cuotas ${r3}</small>`;
  $('#h-efectivo').innerHTML = `EFECTIVO<small>${pct(s.desc_efectivo)} de descuento</small>`;
  $('#h-transf').innerHTML = `TRANSFERENCIA / DÉBITO / QR<small>${pct(s.desc_transferencia)} de descuento</small>`;
  $('#h-6').innerHTML = `6 CUOTAS<small>recargo ${pct(s.recargo_6_cuotas)} (valor total)</small>`;
  $('#lista-note').innerHTML = `PRECIO DE LISTA: HASTA 3 CUOTAS ${r3.toUpperCase()}<br>con cualquier tarjeta de crédito`;
  $('#badge-efectivo').textContent = `${pct(s.desc_efectivo)} DE DESCUENTO\nEN EFECTIVO`;
  $('#badge-transf').textContent = `${pct(s.desc_transferencia)} DE DESCUENTO\nTRANSFERENCIA / QR / DÉBITO`;
  $('#validity').textContent = `El presupuesto tiene una validez de ${s.validez_dias} días a partir de su fecha de emisión. Superada la vigencia, consultar si hubo modificaciones.`;
  $('#s-lista').textContent = 'Lista / 3 cuotas';
  $('#s-ef').textContent = `Efectivo -${pct(s.desc_efectivo)}`;
  $('#s-tr').textContent = `Transf. / Déb. -${pct(s.desc_transferencia)}`;
  $('#s-6').textContent = `6 cuotas +${pct(s.recargo_6_cuotas)}`;
}

function addRow(code = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="c-code"><input class="code-input" value="${esc(code)}" aria-label="Código"></td>
    <td class="c-name"></td>
    <td class="money" data-k="lista"></td>
    <td class="money" data-k="efectivo"></td>
    <td class="money" data-k="transf"></td>
    <td class="money" data-k="seis"></td>
    <td class="no-print c-x"><button class="btn link small" title="Quitar fila" aria-label="Quitar fila">✕</button></td>`;
  const input = tr.querySelector('input');
  input.addEventListener('input', () => { updateRow(tr); saveDraft(); });
  input.addEventListener('change', () => {
    const t = findTreatment(input.value);
    if (t && t.code !== input.value.trim()) { input.value = t.code; saveDraft(); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const next = tr.nextElementSibling?.querySelector('input');
      next ? next.focus() : addRow().querySelector('input').focus();
    }
  });
  tr.querySelector('button').addEventListener('click', () => {
    if ($('#rows').children.length > 1) tr.remove();
    else input.value = '';
    updateRow(tr);
    saveDraft();
  });
  $('#rows').append(tr);
  updateRow(tr);
  return tr;
}

function updateRow(tr) {
  updateRowCells(tr);
  renderTotal();
}

// Suma las filas con código válido, como una última fila del presupuesto.
function renderTotal() {
  const found = $$('#rows input').map((i) => findTreatment(i.value)).filter(Boolean);
  $('#total').hidden = !found.length;
  if (!found.length) return;
  const sum = { lista: 0, efectivo: 0, transf: 0, seis: 0 };
  for (const t of found) {
    const p = prices(t.efectivo);
    for (const k in sum) sum[k] += p[k];
  }
  const cell = (k) => $(`#total [data-t="${k}"]`);
  cell('lista').innerHTML = `${money(sum.lista)}<small>3 cuotas de ${money(sum.lista / 3)}</small>`;
  cell('efectivo').textContent = money(sum.efectivo);
  cell('transf').textContent = money(sum.transf);
  cell('seis').innerHTML = `${money(sum.seis)}<small>6 cuotas de ${money(sum.seis / 6)}</small>`;
}

function updateRowCells(tr) {
  const raw = tr.querySelector('input').value.trim();
  const t = findTreatment(raw);
  const cells = Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((td) => [td.dataset.k, td]));
  tr.classList.toggle('empty', !raw);
  if (!t) {
    tr.querySelector('.c-name').innerHTML = raw ? '<span class="notfound">Código no encontrado</span>' : '';
    Object.values(cells).forEach((td) => (td.innerHTML = ''));
    return;
  }
  const p = prices(t.efectivo);
  tr.querySelector('.c-name').textContent = t.name;
  cells.lista.innerHTML = `${money(p.lista)}<small>3 cuotas de ${money(p.lista / 3)}</small>`;
  cells.efectivo.textContent = money(p.efectivo);
  cells.transf.textContent = money(p.transf);
  cells.seis.innerHTML = `${money(p.seis)}<small>6 cuotas de ${money(p.seis / 6)}</small>`;
}

function refreshRows() {
  $$('#rows tr').forEach(updateRow);
}

function addToBudget(code) {
  const empty = $$('#rows tr').find((tr) => !tr.querySelector('input').value.trim());
  const tr = empty || addRow();
  tr.querySelector('input').value = code;
  updateRow(tr);
  saveDraft();
  tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function syncMeta() {
  $('#fecha-print').textContent = fmtDate($('#fecha').value);
  $('#paciente-print').textContent = $('#paciente').value || 'Particular';
}

function saveDraft() {
  syncMeta();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      fecha: $('#fecha').value,
      paciente: $('#paciente').value,
      codes: $$('#rows input').map((i) => i.value),
    }));
  } catch {}
}

function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch {}
  $('#rows').innerHTML = '';
  // La fecha es siempre la de hoy al abrir, como en la planilla.
  $('#fecha').value = today();
  $('#paciente').value = d?.paciente || '';
  const codes = d?.codes?.length ? d.codes : [];
  for (let i = 0; i < Math.max(DEFAULT_ROWS, codes.length); i++) addRow(codes[i] || '');
  syncMeta();
}

$('#fecha').addEventListener('input', saveDraft);
$('#paciente').addEventListener('input', saveDraft);
$('#add-row').addEventListener('click', () => { addRow().querySelector('input').focus(); saveDraft(); });
$('#clear').addEventListener('click', () => {
  if (!confirm('¿Empezar un presupuesto nuevo? Se borran los códigos y el paciente.')) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
  restoreDraft();
});
$('#print').addEventListener('click', () => {
  syncMeta();
  const prev = document.title;
  const paciente = $('#paciente').value.trim();
  document.title = `Presupuesto ${paciente || 'Particular'} ${fmtDate($('#fecha').value).replaceAll('/', '-')}`;
  window.print();
  document.title = prev;
});

// Buscador
function matches(t, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = norm(`${t.code} ${t.name} ${t.category}`);
  return words.every((w) => hay.includes(w));
}

function renderSearch() {
  const q = $('#search').value.trim();
  const tbody = $('#search-results');
  if (!q) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Escribí para buscar entre los tratamientos.</td></tr>';
    return;
  }
  const found = state.treatments.filter((t) => matches(t, q));
  tbody.innerHTML = found.length
    ? found.map((t) => {
        const p = prices(t.efectivo);
        return `<tr><td><b>${esc(t.code)}</b></td><td>${esc(t.name)}</td><td class="num">${money(p.lista)}</td><td class="num">${money(p.efectivo)}</td><td class="num">${money(p.transf)}</td><td class="num">${money(p.seis)}</td>
          <td><button class="btn small primary" data-add="${esc(t.code)}">Agregar</button></td></tr>`;
      }).join('')
    : '<tr><td colspan="7" class="muted">Sin resultados</td></tr>';
}
$('#search').addEventListener('input', renderSearch);
$('#search-results').addEventListener('click', (e) => {
  const code = e.target.dataset?.add;
  if (code) addToBudget(code);
});

// ---------- Administración: tratamientos ----------
function renderAdminTreatments() {
  const q = $('#admin-search').value.trim();
  const list = q ? state.treatments.filter((t) => matches(t, q)) : state.treatments;
  let lastCat = null;
  const html = [];
  for (const t of list) {
    if (!q && t.category !== lastCat) {
      lastCat = t.category;
      html.push(`<tr class="cat"><td colspan="8">${esc(t.category || 'Sin categoría')}</td></tr>`);
    }
    const p = prices(t.efectivo);
    html.push(`<tr><td><b>${esc(t.code)}</b></td><td>${esc(t.name)}</td><td class="muted">${esc(t.category)}</td>
      <td class="num">${money(p.efectivo)}</td><td class="num">${money(p.lista)}</td><td class="num">${money(p.transf)}</td><td class="num">${money(p.seis)}</td>
      <td class="num"><button class="btn small" data-edit="${esc(t.code)}">Editar</button> <button class="btn small danger" data-del="${esc(t.code)}">Borrar</button></td></tr>`);
  }
  $('#admin-rows').innerHTML = html.join('') || '<tr><td colspan="8" class="muted">No hay tratamientos.</td></tr>';
  $('#categories').innerHTML = [...new Set(state.treatments.map((t) => t.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('');
}
$('#admin-search').addEventListener('input', renderAdminTreatments);

async function reloadTreatments() {
  const data = await api('data');
  state.settings = data.settings;
  setTreatments(data.treatments);
  renderLabels();
  renderAdminTreatments();
  renderSearch();
  refreshRows();
}

function openTreatment(t) {
  const f = $('#treatment-form');
  f.reset();
  $('#treatment-dialog-title').textContent = t ? 'Editar tratamiento' : 'Nuevo tratamiento';
  f.originalCode.value = t?.code || '';
  f.code.value = t?.code || '';
  f.name.value = t?.name || '';
  f.category.value = t?.category || '';
  f.efectivo.value = t?.efectivo || '';
  $('#treatment-error').textContent = '';
  updatePreview();
  $('#treatment-dialog').showModal();
}

function updatePreview() {
  const v = Number($('#treatment-form').efectivo.value);
  if (!v) { $('#treatment-preview').textContent = ''; return; }
  const p = prices(v);
  $('#treatment-preview').textContent = `Lista ${money(p.lista)} · Transferencia ${money(p.transf)} · 6 cuotas ${money(p.seis)}`;
}
$('#treatment-form').efectivo.addEventListener('input', updatePreview);

$('#new-treatment').addEventListener('click', () => openTreatment(null));
$('#admin-rows').addEventListener('click', async (e) => {
  const { edit, del } = e.target.dataset || {};
  if (edit) openTreatment(state.byCode.get(edit));
  if (del && confirm(`¿Borrar el tratamiento ${del} - ${state.byCode.get(del)?.name}?`)) {
    try {
      await api('treatments/' + encodeURIComponent(del), { method: 'DELETE' });
      await reloadTreatments();
    } catch (err) { alert(err.message); }
  }
});

$('#treatment-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const f = e.target;
  try {
    await api('treatments', {
      method: 'POST',
      body: { originalCode: f.originalCode.value || undefined, code: f.code.value, name: f.name.value, category: f.category.value, efectivo: f.efectivo.value },
    });
    $('#treatment-dialog').close();
    await reloadTreatments();
  } catch (err) {
    $('#treatment-error').textContent = err.message;
  }
});

// Exportar / importar
$('#export-btn').addEventListener('click', () => {
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['codigo', 'tratamiento', 'efectivo', 'categoria'].join(';')];
  for (const t of state.treatments) lines.push([t.code, t.name, t.efectivo, t.category].map(cell).join(';'));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `lista-de-precios-${today()}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
});

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readSpreadsheet(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    if (!window.XLSX) {
      await new Promise((ok, ko) => {
        const s = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', onload: ok, onerror: ko });
        document.head.append(s);
      });
    }
    const wb = XLSX.read(await file.arrayBuffer());
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  return parseCsv(await file.text());
}

// Reconoce las columnas por su título; si no hay títulos usa el orden
// código, tratamiento, efectivo, categoría.
function rowsToTreatments(rows) {
  rows = rows.filter((r) => r.some((c) => String(c).trim()));
  const head = (rows[0] || []).map(norm);
  const idx = (re) => head.findIndex((h) => re.test(h));
  let cols = { code: idx(/^cod/), name: idx(/tratamiento|nombre|detalle|descripcion/), efectivo: idx(/efectivo|precio/), category: idx(/categ|rubro|seccion/) };
  let body = rows.slice(1);
  if (cols.code < 0 || cols.name < 0 || cols.efectivo < 0) {
    cols = { code: 0, name: 1, efectivo: 2, category: 3 };
    body = rows;
  }
  return body
    .map((r) => ({ code: String(r[cols.code] ?? '').trim(), name: String(r[cols.name] ?? '').trim(), efectivo: String(r[cols.efectivo] ?? '').trim(), category: cols.category >= 0 ? String(r[cols.category] ?? '').trim() : '' }))
    .filter((t) => t.code && t.name && t.efectivo);
}

let pendingImport = [];
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    pendingImport = rowsToTreatments(await readSpreadsheet(file));
  } catch (err) {
    alert('No se pudo leer el archivo: ' + err.message);
    return;
  }
  $('#import-error').textContent = '';
  $('#import-form').replace.checked = false;
  $('#import-summary').innerHTML = pendingImport.length
    ? `Se encontraron <b>${pendingImport.length}</b> tratamientos en <b>${esc(file.name)}</b>. Revisá que se vean bien:`
    : 'No se encontraron tratamientos. El archivo tiene que tener las columnas <b>codigo</b>, <b>tratamiento</b>, <b>efectivo</b> y opcionalmente <b>categoria</b>.';
  $('#import-preview').innerHTML = pendingImport.slice(0, 50).map((t) => `<tr><td>${esc(t.code)}</td><td>${esc(t.name)}</td><td class="num">${esc(t.efectivo)}</td><td class="muted">${esc(t.category)}</td></tr>`).join('');
  $('#import-dialog').showModal();
});

$('#import-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  if (!pendingImport.length) { $('#import-dialog').close(); return; }
  const replace = e.target.replace.checked;
  if (replace && !confirm('Se va a reemplazar toda la lista de precios. ¿Seguro?')) return;
  try {
    const r = await api('treatments/import', { method: 'POST', body: { rows: pendingImport, replace } });
    $('#import-dialog').close();
    await reloadTreatments();
    alert(`Listo: se cargaron ${r.count} tratamientos.`);
  } catch (err) {
    $('#import-error').textContent = err.message;
  }
});

// ---------- Administración: porcentajes ----------
function fillSettingsForm() {
  const f = $('#settings-form');
  for (const [k, v] of Object.entries(state.settings)) if (f[k]) f[k].value = v;
  $('#settings-error').textContent = '';
  $('#settings-ok').textContent = '';
}
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  $('#settings-error').textContent = '';
  try {
    const r = await api('settings', { method: 'PUT', body });
    state.settings = r.settings;
    renderLabels();
    refreshRows();
    renderSearch();
    renderAdminTreatments();
    $('#settings-ok').textContent = 'Guardado.';
  } catch (err) {
    $('#settings-error').textContent = err.message;
  }
});

// ---------- Administración: usuarios ----------
async function loadUsers() {
  const { users } = await api('users');
  $('#user-rows').innerHTML = users.map((u) => `<tr>
    <td><b>${esc(u.username)}</b>${u.id === state.user.id ? ' <span class="muted">(vos)</span>' : ''}</td>
    <td><select data-role="${u.id}"><option value="user"${u.role === 'user' ? ' selected' : ''}>Usuario común</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>Administrador</option></select></td>
    <td class="muted">${esc(fmtDate(u.created_at.slice(0, 10)))}</td>
    <td class="num"><button class="btn small" data-pass="${u.id}">Cambiar contraseña</button>
      ${u.id === state.user.id ? '' : `<button class="btn small danger" data-deluser="${u.id}" data-name="${esc(u.username)}">Borrar</button>`}</td></tr>`).join('');
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#user-error').textContent = '';
  try {
    await api('users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    await loadUsers();
  } catch (err) {
    $('#user-error').textContent = err.message;
  }
});

$('#user-rows').addEventListener('change', async (e) => {
  const id = e.target.dataset.role;
  if (!id) return;
  $('#user-error').textContent = '';
  try {
    await api('users/' + id, { method: 'PUT', body: { role: e.target.value } });
  } catch (err) {
    $('#user-error').textContent = err.message;
  }
  await loadUsers();
});

$('#user-rows').addEventListener('click', async (e) => {
  const { pass, deluser, name } = e.target.dataset || {};
  $('#user-error').textContent = '';
  try {
    if (pass) {
      const pw = prompt('Contraseña nueva (mínimo 6 caracteres):');
      if (!pw) return;
      await api('users/' + pass, { method: 'PUT', body: { password: pw } });
      alert('Contraseña cambiada.');
    }
    if (deluser && confirm(`¿Borrar el usuario ${name}?`)) {
      await api('users/' + deluser, { method: 'DELETE' });
      await loadUsers();
    }
  } catch (err) {
    $('#user-error').textContent = err.message;
  }
});

// ---------- Mi cuenta ----------
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#password-error').textContent = '';
  $('#password-ok').textContent = '';
  try {
    await api('password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    $('#password-ok').textContent = 'Contraseña cambiada.';
  } catch (err) {
    $('#password-error').textContent = err.message;
  }
});

start();
