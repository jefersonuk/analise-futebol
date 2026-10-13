// Plano do dia (plan.js) na tela: um botão, na noite anterior, analisa o dia seguinte inteiro (a varredura da data,
// guardada como a da seção de varredura) e mostra só o plano — 5 a 10 simples, 2 múltiplas e 5 no mesmo jogo —, cada
// entrada com a odd mínima, a da Pinnacle, a chance e a entrada em R$, e o ➕ para registrar. "Copiar o plano" leva a
// lista para apostar nas casas; o plano entra sozinho na 🧪 simulação para medirmos (o painel dos planos fica no fim
// desta seção; plano fora dela tem o botão de simular); o especialista recebe o plano. Embaixo do resumo, o porquê de
// cada entrada (planwhy.js): texto e gráficos, como na varredura.

import { scanDay } from './scanner.js';
import { load, save } from './store.js';
import { exposedGames } from './entry.js';
import { multiGames, multiLine } from './multiple.js';
import { HALF_MAX, PER_LEAGUE, PLAN_DEFAULT, PLAN_OPTIONS, PLAN_OPTIONS_V1, SAME_GAME, SINGLES, buildPlan, multiOf, planFromKeys, planFunnel, planKeys, planText } from './plan.js';
import { BIG_LEAGUES, isBig } from './leagues.js';
import { buildPlanSim, comboPin, simReport, ticketPin } from './sim.js';
import { simPanel } from './simview.js';
import { bindSpecialist, briefPlan } from './brief.js';
import { bindTooltips, chartLegend, teamCharts } from './dashboard.js';
import { chanceChart, comboBody, halfBody, legsBody, singleBody } from './planwhy.js';
import { STAKE, money } from './stake.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const dm = d => d.split('-').reverse().slice(0, 2).join('/');
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const weekday = d => WEEK[new Date(`${d}T12:00:00`).getDay()];
const BUDGET_KEY = 'afScanBudget', WIN_KEY = 'afPlanWin', MARKETS_KEY = 'afPlanMarkets', BIG_KEY = 'afPlanBig';
// Janelas do plano: horas a partir de agora (padrão: 4 h) ou o dia inteiro (hoje, amanhã) — a critério do operador.
const HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const isHours = w => /^h\d+$/.test(w);
const keyOf = w => (isHours(w) ? `plano-${w}` : dayStr(Number(w.slice(1))));   // onde a varredura e o plano ficam guardados
const SHORT = { 'Handicap asiático': 'Handicap', 'Total de gols': 'Gols', '1X2': '1X2', 'Total de escanteios': 'Escanteios', 'Total escanteios 1T': 'Escanteios 1T',
  'Total de chutes': 'Chutes', 'Total de chutes no gol': 'Chutes no gol', 'Resultado 1º tempo': '1º tempo', 'Total de gols 1T': 'Gols 1T', Combo: 'Mesmo jogo' };

// O funil do plano (plan.js planFunnel) numa linha: dos jogos da janela aos analisados, e onde caiu cada analisado.
function funnelLine(f, inWindow = false) {
  const nz = xs => xs.filter(([k]) => k > 0).map(([k, t]) => `${k} ${t}`);
  const before = nz([[f.outside, 'de ligas menores, não analisados ("só as grandes")'], ...Object.entries(f.skipped).map(([t, k]) => [k, `fora da análise (${t})`])]);
  const lost = nz([[f.unkept, 'sem nada entre os melhores de cada mercado'], [f.started, 'já tinham começado'], [f.small, 'de ligas menores'],
    [f.exposed, 'já têm entrada'], [f.lineup, 'dependem da escalação ("entrar se…")'], [f.hard, 'jogo difícil (só múltipla)'],
    [f.cap, `no teto de ${PER_LEAGUE} por liga`], [f.full, `com o plano cheio (${SINGLES[1]} simples, ${SAME_GAME} no mesmo jogo)`],
    [f.none, 'nenhuma linha passou nas métricas']]);
  return `<p class="muted funnel"><b>Funil</b> (cada jogo conta uma vez): ${f.fixtures != null ? `${f.fixtures} ${inWindow ? 'na janela' : 'do dia'} → ` : ''}${f.quoted != null ? `${f.quoted} com odd da Pinnacle → ` : ''}<b>${f.analyzed} analisados</b>${before.length ? ` (antes disso ficaram fora ${before.join(', ')})` : ''}
    → no plano: <b>${f.singles} simples · ${f.half || 0} favorito no 1º tempo · ${f.same} no mesmo jogo · ${f.multi} em múltipla</b>${lost.length ? ` · sem entrada: ${lost.join(' · ')}` : ''}.</p>`;
}

export function initPlan({ api, openEntry, analyzeFixture = null, banca }) {
  let scan = null, plan = null, busy = false;
  const sel = $('#planDate');
  sel.innerHTML = `<optgroup label="A partir de agora">${HOURS.map(h => `<option value="h${h}">Próxima${h > 1 ? 's' : ''} ${h} hora${h > 1 ? 's' : ''}</option>`).join('')}</optgroup>
    <optgroup label="O dia inteiro">${[['d0', 'Hoje'], ['d1', 'Amanhã']].map(([v, t]) => `<option value="${v}">${t} (${weekday(dayStr(+v[1]))}, ${dm(dayStr(+v[1]))})</option>`).join('')}</optgroup>`;
  sel.value = (() => { try { return localStorage.getItem(WIN_KEY) || 'h4'; } catch { return 'h4'; } })();
  if (!sel.value) sel.value = 'h4';
  // o nome do plano: "08/10, 13:12–17:12 (próximas 4 h)" ou "sexta, 09/10 (dia todo)"
  const labelOf = sc => (sc?.window ? `${dm(sc.date)}, ${hour(sc.window.from)}–${hour(sc.window.to)} (próximas ${sc.hours} h)` : sc?.date ? `${weekday(sc.date)}, ${dm(sc.date)} (dia todo)` : '');
  const msg = (text, err = false) => { const el = $('#planMsg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', err); };

  // Mercados e ligas do plano (pedido do Jeferson, 10/10/2026), como as linhas da varredura: guardados neste aparelho;
  // padrão: o recorte dele (handicap de gols, escanteios, chutes, mesmo jogo, múltiplas) e só ligas grandes. Mudar a
  // marcação refaz o plano com a análise guardada, sem gastar requisição; só incluir as ligas menores pede analisar de novo.
  // guardado { v: 2, sel }: o que está marcado; guardado antes como lista (v1), as opções que não existiam então (o favorito no
  // 1º tempo) vêm pelo padrão
  const chosen = () => {
    try {
      const v = JSON.parse(localStorage.getItem(MARKETS_KEY));
      const sel = Array.isArray(v) ? [...v, ...PLAN_DEFAULT.filter(k => !PLAN_OPTIONS_V1.includes(k))] : Array.isArray(v?.sel) ? v.sel : null;
      if (sel) return PLAN_OPTIONS.map(([k]) => k).filter(k => sel.includes(k));
    } catch { /* padrão */ }
    return [...PLAN_DEFAULT];
  };
  const bigOn = () => { try { return localStorage.getItem(BIG_KEY) !== '0'; } catch { return true; } };
  const bigList = [...BIG_LEAGUES.values()].join(', ');
  function renderMarkets() {
    const sel = chosen(), isDefault = sel.length === PLAN_DEFAULT.length && sel.every(k => PLAN_DEFAULT.includes(k)) && bigOn();
    $('#planMarkets').innerHTML = `<span class="muted">Mercados:</span>${PLAN_OPTIONS.map(([k, t]) => `<label class="mk"><input type="checkbox" data-pm value="${esc(k)}"${sel.includes(k) ? ' checked' : ''}>${esc(t)}</label>`).join('')}
      <span class="muted">· Ligas:</span><label class="mk" title="${esc(bigList)}"><input type="checkbox" data-pbig${bigOn() ? ' checked' : ''}>só as grandes</label>
      ${isDefault ? '' : '<button class="ghost mini" data-pmdef>padrão</button>'}`;
  }
  // mudou a marcação: refaz o plano da análise guardada (as ligas menores, se ela foi feita só com as grandes, pedem outra)
  async function remake() {
    renderMarkets();
    if (!scan?.games) return;
    if (!bigOn() && scan.outside != null) msg('A análise guardada tem só as ligas grandes: toque em Montar o plano para incluir as outras.');
    else msg('');
    if (!chosen().length) { msg('Marque pelo menos um mercado.', true); return; }
    await makePlan();
    render();
  }
  $('#planMarkets').addEventListener('change', e => {
    if (e.target.matches('[data-pm]')) localStorage.setItem(MARKETS_KEY, JSON.stringify({ v: 2, sel: [...$('#planMarkets').querySelectorAll('[data-pm]:checked')].map(x => x.value) }));
    else if (e.target.matches('[data-pbig]')) localStorage.setItem(BIG_KEY, e.target.checked ? '1' : '0');
    else return;
    remake();
  });
  $('#planMarkets').addEventListener('click', e => { if (e.target.closest('[data-pmdef]')) { localStorage.removeItem(MARKETS_KEY); localStorage.removeItem(BIG_KEY); remake(); } });

  // o plano da data: o guardado (as mesmas entradas, mesmo depois de registrar algumas) ou um novo da varredura
  async function show() {
    const w = sel.value, key = keyOf(w);
    try { localStorage.setItem(WIN_KEY, w); } catch { /* sem armazenamento */ }
    scan = await load(`af:scan:${key}`);
    plan = null;
    if (scan?.games && isHours(w) === !!scan.window) {
      const keys = await load(`af:plan:${key}`);
      const same = keys && (keys.markets || PLAN_OPTIONS.map(([k]) => k)).join() === chosen().join() && !!keys.big === bigOn();
      if (keys?.scan_at === scan.generated_at && same) plan = planFromKeys(scan, keys, { banca });
      if (!plan) await makePlan();
    }
    render();
  }
  async function makePlan() {
    plan = buildPlan(scan, { exposed: exposedGames(), banca, markets: chosen(), big: bigOn() });
    await save(`af:plan:${keyOf(sel.value)}`, planKeys(plan));
    await simPlan();
  }
  // o plano entra na simulação (separada das apostas reais), um por montagem; montou de novo a mesma janela antes de
  // qualquer jogo começar: substitui o anterior
  const simIdOf = () => `plano-${Date.parse(scan.generated_at)}`;
  async function simPlan({ replace = true } = {}) {
    const sim = buildPlanSim(plan, { banca, id: simIdOf(), win: sel.value, label: labelOf(scan) });
    if (!sim.bets.length) return false;
    await simUI.add(sim, replace ? old => old.win === sim.win && old.bets.every(b => b.status === 'aberta' && b.kickoff > Date.now()) : null);
    return true;
  }
  // simulação deste plano feita antes da regra do pior cenário (combo ou perna asiática na odd mínima do app): refaz na
  // odd da Pinnacle da hora do plano; os resultados voltam pela conferência
  let refazendo = false;
  async function repriceSim() {
    refazendo = true;
    try { await simPlan({ replace: false }); } catch { /* fica a antiga; tenta de novo na próxima vez */ }
    refazendo = false;
  }
  // as simulações dos planos (simview.js): todos os planos montados, o mais novo primeiro
  const simUI = simPanel({ api, el: $('#planSimOut'), mine: id => String(id).startsWith('plano-'), title: '🧪 Simulação dos planos',
    cat: c => c.replace(/^Plano: /, ''), onChange: () => render(),
    intro: `Cada plano montado entra aqui sozinho, como se tivéssemos feito todas as entradas dele, sempre no pior cenário: na odd da Pinnacle
      da hora do plano ("Pin"), não na odd mínima — a casa pagando mais é bônus. Combo e perna asiática, que ela não cota, na odd que ela pagaria:
      a justa pelas chances dela, com a margem dela em cada perna ("Pin est."); a múltipla no produto das pernas. Montar de novo a mesma
      janela antes de qualquer jogo começar substitui o plano anterior. O resultado sai por frente (🎯 nossa leitura, 🤝 acordo com a Pinnacle),
      múltipla e mesmo jogo, em unidades (stake 1 em tudo) e em R$ (a entrada proposta); CLV = a odd de entrada contra a justa de fechamento
      da Pinnacle. Os resultados entram com 🔄 Conferir resultados depois dos jogos (e sozinhos com a página aberta). Nada daqui entra no app de apostas.` });
  $('#planOut').addEventListener('click', async e => {
    if (e.target.closest('#planSimRun') && plan) {
      const ok = await simPlan();
      simUI.say(ok ? 'Plano registrado na simulação: os resultados entram depois dos jogos.' : 'Este plano não tem entrada para simular.');
      $('#planSimOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const go = e.target.closest('[data-simgo]');
    if (go) document.getElementById(`sim-${go.dataset.simgo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#planRun').onclick = async () => {
    if (busy) return;
    if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
    const w = sel.value, budget = Math.max(50, Number(localStorage.getItem(BUDGET_KEY)) || 1500);
    busy = true; $('#planRun').disabled = true;
    try {
      // a janela do operador (horas a partir de agora, exatas, ou o dia inteiro), guardando mais jogos por filtro; só as ligas
      // grandes quando marcado (as outras nem carregam); o histórico dos escanteios do 1º tempo só com escanteios 1T marcado
      const win = isHours(w) ? { hours: Number(w.slice(1)), expand: false } : { date: keyOf(w) };
      if (!chosen().length) { msg('Marque pelo menos um mercado.', true); busy = false; $('#planRun').disabled = false; return; }
      scan = await scanDay(api.dossierApi, { ...win, budget, banca, top: 30, half: chosen().includes('Total escanteios 1T'),
        only: bigOn() ? f => isBig(f.league) : null, onProgress: t => msg(t) });
      await save(`af:scan:${keyOf(w)}`, scan);
      await makePlan();
      msg(scan.games.length ? '' : `Nenhum jogo${bigOn() ? ' de liga grande' : ''} com odds da Pinnacle ${isHours(w) ? `nas próximas ${win.hours} h: escolha uma janela maior${bigOn() ? ' ou desmarque "só as grandes"' : ''}.` : 'nesta data (ainda).'}`);
      render();
    } catch (e) { msg(e.message, true); }
    busy = false; $('#planRun').disabled = false;
  };
  sel.onchange = show;

  $('#planCopy').onclick = async () => {
    if (!plan) return;
    const text = planText(plan, { dateLabel: labelOf(scan) });
    try { await navigator.clipboard.writeText(text); msg('Plano copiado: cole no bloco de notas ou no WhatsApp e aposte nas casas.'); }
    catch { $('#planOut').insertAdjacentHTML('afterbegin', `<textarea class="plantext" readonly>${esc(text)}</textarea>`); msg('Não consegui copiar sozinho: copie o texto abaixo.'); }
  };
  bindSpecialist($('#planSpec'), () => scan && plan && briefPlan(scan, plan));

  // ➕: abre o formulário de entrada da linha (simples, combo) ou do bilhete (múltipla)
  $('#planOut').addEventListener('click', e => {
    const b = e.target.closest('[data-pe]');
    if (!b || !plan) return;
    const [kind, i] = b.dataset.pe.split(':'), n = Number(i);
    if (kind === 's') { const { g, line } = plan.singles[n]; openEntry(line.id, null, { line, fx: g.fx, btn: b }); }
    if (kind === 'c') { const { g, combo } = plan.sameGame[n]; openEntry(combo.id, null, { line: combo, fx: g.fx, btn: b }); }
    if (kind === 'h') { const { g, line } = plan.halves[n]; openEntry(line.id, null, { line, fx: g.fx, btn: b }); }
    if (kind === 'm') {
      const t = plan.multis[n], line = multiLine(t);
      openEntry(line.id, t.min, { line, fx: { id: line.id, t: t.first_kickoff, home: { name: 'Múltipla' }, away: { name: `${t.n} jogos` }, league: { name: 'várias ligas' } }, btn: b });
    }
  });
  // registrou: a entrada aparece marcada
  $('#entryDlg')?.addEventListener('close', () => { if (plan) render(); });

  // as linhas possíveis de cada jogo para as pernas (as da aba Múltipla, com as asiáticas) e os jogos já no plano
  const optionsByGame = () => new Map(multiGames(scan.games, { now: 0 }).map(m => [m.fixtureId, m.options]));
  const usedGames = () => new Set([...plan.singles.map(x => x.g.fx.id), ...plan.sameGame.map(x => x.g.fx.id), ...(plan.halves || []).map(x => x.g.fx.id), ...plan.multis.flatMap(t => t.legs.map(l => l.fixtureId))]);
  // editou uma múltipla: refaz a conta, guarda o plano e a simulação dele
  async function editMulti(i, legs) {
    plan.multis[i] = multiOf(legs, banca);
    await save(`af:plan:${keyOf(sel.value)}`, planKeys(plan));
    await simPlan();
    render();
  }
  $('#planOut').addEventListener('change', async e => {
    const cg = e.target.closest('[data-pcg]');
    if (cg) {
      const i = Number(cg.dataset.pcg), { g } = plan.sameGame[i], c = (g.fav_combos || []).find(x => x.id === cg.value);
      if (c) { plan.sameGame[i] = { g, combo: c }; await save(`af:plan:${keyOf(sel.value)}`, planKeys(plan)); await simPlan({ replace: false }); render(); }
      return;
    }
    const ml = e.target.closest('[data-pml]'), ma = e.target.closest('[data-pma]');
    if (ml) {
      const [i, j] = ml.dataset.pml.split(':').map(Number), legs = [...plan.multis[i].legs], o = optionsByGame().get(legs[j].fixtureId)?.find(x => x.lineId === ml.value);
      if (o) { legs[j] = o; editMulti(i, legs); }
    }
    if (ma && ma.value) {
      const i = Number(ma.dataset.pma), o = optionsByGame().get(Number(ma.value))?.[0];
      if (o) editMulti(i, [...plan.multis[i].legs, o].sort((a, b) => a.kickoff - b.kickoff));
    }
  });
  // toque numa entrada do resumo: vai ao porquê dela; ↑ volta ao resumo
  $('#planOut').addEventListener('click', e => {
    if (e.target.closest('[data-top]')) { $('#planOut').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('button:not([data-go]), select, input')) document.getElementById(go.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#planOut').addEventListener('click', e => {
    const x = e.target.closest('[data-pmx]');
    if (!x) return;
    const [i, j] = x.dataset.pmx.split(':').map(Number);
    if (plan.multis[i].legs.length > 2) editMulti(i, plan.multis[i].legs.filter((_, k) => k !== j));
  });

  function render() {
    const out = $('#planOut');
    $('#planCopy').hidden = $('#planSpec').hidden = !plan;
    if (!scan?.games) {
      out.innerHTML = `<div class="empty-state"><p><b>Ainda sem a análise desta janela.</b></p><p class="muted">Escolha a janela — horas a partir de agora ou o dia
        inteiro — e toque em <b>Montar o plano</b>: o app analisa os jogos com odds da Pinnacle nela (o dia inteiro leva alguns minutos e usa o limite de
        requisições da varredura) e devolve só o plano.</p></div>`;
      return;
    }
    if (!scan.games.length) { out.innerHTML = `<div class="empty-state"><b>${esc(labelOf(scan))}</b>: nenhum jogo com odds da Pinnacle nesta janela${scan.window ? ' — escolha uma janela maior' : ''}.</div>`; return; }
    if (!plan) { out.innerHTML = '<div class="empty-state">Sem plano para esta varredura.</div>'; return; }
    const halves = plan.halves || [];
    const exp = exposedGames(), has = (id, h, a) => exp.has(id, h, a);
    const reg = (key, ok, t) => (ok ? '<span class="tag ok">✓ registrada</span>' : t <= Date.now() ? '<span class="tag mid">começou</span>'
      : `<button class="enter mini" data-pe="${key}" title="Registrar">➕</button>`);
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    // o que o plano rende se tudo der green: na odd da Pinnacle (o pior cenário; a casa pagando mais é bônus), com a entrada padrão
    const odds = [...plan.singles.map(x => x.line.pinnacle_odd), ...halves.map(x => x.line.pinnacle_odd), ...plan.multis.map(t => ticketPin(t.legs)[0]),
      ...plan.sameGame.map(x => comboPin(x.combo, x.g)[0])];
    const nEntries = odds.length, pot = odds.reduce((s, o) => s + (o > 1 ? STAKE.value * (o - 1) : 0), 0);
    const n = plan.singles.length, budgetOut = (scan.skipped || []).filter(s => /orçamento/.test(s.why || '')).length;
    const counts = [['agree', '🤝'], ['shots', '📊'], ['ours', '🎯']].map(([k, ic]) => [ic, plan.singles.filter(x => (x.lens || 'ours') === k).length]).filter(([, c]) => c);
    const badge = (t, c, on = true) => `<span class="badge${on && c ? '' : ' zero'}">${t} <b>${c}</b></span>`;
    const inSim = simUI.get(simIdOf()), sum = inSim && simReport(inSim).total, sg = x => `${x > 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}`;
    if (inSim?.bets.some(b => b.odd_src === 'mínima') && !refazendo) repriceSim();
    const simLine = inSim ? `<div class="simbar">🧪 Na simulação: ${sum.n} entradas${sum.done
      ? ` · ${sum.done} encerrada${sum.done > 1 ? 's' : ''}${sum.open ? `, ${sum.open} em aberto` : ''} · <b class="${sum.profit_u > 0 ? 'pos' : sum.profit_u < 0 ? 'neg' : ''}">${sg(sum.profit_u)} u</b> · ${money(sum.profit_brl, inSim.cur || 'BRL', inSim.cur && inSim.cur !== 'BRL' ? 2 : 0)}`
      : ' · nenhuma encerrada ainda'} <button class="ghost mini" data-simgo="${esc(inSim.id)}">ver o resultado ↓</button></div>`
      : `<div class="simbar"><button class="ghost" id="planSimRun">🧪 Simular as propostas deste plano</button> <span class="muted">registra todas as entradas, na odd da Pinnacle da hora, à parte das apostas reais</span></div>`;
    const empty = !n && !plan.multis.length && !plan.sameGame.length && !halves.length;
    const head = `<div class="pblock summary">
      <div class="sumtop"><div><h3>${esc(labelOf(scan))}</h3><div class="muted small">análise de ${when} · ${scan.analyzed} jogos analisados de ${scan.fixtures} ${scan.window ? 'na janela' : 'do dia'} · ${scan.requests} requisições</div></div>
        <div class="sumstake"><b>${nEntries}</b> entrada${nEntries === 1 ? '' : 's'} × ${money(STAKE.value)} = <b>${money(nEntries * STAKE.value)}</b>
          ${nEntries ? `<div class="pos small">+${money(pot, STAKE.cur, 2)} se tudo der green <span class="muted">(na odd da Pinnacle)</span></div>` : ''}</div></div>
      <div class="badges">${badge('Simples', n)}${counts.map(([ic, c]) => `<span class="badge sub">${ic} ${c}</span>`).join('')}${badge('⏱️ Favorito 1º tempo', halves.length)}${badge('🔗 Mesmo jogo', plan.sameGame.length)}${badge('🎰 Múltiplas', plan.multis.length)}</div>
      ${empty ? '' : simLine}
      <details class="funnelbox"><summary>Funil: onde caiu cada jogo analisado</summary>${funnelLine(planFunnel(scan, plan, { exposed: exp }), !!scan.window)}</details>
      ${budgetOut ? `<p class="neg small">${budgetOut} jogos com odds ficaram fora da análise pelo limite de requisições (${scan.budget}): aumente o limite na Varredura e monte de novo.</p>` : ''}
      ${n && n < SINGLES[0] ? `<p class="muted small">${scan.window ? 'A janela' : 'O dia'} rendeu ${n} simples — menos que 5: melhor poucas do que forçar entrada sem valor.</p>` : ''}
      ${empty ? '<p class="muted">Nenhuma entrada passou nas regras do plano nesta janela.</p>' : ''}</div>`;
    // simples: as três frentes; na 🎯 o valor é o nosso (conservador) na odd da Pinnacle; no 🤝 o valor está na casa pagar o alvo
    const lensTag = x => (x.lens === 'shots'
      ? '<span class="tag" title="a Pinnacle não cota chutes: o preço é só do modelo (sólida ou âncora, com os dois times batendo a linha em 60%+ dos últimos jogos), em liga grande">📊 chutes</span>'
      : x.lens === 'agree'
      ? '<span class="tag ok" title="o modelo e a Pinnacle concordam; linha consistente (histórico e contexto); o valor está na casa pagar o alvo (a justa + 2%)">🤝 acordo</span>'
      : `<span class="tag mid" title="a nossa chance (modelo corrigido + cenário) acima da Pinnacle: valor contra ela">🎯 nossa leitura${x.line.contra ? ' · contra a Pinnacle' : ''}</span>`);
    const valueCell = x => (x.lens === 'shots' ? '<span class="muted" title="sem a Pinnacle: a casa precisa pagar a mínima do modelo">casa ≥ mínima</span>'
      : x.lens === 'agree'
      ? `<span class="muted" title="a casa precisa pagar o alvo (a justa + 2%): ${x.value > 0 ? `${(x.value * 100).toFixed(1).replace('.', ',')}% acima` : 'até'} da odd da Pinnacle">+${Math.max(0, x.value * 100).toFixed(1).replace('.', ',')}% Pin</span>`
      : `<span class="pos">+${(x.value * 100).toFixed(1).replace('.', ',')}%</span>`);
    const block = (id, icon, title, count, desc, body) => (count ? `<section class="pblock" id="${id}"><header class="pblock-h"><h3>${icon} ${title} <span class="count">${count}</span></h3>
      <p class="muted small">${desc}</p></header>${body}</section>` : '');
    const gameCell = g => `<td><div class="game">${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</div><div class="muted small">${hour(g.fx.t)} · ${esc(g.fx.league.name)}</div></td>`;
    const singles = block('pbSingles', '🎯', 'Simples', n, 'Em rodízio, as frentes de mais acerto primeiro: 🤝 acordo com a Pinnacle, 📊 chutes e 🎯 nossa leitura. Toque na linha para ver o porquê.',
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Frente</th><th>Entrada</th><th>Odd mínima</th><th>Pinnacle</th><th>Chance</th><th>Valor</th></tr>
      ${plan.singles.map((x, i) => { const { g, line } = x; return `<tr data-go="pw-s${i}"><td>${reg(`s:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t)}</td>${gameCell(g)}
      <td>${lensTag(x)}</td><td title="${esc(line.why || (line.context ? `contexto ${line.context.verdict}; nível ${line.tier}` : ''))}"><span class="muted">${esc(SHORT[line.market] || line.market)}:</span> <b>${esc(line.line)}</b></td>
      <td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td><td><b>${pct(line.p_nossa ?? line.p_blend)}</b> <span class="muted">· ${pct(line.p_pinnacle)}</span></td>
      <td>${valueCell(x)}</td></tr>`; }).join('')}</table></div>`);
    const halfSec = block('pbHalves', '⏱️', 'Favorito vence o 1º tempo', halves.length, 'Jogos de favoritismo alto (60%+ de vencer o jogo pela Pinnacle): a vitória no 1º tempo paga perto de 2. Cotada pela Pinnacle de 1,70 a 2,70; alvo = a justa + 2%.',
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Entrada</th><th>Favorito no jogo</th><th>Odd mínima</th><th>Pinnacle</th><th>Chance</th></tr>
      ${halves.map(({ g, line }, i) => `<tr data-go="pw-h${i}"><td>${reg(`h:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t)}</td>${gameCell(g)}
      <td><b>${esc(line.line)}</b></td><td>${pct(line.p_fav_ft)}</td><td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td>
      <td><b>${pct(line.p_blend)}</b> <span class="muted">· ${pct(line.p_pinnacle)}</span></td></tr>`).join('')}</table></div>`);
    // mesmo jogo: a vitória do favorito + a linha de gols (1,5 ou 2,5), que dá para trocar
    const comboCell = (g, combo, i) => ((g.fav_combos || []).length > 1 && combo.fav
      ? `<b>${esc(combo.legs[0].line)}</b> + <select data-pcg="${i}" title="a linha de gols do combo">${g.fav_combos.map(c => `<option value="${esc(c.id)}"${c.id === combo.id ? ' selected' : ''}>${esc(c.legs[1].line)} · ${pct(c.p_blend)} · ≥ ${n2(c.odd_min)}</option>`).join('')}</select>`
      : `<b>${esc(combo.line)}</b>`);
    const same = block('pbSame', '🔗', 'No mesmo jogo', plan.sameGame.length, 'A vitória do favorito + mais de 1,5 gols — ou de 2,5, quando a de 1,5 paga menos de 1,60 —, chance de 50%+. Dá para trocar a linha de gols.',
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Combo</th><th>Chance</th><th>Odd mínima</th></tr>
      ${plan.sameGame.map(({ g, combo }, i) => `<tr data-go="pw-c${i}"><td>${reg(`c:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t)}</td>${gameCell(g)}
      <td>${comboCell(g, combo, i)}</td><td><b>${pct(combo.p_blend)}</b> <span class="muted">· ${pct(combo.p_pinnacle)}</span></td><td><b>${n2(combo.odd_min)}</b></td></tr>`).join('')}</table></div>`);
    // múltiplas editáveis: trocar a linha da perna (1,5 · 1,75 · 2 · 2,25 · 2,5), tirar perna, pôr perna de outro jogo
    const opts = optionsByGame(), inPlan = usedGames();
    const legInfo = l => (l.asian ? `não perde ${pct(l.p)} (0–1 gol perde) · cheia ${pct(l.p_win)} (3+ gols)` : `acerta ${pct(l.p)}`);
    const legRow = (t, i, l, j) => `<tr><td>${hour(l.kickoff)}</td><td>${esc(l.home)} x ${esc(l.away)}</td>
      <td><select data-pml="${i}:${j}" title="2 gols: o 1,75 ganha metade, o 2 devolve, o 2,25 perde metade">${(opts.get(l.fixtureId) || [l]).map(o => `<option value="${esc(o.lineId)}"${o.lineId === l.lineId ? ' selected' : ''}>${esc(o.line)}${o.asian ? ' (asiática)' : o.quoted ? '' : ' (não cotada)'}</option>`).join('')}</select></td>
      <td class="muted">${legInfo(l)}</td><td>justa ${n2(l.fair)}</td><td><b>≥ ${n2(l.min)}</b></td>
      <td>${t.n > 2 ? `<button class="ghost mini" data-pmx="${i}:${j}" title="Tirar a perna">✕</button>` : ''}</td></tr>`;
    const addSel = i => { const free = [...opts.entries()].filter(([f]) => !inPlan.has(f)).map(([, os]) => os[0]).sort((a, b) => a.kickoff - b.kickoff);
      return free.length ? `<select data-pma="${i}"><option value="">➕ pôr uma perna…</option>${free.map(o => `<option value="${o.fixtureId}">${hour(o.kickoff)} ${esc(o.home)} x ${esc(o.away)} — ${esc(o.line)} · ${pct(o.p)}</option>`).join('')}</select>` : ''; };
    const multis = block('pbMultis', '🎰', 'Múltiplas', plan.multis.length, 'São bingo: até 2, de odd justa 6 ou mais, com pernas de over de gols cotadas pela Pinnacle. Dá para trocar a linha da perna, tirar e pôr perna.',
      plan.multis.map((t, i) => `<div class="multisum">
      <div>${reg(`m:${i}`, t.legs.every(l => has(l.fixtureId, l.home, l.away)), t.first_kickoff)} <b>Múltipla ${i + 1}</b> · ${t.n} pernas · ${t.asian ? 'não perde' : 'acerta todas'} em <b>${pct(t.p_all)}</b>
        ${t.asian ? `<span class="muted">(todas cheias ${pct(t.p_win_all)})</span> ` : ''}<span class="muted">(Pinnacle ${pct(t.p_pinnacle_all)})</span> · odd total mínima <b>${n2(t.min)}</b>
        <span class="muted">(justa ${n2(t.fair)}${t.odd ? `; na Pinnacle ${n2(t.odd)}` : ''})</span>
        <button class="ghost mini" data-go="pw-m${i}">por que cada perna ↓</button></div>
      <div class="scroll"><table class="mlegs">${t.legs.map((l, j) => legRow(t, i, l, j)).join('')}</table></div>
      <div>${addSel(i)}</div></div>`).join(''));
    // o porquê de cada entrada (planwhy.js) e, em cada jogo, as outras linhas para analisar e a análise completa
    const tools = g => `<details class="othlines" data-others="${g.fx.id}"><summary>🔎 Outras linhas deste jogo</summary><div class="othbody"></div></details>
      <button class="ghost mini" data-full="${g.fx.id}" title="Abre a análise completa do jogo (todas as linhas, a sua linha, o contexto) na aba Jogo">🔬 Análise completa do jogo</button>`;
    const card = (id, title, g, what, body, btn) => `<article class="whycard" id="${id}">
      <div class="whyhead"><h4>${title}${g ? ` · ${hour(g.fx.t)} · ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${esc(g.fx.league.name)}</span>` : ''}</h4>
        <span>${btn} <button class="ghost mini" data-top title="Voltar ao resumo do plano">↑ plano</button></span></div>
      <p class="facts">${what}</p>${body}${g ? `<div class="whytools">${tools(g)}</div>` : ''}</article>`;
    const why = empty ? '' : `<section class="pblock" id="pbWhy"><header class="pblock-h"><h3>🧾 Por que cada entrada</h3>
      <p class="muted small">O resumo, os motivos (<b class="pos">＋</b> a favor, <b class="neg">－</b> contra, · fato do jogo) e os gráficos — a chance por fonte contra a que a
      odd exige (a linha clara) e os últimos jogos de cada time na linha. Em cada jogo, <b>🔎 outras linhas</b> para analisar e registrar.</p></header>${chartLegend()}
      ${plan.singles.map((x, i) => card(`pw-s${i}`, `Simples ${i + 1}`, x.g, `${esc(SHORT[x.line.market] || x.line.market)}: <b>${esc(x.line.line)}</b> ${lensTag(x)}
        · odd mínima <b>${n2(x.line.odd_min)}</b> (Pinnacle ${n2(x.line.pinnacle_odd)}) · ${money(STAKE.value)}`,
        singleBody(x.g, x), reg(`s:${i}`, has(x.g.fx.id, x.g.fx.home.name, x.g.fx.away.name), x.g.fx.t))).join('')}
      ${halves.map((x, i) => card(`pw-h${i}`, `Favorito no 1º tempo ${i + 1}`, x.g, `<b>${esc(x.line.line)}</b> · odd mínima <b>${n2(x.line.odd_min)}</b> (Pinnacle ${n2(x.line.pinnacle_odd)}) · ${money(STAKE.value)}`,
        halfBody(x.g, x), reg(`h:${i}`, has(x.g.fx.id, x.g.fx.home.name, x.g.fx.away.name), x.g.fx.t))).join('')}
      ${plan.sameGame.map(({ g, combo }, i) => card(`pw-c${i}`, `Mesmo jogo ${i + 1}`, g, `Combo: <b>${esc(combo.line)}</b> · odd mínima <b>${n2(combo.odd_min)}</b> · ${money(STAKE.value)}`,
        comboBody(g, combo), reg(`c:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t))).join('')}
      ${plan.multis.map((t, i) => card(`pw-m${i}`, `Múltipla ${i + 1}`, null, `${t.n} pernas · ${t.asian ? 'não perde' : 'acerta todas'} em <b>${pct(t.p_all)}</b>
        · odd total mínima <b>${n2(t.min)}</b> · ${money(STAKE.value)}`,
        `<p class="muted small">Cada perna: a chance (a menor entre a nossa e a da mistura com a Pinnacle), o esperado de gols, o contexto e a linha nos
        últimos jogos dos dois times.</p>${legsBody(scan.games, t)}`, reg(`m:${i}`, t.legs.every(l => has(l.fixtureId, l.home, l.away)), t.first_kickoff))).join('')}</section>`;
    const how = `<details class="howto"><summary>ℹ️ Como o plano é montado</summary><div class="howbody">
      <p>Só os <b>mercados marcados</b> e, com "só as grandes", só jogos de liga grande (onde há dados completos e as casas oferecem as linhas — chutes sobretudo).
      Um jogo entra uma vez só; jogo que já tem entrada fica fora. Entrada padrão de <b>${money(STAKE.value)}</b> em cada aposta.</p>
      <p><b>Simples em três frentes</b>, em rodízio, as de mais acerto primeiro: <b>🤝 acordo com a Pinnacle</b> — linhas cotadas por ela e consistentes (âncora
      ou sólida: 60%+, histórico dos times e contexto que não é contra) em que o modelo não discorda dela; o valor está na casa pagar o <b>alvo</b>: a justa da
      linha + 2% (nunca abaixo de 1,50; no total de gols, 1,30), que precisa ficar até 8% acima da odd da Pinnacle; <b>📊 chutes</b> — a Pinnacle não cota,
      o preço é só do modelo: sólida ou âncora com os dois times batendo a linha em 60%+ dos últimos jogos, mínima de 1,50 a 3,00 e só em liga grande; e
      <b>🎯 nossa leitura</b> — a nossa chance (modelo corrigido + cenário) acima da Pinnacle, com ela pagando de 1,70 (1X2 e handicap) ou 1,30 (total de gols)
      até 2,70 e acima da nossa mínima, pelo valor conservador (a nossa chance encolhida pela metade na direção da dela). No máximo ${PER_LEAGUE} por liga.</p>
      <p><b>⏱️ Favorito no 1º tempo</b>: nos jogos em que o favorito vence o jogo em 60%+ (Pinnacle), a vitória dele no 1º tempo — a Pinnacle cota de 1,70 a 2,70,
      o nosso modelo do 1º tempo não fica mais de 3 pp abaixo dela, e o alvo (a justa + 2%) até 8% acima da odd dela; os ${HALF_MAX} mais prováveis.</p>
      <p><b>🔗 No mesmo jogo</b>: a vitória do favorito + mais de 1,5 gols — ou de 2,5, quando a de 1,5 paga menos de 1,60 —, com chance de 50%+ e odd mínima até
      2,70, os de maior chance. <b>🎰 Múltiplas</b> (são bingo: até 2, de odd justa 6 ou mais): over de gols com a linha cotada pela Pinnacle.</p>
      <p>Fica fora o que depende da escalação — copa (rodízio), time de base/B, começo de temporada com mudança grande e, na 🎯, dúvida de desfalque, leitura
      longe da Pinnacle e amostra curta — e o jogo difícil de analisar. Aposte só se a casa pagar a <b>odd mínima</b>; o plano entra na 🧪 simulação na odd da
      Pinnacle (o pior cenário), e o resultado fica em 🧪 Simulação dos planos.</p></div></details>`;
    out.innerHTML = `${head}${singles}${halfSec}${same}${multis}${why}${how}`;
    bindTooltips(out);
  }

  // ---- outras linhas de um jogo do plano (pedido do Jeferson, 13/10/2026: "nos jogos do plano, me dê opção de analisar
  // outras linhas"): as linhas que a análise do plano já tem do jogo — sem gastar requisição —, por mercado, com a chance,
  // a Pinnacle e a mínima; 📈 abre o porquê da linha (a chance por fonte e os últimos jogos de cada time), ➕ registra. ----
  const OTHER = ['Handicap asiático', 'Total de gols', '1X2', 'Resultado 1º tempo', 'Total de gols 1T', 'Total de escanteios', 'Total escanteios 1T', 'Total de chutes', 'Total de chutes no gol', 'Combo'];
  function linesOf(g) {
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
  const findLine = (g, id) => [...(g.lines || []), ...(g.scenario || []), ...(g.fav_half ? [g.fav_half] : []), ...(g.fav_combos || [])].find(l => l.id === id);
  function othersHtml(g) {
    const groups = linesOf(g);
    if (!groups.length) return '<p class="muted small">A análise do plano não guardou outras linhas deste jogo — abra a análise completa.</p>';
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
  function othChart(g, l) {
    const p = l.p_blend ?? l.p_nossa, bars = [['Pinnacle', l.p_pinnacle ?? null, false, 'a chance da Pinnacle, sem a margem dela'], ['Modelo', l.p_model ?? null, false, 'o nosso modelo'],
      ['Últimos 10 jogos', l.hit_rate_last10 ?? null, false, 'quanto a linha teria acertado nos últimos 10 jogos dos dois times'], ['Chance', p, true, 'a chance que o app usa']];
    return `<div class="othhead"><b>${esc(SHORT[l.market] || l.market)}: ${esc(l.line)}</b> · chance ${pct(p)} · odd mínima <b>${n2(l.odd_min)}</b>${l.pinnacle_odd ? ` · Pinnacle ${n2(l.pinnacle_odd)}` : ''}
      <button class="ghost mini" data-olx title="Fechar">✕</button></div>
      <div class="whygrid">${chanceChart(bars, l.odd_min > 1 ? [1 / l.odd_min, `a mínima ${n2(l.odd_min)} exige`] : null)}<div></div></div>
      ${g.teams?.length ? `<div class="teams">${teamCharts(l, g.teams)}</div>` : ''}`;
  }
  $('#planOut').addEventListener('toggle', e => {
    const d = e.target.closest?.('details.othlines');
    if (!d || !d.open || d.dataset.ready) return;
    const g = scan?.games.find(x => x.fx.id === Number(d.dataset.others));
    if (!g) return;
    d.querySelector('.othbody').innerHTML = othersHtml(g);
    d.dataset.ready = '1';
  }, true);
  $('#planOut').addEventListener('click', async e => {
    const c = e.target.closest('[data-olc]'), en = e.target.closest('[data-ole]'), x = e.target.closest('[data-olx]'), full = e.target.closest('[data-full]');
    if (x) { const box = x.closest('.othchart'); box.hidden = true; box.innerHTML = ''; return; }
    if (c || en) {
      const [f, id] = (c || en).dataset[c ? 'olc' : 'ole'].split('|'), g = scan?.games.find(y => y.fx.id === Number(f)), l = g && findLine(g, id);
      if (!l) return;
      if (en) { openEntry(l.id, null, { line: l, fx: g.fx, btn: en }); return; }
      const box = c.closest('.othbody').querySelector('.othchart');
      box.innerHTML = othChart(g, l); box.hidden = false; bindTooltips(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (full && analyzeFixture) {
      const g = scan?.games.find(y => y.fx.id === Number(full.dataset.full));
      if (!g) return;
      full.disabled = true;
      let national = false;
      try { national = !!(await api.teamInfo?.(g.fx.home.id))?.national; } catch { /* segue como clube */ }
      await analyzeFixture(g.fx, national);
      full.disabled = false;
    }
  });

  renderMarkets();
  show();
}
