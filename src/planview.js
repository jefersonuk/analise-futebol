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
import { LENS, SINGLES, buildPlan, multiOf, planFromKeys, planKeys, planText } from './plan.js';
import { buildPlanSim, comboPin, simReport, ticketPin } from './sim.js';
import { simPanel } from './simview.js';
import { bindSpecialist, briefPlan } from './brief.js';
import { bindTooltips, chartLegend } from './dashboard.js';
import { comboBody, legsBody, singleBody } from './planwhy.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const dm = d => d.split('-').reverse().slice(0, 2).join('/');
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const weekday = d => WEEK[new Date(`${d}T12:00:00`).getDay()];
const BUDGET_KEY = 'afScanBudget', WIN_KEY = 'afPlanWin';
// Janelas do plano: horas a partir de agora (padrão: 4 h) ou o dia inteiro (hoje, amanhã) — a critério do operador.
const HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const isHours = w => /^h\d+$/.test(w);
const keyOf = w => (isHours(w) ? `plano-${w}` : dayStr(Number(w.slice(1))));   // onde a varredura e o plano ficam guardados
const SHORT = { 'Handicap asiático': 'Handicap', 'Total de gols': 'Gols', '1X2': '1X2' };
const brl = x => `R$ ${Math.round(x).toLocaleString('pt-BR')}`;

export function initPlan({ api, openEntry, banca }) {
  let scan = null, plan = null, busy = false;
  const sel = $('#planDate');
  sel.innerHTML = `<optgroup label="A partir de agora">${HOURS.map(h => `<option value="h${h}">Próxima${h > 1 ? 's' : ''} ${h} hora${h > 1 ? 's' : ''}</option>`).join('')}</optgroup>
    <optgroup label="O dia inteiro">${[['d0', 'Hoje'], ['d1', 'Amanhã']].map(([v, t]) => `<option value="${v}">${t} (${weekday(dayStr(+v[1]))}, ${dm(dayStr(+v[1]))})</option>`).join('')}</optgroup>`;
  sel.value = (() => { try { return localStorage.getItem(WIN_KEY) || 'h4'; } catch { return 'h4'; } })();
  if (!sel.value) sel.value = 'h4';
  // o nome do plano: "08/10, 13:12–17:12 (próximas 4 h)" ou "sexta, 09/10 (dia todo)"
  const labelOf = sc => (sc?.window ? `${dm(sc.date)}, ${hour(sc.window.from)}–${hour(sc.window.to)} (próximas ${sc.hours} h)` : sc?.date ? `${weekday(sc.date)}, ${dm(sc.date)} (dia todo)` : '');
  const msg = (text, err = false) => { const el = $('#planMsg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', err); };

  // o plano da data: o guardado (as mesmas entradas, mesmo depois de registrar algumas) ou um novo da varredura
  async function show() {
    const w = sel.value, key = keyOf(w);
    try { localStorage.setItem(WIN_KEY, w); } catch { /* sem armazenamento */ }
    scan = await load(`af:scan:${key}`);
    plan = null;
    if (scan?.games && isHours(w) === !!scan.window) {
      const keys = await load(`af:plan:${key}`);
      if (keys?.scan_at === scan.generated_at) plan = planFromKeys(scan, keys, { banca });
      if (!plan) await makePlan();
    }
    render();
  }
  async function makePlan() {
    plan = buildPlan(scan, { exposed: exposedGames(), banca });
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
      // a janela do operador (horas a partir de agora, exatas, ou o dia inteiro); sem o histórico dos escanteios do 1º tempo
      // (o plano não usa) e guardando mais jogos por filtro
      const win = isHours(w) ? { hours: Number(w.slice(1)), expand: false } : { date: keyOf(w) };
      scan = await scanDay(api.dossierApi, { ...win, budget, banca, top: 30, half: false, onProgress: t => msg(t) });
      await save(`af:scan:${keyOf(w)}`, scan);
      await makePlan();
      msg(scan.games.length ? '' : isHours(w) ? `Nenhum jogo com odds da Pinnacle nas próximas ${win.hours} h: escolha uma janela maior.` : 'Nenhum jogo com odds da Pinnacle nesta data (ainda).');
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
    if (kind === 'm') {
      const t = plan.multis[n], line = multiLine(t);
      openEntry(line.id, t.min, { line, fx: { id: line.id, t: t.first_kickoff, home: { name: 'Múltipla' }, away: { name: `${t.n} jogos` }, league: { name: 'várias ligas' } }, btn: b });
    }
  });
  // registrou: a entrada aparece marcada
  $('#entryDlg')?.addEventListener('close', () => { if (plan) render(); });

  // as linhas possíveis de cada jogo para as pernas (as da aba Múltipla, com as asiáticas) e os jogos já no plano
  const optionsByGame = () => new Map(multiGames(scan.games, { now: 0 }).map(m => [m.fixtureId, m.options]));
  const usedGames = () => new Set([...plan.singles.map(x => x.g.fx.id), ...plan.sameGame.map(x => x.g.fx.id), ...plan.multis.flatMap(t => t.legs.map(l => l.fixtureId))]);
  // editou uma múltipla: refaz a conta, guarda o plano e a simulação dele
  async function editMulti(i, legs) {
    plan.multis[i] = multiOf(legs, banca);
    await save(`af:plan:${keyOf(sel.value)}`, planKeys(plan));
    await simPlan();
    render();
  }
  $('#planOut').addEventListener('change', e => {
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
      out.innerHTML = `<p class="muted">Ainda sem a análise desta janela. Escolha a janela — horas a partir de agora ou o dia inteiro — e toque em
        <b>Montar o plano</b>: o app analisa os jogos com odds da Pinnacle nela (o dia inteiro leva alguns minutos e usa o limite de requisições da
        varredura) e devolve só o plano.</p>`;
      return;
    }
    if (!scan.games.length) { out.innerHTML = `<p class="muted"><b>${esc(labelOf(scan))}</b>: nenhum jogo com odds da Pinnacle nesta janela${scan.window ? ' — escolha uma janela maior' : ''}.</p>`; return; }
    if (!plan) { out.innerHTML = '<p class="muted">Sem plano para esta varredura.</p>'; return; }
    const exp = exposedGames(), has = (id, h, a) => exp.has(id, h, a);
    const reg = (key, ok, t) => (ok ? '<span class="tag ok">✓ registrada</span>' : t <= Date.now() ? '<span class="tag mid">começou</span>'
      : `<button class="enter mini" data-pe="${key}" title="Registrar">➕</button>`);
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    // o que o plano rende se tudo der green: na odd da Pinnacle (o pior cenário; a casa pagando mais é bônus)
    const stake = [...plan.singles.map(x => [x.line.entry_brl || 0, x.line.pinnacle_odd]), ...plan.multis.map(t => [t.stake || t.stake_at_min || 0, ticketPin(t.legs)[0]]),
      ...plan.sameGame.map(x => [x.combo.entry_brl || 0, comboPin(x.combo, x.g)[0]])];
    const total = stake.reduce((s, [v]) => s + v, 0), pot = stake.reduce((s, [v, o]) => s + (o > 1 ? v * (o - 1) : 0), 0);
    const n = plan.singles.length, st = plan.stats, budgetOut = (scan.skipped || []).filter(s => /orçamento/.test(s.why || '')).length;
    const head = `<p class="muted"><b>${esc(labelOf(scan))}</b> · análise de ${when}: ${scan.analyzed} jogos analisados de ${scan.fixtures} ${scan.window ? 'na janela' : 'do dia'} · ${scan.requests} requisições.
      <b>${n} simples (${plan.singles.filter(x => x.lens !== 'agree').length} 🎯 nossa leitura · ${plan.singles.filter(x => x.lens === 'agree').length} 🤝 acordo com a Pinnacle)
      · ${plan.multis.length} múltipla${plan.multis.length === 1 ? '' : 's'} · ${plan.sameGame.length} no mesmo jogo</b> · entradas ${brl(total)}
      · <span class="pos">+${brl(pot)} se tudo green</span> <span class="muted">(na odd da Pinnacle)</span>${st ? ` · fora do plano: ${st.exposed ? `${st.exposed} jogo${st.exposed > 1 ? 's' : ''} que já têm entrada, ` : ''}${st.waiting} que dependem da escalação ("entrar se…")` : ''}.
      Toque numa entrada para ver o porquê dela.</p>
      ${budgetOut ? `<p class="neg">${budgetOut} jogos com odds ficaram fora da análise pelo limite de requisições (${scan.budget}): aumente o limite na seção de varredura e monte de novo.</p>` : ''}
      ${n < SINGLES[0] ? `<p class="muted">${scan.window ? 'A janela' : 'O dia'} rendeu ${n} simples — menos que 5: melhor poucas do que forçar entrada sem valor.</p>` : ''}`;
    // simples: as duas frentes; na 🎯 o valor é o nosso (conservador) na odd da Pinnacle; na 🤝 o valor está na casa pagar a mínima
    const lensTag = x => (x.lens === 'agree'
      ? '<span class="tag ok" title="o modelo e a Pinnacle concordam; linha consistente (histórico e contexto); o valor está na casa pagar a mínima">🤝 acordo</span>'
      : `<span class="tag mid" title="a nossa chance (modelo corrigido + cenário) acima da Pinnacle: valor contra ela">🎯 nossa leitura${x.line.contra ? ' · contra a Pinnacle' : ''}</span>`);
    const valueCell = x => (x.lens === 'agree'
      ? `<span class="muted" title="a casa precisa pagar a mínima: ${x.value > 0 ? `${(x.value * 100).toFixed(1).replace('.', ',')}% acima` : 'até'} da odd da Pinnacle">casa ≥ mínima${x.value > 0 ? ` (+${(x.value * 100).toFixed(1).replace('.', ',')}% Pin)` : ''}</span>`
      : `<span class="pos">+${(x.value * 100).toFixed(1).replace('.', ',')}%</span>`);
    const inSim = simUI.get(simIdOf()), sum = inSim && simReport(inSim).total, sg = x => `${x > 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}`;
    if (inSim?.bets.some(b => b.odd_src === 'mínima') && !refazendo) repriceSim();
    const simLine = inSim ? `<p class="simbar"><span class="muted">🧪 Este plano está na simulação: ${sum.n} entradas${sum.done
      ? ` · ${sum.done} encerrada${sum.done > 1 ? 's' : ''}${sum.open ? `, ${sum.open} em aberto` : ''} · <b class="${sum.profit_u > 0 ? 'pos' : sum.profit_u < 0 ? 'neg' : ''}">${sg(sum.profit_u)} u</b> · ${sum.profit_brl < 0 ? '−' : '+'}${brl(Math.abs(sum.profit_brl))}`
      : ' · nenhuma encerrada ainda'}</span> <button class="ghost mini" data-simgo="${esc(inSim.id)}">ver o resultado ↓</button></p>`
      : `<p class="simbar"><button class="ghost" id="planSimRun">🧪 Simular as propostas deste plano</button> <span class="muted">registra todas as entradas do plano,
        com a odd da Pinnacle da hora do plano, numa área separada das apostas reais</span></p>`;
    const singles = n ? `<h3>Simples (${n})</h3><div class="scroll"><table class="scanrank plantab"><tr><th></th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Frente</th><th>Entrada</th>
      <th>Odd mínima</th><th>Pinnacle</th><th>Nossa · Pinnacle</th><th>Valor</th><th>R$</th></tr>${plan.singles.map((x, i) => { const { g, line } = x; return `<tr data-go="pw-s${i}">
      <td>${reg(`s:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t)}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
      <td class="muted">${esc(g.fx.league.name)}</td><td>${lensTag(x)}</td><td title="${esc(line.why || (line.context ? `contexto ${line.context.verdict}; nível ${line.tier}` : ''))}"><span class="muted">${esc(SHORT[line.market] || line.market)}:</span> <b>${esc(line.line)}</b></td>
      <td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td><td><b>${pct(line.p_nossa ?? line.p_blend)}</b> <span class="muted">· ${pct(line.p_pinnacle)}</span></td>
      <td>${valueCell(x)}</td><td>${line.entry_brl ? `${line.entry_brl}` : '—'}</td></tr>`; }).join('')}</table></div>` : '';
    // múltiplas editáveis: trocar a linha da perna (1,5 · 1,75 · 2 · 2,25 · 2,5), tirar perna, pôr perna de outro jogo
    const opts = optionsByGame(), inPlan = usedGames();
    const legInfo = l => (l.asian ? `não perde ${pct(l.p)} (0–1 gol perde) · cheia ${pct(l.p_win)} (3+ gols)` : `acerta ${pct(l.p)}`);
    const legRow = (t, i, l, j) => `<tr><td>${hour(l.kickoff)}</td><td>${esc(l.home)} x ${esc(l.away)}</td>
      <td><select data-pml="${i}:${j}" title="2 gols: o 1,75 ganha metade, o 2 devolve, o 2,25 perde metade">${(opts.get(l.fixtureId) || [l]).map(o => `<option value="${esc(o.lineId)}"${o.lineId === l.lineId ? ' selected' : ''}>${esc(o.line)}${o.asian ? ' (asiática)' : o.quoted ? '' : ' (não cotada)'}</option>`).join('')}</select></td>
      <td class="muted">${legInfo(l)}</td><td>justa ${n2(l.fair)}</td><td><b>≥ ${n2(l.min)}</b></td>
      <td>${t.n > 2 ? `<button class="ghost mini" data-pmx="${i}:${j}" title="Tirar a perna">✕</button>` : ''}</td></tr>`;
    const addSel = i => { const free = [...opts.entries()].filter(([f]) => !inPlan.has(f)).map(([, os]) => os[0]).sort((a, b) => a.kickoff - b.kickoff);
      return free.length ? `<select data-pma="${i}"><option value="">➕ pôr uma perna…</option>${free.map(o => `<option value="${o.fixtureId}">${hour(o.kickoff)} ${esc(o.home)} x ${esc(o.away)} — ${esc(o.line)} · ${pct(o.p)}</option>`).join('')}</select>` : ''; };
    const multis = plan.multis.length ? `<h3>Múltiplas (${plan.multis.length})</h3>${plan.multis.map((t, i) => `<div class="multisum">
      <div>${reg(`m:${i}`, t.legs.every(l => has(l.fixtureId, l.home, l.away)), t.first_kickoff)} <b>Múltipla ${i + 1}</b> · ${t.n} pernas · ${t.asian ? 'não perde' : 'acerta todas'} em <b>${pct(t.p_all)}</b>
        ${t.asian ? `<span class="muted">(todas cheias ${pct(t.p_win_all)})</span> ` : ''}<span class="muted">(Pinnacle ${pct(t.p_pinnacle_all)})</span> · odd total mínima <b>${n2(t.min)}</b>
        <span class="muted">(justa ${n2(t.fair)}${t.odd ? `; na Pinnacle ${n2(t.odd)}` : ''})</span> · ${brl(t.stake || t.stake_at_min || 0)}
        <button class="ghost mini" data-go="pw-m${i}">por que cada perna ↓</button></div>
      <div class="scroll"><table class="mlegs">${t.legs.map((l, j) => legRow(t, i, l, j)).join('')}</table></div>
      <div>${addSel(i)}</div></div>`).join('')}` : '';
    const same = plan.sameGame.length ? `<h3>No mesmo jogo (${plan.sameGame.length})</h3><div class="scroll"><table class="scanrank plantab"><tr><th></th><th>Hora</th><th>Jogo</th><th>Liga</th>
      <th>Combo</th><th>Chance</th><th>Odd mínima</th><th>R$</th></tr>${plan.sameGame.map(({ g, combo }, i) => `<tr data-go="pw-c${i}">
      <td>${reg(`c:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t)}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
      <td class="muted">${esc(g.fx.league.name)}</td><td><b>${esc(combo.line)}</b></td><td><b>${pct(combo.p_blend)}</b> <span class="muted">· ${pct(combo.p_pinnacle)}</span></td>
      <td><b>${n2(combo.odd_min)}</b></td><td>${combo.entry_brl ? `${combo.entry_brl}` : '—'}</td></tr>`).join('')}</table></div>` : '';
    const empty = !n && !plan.multis.length && !plan.sameGame.length ? '<p class="muted">Nenhuma entrada passou nas regras do plano neste dia.</p>' : '';
    // o porquê de cada entrada (planwhy.js): o resumo, os motivos e os gráficos, na ordem do plano
    const card = (id, title, g, what, body, btn) => `<article class="scancard whycard" id="${id}">
      <div class="row head"><h3>${title}${g ? ` · ${hour(g.fx.t)} · ${esc(g.fx.home.name)} x ${esc(g.fx.away.name)} <span class="muted">${esc(g.fx.league.name)}</span>` : ''}</h3>
        <span>${btn} <button class="ghost mini" data-top title="Voltar ao resumo do plano">↑ plano</button></span></div>
      <p class="facts">${what}</p>${body}</article>`;
    const why = empty ? '' : `<h3>Por que cada entrada</h3>
      <p class="muted">O que pôs cada entrada no plano: o resumo, os motivos (<b class="pos">＋</b> a favor, <b class="neg">－</b> contra, · fato do jogo) e os
      gráficos — a chance por fonte contra a que a odd exige (a linha clara) e os últimos jogos de cada time na linha, como na varredura.</p>${chartLegend()}
      ${plan.singles.map((x, i) => card(`pw-s${i}`, `Simples ${i + 1}`, x.g, `${esc(SHORT[x.line.market] || x.line.market)}: <b>${esc(x.line.line)}</b> ${lensTag(x)}
        · odd mínima <b>${n2(x.line.odd_min)}</b> (Pinnacle ${n2(x.line.pinnacle_odd)})${x.line.entry_brl ? ` · R$ ${x.line.entry_brl}` : ''}`,
        singleBody(x.g, x), reg(`s:${i}`, has(x.g.fx.id, x.g.fx.home.name, x.g.fx.away.name), x.g.fx.t))).join('')}
      ${plan.multis.map((t, i) => card(`pw-m${i}`, `Múltipla ${i + 1}`, null, `${t.n} pernas · ${t.asian ? 'não perde' : 'acerta todas'} em <b>${pct(t.p_all)}</b>
        · odd total mínima <b>${n2(t.min)}</b> · ${brl(t.stake || t.stake_at_min || 0)}`,
        `<p class="muted small">Cada perna: a chance (a menor entre a nossa e a da mistura com a Pinnacle), o esperado de gols, o contexto e a linha nos
        últimos jogos dos dois times.</p>${legsBody(scan.games, t)}`, reg(`m:${i}`, t.legs.every(l => has(l.fixtureId, l.home, l.away)), t.first_kickoff))).join('')}
      ${plan.sameGame.map(({ g, combo }, i) => card(`pw-c${i}`, `Mesmo jogo ${i + 1}`, g, `Combo: <b>${esc(combo.line)}</b> · odd mínima <b>${n2(combo.odd_min)}</b>${combo.entry_brl ? ` · R$ ${combo.entry_brl}` : ''}`,
        comboBody(g, combo), reg(`c:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name), g.fx.t))).join('')}`;
    out.innerHTML = `${head}${empty ? '' : simLine}${singles}${multis}${same}${empty}
      <p class="muted small">Como o plano é montado: um jogo entra uma vez só; jogo que já tem entrada fica fora. <b>Simples em duas frentes</b>, alternando:
      <b>🎯 nossa leitura</b> — a nossa chance (modelo corrigido + cenário) acima da Pinnacle, com ela pagando de 1,80 a 2,70 e acima da nossa mínima,
      pelo valor conservador (a nossa chance encolhida pela metade na direção da dela); e <b>🤝 acordo com a Pinnacle</b> — linhas consistentes (âncora
      ou sólida, 60%+, histórico dos times e contexto que não é contra) em que o modelo não discorda dela: aí o valor está na casa pagar a mínima.
      No máximo 3 por liga. Fica fora o que depende da escalação — copa (rodízio), time de base/B, dúvida de desfalque, leitura longe da Pinnacle,
      amostra curta — e o jogo difícil de analisar. <b>Múltiplas</b>: over de gols com a linha cotada pela Pinnacle; dá para trocar a linha da perna
      (1,75, 2 e 2,25 perdem só com 0–1 gol, como o 1,5; com 2 gols o 1,75 ganha metade, o 2 devolve, o 2,25 perde metade), tirar e pôr perna.
      <b>No mesmo jogo</b>: os combos de maior chance. Aposte só se a casa pagar a <b>odd mínima</b>; o plano entra na 🧪 simulação para medirmos
      (inclusive o CLV: a odd da hora do plano contra a de fechamento) — o resultado fica no fim desta seção, em 🧪 Simulação dos planos.</p>${why}`;
    bindTooltips(out);
  }

  show();
}
