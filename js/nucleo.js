'use strict';

/* =========================================================
   RayFin — app personal de finanzas
   Todo se guarda en el navegador (localStorage).
   ========================================================= */

const STORAGE_KEY = 'mis-finanzas-v1'; // no cambiar: aquí están los datos guardados

// Modo nube: se activa si firebase-config.js tiene datos (o con ?emulador en localhost para pruebas).
const EMULATOR = new URLSearchParams(location.search).has('emulador') &&
  ['localhost', '127.0.0.1'].includes(location.hostname);
const CLOUD_ENABLED = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) || EMULATOR;
const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#db2777',
  '#059669', '#ea580c', '#0891b2', '#65a30d', '#9333ea', '#64748b'];
const GROUPS = { necesidad: 'Necesidad', gusto: 'Gusto', ahorro: 'Ahorro' };

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#94a3b8';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = arr => arr.reduce((a, b) => a + b, 0);
const pad2 = n => String(n).padStart(2, '0');

/* ---------- Estado ---------- */

function defaultState() {
  const cat = (name, type, group, i) =>
    ({ id: uid(), name, type, group, color: PALETTE[i % PALETTE.length], budget: 0 });
  const gastos = [
    ['Vivienda', 'necesidad'], ['Comida', 'necesidad'], ['Transporte', 'necesidad'],
    ['Servicios', 'necesidad'], ['Salud', 'necesidad'], ['Deudas', 'necesidad'],
    ['Restaurantes', 'gusto'], ['Ocio', 'gusto'], ['Compras', 'gusto'],
    ['Suscripciones', 'gusto'], ['Ahorro e inversión', 'ahorro'], ['Otros gastos', 'gusto']
  ];
  const ingresos = ['Salario', 'Negocio', 'Extras', 'Otros ingresos'];
  return {
    version: 1,
    settings: { currency: 'USD', plan: { mode: 'pct', pct: 20, fixed: 0, expected: 0 }, ray: { skin: 'lima', hat: null, eyes: null, neck: null, owned: [] } },
    categories: [
      ...gastos.map(([n, g], i) => cat(n, 'gasto', g, i)),
      ...ingresos.map((n, i) => cat(n, 'ingreso', null, i + 6))
    ],
    accounts: [
      { id: uid(), name: 'Efectivo', initial: 0 },
      { id: uid(), name: 'Banco', initial: 0 },
      { id: uid(), name: 'USDT', initial: 0 }
    ],
    transactions: [],
    goals: [{ id: uid(), name: 'Fondo de emergencia', target: 0, saved: 0, deadline: '' }],
    recurring: [],
    debts: []
  };
}

function normalize(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  const out = {
    version: 1,
    settings: { ...d.settings, ...(s.settings || {}) },
    categories: Array.isArray(s.categories) ? s.categories : d.categories,
    accounts: Array.isArray(s.accounts) ? s.accounts : d.accounts,
    transactions: Array.isArray(s.transactions)
      ? s.transactions
        .filter(t => t && typeof t.date === 'string' && t.id)
        .map(t => ({ ...t, amount: round2(t.amount) }))
        .filter(t => t.amount > 0)
      : [],
    goals: Array.isArray(s.goals) ? s.goals : d.goals,
    recurring: Array.isArray(s.recurring) ? s.recurring : [],
    debts: Array.isArray(s.debts) ? s.debts : []
  };
  return ensureBase(out);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function load() {
  if (CLOUD_ENABLED) return defaultState(); // los datos llegan de la nube al iniciar sesión
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('No se pudieron leer los datos guardados', e);
  }
  return defaultState();
}

/* ---------- Varias monedas ---------- */
// Cada cuenta tiene su moneda. settings.rates[CUR] = cuánto vale 1 CUR en la moneda principal.
// Cada movimiento en otra moneda guarda `fx` (la tasa de ese día) para que los meses pasados no cambien.
const baseCur = L => String((L && L.settings && L.settings.currency) || 'USD').trim().toUpperCase();
const accCur = (L, id) => {
  const a = L.accounts.find(x => x.id === id);
  return String((a && a.currency) || baseCur(L)).trim().toUpperCase();
};
function rateOf(L, cur) {
  cur = String(cur || '').toUpperCase();
  if (!cur || cur === baseCur(L)) return 1;
  const r = Number(((L.settings && L.settings.rates) || {})[cur]);
  return r > 0 ? r : null; // null = falta la tasa
}
/** Calcula (sin guardarlo) el monto de cada movimiento en la moneda principal. */
function ensureBase(L) {
  const base = baseCur(L);
  for (const t of L.transactions) {
    const cur = accCur(L, t.accountId);
    const v = cur === base ? t.amount : t.amount * (Number(t.fx) > 0 ? Number(t.fx) : (rateOf(L, cur) || 1));
    Object.defineProperty(t, '_b', { value: v, writable: true, configurable: true, enumerable: false });
  }
  return L;
}
const bv = t => (t._b ?? t.amount);
/** Monedas de las cuentas que no son la principal. */
const otherCurrencies = L => [...new Set(L.accounts.map(a => accCur(L, a.id)))].filter(c => c !== baseCur(L));

let state = load();

/* ---------- Libros: personal, espacios compartidos y finanzas de otros ---------- */
let stores = { personal: state };
let ctxKey = 'personal';
let sharing = { me: null, spaces: [], invites: [], partners: [] };
const isReadOnly = () => ctxKey.startsWith('user:');
const isSpace = () => ctxKey.startsWith('space:');
const firstName = s => String(s || '').trim().split(/[\s@]+/)[0] || '';

const cloudOn = () => !!(window.Cloud && window.Cloud.user);
const cloudFail = e => {
  console.error(e);
  toast('⚠️ No se pudo guardar en la nube' + (e?.code === 'permission-denied' ? ': sin permiso.' : '.'));
};

function guardRO() {
  if (!isReadOnly()) return false;
  toast('Solo lectura: no puedes modificar las finanzas de ' + firstName(currentCtx().short));
  return true;
}

/** Guarda ajustes, cuentas, categorías y metas. */
function save() {
  if (cloudOn()) { if (!guardRO()) window.Cloud.saveMeta(ctxKey, state).catch(cloudFail); return; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('⚠️ No se pudo guardar. Exporta un respaldo.');
  }
}
/** Guarda (crea o actualiza) un movimiento. */
function saveTx(tx) {
  if (cloudOn()) {
    if (guardRO()) return;
    if (isSpace() && !tx.createdBy) tx.createdBy = { uid: window.Cloud.uid, name: window.Cloud.myName };
    window.Cloud.putTx(ctxKey, tx).catch(cloudFail);
  } else save();
}
/** Elimina un movimiento. */
function removeTx(id) {
  if (cloudOn()) { if (!guardRO()) window.Cloud.delTx(ctxKey, id).catch(cloudFail); }
  else save();
}
/** Reemplaza todos los datos (importar, datos de ejemplo, borrar todo). */
function saveAll() {
  if (cloudOn()) return guardRO() ? Promise.resolve() : window.Cloud.replaceAll(ctxKey, state).catch(cloudFail);
  save();
  return Promise.resolve();
}

/* ---------- Formatos ---------- */

let moneyFmt = null, moneyFmt0 = null;
function buildFormatter() {
  const cur = (state.settings.currency || 'USD').trim().toUpperCase();
  try {
    const f = new Intl.NumberFormat('es', { style: 'currency', currency: cur, maximumFractionDigits: 2 });
    const f0 = new Intl.NumberFormat('es', { style: 'currency', currency: cur, maximumFractionDigits: 0 });
    moneyFmt = n => f.format(n);
    moneyFmt0 = n => f0.format(n);
  } catch {
    // Monedas no ISO (ej. USDT)
    const f = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const f0 = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });
    moneyFmt = n => `${f.format(n)} ${cur}`;
    moneyFmt0 = n => `${f0.format(n)} ${cur}`;
  }
}
// Ocultar montos (como en las apps de exchange). Preferencia de este dispositivo.
let hideAmounts = false;
try { hideAmounts = localStorage.getItem('mf-hide') === '1'; } catch { /* sin acceso */ }
const fmt = n => hideAmounts ? '••••••' : moneyFmt(round2(n));
const curFmts = new Map();
/** Formatea en una moneda cualquiera (para cuentas en otra moneda). */
function fmtC(n, cur) {
  if (hideAmounts) return '••••••';
  cur = String(cur || '').toUpperCase();
  if (!cur || cur === baseCur(state)) return fmt(n);
  if (!curFmts.has(cur)) {
    let f;
    try { const nf = new Intl.NumberFormat('es', { style: 'currency', currency: cur, maximumFractionDigits: 2 }); f = v => nf.format(v); }
    catch { const nf = new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); f = v => `${nf.format(v)} ${cur}`; }
    curFmts.set(cur, f);
  }
  return curFmts.get(cur)(round2(n));
}
/** Para recuadros pequeños: sin decimales desde 1.000. */
const fmtS = n => hideAmounts ? '••••••' : Math.abs(n) >= 1000 ? moneyFmt0(Math.round(n)) : moneyFmt(round2(n));

/* ---------- Tema ---------- */
const THEME_KEY = 'mf-theme';
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#ffffff');
}
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* sin acceso */ }
  applyTheme(t);
}

const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 18),
  out: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  in: svg('<path d="M17 7 7 17M16 17H7V8"/>'),
  swap: svg('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 16),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 16),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>', 16),
  eyeSm: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 16)
};
const pctFmt = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });
const pct = x => pctFmt.format(x);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function ymFromDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d || 1); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function monthName(ym, opts = { month: 'long', year: 'numeric' }) {
  return cap(new Intl.DateTimeFormat('es', opts).format(parseDate(ym + '-01')));
}
function dayName(date) {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(date));
}
function shiftMonth(ym, delta) {
  const d = parseDate(ym + '-01');
  d.setMonth(d.getMonth() + delta);
  return ymFromDate(d);
}
