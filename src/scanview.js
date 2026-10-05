// Tela da varredura: até 20 jogos das próximas 4 horas (ou de um dia), em ordem de horário — cada um com as
// linhas principais do pré-jogo (escanteios 1T, escanteios do jogo, handicap de gols, gols e handicap de
// escanteios), o contexto do jogo (tabela, médias, esperado, confronto direto) e as checagens de cada linha,
// o plano de entrada ao vivo nos escanteios do 1º tempo, os gráficos dos últimos 10 jogos de cada time na
// melhor linha e o atalho para a análise completa do jogo.

import { GOAL_HANDICAP, HANDICAP, LIVE_1H, MAIN_MARKETS, SCAN_MARKETS, bestLine, pickGames, scanDay } from './scanner.js';
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
  'Total de gols': 'Gols', [HANDICAP]: 'Handicap esc.', [GOAL_HANDICAP]: 'Handicap gols' };
const signed = x => `${x > 0 ? '+' : ''}${nb(x)}`;
const tierTag = l => `<span class="tag ${l.tier === 'âncora' ? 'ok' : l.tier === 'sólida' ? 'mid' : 'no'}">${l.tier}</span>`;
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
const FILTERS = [['Melhor do jogo', null], ...SCAN_MARKETS.map(m => [SHORT[m], m]), ['1T ao vivo', LIVE_1H]];
// Plano ao vivo: odd mínima e chance do over numa linha, no minuto e com os escanteios dados.
const liveCell = (plan, c, m, L) => {
  const x = plan?.tables.find(t => t.corners === c)?.rows.find(r => r.minute === m)?.cells.find(z => z.line === L);
  return x ? `<b>${n2(x.odd_min)}</b> <span class="muted">${pct(x.p)}</span>` : '—';
};
const started = g => Date.now() > g.fx.t;

export function initScan({ api, openEntry, analyzeFixture, banca }) {
  let scan = null, market = null, order = 'time', ranked = [];
  $('#scanDate').innerHTML = [['Próximas 4 horas', WINDOW], ['Hoje (dia todo)', dayStr(0)], ['Amanhã', dayStr(1)]]
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
    const top = scan.top || 20, live = market === LIVE_1H;
    ranked = scan.v >= 3 ? pickGames(scan.games, { market, top, order }) : [];
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const chips = FILTERS.map(([t, m]) => `<button class="${market === m ? 'on' : ''}" data-m="${esc(m ?? '')}">${esc(t)}</button>`).join('');
    const orders = [['Horário', 'time'], ['Chance de ganho', 'chance']].map(([t, o]) => `<button class="${order === o ? 'on' : ''}" data-o="${o}">${t}</button>`).join('');
    // varredura guardada pela versão anterior (só jogos com o 1º tempo na Pinnacle) não tem with_1h
    const pool = scan.with_1h == null ? `${scan.with_odds} com escanteios do 1º tempo na Pinnacle`
      : `${scan.with_odds} com odds da Pinnacle (${scan.with_1h} com escanteios do 1º tempo)`;
    const span = scan.window ? `próximas ${scan.hours} horas (${hour(scan.window.from)} a ${hour(scan.window.to)})` : 'o dia inteiro';
    const rows = ranked.map(({ g, line }, i) => {
      const go = `data-go="${i}"`, kick = `${hour(g.fx.t)}${started(g) ? ' <span class="tag mid">começou</span>' : ''}`;
      const game = `<td>${i + 1}</td><td>${kick}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td><td class="muted">${esc(g.fx.league.name)}</td>`;
      if (live) {
        const p = g.live1h;
        return `<tr ${go}>${game}<td>${n2(p.mu)}${p.anchored ? ` <span class="muted">· Pin ${n2(p.pinnacle_total)}</span>` : ' <span class="muted">· modelo</span>'}</td>
          <td>${liveCell(p, 0, 0, 3.5)}</td><td>${liveCell(p, 0, 5, 3.5)}</td><td>${liveCell(p, 0, 10, 3.5)}</td><td>${liveCell(p, 1, 10, 3.5)}</td></tr>`;
      }
      const gap = priceGap(line);
      return `<tr ${go} class="${isBet(line) ? '' : 'weak'}">${game}<td>${esc(SHORT[line.market] || line.market)}: <b>${esc(line.line)}</b></td>
        <td>${tierTag(line)}${gap ? ` <span class="tag price" title="sem aposta: a odd mínima fica ${gapTxt(line)}; casa soft raramente paga mais de 5% acima">+${gap1(line)}% Pin</span>` : ''}</td>
        <td>${ctxTag(line)}</td><td>${probs(line)}</td><td class="muted">${hits(line)}</td><td>${n2(line.fair_odd_blend)}</td><td><b>${n2(line.odd_min)}</b></td>
        <td class="muted">${line.pinnacle_odd ? n2(line.pinnacle_odd) : '—'}</td><td>${valueTxt(line)}</td></tr>`;
    }).join('');
    const head = live
      ? '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Esperado 1T</th><th>+3,5 no 0\'</th><th>5\' sem esc.</th><th>10\' sem esc.</th><th>10\' com 1</th></tr>'
      : '<tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>';
    const cards = ranked.map(({ g, line }, i) => card(g, line, i)).join('');
    const skipped = scan.skipped.length ? `<details class="skipped"><summary>${scan.skipped.length} jogos com odds que ficaram de fora</summary><ul>
      ${scan.skipped.map(s => `<li>${hour(s.fx.t)} ${esc(s.fx.home.name)} x ${esc(s.fx.away.name)} <span class="muted">(${esc(s.fx.league.name)}): ${esc(s.why)}</span></li>`).join('')}</ul></details>` : '';
    const nBet = live ? 0 : ranked.filter(x => isBet(x.line)).length;
    const old = scan.v >= 4 ? '' : '<p class="msg">Varredura feita antes do contexto e do plano ao vivo: toque em Varrer jogos de novo.</p>';
    const explain = live
      ? `<p class="muted">Jogos para a entrada ao vivo no over de escanteios do 1º tempo, dos que mais devem ter escanteios no 1º tempo (com o total
        da Pinnacle primeiro). Cada casa: odd mínima do Mais de 3,5 e a chance. Sem escanteio, a odd mínima sobe a cada minuto: entre só quando a casa
        pagar pelo menos ela. A grade completa e a calculadora estão em cada jogo.</p>`
      : `<p class="muted"><b>${nBet} ${nBet === 1 ? 'jogo com aposta' : 'jogos com aposta'}</b> neste filtro. Os ${ranked.length} de maior chance de ganho,
        ${order === 'time' ? 'em ordem de horário' : 'pela chance de ganho'}. Chance = a nossa probabilidade (Pinnacle sem margem + modelo, sem contar a devolução)
        e, ao lado, a da Pinnacle; o histórico dos dois times entra no nível. Contexto = mando, médias, confronto direto e tabela confirmando a linha
        (passe o mouse para ver). Apagados: sem aposta (especulativa, odd mínima mais de 5% acima da Pinnacle ou contexto contra).</p>`;
    out.innerHTML = `<p class="muted">Varredura de ${when}: ${span} · ${scan.fixtures} jogos por começar, ${pool},
      ${scan.analyzed} analisados · ${scan.requests} requisições (limite ${scan.budget}).</p>${old}
      <div class="chips" id="scanChips">${chips}</div>
      <div class="chips" id="scanOrder"><span class="muted">Ordem:</span>${orders}</div>
      ${ranked.length ? `${explain}<div class="scroll"><table class="scanrank${live ? ' livelist' : ''}">${head}${rows}</table></div>`
        : scan.v >= 3 ? `<p class="muted">${live ? 'Nenhum jogo com plano ao vivo do 1º tempo (sem estatística de escanteios).'
          : 'Nenhum jogo com linha principal jogável (odd mínima 1,50–3,00) neste filtro.'}</p>` : ''}
      ${skipped}${cards}`;
    bindTooltips(out);
    bindLive(out, { banca });
  }

  function card(g, line, i) {
    const top = line || bestLine(g.lines), p = g.pinnacle_1h, e = g.expected_1h;
    const facts = [
      !top ? '<b>sem linha principal jogável</b> (odd mínima 1,50–3,00)'
        : isBet(top) ? `<b>aposta</b>: ${esc(SHORT[top.market])} ${esc(top.line)} acerta ${pct(top.p_blend)} (Pinnacle ${top.p_pinnacle != null ? pct(top.p_pinnacle) : '—'}), procure odd ≥ ${n2(top.odd_min)}`
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
    // as linhas principais do jogo — de cada total, o lado com mais chance — e o melhor de cada handicap
    const totals = new Map();
    for (const l of g.lines.filter(x => isMain(x.id))) {
      const k = `${l.market}|${thr(l)}`;
      if (!totals.has(k) || l.p_blend > totals.get(k).p_blend) totals.set(k, l);
    }
    const hcps = [HANDICAP, GOAL_HANDICAP].map(m => bestLine(g.lines, { market: m })).filter(Boolean);
    const all = [...totals.values()].sort((a, b) => MAIN_MARKETS.indexOf(a.market) - MAIN_MARKETS.indexOf(b.market) || thr(a) - thr(b))
      .concat(hcps);
    const table = all.length ? `<div class="scroll"><table class="mainlines"><tr><th>Linha</th><th>Nível</th><th>Contexto</th><th>Chance · Pinnacle</th>
      <th>Últ. 10</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Valor</th></tr>${all.map(l => `<tr class="${top && l.id === top.id ? 'on' : ''}${isBet(l) ? '' : ' weak'}">
        <td>${esc(SHORT[l.market])}: <b>${esc(l.line)}</b></td><td>${tierTag(l)}</td><td>${ctxTag(l)}</td><td>${probs(l)}</td><td class="muted">${hits(l)}</td>
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
      ${table}
      ${renderLive(g.live1h)}
      ${top ? renderDashboard([top], g.teams) : ''}
    </article>`;
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
      const { g, line } = ranked[en.closest('[data-g]').dataset.g], l = line || bestLine(g.lines);
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
