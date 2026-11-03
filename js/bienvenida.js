'use strict';

/* =========================================================
   Bienvenida guiada (primera vez): Ray ayuda a configurar
   moneda, cuentas con su saldo, ingreso y plan de ahorro.
   Se carga antes de app.js.
   ========================================================= */

const WZ_CURS = ['USD', 'EUR', 'VES', 'COP', 'MXN', 'ARS', 'PEN', 'CLP', 'DOP', 'BRL'];
const WZ_EXTRA = ['USDT', 'USD', 'VES', 'EUR', 'COP'];
let wz = null;

/** ¿Hay que mostrar la bienvenida? Solo en lo personal, sin datos y sin haberla visto. */
function needsWelcome() {
  const L = stores.personal;
  if (!L || L.settings.onboarded) return false;
  const empty = !L.transactions.length && !(L.recurring || []).length && !(L.debts || []).length &&
    L.accounts.every(a => !Number(a.initial));
  return empty;
}

function maybeWelcome() {
  if (!needsWelcome() || $('#welcomeDialog').open) return;
  const L = stores.personal;
  wz = {
    step: 0,
    base: baseCur(L),
    extra: [],
    accounts: L.accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency || '', initial: '' })),
    rates: {},
    income: '',
    pct: Number(planOf(L).pct) || 20
  };
  renderWelcome();
  $('#welcomeDialog').showModal();
}

function wzCurrencies() { return [...new Set([wz.base, ...wz.extra])]; }

function renderWelcome() {
  const box = $('#welcomeBody');
  const steps = 4;
  const dots = `<div class="wz-dots">${Array.from({ length: steps + 1 }, (_, i) => `<i class="${i === wz.step ? 'on' : i < wz.step ? 'done' : ''}"></i>`).join('')}</div>`;
  const nav = (next = 'Siguiente', back = true) => `<div class="wz-nav">
    ${back ? '<button type="button" class="btn ghost" data-wz="back">Atrás</button>' : '<button type="button" class="btn ghost" data-wz="skip">Saltar</button>'}
    <span class="spacer"></span>
    <button type="button" class="btn primary" data-wz="next">${next}</button></div>`;
  const ray = mood => `<div class="wz-ray">${Ray.svg({ mood, ...rayOf(stores.personal) })}</div>`;
  let html = '';

  if (wz.step === 0) {
    html = `${ray('feliz')}
      <h2>¡Hola! Soy Ray ⚡</h2>
      <p>Te ayudo a configurar <b>RayFin</b> en menos de un minuto: tus monedas, tus cuentas con su saldo y tu plan de ahorro.</p>
      ${nav('Empezar', false)}`;
  } else if (wz.step === 1) {
    html = `<h2>Tus monedas</h2>
      <p>¿En qué moneda quieres ver tus totales?</p>
      <div class="pills">${WZ_CURS.map(c => `<button type="button" class="pill ${wz.base === c ? 'active' : ''}" data-wz-base="${c}">${c}</button>`).join('')}</div>
      <p style="margin-top:16px">¿Usas también otras monedas? <span class="muted">(opcional)</span></p>
      <div class="pills">${WZ_EXTRA.filter(c => c !== wz.base).map(c => `<button type="button" class="pill ${wz.extra.includes(c) ? 'active' : ''}" data-wz-extra="${c}">${c}</button>`).join('')}</div>
      ${nav()}`;
  } else if (wz.step === 2) {
    const curs = wzCurrencies();
    const others = curs.filter(c => c !== wz.base);
    html = `<h2>Tus cuentas</h2>
      <p>¿Cuánto tienes <b>hoy</b> en cada una? Así tu patrimonio empieza correcto.</p>
      ${wz.accounts.map((a, i) => `<div class="wz-acc">
        <input type="text" value="${esc(a.name)}" data-wz-acc="${i}" data-k="name" maxlength="40" aria-label="Nombre">
        <select data-wz-acc="${i}" data-k="currency" aria-label="Moneda">${curs.map(c => `<option ${(a.currency || wz.base) === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input type="number" step="0.01" inputmode="decimal" placeholder="0" value="${esc(a.initial)}" data-wz-acc="${i}" data-k="initial" aria-label="Saldo">
        <button type="button" class="icon-btn" data-wz="del-acc" data-i="${i}" aria-label="Quitar">✕</button>
      </div>`).join('')}
      <button type="button" class="btn small" data-wz="add-acc">+ Otra cuenta</button>
      ${others.length ? `<div class="subhead">Tasas de cambio</div>
        ${others.map(c => {
          const STRONG = ['USD', 'USDT', 'EUR'];
          const inv = STRONG.includes(wz.base) && !STRONG.includes(c);
          return `<div class="rate-row"><span>1 ${inv ? wz.base : c} =</span>
            <input type="number" min="0" step="0.0001" inputmode="decimal" value="${esc(wz.rates[c]?.shown || (c === 'USDT' && wz.base === 'USD' ? 1 : ''))}" data-wz-rate="${c}" data-inv="${inv ? 1 : ''}" placeholder="?">
            <span>${inv ? c : wz.base}</span></div>`;
        }).join('')}` : ''}
      ${nav()}`;
  } else if (wz.step === 3) {
    const inc = Number(wz.income) || 0;
    html = `<h2>Tu plan de ahorro</h2>
      <p>¿Cuánto ganas al mes, más o menos? <span class="muted">(${esc(wz.base)})</span></p>
      <input type="number" class="wz-big" min="0" step="0.01" inputmode="decimal" placeholder="Ej: 2000" value="${esc(wz.income)}" data-wz-income>
      <p style="margin-top:16px">¿Qué parte quieres ahorrar cada mes?</p>
      <div class="pills">${[10, 15, 20, 30].map(v => `<button type="button" class="pill ${wz.pct === v ? 'active' : ''}" data-wz-pct="${v}">${v}%</button>`).join('')}</div>
      <p class="wz-result" id="wzResult">${inc > 0 ? `Ahorrarías <b>${esc(fmtC(inc * wz.pct / 100, wz.base))}</b> al mes · <b>${esc(fmtC(inc * wz.pct * 12 / 100, wz.base))}</b> al año` : 'Lo recomendado es al menos el 20%.'}</p>
      ${nav('Listo')}`;
  } else {
    html = `${ray('feliz')}
      <h2>¡Todo listo! 🎉</h2>
      <p>Ya tienes tus cuentas y tu plan. Ahora lo más importante: <b>anota tus gastos</b> durante este mes. Yo te iré diciendo cómo vas.</p>
      <div class="wz-nav col">
        <button type="button" class="btn primary" data-wz="first">Registrar mi primer movimiento</button>
        <button type="button" class="btn ghost" data-wz="close">Ir a mi inicio</button>
      </div>`;
  }
  box.innerHTML = dots + html;
}

/** Guarda lo elegido en el libro personal. */
function finishWelcome() {
  const L = stores.personal;
  L.settings.currency = wz.base;
  const rates = { ...(L.settings.rates || {}) };
  for (const [c, r] of Object.entries(wz.rates)) if (r.value > 0) rates[c] = r.value;
  if (wz.extra.includes('USDT') && wz.base === 'USD' && !rates.USDT) rates.USDT = 1;
  L.settings.rates = rates;
  if (Object.values(wz.rates).some(r => r.value > 0)) L.settings.ratesUpdated = Date.now(); // tasa escrita a mano
  L.accounts = wz.accounts.filter(a => a.name.trim()).map(a => {
    const prev = L.accounts.find(x => x.id === a.id) || {};
    return { ...prev, id: a.id || uid(), name: a.name.trim(), currency: (a.currency || wz.base) === wz.base ? undefined : a.currency, initial: round2(a.initial) };
  });
  L.accounts.forEach(a => { if (a.currency === undefined) delete a.currency; });
  L.settings.plan = { ...planOf(L), mode: 'pct', pct: wz.pct, expected: round2(wz.income) };
  L.settings.onboarded = true;
  buildFormatter();
  curFmts.clear();
  ensureBase(L);
  persistLedger('personal', L);
  autoRates('personal'); // solo busca las tasas que falten
}

function initWelcome() {
  const dlg = $('#welcomeDialog');
  dlg.addEventListener('cancel', e => e.preventDefault()); // no cerrar con Escape por accidente
  dlg.addEventListener('click', e => {
    const t = e.target.closest('[data-wz], [data-wz-base], [data-wz-extra], [data-wz-pct]');
    if (!t) return;
    if (t.dataset.wzBase) { wz.base = t.dataset.wzBase; wz.extra = wz.extra.filter(c => c !== wz.base); renderWelcome(); return; }
    if (t.dataset.wzExtra) { const c = t.dataset.wzExtra; wz.extra = wz.extra.includes(c) ? wz.extra.filter(x => x !== c) : [...wz.extra, c]; renderWelcome(); return; }
    if (t.dataset.wzPct) { wz.pct = Number(t.dataset.wzPct); renderWelcome(); return; }
    const a = t.dataset.wz;
    if (a === 'next') {
      if (wz.step === 3) finishWelcome();
      wz.step++;
      if (wz.step === 2 && wz.extra.includes('USDT') && !wz.accounts.some(x => /usdt/i.test(x.name) && x.currency === 'USDT')) {
        const u = wz.accounts.find(x => /usdt/i.test(x.name));
        if (u) u.currency = 'USDT';
      }
      renderWelcome();
    } else if (a === 'back') { wz.step = Math.max(0, wz.step - 1); renderWelcome(); }
    else if (a === 'skip') {
      stores.personal.settings.onboarded = true;
      persistLedger('personal', stores.personal);
      dlg.close();
    } else if (a === 'add-acc') { wz.accounts.push({ id: uid(), name: '', currency: wz.base, initial: '' }); renderWelcome(); }
    else if (a === 'del-acc') { wz.accounts.splice(Number(t.dataset.i), 1); renderWelcome(); }
    else if (a === 'close' || a === 'first') {
      dlg.close();
      render();
      if (a === 'first') openTx(null, 'gasto');
    }
  });
  dlg.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.wzAcc !== undefined) wz.accounts[Number(t.dataset.wzAcc)][t.dataset.k] = t.value;
    else if (t.dataset.wzRate) {
      const v = Number(t.value);
      wz.rates[t.dataset.wzRate] = { shown: t.value, value: v > 0 ? (t.dataset.inv ? 1 / v : v) : 0 };
    } else if ('wzIncome' in t.dataset) {
      wz.income = t.value;
      const inc = Number(t.value) || 0;
      $('#wzResult').innerHTML = inc > 0 ? `Ahorrarías <b>${esc(fmtC(inc * wz.pct / 100, wz.base))}</b> al mes · <b>${esc(fmtC(inc * wz.pct * 12 / 100, wz.base))}</b> al año` : 'Lo recomendado es al menos el 20%.';
    }
  });
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.wzAcc !== undefined) wz.accounts[Number(t.dataset.wzAcc)][t.dataset.k] = t.value;
  });
}
