// Tela da varredura do dia (escanteios do 1º tempo): ranking, relatório de cada jogo com os gráficos dos
// últimos 10 jogos de cada time na linha, entrada direta e atalho para a análise completa do jogo.

import { SCAN_MARKETS, rankGames, scanDay } from './scanner.js';
import { bindTooltips, renderDashboard } from './dashboard.js';
import { load, save } from './store.js';
import { bindSpecialist, briefScan } from './brief.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => `${Math.round(x * 100)}%`;
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const nb = x => String(x).replace('.', ',');
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const BUDGET_KEY = 'afScanBudget';

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
    ranked = rankGames(scan.games, { market });
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const chips = [['Melhor dos dois', null], ...SCAN_MARKETS.map(m => [m.replace('escanteios ', ''), m])]
      .map(([t, m]) => `<button class="${market === m ? 'on' : ''}" data-m="${esc(m ?? '')}">${esc(t)}</button>`).join('');
    const rows = ranked.map(({ g, line }, i) => {
      const h = line.history || {};
      const hist = [h.home, h.away].map(x => (x && x.n ? `${nb(x.wins)}/${x.n}` : '—')).join(' · ');
      return `<tr data-go="${i}"><td>${i + 1}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
        <td class="muted">${esc(g.fx.league.name)}</td><td>${esc(line.market.replace('escanteios ', ''))}: <b>${esc(line.line)}</b></td>
        <td><span class="tag ${line.tier === 'âncora' ? 'ok' : line.tier === 'sólida' ? 'mid' : 'no'}">${line.tier}</span></td>
        <td>${pct(line.p_blend)}</td><td class="muted">${hist}</td><td>${n2(line.fair_odd_blend)}</td><td><b>${n2(line.odd_min)}</b></td>
        <td class="muted">${line.pinnacle_odd ? n2(line.pinnacle_odd) : '—'}</td></tr>`;
    }).join('');
    const cards = ranked.map(({ g, line }, i) => card(g, line, i)).join('');
    const skipped = scan.skipped.length ? `<details class="skipped"><summary>${scan.skipped.length} jogos com odds que ficaram de fora</summary><ul>
      ${scan.skipped.map(s => `<li>${hour(s.fx.t)} ${esc(s.fx.home.name)} x ${esc(s.fx.away.name)} <span class="muted">(${esc(s.fx.league.name)}): ${esc(s.why)}</span></li>`).join('')}</ul></details>` : '';
    out.innerHTML = `<p class="muted">Varredura de ${when}: ${scan.fixtures} jogos por começar, ${scan.with_odds} com escanteios do 1º tempo na Pinnacle,
      ${scan.analyzed} analisados · ${scan.requests} requisições (limite ${scan.budget}).</p>
      <div class="chips" id="scanChips">${chips}</div>
      ${ranked.length ? `<div class="scroll"><table class="scanrank"><tr><th>#</th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Linha</th><th>Nível</th>
        <th>Acerta</th><th>Últ. 10 (casa · fora)</th><th>Justa</th><th>Mínima</th><th>Pinnacle</th></tr>${rows}</table></div>` : '<p class="muted">Nenhum jogo com linha jogável (odd mínima 1,50–3,00).</p>'}
      ${skipped}${cards}`;
    bindTooltips(out);
  }

  function card(g, line, i) {
    const p = g.pinnacle_1h, e = g.expected_1h;
    const facts = [
      p ? `Pinnacle 1T: linha ${nb(p.line)} → total ${n2(p.total)} (modelo ${n2(p.model)})` : 'sem total 1T da Pinnacle',
      e ? `esperado no 1T: ${esc(g.fx.home.name)} ${n2(e.home)} · ${esc(g.fx.away.name)} ${n2(e.away)}` : '',
      g.share_1h ? `1º tempo = ${pct(g.share_1h)} dos escanteios do jogo` : '',
      `histórico do 1º tempo: ${g.c1_known[0]} e ${g.c1_known[1]} dos últimos 10 jogos`,
      g.no_history || '', ...g.alerts,
    ].filter(Boolean);
    const others = g.lines.filter(l => l.id !== line.id && l.odd_min >= 1.5 && l.odd_min <= 3)
      .sort((a, b) => b.consistency_score - a.consistency_score).slice(0, 4)
      .map(l => `<span class="other">${esc(l.market.replace('escanteios ', ''))}: <b>${esc(l.line)}</b> ${pct(l.p_blend)} · mín ${n2(l.odd_min)}</span>`).join('');
    return `<article class="scancard" id="scan-${i}" data-g="${i}">
      <div class="row head"><h3>${i + 1}. ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${hour(g.fx.t)} · ${esc(g.fx.league.name)}</span></h3>
        <button class="ghost" data-full="${i}">Análise completa ↗</button></div>
      <p class="muted facts">${facts.join(' · ')}</p>
      ${renderDashboard([line], g.teams)}
      ${others ? `<div class="others"><span class="muted">Outras linhas do 1º tempo:</span>${others}</div>` : ''}
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
