'use strict';
/* Utilidades para las pruebas: servidor de archivos, navegador y atajos. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FS_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const AUTH_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Sirve la app desde la carpeta del repositorio. */
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://localhost:${srv.address().port}/` }));
  });
}

async function setup() {
  const server = await startServer();
  const browser = await chromium.launch();
  return { ...server, browser, async close() { await browser.close(); server.srv.close(); } };
}

/** Página en modo local (sin Firebase), con la bienvenida ya vista. */
// Sin service worker: sus peticiones no pasan por page.route y cargarían la configuración real.
async function localPage(env, { welcome = false, theme } = {}) {
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('**/firebase-config.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG = {};' }));
  if (!welcome) await ctx.addInitScript(() => { try { if (!localStorage.getItem('mis-finanzas-v1')) localStorage.setItem('mis-finanzas-v1', JSON.stringify({ settings: { onboarded: true } })); } catch (e) {} });
  if (theme) await ctx.addInitScript(t => { try { localStorage.setItem('mf-theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  page.errors = errors;
  return page;
}

async function open(page, url, hash = '') {
  await page.goto(url + hash);
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 });
}

async function loadDemo(page) {
  await page.click('.tabs button[data-view=ajustes]');
  await page.click('[data-action=demo]');
  await page.waitForTimeout(300);
}

/** Registra un movimiento con el formulario. */
async function addTx(page, { type = 'gasto', amount, note = '', date, account, repeat, auto = true } = {}) {
  await page.click('.tabs button[data-view=inicio]');
  await page.click(`[data-action=quick][data-type=${type}]`);
  await page.fill('#txForm [name=amount]', String(amount));
  if (date) await page.fill('#txForm [name=date]', date);
  if (account) await page.selectOption('#txForm [name=accountId]', account);
  if (note) await page.fill('#txForm [name=note]', note);
  if (repeat) { await page.selectOption('#txForm [name=repeat]', repeat); if (!auto) await page.uncheck('#txForm [name=auto]'); }
  await page.click('#txForm button[type=submit]');
  await page.waitForTimeout(250);
}

/* ---------- Nube (emulador) ---------- */
const EMU = { auth: 'http://127.0.0.1:9099', fs: 'http://127.0.0.1:8080', project: 'demo-finanzas' };

async function resetEmulator() {
  await fetch(`${EMU.fs}/emulator/v1/projects/${EMU.project}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${EMU.auth}/emulator/v1/projects/${EMU.project}/accounts`, { method: 'DELETE' });
}

async function verifyEmail(uid) {
  await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${EMU.project}/accounts:update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, emailVerified: true })
  });
}

async function cloudPage(env) {
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  page.errors = errors;
  return page;
}

async function signup(page, url, email, name) {
  await page.goto(url + '?emulador');
  await page.waitForSelector('#authPanel:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 });
  await page.click('#authToggle');
  await page.fill('#authForm [name=name]', name);
  await page.fill('#authForm [name=email]', email);
  await page.fill('#authForm [name=password]', 'secreto123');
  await page.click('#authSubmit');
  await page.waitForFunction(() => !document.body.classList.contains('auth-mode'), null, { timeout: 20000 });
  await page.waitForSelector('#welcomeDialog[open]', { timeout: 9000 }).then(() => page.click('[data-wz=skip]')).catch(() => {});
  await sleep(800);
}

const ctxNames = page => page.evaluate(() => [...document.querySelectorAll('#ctxBar .ctx')].map(b => b.textContent.trim()));

module.exports = { setup, localPage, open, loadDemo, addTx, resetEmulator, verifyEmail, cloudPage, signup, ctxNames, sleep, FS_URL, AUTH_URL };
