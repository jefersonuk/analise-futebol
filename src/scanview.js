// Tela da varredura: até 20 jogos das próximas 4 horas (ou de um dia), em ordem de horário — cada um com as
// linhas principais do pré-jogo (escanteios 1T, escanteios do jogo, handicap de gols, gols e handicap de
// escanteios), o contexto do jogo (tabela, médias, esperado, confronto direto) e as checagens de cada linha,
// o plano de entrada ao vivo nos escanteios do 1º tempo, os gráficos dos últimos 10 jogos de cada time na
// melhor linha e o atalho para a análise completa do jogo.

import { CENARIO, COMBOS, FILTER_KEYS, GOAL_HANDICAP, LIVE_1H, MAIN_MARKETS, SHOTS, SHOTS_FILTER, bestLine, pickGames, scanDay } from './scanner.js';
import { bindTooltips, renderDashboard } from './dashboard.js';
import { load, save } from './store.js';
import { bindSpecialist, briefScan } from './brief.js';
import { isMain } from './consistency.js';
import { isBet, isCandidate } from './dossier.js';
import { contextLine } from './context.js';
import { bindLive, renderLive } from './liveview.js';

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
// Melhor do jogo: handicap de gols, gols, chutes e 1X2 (escanteios só nas abas deles, e só over).
// 🎯 Cenário (a padrão): odd perto de 2 pela leitura de cenário dos dois times.
const FILTERS = [['🎯 Cenário', CENARIO], ['Melhor do jogo', null], ...FILTER_KEYS.map(m => [SHORT[m], m]), ['1T ao vivo', LIVE_1H]];
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
const scenTag = l => `<span class="tag ${l.bet ? 'ok' : ''}" title="${esc(l.bet ? 'aposta de cenário' : l.why_not.join('; '))}">${l.bet ? l.tier : 'sem aposta'}</span>`;
const scenHead = '<th>Linha</th><th>Cenário</th><th>Pinnacle</th><th>Chance: Pinnacle → cenário</th><th>Valor no cenário</th><th>Mínima</th><th>Entrada</th>';
const scenCells = l => `<td>${esc(SHORT[l.market] || l.market)}: <b>${esc(l.line)}</b></td><td>${scenTag(l)}</td><td>${n2(l.pinnacle_odd)}</td>
  <td>${pct(l.p_pinnacle)} → <b>${pct(l.p_scenario)}</b></td><td><span class="${l.ev_pinnacle >= 0.05 ? 'pos' : l.ev_pinnacle < 0 ? 'neg' : 'muted'}">${signed(Math.round(l.ev_pinnacle * 100))}%</span></td>
  <td><b>${n2(l.odd_min)}</b></td><td class="muted">${l.bet && l.entry_brl ? `R$ ${l.entry_brl} · ${l.politica_e}` : '—'}</td>`;
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
  $('#scanDate').innerHTML = [['Próximas 4 horas (amplia até 12 h se faltar jogo)', WINDOW], ['Hoje (dia todo)', dayStr(0)], ['Amanhã', dayStr(1)]]
    .map(([t, v]) => `<option value="${v}">${t}${v === WINDOW ? '' : ` (${v.split('-').reverse().slice(0, 2).join('/')})`}</option>`).join('');
  $('#scanBudget').value = localStorage.getItem(BUDGET_KEY) || 1500;
  const msg = (text, err = false) => { const el = $('#scanMsg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', err); };

  async function showSaved() {
    scan = await load(`af:scan:${$('#scanDate').value}`);
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
    const top = scan.top || 20, live = market === LIVE_1H, combos = market === COMBOS, cen = market === CENARIO;
    const ok = scan.v >= (cen ? 9 : combos ? 8 : 7);
    ranked = ok ? pickGames(scan.games, { market, top, order }) : [];
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
      if (cen) return `<tr ${go} class="${line.bet ? '' : 'weak'}">${game}${scenCells(line)}<td class="muted small">${scenShort(g)}</td></tr>`;
      const gap = priceGap(line);
      return `<tr ${go} class="${isBet(line) ? '' : 'weak'}">${game}<td>${esc(SHORT[line.market] || line.market)}: <b>${esc(line.line)}</b></td>
        <td>${tierTag(line)}${gap ? ` <span class="tag price" title="sem aposta: a odd mínima fica ${gapTxt(line)}; casa soft raramente paga mais de 5% acima">+${gap1(line)}% Pin</span>` : ''}</td>
        <td>${ctxTag(line)}</td><td>${probs(line)}</td><td class="muted">${hits(line)}</td><td>${n2(line.fair_odd_blend)}</td><td><b>${n2(line.odd_min)}</b></td>
        <td class="muted">${line.pinnacle_odd ? n2(line.pinnacle_odd) : '—'}</td><td>${valueTxt(line)}</td></tr>`;
    }).join('');
    const head = cen ? `<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th>${scenHead}<th>Leitura dos dois times</th></tr>` : combos ? `<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th>${comboHead}</tr>` : live
      ? '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Esperado 1T</th><th>+3,5 no 0\'</th><th>5\' sem esc.</th><th>10\' sem esc.</th><th>10\' com 1</th></tr>'
      : '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>';
    const cards = ranked.map(({ g, line }, i) => card(g, line, i)).join('');
    const skipped = scan.skipped.length ? `<details class="skipped"><summary>${scan.skipped.length} jogos com odds que ficaram de fora</summary><ul>
      ${scan.skipped.map(s => `<li>${hour(s.fx.t)} ${esc(s.fx.home.name)} x ${esc(s.fx.away.name)} <span class="muted">(${esc(s.fx.league.name)}): ${esc(s.why)}</span></li>`).join('')}</ul></details>` : '';
    const nBet = live ? 0 : cen ? ranked.filter(x => x.line.bet).length : ranked.filter(x => isBet(x.line)).length;
    const old = ok ? '' : cen ? '<p class="msg">Varredura feita antes da leitura de cenário: toque em Varrer jogos de novo.</p>' : combos ? '<p class="msg">Varredura feita antes dos combos: toque em Varrer jogos de novo.</p>'
      : '<p class="msg">Varredura feita antes da regra "só over" (com chutes e 1X2, e o Melhor do jogo sem escanteios): toque em Varrer jogos de novo.</p>';
    const explain = cen
      ? `<p class="muted"><b>${nBet} ${nBet === 1 ? 'jogo com aposta de cenário' : 'jogos com aposta de cenário'}</b>. Cada time é comparado com os jogos de
        <b>mesmas características</b> do de hoje — mesmo mando e mesmo papel (favorito forte, favorito, equilibrado, zebra, zebra forte, pela superioridade
        esperada antes de cada jogo) — e não com a média da temporada: o favorito que goleia quando é favorito em casa, a zebra que desaba quando é zebra fora.
        O saldo e os gols além do esperado nesses jogos corrigem o que a Pinnacle precifica (com peso pela amostra), e a tabela (motivação) e o clássico
        entram na leitura. <b>Aposta de cenário</b>: odd da Pinnacle de 1,80 a 2,70, chance pelo cenário ≥ 45%, a Pinnacle pagando pelo menos 5% acima do
        justo pelo cenário, amostra nos dois times e os dois cenários apontando para o mesmo lado. Só over nos gols. Entre com odd ≥ a mínima.</p>`
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
      <div class="chips" id="scanChips">${chips}</div>
      <div class="chips" id="scanOrder"><span class="muted">Ordem:</span>${orders}</div>
      ${ranked.length ? `${explain}<div class="scroll"><table class="scanrank${live ? ' livelist' : ''}">${head}${rows}</table></div>`
        : ok ? `<p class="muted">${cen ? 'Nenhum jogo com aposta de cenário (odd da Pinnacle 1,80–2,70 com valor de 5% pelo cenário, amostra e os dois cenários de acordo). A leitura de cenário de cada jogo está nos cartões das outras abas.' : combos ? 'Nenhum combo com chance ≥ 60% e odd mínima 1,50–3,00 nos jogos analisados.' : live ? 'Nenhum jogo com plano ao vivo do 1º tempo (sem estatística de escanteios).'
          : 'Nenhum jogo com linha principal jogável (chance ≥ 60%, odd mínima 1,50–3,00) neste filtro.'}</p>` : ''}
      ${skipped}${cards}`;
    bindTooltips(out);
    bindLive(out, { banca });
  }

  function card(g, line, i) {
    const top = (line && !line.combo && !line.scenario ? line : null) || bestLine(g.lines), p = g.pinnacle_1h, e = g.expected_1h;
    const sb = market === CENARIO && g.scenario?.find(l => l.bet);
    const facts = [
      sb ? `<b>aposta de cenário</b>: ${esc(SHORT[sb.market])} ${esc(sb.line)} — Pinnacle ${n2(sb.pinnacle_odd)} (${pct(sb.p_pinnacle)}), pelo cenário ${pct(sb.p_scenario)}, procure odd ≥ ${n2(sb.odd_min)}` : '',
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
    // as linhas principais do jogo: os overs de escanteios e gols da lista e a melhor de handicap de gols, de cada
    // chutes e do 1X2
    const totals = g.lines.filter(x => isMain(x.id) && MAIN_MARKETS.includes(x.market))
      .sort((a, b) => MAIN_MARKETS.indexOf(a.market) - MAIN_MARKETS.indexOf(b.market) || thr(a) - thr(b));
    const all = totals.concat([GOAL_HANDICAP, ...SHOTS, '1X2'].map(m => bestLine(g.lines, { market: m })).filter(Boolean));
    const table = all.length ? `<div class="scroll"><table class="mainlines"><tr><th></th><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th>
      <th>Últ. 10</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>${all.map(l => `<tr class="${top && l.id === top.id ? 'on' : ''}${isBet(l) ? '' : ' weak'}">
        <td>${enterBtn(l, isBet(l))}</td><td>${esc(SHORT[l.market])}: <b>${esc(l.line)}</b></td><td>${tierTag(l)}</td><td>${ctxTag(l)}</td><td>${probs(l)}</td><td class="muted">${hits(l)}</td>
        <td>${n2(l.fair_odd_blend)}</td><td><b>${n2(l.odd_min)}</b></td><td class="muted">${n2(l.pinnacle_odd)}</td><td>${valueTxt(l)}</td></tr>`).join('')}</table></div>` : '';
    const c = g.context;
    const ctx = c ? `<ul class="ctx">${c.text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
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

  // Leitura de cenário do jogo: as linhas da Pinnacle pelo cenário (aberta na aba Cenário) e os jogos de cada time
  function scenarioBlock(g) {
    const c = g.context?.scenario;
    if (!c || !g.scenario?.length) return '';
    const rows = g.scenario.map(l => `<tr class="${l.bet ? '' : 'weak'}"><td>${enterBtn(l, l.bet)}</td>${scenCells(l)}
      <td class="muted small">${l.bet ? '' : esc(l.why_not.join('; '))}</td></tr>`).join('');
    const games = (p, n) => (p?.games?.length ? `<li><b>${esc(n)} ${esc(p.how)}</b>${p.relaxed ? ` <span class="muted">(${esc(p.relaxed)})</span>` : ''}: ${p.games.map(esc).join(' · ')}</li>` : '');
    const best = g.scenario.find(l => l.bet);
    return `<details class="combos"${market === CENARIO ? ' open' : ''}><summary>🎯 Leitura de cenário${best ? `: <b>${esc(SHORT[best.market])} ${esc(best.line)}</b> a partir de ${n2(best.odd_min)}` : ' (sem aposta)'}</summary>
      <p class="muted">Papel de hoje: ${esc(g.fx.home.name)} ${esc(c.band.home)} · ${esc(g.fx.away.name)} ${esc(c.band.away)} (superioridade ${c.market.source === 'pinnacle' ? 'da Pinnacle' : 'do modelo'}: ${signed(nb(c.market.sup.toFixed(2)))}).
        Correção pelo cenário: ${signed(nb(c.adj_sup.toFixed(2)))} gol no saldo do mandante, ${signed(nb(c.adj_total.toFixed(2)))} no total${c.agree ? '' : ' — os dois cenários discordam'}${c.enough ? '' : ' — amostra curta'}.</p>
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

  $('#scanOut').addEventListener('click', e => {
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

  bindSpecialist($('#scanSpec'), () => scan && briefScan(scan, ranked, { market, order }));
  showSaved();
}
