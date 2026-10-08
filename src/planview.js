// Plano do dia (plan.js) na tela: um botão, na noite anterior, analisa o dia seguinte inteiro (a varredura da data,
// guardada como a da seção de varredura) e mostra só o plano — 5 a 10 simples, 2 múltiplas e 5 no mesmo jogo —, cada
// entrada com a odd mínima, a da Pinnacle, a chance e a entrada em R$, e o ➕ para registrar. "Copiar o plano" leva a
// lista para apostar nas casas; o plano entra na 🧪 simulação para medirmos; o especialista recebe o plano.

import { scanDay } from './scanner.js';
import { load, save } from './store.js';
import { exposedGames } from './entry.js';
import { multiLine } from './multiple.js';
import { SINGLES, buildPlan, planFromKeys, planKeys, planText } from './plan.js';
import { buildPlanSim } from './sim.js';
import { bindSpecialist, briefPlan } from './brief.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const dm = d => d.split('-').reverse().slice(0, 2).join('/');
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const weekday = d => WEEK[new Date(`${d}T12:00:00`).getDay()];
const BUDGET_KEY = 'afScanBudget';
const SHORT = { 'Handicap asiático': 'Handicap', 'Total de gols': 'Gols', '1X2': '1X2' };
const brl = x => `R$ ${Math.round(x).toLocaleString('pt-BR')}`;

export function initPlan({ api, openEntry, banca }) {
  let scan = null, plan = null, busy = false;
  const sel = $('#planDate');
  sel.innerHTML = [[dayStr(1), 'Amanhã'], [dayStr(0), 'Hoje']].map(([v, t]) => `<option value="${v}">${t} (${weekday(v)}, ${dm(v)})</option>`).join('');
  const msg = (text, err = false) => { const el = $('#planMsg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('err', err); };

  // o plano da data: o guardado (as mesmas entradas, mesmo depois de registrar algumas) ou um novo da varredura
  async function show() {
    const d = sel.value;
    scan = await load(`af:scan:${d}`);
    plan = null;
    if (scan?.games && !scan.window) {
      const keys = await load(`af:plan:${d}`);
      if (keys?.scan_at === scan.generated_at) plan = planFromKeys(scan, keys, { banca });
      if (!plan) await makePlan();
    }
    render();
  }
  async function makePlan() {
    plan = buildPlan(scan, { exposed: exposedGames(), banca });
    await save(`af:plan:${sel.value}`, planKeys(plan));
    await simPlan();
  }
  // o plano entra na simulação (separada das apostas reais) — substitui o da mesma data enquanto nada foi liquidado
  async function simPlan() {
    const sim = buildPlanSim(plan, { banca });
    if (!sim.bets.length) return;
    const old = await api.loadDoc(`af:sim:${sim.id}`).catch(() => null);
    if (old?.bets?.some(b => b.status !== 'aberta')) return;
    const idx = (await api.loadDoc('af:simidx').catch(() => null)) || [];
    if (!idx.includes(sim.id)) await api.saveDoc('af:simidx', [sim.id, ...idx]);
    await api.saveDoc(`af:sim:${sim.id}`, sim);
    window.dispatchEvent(new CustomEvent('sims-changed'));
  }

  $('#planRun').onclick = async () => {
    if (busy) return;
    if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
    const d = sel.value, budget = Math.max(50, Number(localStorage.getItem(BUDGET_KEY)) || 1500);
    busy = true; $('#planRun').disabled = true;
    try {
      // o dia inteiro; sem o histórico dos escanteios do 1º tempo (o plano não usa) e guardando mais jogos por filtro
      scan = await scanDay(api.dossierApi, { date: d, budget, banca, top: 30, half: false, onProgress: t => msg(t) });
      await save(`af:scan:${d}`, scan);
      await makePlan();
      msg(scan.games.length ? '' : 'Nenhum jogo com odds da Pinnacle nesta data (ainda).');
      render();
    } catch (e) { msg(e.message, true); }
    busy = false; $('#planRun').disabled = false;
  };
  sel.onchange = show;

  $('#planCopy').onclick = async () => {
    if (!plan) return;
    const text = planText(plan, { dateLabel: `${weekday(plan.date)}, ${dm(plan.date)}` });
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

  function render() {
    const out = $('#planOut');
    $('#planCopy').hidden = $('#planSpec').hidden = !plan;
    if (!scan || scan.window) {
      out.innerHTML = `<p class="muted">Ainda sem a análise deste dia. Toque em <b>Montar o plano</b>: o app analisa todos os jogos do dia com odds da Pinnacle
        (leva alguns minutos e usa o limite de requisições da varredura) e devolve só o plano.</p>`;
      return;
    }
    if (!plan) { out.innerHTML = '<p class="muted">Sem plano para esta varredura.</p>'; return; }
    const exp = exposedGames(), has = (id, h, a) => exp.has(id, h, a);
    const reg = (key, ok) => (ok ? '<span class="tag ok">✓ registrada</span>' : `<button class="enter mini" data-pe="${key}" title="Registrar">➕</button>`);
    const when = new Date(scan.generated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const stake = [...plan.singles.map(x => [x.line.entry_brl || 0, x.line.pinnacle_odd]), ...plan.multis.map(t => [t.stake || t.stake_at_min || 0, t.odd]),
      ...plan.sameGame.map(x => [x.combo.entry_brl || 0, x.combo.odd_min])];
    const total = stake.reduce((s, [v]) => s + v, 0), pot = stake.reduce((s, [v, o]) => s + v * (o - 1), 0);
    const n = plan.singles.length, st = plan.stats, budgetOut = (scan.skipped || []).filter(s => /orçamento/.test(s.why || '')).length;
    const head = `<p class="muted">Análise de ${when}: ${scan.analyzed} jogos analisados de ${scan.fixtures} do dia · ${scan.requests} requisições.
      <b>${n} simples · ${plan.multis.length} múltipla${plan.multis.length === 1 ? '' : 's'} · ${plan.sameGame.length} no mesmo jogo</b> · entradas ${brl(total)}
      · <span class="pos">+${brl(pot)} se tudo green</span>${st ? ` · fora do plano: ${st.exposed ? `${st.exposed} jogo${st.exposed > 1 ? 's' : ''} que já têm entrada, ` : ''}${st.waiting} que dependem da escalação ("entrar se…")` : ''}.</p>
      ${budgetOut ? `<p class="neg">${budgetOut} jogos com odds ficaram fora da análise pelo limite de requisições (${scan.budget}): aumente o limite na seção de varredura e monte de novo.</p>` : ''}
      ${n < SINGLES[0] ? `<p class="muted">O dia rendeu ${n} simples pela nossa análise — menos que 5: melhor poucas do que forçar entrada sem valor.</p>` : ''}`;
    const singles = n ? `<h3>Simples (${n})</h3><div class="scroll"><table class="scanrank plantab"><tr><th></th><th>Hora</th><th>Jogo</th><th>Liga</th><th>Entrada</th>
      <th>Odd mínima</th><th>Pinnacle</th><th>Nossa · Pinnacle</th><th>Valor</th><th>R$</th></tr>${plan.singles.map(({ g, line, value }, i) => `<tr>
      <td>${reg(`s:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name))}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
      <td class="muted">${esc(g.fx.league.name)}</td><td title="${esc(line.why || '')}"><span class="muted">${esc(SHORT[line.market] || line.market)}:</span> <b>${esc(line.line)}</b>${line.contra ? ' <span class="tag mid" title="a nossa chance 5 pp ou mais acima da Pinnacle">contra a Pinnacle</span>' : ''}</td>
      <td><b>${n2(line.odd_min)}</b></td><td>${n2(line.pinnacle_odd)}</td><td><b>${pct(line.p_nossa)}</b> <span class="muted">· ${pct(line.p_pinnacle)}</span></td>
      <td class="pos">+${(value * 100).toFixed(1).replace('.', ',')}%</td><td>${line.entry_brl ? `${line.entry_brl}` : '—'}</td></tr>`).join('')}</table></div>` : '';
    const multis = plan.multis.length ? `<h3>Múltiplas (${plan.multis.length})</h3>${plan.multis.map((t, i) => `<div class="multisum">
      <div>${reg(`m:${i}`, t.legs.every(l => has(l.fixtureId, l.home, l.away)))} <b>Múltipla ${i + 1}</b> · ${t.n} pernas · acerta todas em <b>${pct(t.p_all)}</b>
        <span class="muted">(Pinnacle ${pct(t.p_pinnacle_all)})</span> · odd total mínima <b>${n2(t.min)}</b> <span class="muted">(justa ${n2(t.fair)}; na Pinnacle ${n2(t.odd)})</span>
        · ${brl(t.stake || t.stake_at_min || 0)}</div>
      <div class="muted">${t.legs.map(l => `${hour(l.kickoff)} ${esc(l.home)} x ${esc(l.away)} — ${esc(l.line)} (≥ ${n2(l.min)})`).join(' · ')}</div></div>`).join('')}` : '';
    const same = plan.sameGame.length ? `<h3>No mesmo jogo (${plan.sameGame.length})</h3><div class="scroll"><table class="scanrank plantab"><tr><th></th><th>Hora</th><th>Jogo</th><th>Liga</th>
      <th>Combo</th><th>Chance</th><th>Odd mínima</th><th>R$</th></tr>${plan.sameGame.map(({ g, combo }, i) => `<tr>
      <td>${reg(`c:${i}`, has(g.fx.id, g.fx.home.name, g.fx.away.name))}</td><td>${hour(g.fx.t)}</td><td>${esc(g.fx.home.name)} x ${esc(g.fx.away.name)}</td>
      <td class="muted">${esc(g.fx.league.name)}</td><td><b>${esc(combo.line)}</b></td><td><b>${pct(combo.p_blend)}</b> <span class="muted">· ${pct(combo.p_pinnacle)}</span></td>
      <td><b>${n2(combo.odd_min)}</b></td><td>${combo.entry_brl ? `${combo.entry_brl}` : '—'}</td></tr>`).join('')}</table></div>` : '';
    const empty = !n && !plan.multis.length && !plan.sameGame.length ? '<p class="muted">Nenhuma entrada passou nas regras do plano neste dia.</p>' : '';
    out.innerHTML = `${head}${singles}${multis}${same}${empty}
      <p class="muted small">Como o plano é montado: um jogo entra uma vez só; jogo que já tem entrada fica fora. Simples: as apostas da nossa análise com a
      Pinnacle pagando de 1,80 a 2,70 e acima da nossa mínima, pelo valor conservador (a nossa chance encolhida pela metade na direção da Pinnacle, na odd
      dela), no máximo 3 por liga. Fica fora o que depende da escalação — à noite ela ainda não saiu: copa (rodízio), time de base/B, dúvida de desfalque,
      leitura longe da Pinnacle, amostra curta — e o jogo difícil de analisar. Múltiplas: over de gols com a linha cotada pela Pinnacle, as melhores pernas
      no primeiro bilhete. No mesmo jogo: os combos de maior chance. Aposte só se a casa pagar a <b>odd mínima</b>; o plano entra na 🧪 simulação para
      medirmos (inclusive o CLV: a odd da noite contra a de fechamento).</p>`;
  }

  show();
}
