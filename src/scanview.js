// Tela da varredura do dia: valor nas linhas principais do pré-jogo — ranking, relatório de cada jogo com
// todas as linhas principais e os gráficos dos últimos 10 jogos de cada time na melhor delas, entrada direta
// e atalho para a análise completa do jogo.

import { HANDICAP, MAIN_MARKETS, SCAN_MARKETS, bestLine, rankGames, scanDay } from './scanner.js';
import { bindTooltips, renderDashboard } from './dashboard.js';
import { load, save } from './store.js';
import { bindSpecialist, briefScan } from './brief.js';
import { isMain, isUnder, isValueBet } from './consistency.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => `${Math.round(x * 100)}%`;
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const nb = x => String(x).replace('.', ',');
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const BUDGET_KEY = 'afScanBudget';
// Valor confirmado que não é aposta pelo preço: a odd mínima passa de 5% acima da Pinnacle (casa soft
// raramente paga isso). Sem aposta de valor no jogo, a tela mostra a linha de mais valor, mas apagada.
const priceGap = l => (!isValueBet(l) && l.value_level === 'confirmado' && l.odd_min_vs_pinnacle_pct > 5 ? l.odd_min_vs_pinnacle_pct : null);
const gap1 = l => nb(Math.round(priceGap(l) * 10) / 10);   // 5,3: o corte é 5%, não arredonda para ele
const gapTxt = l => `${gap1(l)}% acima da Pinnacle`;
const SHORT = { 'Total escanteios 1T': 'Escanteios 1T', 'Total de escanteios': 'Escanteios', 'Total de gols 1T': 'Gols 1T',
  'Total de gols': 'Gols', [HANDICAP]: 'Handicap esc.' };
const VALUE_CLS = { confirmado: 'ok', 'sem confirmação': 'mid', 'sem valor': 'no' };
const signed = x => `${x > 0 ? '+' : ''}${nb(x)}`;
const valueTag = l => (l.value_pct == null ? '<span class="muted">—</span>'
  : `<b class="${l.value_pct > 0 ? 'pos' : 'neg'}">${signed(l.value_pct)}%</b> <span class="tag ${VALUE_CLS[l.value_level]}">${l.value_level}</span>`);
const probs = l => `${pct(l.p_blend)} <span class="muted">· ${l.p_pinnacle != null ? pct(l.p_pinnacle) : '—'}</span>`;
// contagem simples dos últimos jogos (o acerto pelo papel de hoje fica no valor e no gráfico)
const hits = l => [l.history?.home, l.history?.away].map(x => (x && (x.raw?.n ?? x.n) ? (x.hits || `${nb(x.wins)}/${x.n}`) : '—')).join(' · ');
const thr = l => parseFloat(l.id.match(/-?[\d.]+$/)?.[0]) || 0;
// linha apagada: sem valor, ou com valor mas fora do que se aposta (odd, preço, under); valor sem confirmação fica à vista
const weak = l => !isValueBet(l) && l.value_level !== 'sem confirmação';
// Filtros: as linhas principais de cada jogo e cada mercado (handicap de escanteios do jogo só no filtro dele).
const FILTERS = [['Melhor do jogo', null], ...SCAN_MARKETS.map(m => [SHORT[m], m])];

export function initScan({ api, openEntry, analyzeFixture, banca }) {
  let scan = null, market = null, ranked = [];
  $('#scanDate').innerHTML = [['Hoje', 0], ['Amanhã', 1]].map(([t, o]) => `<option value="${dayStr(o)}">${t} (${dayStr(o).split('-').reverse().slice(0, 2).join('/')})</option>`).join('');
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
    $('#scanRun').disabled = true;
    try {
      scan = await scanDay(api.dossierApi, { date: $('#scanDate').value, budget, banca, onProgress: t => msg(t) });
      await save(`af:scan:${scan.date}`, scan);
      msg('');
      render();
    } catch (e) { msg(e.message, true); }
    $('#scanRun').disabled = false;
  };

  function render() {
    const out = $('#scanOut');
    $('#scanSpec').hidden = !scan?.games.length;
    if (!scan) { out.innerHTML = ''; return; }
    ranked = scan.v >= 2 ? rankGames(scan.games, { market }).slice(0, scan.top || 20) : [];
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const chips = FILTERS.map(([t, m]) => `<button class="${market === m ? 'on' : ''}" data-m="${esc(m ?? '')}">${esc(t)}</button>`).join('');
    // varredura guardada pela versão anterior (só jogos com o 1º tempo na Pinnacle) não tem with_1h
    const pool = scan.with_1h == null ? `${scan.with_odds} com escanteios do 1º tempo na Pinnacle`
      : `${scan.with_odds} com odds da Pinnacle (${scan.with_1h} com escanteios do 1º tempo)`;
    const rows = ranked.map(({ g, line }, i) => {
      const gap = priceGap(line);
      return `<tr data-go="${i}" class="${weak(line) ? 'weak' : ''}"><td>${i + 1}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
        <td class="muted">${esc(g.fx.league.name)}</td><td>${esc(SHORT[line.market] || line.market)}: <b>${esc(line.line)}</b></td>
        <td>${valueTag(line)}${gap ? ` <span class="tag price" title="sem aposta: a odd mínima fica ${gapTxt(line)}; casa soft raramente paga mais de 5% acima">+${gap1(line)}% Pin</span>` : ''}</td>
        <td>${probs(line)}</td><td class="muted">${hits(line)}</td><td>${n2(line.fair_odd_blend)}</td><td><b>${n2(line.odd_min)}</b></td>
        <td class="muted">${line.pinnacle_odd ? n2(line.pinnacle_odd) : '—'}</td></tr>`;
    }).join('');
    const cards = ranked.map(({ g, line }, i) => card(g, line, i)).join('');
    const skipped = scan.skipped.length ? `<details class="skipped"><summary>${scan.skipped.length} jogos com odds que ficaram de fora</summary><ul>
      ${scan.skipped.map(s => `<li>${hour(s.fx.t)} ${esc(s.fx.home.name)} x ${esc(s.fx.away.name)} <span class="muted">(${esc(s.fx.league.name)}): ${esc(s.why)}</span></li>`).join('')}</ul></details>` : '';
    const nBets = ranked.filter(x => isValueBet(x.line)).length, nWeak = ranked.filter(x => x.line.value_level === 'sem confirmação').length;
    const old = scan.v >= 2 ? '' : '<p class="msg">Varredura feita antes do valor nas linhas principais: toque em Varrer jogos de novo.</p>';
    out.innerHTML = `<p class="muted">Varredura de ${when}: ${scan.fixtures} jogos por começar, ${pool},
      ${scan.analyzed} analisados · ${scan.requests} requisições (limite ${scan.budget}).</p>${old}
      <div class="chips" id="scanChips">${chips}</div>
      ${ranked.length ? `<p class="muted"><b>${nBets} ${nBets === 1 ? 'aposta de valor' : 'apostas de valor'}</b> e ${nWeak} com valor sem confirmação neste filtro.
        Valor = a nossa probabilidade (Pinnacle sem margem + modelo) contra a da Pinnacle sem margem; confirmado = o pior cenário do modelo e o
        histórico dos dois times (pelo papel de hoje) também acima do mercado. Apagados: sem valor. Em qualquer linha, a casa precisa pagar a mínima.</p>` : ''}
      ${ranked.length ? `<div class="scroll"><table class="scanrank"><tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Linha</th><th>Valor</th>
        <th>Nossa · Pinnacle</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th></tr>${rows}</table></div>`
        : scan.v >= 2 ? '<p class="muted">Nenhum jogo com linha principal jogável (odd mínima 1,50–3,00) neste filtro.</p>' : ''}
      ${skipped}${cards}`;
    bindTooltips(out);
  }

  function card(g, line, i) {
    const p = g.pinnacle_1h, e = g.expected_1h;
    const facts = [
      isValueBet(line) ? `<b>aposta de valor</b>: ${signed(line.value_pct)}% contra a Pinnacle sem margem, com o modelo e o histórico a favor`
        : line.value_level === 'sem valor' ? '<b>sem valor</b>: a Pinnacle já precifica o que o modelo e o histórico mostram'
          : line.value_level === 'sem confirmação' ? `<b>valor sem confirmação</b> (${signed(line.value_pct)}%): o pior cenário do modelo ou o histórico não acompanham`
            : priceGap(line) ? `<b>sem aposta pelo preço</b>: odd mínima ${n2(line.odd_min)} contra ${n2(line.pinnacle_odd)} da Pinnacle (${gapTxt(line)})`
              : '<b>sem aposta</b>: under só com valor de +4%',
      g.favor_text ? `<b>${esc(g.favor_text)}</b>` : '',
      g.no_corners ? `<b>${esc(g.no_corners)}</b>` : p ? '' : 'sem escanteios do 1º tempo na Pinnacle neste jogo',
      p ? `Pinnacle 1T: linha ${nb(p.line)} → total ${n2(p.total)} (modelo ${n2(p.model)})` : '',
      p && e ? `esperado no 1T: ${esc(g.fx.home.name)} ${n2(e.home)} · ${esc(g.fx.away.name)} ${n2(e.away)}` : '',
      p && g.share_1h ? `1º tempo = ${pct(g.share_1h)} dos escanteios do jogo` : '',
      p ? `histórico do 1º tempo: ${g.c1_known[0]} e ${g.c1_known[1]} dos últimos 10 jogos` : '',
      esc(g.no_history || ''), ...g.alerts.map(esc),
    ].filter(Boolean);
    // todas as linhas principais do jogo (under só quando é aposta) e o melhor handicap de escanteios
    const hcp = bestLine(g.lines, { market: HANDICAP });
    const all = g.lines.filter(l => isMain(l.id) && (!isUnder(l.id) || isValueBet(l)))
      .sort((a, b) => MAIN_MARKETS.indexOf(a.market) - MAIN_MARKETS.indexOf(b.market) || thr(a) - thr(b)).concat(hcp ? [hcp] : []);
    const table = all.length ? `<div class="scroll"><table class="mainlines"><tr><th>Linha</th><th>Valor</th><th>Nossa · Pinnacle</th>
      <th>Últ. 10</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th></tr>${all.map(l => `<tr class="${l.id === line.id ? 'on' : ''}${weak(l) ? ' weak' : ''}">
        <td>${esc(SHORT[l.market])}: <b>${esc(l.line)}</b></td><td>${valueTag(l)}</td><td>${probs(l)}</td><td class="muted">${hits(l)}</td>
        <td>${n2(l.fair_odd_blend)}</td><td><b>${n2(l.odd_min)}</b></td><td class="muted">${n2(l.pinnacle_odd)}</td></tr>`).join('')}</table></div>` : '';
    return `<article class="scancard" id="scan-${i}" data-g="${i}">
      <div class="row head"><h3>${i + 1}. ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${hour(g.fx.t)} · ${esc(g.fx.league.name)}</span></h3>
        <button class="ghost" data-full="${i}">Análise completa ↗</button></div>
      <p class="muted facts">${facts.join(' · ')}</p>
      ${table}
      ${renderDashboard([line], g.teams)}
    </article>`;
  }

  $('#scanOut').addEventListener('click', e => {
    const m = e.target.closest('#scanChips button');
    if (m) { market = m.dataset.m || null; render(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { $(`#scan-${go.dataset.go}`).scrollIntoView({ behavior: 'smooth' }); return; }
    const full = e.target.closest('[data-full]');
    if (full) { openFull(ranked[full.dataset.full].g.fx, full); return; }
    const en = e.target.closest('[data-enter]');
    if (en) {
      const { g, line } = ranked[en.closest('[data-g]').dataset.g];
      openEntry(line.id, null, { line, fx: g.fx, btn: en });
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

  bindSpecialist($('#scanSpec'), () => scan && briefScan(scan, ranked));
  showSaved();
}
