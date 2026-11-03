'use strict';

/* =========================================================
   Pareja: aportar al espacio compartido y "cuentas claras".
   - Aporte: gasto en lo personal + ingreso (contrib) en el espacio.
   - Gastos del espacio con `paidBy` (uid o 'pot' = fondo común).
   - Liquidación: movimiento { type: 'liquidacion', from, to, amount }.
   Se carga antes de app.js.
   ========================================================= */

const POT = 'pot';

function currentSpace() {
  return isSpace() ? sharing.spaces.find(s => 'space:' + s.id === ctxKey) : null;
}
const memberName = (sp, uid) => {
  if (uid === POT) return 'Fondo común';
  const m = sp?.members.find(x => x.uid === uid);
  return m ? (m.me ? 'Tú' : firstName(m.name || m.email)) : 'Alguien';
};

/** Proporción que le toca a cada integrante (suma 1). */
function splitShares(L, sp) {
  const ids = sp.members.map(m => m.uid);
  const cfg = L.settings.split || { mode: 'igual' };
  let w = {};
  if (cfg.mode === 'manual') {
    ids.forEach(u => { w[u] = Math.max(0, Number(cfg.manual?.[u]) || 0); });
  } else if (cfg.mode === 'ingresos') {
    const months = lastMonths(3, ymFromDate(new Date()));
    ids.forEach(u => {
      const P = sp.members.find(m => m.uid === u)?.me ? stores.personal : stores['user:' + u];
      w[u] = P ? sum(months.map(ym => totalsOf(P, ym).ing)) : 0;
    });
  }
  const tot = sum(Object.values(w));
  if (!tot) ids.forEach(u => { w[u] = 1; });
  const t2 = sum(ids.map(u => w[u]));
  const out = {};
  ids.forEach(u => { out[u] = w[u] / t2; });
  return out;
}

function totalsOf(L, ym) {
  let ing = 0, gas = 0;
  for (const t of L.transactions) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'ingreso') ing += bv(t); else if (t.type === 'gasto') gas += bv(t);
  }
  return { ing, gas };
}

/**
 * Cuentas claras de todo el historial del espacio.
 * Aportó = aportes + gastos que pagó de su bolsillo (± liquidaciones).
 * Le toca = su parte de todos los gastos. Lo que sobra en el fondo común se reparte igual que los gastos.
 */
function settleState(L, sp) {
  const shares = splitShares(L, sp);
  const ids = sp.members.map(m => m.uid);
  const paid = {}, contrib = {};
  ids.forEach(u => { paid[u] = 0; contrib[u] = 0; });
  let totalGastos = 0, potIn = 0, potOut = 0;
  for (const t of L.transactions) {
    const v = bv(t);
    if (t.type === 'gasto') {
      totalGastos += v;
      const who = t.paidBy || t.createdBy?.uid;
      if (who === POT || !(who in paid)) potOut += v; else paid[who] += v;
    } else if (t.type === 'ingreso' && t.contrib) {
      const who = t.createdBy?.uid;
      if (who in contrib) { contrib[who] += v; potIn += v; }
    } else if (t.type === 'liquidacion') {
      if (t.from in paid) paid[t.from] += v;
      if (t.to in paid) paid[t.to] -= v;
    }
  }
  const potLeft = potIn - potOut;
  const rows = ids.map(u => {
    const put = paid[u] + contrib[u];
    const fair = shares[u] * totalGastos;
    const net = put - fair - shares[u] * potLeft;
    return { uid: u, put, fair, share: shares[u], net };
  });
  // Quién le debe a quién (de los que deben a los que les deben)
  const debtors = rows.filter(r => r.net < -0.005).map(r => ({ ...r, left: -r.net })).sort((a, b) => b.left - a.left);
  const creditors = rows.filter(r => r.net > 0.005).map(r => ({ ...r, left: r.net })).sort((a, b) => b.left - a.left);
  const transfers = [];
  for (const d of debtors) {
    for (const c of creditors) {
      if (d.left <= 0.005) break;
      const x = Math.min(d.left, c.left);
      if (x > 0.005) { transfers.push({ from: d.uid, to: c.uid, amount: round2(x) }); d.left -= x; c.left -= x; }
    }
  }
  return { rows, transfers, totalGastos, potLeft };
}

/** Tarjeta "Cuentas claras" en el Inicio del espacio. */
function settleCard(sp) {
  const L = state;
  const S = settleState(L, sp);
  const cfg = L.settings.split || { mode: 'igual' };
  const modeLabel = { igual: 'mitad y mitad', ingresos: 'según ingresos', manual: 'porcentajes a mano' }[cfg.mode] || 'mitad y mitad';
  const rows = S.rows.map((r, i) => `<div class="asset">
      <span class="avatar" style="--c:${PALETTE[(i + 3) % PALETTE.length]}">${esc(memberName(sp, r.uid).charAt(0))}</span>
      <div class="grow"><div class="asset-name">${esc(memberName(sp, r.uid))} <small class="muted">· ${Math.round(r.share * 100)}%</small></div>
        <div class="asset-sub">Puso ${esc(fmt(r.put))} · le toca ${esc(fmt(r.fair))}</div></div>
      <div class="amt ${r.net >= 0 ? 'ing' : 'gas'}">${r.net >= 0 ? '+' : '−'}${esc(fmt(Math.abs(r.net)))}</div>
    </div>`).join('');
  const msg = S.transfers.length
    ? S.transfers.map(t => {
        const me = window.Cloud?.uid;
        const amt = `<b class="gas">${esc(fmt(t.amount))}</b>`;
        const txt = t.to === me ? `<b>${esc(memberName(sp, t.from))}</b> te debe ${amt}`
          : t.from === me ? `Le debes ${amt} a <b>${esc(memberName(sp, t.to))}</b>`
          : `<b>${esc(memberName(sp, t.from))}</b> le debe ${amt} a <b>${esc(memberName(sp, t.to))}</b>`;
        return `<div class="settle-line"><span>${txt}</span>
        ${isReadOnly() ? '' : `<button class="btn small primary" data-action="settle" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amount="${t.amount}">Saldar</button>`}</div>`;
      }).join('')
    : `<div class="settle-line ok"><span>¡Están a mano! ✓</span></div>`;
  return `<div class="card settle">
    <div class="card-head"><h2>Cuentas claras</h2><button class="link" data-action="goto" data-view="ajustes">${esc(modeLabel)} ${ICONS.chevron}</button></div>
    ${msg}
    ${rows}
    ${Math.abs(S.potLeft) > 0.005 ? `<p class="muted" style="margin:8px 0 0;font-size:.78rem">En el fondo común quedan ${esc(fmt(S.potLeft))}.</p>` : ''}
  </div>`;
}

/** Configuración de cómo dividir (en Ajustes del espacio). */
function splitCard(sp) {
  const cfg = state.settings.split || { mode: 'igual' };
  const shares = splitShares(state, sp);
  return `<div class="card">
    <h2>Cómo dividen los gastos</h2>
    <div class="pills">
      ${[['igual', 'Mitad y mitad'], ['ingresos', 'Según ingresos'], ['manual', 'A mano']].map(([k, v]) =>
        `<button class="pill ${cfg.mode === k ? 'active' : ''}" data-action="split-mode" data-mode="${k}">${v}</button>`).join('')}
    </div>
    <p class="muted" style="font-size:.82rem;margin:8px 0">${cfg.mode === 'ingresos'
      ? 'Cada uno pone en proporción a lo que gana (ingresos de los últimos 3 meses de quienes comparten sus finanzas personales).'
      : cfg.mode === 'manual' ? 'Escribe el porcentaje de cada uno.' : 'Todos ponen lo mismo.'}</p>
    ${sp.members.map(m => `<div class="rate-row"><span style="flex:1">${esc(memberName(sp, m.uid))}</span>
      ${cfg.mode === 'manual'
        ? `<input type="number" min="0" max="100" step="1" data-split="${esc(m.uid)}" value="${Math.round(shares[m.uid] * 100)}"><span>%</span>`
        : `<b>${Math.round(shares[m.uid] * 100)}%</b>`}</div>`).join('')}
  </div>`;
}

/* ---------- Aportar ---------- */
function openContrib() {
  const sp = currentSpace();
  if (!sp) return;
  const P = stores.personal;
  const f = $('#contribForm');
  f.reset();
  $('#contribTitle').textContent = `Aportar a «${sp.name}»`;
  f.from.innerHTML = P.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(accCur(P, a.id))}</option>`).join('');
  f.to.innerHTML = state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(accCur(state, a.id))}</option>`).join('');
  f.date.value = todayStr();
  $('#contribDialog').showModal();
  setTimeout(() => f.amount.focus(), 50);
}

function ensureCategory(L, name, type, group) {
  let c = L.categories.find(x => x.type === type && x.name === name);
  if (!c) {
    c = { id: uid(), name, type, group: type === 'gasto' ? group : null, color: '#2fd6b0', budget: 0 };
    L.categories.push(c);
  }
  return c;
}

function initContribDialog() {
  const f = $('#contribForm');
  f.addEventListener('submit', e => {
    e.preventDefault();
    const sp = currentSpace();
    if (!sp || !cloudOn()) return;
    const amount = round2(f.amount.value);
    if (!(amount > 0)) { toast('Escribe un monto mayor que cero.'); return; }
    const P = stores.personal, Sx = state, key = ctxKey;
    const fromCur = accCur(P, f.from.value), toCur = accCur(Sx, f.to.value);
    const fr = rateOf(P, fromCur), tr = rateOf(P, toCur);
    const arrives = fromCur === toCur ? amount : round2(amount * (fr || 1) / (tr || 1));
    const idp = uid();
    const note = f.note.value.trim();
    const me = { uid: window.Cloud.uid, name: window.Cloud.myName };
    // En lo personal: un gasto
    const catP = ensureCategory(P, `Aporte: ${sp.name}`.slice(0, 40), 'gasto', 'necesidad');
    const txP = { id: 'ap-' + idp, createdAt: Date.now(), type: 'gasto', amount, date: f.date.value, accountId: f.from.value, categoryId: catP.id, note: note || `Aporte a ${sp.name}` };
    if (fromCur !== baseCur(P)) txP.fx = fr || undefined;
    // En el espacio: un ingreso marcado como aporte
    const catS = ensureCategory(Sx, 'Aportes', 'ingreso');
    const txS = { id: 'ap-' + idp, createdAt: Date.now(), type: 'ingreso', amount: arrives, date: f.date.value, accountId: f.to.value, categoryId: catS.id, note: note || 'Aporte', contrib: true, createdBy: me };
    if (toCur !== baseCur(Sx)) txS.fx = rateOf(Sx, toCur) || undefined;
    P.transactions.push(txP); Sx.transactions.push(txS);
    ensureBase(P); ensureBase(Sx);
    persistLedger('personal', P, [txP]);
    persistLedger(key, Sx, [txS]);
    $('#contribDialog').close();
    render();
    toast(`Aportaste ${fmtC(amount, fromCur)} a ${sp.name} ✓`);
  });
}

/** Registra que alguien le pagó a otro para quedar a mano. */
function recordSettlement(from, to, amount) {
  const sp = currentSpace();
  if (!sp) return;
  const tx = {
    id: uid(), createdAt: Date.now(), type: 'liquidacion', amount: round2(amount), date: todayStr(),
    from, to, note: `${memberName(sp, from)} → ${memberName(sp, to)}`,
    createdBy: { uid: window.Cloud.uid, name: window.Cloud.myName }
  };
  state.transactions.push(tx);
  ensureBase(state);
  saveTx(tx);
  render();
  confetti();
  toast('¡Cuentas saldadas! ✓');
}
