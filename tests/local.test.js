'use strict';
/* Pruebas en modo local (sin Firebase). Ejecutar: npm run test:local */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env;
before(async () => { env = await H.setup(); });
after(async () => { await env.close(); });

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

test('registrar un movimiento y que se guarde', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.addTx(p, { amount: 42.5, note: 'Prueba' });
  await p.reload(); await p.waitForFunction(() => !document.getElementById('splash'));
  const t = await p.evaluate(() => App.state.transactions.find(x => x.note === 'Prueba'));
  assert.equal(t.amount, 42.5);
  assert.deepEqual(p.errors, []);
});

test('el plan de ahorro coincide con un cálculo independiente', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.loadDemo(p);
  const r = await p.evaluate(() => {
    const L = App.state; const d = new Date(); d.setMonth(d.getMonth() - 1); const ym = ymFromDate(d);
    let ing = 0, sp = 0;
    for (const t of L.transactions) if (t.date.startsWith(ym)) {
      if (t.type === 'ingreso') ing += t.amount;
      if (t.type === 'gasto' && L.categories.find(c => c.id === t.categoryId).group !== 'ahorro') sp += t.amount;
    }
    const p = planFor(L, ym);
    return { target: p.target, saved: p.saved, expTarget: Math.round(ing * 20) / 100, expSaved: Math.round((ing - sp) * 100) / 100, status: p.status };
  });
  assert.equal(r.target, r.expTarget);
  assert.equal(r.saved, r.expSaved);
  assert.equal(r.status, 'cumplido');
  assert.deepEqual(p.errors, []);
});

test('varias monedas: tasa del día, transferencia y patrimonio', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url, '#ajustes');
  await p.click('[data-action=add-acc]');
  const ves = await p.evaluate(() => App.state.accounts.at(-1).id);
  await p.fill(`[data-acc-cur="${ves}"]`, 'VES'); await p.press(`[data-acc-cur="${ves}"]`, 'Tab');
  await p.fill('[data-rate=VES]', '40'); await p.press('[data-rate=VES]', 'Tab');
  await H.addTx(p, { amount: 400, note: 'Arepas', account: ves });
  const g = await p.evaluate(() => { const t = App.state.transactions.find(x => x.note === 'Arepas'); return { fx: t.fx, base: t._b }; });
  assert.equal(g.fx, 0.025); assert.equal(g.base, 10);
  // Cambiar la tasa no cambia el pasado
  await p.click('.tabs button[data-view=ajustes]');
  await p.fill('[data-rate=VES]', '50'); await p.press('[data-rate=VES]', 'Tab');
  assert.equal(await p.evaluate(() => App.state.transactions.find(x => x.note === 'Arepas')._b), 10);
  // Transferencia entre monedas
  const banco = await p.evaluate(() => App.state.accounts.find(a => a.name === 'Banco').id);
  await p.click('.tabs button[data-view=inicio]');
  await p.click('[data-action=quick][data-type=transferencia]');
  await p.selectOption('#txForm [name=accountId]', banco);
  await p.selectOption('#txForm [name=toAccountId]', ves);
  await p.fill('#txForm [name=amount]', '100');
  assert.equal(await p.inputValue('#txForm [name=toAmount]'), '5000');
  await p.click('#txForm button[type=submit]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(id => accountBalances()[id], ves), 4600);
  assert.deepEqual(p.errors, []);
});

test('pagos fijos: se ponen al día sin duplicar y los "por confirmar" se registran', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.addTx(p, { amount: 700, note: 'Alquiler', date: daysAgo(65), repeat: 'mensual' });
  await p.waitForTimeout(300);
  const n1 = await p.evaluate(() => App.state.transactions.filter(t => t.note === 'Alquiler').length);
  assert.ok(n1 >= 3, 'debería registrar los meses vencidos');
  await p.reload(); await p.waitForFunction(() => !document.getElementById('splash')); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => App.state.transactions.filter(t => t.note === 'Alquiler').length), n1);
  await H.addTx(p, { amount: 25, note: 'Gimnasio', date: daysAgo(10), repeat: 'semanal', auto: false });
  await p.click('.tabs button[data-view=inicio]');
  await p.click('.upcoming [data-action=rec-pay]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => App.state.transactions.filter(t => t.note === 'Gimnasio').length), 2);
  assert.deepEqual(p.errors, []);
});

test('registro rápido: recientes y categoría sugerida', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.loadDemo(p);
  await p.click('#fab');
  assert.ok(await p.locator('.recent').count() > 0);
  await p.click('.recent:has-text("Supermercado")');
  assert.equal(await p.evaluate(() => catById(txForm.categoryId.value).name), 'Comida');
  await p.keyboard.press('Escape');
  await p.click('#fab');
  await p.type('#txForm [name=note]', 'gasol');
  assert.equal(await p.evaluate(() => catById(txForm.categoryId.value).name), 'Transporte');
  assert.deepEqual(p.errors, []);
});

test('deudas: pagar baja el saldo y el plan calcula la fecha de libertad', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url, '#metas');
  await p.click('[data-action=metas-tab][data-tab=deudas]');
  await p.click('[data-action=debt-new]');
  await p.fill('#debtForm [name=name]', 'Visa'); await p.fill('#debtForm [name=amount]', '1000');
  await p.fill('#debtForm [name=rate]', '36'); await p.fill('#debtForm [name=minPay]', '100');
  await p.click('#debtForm button[type=submit]'); await p.waitForTimeout(150);
  const plan = await p.evaluate(() => payoffPlan(App.state, 'avalancha', 0));
  assert.ok(plan.months >= 11 && plan.months <= 13, `meses: ${plan.months}`);
  const id = await p.evaluate(() => App.state.debts[0].id);
  await p.click(`[data-action=debt-pay][data-id="${id}"]`);
  await p.click('#txForm button[type=submit]'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => debtInfo(App.state, App.state.debts[0]).remaining), 900);
  assert.deepEqual(p.errors, []);
});

test('reportes: totales correctos y PDF', async () => {
  const p = await H.localPage(env);
  await p.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  await H.open(p, env.url);
  await H.loadDemo(p);
  await p.click('.tabs button[data-view=presupuesto]');
  await p.click('.subtabs [data-tab=reportes]');
  const r = await p.evaluate(() => ({ tabla: [...document.querySelectorAll('.rep-table tfoot td')][1].textContent, gas: totals(monthTx(currentYM)).gas }));
  assert.equal(r.tabla, await p.evaluate(g => fmtS(g), r.gas));
  await p.click('[data-action=report-pdf]'); await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => window.__printed), true);
  assert.deepEqual(p.errors, []);
});

test('puntos: se ganan y se gastan en el armario de Ray', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.loadDemo(p);
  const before = await p.evaluate(() => myPoints());
  assert.ok(before.available >= 150);
  await p.click('.ray-stage');
  await p.click('[data-action=closet-slot][data-slot=hat]');
  await p.click('[data-action=closet-pick][data-id=gorraLima]'); await p.waitForTimeout(200);
  const afterP = await p.evaluate(() => ({ pts: myPoints().available, ray: App.stores.personal.settings.ray }));
  assert.equal(afterP.pts, before.available - 150);
  assert.equal(afterP.ray.hat, 'gorraLima');
  assert.deepEqual(p.errors, []);
});

test('Ray cambia de ánimo según las finanzas', async () => {
  const p = await H.localPage(env);
  await H.open(p, env.url);
  await H.loadDemo(p);
  await p.click('.tabs button[data-view=inicio]');
  assert.match(await p.getAttribute('.ray-card .ray', 'class'), /ray-feliz/);
  await H.addTx(p, { amount: 5000, note: 'Gasto enorme' });
  assert.match(await p.getAttribute('.ray-card .ray', 'class'), /ray-preocupado/);
  assert.deepEqual(p.errors, []);
});

test('bienvenida guiada: moneda, cuentas, tasa y plan', async () => {
  const p = await H.localPage(env, { welcome: true });
  await p.goto(env.url);
  await p.waitForSelector('#welcomeDialog[open]', { timeout: 15000 });
  await p.click('[data-wz=next]');
  await p.click('[data-wz-extra=VES]');
  await p.click('[data-wz=next]');
  await p.fill('[data-wz-acc="1"][data-k=initial]', '850');
  await p.click('[data-wz=add-acc]');
  await p.fill('[data-wz-acc="3"][data-k=name]', 'Bolívares');
  await p.selectOption('[data-wz-acc="3"][data-k=currency]', 'VES');
  await p.fill('[data-wz-acc="3"][data-k=initial]', '4000');
  await p.fill('[data-wz-rate=VES]', '40');
  await p.click('[data-wz=next]');
  await p.fill('[data-wz-income]', '2000');
  await p.click('[data-wz=next]');
  await p.click('[data-wz=close]'); await p.waitForTimeout(200);
  const s = await p.evaluate(() => ({ onboarded: App.state.settings.onboarded, expected: App.state.settings.plan.expected, total: sum(App.state.accounts.map(a => toBase(accountBalances()[a.id], accCur(App.state, a.id)))) }));
  assert.equal(s.onboarded, true); assert.equal(s.expected, 2000); assert.equal(s.total, 950);
  assert.deepEqual(p.errors, []);
});

test('bloqueo con PIN', async () => {
  const p = await H.localPage(env);
  const answers = ['1234', '1234'];
  p.removeAllListeners('dialog');
  p.on('dialog', d => d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept());
  await H.open(p, env.url, '#ajustes');
  await p.click('[data-action=lock-pin]'); await p.waitForTimeout(200);
  assert.ok(!(await p.evaluate(() => localStorage.getItem('rf-lock'))).includes('1234'), 'el PIN no se guarda en claro');
  await p.reload(); await p.waitForTimeout(800);
  assert.ok(await p.isVisible('#lockScreen'));
  for (const k of '0000') await p.click(`[data-pin="${k}"]`);
  assert.ok(await p.isVisible('#lockScreen'));
  for (const k of '1234') await p.click(`[data-pin="${k}"]`);
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.getElementById('lockScreen').hidden), true);
  assert.deepEqual(p.errors, []);
});
