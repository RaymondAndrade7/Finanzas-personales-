'use strict';

/* RayFin — Interfaz general, vista Inicio, Ray y su armario. (parte de la app; se carga en orden desde index.html) */

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
      ${c.kind === 'space'
        ? `<button class="q" data-action="aportar"><span class="q-ico">${ICONS.users}</span>Aportar</button>`
        : `<button class="q" data-action="goto" data-view="metas"><span class="q-ico">${ICONS.flag}</span>Metas</button>`}
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
    ${c.kind === 'space' ? settleCard(c.space) : ''}
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
