'use strict';

/* RayFin — Acciones (clics y cambios), exportar y datos de ejemplo. (parte de la app; se carga en orden desde index.html) */

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
    case 'lock-bio': enableBio(); break;
    case 'lock-pin': enablePin(); break;
    case 'lock-now': showLock(); break;
    case 'lock-after': setLockCfg({ ...lockCfg(), after: Number(btn.dataset.v) }); render(); break;
    case 'lock-off':
      if (confirm('¿Quitar el bloqueo en este dispositivo?')) { setLockCfg(null); render(); toast('Bloqueo desactivado'); }
      break;
    case 'report-pdf': printReport(); break;
    case 'aportar': openContrib(); break;
    case 'settle': {
      const sp = currentSpace();
      const amt = Number(btn.dataset.amount);
      if (confirm(`¿Confirmas que ${memberName(sp, btn.dataset.from)} le pagó ${fmt(amt)} a ${memberName(sp, btn.dataset.to)}?`)) {
        recordSettlement(btn.dataset.from, btn.dataset.to, amt);
      }
      break;
    }
    case 'split-mode':
      if (guardRO()) break;
      state.settings.split = { ...(state.settings.split || {}), mode: btn.dataset.mode };
      if (btn.dataset.mode === 'manual' && !state.settings.split.manual) {
        const sh = splitShares(state, currentSpace());
        state.settings.split.manual = Object.fromEntries(Object.entries(sh).map(([u, v]) => [u, Math.round(v * 100)]));
      }
      save(); render();
      break;
    case 'metas-tab': metasTab = btn.dataset.tab; setView('metas'); break;
    case 'debt-new': if (!guardRO()) openDebt(); break;
    case 'debt-edit': if (!guardRO()) openDebt(state.debts.find(d => d.id === id)); break;
    case 'debt-pay': if (!guardRO()) payDebt(id); break;
    case 'debt-del':
      if (guardRO() || !confirm('¿Eliminar esta deuda? Los pagos registrados se quedan como movimientos.')) break;
      state.debts = state.debts.filter(d => d.id !== id);
      save(); render();
      break;
    case 'debt-strategy':
      if (guardRO()) break;
      state.settings.debtStrategy = btn.dataset.v;
      save(); render();
      break;
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
      const share = $('#share-inv-' + id)?.checked ?? shareChoice[id] ?? true;
      shareChoice[id] = share;
      btn.disabled = true;
      window.Cloud.acceptInvite(id, !!share)
        .then(() => { needVerify = null; toast('¡Listo! Ya comparten este espacio'); })
        .catch(err => {
          btn.disabled = false;
          if (err?.code === 'needs-verification') { needVerify = id; render(); toast('Primero confirma tu correo'); }
          else cloudFail(err);
        });
      break;
    }
    case 'verify-send':
      window.Cloud.sendVerification()
        .then(() => toast('Te enviamos un correo. Abre el enlace y vuelve aquí.'))
        .catch(() => toast('No se pudo enviar. Intenta en unos minutos.'));
      break;
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
  if (d.split) {
    if (guardRO()) return;
    const sp = state.settings.split || { mode: 'manual' };
    sp.manual = { ...(sp.manual || {}), [d.split]: Math.max(0, Math.round(Number(t.value) || 0)) };
    state.settings.split = sp;
    save(); render();
    return;
  }
  if ('debtExtra' in d) {
    if (guardRO()) return;
    state.settings.debtExtra = Math.max(0, round2(t.value));
    save(); render();
    return;
  }
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
