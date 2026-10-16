// Plano do dia (plan.js) na tela. O foco (Jeferson, 16/10/2026: "o que dá resultado é total de gols, a vitória do
// favorito e o mesmo jogo; a vitória no 1º tempo num jogo muito favorito também; me dá uns 20 jogos no dia"): quatro
// blocos — 🔗 mesmo jogo, ⚽ total de gols, 🏆 vitória do favorito, ⏱️ favorito no 1º tempo —, até 20 entradas, cada jogo
// uma vez só. Um botão analisa a janela escolhida (horas a partir de agora ou o dia inteiro; a varredura guarda só os
// jogos com candidato nesses blocos, e o contexto da API vai para eles) e mostra só o plano, cada entrada com a odd
// mínima, a da Pinnacle, a chance e a stake (stake.js: 20 € a favor da Pinnacle, 10 € contra), e o ➕ para registrar.
// "Copiar" leva a lista para apostar nas casas; o plano entra sozinho na 🧪 simulação para medirmos (o painel dos planos
// fica no fim desta seção); o especialista recebe o plano. Embaixo do resumo, o porquê de cada entrada (planwhy.js) e,
// em cada jogo, as outras linhas para analisar (otherlines.js).

import { PLAN_SCAN, scanDay } from './scanner.js';
import { load, save } from './store.js';
import { exposedGames } from './entry.js';
import { COMBO_ODDS, COMBO_P, FAV_ODDS, FAV_P, HALF_MAX, HALF_ODDS, PER_LEAGUE, PLAN_DEFAULT, PLAN_MAX, PLAN_OPTIONS, buildPlan, planFromKeys, planFunnel, planKeys, planText } from './plan.js';
import { BIG_LEAGUES, isBig } from './leagues.js';
import { buildPlanSim, comboPin, simReport } from './sim.js';
import { simPanel } from './simview.js';
import { bindSpecialist, briefPlan } from './brief.js';
import { bindTooltips, chartLegend } from './dashboard.js';
import { comboBody, favBody, halfBody, singleBody } from './planwhy.js';
import { bindOthers } from './otherlines.js';
import { CONTRA_SHARE, STAKE, isContra, money, stakeOf } from './stake.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const pc1 = x => `${(x * 100).toFixed(1).replace('.', ',')}%`;
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
const teamOf = (g, l) => (l.id === '2' ? g.fx.away.name : g.fx.home.name);   // o favorito de uma linha do 1X2

// O funil do plano (plan.js planFunnel) numa linha: dos jogos da janela aos analisados, e onde caiu cada analisado.
// top: quantos jogos a varredura do plano guardou (os de maior chance com candidato); null numa varredura de antes do foco.
function funnelLine(f, { inWindow = false, top = null } = {}) {
  const nz = xs => xs.filter(([k]) => k > 0).map(([k, t]) => `${k} ${t}`);
  const before = nz([[f.outside, 'de ligas menores, não analisados ("só as grandes")'], ...Object.entries(f.skipped).map(([t, k]) => [k, `fora da análise (${t})`])]);
  const lost = nz([[f.unkept, top ? `sem candidato nos blocos do plano (ou além dos ${top} de maior chance)` : 'não guardados pela varredura'],
    [f.started, 'já tinham começado'], [f.small, 'de ligas menores'], [f.exposed, 'já têm entrada'], [f.lineup, 'dependem da escalação ("entrar se…")'],
    [f.hard, 'jogo difícil de analisar'], [f.cap, `no teto de ${PER_LEAGUE} por liga`], [f.full, `com o plano cheio (${PLAN_MAX} entradas)`],
    [f.none, 'nenhuma linha passou nas regras']]);
  return `<p class="muted funnel"><b>Funil</b> (cada jogo conta uma vez): ${f.fixtures != null ? `${f.fixtures} ${inWindow ? 'na janela' : 'do dia'} → ` : ''}${f.quoted != null ? `${f.quoted} com odd da Pinnacle → ` : ''}<b>${f.analyzed} analisados</b>${before.length ? ` (antes disso ficaram fora ${before.join(', ')})` : ''}
    → no plano: <b>${f.same} no mesmo jogo · ${f.goals} em gols · ${f.fav} na vitória do favorito · ${f.half} no 1º tempo</b>${lost.length ? ` · sem entrada: ${lost.join(' · ')}` : ''}.</p>`;
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

  // o limite de requisições da análise (o mesmo da varredura), guardado neste aparelho
  const budgetOf = () => { try { return Math.max(50, Number(localStorage.getItem(BUDGET_KEY)) || 1500); } catch { return 1500; } };
  const bIn = $('#planBudget');
  if (bIn) {
    bIn.value = budgetOf();
    bIn.onchange = () => { const v = Math.max(50, Number(bIn.value) || 1500); bIn.value = v; try { localStorage.setItem(BUDGET_KEY, v); } catch { /* sem armazenamento */ } };
  }

  // Os blocos e as ligas do plano (o operador marca; guardados neste aparelho): padrão, os quatro blocos e só as ligas
  // grandes. Mudar a marcação refaz o plano com a análise guardada, sem gastar requisição; só incluir as ligas menores pede
  // analisar de novo. Guardado { v: 3, sel }: os blocos do foco (16/10); a marcação de antes (outros mercados) volta ao padrão.
  const chosen = () => {
    try {
      const v = JSON.parse(localStorage.getItem(MARKETS_KEY));
      if (v?.v === 3 && Array.isArray(v.sel)) return PLAN_OPTIONS.map(([k]) => k).filter(k => v.sel.includes(k));
    } catch { /* padrão */ }
    return [...PLAN_DEFAULT];
  };
  const bigOn = () => { try { return localStorage.getItem(BIG_KEY) !== '0'; } catch { return true; } };
  const bigList = [...BIG_LEAGUES.values()].join(', ');
  function renderMarkets() {
    const sel = chosen(), isDefault = sel.length === PLAN_DEFAULT.length && sel.every(k => PLAN_DEFAULT.includes(k)) && bigOn();
    $('#planMarkets').innerHTML = `<span class="muted">Blocos:</span>${PLAN_OPTIONS.map(([k, t]) => `<label class="mk"><input type="checkbox" data-pm value="${esc(k)}"${sel.includes(k) ? ' checked' : ''}>${esc(t)}</label>`).join('')}
      <span class="muted">· Ligas:</span><label class="mk" title="${esc(bigList)}"><input type="checkbox" data-pbig${bigOn() ? ' checked' : ''}>só as grandes</label>
      ${isDefault ? '' : '<button class="ghost mini" data-pmdef>padrão</button>'}`;
  }
  // mudou a marcação: refaz o plano da análise guardada (as ligas menores, se ela foi feita só com as grandes, pedem outra)
  async function remake() {
    renderMarkets();
    if (!scan?.games) return;
    if (!bigOn() && scan.outside != null) msg('A análise guardada tem só as ligas grandes: toque em Montar o plano para incluir as outras.');
    else msg('');
    if (!chosen().length) { msg('Marque pelo menos um bloco.', true); return; }
    await makePlan();
    render();
  }
  $('#planMarkets').addEventListener('change', e => {
    if (e.target.matches('[data-pm]')) localStorage.setItem(MARKETS_KEY, JSON.stringify({ v: 3, sel: [...$('#planMarkets').querySelectorAll('[data-pm]:checked')].map(x => x.value) }));
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
  // as simulações dos planos (simview.js): todos os planos montados, o mais novo primeiro
  const simUI = simPanel({ api, el: $('#planSimOut'), mine: id => String(id).startsWith('plano-'), title: '🧪 Simulação dos planos',
    cat: c => c.replace(/^Plano: /, ''), onChange: () => render(), tools: { openEntry, analyzeFixture, banca },
    intro: `Cada plano montado entra aqui sozinho, como se tivéssemos feito todas as entradas dele, sempre no pior cenário: na odd da Pinnacle
      da hora do plano ("Pin"), não na odd mínima — a casa pagando mais é bônus. O mesmo jogo, que ela não cota junto, na odd que ela pagaria:
      a justa pelas chances dela, com a margem dela em cada perna ("Pin est."). Montar de novo a mesma janela antes de qualquer jogo começar
      substitui o plano anterior. O resultado sai por bloco (mesmo jogo; gols pela 🎯 nossa leitura e pelo 🤝 acordo com a Pinnacle; vitória do
      favorito; 1º tempo), em unidades (stake 1 em tudo) e em dinheiro (a entrada proposta: ${money(STAKE.value)} a favor da Pinnacle,
      ${money(STAKE.value * CONTRA_SHARE)} contra); CLV = a odd de entrada contra a justa de fechamento da Pinnacle. As simulações de antes do
      foco de 16/10 foram zeradas. Os resultados entram com 🔄 Conferir resultados depois dos jogos (e sozinhos com a página aberta). A simulação
      não entra no app de apostas: em cada entrada aberta, o ➕ registra lá a aposta que você fizer e o 🔎 mostra as outras linhas do jogo.` });
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
    if (!chosen().length) return msg('Marque pelo menos um bloco.', true);
    const w = sel.value, budget = budgetOf();
    busy = true; $('#planRun').disabled = true;
    try {
      // a janela do operador (horas a partir de agora, exatas, ou o dia inteiro); a varredura guarda os jogos com candidato
      // nos blocos do plano (até 3 × o teto, os de maior chance primeiro) e só eles levam o contexto da API; só as ligas
      // grandes quando marcado (as outras nem carregam); sem o histórico dos escanteios do 1º tempo (o plano não usa)
      const win = isHours(w) ? { hours: Number(w.slice(1)), expand: false } : { date: keyOf(w) };
      scan = await scanDay(api.dossierApi, { ...win, budget, banca, top: 3 * PLAN_MAX, half: false, markets: [PLAN_SCAN],
        only: bigOn() ? f => isBig(f.league) : null, onProgress: t => msg(t) });
      await save(`af:scan:${keyOf(w)}`, scan);
      await makePlan();
      msg(scan.games.length ? '' : `Nenhum jogo${bigOn() ? ' de liga grande' : ''} com odds da Pinnacle e candidato no plano ${isHours(w) ? `nas próximas ${win.hours} h: escolha uma janela maior${bigOn() ? ' ou desmarque "só as grandes"' : ''}.` : 'nesta data (ainda).'}`);
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

  // ➕: abre o formulário de entrada da linha (c: mesmo jogo, g: gols, f: favorito, h: 1º tempo)
  const BLOCK_OF = { c: () => plan.sameGame, g: () => plan.goals, f: () => plan.fav, h: () => plan.halves };
  $('#planOut').addEventListener('click', e => {
    const b = e.target.closest('[data-pe]');
    if (!b || !plan) return;
    const [kind, i] = b.dataset.pe.split(':'), x = BLOCK_OF[kind]?.()[Number(i)];
    if (!x) return;
    const line = kind === 'c' ? x.combo : x.line;
    openEntry(line.id, null, { line, fx: x.g.fx, btn: b });
  });
  // registrou: a entrada aparece marcada
  $('#entryDlg')?.addEventListener('close', () => { if (plan) render(); });

  // trocou a linha de gols do mesmo jogo (1,5 · 2,5 · 3,5): guarda o plano e a simulação dele
  $('#planOut').addEventListener('change', async e => {
    const cg = e.target.closest('[data-pcg]');
    if (!cg) return;
    const i = Number(cg.dataset.pcg), { g } = plan.sameGame[i], c = (g.fav_combos || []).find(x => x.id === cg.value);
    if (c) { plan.sameGame[i] = { g, combo: c }; await save(`af:plan:${keyOf(sel.value)}`, planKeys(plan)); await simPlan({ replace: false }); render(); }
  });
  // toque numa entrada do resumo: vai ao porquê dela; ↑ volta ao resumo
  $('#planOut').addEventListener('click', e => {
    if (e.target.closest('[data-top]')) { $('#planOut').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('button:not([data-go]), select, input')) document.getElementById(go.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function render() {
    const out = $('#planOut');
    $('#planCopy').hidden = $('#planSpec').hidden = !plan;
    if (!scan?.games) {
      out.innerHTML = `<div class="empty-state"><p><b>Ainda sem a análise desta janela.</b></p><p class="muted">Escolha a janela — horas a partir de agora ou o dia
        inteiro — e toque em <b>Montar o plano</b>: o app analisa os jogos com odds da Pinnacle nela (o dia inteiro leva alguns minutos e usa o limite de
        requisições) e devolve só o plano, até ${PLAN_MAX} entradas.</p></div>`;
      return;
    }
    if (!scan.games.length) { out.innerHTML = `<div class="empty-state"><b>${esc(labelOf(scan))}</b>: nenhum jogo com odds da Pinnacle e candidato no plano nesta janela${scan.window ? ' — escolha uma janela maior' : ''}.</div>`; return; }
    if (!plan) { out.innerHTML = '<div class="empty-state">Sem plano para esta varredura.</div>'; return; }
    const exp = exposedGames(), has = g => exp.has(g.fx.id, g.fx.home.name, g.fx.away.name);
    const reg = (key, g) => (has(g) ? '<span class="tag ok">✓ registrada</span>' : g.fx.t <= Date.now() ? '<span class="tag mid">começou</span>'
      : `<button class="enter mini" data-pe="${key}" title="Registrar">➕</button>`);
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    // o que o plano rende se tudo der green: na odd da Pinnacle (o pior cenário; a casa pagando mais é bônus; o mesmo jogo na
    // que ela pagaria), com a entrada de cada aposta ([odd, stake]: 20 € a favor da Pinnacle, 10 € contra)
    const singles = [...plan.goals, ...plan.fav, ...plan.halves];
    const entries = [...plan.sameGame.map(x => [comboPin(x.combo, x.g)[0], stakeOf(x.combo)]), ...singles.map(x => [x.line.pinnacle_odd, stakeOf(x.line)])];
    const nEntries = entries.length, total = entries.reduce((s, [, k]) => s + k, 0), pot = entries.reduce((s, [o, k]) => s + (o > 1 ? k * (o - 1) : 0), 0);
    const nContra = singles.filter(x => isContra(x.line)).length, budgetOut = (scan.skipped || []).filter(s => /orçamento/.test(s.why || '')).length;
    const nOurs = plan.goals.filter(x => x.lens === 'ours').length, nAgree = plan.goals.length - nOurs;
    const badge = (t, c) => `<span class="badge${c ? '' : ' zero'}">${t} <b>${c}</b></span>`, sub = (t, c) => (c ? `<span class="badge sub">${t} ${c}</span>` : '');
    const inSim = simUI.get(simIdOf()), sum = inSim && simReport(inSim).total, sg = x => `${x > 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}`;
    const simLine = inSim ? `<div class="simbar">🧪 Na simulação: ${sum.n} entradas${sum.done
      ? ` · ${sum.done} encerrada${sum.done > 1 ? 's' : ''}${sum.open ? `, ${sum.open} em aberto` : ''} · <b class="${sum.profit_u > 0 ? 'pos' : sum.profit_u < 0 ? 'neg' : ''}">${sg(sum.profit_u)} u</b> · ${money(sum.profit_brl, inSim.cur || 'BRL', inSim.cur && inSim.cur !== 'BRL' ? 2 : 0)}`
      : ' · nenhuma encerrada ainda'} <button class="ghost mini" data-simgo="${esc(inSim.id)}">ver o resultado ↓</button></div>`
      : `<div class="simbar"><button class="ghost" id="planSimRun">🧪 Simular as propostas deste plano</button> <span class="muted">registra todas as entradas, na odd da Pinnacle da hora, à parte das apostas reais</span></div>`;
    const empty = !nEntries, top = scan.markets?.includes(PLAN_SCAN) ? scan.top : null;
    const head = `<div class="pblock summary">
      <div class="sumtop"><div><h3>${esc(labelOf(scan))}</h3><div class="muted small">análise de ${when} · ${scan.analyzed} jogos analisados de ${scan.fixtures} ${scan.window ? 'na janela' : 'do dia'} · ${scan.requests} requisições</div></div>
        <div class="sumstake"><b>${nEntries}</b> entrada${nEntries === 1 ? '' : 's'} = <b>${money(total)}</b>
          ${nEntries ? `<div class="muted small">${money(STAKE.value)} a favor da Pinnacle${nContra ? ` · ${nContra} contra ela, a ${money(STAKE.value * CONTRA_SHARE)}` : ''}</div>
          <div class="pos small">+${money(pot, STAKE.cur, 2)} se tudo der green <span class="muted">(na odd da Pinnacle)</span></div>` : ''}</div></div>
      <div class="badges">${badge('🔗 Mesmo jogo', plan.sameGame.length)}${badge('⚽ Total de gols', plan.goals.length)}${sub('🎯', nOurs)}${sub('🤝', nAgree)}${badge('🏆 Vitória do favorito', plan.fav.length)}${badge('⏱️ Favorito 1º tempo', plan.halves.length)}</div>
      ${empty ? '' : simLine}
      <details class="funnelbox"><summary>Funil: onde caiu cada jogo analisado</summary>${funnelLine(planFunnel(scan, plan, { exposed: exp }), { inWindow: !!scan.window, top })}</details>
      ${budgetOut ? `<p class="neg small">${budgetOut} jogos com odds ficaram fora da análise pelo limite de requisições (${scan.budget}): aumente o limite e monte de novo.</p>` : ''}
      ${nEntries && nEntries < PLAN_MAX && !scan.window ? `<p class="muted small">O dia rendeu ${nEntries} de até ${PLAN_MAX} entradas: os outros jogos não passaram nas regras (o funil mostra onde cada um caiu) — melhor poucas do que forçar entrada sem valor.</p>` : ''}
      ${empty ? '<p class="muted">Nenhuma entrada passou nas regras do plano nesta janela.</p>' : ''}</div>`;
    // ⚽ gols em duas frentes: na 🎯 o valor é o nosso (conservador) na odd da Pinnacle; no 🤝 o valor está na casa pagar o alvo
    const lensTag = x => (x.lens === 'agree'
      ? '<span class="tag ok" title="o modelo e a Pinnacle concordam; linha consistente (histórico e contexto); o valor está na casa pagar o alvo (a justa + 2%)">🤝 acordo</span>'
      : `<span class="tag mid" title="🎯 nossa leitura: a nossa chance (modelo corrigido + cenário) acima da Pinnacle${x.line.contra ? ' — 5 pp ou mais: contra ela, metade da entrada' : ''}">🎯 ${x.line.contra ? 'contra a Pinnacle' : 'nossa leitura'}</span>`);
    const valueCell = x => (x.lens === 'agree'
      ? `<span class="muted" title="a casa precisa pagar o alvo (a justa + 2%): ${x.value > 0 ? `${pc1(x.value)} acima` : 'até'} da odd da Pinnacle">+${pc1(Math.max(0, x.value))} Pin</span>`
      : `<span class="pos">+${pc1(x.value)}</span>`);
    // a stake da aposta: cheia a favor da Pinnacle, metade contra (stake.js)
    const stakeCell = l => (isContra(l) ? `<b>${money(stakeOf(l))}</b> <span class="muted" title="contra a Pinnacle (a nossa leitura 5 pp ou mais acima da dela): metade da entrada">½</span>`
      : `<b>${money(stakeOf(l))}</b>`);
    const stakeTxt = l => (isContra(l) ? `<b>${money(stakeOf(l))}</b> (metade: contra a Pinnacle)` : money(stakeOf(l)));
    const block = (id, icon, title, count, desc, body) => (count ? `<section class="pblock" id="${id}"><header class="pblock-h"><h3>${icon} ${title} <span class="count">${count}</span></h3>
      <p class="muted small">${desc}</p></header>${body}</section>` : '');
    const gameCell = g => `<td><div class="game">${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</div><div class="muted small">${hour(g.fx.t)} · ${esc(g.fx.league.name)}</div></td>`;
    // 🔗 mesmo jogo: a vitória do favorito + a linha de gols (1,5, 2,5 ou 3,5), que dá para trocar
    const comboCell = (g, combo, i) => ((g.fav_combos || []).length > 1 && combo.fav
      ? `<b>${esc(combo.legs[0].line)}</b> + <select data-pcg="${i}" title="a linha de gols do combo">${g.fav_combos.map(c => `<option value="${esc(c.id)}"${c.id === combo.id ? ' selected' : ''}>${esc(c.legs[1].line)} · ${pct(c.p_blend)} · ≥ ${n2(c.odd_min)}</option>`).join('')}</select>`
      : `<b>${esc(combo.line)}</b>`);
    const pinEst = (combo, g) => { const [o] = comboPin(combo, g); return o > 1 ? `<span title="a odd que a Pinnacle pagaria: a justa pelas chances dela, com a margem dela em cada perna">≈ ${n2(o)}</span>` : '—'; };
    const same = block('pbSame', '🔗', 'Mesmo jogo', plan.sameGame.length, `A vitória do favorito + mais de 1,5 gols — ou de 2,5 (ou 3,5), quando a mais provável paga menos de ${n2(COMBO_ODDS[0])} —,
      chance de ${pct(COMBO_P)}+ e odd mínima de ${n2(COMBO_ODDS[0])} a ${n2(COMBO_ODDS[1])}. Dá para trocar a linha de gols.`,
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Combo</th><th>Chance</th><th>Odd mínima</th><th>Pinnacle</th><th>Stake</th></tr>
      ${plan.sameGame.map(({ g, combo }, i) => `<tr data-go="pw-c${i}"><td>${reg(`c:${i}`, g)}</td>${gameCell(g)}
      <td>${comboCell(g, combo, i)}</td><td><b>${pct(combo.p_blend)}</b> <span class="muted">· ${pct(combo.p_pinnacle)}</span></td><td><b>${n2(combo.odd_min)}</b></td>
      <td>${pinEst(combo, g)}</td><td>${stakeCell(combo)}</td></tr>`).join('')}</table></div>`);
    const goals = block('pbGoals', '⚽', 'Total de gols', plan.goals.length, 'Só over. Primeiro a 🎯 nossa leitura (a nossa chance acima da Pinnacle, com valor na odd dela); sem ela, a linha consistente em 🤝 acordo com a Pinnacle (o valor está na casa pagar o alvo). Toque na linha para ver o porquê.',
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Frente</th><th>Aposta</th><th>Odd mínima</th><th>Pinnacle</th><th>Chance</th><th>Valor</th><th>Stake</th></tr>
      ${plan.goals.map((x, i) => { const { g, line } = x; return `<tr data-go="pw-g${i}"><td>${reg(`g:${i}`, g)}</td>${gameCell(g)}
      <td>${lensTag(x)}</td><td title="${esc(line.why || (line.context ? `contexto ${line.context.verdict}; nível ${line.tier}` : ''))}"><b>${esc(line.line)}</b></td>
      <td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td><td><b>${pct(line.p_nossa ?? line.p_blend)}</b> <span class="muted">· ${pct(line.p_pinnacle)}</span></td>
      <td>${valueCell(x)}</td><td>${stakeCell(line)}</td></tr>`; }).join('')}</table></div>`);
    const fav = block('pbFav', '🏆', 'Vitória do favorito', plan.fav.length, `O lado que a Pinnacle põe com ${pct(FAV_P)}+ de vencer, cotado por ela de ${n2(FAV_ODDS[0])} a ${n2(FAV_ODDS[1])}.
      O preço segue a Pinnacle: alvo = a justa dela + 2% (nunca abaixo de ${n2(FAV_ODDS[0])}).`,
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Aposta</th><th>Odd mínima</th><th>Pinnacle</th><th>Chance</th><th>Stake</th></tr>
      ${plan.fav.map(({ g, line }, i) => `<tr data-go="pw-f${i}"><td>${reg(`f:${i}`, g)}</td>${gameCell(g)}
      <td><b>${esc(teamOf(g, line))} vence</b></td><td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td>
      <td><b>${pct(line.p_pinnacle)}</b>${line.p_model != null ? ` <span class="muted" title="o nosso modelo (ele comprime o favorito)">· modelo ${pct(line.p_model)}</span>` : ''}</td>
      <td>${stakeCell(line)}</td></tr>`).join('')}</table></div>`);
    const halfSec = block('pbHalves', '⏱️', 'Favorito vence o 1º tempo', plan.halves.length, `Jogos de favoritismo alto (60%+ de vencer o jogo pela Pinnacle): a vitória no 1º tempo paga perto de 2.
      Cotada pela Pinnacle de ${n2(HALF_ODDS[0])} a ${n2(HALF_ODDS[1])}; o preço segue a Pinnacle: alvo = a justa dela + 2%; até ${HALF_MAX}.`,
      `<div class="scroll"><table class="plantab"><tr><th></th><th>Jogo</th><th>Aposta</th><th>Favorito no jogo</th><th>Odd mínima</th><th>Pinnacle</th><th>Chance</th><th>Stake</th></tr>
      ${plan.halves.map(({ g, line }, i) => `<tr data-go="pw-h${i}"><td>${reg(`h:${i}`, g)}</td>${gameCell(g)}
      <td><b>${esc(line.line)}</b></td><td>${pct(line.p_fav_ft)}</td><td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td>
      <td><b>${pct(line.p_pinnacle)}</b>${line.p_model != null ? ` <span class="muted" title="o nosso modelo do 1º tempo (ele comprime o favorito)">· modelo ${pct(line.p_model)}</span>` : ''}</td><td>${stakeCell(line)}</td></tr>`).join('')}</table></div>`);
    // o porquê de cada entrada (planwhy.js) e, em cada jogo, as outras linhas para analisar e a análise completa
    const tools = g => `<details class="othlines" data-others="${g.fx.id}"><summary>🔎 Outras linhas deste jogo</summary><div class="othbody"></div></details>
      <button class="ghost mini" data-full="${g.fx.id}" title="Abre a análise completa do jogo (todas as linhas, a sua linha, o contexto) na aba Jogo">🔬 Análise completa do jogo</button>`;
    const card = (id, title, g, what, body, btn) => `<article class="whycard" id="${id}">
      <div class="whyhead"><h4>${title} · ${hour(g.fx.t)} · ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${esc(g.fx.league.name)}</span></h4>
        <span>${btn} <button class="ghost mini" data-top title="Voltar ao resumo do plano">↑ plano</button></span></div>
      <p class="facts">${what}</p>${body}<div class="whytools">${tools(g)}</div></article>`;
    const odds = l => `odd mínima <b>${n2(l.odd_min)}</b> (Pinnacle ${n2(l.pinnacle_odd)}) · ${stakeTxt(l)}`;
    const why = empty ? '' : `<section class="pblock" id="pbWhy"><header class="pblock-h"><h3>🧾 Por que cada entrada</h3>
      <p class="muted small">O resumo, os motivos (<b class="pos">＋</b> a favor, <b class="neg">－</b> contra, · fato do jogo) e os gráficos — a chance por fonte contra a que a
      odd exige (a linha clara) e os últimos jogos de cada time na linha. Em cada jogo, <b>🔎 outras linhas</b> para analisar e registrar.</p></header>${chartLegend()}
      ${plan.sameGame.map(({ g, combo }, i) => card(`pw-c${i}`, `🔗 Mesmo jogo ${i + 1}`, g, `Combo: <b>${esc(combo.line)}</b> · odd mínima <b>${n2(combo.odd_min)}</b> · ${stakeTxt(combo)}`,
        comboBody(g, combo), reg(`c:${i}`, g))).join('')}
      ${plan.goals.map((x, i) => card(`pw-g${i}`, `⚽ Gols ${i + 1}`, x.g, `<b>${esc(x.line.line)}</b> ${lensTag(x)} · ${odds(x.line)}`, singleBody(x.g, x), reg(`g:${i}`, x.g))).join('')}
      ${plan.fav.map((x, i) => card(`pw-f${i}`, `🏆 Favorito ${i + 1}`, x.g, `<b>${esc(teamOf(x.g, x.line))} vence</b> · ${odds(x.line)}`, favBody(x.g, x), reg(`f:${i}`, x.g))).join('')}
      ${plan.halves.map((x, i) => card(`pw-h${i}`, `⏱️ 1º tempo ${i + 1}`, x.g, `<b>${esc(x.line.line)}</b> · ${odds(x.line)}`, halfBody(x.g, x), reg(`h:${i}`, x.g))).join('')}</section>`;
    const how = `<details class="howto"><summary>ℹ️ Como o plano é montado</summary><div class="howbody">
      <p>Só o que deu resultado nas simulações e nas apostas reais (foco de 16/10): <b>quatro blocos</b>, até <b>${PLAN_MAX} entradas</b>, cada jogo uma vez só —
      jogo que já tem entrada fica fora —, no máximo ${PER_LEAGUE} por liga e, com "só as grandes", só jogos de liga grande. Os blocos se revezam: o que tem menos
      entradas pega o próximo jogo (no empate, na ordem abaixo).</p>
      <p><b>🔗 Mesmo jogo</b>: a vitória do favorito + mais de 1,5 gols — ou de 2,5 (ou 3,5), quando a mais provável paga menos de ${n2(COMBO_ODDS[0])} —, com chance
      de ${pct(COMBO_P)}+ e odd mínima de ${n2(COMBO_ODDS[0])} a ${n2(COMBO_ODDS[1])}, a de maior chance primeiro.</p>
      <p><b>⚽ Total de gols</b> (só over): primeiro a <b>🎯 nossa leitura</b> — a nossa chance (modelo corrigido + cenário) acima da Pinnacle, com ela pagando de 1,30
      a 2,70, pelo valor conservador (a nossa chance encolhida pela metade na direção da dela); sem ela, o <b>🤝 acordo com a Pinnacle</b> — a linha consistente
      (âncora ou sólida: 60%+, histórico dos times e contexto que não é contra), o modelo no máximo 3 pp abaixo dela e o <b>alvo</b> (a justa + 2%, nunca abaixo de
      1,30) até 8% acima da odd dela.</p>
      <p><b>🏆 Vitória do favorito</b>: o lado com ${pct(FAV_P)}+ de vencer pela Pinnacle, cotado por ela de ${n2(FAV_ODDS[0])} a ${n2(FAV_ODDS[1])} — o jogo equilibrado
      (40–50%) acertou 1 de 14 nas simulações e fica fora. O preço segue a Pinnacle (o nosso modelo vê o favorito mais perto da zebra do que ele é): alvo = a
      justa dela + 2%, até 8% acima da odd dela.</p>
      <p><b>⏱️ Favorito no 1º tempo</b>: nos jogos em que o favorito vence o jogo em 60%+ (Pinnacle), a vitória dele no 1º tempo — a Pinnacle cota de ${n2(HALF_ODDS[0])}
      a ${n2(HALF_ODDS[1])}; como na vitória do favorito, o preço segue a Pinnacle (o nosso modelo do 1º tempo comprime o favorito): alvo = a justa dela + 2%, até 8% acima
      da odd dela; até ${HALF_MAX}.</p>
      <p><b>Stake pelo acordo com a Pinnacle</b>: <b>${money(STAKE.value)}</b> quando a aposta está a favor dela e <b>${money(STAKE.value * CONTRA_SHARE)}</b> (metade)
      quando é contra — a nossa leitura 5 pp ou mais acima da dela (🎯 "contra a Pinnacle"): nas apostas reais e nas simulações, essas acertaram o que ela
      dizia (44%), não o que nós dizíamos; as que concordavam com ela, de 62% a 67%.</p>
      <p><b>Ficaram fora</b> (deram prejuízo ou saíram do foco): handicap, escanteios, chutes, múltiplas, o 1X2 do azarão e a dupla chance + gols — continuam em
      🔎 Outras linhas de cada jogo e na análise completa (aba Jogo).</p>
      <p>Fica fora também o que depende da escalação — copa (rodízio), time de base/B, começo de temporada com mudança grande e, na 🎯, dúvida de desfalque,
      leitura longe da Pinnacle e amostra curta — e o jogo difícil de analisar. Aposte só se a casa pagar a <b>odd mínima</b>; o plano entra na 🧪 simulação na
      odd da Pinnacle (o pior cenário), e o resultado fica em 🧪 Simulação dos planos.</p></div></details>`;
    out.innerHTML = `${head}${same}${goals}${fav}${halfSec}${why}${how}`;
    bindTooltips(out);
  }

  // outras linhas de cada jogo do plano (otherlines.js): da análise do plano, sem gastar requisição
  bindOthers($('#planOut'), { getGame: id => scan?.games.find(x => x.fx.id === id) || null, openEntry, analyzeFixture, api });

  renderMarkets();
  show();
}
