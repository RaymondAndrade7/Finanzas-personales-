'use strict';

/* RayFin — Formularios: movimientos y metas. (parte de la app; se carga en orden desde index.html) */

/* ---------- Diálogo de movimientos ---------- */

const txDialog = $('#txDialog');
const txForm = $('#txForm');
let editingTxId = null;
let editingRecId = null; // editando un pago fijo (plantilla), no un movimiento
let catTouched = false;   // la persona eligió la categoría a mano

/** Lo que más se registra (últimos 120 días): para llenar el formulario con un toque. */
function recentCombos(limit = 6) {
  const since = new Date(); since.setDate(since.getDate() - 120);
  const from = ymFromDate(since) + '-01';
  const map = new Map();
  for (const t of state.transactions) {
    if (t.date < from || t.type === 'transferencia' || !t.categoryId) continue;
    const key = [t.type, t.categoryId, t.accountId, (t.note || '').trim().toLowerCase()].join('|');
    const e = map.get(key) || { n: 0, last: null };
    e.n++;
    if (!e.last || t.date >= e.last.date) e.last = t;
    map.set(key, e);
  }
  return [...map.values()].filter(e => e.n >= 2 || map.size <= limit)
    .sort((a, b) => b.n - a.n || b.last.date.localeCompare(a.last.date)).slice(0, limit).map(e => e.last);
}

/** Categoría que se suele usar con una nota parecida. */
function suggestCategory(type, note) {
  const q = note.trim().toLowerCase();
  if (q.length < 3) return null;
  const count = new Map();
  for (const t of state.transactions) {
    if (t.type !== type || !t.categoryId || !t.note) continue;
    const n = t.note.trim().toLowerCase();
    if (n.startsWith(q) || q.startsWith(n) || n.split(/\s+/).some(w => w.length >= 3 && w.startsWith(q))) {
      count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
    }
  }
  let best = null, max = 0;
  for (const [id, n] of count) if (n > max) { best = id; max = n; }
  return best;
}

function renderRecents() {
  const box = $('#txRecents');
  if (editingTxId || editingRecId) { box.innerHTML = ''; return; }
  const list = recentCombos();
  box.innerHTML = list.length ? `<div class="recents-label">Recientes</div><div class="recents-row">${list.map(t => {
    const c = catById(t.categoryId);
    return `<button type="button" class="recent ${t.type}" data-recent="${esc(t.id)}">
      <i class="dot" style="background:${safeColor(c?.color)}"></i>
      <span>${esc(t.note || c?.name || '')}</span><b>${esc(fmtC(t.amount, accCur(state, t.accountId)))}</b></button>`;
  }).join('')}</div>` : '';
}
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
  // En un espacio compartido: quién pagó el gasto
  const sp = currentSpace();
  const showPaid = !!sp && type === 'gasto';
  $('#paidByField').hidden = !showPaid;
  if (showPaid) {
    const sel = keep.paidBy || window.Cloud?.uid;
    const ids = [...sp.members.filter(m => m.me), ...sp.members.filter(m => !m.me)].map(m => m.uid);
    txForm.paidBy.innerHTML = [...ids, POT].map(u =>
      `<option value="${esc(u)}" ${u === sel ? 'selected' : ''}>${esc(memberName(sp, u))}</option>`).join('');
  }
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
  payingDebtId = null;
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
  catTouched = !!tx;
  $('#txDuplicate').hidden = !editingTxId;
  renderRecents();
  txDialog.showModal();
  if (!tx) setTimeout(() => txForm.amount.focus(), 50);
}

txForm.addEventListener('change', e => {
  if (e.target.name === 'categoryId') catTouched = true;
  if (e.target.name === 'repeat') $('#autoField').hidden = !txForm.repeat.value;
  if (e.target.name === 'type') syncTxForm({ accountId: txForm.accountId.value });
  else if (['accountId', 'toAccountId'].includes(e.target.name)) { txForm.toAmount.dataset.touched = ''; updateAmountHints(); }
});
txForm.addEventListener('input', e => {
  if (e.target.name === 'note' && !catTouched && txForm.type.value !== 'transferencia') {
    const id = suggestCategory(txForm.type.value, e.target.value);
    if (id && [...txForm.categoryId.options].some(o => o.value === id)) txForm.categoryId.value = id;
  }
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
  if (type === 'gasto' && !$('#paidByField').hidden) data.paidBy = txForm.paidBy.value;
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
  if (payingDebtId && !editingTxId) data.debtId = payingDebtId;
  const paidDebt = payingDebtId;
  payingDebtId = null;
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
  if (paidDebt) {
    const d = state.debts.find(x => x.id === paidDebt);
    if (d && debtInfo(state, d).done) { toast(`¡${d.name} quedó saldada! 🕊️`); confetti(); return; }
  }
  toast(editingTxId ? 'Movimiento actualizado' : freq ? `Guardado y programado: ${REC_FREQ[freq].toLowerCase()} ✓` : 'Movimiento guardado ✓');
});

// Un toque en "Recientes" llena el formulario
$('#txRecents').addEventListener('click', e => {
  const b = e.target.closest('[data-recent]');
  if (!b) return;
  const t = state.transactions.find(x => x.id === b.dataset.recent);
  if (!t) return;
  txForm.type.value = t.type;
  syncTxForm({ categoryId: t.categoryId, accountId: t.accountId });
  catTouched = true;
  txForm.note.value = t.note || '';
  txForm.amount.value = t.amount;
  updateAmountHints();
  txForm.amount.focus();
  txForm.amount.select?.();
});

// Duplicar: el mismo movimiento con la fecha de hoy
$('#txDuplicate').addEventListener('click', () => {
  const t = state.transactions.find(x => x.id === editingTxId);
  if (!t) return;
  txDialog.close();
  const { id, createdAt, recurringId, createdBy, ...copy } = t;
  openTx(null, t.type);
  txForm.type.value = t.type;
  syncTxForm(copy);
  catTouched = true;
  txForm.amount.value = t.amount;
  txForm.note.value = t.note || '';
  txForm.date.value = todayStr();
  $('#txTitle').textContent = 'Duplicar movimiento';
  updateAmountHints();
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
