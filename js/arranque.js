'use strict';

/* RayFin — Arranque de la app y API para cloud.js. (parte de la app; se carga en orden desde index.html) */

/* ---------- Inicio ---------- */

/** La bienvenida espera a que termine la presentación. */
function welcomeWhenReady() {
  const tryIt = () => (document.getElementById('splash') || !$('#lockScreen').hidden ? setTimeout(tryIt, 300) : maybeWelcome());
  setTimeout(tryIt, 300);
}

applyTheme(getTheme());
// Al volver a la app, revisar si toca actualizar las tasas (local o nube)
document.addEventListener('visibilitychange', () => { if (!document.hidden && appStarted) autoRates(ctxKey); });
initLock();
initWelcome();
initDebtDialog();
initContribDialog();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getTheme()));
buildFormatter();
const VIEWS = ['inicio', 'movimientos', 'presupuesto', 'metas', 'ajustes'];
const startView = () => setView(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio');
let appStarted = false;

// API usada por cloud.js (inicio de sesión y base de datos)
window.App = {
  CLOUD_ENABLED,
  EMULATOR,
  get state() { return state; },
  defaultState,
  normalize,
  readLocal,
  clearLocal() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin acceso */ } },
  toast,
  get stores() { return stores; },
  /** Datos de un libro llegados de la nube (personal, space:ID o user:UID). */
  setStore(key, data) {
    stores[key] = normalize(data);
    if (key === 'personal' || key.startsWith('space:')) setTimeout(() => { runRecurring(key); autoRates(key); }, 0);
    if (key === ctxKey) {
      state = stores[key];
      buildFormatter();
      if (appStarted) render();
    } else if (appStarted && isSpace() && currentView === 'inicio') {
      render(); // el espacio muestra los planes de ahorro de cada integrante
    }
    if (appStarted) renderCtxBar();
  },
  setState(s) { this.setStore('personal', s); },
  /** Un libro dejó de estar disponible (se salió del espacio o dejaron de compartir). */
  dropStore(key) {
    delete stores[key];
    if (key === ctxKey) {
      if (appStarted) { switchCtx('personal'); toast('Ya no tienes acceso a esas finanzas'); }
      else { ctxKey = 'personal'; state = stores.personal; }
    } else if (appStarted) renderCtxBar();
  },
  /** Espacios, invitaciones y personas que comparten contigo. */
  setSharing(info) {
    sharing = info;
    if (!appStarted) return;
    if (!contexts().some(c => c.key === ctxKey)) { switchCtx('personal'); return; }
    renderCtxBar();
    // No redibujar Ajustes si la persona está escribiendo ahí
    const typing = currentView === 'ajustes' && document.activeElement?.matches?.('#sharingCard input');
    if (!typing && (currentView === 'ajustes' || currentView === 'inicio')) render();
  },
  /** Muestra la app tras iniciar sesión. */
  enter() {
    document.body.classList.remove('auth-mode');
    appStarted = true;
    showLock();
    startView();
    welcomeWhenReady();
  }
};

if (CLOUD_ENABLED) {
  document.body.classList.add('auth-mode'); // cloud.js muestra el inicio de sesión
} else {
  appStarted = true;
  showLock();
  runRecurring('personal');
  autoRates('personal');
  startView();
  welcomeWhenReady();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Al publicarse una versión nueva, se activa y la página se recarga sola una vez.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // Buscar actualizaciones al volver a la app
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      })
      .catch(() => {});
  });
}
