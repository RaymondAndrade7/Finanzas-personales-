'use strict';

/* RayFin — Cálculos: consultas, plan de ahorro, puntos y logros. (parte de la app; se carga en orden desde index.html) */

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

  const debtsPaidOff = (L.debts || []).filter(d => d.dir === 'debo' && debtPaid(L, d) > 0 && debtInfo(L, d).done).length;
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
    { id: 'equipo', icon: '🤝', name: 'En equipo', desc: 'Comparte un espacio con tu pareja', pts: 100, done: inTeam },
    { id: 'libre', icon: '🕊️', name: 'Libre de una deuda', desc: 'Salda por completo una deuda (400 por cada una)', pts: 400 * Math.max(1, debtsPaidOff), done: debtsPaidOff > 0 }
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
