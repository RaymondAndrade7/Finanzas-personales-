'use strict';

/* =========================================================
   Presentación de RayFin: el nombre aparece en el centro y,
   cuando la app está lista, viaja hasta su lugar (panel de
   inicio de sesión o barra superior) mientras todo aparece.
   ========================================================= */
(function () {
  const splash = document.getElementById('splash');
  if (!splash) return;

  const body = document.body;
  const word = splash.querySelector('.splash-word');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const MIN_MS = reduce ? 500 : 2300;   // tiempo mínimo de la presentación
  const MAX_MS = 7000;                   // no esperar más que esto a Firebase
  let done = false;

  const visible = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';

  // ¿Ya está lista la pantalla a la que vamos?
  function ready() {
    const auth = document.getElementById('authScreen');
    if (!body.classList.contains('auth-mode')) return true;                      // app abierta
    if (auth && !auth.hidden) {
      const panel = document.getElementById('authPanel');
      const retry = document.getElementById('authRetry');
      return (panel && !panel.hidden) || (retry && !retry.hidden);               // acceso o error
    }
    return false;
  }

  function target() {
    const auth = document.getElementById('authScreen');
    if (auth && !auth.hidden) return document.querySelector('.auth-brand');
    const t = document.querySelector('.brand-word');
    return visible(t) ? t : null;
  }

  function reveal() {
    document.querySelectorAll('.brand-wait').forEach(el => el.classList.remove('brand-wait'));
  }

  function finish() {
    // El nombre ya está exactamente sobre el destino: se cambia sin que se note.
    reveal();
    splash.remove();
  }

  function leave() {
    if (done) return;
    done = true;
    const to = target();
    const from = word.getBoundingClientRect();
    const toRect = to && to.getBoundingClientRect();

    splash.classList.add('leaving');
    body.classList.remove('splash-on'); // el panel empieza a subir

    if (!to || !toRect.width || reduce || !word.animate) {
      reveal();
      splash.classList.add('gone');
      setTimeout(() => splash.remove(), 320);
      return;
    }

    // Encoger y mover el nombre hasta el destino (misma letra, distinto tamaño)
    const fromSize = parseFloat(getComputedStyle(word).fontSize);
    const toSize = parseFloat(getComputedStyle(to).fontSize);
    const s = toSize / fromSize;
    const dx = toRect.left - from.left;
    const dy = toRect.top - from.top; // ambos con interlineado 1: se alinea el borde superior de las letras

    word.style.transformOrigin = '0 0';
    const anim = word.animate(
      [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
      { duration: 950, easing: 'cubic-bezier(.75, 0, .2, 1)', fill: 'forwards' }
    );
    anim.finished.then(finish, finish);
  }

  (function wait() {
    const elapsed = performance.now() - t0;
    if ((elapsed >= MIN_MS && ready()) || elapsed >= MAX_MS) leave();
    else setTimeout(wait, 80);
  })();
})();
