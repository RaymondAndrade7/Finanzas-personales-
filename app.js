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

/* ---------- Consultas ---------- */

const catById = id => state.categories.find(c => c.id === id);
const accById = id => state.accounts.find(a => a.id === id);
const monthTx = ym => state.transactions.filter(t => t.date.startsWith(ym));

function totals(txs) {
  let ing = 0, gas = 0;
  for (const t of txs) {
    if (t.type === 'ingreso') ing += bv(t);
    else if (t.type === 'gasto') gas += bv(t);
  }
  return { ing, gas, bal: ing - gas };
}

function spendingByCategory(txs) {
  const map = new Map();
  for (const t of txs) {
    if (t.type !== 'gasto') continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + bv(t));
  }
  return [...map.entries()]
    .map(([id, value]) => ({ cat: catById(id) || { name: 'Sin categoría', color: '#94a3b8', group: 'gusto' }, value }))
    .sort((a, b) => b.value - a.value);
}

function accountBalances() {
  const b = {};
  for (const a of state.accounts) b[a.id] = Number(a.initial) || 0;
  for (const t of state.transactions) {
    if (t.type === 'ingreso') b[t.accountId] = (b[t.accountId] || 0) + t.amount;
    else if (t.type === 'gasto') b[t.accountId] = (b[t.accountId] || 0) - t.amount;
    else if (t.type === 'transferencia') {
      b[t.accountId] = (b[t.accountId] || 0) - t.amount;
      b[t.toAccountId] = (b[t.toAccountId] || 0) + (Number(t.toAmount) > 0 ? Number(t.toAmount) : t.amount);
    }
  }
  return b;
}
/** Valor de un saldo en la moneda principal (con la tasa de hoy). */
const toBase = (amount, cur) => amount * (rateOf(state, cur) || 1);

function budgetStatus(txs) {
  const spent = new Map();
  for (const t of txs) if (t.type === 'gasto') spent.set(t.categoryId, (spent.get(t.categoryId) || 0) + bv(t));
  return state.categories
    .filter(c => c.type === 'gasto')
    .map(c => ({ cat: c, budget: Number(c.budget) || 0, spent: spent.get(c.id) || 0 }));
}

function lastMonths(n, fromYM = currentYM) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(fromYM, -i));
  return out;
}

/* ---------- Plan de ahorro ---------- */

const PLAN_DEFAULT = { mode: 'pct', pct: 20, fixed: 0, expected: 0 };
const planOf = L => ({ ...PLAN_DEFAULT, ...((L && L.settings && L.settings.plan) || {}) });

/**
 * Estado del plan de ahorro de un libro (personal o de otra persona) en un mes.
 * Ahorro = ingresos − gastos que no son de ahorro (lo enviado a "Ahorro e inversión" cuenta como ahorro).
 */
function planFor(L, ym) {
  const plan = planOf(L);
  const cat = id => L.categories.find(c => c.id === id);
  let ing = 0, spend = 0;
  for (const t of L.transactions) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'ingreso') ing += bv(t);
    else if (t.type === 'gasto' && (cat(t.categoryId)?.group || 'gusto') !== 'ahorro') spend += bv(t);
  }
  const committed = committedFor(L, ym); // pagos fijos que faltan este mes
  const projected = ing + committed.income;
  const base = projected > 0 ? projected : Number(plan.expected) || 0;
  const estimated = (ing <= 0 && base > 0) || committed.income > 0;
  const target = round2(plan.mode === 'fixed' ? Number(plan.fixed) || 0 : base * (Number(plan.pct) || 0) / 100);
  const saved = round2(ing - spend);
  const nowYM = ymFromDate(new Date());
  const isCurrent = ym === nowYM, isPast = ym < nowYM;
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const daysLeft = isCurrent ? dim - new Date().getDate() + 1 : 0;
  const canSpend = round2(base - target - spend - committed.spend); // lo que aún se puede gastar sin romper el plan
  const perDay = daysLeft > 0 ? canSpend / daysLeft : 0;
  let status;
  if (target <= 0) status = 'sin-plan';
  else if (ing > 0 && saved >= target && (isPast || canSpend >= 0)) status = isPast ? 'cumplido' : 'cumpliendo';
  else if (isPast) status = 'no-cumplido';
  else if (canSpend < 0) status = 'en-riesgo';
  else status = 'en-camino';
  return { plan, ing, spend, base, estimated, target, saved, canSpend, perDay, daysLeft, isCurrent, isPast, status, committed,
    progress: target > 0 ? Math.max(0, saved) / target : 0 };
}

/** Últimos meses (hasta el actual) con su estado, y la racha de meses cumplidos. */
function planHistory(L, n = 6) {
  const months = lastMonths(n, ymFromDate(new Date()));
  const hist = months.map(ym => ({ ym, ...planFor(L, ym) }));
  let streak = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h.isCurrent && h.status !== 'cumpliendo') continue; // el mes en curso aún no rompe la racha
    if (h.status === 'cumplido' || h.status === 'cumpliendo') streak++;
    else break;
  }
  return { hist, streak };
}

const PLAN_STATUS = {
  'cumpliendo': ['Meta alcanzada', 'chip-up'],
  'cumplido': ['Cumplido', 'chip-up'],
  'en-camino': ['En camino', 'chip-neutral'],
  'en-riesgo': ['En riesgo', 'chip-down'],
  'no-cumplido': ['No cumplido', 'chip-down'],
  'sin-plan': ['Sin datos', 'chip-neutral']
};

/** Tarjeta del plan de ahorro del mes. */
function planCard(L, { who = null, editable = false } = {}) {
  const p = planFor(L, currentYM);
  const { hist, streak } = planHistory(L);
  const mes = monthName(currentYM, { month: 'long' }).toLowerCase();
  const head = `<div class="card-head"><h2>${who ? `Plan de ahorro de ${esc(who)}` : 'Plan de ahorro'} · ${esc(mes)}</h2>
    ${editable ? `<button class="link" data-action="goto" data-view="metas">Ajustar ${ICONS.chevron}</button>` : ''}</div>`;
  if (p.status === 'sin-plan') {
    return `<div class="card plan">${head}
      <p class="muted" style="margin:0;font-size:.9rem">${editable
        ? 'Registra tus ingresos del mes, o indica tu ingreso mensual esperado en <b>Metas</b>, para calcular cuánto ahorrar.'
        : 'Aún no hay ingresos registrados este mes.'}</p></div>`;
  }
  const [label, cls] = PLAN_STATUS[p.status];
  const rule = p.plan.mode === 'fixed' ? 'monto fijo' : `${Number(p.plan.pct) || 0}% de ${p.estimated ? 'tu ingreso esperado' : 'tus ingresos'}`;
  let foot;
  if (p.status === 'cumpliendo') foot = `¡Ya alcanzaste la meta del mes! 🎉 ${p.canSpend > 0 ? `Aún puedes gastar ${esc(fmt(p.canSpend))} sin romperla.` : ''}`;
  else if (p.status === 'cumplido') foot = '¡Cumpliste el plan de este mes! 🎉';
  else if (p.status === 'no-cumplido') foot = `Faltaron ${esc(fmt(p.target - p.saved))} para la meta.`;
  else if (p.canSpend >= 0) foot = `Puedes gastar <b>${esc(fmt(p.canSpend))}</b> más este mes${p.daysLeft > 0 ? ` · <b>${esc(fmt(p.perDay))}</b> por día` : ''}.`;
  else foot = `Te pasaste <b class="bad">${esc(fmt(-p.canSpend))}</b> del gasto que permite el plan.`;
  if (p.committed.spend > 0 && p.isCurrent && p.status !== 'cumplido') foot += ` <span class="muted">Ya descontando ${esc(fmt(p.committed.spend))} de pagos fijos.</span>`;
  if (p.estimated) foot += ` <span class="muted">(${p.committed.income > 0 ? 'cuenta el ingreso fijo que falta' : 'estimado con el ingreso esperado'})</span>`;

  const dots = hist.map(h => {
    const ok = h.status === 'cumplido' || h.status === 'cumpliendo';
    const bad = h.status === 'no-cumplido';
    const st = h.isCurrent ? (ok ? 'ok' : 'now') : ok ? 'ok' : bad ? 'bad' : 'none';
    return `<span class="pdot ${st}" title="${esc(monthName(h.ym))}: ${esc(PLAN_STATUS[h.status][0])}"><i></i>${esc(monthName(h.ym, { month: 'narrow' }))}</span>`;
  }).join('');

  return `<div class="card plan">
    ${head}
    <div class="plan-top">
      <div class="grow"><div class="plan-saved ${p.saved < 0 ? 'gas' : ''}">${esc(fmt(p.saved))}</div>
        <small>ahorrado de <b>${esc(fmt(p.target))}</b> · ${esc(rule)}</small></div>
      <span class="chip ${cls}">${label}</span>
    </div>
    <div class="bar plan-bar"><div class="fill ${p.status === 'en-riesgo' ? 'over' : ''}" style="width:${Math.min(100, p.progress * 100)}%"></div></div>
    <p class="plan-foot">${foot}</p>
    <div class="plan-history"><div class="pdots">${dots}</div>${streak > 0 ? `<span class="streak">🔥 ${streak} ${streak === 1 ? 'mes' : 'meses'} seguidos</span>` : ''}</div>
  </div>`;
}

/** En el espacio compartido: el plan de cada integrante y el total juntos. */
function couplePlansCard(sp) {
  let tSaved = 0, tTarget = 0, any = false;
  const rows = sp.members.map((m, i) => {
    const L = m.me ? stores.personal : stores['user:' + m.uid];
    const name = m.me ? 'Tú' : firstName(m.name || m.email);
    const av = `<span class="avatar" style="--c:${PALETTE[(i + 3) % PALETTE.length]}">${esc(name.charAt(0).toUpperCase())}</span>`;
    if (!L) return `<div class="asset">${av}<div class="grow"><div class="asset-name">${esc(name)}</div>
      <div class="asset-sub">No comparte sus finanzas personales</div></div></div>`;
    const p = planFor(L, currentYM);
    if (p.status === 'sin-plan') return `<div class="asset">${av}<div class="grow"><div class="asset-name">${esc(name)}</div>
      <div class="asset-sub">Sin ingresos registrados este mes</div></div></div>`;
    any = true; tSaved += p.saved; tTarget += p.target;
    const [label, cls] = PLAN_STATUS[p.status];
    return `<div class="asset plan-row">${av}
      <div class="grow"><div class="asset-name">${esc(name)} <span class="chip ${cls}">${label}</span></div>
        <div class="bar"><div class="fill ${p.status === 'en-riesgo' ? 'over' : ''}" style="width:${Math.min(100, p.progress * 100)}%"></div></div>
        <div class="asset-sub">${esc(fmt(p.saved))} de ${esc(fmt(p.target))}</div></div></div>`;
  }).join('');
  const total = any ? `<div class="plan-total"><span>Juntos este mes</span><b>${esc(fmt(tSaved))} <small>de ${esc(fmt(tTarget))}</small></b></div>` : '';
  return `<div class="card plan"><h2>Planes de ahorro · ${esc(monthName(currentYM, { month: 'long' }).toLowerCase())}</h2>${rows}${total}</div>`;
}

/** Configuración del plan (en Metas). */
function planSettingsCard() {
  const plan = planOf(state);
  const p = planFor(state, ymFromDate(new Date()));
  const base = p.base;
  const monthly = plan.mode === 'fixed' ? Number(plan.fixed) || 0 : base * (Number(plan.pct) || 0) / 100;
  const ef = state.goals.find(g => /emergencia/i.test(g.name));
  let projection = '';
  if (ef && Number(ef.target) > Number(ef.saved) && monthly > 0) {
    const months = Math.ceil((Number(ef.target) - (Number(ef.saved) || 0)) / monthly);
    projection = `<p class="muted plan-proj">A este ritmo completarías tu <b>${esc(ef.name)}</b> en <b>${months} ${months === 1 ? 'mes' : 'meses'}</b>.</p>`;
  }
  return `<div class="card">
    <h2>Mi plan de ahorro</h2>
    <p class="muted" style="margin:-6px 0 12px;font-size:.88rem">Aparta cada mes una parte de lo que ganas. Lo recomendado es al menos el 20%.</p>
    <div class="pills">
      <button class="pill ${plan.mode === 'pct' ? 'active' : ''}" data-action="plan-mode" data-mode="pct">% del ingreso</button>
      <button class="pill ${plan.mode === 'fixed' ? 'active' : ''}" data-action="plan-mode" data-mode="fixed">Monto fijo</button>
    </div>
    ${plan.mode === 'pct' ? `
      <div class="plan-pct">
        <input type="range" min="5" max="60" step="1" value="${Number(plan.pct) || 20}" data-plan="pct" aria-label="Porcentaje a ahorrar">
        <b id="planPctLabel">${Number(plan.pct) || 20}%</b>
      </div>
      <div class="pills">${[10, 15, 20, 30].map(v => `<button class="pill sm ${Number(plan.pct) === v ? 'active' : ''}" data-action="plan-pct" data-v="${v}">${v}%</button>`).join('')}</div>`
    : `<label class="field" style="margin-top:12px">Monto a ahorrar cada mes
        <input type="number" min="0" step="0.01" inputmode="decimal" data-plan="fixed" value="${Number(plan.fixed) || ''}" placeholder="0.00"></label>`}
    <label class="field" style="margin-top:12px">Ingreso mensual esperado (opcional)
      <input type="number" min="0" step="0.01" inputmode="decimal" data-plan="expected" value="${Number(plan.expected) || ''}" placeholder="Ej: 2000">
      <small>Se usa mientras no hayas registrado tus ingresos del mes.</small></label>
    ${base > 0 ? `<div class="suggest" style="margin-top:12px">
        <div><small>Ingreso ${p.estimated ? 'esperado' : 'del mes'}</small><b>${esc(fmtS(base))}</b></div>
        <div><small>Ahorro al mes</small><b class="ing">${esc(fmtS(monthly))}</b></div>
        <div><small>Ahorro al año</small><b>${esc(fmtS(monthly * 12))}</b></div>
      </div>` : ''}
    ${projection}
  </div>`;
}

/** Promedio de gastos (sin la categoría de ahorro) de los últimos meses con datos. */
function avgMonthlyExpenses() {
  const months = lastMonths(6, ymFromDate(new Date()));
  const vals = months.map(ym => sum(monthTx(ym)
    .filter(t => t.type === 'gasto' && catById(t.categoryId)?.group !== 'ahorro')
    .map(t => bv(t)))).filter(v => v > 0);
  const recent = vals.slice(-3);
  return recent.length ? sum(recent) / recent.length : 0;
}

/* ---------- Puntos y logros ---------- */

const PTS = { plan: 300, budget: 150, perDay: 5, maxDays: 20, team: 200 };
const LEVEL_SIZE = 500;

/** Resumen de un mes de un libro (para puntos). */
function monthStats(L, ym) {
  const cat = id => L.categories.find(c => c.id === id);
  let ing = 0, nec = 0, gus = 0;
  const days = new Set(), spent = new Map();
  let n = 0;
  for (const t of L.transactions) {
    if (!t.date.startsWith(ym)) continue;
    n++; days.add(t.date);
    if (t.type === 'ingreso') ing += bv(t);
    if (t.type === 'gasto') {
      spent.set(t.categoryId, (spent.get(t.categoryId) || 0) + bv(t));
      const g = cat(t.categoryId)?.group || 'gusto';
      if (g === 'necesidad') nec += bv(t); else if (g === 'gusto') gus += bv(t);
    }
  }
  const budgets = L.categories.filter(c => c.type === 'gasto' && Number(c.budget) > 0);
  const budgetOk = n > 0 && budgets.length > 0 && budgets.every(c => (spent.get(c.id) || 0) <= Number(c.budget));
  const balanced = ing > 0 && nec / ing <= .5 && gus / ing <= .3 && (ing - nec - gus) / ing >= .2;
  return { n, days: days.size, ing, budgetOk, balanced };
}

function avgExpensesOf(L) {
  const cat = id => L.categories.find(c => c.id === id);
  const vals = lastMonths(6, ymFromDate(new Date())).map(ym => sum(L.transactions
    .filter(t => t.date.startsWith(ym) && t.type === 'gasto' && cat(t.categoryId)?.group !== 'ahorro').map(t => bv(t)))).filter(v => v > 0);
  const recent = vals.slice(-3);
  return recent.length ? sum(recent) / recent.length : 0;
}

/**
 * Puntos de una persona, calculados a partir de sus datos (así no se pueden "perder" ni duplicar).
 * Los meses ya cerrados cuentan para plan, presupuesto y equipo; el registro diario cuenta también el mes en curso.
 */
function pointsFor(L, { teammates = [], inTeam = false } = {}) {
  const entries = [];
  const add = (key, ym, label, pts) => entries.push({ key, ym, label, pts });
  const nowYM = ymFromDate(new Date());
  const dates = L.transactions.map(t => t.date).sort();
  const months = [];
  if (dates.length) { for (let ym = dates[0].slice(0, 7); ym <= nowYM; ym = shiftMonth(ym, 1)) months.push(ym); }

  let planMonths = 0, streak = 0, bestStreak = 0, balancedEver = false, bestDays = 0;
  for (const ym of months) {
    const st = monthStats(L, ym);
    const closed = ym < nowYM;
    if (st.days) add('dias', ym, `Registraste movimientos ${Math.min(st.days, PTS.maxDays)} días`, Math.min(st.days, PTS.maxDays) * PTS.perDay);
    bestDays = Math.max(bestDays, st.days);
    if (!closed) continue;
    const plan = planFor(L, ym);
    if (plan.status === 'cumplido') {
      planMonths++; streak++; bestStreak = Math.max(bestStreak, streak);
      add('plan', ym, 'Cumpliste tu plan de ahorro', PTS.plan);
      if (teammates.length && teammates.every(T => planFor(T, ym).status === 'cumplido')) add('equipo', ym, 'Todo el equipo cumplió su plan', PTS.team);
    } else streak = 0;
    if (st.budgetOk) add('presupuesto', ym, 'Respetaste todos tus presupuestos', PTS.budget);
    if (st.balanced) balancedEver = true;
  }

  const goalsWithTarget = L.goals.filter(g => Number(g.target) > 0);
  const goalsDone = goalsWithTarget.filter(g => Number(g.saved) >= Number(g.target));
  const ef = L.goals.find(g => /emergencia/i.test(g.name));
  const avg = avgExpensesOf(L);
  const cushion = ef && avg > 0 ? (Number(ef.saved) || 0) / avg : 0;

  const A = [
    { id: 'primer-paso', icon: '👣', name: 'Primer paso', desc: 'Registra tu primer movimiento', pts: 50, done: L.transactions.length > 0 },
    { id: 'limites', icon: '🎯', name: 'Con límites', desc: 'Define un presupuesto para una categoría', pts: 50, done: L.categories.some(c => Number(c.budget) > 0) },
    { id: 'sonador', icon: '🌟', name: 'Soñador', desc: 'Crea una meta con monto objetivo', pts: 50, done: goalsWithTarget.length > 0 },
    { id: 'constante', icon: '📅', name: 'Constante', desc: 'Registra movimientos 20 días en un mismo mes', pts: 200, done: bestDays >= 20, progress: Math.min(1, bestDays / 20) },
    { id: 'ahorrador', icon: '🐷', name: 'Ahorrador', desc: 'Cumple tu plan de ahorro un mes', pts: 100, done: planMonths >= 1 },
    { id: 'racha-3', icon: '🔥', name: 'En racha', desc: 'Cumple tu plan 3 meses seguidos', pts: 300, done: bestStreak >= 3, progress: Math.min(1, bestStreak / 3) },
    { id: 'racha-6', icon: '🚀', name: 'Imparable', desc: 'Cumple tu plan 6 meses seguidos', pts: 800, done: bestStreak >= 6, progress: Math.min(1, bestStreak / 6) },
    { id: 'equilibrio', icon: '⚖️', name: 'Equilibrio', desc: 'Un mes cumpliendo la regla 50/30/20', pts: 150, done: balancedEver },
    { id: 'colchon', icon: '🛟', name: 'Colchón', desc: 'Fondo de emergencia de 3 meses de gastos', pts: 400, done: cushion >= 3, progress: Math.min(1, cushion / 3) },
    { id: 'meta', icon: '🏆', name: 'Meta lograda', desc: 'Completa una meta de ahorro (500 por cada una)', pts: 500 * Math.max(1, goalsDone.length), done: goalsDone.length > 0 },
    { id: 'equipo', icon: '🤝', name: 'En equipo', desc: 'Comparte un espacio con tu pareja', pts: 100, done: inTeam }
  ];
  for (const a of A) if (a.done) add('logro', null, `Logro: ${a.name}`, a.pts);

  const earned = sum(entries.map(e => e.pts));
  const r = rayOf(L);
  const spent = Number(r.spent) || 0;
  const level = Math.floor(earned / LEVEL_SIZE) + 1;
  return {
    earned, spent, available: Math.max(0, earned - spent),
    level, levelProgress: (earned % LEVEL_SIZE) / LEVEL_SIZE, toNext: LEVEL_SIZE - (earned % LEVEL_SIZE),
    entries: entries.sort((a, b) => (b.ym || '9999') .localeCompare(a.ym || '9999')),
    achievements: A
  };
}

/** Puntos de la persona que usa la app (con sus compañeros de equipo, si comparten). */
function myPoints() {
  const teammates = sharing.partners.filter(p => p.status === 'ok' && stores['user:' + p.uid]).map(p => stores['user:' + p.uid]);
  return pointsFor(stores.personal, { teammates, inTeam: sharing.spaces.length > 0 });
}

/** Puntos nuevos desde la última vez (para que Ray lo celebre). */
function newPointsSinceLastVisit(total) {
  const key = 'rf-seen-pts-' + (window.Cloud?.uid || 'local');
  let seen = null;
  try { seen = localStorage.getItem(key); } catch { /* sin acceso */ }
  try { localStorage.setItem(key, String(total)); } catch { /* sin acceso */ }
  if (seen === null) return { gained: total, first: true }; // primera vez: celebrar lo ganado con el historial
  return { gained: Math.max(0, total - Number(seen)), first: false };
}

/** Tarjeta de puntos y logros (en Metas). */
function pointsCard() {
  const P = myPoints();
  const recent = P.entries.slice(0, 8).map(e => `<div class="pt-row"><span class="grow">${esc(e.label)}${e.ym ? ` <small>· ${esc(monthName(e.ym, { month: 'short', year: 'numeric' }))}</small>` : ''}</span><b class="ing">+${e.pts}</b></div>`).join('');
  const badges = P.achievements.map(a => `
    <div class="badge ${a.done ? 'done' : ''}" title="${esc(a.desc)}">
      <div class="badge-ico">${a.icon}</div>
      <div class="badge-name">${esc(a.name)}</div>
      <div class="badge-desc">${esc(a.desc)}</div>
      ${!a.done && a.progress ? `<div class="bar"><div class="fill" style="width:${Math.round(a.progress * 100)}%"></div></div>` : ''}
      <div class="badge-pts">${a.done ? '✓ ' : ''}${a.pts} pts</div>
    </div>`).join('');
  return `<div class="card points-card">
    <div class="card-head"><h2>Puntos y logros</h2><button class="btn small primary" data-action="ray-closet">Armario de Ray</button></div>
    <div class="pts-hero">
      <div><div class="pts-big">${P.available.toLocaleString('es')}</div><small>puntos disponibles</small></div>
      <div class="pts-level"><b>Nivel ${P.level}</b><div class="bar"><div class="fill" style="width:${Math.round(P.levelProgress * 100)}%"></div></div><small>${P.toNext} pts para el nivel ${P.level + 1}</small></div>
    </div>
    <div class="subhead">Cómo ganar puntos</div>
    <div class="how">
      <div><b>+${PTS.plan}</b><span>cumplir tu plan del mes</span></div>
      <div><b>+${PTS.budget}</b><span>respetar tus presupuestos</span></div>
      <div><b>+${PTS.perDay}</b><span>por día con registros (máx. ${PTS.maxDays})</span></div>
      <div><b>+${PTS.team}</b><span>si todo el equipo cumple</span></div>
    </div>
    <div class="subhead">Logros · ${P.achievements.filter(a => a.done).length} de ${P.achievements.length}</div>
    <div class="badges">${badges}</div>
    ${recent ? `<div class="subhead">Últimos puntos ganados</div><div class="pt-list">${recent}</div>` : ''}
    <p class="muted" style="margin:12px 0 0;font-size:.78rem">Total ganado: ${P.earned.toLocaleString('es')} · gastado en Ray: ${P.spent.toLocaleString('es')}. El plan, el presupuesto y el equipo cuentan al cerrar cada mes.</p>
  </div>`;
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#c8f031', '#ffd23f', '#2fd6b0', '#ff6f59', '#9b5cff', '#ffffff'];
  box.innerHTML = Array.from({ length: 70 }, (_, i) =>
    `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * .5}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join('');
  // Encima de cualquier ventana abierta (p. ej. el armario)
  (document.querySelector('dialog[open]') || document.body).appendChild(box);
  setTimeout(() => box.remove(), 3600);
}

/* ---------- UI general ---------- */

let currentYM = ymFromDate(new Date());
let currentView = 'inicio';
const txFilter = { q: '', type: 'todos' };

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

const empty = msg => `<div class="empty">${msg}</div>`;

function contexts() {
  const list = [{ key: 'personal', short: 'Yo', label: 'Mis finanzas', kind: 'personal' }];
  for (const sp of sharing.spaces) {
    if (stores['space:' + sp.id]) list.push({ key: 'space:' + sp.id, short: sp.name, label: sp.name, kind: 'space', space: sp });
  }
  for (const p of sharing.partners) {
    if (p.status === 'ok' && stores['user:' + p.uid]) {
      list.push({ key: 'user:' + p.uid, short: firstName(p.name), label: 'Finanzas de ' + firstName(p.name), kind: 'partner' });
    }
  }
  return list;
}
const currentCtx = () => contexts().find(c => c.key === ctxKey) || contexts()[0];

function switchCtx(key) {
  if (!stores[key]) { toast('Cargando…'); return; }
  ctxKey = key;
  state = stores[key];
  buildFormatter();
  document.body.classList.toggle('read-only', isReadOnly());
  setView(currentView);
}

function renderCtxBar() {
  const bar = $('#ctxBar'), note = $('#ctxNote');
  if (!bar) return;
  const list = contexts();
  bar.hidden = list.length < 2;
  const icon = k => k === 'space' ? ICONS.users : k === 'partner' ? ICONS.eyeSm : ICONS.user;
  bar.innerHTML = list.map(c => `<button class="ctx ${c.key === ctxKey ? 'active' : ''}" data-action="ctx" data-key="${esc(c.key)}">${icon(c.kind)}<span>${esc(c.short)}</span></button>`).join('');
  const c = currentCtx();
  if (c.kind === 'partner') {
    note.hidden = false;
    note.className = 'ctx-note ro';
    note.innerHTML = `${ICONS.eyeSm}<span>Estás viendo las finanzas de <b>${esc(c.short)}</b> · solo lectura</span>`;
  } else if (c.kind === 'space') {
    const names = c.space.members.map(m => m.me ? 'tú' : firstName(m.name || m.email)).join(', ');
    note.hidden = false;
    note.className = 'ctx-note shared';
    note.innerHTML = `${ICONS.users}<span>Espacio compartido · lo ven y editan ${esc(names)}</span>`;
  } else {
    note.hidden = true;
  }
}

function setView(view) {
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#monthPicker').hidden = view === 'ajustes' || view === 'metas';
  $('#fab').hidden = view === 'ajustes' || view === 'metas' || isReadOnly();
  renderCtxBar();
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  ensureBase(state);
  $('#monthLabel').textContent = monthName(currentYM);
  ({
    inicio: renderInicio,
    movimientos: renderMovimientos,
    presupuesto: renderPresupuesto,
    metas: renderMetas,
    ajustes: renderAjustes
  })[currentView]();
}

/* ---------- Vista: Inicio ---------- */

function stat(label, value, cls = '') {
  return `<div class="stat"><div class="label">${label}</div><div class="value ${cls}" title="${esc(value)}">${esc(value)}</div></div>`;
}

function donut(items, total) {
  let offset = 0;
  const segs = items.map(it => {
    const p = (it.value / total) * 100;
    const s = `<circle r="15.9155" cx="21" cy="21" fill="transparent" stroke="${safeColor(it.cat.color)}"
      stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-offset}"><title>${esc(it.cat.name)}: ${esc(fmt(it.value))}</title></circle>`;
    offset += p;
    return s;
  }).join('');
  return `<svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Gastos por categoría">
    <circle r="15.9155" cx="21" cy="21" fill="transparent" stroke="var(--track)" stroke-width="6"/>${segs}</svg>`;
}

function tipsFor(txs, ing, gas, byCat) {
  const tips = [];
  if (!state.transactions.length) {
    tips.push('Bienvenido 👋 Toca el botón <b>+</b> para registrar tu primer ingreso o gasto.');
    tips.push('Durante el primer mes anota <b>todo</b>, incluso lo pequeño: así descubrirás a dónde se va tu dinero.');
    tips.push('Si solo quieres probar, en <b>Ajustes</b> puedes cargar datos de ejemplo.');
  } else if (!txs.length) {
    tips.push('No hay movimientos en este mes.');
  } else {
    if (ing > 0) {
      const r = (ing - gas) / ing;
      if (r < 0) tips.push(`Este mes gastaste <b>${esc(fmt(gas - ing))}</b> más de lo que ingresaste. Empieza recortando los gustos.`);
      else if (r < 0.1) tips.push('Tu tasa de ahorro está por debajo del 10%. Prueba apartar el ahorro apenas cobres (págate a ti primero).');
      else if (r < 0.2) tips.push(`Ahorras el ${pct(r)} de tus ingresos. ¡Bien! La meta recomendada es 20%.`);
      else tips.push(`¡Excelente! Estás ahorrando el ${pct(r)} de tus ingresos.`);
    } else if (gas > 0) {
      tips.push('Registraste gastos pero ningún ingreso este mes. Agrega tus ingresos para ver tu balance real.');
    }
    if (byCat[0] && gas > 0) tips.push(`Tu mayor gasto es <b>${esc(byCat[0].cat.name)}</b> (${pct(byCat[0].value / gas)} del total).`);
    const over = budgetStatus(txs).filter(b => b.budget > 0 && b.spent > b.budget);
    if (over.length) tips.push(`Te pasaste del presupuesto en: ${over.map(b => `<b>${esc(b.cat.name)}</b>`).join(', ')}.`);
    const ef = state.goals.find(g => /emergencia/i.test(g.name));
    const avg = avgMonthlyExpenses();
    if (ef && avg > 0 && (Number(ef.saved) || 0) < avg * 3) {
      tips.push(`Tu fondo de emergencia cubre ${((Number(ef.saved) || 0) / avg).toFixed(1)} meses de gastos. Lo ideal son 3 a 6.`);
    }
  }
  return tips;
}

/* ---------- Ray ---------- */

const RAY_DEFAULT = { skin: 'lima', hat: null, eyes: null, neck: null, owned: [], spent: 0 };
const rayOf = L => ({ ...RAY_DEFAULT, ...((L && L.settings && L.settings.ray) || {}) });
const RAY_MOODS = { feliz: 'feliz', normal: 'tranquilo', preocupado: 'preocupado', dormido: 'te extraña' };

/** Ánimo de Ray según las finanzas de este mes (siempre el mes real, no el que se está mirando). */
function rayMoodFor(L) {
  if (!L || !L.transactions.length) return 'normal';
  const last = L.transactions.reduce((m, t) => t.date > m ? t.date : m, '');
  const days = Math.floor((Date.now() - parseDate(last).getTime()) / 864e5);
  if (days >= 7) return 'dormido';
  const ym = ymFromDate(new Date());
  const p = planFor(L, ym);
  let ing = 0, gas = 0;
  const spent = new Map();
  for (const t of L.transactions) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'ingreso') ing += bv(t);
    if (t.type === 'gasto') { gas += bv(t); spent.set(t.categoryId, (spent.get(t.categoryId) || 0) + bv(t)); }
  }
  const over = L.categories.some(c => c.type === 'gasto' && Number(c.budget) > 0 && (spent.get(c.id) || 0) > Number(c.budget));
  if (p.status === 'en-riesgo' || over || (ing > 0 && gas > ing)) return 'preocupado';
  if (p.status === 'cumpliendo' || p.status === 'cumplido') return 'feliz';
  return 'normal';
}

let rayTips = [], rayIdx = 0;

/** Ray en Inicio, con lo que tiene que decir. */
function rayCard(c, txs, ing, gas, byCat) {
  let tips = tipsFor(txs, ing, gas, byCat);
  let stage, title;
  if (c.kind === 'space') {
    const pair = c.space.members.slice(0, 3).map(m => {
      const L = m.me ? stores.personal : stores['user:' + m.uid];
      const r = rayOf(L);
      const name = m.me ? 'Tú' : firstName(m.name || m.email);
      const lvl = L ? (m.me ? myPoints().level : pointsFor(L).level) : null;
      return `<div class="ray-mini">${Ray.svg({ mood: L ? rayMoodFor(L) : 'normal', ...r })}<span>${esc(name)}${lvl ? ` · Nv. ${lvl}` : ''}</span></div>`;
    }).join('');
    stage = `<div class="ray-pair">${pair}</div>`;
    title = 'Los Rays de la casa';
    let saved = 0, target = 0;
    for (const m of c.space.members) {
      const L = m.me ? stores.personal : stores['user:' + m.uid];
      if (!L) continue;
      const p = planFor(L, ymFromDate(new Date()));
      if (p.status !== 'sin-plan') { saved += p.saved; target += p.target; }
    }
    if (target > 0) tips.unshift(saved >= target
      ? `¡Equipo! Juntos ya ahorraron <b>${esc(fmt(saved))}</b> y superaron su meta de ${esc(fmt(target))} este mes 🎉`
      : `Juntos llevan <b>${esc(fmt(saved))}</b> de ${esc(fmt(target))} de su meta de ahorro del mes. ¡Vamos!`);
  } else {
    const L = c.kind === 'personal' ? stores.personal : state;
    const mood = rayMoodFor(L);
    const r = rayOf(L);
    stage = `<button class="ray-stage" data-action="${c.kind === 'personal' ? 'ray-closet' : 'ray-partner'}" aria-label="Personalizar a Ray">${Ray.svg({ mood, ...r })}</button>`;
    const lvl = c.kind === 'personal' ? myPoints().level : pointsFor(L).level;
    title = c.kind === 'personal' ? `Ray <span>· Nv. ${lvl} · ${RAY_MOODS[mood]}</span>` : `Ray de ${esc(c.short)} <span>· Nv. ${lvl} · ${RAY_MOODS[mood]}</span>`;
    if (mood === 'dormido' && c.kind === 'personal') {
      const last = L.transactions.reduce((m, t) => t.date > m ? t.date : m, '');
      const d = Math.floor((Date.now() - parseDate(last).getTime()) / 864e5);
      tips.unshift(`¡Hola! Hace <b>${d} días</b> que no registras nada. ¿Me cuentas en qué gastaste? Toca <b>+</b> 💤`);
    }
    if (c.kind === 'personal') {
      const p = planFor(L, ymFromDate(new Date()));
      if (p.status === 'cumpliendo') tips.unshift(`¡Lo lograste! Ya ahorraste <b>${esc(fmt(p.saved))}</b> y superaste tu meta del mes 🎉`);
      else if (p.status === 'en-riesgo') tips.unshift(`Ojo: te pasaste <b>${esc(fmt(-p.canSpend))}</b> de lo que permite tu plan de ahorro. Frena los gustos este mes.`);
      // Lo primero que dice: los puntos nuevos
      const P = myPoints();
      const { gained, first } = newPointsSinceLastVisit(P.earned);
      if (gained > 0) {
        const latest = P.entries.find(e => e.ym) || P.entries[0];
        const why = first ? 'Por todo lo que ya llevas registrado.'
          : latest && gained <= latest.pts ? esc(latest.label) + '.'
          : 'Por tus logros y tu historial.';
        tips.unshift(`¡Ganaste <b>+${gained.toLocaleString('es')} puntos</b>! 🎉 ${why} Ya tienes <b>${P.available.toLocaleString('es')}</b> para gastar en mi armario.`);
        setTimeout(confetti, 350);
      }
    }
  }
  if (!tips.length) tips = ['¡Hola! Estoy aquí para ayudarte a cuidar tu dinero.'];
  rayTips = tips;
  rayIdx = 0;
  return `<div class="card ray-card">
    ${stage}
    <div class="ray-bubble" data-action="ray-next" role="button" tabindex="0">
      <div class="ray-name">${title}</div>
      <p id="rayMsg">${tips[0]}</p>
      ${tips.length > 1 ? `<span class="ray-more" id="rayMore">1/${tips.length} · toca para ver más</span>` : ''}
    </div>
  </div>`;
}

/* ---------- Armario de Ray ---------- */
let closetSlot = 'skin';

function rayOwned(r) {
  return new Set([...Ray.CATALOG.filter(i => i.price === 0).map(i => i.slot + ':' + i.id), ...(r.owned || [])]);
}

function saveRay(r) {
  const P = stores.personal;
  P.settings.ray = r;
  if (cloudOn()) window.Cloud.saveMeta('personal', P).catch(cloudFail);
  else if (P === state) save();
}

function renderCloset() {
  const r = rayOf(stores.personal);
  const owned = rayOwned(r);
  const points = myPoints().available;
  $('#closetPreview').innerHTML = Ray.svg({ mood: 'feliz', ...r });
  $('#closetPoints').innerHTML = `<b>${points.toLocaleString('es')}</b> puntos`;
  $('#closetTabs').innerHTML = Object.entries(Ray.SLOTS).map(([k, v]) =>
    `<button class="pill sm ${k === closetSlot ? 'active' : ''}" data-action="closet-slot" data-slot="${k}">${v}</button>`).join('');
  const items = Ray.CATALOG.filter(i => i.slot === closetSlot);
  const none = closetSlot === 'skin' ? '' : `
    <button class="closet-item ${!r[closetSlot] ? 'on' : ''}" data-action="closet-pick" data-slot="${closetSlot}" data-id="">
      <div class="ci-art">${Ray.svg({ mood: 'normal', ...r, [closetSlot]: null })}</div><span class="ci-name">Nada</span><span class="ci-state">${!r[closetSlot] ? 'Puesto' : ''}</span>
    </button>`;
  $('#closetGrid').innerHTML = none + items.map(it => {
    const key = it.slot + ':' + it.id;
    const have = owned.has(key);
    const on = r[it.slot] === it.id;
    const preview = { mood: 'normal', ...r, [it.slot]: it.id };
    return `<button class="closet-item ${on ? 'on' : ''} ${have ? '' : 'locked'}" data-action="closet-pick" data-slot="${it.slot}" data-id="${it.id}">
      <div class="ci-art">${Ray.svg(preview)}</div>
      <span class="ci-name">${esc(Ray.itemName(it))}</span>
      <span class="ci-state">${on ? 'Puesto' : have ? (it.price === 0 ? 'Regalo' : 'Tuyo') : points >= it.price ? `⚡ ${it.price} pts` : `🔒 ${it.price} pts`}</span>
    </button>`;
  }).join('');
}

function openCloset() {
  closetSlot = 'skin';
  renderCloset();
  $('#rayDialog').showModal();
}

function pickClosetItem(slot, id) {
  const r = rayOf(stores.personal);
  if (!id) { r[slot] = null; saveRay(r); renderCloset(); render(); return; }
  const it = Ray.CATALOG.find(i => i.slot === slot && i.id === id);
  if (!rayOwned(r).has(slot + ':' + id)) {
    const available = myPoints().available;
    if (available < it.price) {
      toast(`Te faltan ${(it.price - available).toLocaleString('es')} puntos para ${Ray.itemName(it)}. ¡Cumple tu plan para ganarlos! ⚡`);
      return;
    }
    if (!confirm(`¿Comprar «${Ray.itemName(it)}» por ${it.price} puntos?`)) return;
    r.owned = [...(r.owned || []), slot + ':' + id];
    r.spent = (Number(r.spent) || 0) + it.price;
    r[slot] = id;
    saveRay(r);
    renderCloset();
    render();
    confetti();
    toast(`¡Nuevo para Ray: ${Ray.itemName(it)}! 🎉`);
    return;
  }
  r[slot] = slot !== 'skin' && r[slot] === id ? null : id;
  saveRay(r);
  renderCloset();
  render();
}

function rule503020(txs, ing) {
  if (ing <= 0) return empty('Registra tus ingresos del mes para ver cómo se reparte tu dinero.');
  let nec = 0, gus = 0;
  for (const t of txs) {
    if (t.type !== 'gasto') continue;
    const g = catById(t.categoryId)?.group || 'gusto';
    if (g === 'necesidad') nec += bv(t);
    else if (g === 'gusto') gus += bv(t);
  }
  const aho = ing - nec - gus; // lo que no se gastó + lo enviado a "ahorro"
  const rows = [
    ['Necesidades', nec, 0.5, 'max'],
    ['Gustos', gus, 0.3, 'max'],
    ['Ahorro', aho, 0.2, 'min']
  ];
  return rows.map(([label, val, target, kind]) => {
    const p = val / ing;
    const ok = kind === 'max' ? p <= target : p >= target;
    const w = Math.max(0, Math.min(100, p * 100));
    return `<div class="rule-row">
      <div class="rule-head"><span>${label}</span><span class="${ok ? 'ok' : 'bad'}">${pct(p)} <small>/ meta ${pct(target)}</small></span></div>
      <div class="bar"><div class="fill ${ok ? '' : 'over'}" style="width:${w}%"></div><div class="target" style="left:${target * 100}%"></div></div>
      <small>${esc(fmt(val))} · ideal ${kind === 'max' ? 'máx.' : 'mín.'} ${esc(fmt(ing * target))}</small>
    </div>`;
  }).join('');
}

function trendChart() {
  const months = lastMonths(6);
  const data = months.map(ym => ({ ym, ...totals(monthTx(ym)) }));
  if (!data.some(d => d.ing || d.gas)) return empty('Aún no hay datos para mostrar la tendencia.');
  const max = Math.max(1, ...data.flatMap(d => [d.ing, d.gas]));
  const W = 320, H = 150, bottom = 20, top = 8, bw = 13;
  const slot = W / months.length;
  const h = v => (v / max) * (H - bottom - top);
  const bars = data.map((d, i) => {
    const x = i * slot + slot / 2;
    const hi = h(d.ing), hg = h(d.gas);
    return `<rect class="bar-ing" x="${x - bw - 1}" y="${H - bottom - hi}" width="${bw}" height="${hi}" rx="3"><title>Ingresos ${esc(fmt(d.ing))}</title></rect>
      <rect class="bar-gas" x="${x + 1}" y="${H - bottom - hg}" width="${bw}" height="${hg}" rx="3"><title>Gastos ${esc(fmt(d.gas))}</title></rect>
      <text class="axis" x="${x}" y="${H - 5}" text-anchor="middle">${esc(monthName(d.ym, { month: 'short' }).replace('.', ''))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Ingresos y gastos de los últimos 6 meses">
    <line class="base" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>${bars}</svg>
    <div class="legend-inline"><span><i class="dot" style="background:var(--ing)"></i>Ingresos</span><span><i class="dot" style="background:var(--gas)"></i>Gastos</span></div>`;
}

function renderInicio() {
  const txs = monthTx(currentYM);
  const { ing, gas, bal } = totals(txs);
  const rate = ing > 0 ? bal / ing : null;
  const byCat = spendingByCategory(txs);
  const balances = accountBalances();
  const totalBal = sum(state.accounts.map(a => toBase(balances[a.id] || 0, accCur(state, a.id))));
  const rateCls = rate === null ? '' : rate >= 0.2 ? 'ing' : rate < 0 ? 'gas' : '';

  const sign = bal > 0 ? '+' : bal < 0 ? '−' : '';
  const quick = (type, label, icon) =>
    `<button class="q" data-action="quick" data-type="${type}"><span class="q-ico">${icon}</span>${label}</button>`;

  const c = currentCtx();
  const heroLabel = c.kind === 'personal' ? 'Patrimonio total' : c.kind === 'space' ? `Patrimonio · ${esc(c.short)}` : `Patrimonio de ${esc(c.short)}`;
  const invites = c.kind === 'personal' ? sharing.invites.map(i => `
    <div class="card invite-banner">
      <div class="grow"><b>${esc(i.from)}</b> te invitó a llevar las finanzas juntos en <b>«${esc(i.name)}»</b></div>
      <button class="btn small primary" data-action="goto" data-view="ajustes">Ver</button>
    </div>`).join('') : '';

  $('#view-inicio').innerHTML = `
    ${invites}
    <section class="hero">
      <div class="hero-label">${heroLabel}
        <button class="eye" data-action="toggle-hide" aria-label="${hideAmounts ? 'Mostrar' : 'Ocultar'} montos">${hideAmounts ? ICONS.eyeOff : ICONS.eye}</button>
      </div>
      <div class="hero-value ${totalBal < 0 ? 'gas' : ''}">${esc(fmt(totalBal))}</div>
      <div class="hero-sub">Balance de ${esc(monthName(currentYM, { month: 'long' }).toLowerCase())}
        <span class="chip ${bal >= 0 ? 'chip-up' : 'chip-down'}">${sign}${esc(fmt(Math.abs(bal)))}${rate !== null && !hideAmounts ? ` · ${pct(rate)}` : ''}</span>
      </div>
    </section>
    <div class="quick">
      ${quick('gasto', 'Gasto', ICONS.out)}
      ${quick('ingreso', 'Ingreso', ICONS.in)}
      ${quick('transferencia', 'Transferir', ICONS.swap)}
      <button class="q" data-action="goto" data-view="metas"><span class="q-ico">${ICONS.flag}</span>Metas</button>
    </div>
    ${rayCard(c, txs, ing, gas, byCat)}
    <div class="stats">
      ${stat('Ingresos', fmtS(ing), 'ing')}
      ${stat('Gastos', fmtS(gas), 'gas')}
      ${stat('Ahorro', rate === null ? '—' : pct(rate), rateCls)}
    </div>
    ${c.kind === 'space' ? couplePlansCard(c.space) : planCard(state, { who: c.kind === 'partner' ? c.short : null, editable: c.kind === 'personal' })}
    ${upcomingCard()}
    <div class="card">
      <div class="card-head"><h2>${c.kind === 'personal' ? 'Mis cuentas' : 'Cuentas'}</h2>${isReadOnly() ? '' : `<button class="link" data-action="goto" data-view="ajustes">Gestionar ${ICONS.chevron}</button>`}</div>
      ${state.accounts.length ? state.accounts.map((a, i) => {
        const v = balances[a.id] || 0;
        const cur = accCur(state, a.id);
        const vb = toBase(v, cur);
        const share = [cur !== baseCur(state) ? `≈ ${fmt(vb)}` : '', totalBal > 0 && vb > 0 ? pct(vb / totalBal) + ' del total' : ''].filter(Boolean).join(' · ');
        return `<div class="asset">
          <span class="avatar" style="--c:${PALETTE[i % PALETTE.length]}">${esc((a.name || '?').trim().charAt(0).toUpperCase())}</span>
          <div class="grow"><div class="asset-name">${esc(a.name)}</div><div class="asset-sub">${esc(share)}</div></div>
          <div class="amt ${v < 0 ? 'gas' : ''}">${esc(fmtC(v, cur))}</div>
        </div>`;
      }).join('') : empty('No tienes cuentas. Agrégalas en Ajustes.')}
    </div>
    ${c.kind === 'space' ? contributionsCard(c.space, txs) : ''}
    <div class="card">
      <h2>Gastos por categoría</h2>
      ${byCat.length ? `<div class="donut-wrap">${donut(byCat, gas)}
        <ul class="legend">${byCat.map(b => `<li><i class="dot" style="background:${safeColor(b.cat.color)}"></i>
          <span class="name">${esc(b.cat.name)}</span><span class="amt">${esc(fmt(b.value))}</span><span class="pc">${pct(b.value / gas)}</span></li>`).join('')}</ul></div>`
        : empty('Aún no hay gastos este mes.')}
    </div>
    <div class="card"><h2>Regla 50/30/20</h2>${rule503020(txs, ing)}</div>
    <div class="card"><h2>Últimos 6 meses</h2>${trendChart()}</div>`;
}

/** Cuánto registró cada integrante del espacio este mes. */
function contributionsCard(sp, txs) {
  const rows = sp.members.map((m, i) => {
    const mine = txs.filter(t => t.createdBy?.uid === m.uid);
    const t = totals(mine);
    const name = m.me ? 'Tú' : firstName(m.name || m.email);
    return `<div class="asset">
      <span class="avatar" style="--c:${PALETTE[(i + 3) % PALETTE.length]}">${esc(name.charAt(0).toUpperCase())}</span>
      <div class="grow"><div class="asset-name">${esc(name)}</div><div class="asset-sub">${mine.length} movimiento${mine.length === 1 ? '' : 's'}</div></div>
      <div class="contrib"><span class="ing">+${esc(fmt(t.ing))}</span><span class="gas">−${esc(fmt(t.gas))}</span></div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>Aportes del mes</h2>${rows}</div>`;
}

/* ---------- Vista: Movimientos ---------- */

function renderMovimientos() {
  const q = txFilter.q.trim().toLowerCase();
  const all = monthTx(currentYM);
  const list = all
    .filter(t => txFilter.type === 'todos' || t.type === txFilter.type)
    .filter(t => {
      if (!q) return true;
      const hay = [t.note, catById(t.categoryId)?.name, accById(t.accountId)?.name, accById(t.toAccountId)?.name]
        .join(' ').toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  const { ing, gas } = totals(list);
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }

  const row = t => {
    let title, sub, cls, sign, color;
    if (t.type === 'transferencia') {
      title = 'Transferencia';
      sub = `${accById(t.accountId)?.name || '?'} → ${accById(t.toAccountId)?.name || '?'}`;
      cls = 'tr'; sign = ''; color = '#94a3b8';
    } else {
      const c = catById(t.categoryId);
      title = c?.name || 'Sin categoría';
      sub = accById(t.accountId)?.name || '';
      cls = t.type === 'ingreso' ? 'ing' : 'gas';
      sign = t.type === 'ingreso' ? '+' : '−';
      color = c?.color;
    }
    if (t.note) sub = `${t.note} · ${sub}`;
    if (isSpace() && t.createdBy) sub += ` · ${t.createdBy.uid === window.Cloud?.uid ? 'tú' : firstName(t.createdBy.name)}`;
    return `<button class="tx" data-id="${esc(t.id)}">
      <i class="dot" style="--dot-c:${safeColor(color)}"></i>
      <div class="tx-main"><div class="tx-title">${esc(title)}</div><div class="tx-sub">${esc(sub)}</div></div>
      <div class="tx-amt ${cls}">${sign}${esc(fmtC(t.amount, accCur(state, t.accountId)))}</div></button>`;
  };

  $('#txList').innerHTML = list.length
    ? `<div class="summary-line"><span>${list.length} movimiento${list.length === 1 ? '' : 's'}</span>
         <span class="ing">+${esc(fmt(ing))}</span><span class="gas">−${esc(fmt(gas))}</span></div>
       ${[...groups.entries()].map(([date, txs]) =>
          `<div class="day-head">${esc(cap(dayName(date)))}</div><div class="tx-group">${txs.map(row).join('')}</div>`).join('')}`
    : `<div class="card">${empty(all.length ? 'Ningún movimiento coincide con el filtro.' : 'No hay movimientos en este mes. Toca <b>+</b> para agregar uno.')}</div>`;
}

/* ---------- Vista: Presupuesto ---------- */

let budgetTab = 'presupuesto';
function budgetTabs() {
  const tabs = [['presupuesto', 'Presupuesto'], ['fijos', 'Pagos fijos']];
  if (typeof reportsSection === 'function') tabs.push(['reportes', 'Reportes']);
  return `<div class="pills subtabs">${tabs.map(([k, v]) => `<button class="pill ${budgetTab === k ? 'active' : ''}" data-action="budget-tab" data-tab="${k}">${v}</button>`).join('')}</div>`;
}

function renderPresupuesto() {
  if (budgetTab === 'fijos') { $('#view-presupuesto').innerHTML = budgetTabs() + recurringSection(); return; }
  if (budgetTab === 'reportes' && typeof reportsSection === 'function') { $('#view-presupuesto').innerHTML = budgetTabs() + reportsSection(); return; }
  const txs = monthTx(currentYM);
  const { ing } = totals(txs);
  const status = budgetStatus(txs);
  const totalBudget = sum(status.map(s => s.budget));
  const totalSpent = sum(status.map(s => s.spent));
  const base = ing;

  const byGroup = { necesidad: 0, gusto: 0, ahorro: 0 };
  for (const s of status) byGroup[s.cat.group || 'gusto'] += s.budget;

  $('#view-presupuesto').innerHTML = `
    ${budgetTabs()}
    <div class="card">
      <h2>Resumen del mes</h2>
      <div class="rows">
        <div class="row"><span class="grow">Presupuestado</span><span class="amt">${esc(fmt(totalBudget))}</span></div>
        <div class="row"><span class="grow">Gastado</span><span class="amt ${totalBudget && totalSpent > totalBudget ? 'gas' : ''}">${esc(fmt(totalSpent))}</span></div>
        <div class="row"><span class="grow">Ingresos del mes</span><span class="amt ing">${esc(fmt(ing))}</span></div>
      </div>
      ${base > 0 ? `<p class="muted" style="margin:12px 0 0;font-size:.88rem">Según la regla 50/30/20, con tus ingresos de este mes:</p>
      <div class="suggest">
        <div><small>Necesidades (50%)</small><b>${esc(fmtS(base * .5))}</b><small>Presup.: ${esc(fmt(byGroup.necesidad))}</small></div>
        <div><small>Gustos (30%)</small><b>${esc(fmtS(base * .3))}</b><small>Presup.: ${esc(fmt(byGroup.gusto))}</small></div>
        <div><small>Ahorro (20%)</small><b>${esc(fmtS(base * .2))}</b><small>Presup.: ${esc(fmt(byGroup.ahorro))}</small></div>
      </div>` : ''}
    </div>
    <div class="card">
      <h2>Límite mensual por categoría</h2>
      <p class="muted" style="margin:-6px 0 4px;font-size:.85rem">Escribe cuánto quieres gastar como máximo cada mes. Deja 0 para no poner límite.</p>
      ${status.map(s => {
        const p = s.budget > 0 ? s.spent / s.budget : 0;
        const cls = p > 1 ? 'over' : p > 0.85 ? 'warn' : '';
        const left = s.budget - s.spent;
        return `<div class="budget-item">
          <div class="budget-top">
            <i class="dot" style="background:${safeColor(s.cat.color)}"></i>
            <span class="name">${esc(s.cat.name)}</span>
            <span class="tag">${GROUPS[s.cat.group] || 'Gusto'}</span>
            <input type="number" min="0" step="0.01" inputmode="decimal" data-budget="${esc(s.cat.id)}"
              value="${s.budget || ''}" placeholder="0" aria-label="Presupuesto de ${esc(s.cat.name)}" ${isReadOnly() ? 'disabled' : ''}>
          </div>
          ${s.budget > 0 ? `<div class="bar"><div class="fill ${cls}" style="width:${Math.min(100, p * 100)}%"></div></div>
            <small>Gastado ${esc(fmt(s.spent))} de ${esc(fmt(s.budget))} · ${left >= 0 ? `quedan ${esc(fmt(left))}` : `<span class="bad">excedido por ${esc(fmt(-left))}</span>`}</small>`
            : s.spent > 0 ? `<small>Gastado ${esc(fmt(s.spent))} · sin límite</small>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

/* ---------- Vista: Metas ---------- */

function renderMetas() {
  const avg = avgMonthlyExpenses();
  const c = currentCtx();
  const planBlock = c.kind === 'personal' ? planSettingsCard() + pointsCard()
    : c.kind === 'partner' ? planCard(state, { who: c.short })
    : `<div class="card ledger-note">${ICONS.users}<div>Cada integrante configura su plan de ahorro en <b>sus finanzas personales</b> (selector <b>Yo</b>). Aquí, en Inicio, ven los planes de los dos.</div></div>`;
  $('#view-metas').innerHTML = `
    ${planBlock}
    <div class="card">
      <h2>Fondo de emergencia recomendado</h2>
      ${avg > 0 ? `<p class="muted" style="margin:0 0 8px;font-size:.9rem">Gastas en promedio <b>${esc(fmt(avg))}</b> al mes (sin contar ahorro).</p>
        <div class="suggest">
          <div><small>Mínimo (1 mes)</small><b>${esc(fmtS(avg))}</b></div>
          <div><small>Bueno (3 meses)</small><b>${esc(fmtS(avg * 3))}</b></div>
          <div><small>Ideal (6 meses)</small><b>${esc(fmtS(avg * 6))}</b></div>
        </div>`
        : empty('Registra tus gastos y aquí te diremos cuánto deberías tener en tu fondo de emergencia.')}
    </div>
    <div class="card">
      <div class="card-head"><h2>Mis metas</h2><button class="btn small primary" data-action="new-goal">+ Nueva meta</button></div>
      ${state.goals.length ? state.goals.map(g => {
        const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
        const p = target > 0 ? saved / target : 0;
        let extra = '';
        if (g.deadline && target > saved) {
          const now = new Date(), end = parseDate(g.deadline);
          const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
          extra = months > 0 ? ` · ahorra ${esc(fmt((target - saved) / months))}/mes para llegar` : ' · <span class="bad">fecha vencida</span>';
        }
        return `<div class="goal">
          <div class="goal-head"><b>${esc(g.name)}</b><span>${target > 0 ? pct(p) : ''}</span></div>
          <div class="bar"><div class="fill ${p >= 1 ? '' : ''}" style="width:${Math.min(100, p * 100)}%"></div></div>
          <small>${esc(fmt(saved))} de ${target > 0 ? esc(fmt(target)) : '<i>sin objetivo definido</i>'}${p >= 1 ? ' · 🎉 ¡Meta cumplida!' : ''}${extra}</small>
          <div class="goal-actions">
            <button class="btn small" data-action="deposit" data-id="${esc(g.id)}">Abonar / retirar</button>
            <button class="btn small ghost" data-action="edit-goal" data-id="${esc(g.id)}">Editar</button>
          </div>
        </div>`;
      }).join('') : empty('Crea una meta: un viaje, un fondo de emergencia, pagar una deuda…')}
    </div>`;
}

/* ---------- Vista: Ajustes ---------- */

function renderAjustes() {
  const used = new Set();
  for (const t of state.transactions) { used.add(t.categoryId); used.add(t.accountId); used.add(t.toAccountId); }

  const catRows = type => state.categories.filter(c => c.type === type).map(c => `
    <div class="set-row">
      <input type="color" value="${safeColor(c.color)}" data-cat-color="${esc(c.id)}" aria-label="Color">
      <input type="text" value="${esc(c.name)}" data-cat-name="${esc(c.id)}" maxlength="40" aria-label="Nombre">
      ${type === 'gasto' ? `<select data-cat-group="${esc(c.id)}" aria-label="Tipo de gasto">
        ${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${c.group === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>` : ''}
      <button class="icon-btn" data-action="del-cat" data-id="${esc(c.id)}" aria-label="Eliminar" title="${used.has(c.id) ? 'En uso' : 'Eliminar'}">✕</button>
    </div>`).join('');

  const user = window.Cloud?.user;
  const accountCard = user
    ? `<div class="card">
        <div class="card-head"><h2>Mi cuenta</h2><button class="btn small" data-action="logout">Cerrar sesión</button></div>
        <div class="rows">
          ${user.displayName ? `<div class="row"><span class="grow muted">Nombre</span><span>${esc(user.displayName)}</span></div>` : ''}
          <div class="row"><span class="grow muted">Correo</span><span>${esc(user.email || '—')}</span></div>
          <div class="row"><span class="grow muted">Datos</span><span class="ok">Sincronizados en la nube</span></div>
        </div>
      </div>`
    : `<div class="card">
        <h2>Cuenta</h2>
        <p class="muted" style="margin:0;font-size:.88rem">Estás en <b>modo local</b>: los datos solo existen en este dispositivo.
        Para tener inicio de sesión y guardar las finanzas de varias personas en la nube, configura Firebase siguiendo el README.</p>
      </div>`;

  const theme = getTheme();
  const themeCard = `<div class="card">
      <h2>Apariencia</h2>
      <div class="pills">
        ${[['dark', 'Oscuro'], ['light', 'Claro'], ['system', 'Sistema']].map(([k, v]) =>
          `<button class="pill ${theme === k ? 'active' : ''}" data-action="theme" data-theme="${k}">${v}</button>`).join('')}
      </div>
    </div>`;

  const c = currentCtx();
  const ledgerTitle = c.kind === 'space'
    ? `<div class="card ledger-note">${ICONS.users}<div>Estás editando <b>«${esc(c.short)}»</b>. Los cambios de moneda, cuentas y categorías aplican para todos sus integrantes.</div></div>`
    : '';

  if (c.kind === 'partner') {
    $('#view-ajustes').innerHTML = `
      ${accountCard}
      ${sharingCard()}
      ${themeCard}
      <div class="card ledger-note">${ICONS.eyeSm}<div>Estás viendo las finanzas de <b>${esc(c.short)}</b> en modo solo lectura. Para cambiar sus ajustes debe hacerlo esa persona.</div></div>`;
    return;
  }

  $('#view-ajustes').innerHTML = `
    ${accountCard}
    ${sharingCard()}
    ${themeCard}
    ${ledgerTitle}
    <div class="card">
      <h2>Moneda principal</h2>
      <p class="muted" style="margin:-6px 0 4px;font-size:.85rem">En esta moneda se calculan el patrimonio, el plan, los presupuestos y los reportes.</p>
      <div class="set-row">
        <input type="text" id="currencyInput" list="currencies" value="${esc(state.settings.currency)}" maxlength="6" style="text-transform:uppercase">
        <datalist id="currencies">
          ${['USD', 'EUR', 'VES', 'COP', 'MXN', 'ARS', 'PEN', 'CLP', 'DOP', 'BRL', 'USDT'].map(c => `<option value="${c}">`).join('')}
        </datalist>
        <span class="muted" style="font-size:.85rem">Ej: ${esc(fmt(1234.5))}</span>
      </div>
      ${ratesBlock()}
    </div>

    <div class="card">
      <div class="card-head"><h2>Cuentas</h2><button class="btn small" data-action="add-acc">+ Agregar</button></div>
      <p class="muted" style="margin:-6px 0 4px;font-size:.85rem">Nombre, moneda y saldo inicial de cada cuenta (efectivo, banco, USDT…).</p>
      ${state.accounts.map(a => `
        <div class="set-row">
          <input type="text" value="${esc(a.name)}" data-acc-name="${esc(a.id)}" maxlength="40" aria-label="Nombre de la cuenta">
          <input type="text" class="cur-input" list="currencies" value="${esc(accCur(state, a.id))}" data-acc-cur="${esc(a.id)}" maxlength="6" aria-label="Moneda de la cuenta">
          <input type="number" step="0.01" value="${Number(a.initial) || 0}" data-acc-initial="${esc(a.id)}" aria-label="Saldo inicial">
          <button class="icon-btn" data-action="del-acc" data-id="${esc(a.id)}" aria-label="Eliminar">✕</button>
        </div>`).join('')}
    </div>

    <div class="card">
      <div class="card-head"><h2>Categorías</h2></div>
      <div class="subhead">Gastos</div>
      ${catRows('gasto')}
      <button class="btn small" data-action="add-cat" data-type="gasto" style="margin-top:8px">+ Categoría de gasto</button>
      <div class="subhead">Ingresos</div>
      ${catRows('ingreso')}
      <button class="btn small" data-action="add-cat" data-type="ingreso" style="margin-top:8px">+ Categoría de ingreso</button>
    </div>

    <div class="card">
      <h2>Tus datos</h2>
      <p class="muted" style="margin:-4px 0 12px;font-size:.88rem">${user
        ? 'Tus datos están guardados en tu cuenta y puedes verlos desde cualquier dispositivo. Igual puedes descargar un respaldo cuando quieras.'
        : 'Tus datos se guardan <b>solo en este dispositivo</b>. Exporta un respaldo de vez en cuando para no perderlos o para pasarlos a otro dispositivo.'}</p>
      <div class="btn-grid">
        <button class="btn" data-action="export-json">⬇️ Exportar respaldo</button>
        <button class="btn" data-action="import-json">⬆️ Importar respaldo</button>
        <button class="btn" data-action="export-csv">📊 Exportar a Excel (CSV)</button>
        ${c.kind === 'personal' ? '<button class="btn" data-action="demo">🧪 Cargar datos de ejemplo</button>' : ''}
        <button class="btn danger" data-action="reset">🗑️ Borrar todo</button>
      </div>
    </div>
    <p class="muted" style="text-align:center;font-size:.8rem">RayFin · ${state.transactions.length} movimientos guardados</p>`;
}

/** Tasas de cambio de las monedas de las cuentas. */
function ratesBlock() {
  const base = baseCur(state);
  const curs = otherCurrencies(state);
  if (!curs.length) return `<p class="muted" style="margin:10px 0 0;font-size:.82rem">¿Tienes cuentas en otra moneda (por ejemplo USDT o bolívares)? Cámbiale la moneda a la cuenta abajo y aquí podrás poner su tasa.</p>`;
  const rows = curs.map(c => {
    const v = rateOf(state, c);
    // Mostrar siempre "1 moneda fuerte = X moneda débil"
    const STRONG = new Set(['USD', 'USDT', 'USDC', 'EUR', 'GBP', 'CHF']);
    const inv = v !== null ? v < 1 : (STRONG.has(base) && !STRONG.has(c));
    const shown = v === null ? '' : round2(inv ? 1 / v : v);
    return `<div class="rate-row">
      <span>1 ${esc(inv ? base : c)} =</span>
      <input type="number" min="0" step="0.0001" inputmode="decimal" value="${shown}" data-rate="${esc(c)}" data-inv="${inv ? 1 : ''}" placeholder="?" aria-label="Tasa de ${esc(c)}">
      <span>${esc(inv ? c : base)}</span>
      ${v === null ? '<span class="bad" style="font-size:.78rem">falta la tasa</span>' : ''}
    </div>`;
  }).join('');
  const upd = state.settings.ratesUpdated ? `Actualizado: ${esc(new Date(state.settings.ratesUpdated).toLocaleString('es'))}` : '';
  return `<div class="subhead">Tasas de cambio</div>
    ${rows}
    <div class="row-actions" style="margin-top:8px;align-items:center">
      <button class="btn small" data-action="rates-fetch">Traer tasas de internet</button>
      <span class="muted" style="font-size:.76rem">${upd}</span>
    </div>
    <p class="muted" style="margin:8px 0 0;font-size:.76rem">Cada movimiento guarda la tasa del día en que lo registras. El patrimonio usa la tasa actual. USDT se toma igual al dólar.</p>`;
}

/** Trae tasas oficiales de internet (USDT = USD). */
async function fetchRates() {
  const base = baseCur(state);
  const lookupBase = base === 'USDT' ? 'USD' : base;
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(lookupBase)}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error('sin datos');
  const rates = { ...(state.settings.rates || {}) };
  let n = 0;
  for (const c of otherCurrencies(state)) {
    const key = c === 'USDT' ? 'USD' : c;
    const per = key === lookupBase ? 1 : data.rates[key]; // unidades de c por 1 moneda principal
    if (per > 0) { rates[c] = 1 / per; n++; }
  }
  state.settings.rates = rates;
  state.settings.ratesUpdated = Date.now();
  return n;
}

/** Tarjeta para invitar, aceptar invitaciones y gestionar espacios compartidos. */
function sharingCard() {
  if (!window.Cloud?.user) {
    return CLOUD_ENABLED ? '' : `<div class="card"><h2>Finanzas compartidas</h2>
      <p class="muted" style="margin:0;font-size:.88rem">Para compartir finanzas con tu pareja necesitas el modo con cuentas (Firebase).</p></div>`;
  }
  const appUrl = location.origin + location.pathname;
  const inv = sharing.invites.map(i => `
    <div class="share-block invite">
      <div><b>${esc(i.from)}</b> te invitó a <b>«${esc(i.name)}»</b></div>
      <label class="check"><input type="checkbox" id="share-inv-${esc(i.id)}" checked><span>Que también pueda ver mis finanzas personales (solo lectura)</span></label>
      <div class="row-actions">
        <button class="btn small primary" data-action="accept-invite" data-id="${esc(i.id)}">Aceptar</button>
        <button class="btn small ghost" data-action="decline-invite" data-id="${esc(i.id)}">Rechazar</button>
      </div>
    </div>`).join('');

  const spaces = sharing.spaces.map(sp => {
    const others = sp.members.filter(m => !m.me);
    const status = others.map(m => {
      const p = sharing.partners.find(x => x.uid === m.uid);
      const n = esc(firstName(m.name || m.email));
      if (p?.status === 'ok') return `<div class="share-status ok">${ICONS.eyeSm}<span>${n} comparte contigo sus finanzas personales</span><button class="link" data-action="ctx" data-key="user:${esc(m.uid)}">Ver</button></div>`;
      if (p?.status === 'denied') return `<div class="share-status">${ICONS.eyeSm}<span>${n} no comparte sus finanzas personales</span></div>`;
      return '';
    }).join('');
    const pending = sp.invitedEmails.map(e => {
      const msg = encodeURIComponent(`Te invité a RayFin para llevar nuestras finanzas juntos 💸\nEntra con este correo: ${e}\n${appUrl}`);
      return `<div class="member pending"><span class="grow">${esc(e)} · <i>pendiente</i></span>
        <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${msg}">Avisar por WhatsApp</a>
        <button class="icon-btn" data-action="cancel-invite" data-id="${esc(sp.id)}" data-email="${esc(e)}" aria-label="Cancelar invitación">✕</button></div>`;
    }).join('');
    return `<div class="share-block">
      <div class="space-head"><b>${ICONS.users} ${esc(sp.name)}</b>
        <button class="btn small" data-action="ctx" data-key="space:${esc(sp.id)}">Abrir</button></div>
      <div class="members">${sp.members.map((m, i) => `<span class="chip-member"><span class="avatar sm" style="--c:${PALETTE[(i + 3) % PALETTE.length]}">${esc((m.me ? 'T' : (m.name || m.email || '?')).charAt(0).toUpperCase())}</span>${esc(m.me ? 'Tú' : firstName(m.name || m.email))}</span>`).join('')}</div>
      ${pending}
      ${status}
      <label class="check"><input type="checkbox" data-share-space="${esc(sp.id)}" ${sp.iShare ? 'checked' : ''}><span>Los integrantes pueden ver mis finanzas personales (solo lectura)</span></label>
      <div class="inline-form">
        <input type="email" id="inv-${esc(sp.id)}" placeholder="Invitar a otro correo" autocomplete="off">
        <button class="btn small" data-action="invite-more" data-id="${esc(sp.id)}">Invitar</button>
      </div>
      <button class="link danger-link" data-action="leave-space" data-id="${esc(sp.id)}">Salir de este espacio</button>
    </div>`;
  }).join('');

  const create = `
    <div class="share-block create">
      <div class="subhead" style="margin-top:0">${sharing.spaces.length ? 'Nuevo espacio compartido' : 'Lleva las finanzas en pareja'}</div>
      ${sharing.spaces.length ? '' : '<p class="muted" style="margin:0 0 10px;font-size:.88rem">Crea un espacio para registrar juntos los gastos e ingresos comunes. Tus finanzas personales siguen siendo tuyas.</p>'}
      <input type="text" id="newSpaceName" placeholder="Nombre del espacio (ej: Casa)" maxlength="40" autocomplete="off">
      <input type="email" id="newSpaceEmail" placeholder="Correo de tu pareja (con el que entra a RayFin)" autocomplete="off">
      <label class="check"><input type="checkbox" id="newSpaceShare" checked><span>Que pueda ver mis finanzas personales (solo lectura)</span></label>
      <button class="btn primary" data-action="create-space">Crear e invitar</button>
    </div>`;

  return `<div class="card" id="sharingCard"><h2>Finanzas compartidas</h2>${inv}${spaces}${create}</div>`;
}

/* ---------- Diálogo de movimientos ---------- */

const txDialog = $('#txDialog');
const txForm = $('#txForm');
let editingTxId = null;
let editingRecId = null; // editando un pago fijo (plantilla), no un movimiento
let lastAccountId = null;

function fillSelect(sel, items, selected) {
  sel.innerHTML = items.map(i => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function syncTxForm(keep = {}) {
  const type = txForm.type.value;
  const isTr = type === 'transferencia';
  $('#catField').hidden = isTr;
  $('#toAccountField').hidden = !isTr;
  $('#accountLabel').textContent = isTr ? 'Desde la cuenta' : 'Cuenta';
  if (!isTr) {
    const cats = state.categories.filter(c => c.type === type);
    fillSelect(txForm.categoryId, cats, keep.categoryId);
  }
  const accLabel = a => ({ id: a.id, name: otherCurrencies(state).length ? `${a.name} · ${accCur(state, a.id)}` : a.name });
  fillSelect(txForm.accountId, state.accounts.map(accLabel), keep.accountId ?? lastAccountId ?? state.accounts[0]?.id);
  const to = keep.toAccountId ?? state.accounts.find(a => a.id !== txForm.accountId.value)?.id;
  fillSelect(txForm.toAccountId, state.accounts.map(accLabel), to);
  if (keep.toAmount) txForm.toAmount.value = keep.toAmount;
  updateAmountHints();
}

/** Muestra la moneda del monto, su equivalente y (en transferencias entre monedas) cuánto llega. */
function updateAmountHints() {
  const cur = accCur(state, txForm.accountId.value);
  const base = baseCur(state);
  const amount = Number(txForm.amount.value) || 0;
  $('#amountCur').textContent = otherCurrencies(state).length || cur !== base ? cur : '';
  const r = rateOf(state, cur);
  $('#amountHint').textContent = cur !== base && amount > 0
    ? (r ? `≈ ${fmt(amount * r)}` : `Falta la tasa de ${cur} en Ajustes`) : '';
  const isTr = txForm.type.value === 'transferencia';
  const toCur = accCur(state, txForm.toAccountId.value);
  const diff = isTr && toCur !== cur;
  $('#toAmountField').hidden = !diff;
  $('#toAmountCur').textContent = toCur;
  if (diff && !txForm.toAmount.dataset.touched) {
    const rf = rateOf(state, cur), rt = rateOf(state, toCur);
    txForm.toAmount.value = amount > 0 && rf && rt ? round2(amount * rf / rt) : '';
  }
}

function openTx(tx = null, type = 'gasto', rec = null) {
  if (!state.accounts.length) {
    toast('Primero crea una cuenta en Ajustes.');
    setView('ajustes');
    return;
  }
  editingRecId = rec?.id || null;
  if (rec) tx = { ...rec, date: rec.next };
  editingTxId = rec ? null : tx?.id || null;
  txForm.reset();
  $('#txTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#txDelete').hidden = !tx;
  txForm.type.value = tx?.type || type;
  syncTxForm(tx || {});
  txForm.toAmount.dataset.touched = tx?.toAmount ? '1' : '';
  txForm.amount.value = tx ? tx.amount : '';
  if (tx?.toAmount) txForm.toAmount.value = tx.toAmount;
  txForm.date.value = tx?.date || (currentYM === ymFromDate(new Date()) ? todayStr() : currentYM + '-01');
  txForm.note.value = tx?.note || '';
  // Repetir: al crear, o al editar un pago fijo
  $('#repeatField').hidden = !!editingTxId;
  txForm.repeat.value = rec ? rec.freq : '';
  txForm.auto.checked = rec ? !!rec.auto : true;
  $('#autoField').hidden = !txForm.repeat.value;
  $('#dateLabel').textContent = rec ? 'Próxima fecha' : 'Fecha';
  if (rec) { $('#txTitle').textContent = 'Editar pago fijo'; $('#txDelete').hidden = true; }
  txDialog.showModal();
  if (!tx) setTimeout(() => txForm.amount.focus(), 50);
}

txForm.addEventListener('change', e => {
  if (e.target.name === 'repeat') $('#autoField').hidden = !txForm.repeat.value;
  if (e.target.name === 'type') syncTxForm({ accountId: txForm.accountId.value });
  else if (['accountId', 'toAccountId'].includes(e.target.name)) { txForm.toAmount.dataset.touched = ''; updateAmountHints(); }
});
txForm.addEventListener('input', e => {
  if (e.target.name === 'amount') updateAmountHints();
  if (e.target.name === 'toAmount') txForm.toAmount.dataset.touched = '1';
});

txForm.addEventListener('submit', e => {
  e.preventDefault();
  const type = txForm.type.value;
  const amount = round2(parseFloat(txForm.amount.value));
  if (!(amount > 0)) { toast('Escribe un monto mayor que cero.'); return; }
  if (!txForm.date.value) { toast('Elige una fecha.'); return; }
  const data = {
    type,
    amount,
    date: txForm.date.value,
    accountId: txForm.accountId.value,
    note: txForm.note.value.trim()
  };
  // Tasa del día si la cuenta está en otra moneda
  const cur = accCur(state, data.accountId);
  if (cur !== baseCur(state)) {
    const r = rateOf(state, cur);
    if (!r) { toast(`Primero pon la tasa de ${cur} en Ajustes.`); return; }
    data.fx = r;
  }
  if (type === 'transferencia') {
    data.toAccountId = txForm.toAccountId.value;
    if (data.toAccountId === data.accountId) { toast('Elige dos cuentas distintas.'); return; }
    if (accCur(state, data.toAccountId) !== cur) {
      const toAmount = round2(parseFloat(txForm.toAmount.value));
      if (!(toAmount > 0)) { toast('Escribe cuánto llega a la otra cuenta.'); return; }
      data.toAmount = toAmount;
    }
  } else {
    data.categoryId = txForm.categoryId.value;
    if (!data.categoryId) { toast('Crea una categoría primero en Ajustes.'); return; }
  }
  // Pago fijo: plantilla (y el primer movimiento si es nuevo)
  const freq = txForm.repeat.value;
  if (editingRecId || freq) {
    const day = Number(data.date.slice(8, 10));
    const tpl = { type: data.type, amount: data.amount, accountId: data.accountId, note: data.note, freq: freq || 'mensual', day, auto: txForm.auto.checked, active: true };
    if (data.type === 'transferencia') { tpl.toAccountId = data.toAccountId; if (data.toAmount) tpl.toAmount = data.toAmount; }
    else tpl.categoryId = data.categoryId;
    state.recurring = state.recurring || [];
    if (editingRecId) {
      const r = state.recurring.find(x => x.id === editingRecId);
      Object.assign(r, tpl, { next: data.date });
      if (!r.createdBy && isSpace()) r.createdBy = { uid: window.Cloud.uid, name: window.Cloud.myName };
      save();
      txDialog.close();
      runRecurring(ctxKey);
      render();
      toast('Pago fijo actualizado');
      return;
    }
    const r = { id: uid(), ...tpl, next: advanceDate(data.date, tpl.freq, day) };
    if (isSpace() && window.Cloud) r.createdBy = { uid: window.Cloud.uid, name: window.Cloud.myName };
    state.recurring.push(r);
    data.recurringId = r.id;
    save();
    setTimeout(() => { runRecurring(ctxKey); render(); }, 0); // si empezó en el pasado, ponerse al día
  }
  let record;
  if (editingTxId) {
    const i = state.transactions.findIndex(t => t.id === editingTxId);
    const old = state.transactions[i];
    record = { id: editingTxId, createdAt: old?.createdAt || Date.now(), ...(old?.createdBy ? { createdBy: old.createdBy } : {}), ...data };
    if (i >= 0) state.transactions[i] = record; else state.transactions.push(record);
  } else {
    record = { id: uid(), createdAt: Date.now(), ...data };
    state.transactions.push(record);
  }
  lastAccountId = data.accountId;
  saveTx(record);
  txDialog.close();
  const ym = data.date.slice(0, 7);
  if (ym !== currentYM) currentYM = ym;
  render();
  toast(editingTxId ? 'Movimiento actualizado' : freq ? `Guardado y programado: ${REC_FREQ[freq].toLowerCase()} ✓` : 'Movimiento guardado ✓');
});

$('#txDelete').addEventListener('click', () => {
  if (!editingTxId || !confirm('¿Eliminar este movimiento?')) return;
  state.transactions = state.transactions.filter(t => t.id !== editingTxId);
  removeTx(editingTxId);
  txDialog.close();
  render();
  toast('Movimiento eliminado');
});

/* ---------- Diálogos de metas ---------- */

const goalDialog = $('#goalDialog');
const goalForm = $('#goalForm');
let editingGoalId = null;

function openGoal(g = null) {
  editingGoalId = g?.id || null;
  goalForm.reset();
  $('#goalTitle').textContent = g ? 'Editar meta' : 'Nueva meta';
  $('#goalDelete').hidden = !g;
  goalForm.name.value = g?.name || '';
  goalForm.target.value = g ? (Number(g.target) || '') : '';
  goalForm.saved.value = g ? (Number(g.saved) || 0) : 0;
  goalForm.deadline.value = g?.deadline || '';
  goalDialog.showModal();
}

goalForm.addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    name: goalForm.name.value.trim() || 'Meta',
    target: round2(goalForm.target.value),
    saved: round2(goalForm.saved.value),
    deadline: goalForm.deadline.value
  };
  if (editingGoalId) Object.assign(state.goals.find(g => g.id === editingGoalId), data);
  else state.goals.push({ id: uid(), ...data });
  save();
  goalDialog.close();
  render();
});

$('#goalDelete').addEventListener('click', () => {
  if (!editingGoalId || !confirm('¿Eliminar esta meta?')) return;
  state.goals = state.goals.filter(g => g.id !== editingGoalId);
  save();
  goalDialog.close();
  render();
});

const depositDialog = $('#depositDialog');
const depositForm = $('#depositForm');
let depositGoalId = null;

depositForm.addEventListener('submit', e => {
  e.preventDefault();
  const amount = round2(depositForm.amount.value);
  if (!(amount > 0)) { toast('Escribe un monto mayor que cero.'); return; }
  const g = state.goals.find(x => x.id === depositGoalId);
  if (!g) return;
  const sign = e.submitter?.value === 'retirar' ? -1 : 1;
  g.saved = Math.max(0, round2((Number(g.saved) || 0) + sign * amount));
  save();
  depositDialog.close();
  render();
  toast(sign > 0 ? `Abonaste ${fmt(amount)} 🐷` : `Retiraste ${fmt(amount)}`);
});

$$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- Acciones (delegación) ---------- */

document.addEventListener('click', e => {
  const tab = e.target.closest('.tabs button');
  if (tab) { setView(tab.dataset.view); return; }

  const txBtn = e.target.closest('.tx');
  if (txBtn) {
    if (isReadOnly()) { toast('Solo lectura: son las finanzas de ' + currentCtx().short); return; }
    openTx(state.transactions.find(t => t.id === txBtn.dataset.id));
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const used = id && state.transactions.some(t => t.categoryId === id || t.accountId === id || t.toAccountId === id);

  switch (btn.dataset.action) {
    case 'new-goal': openGoal(); break;
    case 'edit-goal': openGoal(state.goals.find(g => g.id === id)); break;
    case 'deposit': {
      const g = state.goals.find(x => x.id === id);
      depositGoalId = id;
      depositForm.reset();
      $('#depositTitle').textContent = g.name;
      depositDialog.showModal();
      break;
    }
    case 'add-acc':
      state.accounts.push({ id: uid(), name: 'Nueva cuenta', initial: 0 });
      save(); render();
      break;
    case 'del-acc':
      if (used) { toast('Esta cuenta tiene movimientos; no se puede eliminar.'); break; }
      if (!confirm('¿Eliminar esta cuenta?')) break;
      state.accounts = state.accounts.filter(a => a.id !== id);
      save(); render();
      break;
    case 'add-cat': {
      const type = btn.dataset.type;
      state.categories.push({
        id: uid(), name: 'Nueva categoría', type, group: type === 'gasto' ? 'gusto' : null,
        color: PALETTE[state.categories.length % PALETTE.length], budget: 0
      });
      save(); render();
      break;
    }
    case 'del-cat':
      if (used) { toast('Esta categoría tiene movimientos; no se puede eliminar.'); break; }
      if (!confirm('¿Eliminar esta categoría?')) break;
      state.categories = state.categories.filter(c => c.id !== id);
      save(); render();
      break;
    case 'quick': openTx(null, btn.dataset.type); break;
    case 'budget-tab': budgetTab = btn.dataset.tab; setView('presupuesto'); break;
    case 'rec-new': openTx(null, 'gasto'); txForm.repeat.value = 'mensual'; $('#autoField').hidden = false; break;
    case 'rec-edit': openTx(null, 'gasto', state.recurring.find(r => r.id === id)); break;
    case 'rec-toggle': {
      if (guardRO()) break;
      const r = state.recurring.find(x => x.id === id);
      r.active = !r.active;
      if (r.active && r.next < todayStr() && r.auto) r.next = todayStr();
      save(); render();
      break;
    }
    case 'rec-del':
      if (guardRO() || !confirm('¿Eliminar este pago fijo? Los movimientos ya registrados se quedan.')) break;
      state.recurring = state.recurring.filter(r => r.id !== id);
      save(); render();
      break;
    case 'rec-pay': {
      if (guardRO()) break;
      const r = state.recurring.find(x => x.id === id);
      const tx = txFromRec(state, r, btn.dataset.date);
      if (!state.transactions.some(t => t.id === tx.id)) { state.transactions.push(tx); saveTx(tx); }
      r.next = advanceDate(btn.dataset.date, r.freq, r.day);
      save(); render();
      toast('Pago registrado ✓');
      break;
    }
    case 'rec-skip': {
      if (guardRO()) break;
      const r = state.recurring.find(x => x.id === id);
      r.next = advanceDate(r.next, r.freq, r.day);
      save(); render();
      toast('Saltado. Te lo recuerdo la próxima vez.');
      break;
    }
    case 'rates-fetch':
      if (guardRO()) break;
      btn.disabled = true;
      fetchRates()
        .then(n => { save(); render(); toast(n ? `Tasas actualizadas (${n})` : 'No encontré esas monedas; ponlas a mano.'); })
        .catch(() => { btn.disabled = false; toast('No se pudo conectar. Escribe la tasa a mano.'); });
      break;
    case 'ray-closet': openCloset(); break;
    case 'ray-partner': toast('Es el Ray de ' + currentCtx().short + ' 😊'); break;
    case 'ray-next': {
      if (rayTips.length < 2) break;
      rayIdx = (rayIdx + 1) % rayTips.length;
      $('#rayMsg').innerHTML = rayTips[rayIdx];
      $('#rayMore').textContent = `${rayIdx + 1}/${rayTips.length} · toca para ver más`;
      const st = $('.ray-card .ray');
      if (st) { st.classList.remove('ray-talk'); void st.getBoundingClientRect(); st.classList.add('ray-talk'); }
      break;
    }
    case 'closet-slot': closetSlot = btn.dataset.slot; renderCloset(); break;
    case 'closet-pick': pickClosetItem(btn.dataset.slot, btn.dataset.id); break;
    case 'plan-mode':
      if (guardRO()) break;
      state.settings.plan = { ...planOf(state), mode: btn.dataset.mode };
      save(); render();
      break;
    case 'plan-pct':
      if (guardRO()) break;
      state.settings.plan = { ...planOf(state), mode: 'pct', pct: Number(btn.dataset.v) };
      save(); render();
      break;
    case 'ctx': switchCtx(btn.dataset.key); break;
    case 'create-space': {
      const name = $('#newSpaceName').value.trim() || 'Casa';
      const email = $('#newSpaceEmail').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Escribe un correo válido.'); break; }
      if (email === (window.Cloud.user.email || '').toLowerCase()) { toast('Ese es tu propio correo.'); break; }
      btn.disabled = true;
      window.Cloud.createSpace({ name, email, share: $('#newSpaceShare').checked })
        .then(() => toast('Espacio creado. Avísale que entre a RayFin con ' + email))
        .catch(err => { btn.disabled = false; cloudFail(err); });
      break;
    }
    case 'invite-more': {
      const input = $('#inv-' + id);
      const email = input.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Escribe un correo válido.'); break; }
      window.Cloud.invite(id, email).then(() => toast('Invitación enviada a ' + email)).catch(cloudFail);
      break;
    }
    case 'cancel-invite':
      window.Cloud.cancelInvite(id, btn.dataset.email).catch(cloudFail);
      break;
    case 'accept-invite': {
      const share = $('#share-inv-' + id)?.checked;
      btn.disabled = true;
      window.Cloud.acceptInvite(id, !!share)
        .then(() => toast('¡Listo! Ya comparten este espacio'))
        .catch(err => { btn.disabled = false; cloudFail(err); });
      break;
    }
    case 'decline-invite':
      if (confirm('¿Rechazar esta invitación?')) window.Cloud.declineInvite(id).catch(cloudFail);
      break;
    case 'leave-space': {
      const sp = sharing.spaces.find(x => x.id === id);
      const last = sp && sp.members.length <= 1;
      if (!confirm(last ? 'Eres el único integrante: el espacio y sus movimientos se borrarán. ¿Continuar?' : '¿Salir de este espacio? Dejarás de ver sus movimientos.')) break;
      if (ctxKey === 'space:' + id) switchCtx('personal');
      window.Cloud.leaveSpace(id).then(() => toast('Saliste del espacio')).catch(cloudFail);
      break;
    }
    case 'goto': setView(btn.dataset.view); break;
    case 'toggle-hide':
      hideAmounts = !hideAmounts;
      try { localStorage.setItem('mf-hide', hideAmounts ? '1' : '0'); } catch { /* sin acceso */ }
      render();
      break;
    case 'theme': setTheme(btn.dataset.theme); render(); break;
    case 'logout':
      if (confirm('¿Cerrar sesión en este dispositivo?')) window.Cloud?.logout();
      break;
    case 'export-json':
      download(`rayfin-respaldo-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
      break;
    case 'import-json':
      $('#importFile').click();
      break;
    case 'export-csv':
      exportCSV();
      break;
    case 'demo':
      if (state.transactions.length && !confirm('Esto agregará movimientos de ejemplo a tus datos actuales. ¿Continuar?')) break;
      loadDemo();
      break;
    case 'reset':
      if (!confirm('¿Borrar TODOS tus datos? Esta acción no se puede deshacer.')) break;
      if (!confirm('¿Seguro? Te recomendamos exportar un respaldo antes.')) break;
      state = defaultState();
      saveAll(); buildFormatter(); render();
      toast('Datos borrados');
      break;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  const d = t.dataset;
  if (d.plan) {
    if (guardRO()) return;
    const v = Math.max(0, round2(t.value));
    state.settings.plan = { ...planOf(state), [d.plan]: d.plan === 'pct' ? Math.min(100, Math.round(v)) : v };
    save(); render();
    return;
  }
  if (d.shareSpace) {
    window.Cloud?.setShare(d.shareSpace, t.checked)
      .then(() => toast(t.checked ? 'Ahora pueden ver tus finanzas personales' : 'Dejaste de compartir tus finanzas personales'))
      .catch(cloudFail);
    return;
  }
  if (isReadOnly() && (d.budget || d.accName || d.accInitial || d.accCur || d.rate || d.catName || d.catGroup || d.catColor || t.id === 'currencyInput')) {
    guardRO();
    return;
  }
  if (d.budget) {
    const c = catById(d.budget);
    if (c) c.budget = Math.max(0, round2(t.value));
  } else if (d.accName) {
    const a = accById(d.accName);
    if (a) a.name = t.value.trim() || a.name;
  } else if (d.accInitial) {
    const a = accById(d.accInitial);
    if (a) a.initial = round2(t.value);
  } else if (d.catName) {
    const c = catById(d.catName);
    if (c) c.name = t.value.trim() || c.name;
  } else if (d.catGroup) {
    const c = catById(d.catGroup);
    if (c) c.group = t.value;
  } else if (d.catColor) {
    const c = catById(d.catColor);
    if (c) c.color = t.value;
  } else if (d.accCur) {
    const a = accById(d.accCur);
    if (a) a.currency = t.value.trim().toUpperCase() || baseCur(state);
  } else if (d.rate) {
    const val = Number(t.value);
    const rates = { ...(state.settings.rates || {}) };
    if (val > 0) rates[d.rate] = d.inv ? 1 / val : val; else delete rates[d.rate];
    state.settings.rates = rates;
  } else if (t.id === 'currencyInput') {
    state.settings.currency = t.value.trim().toUpperCase() || 'USD';
    buildFormatter();
    curFmts.clear();
  } else {
    return;
  }
  save();
  render();
});

document.addEventListener('input', e => {
  if (e.target.dataset?.plan === 'pct') { const l = $('#planPctLabel'); if (l) l.textContent = e.target.value + '%'; }
});
$('#txSearch').addEventListener('input', e => { txFilter.q = e.target.value; renderMovimientos(); });
$('#txType').addEventListener('change', e => { txFilter.type = e.target.value; renderMovimientos(); });
$('#prevMonth').addEventListener('click', () => { currentYM = shiftMonth(currentYM, -1); render(); });
$('#nextMonth').addEventListener('click', () => { currentYM = shiftMonth(currentYM, 1); render(); });
$('#fab').addEventListener('click', () => openTx());

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.transactions)) throw new Error('formato');
    if (!confirm(`Se importarán ${data.transactions.length} movimientos y reemplazarán tus datos actuales. ¿Continuar?`)) return;
    state = normalize(data);
    saveAll(); buildFormatter(); render();
    toast('Respaldo importado ✓');
  } catch {
    toast('El archivo no es un respaldo válido.');
  }
});

/* ---------- Exportar ---------- */

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCSV() {
  const q = v => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['fecha', 'tipo', 'categoria', 'grupo', 'cuenta', 'cuenta_destino', 'monto', 'moneda', 'monto_' + baseCur(state).toLowerCase(), 'nota'];
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(t => {
      const c = catById(t.categoryId);
      return [t.date, t.type, c?.name || '', c?.group ? GROUPS[c.group] : '', accById(t.accountId)?.name || '',
        accById(t.toAccountId)?.name || '', t.amount.toFixed(2), accCur(state, t.accountId), bv(t).toFixed(2), t.note || ''].map(q).join(',');
    });
  download(`rayfin-${todayStr()}.csv`, '﻿' + [head.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
}

/* ---------- Datos de ejemplo ---------- */

function loadDemo() {
  const byName = n => state.categories.find(c => c.name === n)?.id || state.categories.find(c => c.type === 'gasto')?.id;
  const acc = n => state.accounts.find(a => a.name === n)?.id || state.accounts[0]?.id;
  if (!state.accounts.length) state.accounts = defaultState().accounts;
  const add = (ym, day, type, cat, amount, account, note) => {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const date = `${ym}-${pad2(Math.min(day, last))}`;
    if (date > todayStr()) return;
    state.transactions.push({ id: uid(), createdAt: Date.now(), type, categoryId: byName(cat), amount: round2(amount), date, accountId: acc(account), note });
  };
  const r = (min, max) => min + Math.random() * (max - min);
  for (const ym of lastMonths(4, ymFromDate(new Date()))) {
    add(ym, 1, 'ingreso', 'Salario', 1500, 'Banco', 'Quincena');
    add(ym, 15, 'ingreso', 'Salario', 1500, 'Banco', 'Quincena');
    add(ym, 10, 'ingreso', 'Negocio', r(200, 500), 'USDT', 'Comisiones');
    add(ym, 2, 'gasto', 'Vivienda', 700, 'Banco', 'Alquiler');
    add(ym, 5, 'gasto', 'Servicios', r(80, 120), 'Banco', 'Luz, agua e internet');
    add(ym, 3, 'gasto', 'Suscripciones', 25, 'Banco', 'Streaming');
    add(ym, 16, 'gasto', 'Ahorro e inversión', 300, 'Banco', 'Ahorro automático');
    add(ym, 20, 'gasto', 'Deudas', 150, 'Banco', 'Tarjeta de crédito');
    for (const d of [4, 11, 18, 25]) add(ym, d, 'gasto', 'Comida', r(60, 110), 'Banco', 'Supermercado');
    for (const d of [6, 13, 21, 27]) add(ym, d, 'gasto', 'Transporte', r(15, 35), 'Efectivo', 'Gasolina / taxi');
    for (const d of [8, 22]) add(ym, d, 'gasto', 'Restaurantes', r(25, 60), 'Banco', 'Cena');
    add(ym, 14, 'gasto', 'Ocio', r(30, 90), 'Efectivo', 'Salida');
    add(ym, 19, 'gasto', 'Compras', r(40, 180), 'Banco', 'Ropa');
  }
  const set = (n, v) => { const c = state.categories.find(x => x.name === n); if (c && !c.budget) c.budget = v; };
  set('Comida', 400); set('Restaurantes', 100); set('Ocio', 80); set('Compras', 120); set('Transporte', 120);
  const ef = state.goals.find(g => /emergencia/i.test(g.name));
  if (ef && !ef.target) { ef.target = 6000; ef.saved = 1800; }
  state.accounts.forEach(a => { if (!a.initial) a.initial = a.name === 'Banco' ? 500 : a.name === 'Efectivo' ? 600 : 0; });
  saveAll();
  currentYM = ymFromDate(new Date());
  setView('inicio');
  toast('Datos de ejemplo cargados');
}

/* ---------- Inicio ---------- */

applyTheme(getTheme());
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getTheme()));
buildFormatter();
const VIEWS = ['inicio', 'movimientos', 'presupuesto', 'metas', 'ajustes'];
const startView = () => setView(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio');
let appStarted = false;

// API usada por cloud.js (inicio de sesión y base de datos)
window.App = {
  CLOUD_ENABLED,
  EMULATOR,
  get state() { return state; },
  defaultState,
  normalize,
  readLocal,
  clearLocal() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin acceso */ } },
  toast,
  get stores() { return stores; },
  /** Datos de un libro llegados de la nube (personal, space:ID o user:UID). */
  setStore(key, data) {
    stores[key] = normalize(data);
    if (key === 'personal' || key.startsWith('space:')) setTimeout(() => runRecurring(key), 0);
    if (key === ctxKey) {
      state = stores[key];
      buildFormatter();
      if (appStarted) render();
    } else if (appStarted && isSpace() && currentView === 'inicio') {
      render(); // el espacio muestra los planes de ahorro de cada integrante
    }
    if (appStarted) renderCtxBar();
  },
  setState(s) { this.setStore('personal', s); },
  /** Un libro dejó de estar disponible (se salió del espacio o dejaron de compartir). */
  dropStore(key) {
    delete stores[key];
    if (key === ctxKey) {
      if (appStarted) { switchCtx('personal'); toast('Ya no tienes acceso a esas finanzas'); }
      else { ctxKey = 'personal'; state = stores.personal; }
    } else if (appStarted) renderCtxBar();
  },
  /** Espacios, invitaciones y personas que comparten contigo. */
  setSharing(info) {
    sharing = info;
    if (!appStarted) return;
    if (!contexts().some(c => c.key === ctxKey)) { switchCtx('personal'); return; }
    renderCtxBar();
    // No redibujar Ajustes si la persona está escribiendo ahí
    const typing = currentView === 'ajustes' && document.activeElement?.matches?.('#sharingCard input');
    if (!typing && (currentView === 'ajustes' || currentView === 'inicio')) render();
  },
  /** Muestra la app tras iniciar sesión. */
  enter() {
    document.body.classList.remove('auth-mode');
    appStarted = true;
    startView();
  }
};

if (CLOUD_ENABLED) {
  document.body.classList.add('auth-mode'); // cloud.js muestra el inicio de sesión
} else {
  appStarted = true;
  runRecurring('personal');
  startView();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Al publicarse una versión nueva, se activa y la página se recarga sola una vez.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // Buscar actualizaciones al volver a la app
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      })
      .catch(() => {});
  });
}
