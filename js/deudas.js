'use strict';

/* =========================================================
   Deudas, tarjetas y préstamos entre personas.
   L.debts = [{ id, dir: 'debo'|'medeben', kind, name, amount, currency,
                rate, minPay, dueDay, createdAt }]
   Los pagos son movimientos con `debtId`; el saldo baja solo.
   ========================================================= */

const DEBT_KINDS = { tarjeta: '💳 Tarjeta', prestamo: '🏦 Préstamo', persona: '🙋 Persona', otro: '📄 Otro' };

/** Lo pagado (o cobrado) de una deuda, en la moneda de la deuda. */
function debtPaid(L, d) {
  const r = rateOf(L, d.currency || baseCur(L)) || 1;
  return sum(L.transactions.filter(t => t.debtId === d.id).map(t => bv(t) / r));
}

function debtInfo(L, d) {
  const paid = debtPaid(L, d);
  const remaining = Math.max(0, round2(Number(d.amount) - paid));
  const cur = (d.currency || baseCur(L)).toUpperCase();
  return { paid, remaining, cur, base: remaining * (rateOf(L, cur) || 1), done: remaining <= 0 && Number(d.amount) > 0 };
}

/** Próxima fecha de pago (si este mes ya pagó, el mes siguiente). */
function debtNextDue(L, d) {
  if (!d.dueDay) return null;
  const now = new Date();
  const ym = ymFromDate(now);
  const paidThisMonth = L.transactions.some(t => t.debtId === d.id && t.date.startsWith(ym));
  const base = paidThisMonth ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(Number(d.dueDay), last));
  return isoDate(base);
}

/** Cuotas de deudas para "Próximos pagos". */
function debtsUpcoming(L, until) {
  const out = [];
  for (const d of L.debts || []) {
    if (d.dir !== 'debo' || !Number(d.minPay)) continue;
    const info = debtInfo(L, d);
    if (info.done) continue;
    const date = debtNextDue(L, d);
    if (!date || date > until) continue;
    const pay = Math.min(Number(d.minPay), info.remaining);
    out.push({ kind: 'debt', id: 'debt-' + d.id, d, date, overdue: date < todayStr(), amount: pay, base: pay * (rateOf(L, info.cur) || 1) });
  }
  return out;
}

function debtUpcomingRow(L, it, editable) {
  const d = it.d;
  return `<div class="up-row ${it.overdue ? 'due' : ''}">
    <i class="dot" style="background:#f5a524"></i>
    <div class="grow"><div class="up-title">Cuota: ${esc(d.name)}</div>
      <div class="up-sub">${esc(relDay(it.date))} · ${esc(DEBT_KINDS[d.kind] || '')}</div></div>
    <div class="up-amt gas">−${esc(fmtC(it.amount, debtInfo(L, d).cur))}</div>
    ${editable ? `<div class="up-act"><button class="btn small" data-action="debt-pay" data-id="${esc(d.id)}">Pagar</button></div>` : ''}
  </div>`;
}

/**
 * Plan para salir de deudas.
 * strategy: 'avalancha' (mayor interés primero) | 'bola' (menor saldo primero).
 * Todo en moneda principal. Devuelve meses, intereses y el orden en que se liquidan.
 */
function payoffPlan(L, strategy, extra) {
  const debts = (L.debts || []).filter(d => d.dir === 'debo').map(d => {
    const info = debtInfo(L, d);
    const r = rateOf(L, info.cur) || 1;
    return { id: d.id, name: d.name, bal: info.base, rate: Number(d.rate) || 0, min: (Number(d.minPay) || 0) * r };
  }).filter(d => d.bal > 0.005);
  if (!debts.length) return null;
  const budget = sum(debts.map(d => d.min)) + Math.max(0, Number(extra) || 0);
  if (budget <= 0) return { noBudget: true };
  const order = () => debts.filter(d => d.bal > 0.005).sort((a, b) =>
    strategy === 'bola' ? a.bal - b.bal : b.rate - a.rate || a.bal - b.bal);
  let month = 0, interest = 0;
  const finished = [];
  while (debts.some(d => d.bal > 0.005) && month < 600) {
    month++;
    for (const d of debts) if (d.bal > 0) { const i = d.bal * d.rate / 1200; d.bal += i; interest += i; }
    let left = budget;
    for (const d of debts) if (d.bal > 0) { const p = Math.min(d.min, d.bal, left); d.bal -= p; left -= p; }
    for (const d of order()) { if (left <= 0) break; const p = Math.min(d.bal, left); d.bal -= p; left -= p; }
    for (const d of debts) if (d.bal <= 0.005 && !finished.some(f => f.id === d.id)) { d.bal = 0; finished.push({ id: d.id, name: d.name, month }); }
  }
  const stuck = month >= 600;
  const end = new Date(); end.setMonth(end.getMonth() + month);
  return { months: month, interest, finished, stuck, budget, endLabel: new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(end) };
}

/** Sección de deudas (en Metas). */
function debtsSection() {
  const L = state;
  const ro = isReadOnly();
  const debts = L.debts || [];
  const owe = debts.filter(d => d.dir === 'debo'), owed = debts.filter(d => d.dir === 'medeben');
  const totalOwe = sum(owe.map(d => debtInfo(L, d).base));
  const totalOwed = sum(owed.map(d => debtInfo(L, d).base));

  const row = d => {
    const info = debtInfo(L, d);
    const p = Number(d.amount) > 0 ? Math.min(1, info.paid / Number(d.amount)) : 0;
    const meta = [DEBT_KINDS[d.kind] || '', d.rate ? `${d.rate}% anual` : '', d.minPay ? `cuota ${fmtC(d.minPay, info.cur)}` : '', d.dueDay ? `día ${d.dueDay}` : ''].filter(Boolean).join(' · ');
    return `<div class="debt ${info.done ? 'done' : ''}">
      <div class="debt-head">
        <div class="grow"><b>${esc(d.name)}</b><div class="up-sub">${esc(meta)}</div></div>
        <div class="debt-amt ${d.dir === 'debo' ? 'gas' : 'ing'}">${info.done ? '✓ Saldada' : esc(fmtC(info.remaining, info.cur))}</div>
      </div>
      <div class="bar"><div class="fill" style="width:${Math.round(p * 100)}%"></div></div>
      <div class="debt-foot"><small>${d.dir === 'debo' ? 'Pagado' : 'Cobrado'} ${esc(fmtC(info.paid, info.cur))} de ${esc(fmtC(d.amount, info.cur))}</small>
        ${ro ? '' : `<span class="row-actions">
          ${info.done ? '' : `<button class="btn small ${d.dir === 'debo' ? 'primary' : ''}" data-action="debt-pay" data-id="${esc(d.id)}">${d.dir === 'debo' ? 'Pagar' : 'Cobrar'}</button>`}
          <button class="icon-btn" data-action="debt-edit" data-id="${esc(d.id)}" aria-label="Editar">✎</button>
          <button class="icon-btn" data-action="debt-del" data-id="${esc(d.id)}" aria-label="Eliminar">✕</button></span>`}
      </div>
    </div>`;
  };

  const strategy = L.settings.debtStrategy || 'avalancha';
  const extra = Number(L.settings.debtExtra) || 0;
  const plan = owe.length ? payoffPlan(L, strategy, extra) : null;
  const other = strategy === 'avalancha' ? payoffPlan(L, 'bola', extra) : payoffPlan(L, 'avalancha', extra);
  let planHTML = '';
  if (plan && !plan.noBudget) {
    const saves = other && !other.noBudget && other.interest - plan.interest > 1 ? `Con esta estrategia pagas <b>${esc(fmt(other.interest - plan.interest))}</b> menos de intereses que con la otra.` : '';
    planHTML = `<div class="card">
      <h2>Plan para salir de deudas</h2>
      <div class="pills">
        <button class="pill ${strategy === 'avalancha' ? 'active' : ''}" data-action="debt-strategy" data-v="avalancha">Avalancha</button>
        <button class="pill ${strategy === 'bola' ? 'active' : ''}" data-action="debt-strategy" data-v="bola">Bola de nieve</button>
      </div>
      <p class="muted" style="font-size:.82rem;margin:8px 0">${strategy === 'avalancha' ? 'Primero la deuda con <b>mayor interés</b>: pagas menos en total.' : 'Primero la deuda <b>más pequeña</b>: ves avances rápido y te motivas.'}</p>
      <label class="field">Extra que puedes pagar cada mes (además de las cuotas mínimas)
        <input type="number" min="0" step="0.01" inputmode="decimal" data-debt-extra value="${extra || ''}" placeholder="0" ${ro ? 'disabled' : ''}></label>
      ${plan.stuck ? `<p class="bad" style="font-size:.88rem">Con ${esc(fmt(plan.budget))} al mes los intereses no te dejan avanzar. Sube el pago extra o las cuotas.</p>` : `
      <div class="free-box"><small>Libre de deudas en</small><b>${plan.months} ${plan.months === 1 ? 'mes' : 'meses'}</b><span>${esc(cap(plan.endLabel))}</span></div>
      <div class="suggest">
        <div><small>Pago mensual</small><b>${esc(fmtS(plan.budget))}</b></div>
        <div><small>Intereses</small><b class="gas">${esc(fmtS(plan.interest))}</b></div>
        <div><small>Deudas</small><b>${owe.filter(d => !debtInfo(L, d).done).length}</b></div>
      </div>
      <div class="subhead">Orden de pago</div>
      ${plan.finished.map((f, i) => `<div class="pt-row"><span class="grow">${i + 1}. ${esc(f.name)}</span><small>mes ${f.month}</small></div>`).join('')}
      ${saves ? `<p class="muted" style="font-size:.8rem;margin:10px 0 0">${saves}</p>` : ''}`}
    </div>`;
  } else if (plan && plan.noBudget) {
    planHTML = `<div class="card"><h2>Plan para salir de deudas</h2><p class="muted" style="font-size:.88rem;margin:0">Agrega la cuota mínima de tus deudas o un pago extra mensual para calcular tu plan.</p></div>`;
  }

  return `<div class="card">
      <div class="card-head"><h2>Deudas y préstamos</h2>${ro ? '' : '<button class="btn small primary" data-action="debt-new">+ Agregar</button>'}</div>
      <div class="suggest" style="margin:0 0 6px">
        <div><small>Debes</small><b class="gas">${esc(fmtS(totalOwe))}</b></div>
        <div><small>Te deben</small><b class="ing">${esc(fmtS(totalOwed))}</b></div>
        <div><small>Balance</small><b>${esc(fmtS(totalOwed - totalOwe))}</b></div>
      </div>
      ${owe.length ? `<div class="subhead">Lo que debo</div>${owe.map(row).join('')}` : ''}
      ${owed.length ? `<div class="subhead">Lo que me deben</div>${owed.map(row).join('')}` : ''}
      ${debts.length ? '' : empty('Registra tarjetas, préstamos o lo que le prestaste a alguien para llevar la cuenta y salir de deudas más rápido.')}
    </div>
    ${planHTML}`;
}

/* ---------- Diálogo de deuda ---------- */
let editingDebtId = null;
let payingDebtId = null;

function openDebt(d = null) {
  const f = $('#debtForm');
  editingDebtId = d?.id || null;
  f.reset();
  $('#debtTitle').textContent = d ? 'Editar' : 'Nueva deuda o préstamo';
  f.dir.value = d?.dir || 'debo';
  f.name.value = d?.name || '';
  f.kind.value = d?.kind || 'tarjeta';
  f.amount.value = d ? d.amount : '';
  const curs = [...new Set([baseCur(state), ...otherCurrencies(state)])];
  f.currency.innerHTML = curs.map(c => `<option ${c === (d?.currency || baseCur(state)) ? 'selected' : ''}>${esc(c)}</option>`).join('');
  f.rate.value = d?.rate || '';
  f.minPay.value = d?.minPay || '';
  f.dueDay.value = d?.dueDay || '';
  syncDebtForm();
  $('#debtDialog').showModal();
}

function syncDebtForm() {
  const f = $('#debtForm');
  const owe = f.dir.value === 'debo';
  $('#debtNameLabel').textContent = owe ? '¿A quién o qué? (ej: Tarjeta Visa, Préstamo carro)' : '¿Quién te debe?';
  $('#debtAmountLabel').textContent = owe ? 'Cuánto debes hoy' : 'Cuánto te deben';
  $$('#debtForm .owe-only').forEach(el => { el.hidden = !owe; });
}

function initDebtDialog() {
  const f = $('#debtForm');
  f.addEventListener('change', e => { if (e.target.name === 'dir') syncDebtForm(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (guardRO()) return;
    const amount = round2(f.amount.value);
    if (!f.name.value.trim()) { toast('Escribe un nombre.'); return; }
    if (!(amount > 0)) { toast('Escribe el monto.'); return; }
    const data = {
      dir: f.dir.value, name: f.name.value.trim(), kind: f.dir.value === 'debo' ? f.kind.value : 'persona',
      amount, currency: f.currency.value,
      rate: f.dir.value === 'debo' ? round2(f.rate.value) : 0,
      minPay: f.dir.value === 'debo' ? round2(f.minPay.value) : 0,
      dueDay: f.dir.value === 'debo' ? Math.min(31, Math.max(0, Math.round(Number(f.dueDay.value) || 0))) : 0
    };
    state.debts = state.debts || [];
    if (editingDebtId) Object.assign(state.debts.find(d => d.id === editingDebtId), data);
    else state.debts.push({ id: uid(), createdAt: Date.now(), ...data });
    save();
    $('#debtDialog').close();
    render();
    toast(editingDebtId ? 'Actualizado' : 'Agregado ✓');
  });
}

/** Abre el formulario de movimiento para pagar (o cobrar) una deuda. */
function payDebt(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const info = debtInfo(state, d);
  const owe = d.dir === 'debo';
  const cat = owe
    ? state.categories.find(c => c.type === 'gasto' && /deuda/i.test(c.name)) || state.categories.find(c => c.type === 'gasto')
    : state.categories.find(c => c.type === 'ingreso' && /otro/i.test(c.name)) || state.categories.find(c => c.type === 'ingreso');
  openTx(null, owe ? 'gasto' : 'ingreso');
  payingDebtId = d.id;
  syncTxForm({ categoryId: cat?.id, accountId: state.accounts.find(a => accCur(state, a.id) === info.cur)?.id });
  catTouched = true;
  txForm.amount.value = owe ? Math.min(Number(d.minPay) || info.remaining, info.remaining) : info.remaining;
  txForm.note.value = `${owe ? 'Pago' : 'Cobro'}: ${d.name}`;
  $('#repeatField').hidden = true;
  $('#txRecents').innerHTML = '';
  $('#txTitle').textContent = owe ? `Pagar ${d.name}` : `Cobrar a ${d.name}`;
  updateAmountHints();
}
