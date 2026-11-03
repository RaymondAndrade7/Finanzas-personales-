'use strict';
/* Pruebas con Firebase (emulador). Ejecutar: npm run test:nube */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env;
before(async () => { env = await H.setup(); });
after(async () => { await env.close(); });
beforeEach(async () => { await H.resetEmulator(); });

/** Ana crea "Casa" e invita a Beto; Beto verifica su correo y acepta compartiendo lo personal. */
async function couple() {
  const ana = await H.cloudPage(env), beto = await H.cloudPage(env);
  await H.signup(ana, env.url, 'ana@test.com', 'Ana');
  await H.signup(beto, env.url, 'beto@test.com', 'Beto');
  await ana.click('.tabs button[data-view=ajustes]');
  await ana.fill('#newSpaceName', 'Casa');
  await ana.fill('#newSpaceEmail', 'Beto@Test.com');
  await ana.click('[data-action=create-space]');
  await ana.waitForFunction(() => Object.keys(App.stores).some(k => k.startsWith('space:')), null, { timeout: 15000 });
  await beto.click('.tabs button[data-view=inicio]');
  await beto.waitForSelector('.invite-banner', { timeout: 15000 });
  await beto.click('.invite-banner [data-action=goto]');
  await beto.click('[data-action=accept-invite]');
  await beto.waitForSelector('.verify-box', { timeout: 15000 }).catch(() => {});
  return { ana, beto };
}

test('compartir: invitación con correo verificado, solo lectura y permisos', async () => {
  const { ana, beto } = await couple();
  assert.ok(await beto.isVisible('.verify-box'), 'debe pedir verificar el correo');
  await H.verifyEmail(await beto.evaluate(() => Cloud.uid));
  await beto.click('.verify-box [data-action=accept-invite]');
  await ana.waitForFunction(() => document.querySelectorAll('#ctxBar .ctx').length >= 3, null, { timeout: 15000 });
  await beto.waitForFunction(() => document.querySelectorAll('#ctxBar .ctx').length >= 3, null, { timeout: 15000 });
  assert.deepEqual(await H.ctxNames(ana), ['Yo', 'Casa', 'Beto']);
  assert.deepEqual(await H.ctxNames(beto), ['Yo', 'Casa', 'Ana']);

  // Movimiento en el espacio visible para los dos, con su autor
  await ana.click('#ctxBar .ctx:nth-child(2)');
  await H.addTx(ana, { amount: 50, note: 'Super de Ana' });
  await beto.click('#ctxBar .ctx:nth-child(2)');
  await beto.waitForFunction(() => App.state.transactions.some(t => t.note === 'Super de Ana'), null, { timeout: 15000 });
  const seen = await beto.evaluate(() => App.state.transactions.find(t => t.note === 'Super de Ana'));
  assert.equal(seen.createdBy.name, 'Ana');

  // Ana no puede escribir en las finanzas personales de Beto
  const betoUid = await beto.evaluate(() => Cloud.uid);
  const write = await ana.evaluate(async ([FS, uid]) => {
    const F = await import(FS);
    try { await F.setDoc(F.doc(F.getFirestore(), 'users', uid, 'transactions', 'x'), { amount: 1, date: '2026-01-01' }); return 'ESCRIBIÓ'; } catch (e) { return e.code; }
  }, [H.FS_URL, betoUid]);
  assert.equal(write, 'permission-denied');

  // Una persona ajena no ve nada
  const carla = await H.cloudPage(env);
  await H.signup(carla, env.url, 'carla@test.com', 'Carla');
  const sid = await ana.evaluate(() => Object.keys(App.stores).find(k => k.startsWith('space:')).slice(6));
  const anaUid = await ana.evaluate(() => Cloud.uid);
  const r = await carla.evaluate(async ([FS, sid, anaUid]) => {
    const F = await import(FS); const db = F.getFirestore(); const out = {};
    const t = async (k, fn) => { try { await fn(); out[k] = 'PERMITIDO'; } catch (e) { out[k] = e.code; } };
    await t('espacio', () => F.getDocFromServer(F.doc(db, 'spaces', sid)));
    await t('ana', () => F.getDocFromServer(F.doc(db, 'users', anaUid)));
    return out;
  }, [H.FS_URL, sid, anaUid]);
  assert.deepEqual(r, { espacio: 'permission-denied', ana: 'permission-denied' });
  for (const pg of [ana, beto, carla]) assert.deepEqual(pg.errors, []);
});

test('regla: sin correo verificado no se puede unir a un espacio', async () => {
  const ana = await H.cloudPage(env), carla = await H.cloudPage(env);
  await H.signup(ana, env.url, 'ana@test.com', 'Ana');
  await H.signup(carla, env.url, 'carla@test.com', 'Carla');
  await ana.click('.tabs button[data-view=ajustes]');
  await ana.fill('#newSpaceName', 'Casa'); await ana.fill('#newSpaceEmail', 'carla@test.com');
  await ana.click('[data-action=create-space]');
  await ana.waitForFunction(() => Object.keys(App.stores).some(k => k.startsWith('space:')), null, { timeout: 15000 });
  const sid = await ana.evaluate(() => Object.keys(App.stores).find(k => k.startsWith('space:')).slice(6));
  const join = () => carla.evaluate(async ([FS, AU, sid]) => {
    const F = await import(FS); const A = await import(AU);
    const u = A.getAuth().currentUser; await u.reload(); await u.getIdToken(true);
    try {
      await F.updateDoc(F.doc(F.getFirestore(), 'spaces', sid), { members: F.arrayUnion(u.uid), invitedEmails: F.arrayRemove('carla@test.com'), ['memberInfo.' + u.uid]: { name: 'Carla', email: 'carla@test.com' } });
      return 'UNIDA';
    } catch (e) { return e.code; }
  }, [H.FS_URL, H.AUTH_URL, sid]);
  assert.equal(await join(), 'permission-denied');
  await H.verifyEmail(await carla.evaluate(() => Cloud.uid));
  assert.equal(await join(), 'UNIDA');
});

test('pareja: aportar, quién pagó y cuentas claras', async () => {
  const { ana, beto } = await couple();
  await H.verifyEmail(await beto.evaluate(() => Cloud.uid));
  await beto.click('.verify-box [data-action=accept-invite]');
  await ana.waitForFunction(() => document.querySelectorAll('#ctxBar .ctx').length >= 3, null, { timeout: 15000 });
  // Ana aporta 500
  await ana.click('#ctxBar .ctx:nth-child(2)'); await ana.click('.tabs button[data-view=inicio]');
  await ana.click('[data-action=aportar]');
  await ana.fill('#contribForm [name=amount]', '500');
  await ana.click('#contribForm button[type=submit]'); await H.sleep(1500);
  assert.ok(await ana.evaluate(() => App.stores.personal.transactions.some(t => t.id.startsWith('ap-') && t.type === 'gasto' && t.amount === 500)));
  // Beto paga 100; Ana registra 300 del fondo común
  await beto.click('#ctxBar .ctx:nth-child(2)');
  await H.addTx(beto, { amount: 100, note: 'Mercado' });
  await ana.click('[data-action=quick][data-type=gasto]');
  await ana.selectOption('#txForm [name=paidBy]', 'pot');
  await ana.fill('#txForm [name=amount]', '300');
  await ana.click('#txForm button[type=submit]');
  await ana.waitForFunction(() => App.state.transactions.some(t => t.note === 'Mercado'), null, { timeout: 15000 });
  await ana.click('.tabs button[data-view=movimientos]'); await ana.click('.tabs button[data-view=inicio]');
  await ana.waitForFunction(() => /te debe 200,00/.test(document.querySelector('.settle-line')?.textContent || ''), null, { timeout: 15000 });
  // Saldar
  await beto.waitForFunction(() => App.state.transactions.filter(t => t.type === 'gasto').length >= 2, null, { timeout: 15000 });
  await beto.click('.tabs button[data-view=movimientos]'); await beto.click('.tabs button[data-view=inicio]');
  await beto.waitForSelector('[data-action=settle]', { timeout: 15000 });
  await beto.click('[data-action=settle]');
  await beto.waitForFunction(() => /a mano/.test(document.querySelector('.settle-line')?.textContent || ''), null, { timeout: 15000 });
  for (const pg of [ana, beto]) assert.deepEqual(pg.errors, []);
});
