'use strict';

/* RayFin — Vistas: Movimientos, Presupuesto, Metas y Ajustes. (parte de la app; se carga en orden desde index.html) */

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
    if (t.type === 'liquidacion') {
      const sp = currentSpace();
      title = 'Cuentas saldadas';
      sub = `${memberName(sp, t.from)} le pagó a ${memberName(sp, t.to)}`;
      cls = 'tr'; sign = ''; color = '#2fd6b0';
    } else if (t.type === 'transferencia') {
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
    if (isSpace() && t.type === 'gasto' && t.paidBy) sub += ` · pagó ${memberName(currentSpace(), t.paidBy).toLowerCase() === 'tú' ? 'tú' : memberName(currentSpace(), t.paidBy)}`;
    else if (isSpace() && t.createdBy && t.type !== 'liquidacion') sub += ` · ${t.createdBy.uid === window.Cloud?.uid ? 'tú' : firstName(t.createdBy.name)}`;
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

let metasTab = 'ahorro';
function metasTabs() {
  const tabs = [['ahorro', 'Ahorro'], ['deudas', 'Deudas'], ['logros', 'Logros']];
  return `<div class="pills subtabs">${tabs.map(([k, v]) => `<button class="pill ${metasTab === k ? 'active' : ''}" data-action="metas-tab" data-tab="${k}">${v}</button>`).join('')}</div>`;
}

function renderMetas() {
  const c = currentCtx();
  if (metasTab === 'deudas') { $('#view-metas').innerHTML = metasTabs() + debtsSection(); return; }
  if (metasTab === 'logros') {
    $('#view-metas').innerHTML = metasTabs() + (c.kind === 'personal' ? pointsCard()
      : `<div class="card ledger-note">${ICONS.user}<div>Los puntos y logros son personales: velos en <b>Yo</b>.</div></div>`);
    return;
  }
  const avg = avgMonthlyExpenses();
  const planBlock = c.kind === 'personal' ? planSettingsCard()
    : c.kind === 'partner' ? planCard(state, { who: c.short })
    : `<div class="card ledger-note">${ICONS.users}<div>Cada integrante configura su plan de ahorro en <b>sus finanzas personales</b> (selector <b>Yo</b>). Aquí, en Inicio, ven los planes de los dos.</div></div>`;
  $('#view-metas').innerHTML = `
    ${metasTabs()}
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
    ${securityCard()}
    ${ledgerTitle}
    ${c.kind === 'space' ? splitCard(c.space) : ''}
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

let needVerify = null;      // invitación que espera la verificación del correo
const shareChoice = {};     // lo que marcó la persona al aceptar

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
      <label class="check"><input type="checkbox" id="share-inv-${esc(i.id)}" ${shareChoice[i.id] === false ? '' : 'checked'}><span>Que también pueda ver mis finanzas personales (solo lectura)</span></label>
      ${needVerify === i.id ? `<div class="verify-box">
        <b>Confirma que este correo es tuyo</b>
        <span>Por seguridad, para unirte a un espacio necesitamos verificar <b>${esc(window.Cloud?.user?.email || '')}</b>. Te enviamos un enlace; ábrelo y luego toca «Ya lo confirmé».</span>
        <div class="row-actions"><button class="btn small" data-action="verify-send">Enviar correo</button>
          <button class="btn small primary" data-action="accept-invite" data-id="${esc(i.id)}">Ya lo confirmé</button></div>
      </div>` : ''}
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
