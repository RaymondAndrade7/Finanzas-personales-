'use strict';

/* =========================================================
   Reportes: mes contra el anterior, por categoría, 12 meses y PDF.
   Se carga antes de app.js.
   ========================================================= */

function monthSummary(ym) {
  const txs = monthTx(ym);
  const { ing, gas } = totals(txs);
  const byCat = new Map();
  for (const t of txs) if (t.type === 'gasto') byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + bv(t));
  return { ym, ing, gas, saved: ing - gas, rate: ing > 0 ? (ing - gas) / ing : null, byCat };
}

const chg = (a, b) => (b > 0 ? (a - b) / b : a > 0 ? 1 : 0);

function changeChip(now, prev, goodWhenUp) {
  if (!prev && !now) return '<span class="chg flat">—</span>';
  const c = chg(now, prev);
  if (Math.abs(c) < 0.005) return '<span class="chg flat">= igual</span>';
  const up = c > 0;
  const good = up === goodWhenUp;
  return `<span class="chg ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${pct(Math.abs(c))}</span>`;
}

function reportsSection() {
  const cur = monthSummary(currentYM);
  const prevYM = shiftMonth(currentYM, -1);
  const prev = monthSummary(prevYM);
  const mes = monthName(currentYM, { month: 'long', year: 'numeric' });
  const mesPrev = monthName(prevYM, { month: 'long' }).toLowerCase();

  // Categorías: este mes vs el anterior
  const ids = new Set([...cur.byCat.keys(), ...prev.byCat.keys()]);
  const cats = [...ids].map(id => {
    const c = catById(id) || { name: 'Sin categoría', color: '#94a3b8' };
    const a = cur.byCat.get(id) || 0, b = prev.byCat.get(id) || 0;
    return { c, a, b, d: a - b };
  }).sort((x, y) => y.a - x.a);

  // Lo más destacado
  const highlights = [];
  const spendCats = cats.filter(x => x.c.group !== 'ahorro'); // bajar el ahorro no es "bueno"
  const ups = spendCats.filter(x => x.b > 0 && x.d > 0).sort((x, y) => y.d - x.d).slice(0, 2);
  const downs = spendCats.filter(x => x.b > 0 && x.d < 0).sort((x, y) => x.d - y.d).slice(0, 2);
  const news = spendCats.filter(x => x.b === 0 && x.a > 0).slice(0, 1);
  if (prev.gas > 0 && cur.gas > 0) highlights.push(cur.gas > prev.gas
    ? `En total gastaste <b class="bad">${pct(chg(cur.gas, prev.gas))} más</b> que en ${esc(mesPrev)} (${esc(fmt(cur.gas - prev.gas))}).`
    : `En total gastaste <b class="ok">${pct(-chg(cur.gas, prev.gas))} menos</b> que en ${esc(mesPrev)} (${esc(fmt(prev.gas - cur.gas))}). ¡Bien!`);
  ups.forEach(x => highlights.push(`Gastaste <b class="bad">${pct(chg(x.a, x.b))} más</b> en <b>${esc(x.c.name)}</b> (+${esc(fmt(x.d))}).`));
  downs.forEach(x => highlights.push(`Bajaste <b class="ok">${pct(-chg(x.a, x.b))}</b> en <b>${esc(x.c.name)}</b> (−${esc(fmt(-x.d))}).`));
  news.forEach(x => highlights.push(`Gasto nuevo este mes: <b>${esc(x.c.name)}</b> (${esc(fmt(x.a))}).`));
  if (cur.rate !== null && prev.rate !== null) highlights.push(`Tu tasa de ahorro pasó de ${pct(prev.rate)} a <b>${pct(cur.rate)}</b>.`);

  // 12 meses
  const months = lastMonths(12, currentYM).map(monthSummary);
  const withData = months.filter(m => m.ing || m.gas);
  const yIng = sum(months.map(m => m.ing)), yGas = sum(months.map(m => m.gas));
  const best = withData.slice().sort((a, b) => b.saved - a.saved)[0];
  const max = Math.max(1, ...months.flatMap(m => [m.ing, m.gas]));
  const W = 340, H = 140, bottom = 18, slot = W / 12, bw = 9;
  const bars = months.map((m, i) => {
    const x = i * slot + slot / 2;
    const hi = (m.ing / max) * (H - bottom - 6), hg = (m.gas / max) * (H - bottom - 6);
    return `<rect class="bar-ing" x="${x - bw}" y="${H - bottom - hi}" width="${bw - 1}" height="${hi}" rx="2"/>
      <rect class="bar-gas" x="${x}" y="${H - bottom - hg}" width="${bw - 1}" height="${hg}" rx="2"/>
      <text class="axis" x="${x}" y="${H - 4}" text-anchor="middle">${esc(monthName(m.ym, { month: 'narrow' }))}</text>`;
  }).join('');

  return `<div class="report" id="report">
    <div class="report-head">
      <div><div class="report-brand">Ray<b>Fin</b> · Reporte</div><h2>${esc(cap(mes))}</h2></div>
      <button class="btn small primary no-print" data-action="report-pdf">Descargar PDF</button>
    </div>

    <div class="card">
      <h2>Resumen del mes <small class="muted">vs ${esc(mesPrev)}</small></h2>
      <div class="rep-grid">
        <div><small>Ingresos</small><b class="ing">${esc(fmtS(cur.ing))}</b>${changeChip(cur.ing, prev.ing, true)}</div>
        <div><small>Gastos</small><b class="gas">${esc(fmtS(cur.gas))}</b>${changeChip(cur.gas, prev.gas, false)}</div>
        <div><small>Ahorro</small><b>${esc(fmtS(cur.saved))}</b>${changeChip(cur.saved, Math.max(0, prev.saved), true)}</div>
        <div><small>Tasa de ahorro</small><b>${cur.rate === null ? '—' : pct(cur.rate)}</b><span class="chg flat">${prev.rate === null ? '' : 'antes ' + pct(prev.rate)}</span></div>
      </div>
    </div>

    ${highlights.length ? `<div class="card"><h2>Lo más destacado</h2><ul class="rep-list">${highlights.map(h => `<li>${h}</li>`).join('')}</ul></div>` : ''}

    <div class="card">
      <h2>Gastos por categoría</h2>
      ${cats.length ? `<table class="rep-table">
        <thead><tr><th>Categoría</th><th>${esc(cap(monthName(currentYM, { month: 'short' })))}</th><th>${esc(cap(monthName(prevYM, { month: 'short' })))}</th><th>Cambio</th></tr></thead>
        <tbody>${cats.map(x => `<tr>
          <td><i class="dot" style="background:${safeColor(x.c.color)}"></i> ${esc(x.c.name)}</td>
          <td>${esc(fmtS(x.a))}</td><td class="muted">${esc(fmtS(x.b))}</td>
          <td>${x.b === 0 && x.a > 0 ? '<span class="chg flat">nuevo</span>' : changeChip(x.a, x.b, false)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td>${esc(fmtS(cur.gas))}</td><td class="muted">${esc(fmtS(prev.gas))}</td><td>${changeChip(cur.gas, prev.gas, false)}</td></tr></tfoot>
      </table>` : empty('No hay gastos en estos meses.')}
    </div>

    <div class="card">
      <h2>Últimos 12 meses</h2>
      ${withData.length ? `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Ingresos y gastos de 12 meses">
          <line class="base" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>${bars}</svg>
        <div class="legend-inline"><span><i class="dot" style="background:var(--ing)"></i>Ingresos</span><span><i class="dot" style="background:var(--gas)"></i>Gastos</span></div>
        <div class="rep-grid" style="margin-top:12px">
          <div><small>Ingresos (12 m)</small><b class="ing">${esc(fmtS(yIng))}</b></div>
          <div><small>Gastos (12 m)</small><b class="gas">${esc(fmtS(yGas))}</b></div>
          <div><small>Ahorro (12 m)</small><b>${esc(fmtS(yIng - yGas))}</b></div>
          <div><small>Ahorro promedio</small><b>${yIng > 0 ? pct((yIng - yGas) / yIng) : '—'}</b></div>
        </div>
        ${best ? `<p class="muted" style="font-size:.85rem;margin:10px 0 0">Tu mejor mes fue <b>${esc(monthName(best.ym))}</b>: ahorraste ${esc(fmt(best.saved))}.</p>` : ''}`
      : empty('Aún no hay datos suficientes.')}
    </div>
    <p class="report-foot">Generado con RayFin el ${esc(new Date().toLocaleDateString('es'))} · montos en ${esc(baseCur(state))}</p>
  </div>`;
}

/** Descarga el reporte como PDF (con el diálogo de impresión del navegador). */
function printReport() {
  document.body.classList.add('print-report');
  const done = () => { document.body.classList.remove('print-report'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
  setTimeout(done, 60000);
}
