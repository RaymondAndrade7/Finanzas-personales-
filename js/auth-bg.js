'use strict';

/* =========================================================
   Fondo animado de la pantalla de inicio de sesión:
   una malla de puntos en perspectiva que ondula como un
   gráfico de mercado. Solo se anima mientras la pantalla
   está visible y respeta "reducir movimiento".
   ========================================================= */
(function () {
  const screen = document.getElementById('authScreen');
  const canvas = document.getElementById('authBg');
  if (!screen || !canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0, h = 0, dpr = 1, cols = 0, rows = 0, raf = 0, running = false;
  const start = performance.now();

  // Colores: valles blanco frío → crestas verde lima
  const LOW = [150, 170, 190];
  const HIGH = [200, 240, 49];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const small = w < 600;
    cols = small ? 46 : 80;
    rows = small ? 34 : 46;
  }

  function frame(now) {
    const t = (now - start) / 1000;
    ctx.fillStyle = '#030303';
    ctx.fillRect(0, 0, w, h);

    const spacing = Math.max(w, 700) / cols * 1.6;
    const fov = 420;
    const horizon = h * (w < 600 ? 0.58 : 0.44);
    const camH = 120;
    const zShift = (t * 18) % spacing; // la malla avanza hacia la cámara

    for (let r = rows - 1; r >= 0; r--) {
      const z = r * spacing - zShift + 40;
      const scale = fov / (fov + z);
      const depthFade = Math.min(1, (1 - r / rows) * 1.25);
      for (let c = 0; c <= cols; c++) {
        const x = (c - cols / 2) * spacing;
        const wave =
          Math.sin(x * 0.010 + t * 0.9) * 22 +
          Math.cos(z * 0.012 - t * 0.7) * 26 +
          Math.sin((x + z) * 0.006 + t * 0.5) * 18;
        const sx = w / 2 + x * scale;
        if (sx < -4 || sx > w + 4) continue;
        const sy = horizon + (camH - wave) * scale * 1.6;
        const k = Math.max(0, Math.min(1, (wave + 40) / 90)); // 0 valle · 1 cresta
        const r0 = LOW[0] + (HIGH[0] - LOW[0]) * k;
        const g0 = LOW[1] + (HIGH[1] - LOW[1]) * k;
        const b0 = LOW[2] + (HIGH[2] - LOW[2]) * k;
        const alpha = depthFade * (0.28 + 0.72 * k * k) * Math.min(1, scale * 1.7);
        if (alpha < 0.02) continue;
        const size = Math.max(0.8, scale * 2.9);
        ctx.fillStyle = `rgba(${r0 | 0},${g0 | 0},${b0 | 0},${alpha.toFixed(3)})`;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
    }

    if (running) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || screen.hidden) return;
    resize();
    if (reduceMotion.matches) { frame(start + 4000); return; } // imagen fija
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  new MutationObserver(() => (screen.hidden ? stop() : play()))
    .observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => { if (!screen.hidden) { resize(); if (!running) frame(performance.now()); } });
  reduceMotion.addEventListener?.('change', () => { stop(); play(); });
  play();
})();
