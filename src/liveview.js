// Plano ao vivo dos escanteios do 1º tempo na tela (live.js): a grade de odds mínimas por minuto e escanteios
// já cobrados, pronta antes do jogo, e a calculadora "vale entrar agora?" (minuto, escanteios, linha e a odd
// da casa → chance, odd mínima, EV e entrada pela fórmula do app).

import { LIVE_CAVEAT, LIVE_LINES, liveEntry } from './live.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nb = x => String(x).replace('.', ',');
const n1 = x => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(1).replace('.', ','));
const n2 = x => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => `${Math.round(x * 100)}%`;
const signed = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;
const brl = x => `R$ ${Math.round(x).toLocaleString('pt-BR')}`;

export function renderLive(plan) {
  if (!plan) return '';
  const src = plan.anchored ? `Pinnacle ${n2(plan.pinnacle_total)}` : 'só o modelo: a Pinnacle não cota o 1º tempo deste jogo';
  const chips = plan.tables.map((t, i) => `<button type="button" class="${i ? '' : 'on'}" data-lc="${t.corners}">${t.corners} escanteio${t.corners === 1 ? '' : 's'} até agora</button>`).join('');
  const grids = plan.tables.map((t, i) => `<table class="livegrid" data-lt="${t.corners}"${i ? ' hidden' : ''}>
    <tr><th>Minuto</th>${plan.lines.map(L => `<th>Mais de ${nb(L)}</th>`).join('')}</tr>
    ${t.rows.map(r => `<tr><td>${r.minute}'</td>${r.cells.map(c => `<td><b>${n2(c.odd_min)}</b> <span class="muted">${pct(c.p)}</span></td>`).join('')}</tr>`).join('')}
  </table>`).join('');
  return `<div class="live" data-mu="${plan.mu}" data-phi="${plan.phi}" data-anchored="${plan.anchored ? 1 : 0}">
    <h4>⏱️ Ao vivo · escanteios do 1º tempo <span class="muted">esperado ${n2(plan.mu)} no 1º tempo (${esc(src)}) · entrada até os 10'</span></h4>
    <div class="chips">${chips}</div>
    <div class="scroll">${grids}</div>
    <p class="muted">Cada casa: <b>odd mínima</b> para entrar no over (justa + ${Math.round((plan.margin - 1) * 100)}% de margem) e a chance da linha.
      Sem escanteio, a chance cai a cada minuto e a odd mínima sobe junto: só vale entrar quando a casa pagar pelo menos a mínima
      do minuto e dos escanteios do jogo. ${esc(LIVE_CAVEAT)}</p>
    <div class="calc"><b>Vale entrar agora?</b>
      <div class="row">
        <label>Minuto <input type="number" min="0" max="45" step="1" inputmode="numeric" data-k="minute" value="8"></label>
        <label>Escanteios até agora <input type="number" min="0" max="15" step="1" inputmode="numeric" data-k="corners" value="0"></label>
        <label>Linha <select data-k="line">${LIVE_LINES.map(L => `<option value="${L}"${L === 3.5 ? ' selected' : ''}>Mais de ${nb(L)}</option>`).join('')}</select></label>
        <label>Odd da casa <input type="number" min="1.01" step="0.01" inputmode="decimal" data-k="odd" placeholder="2,00"></label>
      </div>
      <p class="liveout"></p>
    </div>
  </div>`;
}

function update(box, banca) {
  const v = k => box.querySelector(`[data-k="${k}"]`).value;
  const minute = Number(v('minute')), corners = Number(v('corners')), line = Number(v('line'));
  const odd = parseFloat(String(v('odd')).replace(',', '.'));
  const out = box.querySelector('.liveout');
  if (!(minute >= 0 && minute <= 45) || !(corners >= 0) || !Number.isInteger(corners)) { out.textContent = 'Informe o minuto (0 a 45) e os escanteios já cobrados.'; return; }
  const x = liveEntry({ mu: Number(box.dataset.mu), phi: Number(box.dataset.phi), anchored: box.dataset.anchored === '1',
    minute, corners, line, odd: odd > 1 ? odd : null, banca });
  if (x.settled === 'ganha') { out.textContent = `Mais de ${nb(line)} já bateu: ${corners} escanteios.`; return; }
  const read = `chance ${pct(x.p)} · esperado no resto do 1º tempo ${n1(x.expected_remaining)} (total ${n1(x.expected_total)}) · `
    + `odd justa ${n2(x.fair)} · <b>odd mínima ${n2(x.odd_min)}</b>`;
  const late = minute > 10 ? ' · passou dos 10\': a conta vale, mas o plano é para a entrada até os 10\'' : '';
  out.innerHTML = !x.odd ? `${read}${late}`
    : x.value ? `✅ <b>Vale:</b> EV ${signed(x.ev)} na odd ${n2(x.odd)} · entrada ${brl(x.entry_brl)} (Política E ${x.politica_e}) · ${read}${late}`
      : `❌ <b>Não vale:</b> ${esc(x.why)} (EV ${signed(x.ev)} na odd ${n2(x.odd)}) · ${read}${late}`;
}

// Liga a grade e a calculadora de todos os planos dentro de root (uma vez por root; cada render só recalcula).
export function bindLive(root, { banca = 44000 } = {}) {
  if (!root.dataset.liveBound) {
    root.dataset.liveBound = '1';
    root.addEventListener('click', e => {
      const b = e.target.closest('div.live [data-lc]');
      if (!b) return;
      const box = b.closest('div.live');
      box.querySelectorAll('[data-lc]').forEach(x => x.classList.toggle('on', x === b));
      box.querySelectorAll('[data-lt]').forEach(t => { t.hidden = t.dataset.lt !== b.dataset.lc; });
      box.querySelector('[data-k="corners"]').value = b.dataset.lc;
      update(box, banca);
    });
    const onEdit = e => { const box = e.target.closest('div.live'); if (box && e.target.dataset.k) update(box, banca); };
    root.addEventListener('input', onEdit);
    root.addEventListener('change', onEdit);
  }
  root.querySelectorAll('div.live').forEach(box => update(box, banca));
}
