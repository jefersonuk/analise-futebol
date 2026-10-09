// Tela da varredura: até 20 jogos das próximas 4 horas (ou de um dia), em ordem de horário — cada um com as
// linhas principais do pré-jogo (escanteios 1T, escanteios do jogo, handicap de gols, gols e handicap de
// escanteios), o contexto do jogo (tabela, médias, esperado, confronto direto) e as checagens de cada linha,
// o plano de entrada ao vivo nos escanteios do 1º tempo, os gráficos dos últimos 10 jogos de cada time na
// melhor linha e o atalho para a análise completa do jogo.

import { CENARIO, COMBOS, FILTER_KEYS, GOAL_HANDICAP, LIVE_1H, MAIN_MARKETS, SHOTS, SHOTS_FILTER, bestLine, pickGames, scanDay } from './scanner.js';
import { bindTooltips, renderDashboard } from './dashboard.js';
import { load, save } from './store.js';
import { bindSpecialist, briefMulti, briefScan } from './brief.js';
import { isMain } from './consistency.js';
import { isBet, isCandidate } from './dossier.js';
import { contextLine } from './context.js';
import { bindLive, renderLive } from './liveview.js';
import { collect } from './odds.js';
import { isScenario } from './scenario.js';
import { lineVerdict, lineupReport } from './lineupcheck.js';
import { clubsHtml } from './clubs.js';
import { BAND, BANDS, MULTI, TARGETS, TARGET, bandTickets, multiGames, multiLine, ticketOf } from './multiple.js';
import { exposedGames } from './entry.js';
import { buildSim } from './sim.js';
import { simPanel } from './simview.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => `${Math.round(x * 100)}%`;
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const nb = x => String(x).replace('.', ',');
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const BUDGET_KEY = 'afScanBudget';
const WINDOW = '4h';   // padrão: as próximas 4 horas
// Linha consistente que não é aposta pelo preço: a odd mínima passa de 5% acima da Pinnacle (casa soft
// raramente paga isso). Sem candidata no jogo, a tela mostra a linha mais consistente, mas apagada.
const priceGap = l => (!isCandidate(l) && l.tier !== 'especulativa' && l.odd_min_vs_pinnacle_pct > 5 ? l.odd_min_vs_pinnacle_pct : null);
const gap1 = l => nb(Math.round(priceGap(l) * 10) / 10);   // 5,3: o corte é 5%, não arredonda para ele
const gapTxt = l => `${gap1(l)}% acima da Pinnacle`;
const ctxContra = l => isCandidate(l) && l.context?.verdict === 'contra';
const SHORT = { 'Total escanteios 1T': 'Escanteios 1T', 'Total de escanteios': 'Escanteios', 'Total de gols 1T': 'Gols 1T',
  'Total de gols': 'Gols', [GOAL_HANDICAP]: 'Handicap gols', 'Total de chutes': 'Chutes', 'Total de chutes no gol': 'Chutes no gol',
  '1X2': '1X2', [SHOTS_FILTER]: 'Chutes', [COMBOS]: 'Combos', Combo: 'Combo' };
const signed = x => `${x > 0 ? '+' : ''}${nb(x)}`;
const tierTag = l => `<span class="tag ${l.tier === 'âncora' ? 'ok' : l.tier === 'sólida' ? 'mid' : 'no'}">${l.tier}</span>${srcTag(l)}`;
// de onde vem o preço quando não é a odd da Pinnacle na própria linha
const srcTag = l => (l.derived ? ` <span class="tag" title="${esc(l.priced_by)}: a Pinnacle não cota esta linha; a chance sai do total que ela precifica (margem de 5%)">derivada</span>`
  : l.model_only ? ' <span class="tag mid" title="a Pinnacle não cota este mercado neste jogo: preço só do modelo, margem de 8%, aposta só se for âncora">só modelo</span>' : '');
// Resumo dos escanteios da varredura: quantos jogos têm aposta, linha jogável, linhas fora da faixa ou nada.
function cornersLine(r) {
  if (!r) return '';
  const n = k => r[k] || 0, parts = [
    `<b>${n('aposta')} com aposta</b>`, n('jogável') && `${n('jogável')} com linha jogável sem aposta`,
    n('fora da faixa') && `${n('fora da faixa')} com as linhas abaixo de 60% de chance ou fora da faixa 1,50–3,00`, n('sem linha') && `${n('sem linha')} sem linha de escanteios`,
    n('sem estatística') && `${n('sem estatística')} sem estatística de escanteios na liga (só gols)`].filter(Boolean);
  const src = [n('preço pinnacle') && `${n('preço pinnacle')} com a Pinnacle`, n('preço derivada') && `${n('preço derivada')} pelo total da Pinnacle`,
    n('preço modelo') && `${n('preço modelo')} só pelo modelo`].filter(Boolean);
  return `<p class="muted">Escanteios nos jogos analisados: ${parts.join(' · ')}${src.length ? ` · preço: ${src.join(', ')}` : ''}.</p>`;
}
// contexto do jogo na linha: a favor / misto / neutro / contra, com as checagens no quadro do mouse
const CTX_CLS = { 'a favor': 'ok', misto: 'mid', contra: 'no' };
const ctxTag = l => (l.context ? `<span class="tag ${CTX_CLS[l.context.verdict] || ''}" title="${esc(contextLine(l.context))}">${l.context.verdict}</span>` : '—');
// valor (informativo): a nossa chance contra a da Pinnacle sem margem
const valueTxt = l => (l.value_pct == null ? '—' : `<span class="${l.value_pct >= 2 ? 'pos' : l.value_pct <= -2 ? 'neg' : 'muted'}">${signed(l.value_pct)}%</span>`);
const probs = l => `${pct(l.p_blend)} <span class="muted">· ${l.p_pinnacle != null ? pct(l.p_pinnacle) : '—'}</span>`;
// contagem simples dos últimos jogos (o acerto pelo papel de hoje fica no valor e no gráfico)
const hits = l => [l.history?.home, l.history?.away].map(x => (x && (x.raw?.n ?? x.n) ? (x.hits || `${nb(x.wins)}/${x.n}`) : '—')).join(' · ');
const thr = l => parseFloat(l.id.match(/-?[\d.]+$/)?.[0]) || 0;
// Filtros: a melhor linha de cada jogo, cada mercado e os jogos para a entrada ao vivo no 1º tempo.
// Melhor do jogo: handicap de gols, gols e 1X2 (escanteios e chutes só nas abas deles, e só over).
// 🎯 Cenário (a padrão): odd perto de 2 pela leitura de cenário dos dois times.
// 🎟️ Múltipla: uma perna de over de gols por jogo, montada em bilhete (multiple.js).
const FILTERS = [['🎯 Nossa análise', CENARIO], ['Melhor do jogo', null], ...FILTER_KEYS.map(m => [SHORT[m], m]), ['🎟️ Múltipla', MULTI], ['1T ao vivo', LIVE_1H]];
// Plano ao vivo: odd mínima e chance do over numa linha, no minuto e com os escanteios dados.
const liveCell = (plan, c, m, L) => {
  const x = plan?.tables.find(t => t.corners === c)?.rows.find(r => r.minute === m)?.cells.find(z => z.line === L);
  return x ? `<b>${n2(x.odd_min)}</b> <span class="muted">${pct(x.p)}</span>` : '—';
};
const started = g => Date.now() > g.fx.t;
// Combos: quanto as pernas andam juntas (chance das duas ÷ produto das chances de cada uma)
const corrTag = c => {
  const d = Math.round((c.corr - 1) * 100);
  return d >= 3 ? `<span class="tag ok" title="as pernas andam juntas: o combo acerta ${d}% mais do que se fossem independentes; a casa costuma pagar menos que o produto">juntas +${d}%</span>`
    : d <= -3 ? `<span class="tag mid" title="uma perna atrapalha a outra: o combo acerta ${-d}% menos do que se fossem independentes">contra ${d}%</span>`
      : '<span class="tag">independentes</span>';
};
// Cenário: a linha, a chance da Pinnacle e a pelo cenário, o valor na odd dela e a leitura curta dos dois times
// Nossa análise: status da linha (aposta, entrar se…, na mira, sem aposta), a nossa chance e a da Pinnacle, a diferença
// e de onde ela vem (o nosso modelo corrigido e o cenário), a odd mínima e a entrada
const STATUS = { aposta: ['ok', 'aposta'], 'entrar se': ['mid', 'entrar se…'], 'na mira': ['', 'na mira'], 'sem aposta': ['no', 'sem aposta'] };
const scenTag = l => { const [c, t] = STATUS[l.status] || STATUS['sem aposta'];
  const tip = l.status === 'entrar se' ? l.conditions.join('; ') : l.status === 'na mira' ? `a Pinnacle paga ${n2(l.pinnacle_odd)}: entra se a casa pagar ≥ ${n2(l.odd_min)}` : l.why_not.join('; ');
  return `<span class="tag ${c}" title="${esc(tip)}">${t}</span>${l.contra ? ' <span class="tag mid" title="a nossa chance está 5 pp ou mais acima da Pinnacle">contra a Pinnacle</span>' : ''}`; };
const diffTxt = l => (l.diff_pp == null ? '—' : `<span class="${l.diff_pp >= 5 ? 'pos' : l.diff_pp <= -5 ? 'neg' : 'muted'}">${signed(Math.round(l.diff_pp))} pp</span>`);
const scenHead = '<th>Linha</th><th>Status</th><th>Nossa</th><th>Pinnacle</th><th>Diferença</th><th>De onde vem</th><th>Mínima</th><th>Entrada</th>';
const scenCells = l => `<td>${esc(SHORT[l.market] || l.market)}: <b>${esc(l.line)}</b></td><td>${scenTag(l)}</td><td><b>${pct(l.p_nossa)}</b></td>
  <td>${l.pinnacle_odd ? `${n2(l.pinnacle_odd)} <span class="muted">· ${pct(l.p_pinnacle)}</span>` : '—'}</td><td>${diffTxt(l)}</td><td class="muted small">${esc(l.why)}</td>
  <td><b>${n2(l.odd_min)}</b></td><td class="muted">${(l.bet || l.conditional) && l.entry_brl ? `R$ ${l.entry_brl} · ${l.politica_e}` : '—'}</td>`;
const prof = (p, n) => (p?.n ? `${esc(n)} ${esc(p.how)}: ${p.w}V ${p.d}E ${p.l}D, ${nb(p.gf.toFixed(1))}–${nb(p.ga.toFixed(1))}, ${signed(nb(p.resid.toFixed(1)))} além do esperado` : `${esc(n)}: sem jogos no cenário`);
const scenShort = g => { const c = g.context?.scenario; return c ? `${prof(c.home, g.fx.home.name)} · ${prof(c.away, g.fx.away.name)}` : '—'; };
// ➕ no começo de cada linha (a tabela rola para a direita no celular e na tela estreita): cheio quando é aposta pelo
// app; vazado quando não é — entra mesmo assim, com o aviso de "fora da regra" no formulário
const enterBtn = (l, ok) => `<button class="enter mini${ok ? '' : ' off'}" data-enter="${esc(l.id)}" title="${ok ? 'Entrar' : 'Entrar fora da regra: o app não marca como aposta'}">➕</button>`;
const comboHead = '<th>Combo</th><th>Nível</th><th>Chance · Pinnacle</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pernas separadas</th><th>Pernas</th>';
const comboCells = c => `<td><b>${esc(c.line)}</b></td><td>${tierTag(c)}</td><td>${probs(c)}</td><td class="muted">${hits(c)}</td>
  <td>${n2(c.fair_odd_blend)}</td><td><b>${n2(c.odd_min)}</b></td><td class="muted">${n2(c.odd_indep)}</td><td>${corrTag(c)}</td>`;

export function initScan({ api, openEntry, analyzeFixture, banca }) {
  let scan = null, market = CENARIO, order = 'time', ranked = [];
  // bilhete da múltipla: alvo, jogos marcados (null = o automático), a linha escolhida em cada jogo, odds da casa por
  // perna e a total
  // bilhetes da múltipla: alvo, faixa de horário (h), pernas marcadas/desmarcadas à mão (fixtureId -> sim/não), a linha
  // escolhida em cada jogo, odds da casa por perna e a total de cada bilhete (pela primeira perna)
  const multi = { target: TARGET, band: BAND, include: new Map(), lineFor: new Map(), house: new Map(), totals: new Map(), tickets: [] };
  // as simulações das varreduras (simview.js): ver "simulação" abaixo
  let simUI = null;
  const simId = sc => String(Date.parse(sc?.generated_at) || '');
  $('#scanDate').innerHTML = [['Próximas 4 horas (amplia até 12 h se faltar jogo)', WINDOW], ['Hoje (dia todo)', dayStr(0)], ['Amanhã', dayStr(1)]]
    .map(([t, v]) => `<option value="${v}">${t}${v === WINDOW ? '' : ` (${v.split('-').reverse().slice(0, 2).join('/')})`}</option>`).join('');
  $('#scanBudget').value = localStorage.getItem(BUDGET_KEY) || 1500;
  const msg = (text, err = false) => { const el = $('#scanMsg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', err); };

  async function showSaved() {
    scan = await load(`af:scan:${$('#scanDate').value}`);
    Object.assign(multi, { include: new Map(), lineFor: new Map(), house: new Map(), totals: new Map() });
    render();
  }
  $('#scanDate').onchange = showSaved;

  $('#scanRun').onclick = async () => {
    if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
    const budget = Math.max(50, Number($('#scanBudget').value) || 1500);
    localStorage.setItem(BUDGET_KEY, budget);
    const v = $('#scanDate').value, win = /^\d+h$/.test(v) ? { hours: parseInt(v, 10) } : { date: v };
    $('#scanRun').disabled = true;
    try {
      scan = await scanDay(api.dossierApi, { ...win, budget, banca, onProgress: t => msg(t) });
      Object.assign(multi, { include: new Map(), lineFor: new Map(), house: new Map(), totals: new Map() });
      await save(`af:scan:${v}`, scan);
      msg(scan.games.length ? '' : scan.hours ? `Nenhum jogo com odds da Pinnacle nas próximas ${scan.hours} horas.` : 'Nenhum jogo com odds da Pinnacle nesta data.');
      render();
    } catch (e) { msg(e.message, true); }
    $('#scanRun').disabled = false;
  };

  function render() {
    const out = $('#scanOut');
    $('#scanSpec').hidden = !scan?.games.length;
    if (!scan) { out.innerHTML = ''; return; }
    const top = scan.top || 20, live = market === LIVE_1H, combos = market === COMBOS, cen = market === CENARIO, mult = market === MULTI;
    const ok = scan.v >= (cen ? 10 : combos ? 8 : 7);
    ranked = ok && !mult ? pickGames(scan.games, { market, top, order }) : [];
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const chips = FILTERS.map(([t, m]) => `<button class="${market === m ? 'on' : ''}" data-m="${esc(m ?? '')}">${esc(t)}</button>`).join('');
    const orders = [['Horário', 'time'], ['Chance de ganho', 'chance']].map(([t, o]) => `<button class="${order === o ? 'on' : ''}" data-o="${o}">${t}</button>`).join('');
    // varredura guardada pela versão anterior (só jogos com o 1º tempo na Pinnacle) não tem with_1h
    const pool = scan.with_1h == null ? `${scan.with_odds} com escanteios do 1º tempo na Pinnacle`
      : `${scan.with_odds} com odds da Pinnacle (${scan.with_1h} com escanteios do 1º tempo)`;
    const span = !scan.window ? 'o dia inteiro' : `próximas ${scan.hours} horas (${hour(scan.window.from)} a ${hour(scan.window.to)})`
      + (scan.asked_hours && scan.hours > scan.asked_hours ? ` — janela ampliada: poucos jogos com odds nas ${scan.asked_hours} primeiras horas` : '');
    const rows = ranked.map(({ g, line }, i) => {
      const go = `data-go="${i}"`, kick = `${hour(g.fx.t)}${started(g) ? ' <span class="tag mid">começou</span>' : ''}`;
      const hardTag = g.hard ? ` <span class="tag no" title="${esc(g.hard.reasons.join('; '))}">difícil</span>` : '';
      const game = `<td>${i + 1}</td><td>${kick}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}${hardTag}</td><td class="muted">${esc(g.fx.league.name)}</td>`;
      if (live) {
        const p = g.live1h;
        return `<tr ${go}>${game}<td>${n2(p.mu)}${p.anchored ? ` <span class="muted">· Pin ${n2(p.pinnacle_total)}</span>` : ' <span class="muted">· modelo</span>'}</td>
          <td>${liveCell(p, 0, 0, 3.5)}</td><td>${liveCell(p, 0, 5, 3.5)}</td><td>${liveCell(p, 0, 10, 3.5)}</td><td>${liveCell(p, 1, 10, 3.5)}</td></tr>`;
      }
      if (combos) return `<tr ${go} class="${isBet(line) ? '' : 'weak'}">${game}${comboCells(line)}</tr>`;
      if (cen) return `<tr ${go} class="${line.bet ? '' : 'weak'}">${game}${scenCells(line)}<td class="muted small">${line.conditional ? `<b>conferir ${hour(g.fx.t - 30 * 60e3)}</b>: ${esc(line.conditions.join('; '))}` : scenShort(g)}</td></tr>`;
      const gap = priceGap(line);
      return `<tr ${go} class="${isBet(line) ? '' : 'weak'}">${game}<td>${esc(SHORT[line.market] || line.market)}: <b>${esc(line.line)}</b></td>
        <td>${tierTag(line)}${gap ? ` <span class="tag price" title="sem aposta: a odd mínima fica ${gapTxt(line)}; casa soft raramente paga mais de 5% acima">+${gap1(line)}% Pin</span>` : ''}</td>
        <td>${ctxTag(line)}</td><td>${probs(line)}</td><td class="muted">${hits(line)}</td><td>${n2(line.fair_odd_blend)}</td><td><b>${n2(line.odd_min)}</b></td>
        <td class="muted">${line.pinnacle_odd ? n2(line.pinnacle_odd) : '—'}</td><td>${valueTxt(line)}</td></tr>`;
    }).join('');
    const head = cen ? `<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th>${scenHead}<th>Leitura dos dois times / o que conferir</th></tr>` : combos ? `<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th>${comboHead}</tr>` : live
      ? '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Esperado 1T</th><th>+3,5 no 0\'</th><th>5\' sem esc.</th><th>10\' sem esc.</th><th>10\' com 1</th></tr>'
      : '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>';
    const cards = ranked.map(({ g, line }, i) => card(g, line, i)).join('');
    const skipped = scan.skipped.length ? `<details class="skipped"><summary>${scan.skipped.length} jogos com odds que ficaram de fora</summary><ul>
      ${scan.skipped.map(s => `<li>${hour(s.fx.t)} ${esc(s.fx.home.name)} x ${esc(s.fx.away.name)} <span class="muted">(${esc(s.fx.league.name)}): ${esc(s.why)}</span></li>`).join('')}</ul></details>` : '';
    const nBet = live ? 0 : cen ? ranked.filter(x => x.line.bet).length : ranked.filter(x => isBet(x.line)).length;
    const nCond = cen ? ranked.filter(x => x.line.conditional).length : 0;
    const old = ok ? '' : cen ? '<p class="msg">Varredura feita antes da "nossa análise primeiro": toque em Varrer jogos de novo.</p>' : combos ? '<p class="msg">Varredura feita antes dos combos: toque em Varrer jogos de novo.</p>'
      : '<p class="msg">Varredura feita antes da regra "só over" (com chutes e 1X2, e o Melhor do jogo sem escanteios): toque em Varrer jogos de novo.</p>';
    const explain = cen
      ? `<p class="muted"><b>${nBet} ${nBet === 1 ? 'aposta para entrar já' : 'apostas para entrar já'}</b>${nCond ? ` · <b>${nCond} "entrar se…"</b> (conferir perto do jogo)` : ''}.
        A chance é a <b>nossa</b>: o modelo de forças da base, corrigido da compressão (o modelo via favorito e zebra mais perto do que são), mais o cenário —
        cada time contra adversários do <b>mesmo nível</b> do de hoje e no mesmo mando, com o saldo e os gols além do esperado (peso pela amostra) —, a tabela
        (motivação) e o clássico. A <b>Pinnacle</b> vem ao lado, como segunda opinião: <b>diferença</b> = nossa − Pinnacle e <b>de onde vem</b> (modelo e
        cenário). <b>Aposta</b>: nossa chance ≥ 45%, odd mínima (nossa justa × 1,05) até 2,70 e a Pinnacle pagando a mínima com odd de 1,80 a 2,70.
        <b>Entrar se…</b>: passaria, mas depende de algo que só se confirma perto do jogo (escalação de base, copa, dúvida, ou a nossa leitura 12 pp ou mais
        longe da Pinnacle) — confira 30 min antes. <b>Contra a Pinnacle</b>: a nossa chance 5 pp ou mais acima da dela; fica marcada no app de apostas para
        medirmos. Só over nos gols.</p>${planList()}`
      : combos
      ? `<p class="muted"><b>${nBet} ${nBet === 1 ? 'jogo com combo para apostar' : 'jogos com combo para apostar'}</b>. Combo = duas pernas no mesmo jogo ("criar aposta"):
        um resultado (vitória, dupla chance, empate anula ou handicap ±1,5) + over de gols. A chance sai da matriz de placares da Pinnacle (1X2 e total de
        gols, sem margem) com 10% do modelo — as pernas não são independentes, então não é o produto das duas. Só aparecem combos com chance ≥ 60%,
        odd mínima 1,50–3,00 e que pagam pelo menos 10% mais que a melhor perna sozinha. <b>Pernas separadas</b> = produto das odds justas de cada perna:
        quando as pernas andam juntas, a casa costuma pagar menos que isso; se ela pagar a mínima, entre. Empate anula com empate: a perna volta e vale só a
        de gols (regra da maioria das casas — confira).</p>`
      : live
      ? `<p class="muted">Jogos para a entrada ao vivo no over de escanteios do 1º tempo, dos que mais devem ter escanteios no 1º tempo (com o total
        da Pinnacle primeiro). Cada casa: odd mínima do Mais de 3,5 e a chance. Sem escanteio, a odd mínima sobe a cada minuto: entre só quando a casa
        pagar pelo menos ela. A grade completa e a calculadora estão em cada jogo.</p>`
      : `<p class="muted"><b>${nBet} ${nBet === 1 ? 'jogo com aposta' : 'jogos com aposta'}</b> neste filtro. Os ${ranked.length} de maior chance de ganho,
        ${order === 'time' ? 'em ordem de horário' : 'pela chance de ganho'}. Chance = a nossa probabilidade (Pinnacle sem margem + modelo, sem contar a devolução)
        e, ao lado, a da Pinnacle; o histórico dos dois times entra no nível. Só aparecem linhas com chance ≥ 60% (piso); âncora = 70%+, o ideal.
        Contexto = mando, médias, confronto direto e tabela confirmando a linha (passe o mouse para ver). Apagados: sem aposta (especulativa, odd mínima
        mais de 5% acima da Pinnacle ou contexto contra).</p>`;
    out.innerHTML = `<p class="muted">Varredura de ${when}: ${span} · ${scan.fixtures} jogos por começar, ${pool},
      ${scan.analyzed} analisados · ${scan.requests} requisições (limite ${scan.budget}).</p>${cornersLine(scan.corners_report)}${old}
      <div class="simbar">${simUI?.has(simId(scan)) ? '<span class="muted">🧪 esta varredura já está na simulação (abaixo)</span>'
        : '<button class="ghost" id="simRun">🧪 Simular as propostas desta varredura</button> <span class="muted">registra tudo o que ela propôs, com a odd da Pinnacle, numa área separada das apostas reais</span>'}</div>
      <div class="chips" id="scanChips">${chips}</div>
      <div class="chips" id="scanOrder"><span class="muted">Ordem:</span>${orders}</div>
      ${mult ? multiView() : ranked.length ? `${explain}<div class="scroll"><table class="scanrank${live ? ' livelist' : ''}">${head}${rows}</table></div>`
        : ok ? `<p class="muted">${cen ? 'Nenhum jogo com aposta ou "entrar se…" pela nossa análise (nossa chance ≥ 45% com a Pinnacle pagando a mínima, odd 1,80–2,70). A nossa leitura de cada jogo está nos cartões das outras abas, com as linhas "na mira".' : combos ? 'Nenhum combo com chance ≥ 60% e odd mínima 1,50–3,00 nos jogos analisados.' : live ? 'Nenhum jogo com plano ao vivo do 1º tempo (sem estatística de escanteios).'
          : 'Nenhum jogo com linha principal jogável (chance ≥ 60%, odd mínima 1,50–3,00) neste filtro.'}</p>` : ''}
      ${mult ? '' : `${skipped}${cards}`}`;
    bindTooltips(out);
    bindLive(out, { banca });
  }

  function card(g, line, i) {
    const top = (line && !line.combo && !line.scenario ? line : null) || bestLine(g.lines), p = g.pinnacle_1h, e = g.expected_1h;
    const sb = market === CENARIO && (g.scenario?.find(l => l.bet) || g.scenario?.find(l => l.conditional));
    const facts = [
      sb ? `<b>${sb.bet ? 'aposta' : 'entrar se…'} (nossa análise)</b>: ${esc(SHORT[sb.market])} ${esc(sb.line)} — nossa ${pct(sb.p_nossa)}, Pinnacle ${n2(sb.pinnacle_odd)} (${pct(sb.p_pinnacle)}), procure odd ≥ ${n2(sb.odd_min)}`
        + `${sb.conditional ? ` · conferir às ${hour(g.fx.t - 30 * 60e3)}: ${esc(sb.conditions.join('; '))}` : ''}` : '',
      g.hard ? `<b>⚠️ jogo difícil de analisar</b> (${esc(g.hard.reasons.join('; '))}): só over de gols com a odd da Pinnacle, com metade da entrada` : '',
      !top ? '<b>sem linha principal jogável</b> (odd mínima 1,50–3,00)'
        : isBet(top) ? `<b>${sb ? 'consistência (odd baixa)' : 'aposta'}</b>: ${esc(SHORT[top.market])} ${esc(top.line)} acerta ${pct(top.p_blend)} (Pinnacle ${top.p_pinnacle != null ? pct(top.p_pinnacle) : '—'}), procure odd ≥ ${n2(top.odd_min)}`
          + `${top.context ? ` · contexto ${top.context.verdict}` : ''}`
          : ctxContra(top) ? `<b>sem aposta pelo contexto</b>: ${esc(SHORT[top.market])} ${esc(top.line)} passa na estatística, mas ${esc(contextLine(top.context))}`
            : priceGap(top) ? `<b>sem aposta pelo preço</b>: odd mínima ${n2(top.odd_min)} contra ${n2(top.pinnacle_odd)} da Pinnacle (${gapTxt(top)})`
              : '<b>sem aposta</b>: nenhuma linha principal passa de especulativa',
      g.favor_text ? `<b>${esc(g.favor_text)}</b>` : '',
      g.no_corners ? `<b>${esc(g.no_corners)}</b>` : p ? '' : 'sem escanteios do 1º tempo na Pinnacle neste jogo',
      p ? `Pinnacle 1T: linha ${nb(p.line)} → total ${n2(p.total)} (modelo ${n2(p.model)})` : '',
      p && e ? `esperado no 1T: ${esc(g.fx.home.name)} ${n2(e.home)} · ${esc(g.fx.away.name)} ${n2(e.away)}` : '',
      p && g.share_1h ? `1º tempo = ${pct(g.share_1h)} dos escanteios do jogo` : '',
      p ? `histórico do 1º tempo: ${g.c1_known[0]} e ${g.c1_known[1]} dos últimos 10 jogos` : '',
      esc(g.no_history || ''), esc(g.no_h2h || ''), ...g.alerts.map(esc),
    ].filter(Boolean);
    // as linhas principais do jogo: os overs de escanteios e gols da lista e a melhor de handicap de gols e do 1X2;
    // chutes só na aba Chutes (difícil achar a linha nas casas)
    const totals = g.lines.filter(x => isMain(x.id) && MAIN_MARKETS.includes(x.market))
      .sort((a, b) => MAIN_MARKETS.indexOf(a.market) - MAIN_MARKETS.indexOf(b.market) || thr(a) - thr(b));
    const all = totals.concat([GOAL_HANDICAP, ...(market === SHOTS_FILTER ? SHOTS : []), '1X2'].map(m => bestLine(g.lines, { market: m })).filter(Boolean));
    const table = all.length ? `<div class="scroll"><table class="mainlines"><tr><th></th><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th>
      <th>Últ. 10</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>${all.map(l => `<tr class="${top && l.id === top.id ? 'on' : ''}${isBet(l) ? '' : ' weak'}">
        <td>${enterBtn(l, isBet(l))}</td><td>${esc(SHORT[l.market])}: <b>${esc(l.line)}</b></td><td>${tierTag(l)}</td><td>${ctxTag(l)}</td><td>${probs(l)}</td><td class="muted">${hits(l)}</td>
        <td>${n2(l.fair_odd_blend)}</td><td><b>${n2(l.odd_min)}</b></td><td class="muted">${n2(l.pinnacle_odd)}</td><td>${valueTxt(l)}</td></tr>`).join('')}</table></div>` : '';
    const c = g.context;
    const ctx = c ? `<ul class="ctx">${c.text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${clubsHtml(c.clubs, g.fx, esc)}
      ${c.h2h.games.length ? `<details class="h2h"><summary>Confrontos diretos (${c.h2h.games.length}${g.h2h_api ? ', todas as competições' : ', só a base da liga'})</summary>
        <ul>${c.h2h.games.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}` : '';
    return `<article class="scancard" id="scan-${i}" data-g="${i}">
      <div class="row head"><h3>${i + 1}. ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${hour(g.fx.t)} · ${esc(g.fx.league.name)}</span></h3>
        <button class="ghost" data-full="${i}">Análise completa ↗</button></div>
      <p class="muted facts">${facts.join(' · ')}</p>
      ${ctx}
      ${scenarioBlock(g)}
      ${table}
      ${comboBlock(g)}
      ${renderLive(g.live1h)}
      ${top ? renderDashboard([top], g.teams) : ''}
    </article>`;
  }

  // ---- simulação (sim.js): tudo o que a varredura propôs, com a odd da Pinnacle, liquidado pelos resultados; guardada à
  // parte (af:sim:<id>, índice af:simidx) — nunca vai para o app de apostas. O painel (simview.js) mostra as das
  // varreduras; as dos planos ficam no Plano do dia ----
  simUI = simPanel({ api, el: $('#simOut'), mine: id => !String(id).startsWith('plano-'), title: '🧪 Simulações das varreduras', onChange: () => render(),
    intro: `Como se tivéssemos entrado em tudo o que cada varredura propôs: nossa análise (aposta e, à parte, "entrar se…" sem conferir),
      a linha de aposta de cada aba de mercado, o combo e a múltipla automática. Odd de entrada = a da Pinnacle na hora da varredura; onde ela não
      cota (linha derivada, só do modelo, combo), a odd mínima do app ("mín."). Lucro em unidades (stake 1 em tudo) e em R$ (a entrada que o app
      propôs). CLV = odd de entrada contra a justa de fechamento da Pinnacle. Combo com devolução numa perna conta como anulada; múltipla com
      devolução ou meia numa perna paga o produto do que cada perna pagou. As simulações dos planos ficam no Plano do dia. Nada daqui entra no app de apostas.` });
  async function runSim() {
    if (!scan?.games.length) return;
    const sim = buildSim(scan, { banca });
    if (!sim.bets.length) { simUI.say('Esta varredura não propôs nenhuma entrada.'); return; }
    await simUI.add(sim);
    simUI.say(`Simulação registrada: ${sim.bets.length} entradas. Os resultados entram com 🔄 Conferir resultados depois dos jogos (e sozinhos com a página aberta).`);
    $('#simOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Múltipla (multiple.js): as pernas possíveis da varredura, o bilhete (automático pelo alvo ou marcado à mão), a odd
  // da casa (por perna ou a total) e o veredito com a entrada. Uma perna por jogo, só over de gols do jogo.
  function multiView() {
    const games = multiGames(scan.games), exp = exposedGames();
    const legOf = gm => gm.options.find(o => o.lineId === multi.lineFor.get(gm.fixtureId)) || gm.best;
    // jogo que já tem entrada (aposta registrada ou na caixa de envio) fica fora: não aumenta a exposição
    const exposed = games.filter(gm => exp.has(gm.fixtureId, gm.best.home, gm.best.away));
    const free = games.filter(gm => !exposed.includes(gm)), legs = free.map(legOf);
    const intro = `<p class="muted">Múltipla = uma perna por jogo, só over de gols do jogo, com chance ≥ 72% (a <b>menor</b> entre a nossa e a da
      mistura com a Pinnacle: numa múltipla o erro de cada perna se multiplica). <b>A conta que manda</b>: com odds justas, a chance de acertar
      tudo é 1 ÷ odd total — odd 6 acerta ~17%, sejam 3 pernas ou 6; "perna segura" não muda isso. O que muda é a <b>margem da casa</b>, que se
      multiplica a cada perna (5 pernas com 5% de margem: −23%). Por isso cada perna tem a sua <b>mínima</b>: se a casa pagar menos numa perna,
      troque a perna. Entrada pequena (¼ Kelly, até 0,5% da banca).
      <b>Por faixa de horário</b>: os bilhetes vêm do mais próximo ao mais longe, cada um com jogos que começam dentro da faixa escolhida
      — aposte cada bilhete antes do primeiro jogo dele. <b>Exposição</b>: jogo que já tem entrada no app de apostas fica fora, e cada jogo
      entra num bilhete só. <b>Linha disponível</b>: só entra linha que a Pinnacle cota no jogo (a casa costuma ter a mesma); jogo sem o
      over 1,5 entra pelo <b>over 2,5</b> (chance ≥ 60%) se cotado; em cada jogo dá para trocar a linha ou marcar uma não cotada.</p>`;
    const expTxt = exposed.length ? `<p class="muted">Fora das múltiplas por já terem entrada: ${exposed.map(gm => `${esc(gm.best.home)} x ${esc(gm.best.away)} (${hour(gm.best.kickoff)})`).join(' · ')}.</p>` : '';
    if (!legs.length) return `${intro}${expTxt}<p class="muted">Nenhuma perna possível nesta varredura (over 1,5 com chance ≥ 72% ou over 2,5 com ≥ 60%, com a Pinnacle, em jogo que não é difícil, ainda não começou e não tem entrada).</p>`;
    // o que pode entrar: as cotadas, menos as desmarcadas, mais as não cotadas marcadas à mão
    // a linha escolhida à mão no jogo (asiática ou não cotada) entra: foi o operador quem viu a linha na casa
    const inPool = l => multi.include.get(l.fixtureId) ?? (l.quoted || multi.lineFor.has(l.fixtureId));
    const tickets = bandTickets(legs.filter(inPool), { target: multi.target, band: multi.band })
      .map(ls => ticketOf(ls, { house: multi.house, houseTotal: multi.totals.get(ls[0].key) ?? null, banca }));
    multi.tickets = tickets;
    const ticketNo = new Map(tickets.flatMap((t, i) => t.legs.map(l => [l.key, { i, leg: l }])));
    const chips = `<div class="chips" id="multiTarget"><span class="muted">Odd justa de cada bilhete:</span>${TARGETS.map(x => `<button class="${multi.target === x ? 'on' : ''}" data-mt="${x}">odd ${x}</button>`).join('')}
      <span class="muted">Faixa de horário:</span>${BANDS.map(h => `<button class="${multi.band === h ? 'on' : ''}" data-mb="${h}">${h} h</button>`).join('')}</div>`;
    const VERD = { vale: ['pos', '✅ vale: a casa paga a mínima'], 'no limite': ['', '⚠️ no limite: acima da justa, abaixo da mínima (sem margem de segurança)'],
      'não vale': ['neg', '❌ não vale: a casa paga menos que a justa — a margem dela come o bilhete'], 'sem odd': ['muted', 'digite a odd da casa (total ou de cada perna)'] };
    const sums = tickets.map((t, i) => { const [vc, vt] = VERD[t.verdict];
      return `<div class="multisum">
      <div><b>Bilhete ${i + 1}</b> · ${hour(t.first_kickoff)}–${hour(t.last_kickoff)} · <b>${t.n} pernas</b> · acerta todas em <b>${pct(t.p_all)}</b>
        <span class="muted">(Pinnacle ${pct(t.p_pinnacle_all)})</span> · odd justa <b>${n2(t.fair)}</b> · mínima <b>${n2(t.min)}</b> · aposte até <b>${hour(t.first_kickoff)}</b>
        ${Date.now() > t.first_kickoff ? ' <span class="tag mid">o primeiro jogo já começou</span>' : ''}</div>
      <div class="muted">${t.legs.map(l => `${hour(l.kickoff)} ${esc(l.home)} x ${esc(l.away)} ${esc(l.line)}`).join(' · ')}</div>
      <div>Odd total na casa: <input class="mtotal" data-mtotal="${esc(t.legs[0].key)}" type="number" step="0.01" min="1" inputmode="decimal" value="${t.odd ?? ''}" placeholder="${n2(t.min)}">
        <span class="${vc}">${vt}</span>${t.ev != null ? ` · EV <b class="${t.ev > 0 ? 'pos' : 'neg'}">${(t.ev * 100).toFixed(1).replace('.', ',')}%</b>` : ''}
        ${t.stake ? ` · entrada <b>R$ ${t.stake}</b>` : t.odd ? ' · <b>sem entrada</b>' : ''}
        <button class="enter" data-mreg="${i}"${t.verdict === 'não vale' ? ' title="a odd da casa não paga a justa"' : ''}>➕ Registrar bilhete ${i + 1}</button></div></div>`; }).join('')
      || '<p class="muted">Nenhum bilhete de 2 pernas ou mais com as pernas marcadas nesta faixa de horário.</p>';
    // a linha do jogo: escolha entre as que passam (over 1,5 / 2,5); a não cotada pela Pinnacle pode faltar na casa
    const noQuote = '<span class="tag mid" title="a Pinnacle não cota esta linha neste jogo (a chance sai do total dela): a casa costuma não ter — troque para a linha seguinte">pode faltar na casa</span>';
    const pernaCell = (gm, l) => (gm.options.length > 1
      ? `<select data-mline="${gm.fixtureId}" title="2 gols: o 1,75 ganha metade, o 2 devolve, o 2,25 perde metade">${gm.options.map(o => `<option value="${esc(o.lineId)}"${o.lineId === l.lineId ? ' selected' : ''}>Gols: ${esc(o.line)} · ${pct(o.p)}${o.asian ? ' (asiática)' : o.quoted ? '' : ' (não cotada)'}</option>`).join('')}</select>`
      : `Gols: <b>${esc(l.line)}</b>`) + (l.asian ? ` <span class="tag" title="perde só com 0–1 gol, como o 1,5; com 2 gols: ${esc(l.line)} ${l.lineId === 'gO1.75' ? 'ganha metade' : l.lineId === 'gO2' ? 'devolve' : 'perde metade'}; 3+ gols paga inteira (${pct(l.p_win)})">asiática</span>` : l.quoted ? '' : ` ${noQuote}`);
    const row = (gm, l) => { const x = ticketNo.get(l.key), on = inPool(l);
      return `<tr class="${x ? '' : 'weak'}${x?.leg.below ? ' bad' : ''}"><td><input type="checkbox" data-mpick="${l.fixtureId}"${on ? ' checked' : ''}></td>
        <td>${x ? `<b>${x.i + 1}</b>` : '<span class="muted">—</span>'}</td><td>${hour(l.kickoff)}</td><td>${esc(l.home)} x ${esc(l.away)}</td><td class="muted">${esc(l.competition)}</td><td>${pernaCell(gm, l)}</td>
        <td><b>${pct(l.p)}</b></td><td class="muted">${pct(l.p_pinnacle)} · ${l.quoted ? n2(l.pinnacle_odd) : 'não cota'}</td><td>${l.context ? `<span class="tag ${CTX_CLS[l.context] || ''}">${esc(l.context)}</span>` : '—'}</td>
        <td>${n2(l.fair)}</td><td><b>${x ? n2(x.leg.min) : '—'}</b></td>
        <td>${x ? `<input class="mleg" type="number" step="0.01" min="1" inputmode="decimal" data-mleg="${esc(l.key)}" value="${multi.house.get(l.key) ?? ''}">${x.leg.below ? ' <span class="neg">abaixo da mínima</span>' : ''}` : ''}</td></tr>`; };
    const order = free.map((gm, i) => [gm, legs[i]]).sort((a, b) => a[1].kickoff - b[1].kickoff);
    return `${intro}${chips}${expTxt}${sums}
      <div class="scroll"><table class="scanrank multitab"><tr><th></th><th>Bilhete</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Perna</th><th>Chance</th><th>Pinnacle</th><th>Contexto</th>
        <th>Justa</th><th>Mínima na múltipla</th><th>Odd da casa</th></tr>${order.map(([gm, l]) => row(gm, l)).join('')}</table></div>`;
  }

  // Para confirmar: as entradas "entrar se…" de todos os jogos, na ordem da hora de conferir (30 min antes), com o botão
  // que busca a escalação (a API publica 20 a 40 min antes) e a linha atual da Pinnacle
  function planList() {
    const items = scan.games.flatMap(g => (g.scenario || []).filter(l => l.conditional).slice(0, 1).map(l => ({ g, l })))
      .filter(x => !started(x.g)).sort((a, b) => a.g.fx.t - b.g.fx.t);
    if (!items.length) return '';
    return `<div class="plan"><h4>⏰ Para confirmar (${items.length})</h4><ul>${items.map(({ g, l }) => `<li>
      <b>${hour(g.fx.t - 30 * 60e3)}</b> · ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} (${hour(g.fx.t)}) — ${esc(SHORT[l.market] || l.market)}: <b>${esc(l.line)}</b>,
      odd ≥ ${n2(l.odd_min)} · <span class="muted">${esc(l.conditions.join('; '))}</span>
      <button class="ghost mini" data-check="${g.fx.id}">Conferir agora</button><div class="chk" id="chk-${g.fx.id}"></div></li>`).join('')}</ul></div>`;
  }

  // Conferir um jogo (lineupcheck.js): a escalação de cada time contra os titulares habituais da temporada, as dúvidas
  // da API, a Pinnacle agora (e se a API já atualizou depois da escalação) e o veredito de cada linha: entrada cheia,
  // meia entrada, não entrar ou esperar a escalação
  async function checkFixture(fxId, btn) {
    const g = scan.games.find(x => x.fx.id === fxId), el = $(`#chk-${fxId}`);
    if (!g || !el) return;
    btn.disabled = true; el.textContent = 'Conferindo escalação, titulares da temporada e linha da Pinnacle…';
    const [lu, od] = await Promise.all([api.lineups(fxId).catch(e => ({ error: e.message })), api.fixtureOdds(fxId).catch(() => null)]);
    const names = { home: g.fx.home.name, away: g.fx.away.name }, sideId = { home: g.fx.home.id, away: g.fx.away.id };
    let rep = null;
    const out = [];
    if (lu?.error) out.push(`<p class="neg">escalação: erro da API (${esc(lu.error)})</p>`);
    else if (lu?.length) {
      const xi = k => lu.find(t => t.team === sideId[k]);
      const pl = await Promise.all(['home', 'away'].map(k => (xi(k) && api.teamPlayers ? api.teamPlayers(sideId[k], g.fx.league.season).catch(() => null) : null)));
      rep = { home: lineupReport(pl[0], xi('home')), away: lineupReport(pl[1], xi('away')) };
    }
    const inXI = (i, t) => (i.id && t?.startIds ? t.startIds.includes(i.id) : t?.start.includes(i.player));
    const doubts = (g.injuries || []).filter(i => i.type === 'Questionable').map(i => {
      const side = i.team === sideId.home ? 'home' : 'away', t = lu?.length ? lu.find(x => x.team === i.team) : null;
      return { player: i.player, side, plays: t ? inXI(i, t) : null };
    });
    const now = od?.bookmakers?.length ? collect(od.bookmakers).odds : null;
    const lines = (g.scenario || []).filter(x => x.conditional || x.bet).slice(0, 3);
    for (const l of lines) {
      const v = lineVerdict({ line: l, rep, names, odds: { now: now?.get(l.id) ?? null, updatedAt: od?.updatedAt }, kickoff: g.fx.t, doubts });
      const stake = v.stake == null ? '' : v.verdict === 'meia' ? ` · R$ ${v.stake} (metade de ${l.entry_brl})` : v.stake ? ` · R$ ${v.stake}` : '';
      out.push(`<div class="verdict v-${v.verdict}"><b>${esc(v.title)}</b> · ${esc(SHORT[l.market] || l.market)} ${esc(l.line)}${stake}
        <ul>${v.reasons.map(r => `<li class="${r.sign > 0 ? 'pos' : r.sign < 0 ? 'neg' : ''}">${r.sign > 0 ? '＋ ' : r.sign < 0 ? '－ ' : '· '}${esc(r.text)}</li>`).join('')}</ul></div>`);
    }
    if (lu?.length) out.push(`<details class="xi"><summary>Escalações</summary>${lu.map(t => `<div><b>${esc(t.name)}</b>${t.formation ? ` (${esc(t.formation)})` : ''}: ${t.start.map(esc).join(', ')}</div>`).join('')}</details>`);
    el.innerHTML = out.join('') || 'Sem dados novos.';
    btn.disabled = false;
  }

  // Nossa análise do jogo: a nossa leitura (modelo corrigido + cenário), a Pinnacle ao lado e as linhas com o status
  function scenarioBlock(g) {
    const c = g.context?.scenario;
    if (!isScenario(c) || !g.scenario?.length) return '';   // varredura de antes da nossa análise: sem o bloco
    const rows = g.scenario.map(l => `<tr class="${l.bet || l.conditional ? '' : 'weak'}"><td>${enterBtn(l, l.bet || l.conditional)}</td>${scenCells(l)}
      <td class="muted small">${l.conditional ? esc(l.conditions.join('; ')) : l.status === 'na mira' ? `entra se a casa pagar ≥ ${n2(l.odd_min)}` : l.bet ? '' : esc(l.why_not.join('; '))}</td></tr>`).join('');
    const games = (p, n) => (p?.games?.length ? `<li><b>${esc(n)} ${esc(p.how)}</b>${p.relaxed ? ` <span class="muted">(${esc(p.relaxed)})</span>` : ''}: ${p.games.map(esc).join(' · ')}</li>` : '');
    const best = g.scenario.find(l => l.bet) || g.scenario.find(l => l.conditional);
    const read = (g.context.text || []).find(t => t.startsWith('Nossa leitura'));
    const inj = g.injuries?.length ? `<p class="muted small">Desfalques e dúvidas (API): ${g.injuries.slice(0, 8).map(i => `${esc(i.player)} (${esc(i.team === g.fx.home.id ? g.fx.home.name : g.fx.away.name)}, ${esc(i.type === 'Questionable' ? 'dúvida' : i.reason || i.type)})`).join(' · ')}</p>` : '';
    return `<details class="combos"${market === CENARIO ? ' open' : ''}><summary>🎯 Nossa análise${best ? `: <b>${esc(SHORT[best.market])} ${esc(best.line)}</b> a partir de ${n2(best.odd_min)}${best.conditional ? ' (entrar se…)' : ''}` : ' (sem aposta)'}</summary>
      <p class="muted">${esc(read || '')} Nível na base: ${esc(g.fx.home.name)} ${esc(c.level?.home || '—')}, ${esc(g.fx.away.name)} ${esc(c.level?.away || '—')}.</p>${inj}
      <ul class="ctx">${games(c.home, g.fx.home.name)}${games(c.away, g.fx.away.name)}</ul>
      <div class="scroll"><table class="mainlines"><tr><th></th>${scenHead}<th></th></tr>${rows}</table></div></details>`;
  }

  // Combos do jogo: abertos no filtro Combos; nos outros, recolhidos
  function comboBlock(g) {
    if (!g.combos?.length) return '';
    const rows = g.combos.map(c => `<tr class="${isBet(c) ? '' : 'weak'}"><td>${enterBtn(c, isBet(c))}</td>${comboCells(c)}</tr>`).join('');
    const legs = c => c.legs.map(x => `${esc(x.line)} ${pct(x.p)}${x.push ? ` (devolve ${pct(x.push)})` : ''} · justa ${n2(x.fair_odd)}`).join(' — ');
    const best = g.combos.find(isBet) || g.combos[0];
    return `<details class="combos"${market === COMBOS ? ' open' : ''}><summary>Combos de duas pernas (${g.combos.length}${g.combos.some(isBet) ? `, ${g.combos.filter(isBet).length} para apostar` : ''})</summary>
      <p class="muted">Melhor: <b>${esc(best.line)}</b> — acerta ${pct(best.p_blend)}${best.push_prob > 0.005 ? ` (${pct(best.p_full)} com as duas pernas, ${pct(best.push_prob)} só a de gols)` : ''}, procure odd ≥ ${n2(best.odd_min)}${isBet(best) ? '' : ' (especulativo: sem aposta)'}. Pernas: ${legs(best)}.</p>
      <div class="scroll"><table class="mainlines"><tr><th></th>${comboHead}</tr>${rows}</table></div></details>`;
  }

  // múltipla: marcar/desmarcar perna e as odds da casa (ao sair do campo)
  $('#scanOut').addEventListener('change', e => {
    const pk = e.target.closest('[data-mpick]');
    if (pk) { multi.include.set(Number(pk.dataset.mpick), pk.checked); render(); return; }
    const ml = e.target.closest('[data-mline]');
    if (ml) { multi.lineFor.set(Number(ml.dataset.mline), ml.value); render(); return; }
    const lg = e.target.closest('[data-mleg]');
    if (lg) { const v = parseFloat(lg.value); if (v > 1) multi.house.set(lg.dataset.mleg, v); else multi.house.delete(lg.dataset.mleg); render(); return; }
    const mt = e.target.closest('[data-mtotal]');
    if (mt) { const v = parseFloat(mt.value); if (v > 1) multi.totals.set(mt.dataset.mtotal, v); else multi.totals.delete(mt.dataset.mtotal); render(); }
  });
  $('#scanOut').addEventListener('click', e => {
    const ck = e.target.closest('[data-check]');
    if (ck) { checkFixture(Number(ck.dataset.check), ck); return; }
    if (e.target.closest('#simRun')) { runSim(); return; }
    const mt = e.target.closest('[data-mt]');
    if (mt) { multi.target = Number(mt.dataset.mt); render(); return; }
    const mb = e.target.closest('[data-mb]');
    if (mb) { multi.band = Number(mb.dataset.mb); render(); return; }
    const mr = e.target.closest('[data-mreg]');
    if (mr && multi.tickets[mr.dataset.mreg]) {
      const t = multi.tickets[mr.dataset.mreg], line = multiLine(t);
      openEntry(line.id, t.odd, { line, fx: { id: line.id, t: t.first_kickoff, home: { name: 'Múltipla' }, away: { name: `${t.n} jogos` }, league: { name: 'várias ligas' } }, btn: e.target });
      return;
    }
    const m = e.target.closest('#scanChips button');
    if (m) { market = m.dataset.m || null; render(); return; }
    const o = e.target.closest('#scanOrder button');
    if (o) { order = o.dataset.o; render(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { $(`#scan-${go.dataset.go}`).scrollIntoView({ behavior: 'smooth' }); return; }
    const full = e.target.closest('[data-full]');
    if (full) { openFull(ranked[full.dataset.full].g.fx, full); return; }
    const en = e.target.closest('[data-enter]');
    if (en) {
      const { g, line } = ranked[en.closest('[data-g]').dataset.g];
      // o botão do cenário vem antes: a mesma linha pode estar nas linhas principais com outro preço
      const pool = en.closest('details.combos') ? [...(g.scenario || []), ...(g.combos || [])] : [line && !line.combo && !line.scenario ? line : null, ...g.lines];
      const l = pool.find(x => x && x.id === en.dataset.enter) || bestLine(g.lines);
      if (l) openEntry(l.id, null, { line: l, fx: g.fx, btn: en });
    }
  });

  // Análise completa: some a análise anterior, mostra o progresso na busca e, pronta, rola até o jogo
  // (a análise fica abaixo da lista da varredura). Seleção é reconhecida pela ficha do time.
  async function openFull(fx, btn) {
    btn.disabled = true;
    $('#out').hidden = true;
    $('#teamInput').scrollIntoView({ block: 'start' });
    const m = $('#msg');
    m.hidden = false; m.classList.remove('err'); m.textContent = `Abrindo a análise completa de ${fx.home.name} x ${fx.away.name}…`;
    let national = false;
    try { national = !!(await api.teamInfo(fx.home.id))?.national; } catch { /* segue como clube */ }
    if (await analyzeFixture(fx, national)) $('#out').scrollIntoView({ block: 'start' });
    btn.disabled = false;
  }

  // Com a página aberta e a aba Nossa análise na tela: de 40 min antes do jogo até o início, cada "entrar se…" é
  // conferido sozinho a cada 5 min (escalação e linha da Pinnacle). Sem aviso com a página fechada.
  const lastCheck = new Map();
  setInterval(() => {
    if (document.hidden || !scan || market !== CENARIO) return;
    for (const btn of document.querySelectorAll('#scanOut [data-check]')) {
      const id = Number(btn.dataset.check), g = scan.games.find(x => x.fx.id === id), now = Date.now();
      if (g && now >= g.fx.t - 40 * 60e3 && now < g.fx.t && now - (lastCheck.get(id) || 0) > 5 * 60e3) { lastCheck.set(id, now); checkFixture(id, btn); }
    }
  }, 60e3);

  // registrou um bilhete: o jogo passa a ter entrada e sai dos próximos bilhetes
  $('#entryDlg')?.addEventListener('close', () => { if (market === MULTI && scan) render(); });
  bindSpecialist($('#scanSpec'), () => scan && (market === MULTI ? briefMulti(scan, multi.tickets) : briefScan(scan, ranked, { market, order })));
  showSaved();
}
