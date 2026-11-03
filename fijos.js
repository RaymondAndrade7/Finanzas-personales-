'use strict';

/* =========================================================
   Pagos fijos (movimientos recurrentes) y próximos pagos.
   Vive en cada libro: L.recurring = [{ id, type, amount, accountId,
   categoryId, toAccountId, toAmount, note, freq, day, next, auto, active }]
   Se carga antes de app.js; usa sus funciones al ejecutarse.
   ========================================================= */

const REC_SHORT = { mensual: 'Mensual', quincenal: 'Quincenal', semanal: 'Semanal', anual: 'Anual' };
const REC_FREQ = { mensual: 'Cada mes', quincenal: 'Cada 2 semanas', semanal: 'Cada semana', anual: 'Cada año' };

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Siguiente fecha según la frecuencia (los mensuales/anuales respetan el día original: 31 → 30 → 31). */
function advanceDate(dateStr, freq, day) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (freq === 'semanal' || freq === 'quincenal') {
    const dt = new Date(y, m - 1, d + (freq === 'semanal' ? 7 : 14));
    return isoDate(dt);
  }
  const months = freq === 'anual' ? 12 : 1;
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day || d, last));
  return isoDate(target);
}

/** Fechas de un pago fijo desde su próxima fecha hasta `until` (inclusive). */
function occurrences(r, until, max = 60) {
  const out = [];
  let d = r.next;
  while (d && d <= until && out.length < max) { out.push(d); d = advanceDate(d, r.freq, r.day); }
  return out;
}

/** Monto de un pago fijo en la moneda principal del libro. */
function recBase(L, r) {
  return r.amount * (rateOf(L, accCur(L, r.accountId)) || 1);
}

/** Movimiento a partir de un pago fijo, con id fijo por fecha (así nunca se duplica). */
function txFromRec(L, r, date) {
  const tx = {
    id: `rec-${r.id}-${date}`, createdAt: Date.now(), recurringId: r.id,
    type: r.type, amount: r.amount, date, accountId: r.accountId, note: r.note || ''
  };
  if (r.type === 'transferencia') { tx.toAccountId = r.toAccountId; if (r.toAmount) tx.toAmount = r.toAmount; }
  else tx.categoryId = r.categoryId;
  const cur = accCur(L, r.accountId);
  if (cur !== baseCur(L)) tx.fx = rateOf(L, cur) || undefined;
  if (r.createdBy) tx.createdBy = r.createdBy;
  return tx;
}

/** Registra los pagos automáticos que ya vencieron en un libro editable. */
function runRecurring(key) {
  const L = stores[key];
  if (!L || !Array.isArray(L.recurring) || !L.recurring.length || key.startsWith('user:')) return;
  const today = todayStr();
  const created = [];
  let changed = false;
  for (const r of L.recurring) {
    if (!r.active || !r.auto || !r.next || r.next > today) continue;
    for (const date of occurrences(r, today, 36)) {
      const tx = txFromRec(L, r, date);
      if (!L.transactions.some(t => t.id === tx.id)) { L.transactions.push(tx); created.push(tx); }
      r.next = advanceDate(date, r.freq, r.day);
      changed = true;
    }
  }
  if (!changed) return;
  ensureBase(L);
  persistLedger(key, L, created);
  if (created.length && key === ctxKey) toast(`Se registraron ${created.length} pago${created.length === 1 ? '' : 's'} fijo${created.length === 1 ? '' : 's'} ⚡`);
}

/** Guarda un libro que puede no ser el que se está viendo. */
function persistLedger(key, L, newTxs = []) {
  if (cloudOn()) {
    newTxs.forEach(t => window.Cloud.putTx(key, t).catch(cloudFail));
    window.Cloud.saveMeta(key, L).catch(cloudFail);
  } else if (L === state) {
    save();
  }
}

/** Próximos pagos de un libro (vencidos por confirmar + los de los próximos `days` días). */
function upcomingFor(L, days = 30) {
  const today = todayStr();
  const lim = new Date(); lim.setDate(lim.getDate() + days);
  const until = isoDate(lim);
  const items = [];
  for (const r of L.recurring || []) {
    if (!r.active || !r.next) continue;
    for (const date of occurrences(r, until, 8)) {
      items.push({ kind: 'rec', r, date, overdue: date < today || (date === today && !r.auto) });
    }
  }
  if (typeof debtsUpcoming === 'function') items.push(...debtsUpcoming(L, until));
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Lo que falta por pagar/cobrar este mes según los pagos fijos (en moneda principal). */
function committedFor(L, ym) {
  if (ym !== todayStr().slice(0, 7)) return { spend: 0, income: 0 };
  const end = isoDate(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  const today = todayStr();
  let spend = 0, income = 0;
  for (const r of L.recurring || []) {
    if (!r.active || !r.next) continue;
    for (const date of occurrences(r, end, 40)) {
      if (r.auto && date <= today) continue; // ya se registró sola
      if (r.type === 'gasto') {
        const g = L.categories.find(c => c.id === r.categoryId)?.group || 'gusto';
        if (g !== 'ahorro') spend += recBase(L, r);
      } else if (r.type === 'ingreso') income += recBase(L, r);
    }
  }
  return { spend, income };
}

const relDay = date => {
  const t0 = parseDate(todayStr()).getTime(), t1 = parseDate(date).getTime();
  const d = Math.round((t1 - t0) / 864e5);
  if (d < 0) return `hace ${-d} día${d === -1 ? '' : 's'}`;
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d < 7) return `en ${d} días`;
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(parseDate(date));
};

function recTitle(L, r) {
  if (r.type === 'transferencia') return r.note || 'Transferencia';
  const c = L.categories.find(x => x.id === r.categoryId);
  return r.note || c?.name || 'Pago fijo';
}

function upcomingRow(L, it, editable) {
  if (it.kind === 'debt') return debtUpcomingRow(L, it, editable);
  const r = it.r;
  const c = L.categories.find(x => x.id === r.categoryId);
  const cls = r.type === 'ingreso' ? 'ing' : r.type === 'gasto' ? 'gas' : 'tr';
  const sign = r.type === 'ingreso' ? '+' : r.type === 'gasto' ? '−' : '';
  return `<div class="up-row ${it.overdue ? 'due' : ''}">
    <i class="dot" style="background:${safeColor(c?.color || '#94a3b8')}"></i>
    <div class="grow"><div class="up-title">${esc(recTitle(L, r))}</div>
      <div class="up-sub">${esc(relDay(it.date))} · ${esc(REC_FREQ[r.freq] || '')}${r.auto ? '' : ' · por confirmar'}</div></div>
    <div class="up-amt ${cls}">${sign}${esc(fmtC(r.amount, accCur(L, r.accountId)))}</div>
    ${editable && it.overdue && !r.auto ? `<div class="up-act">
      <button class="btn small primary" data-action="rec-pay" data-id="${esc(r.id)}" data-date="${it.date}">Registrar</button>
      <button class="btn small ghost" data-action="rec-skip" data-id="${esc(r.id)}">Saltar</button></div>` : ''}
  </div>`;
}

/** Tarjeta "Próximos pagos" en Inicio. */
function upcomingCard() {
  const items = upcomingFor(state, 30);
  if (!items.length) return '';
  const editable = !isReadOnly();
  const due = items.filter(i => i.overdue);
  // Solo el próximo de cada pago (un pago semanal no debe llenar la lista)
  const seen = new Set();
  const shown = [...due, ...items.filter(i => !i.overdue)].filter(i => {
    const k = (i.kind === 'rec' ? i.r.id : i.id) + (i.overdue ? i.date : '');
    if (seen.has(k) || (!i.overdue && seen.has((i.kind === 'rec' ? i.r.id : i.id) + 'next'))) return false;
    seen.add(k); if (!i.overdue) seen.add((i.kind === 'rec' ? i.r.id : i.id) + 'next');
    return true;
  }).slice(0, 5);
  const spend = sum(items.filter(i => !i.overdue || !i.r?.auto).filter(i => (i.kind === 'rec' && i.r.type === 'gasto') || i.kind === 'debt').map(i => i.kind === 'debt' ? i.base : recBase(state, i.r)));
  return `<div class="card upcoming">
    <div class="card-head"><h2>Próximos pagos</h2>${editable ? `<button class="link" data-action="budget-tab" data-tab="fijos">Ver todos ${ICONS.chevron}</button>` : ''}</div>
    ${due.length ? `<p class="up-alert">${due.length} pago${due.length === 1 ? '' : 's'} por confirmar</p>` : ''}
    ${shown.map(it => upcomingRow(state, it, editable)).join('')}
    <div class="up-total"><span>Por pagar en 30 días</span><b class="gas">${esc(fmt(spend))}</b></div>
  </div>`;
}

/** Lista para administrar los pagos fijos (en Presupuesto). */
function recurringSection() {
  const L = state;
  const list = (L.recurring || []).slice().sort((a, b) => (b.active - a.active) || String(a.next).localeCompare(String(b.next)));
  const ro = isReadOnly();
  const rows = list.map(r => {
    const c = L.categories.find(x => x.id === r.categoryId);
    const cls = r.type === 'ingreso' ? 'ing' : r.type === 'gasto' ? 'gas' : 'tr';
    return `<div class="rec-row ${r.active ? '' : 'paused'}">
      <i class="dot" style="background:${safeColor(c?.color || '#94a3b8')}"></i>
      <div class="grow">
        <div class="up-title">${esc(recTitle(L, r))}</div>
        <div class="up-sub">${esc(REC_SHORT[r.freq] || '')} · ${r.active ? esc(relDay(r.next)) : 'en pausa'}${r.auto ? '' : ' · por confirmar'}</div>
      </div>
      <div class="up-amt ${cls}">${esc(fmtC(r.amount, accCur(L, r.accountId)))}</div>
      ${ro ? '' : `<div class="rec-actions">
        <button class="icon-btn" data-action="rec-edit" data-id="${esc(r.id)}" aria-label="Editar" title="Editar">✎</button>
        <button class="icon-btn" data-action="rec-toggle" data-id="${esc(r.id)}" aria-label="${r.active ? 'Pausar' : 'Reanudar'}" title="${r.active ? 'Pausar' : 'Reanudar'}">${r.active ? '❚❚' : '▶'}</button>
        <button class="icon-btn" data-action="rec-del" data-id="${esc(r.id)}" aria-label="Eliminar" title="Eliminar">✕</button>
      </div>`}
    </div>`;
  }).join('');
  const { spend, income } = committedFor(L, todayStr().slice(0, 7));
  return `<div class="card">
    <div class="card-head"><h2>Pagos fijos</h2>${ro ? '' : '<button class="btn small primary" data-action="rec-new">+ Nuevo</button>'}</div>
    <p class="muted" style="margin:-6px 0 8px;font-size:.85rem">Alquiler, suscripciones, sueldo… Se registran solos en su fecha o te los recuerdo para confirmar.</p>
    ${rows || empty('Aún no tienes pagos fijos. Al registrar un movimiento, elige <b>Repetir</b>.')}
    ${list.length ? `<div class="suggest" style="margin-top:12px">
      <div><small>Por pagar este mes</small><b class="gas">${esc(fmtS(spend))}</b></div>
      <div><small>Por cobrar este mes</small><b class="ing">${esc(fmtS(income))}</b></div>
      <div><small>Pagos activos</small><b>${list.filter(r => r.active).length}</b></div>
    </div>` : ''}
  </div>`;
}
