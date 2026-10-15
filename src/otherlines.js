// Outras linhas de um jogo (pedido do Jeferson, 13/10/2026: "nos jogos do plano, me dê opção de analisar outras linhas";
// 15/10/2026: também nas entradas da simulação): as linhas que a análise já tem do jogo — sem gastar requisição —, por
// mercado, com a chance, a Pinnacle e a mínima; 📈 abre o porquê da linha (a chance por fonte e os últimos jogos de cada
// time), ➕ registra; 🔬 abre a análise completa do jogo na aba Jogo. Usado pelo Plano do dia (planview.js) e pelas
// simulações (simview.js).

import { bindTooltips, teamCharts } from './dashboard.js';
import { chanceChart } from './planwhy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const SHORT = { 'Handicap asiático': 'Handicap', 'Total de gols': 'Gols', '1X2': '1X2', 'Total de escanteios': 'Escanteios', 'Total escanteios 1T': 'Escanteios 1T',
  'Total de chutes': 'Chutes', 'Total de chutes no gol': 'Chutes no gol', 'Resultado 1º tempo': '1º tempo', 'Total de gols 1T': 'Gols 1T', Combo: 'Mesmo jogo' };

const OTHER = ['Handicap asiático', 'Total de gols', '1X2', 'Resultado 1º tempo', 'Total de gols 1T', 'Total de escanteios', 'Total escanteios 1T', 'Total de chutes', 'Total de chutes no gol', 'Combo'];
export function linesOf(g) {
  const ours = new Map((g.scenario || []).map(l => [l.id, l]));
  const all = [...(g.lines || []).filter(l => OTHER.includes(l.market) && !/^(g|g1|corners|c1|shots|sot)U/.test(l.id) && l.p_blend >= 0.35 && l.p_blend <= 0.92),
    ...(g.scenario || []).filter(l => !(g.lines || []).some(x => x.id === l.id)), ...(g.fav_half ? [g.fav_half] : []), ...(g.fav_combos || [])];
  const per = new Map();
  for (const l of all.sort((a, b) => OTHER.indexOf(a.market) - OTHER.indexOf(b.market) || (b.p_blend ?? b.p_nossa) - (a.p_blend ?? a.p_nossa))) {
    const k = l.market, xs = per.get(k) || [];
    if (xs.length < 6) xs.push({ l, ours: ours.get(l.id) || null });
    per.set(k, xs);
  }
  return [...per.entries()];
}
export const findLine = (g, id) => [...(g.lines || []), ...(g.scenario || []), ...(g.fav_half ? [g.fav_half] : []), ...(g.fav_combos || [])].find(l => l.id === id);
export function othersHtml(g) {
  const groups = linesOf(g);
  if (!groups.length) return '<p class="muted small">A análise não guardou outras linhas deste jogo — abra a análise completa.</p>';
  const tag = (l, o) => (o?.bet ? '<span class="tag mid">🎯 aposta</span>' : o?.conditional ? '<span class="tag">🎯 entrar se…</span>'
    : l.tier && l.tier !== 'especulativa' ? `<span class="tag ok">${esc(l.tier)}</span>` : '<span class="muted small">—</span>');
  return `<div class="scroll"><table class="othtab"><tr><th>Mercado</th><th>Linha</th><th>Chance</th><th>Nossa leitura</th><th>Pinnacle</th><th>Odd mínima</th><th>Nível</th><th></th></tr>
    ${groups.map(([m, xs]) => xs.map(({ l, ours: o }, i) => `<tr${i === 0 ? ' class="grp"' : ''}><td class="muted">${i === 0 ? esc(SHORT[m] || m) : ''}</td><td><b>${esc(l.line)}</b></td>
      <td>${pct(l.p_blend ?? l.p_nossa)}</td><td>${o ? pct(o.p_nossa) : '<span class="muted">—</span>'}</td>
      <td>${l.p_pinnacle != null ? `${pct(l.p_pinnacle)}${l.pinnacle_odd ? ` · ${n2(l.pinnacle_odd)}` : ''}` : '<span class="muted">não cota</span>'}</td>
      <td><b>${n2(l.odd_min)}</b></td><td>${tag(l, o)}</td>
      <td class="acts">${/^cb:/.test(l.id) ? '' : `<button class="ghost mini" data-olc="${g.fx.id}|${esc(l.id)}" title="Ver o porquê desta linha">📈</button>`}
        <button class="enter mini" data-ole="${g.fx.id}|${esc(l.id)}" title="Registrar esta linha">➕</button></td></tr>`).join('')).join('')}</table></div>
    <div class="othchart" hidden></div>`;
}
export function othChart(g, l) {
  const p = l.p_blend ?? l.p_nossa, bars = [['Pinnacle', l.p_pinnacle ?? null, false, 'a chance da Pinnacle, sem a margem dela'], ['Modelo', l.p_model ?? null, false, 'o nosso modelo'],
    ['Últimos 10 jogos', l.hit_rate_last10 ?? null, false, 'quanto a linha teria acertado nos últimos 10 jogos dos dois times'], ['Chance', p, true, 'a chance que o app usa']];
  return `<div class="othhead"><b>${esc(SHORT[l.market] || l.market)}: ${esc(l.line)}</b> · chance ${pct(p)} · odd mínima <b>${n2(l.odd_min)}</b>${l.pinnacle_odd ? ` · Pinnacle ${n2(l.pinnacle_odd)}` : ''}
    <button class="ghost mini" data-olx title="Fechar">✕</button></div>
    <div class="whygrid">${chanceChart(bars, l.odd_min > 1 ? [1 / l.odd_min, `a mínima ${n2(l.odd_min)} exige`] : null)}<div></div></div>
    ${g.teams?.length ? `<div class="teams">${teamCharts(l, g.teams)}</div>` : ''}`;
}

// Os cliques num contêiner: details.othlines (abre e preenche a tabela), 📈 (o porquê da linha), ➕ (registra), ✕ (fecha o
// porquê) e 🔬 (análise completa). getGame(fixtureId) → o jogo da análise guardada ou null; sem ele, o 🔬 busca o jogo
// pelo id (api.fixturesById, 1 requisição).
export function bindOthers(root, { getGame, openEntry, analyzeFixture = null, api = null }) {
  root.addEventListener('toggle', e => {
    const d = e.target.closest?.('details.othlines');
    if (!d || !d.open || d.dataset.ready) return;
    const g = getGame(Number(d.dataset.others));
    if (!g) return;
    d.querySelector('.othbody').innerHTML = othersHtml(g);
    d.dataset.ready = '1';
  }, true);
  root.addEventListener('click', async e => {
    const c = e.target.closest('[data-olc]'), en = e.target.closest('[data-ole]'), x = e.target.closest('[data-olx]'), full = e.target.closest('[data-full]');
    if (x) { const box = x.closest('.othchart'); box.hidden = true; box.innerHTML = ''; return; }
    if (c || en) {
      const [f, id] = (c || en).dataset[c ? 'olc' : 'ole'].split('|'), g = getGame(Number(f)), l = g && findLine(g, id);
      if (!l) return;
      if (en) { openEntry(l.id, null, { line: l, fx: g.fx, btn: en }); return; }
      const box = c.closest('.othbody').querySelector('.othchart');
      box.innerHTML = othChart(g, l); box.hidden = false; bindTooltips(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (full && analyzeFixture) {
      const id = Number(full.dataset.full);
      full.disabled = true;
      try {
        const fx = getGame(id)?.fx || (api?.fixturesById ? (await api.fixturesById([id]))[0] : null);
        if (fx) {
          let national = false;
          try { national = !!(await api?.teamInfo?.(fx.home.id))?.national; } catch { /* segue como clube */ }
          await analyzeFixture(fx, national);
        }
      } catch { /* sem o jogo: fica onde está */ }
      full.disabled = false;
    }
  });
}
