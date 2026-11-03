'use strict';

/* =========================================================
   Bloqueo de la app (por dispositivo): huella / Face ID o PIN.
   - Huella / Face ID: WebAuthn con el autenticador del dispositivo.
   - PIN: se guarda solo su huella (SHA-256 con sal), nunca el PIN.
   Es una protección de privacidad en el dispositivo; los datos en la
   nube siguen protegidos por el inicio de sesión y las reglas.
   Se carga antes de app.js.
   ========================================================= */

const LOCK_KEY = 'rf-lock';
let lockedAt = 0, hiddenAt = 0, pinTries = 0, pinWaitUntil = 0, pinBuffer = '';

function lockCfg() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; }
}
function setLockCfg(c) {
  try { c ? localStorage.setItem(LOCK_KEY, JSON.stringify(c)) : localStorage.removeItem(LOCK_KEY); } catch { /* sin acceso */ }
}

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));

async function sha(text) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

async function registerBio() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'RayFin' },
      user: { id: rand(16), name: 'rayfin', displayName: 'RayFin' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000
    }
  });
  return b64(cred.rawId);
}

async function checkBio(credId) {
  const res = await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(credId) }], userVerification: 'required', timeout: 60000 }
  });
  return !!res;
}

/* ---------- Pantalla de bloqueo ---------- */
function showLock() {
  const cfg = lockCfg();
  if (!cfg) return;
  const el = $('#lockScreen');
  if (!el.hidden) return;
  lockedAt = Date.now();
  pinBuffer = '';
  el.hidden = false;
  document.body.classList.add('locked');
  $('#lockRay').innerHTML = Ray.svg({ mood: 'dormido', ...rayOf(stores.personal) });
  $('#lockBio').hidden = !cfg.credId;
  $('#lockPin').hidden = !cfg.pinHash;
  $('#lockMsg').textContent = '';
  renderPinDots();
  if (cfg.credId) setTimeout(() => unlockBio(), 250);
}

function hideLock() {
  $('#lockScreen').hidden = true;
  document.body.classList.remove('locked');
  pinTries = 0;
}

async function unlockBio() {
  const cfg = lockCfg();
  try {
    if (await checkBio(cfg.credId)) hideLock();
  } catch {
    $('#lockMsg').textContent = cfg.pinHash ? 'No se pudo con huella. Usa tu PIN.' : 'No se pudo. Toca el botón para intentar de nuevo.';
  }
}

function renderPinDots() {
  $('#pinDots').innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < pinBuffer.length ? 'on' : ''}"></i>`).join('');
}

async function pressPin(k) {
  const cfg = lockCfg();
  if (Date.now() < pinWaitUntil) { $('#lockMsg').textContent = `Espera ${Math.ceil((pinWaitUntil - Date.now()) / 1000)} s`; return; }
  if (k === 'del') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 6) pinBuffer += k;
  renderPinDots();
  if (pinBuffer.length >= (cfg.pinLen || 4)) {
    const ok = (await sha(cfg.salt + pinBuffer)) === cfg.pinHash;
    if (ok) { hideLock(); return; }
    pinTries++;
    pinBuffer = '';
    renderPinDots();
    $('#pinDots').classList.add('shake');
    setTimeout(() => $('#pinDots').classList.remove('shake'), 400);
    if (pinTries >= 5) { pinWaitUntil = Date.now() + 30000; pinTries = 0; $('#lockMsg').textContent = 'Demasiados intentos. Espera 30 segundos.'; }
    else $('#lockMsg').textContent = 'PIN incorrecto';
  }
}

async function forgotPin() {
  if (window.Cloud?.user) {
    if (confirm('Para quitar el bloqueo, cierra sesión y vuelve a entrar con tu correo y contraseña. ¿Cerrar sesión?')) {
      setLockCfg(null);
      window.Cloud.logout();
    }
  } else if (confirm('En modo local, quitar el bloqueo borra los datos de este dispositivo (por seguridad). ¿Continuar?')) {
    setLockCfg(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin acceso */ }
    location.reload();
  }
}

/* ---------- Ajustes ---------- */
function securityCard() {
  const cfg = lockCfg();
  const after = cfg?.after ?? 1;
  return `<div class="card">
    <h2>Seguridad</h2>
    <p class="muted" style="margin:-6px 0 10px;font-size:.85rem">Pide tu huella, Face ID o un PIN para abrir RayFin en <b>este dispositivo</b>.</p>
    ${cfg ? `
      <div class="rows">
        <div class="row"><span class="grow">Bloqueo</span><span class="ok">Activado · ${cfg.credId ? 'huella / Face ID' : ''}${cfg.credId && cfg.pinHash ? ' + ' : ''}${cfg.pinHash ? 'PIN' : ''}</span></div>
      </div>
      <div class="subhead">Pedirlo al volver a la app</div>
      <div class="pills">${[[0, 'Al instante'], [1, 'Después de 1 min'], [5, 'Después de 5 min']].map(([v, l]) =>
        `<button class="pill sm ${after === v ? 'active' : ''}" data-action="lock-after" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="row-actions" style="margin-top:12px">
        ${cfg.credId ? '' : '<button class="btn small" data-action="lock-bio">Agregar huella / Face ID</button>'}
        ${cfg.pinHash ? '' : '<button class="btn small" data-action="lock-pin">Agregar PIN de respaldo</button>'}
        <button class="btn small" data-action="lock-now">Bloquear ahora</button>
        <button class="btn small danger" data-action="lock-off">Quitar bloqueo</button>
      </div>`
    : `<div class="row-actions">
        <button class="btn small primary" data-action="lock-bio" id="lockBioBtn">Usar huella / Face ID</button>
        <button class="btn small" data-action="lock-pin">Usar un PIN</button>
      </div>`}
  </div>`;
}

async function enableBio() {
  if (!(await bioAvailable())) { toast('Este dispositivo no tiene huella ni Face ID disponibles. Usa un PIN.'); return; }
  try {
    const credId = await registerBio();
    setLockCfg({ ...(lockCfg() || { after: 1 }), credId });
    render();
    toast('Bloqueo con huella / Face ID activado 🔒');
  } catch {
    toast('No se pudo activar. Intenta de nuevo o usa un PIN.');
  }
}

async function enablePin() {
  const pin = prompt('Escribe un PIN de 4 a 6 números:');
  if (pin === null) return;
  if (!/^\d{4,6}$/.test(pin)) { toast('El PIN debe tener de 4 a 6 números.'); return; }
  const again = prompt('Repite el PIN:');
  if (again !== pin) { toast('Los PIN no coinciden.'); return; }
  const salt = b64(rand(16));
  setLockCfg({ ...(lockCfg() || { after: 1 }), salt, pinHash: await sha(salt + pin), pinLen: pin.length });
  render();
  toast('Bloqueo con PIN activado 🔒');
}

function initLock() {
  $('#lockBio').addEventListener('click', unlockBio);
  $('#lockForgot').addEventListener('click', forgotPin);
  $('#lockScreen').addEventListener('click', e => {
    const k = e.target.closest('[data-pin]');
    if (k) pressPin(k.dataset.pin);
  });
  document.addEventListener('keydown', e => {
    if ($('#lockScreen').hidden) return;
    if (/^\d$/.test(e.key)) pressPin(e.key);
    else if (e.key === 'Backspace') pressPin('del');
  });
  // Al volver a la app después del tiempo elegido
  document.addEventListener('visibilitychange', () => {
    const cfg = lockCfg();
    if (!cfg) return;
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= (Number(cfg.after) || 0) * 60000) showLock();
  });
}
