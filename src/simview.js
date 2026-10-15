// O painel da 🧪 simulação (sim.js) numa tela: as simulações guardadas (af:sim:<id>; índice af:simidx, a mais nova
// primeiro) que a tela mostra, cada uma com o resultado por lente, as entradas e a conferência dos resultados — sozinha
// ao abrir e a cada 15 min com a página aberta. Duas telas usam: a varredura (as simulações das varreduras, id = a hora
// da varredura) e o Plano do dia (as dos planos, id plano-…). A simulação em si nunca vai para o app de apostas; em cada
// entrada ainda aberta, o ➕ registra lá a aposta de verdade (pedido do Jeferson, 15/10/2026: "a opção de entrar nos jogos
// da simulação em que porventura não entrei, com as opções sobressalentes desses jogos") e o 🔎 mostra as outras linhas
// do jogo (otherlines.js) — as duas pela análise do jogo nas varreduras guardadas (scanfind.js), sem gastar requisição.

import { settleSim, simReport } from './sim.js';
import { CUR_SYMBOL, money } from './stake.js';
import { exposedGames } from './entry.js';
import { findGame, findLegs } from './scanfind.js';
import { lineOfBet, multiOf, simLine } from './plan.js';
import { multiLine } from './multiple.js';
import { bindOthers, othersHtml } from './otherlines.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => `${Math.round(x * 100)}%`;
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const sg = (x, d = 2) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d).replace('.', ',')}`);
const pc = x => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`);
const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : 'muted');
const RES = { A: '✅', HW: '½✅', VOID: '↩', HL: '½❌', RED: '❌' };
// de onde veio a odd de entrada: a da Pinnacle, a que ela pagaria (onde não cota a aposta) ou, nas simulações de antes
// da regra do pior cenário, a odd mínima do app
const SRC = { pinnacle: ['Pin', 'a odd da Pinnacle na hora'], 'pinnacle est.': ['Pin est.', 'a odd que a Pinnacle pagaria: a justa pelas chances dela, com a margem dela'],
  'modelo est.': ['mod. est.', 'sem a Pinnacle (chutes): a justa do nosso modelo com a margem de uma casa (5%)'],
  'mínima': ['mín.', 'a odd mínima do app (simulada antes da regra: na odd da Pinnacle)'] };
const IDX = 'af:simidx', DOC = id => `af:sim:${id}`;
// algum jogo da simulação já deve ter terminado e ela ainda tem entrada aberta
const due = sim => sim.bets.some(b => b.status === 'aberta' && Date.now() > b.kickoff + 110 * 60e3);
// avisa as outras telas que o índice mudou (from: quem mudou, que não precisa recarregar)
const changed = from => window.dispatchEvent(new CustomEvent('sims-changed', { detail: from }));

// el: onde o painel aparece; mine(id): as simulações desta tela; title/intro: o cabeçalho; cat(c): o nome da lente na
// tabela; onChange: a tela redesenha o que depende de estar ou não na simulação (o botão de simular); tools: { openEntry,
// analyzeFixture, banca } para o ➕ e o 🔎 de cada entrada (sem tools, a tabela fica só de leitura).
export function simPanel({ api, el, mine, title, intro, cat = c => c, onChange = () => {}, tools = null }) {
  const st = { ids: [], list: new Map(), busy: false, msg: '', open: new Set() }, me = Symbol('painel');
  const games = new Map();   // fixtureId -> o jogo da varredura guardada (ou null), achado uma vez
  const gameOf = async (sim, id) => { if (!games.has(id)) games.set(id, await findGame(id, sim.scan_at)); return games.get(id); };
  // a entrada já tem aposta de verdade no jogo (no bilhete, em todos os jogos)
  const isIn = (exp, b) => (b.legs ? b.legs.every(l => exp.has(l.fixtureId, l.home, l.away)) : exp.has(b.fixtureId, b.home, b.away));
  const IN_TAG = '<span class="tag ok" title="já tem aposta neste jogo no app de apostas">✓</span>';
  const readIdx = async () => (await api.loadDoc(IDX).catch(() => null)) || [];
  async function load(force = false) {
    st.ids = (await readIdx()).filter(mine);
    for (const id of st.ids) if (force || !st.list.has(id)) { const x = await api.loadDoc(DOC(id)).catch(() => null); if (x) st.list.set(id, x); }
    render(); onChange();
  }
  // grava uma simulação (a primeira da lista); drop(old): as desta tela que ela substitui
  async function add(sim, drop = null) {
    const keep = [];
    for (const id of await readIdx()) {
      if (id === sim.id) continue;
      const old = drop && mine(id) ? st.list.get(id) || await api.loadDoc(DOC(id)).catch(() => null) : null;
      if (old && drop(old)) { st.list.delete(id); await api.removeDoc(DOC(id)).catch(() => {}); } else keep.push(id);
    }
    await api.saveDoc(IDX, [sim.id, ...keep]);
    await api.saveDoc(DOC(sim.id), sim);
    st.list.set(sim.id, sim);
    st.ids = [sim.id, ...keep].filter(mine);
    render(); onChange(); changed(me);
    if (due(sim)) check(sim.id, true);   // refeita depois dos jogos: confere já
  }
  async function remove(id) {
    await api.saveDoc(IDX, (await readIdx()).filter(x => x !== id));
    await api.removeDoc(DOC(id)).catch(() => {});
    st.list.delete(id); st.ids = st.ids.filter(x => x !== id);
    render(); onChange(); changed(me);
  }
  async function check(id, auto = false) {
    const sim = st.list.get(id);
    if (!sim || st.busy) return;
    st.busy = true; st.msg = 'Conferindo os resultados…'; render();
    try {
      const { simIO } = await import('./settlement.js');
      const r = await settleSim(sim, simIO);
      await api.saveDoc(DOC(sim.id), sim);
      st.msg = r.settled ? `${r.settled} entrada${r.settled > 1 ? 's' : ''} liquidada${r.settled > 1 ? 's' : ''}; ${r.pending} em aberto.` : auto ? '' : `Nada novo: ${r.pending} em aberto.`;
    } catch (e) { st.msg = `Conferência: ${e.message}`; }
    st.busy = false; render();
  }
  function render() {
    const list = st.ids.map(id => st.list.get(id)).filter(Boolean);
    if (!list.length) { el.innerHTML = st.msg ? `<p class="muted">${esc(st.msg)}</p>` : ''; return; }
    // dinheiro na moeda da simulação (sim.cur; sem ela, R$ — as de antes da entrada padrão de 10 €), com sinal
    const cash = (x, cur) => (x == null ? '' : `${x > 0 ? '+' : ''}${money(x, cur, cur === 'BRL' ? 0 : 2)}`);
    const row = (name, s, cur, strong = false) => `<tr${strong ? ' class="on"' : ''}><td>${strong ? `<b>${esc(name)}</b>` : esc(name)}</td><td>${s.n}</td><td>${s.green} · ${s.void} · ${s.red}</td>
      <td class="muted">${s.open}</td><td class="${cls(s.profit_u)}"><b>${sg(s.profit_u)}</b></td><td class="${cls(s.yield)}">${pc(s.yield)}</td>
      <td class="${cls(s.profit_brl)}">${s.done ? cash(s.profit_brl, cur) : '—'}</td><td class="${cls(s.clv)}">${pc(s.clv)}${s.clv_n ? ` <span class="muted">(${s.clv_n})</span>` : ''}</td></tr>`;
    const exp = tools ? exposedGames() : null;
    // ➕ (entrada aberta, sem aposta de verdade no jogo) e 🔎 (as outras linhas do jogo; não no bilhete de vários jogos)
    const acts = (sim, b, i) => (!tools ? '' : `<td class="acts">${b.status !== 'aberta' ? '' : isIn(exp, b) ? IN_TAG
      : `<button class="enter mini" data-simadd="${esc(sim.id)}|${i}" title="${b.kickoff <= Date.now() ? 'O jogo já começou. ' : ''}Registrar no app de apostas">➕</button>`}
      ${b.legs ? '' : `<button class="ghost mini" data-simoth="${esc(sim.id)}|${i}" title="Outras linhas deste jogo">🔎</button>`}</td>`);
    const cards = list.slice(0, 10).map(sim => {
      const rep = simReport(sim), t = rep.total, cond = sim.bets.some(b => b.cat === 'nossa análise: entrar se…'), cur = sim.cur || 'BRL', sym = CUR_SYMBOL[cur] || cur;
      const old = sim.bets.filter(b => b.odd_src === 'mínima').length;
      const when = new Date(sim.scan_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const bets = sim.bets.map((b, i) => [b, i]).sort(([a], [b]) => a.kickoff - b.kickoff).map(([b, i]) => `<tr class="${b.status === 'aberta' ? 'weak' : ''}">${acts(sim, b, i)}<td>${hour(b.kickoff)}</td>
        <td>${esc(b.home)}${b.away ? ` x ${esc(b.away)}` : ''}</td><td class="muted">${esc(cat(b.cat))}</td><td>${esc(b.line)}</td>
        <td>${n2(b.odd)} <span class="muted" title="${esc((SRC[b.odd_src] || SRC['mínima'])[1])}">${(SRC[b.odd_src] || SRC['mínima'])[0]}</span></td><td>${pct(b.p)}</td>
        <td title="${esc(b.detail || '')}">${b.status === 'aberta' ? `<span class="muted">${esc(b.detail || 'aberta')}</span>` : `${RES[b.winner]} <span class="muted">${esc(b.detail || '')}</span>`}</td>
        <td class="${cls(b.profit_u)}">${b.profit_u == null ? '' : sg(b.profit_u)}</td><td class="${cls(b.profit_brl)}">${cash(b.profit_brl, cur)}</td></tr>`).join('');
      return `<div class="simcard" id="sim-${esc(sim.id)}"><div><b>${sim.plan ? `📋 Plano ${esc(sim.label || sim.date.split('-').reverse().slice(0, 2).join('/'))}` : `Varredura de ${when}`}</b> · ${t.n} entradas · ${t.done} encerradas${t.open ? `, ${t.open} em aberto` : ''} ·
        <b class="${cls(t.profit_u)}">${sg(t.profit_u)} u</b> (yield ${pc(t.yield)}) · <span class="${cls(t.profit_brl)}">${t.done ? cash(t.profit_brl, cur) : money(0, cur)}</span>
        ${t.clv != null ? ` · CLV médio ${pc(t.clv)}` : ''}
        <button class="ghost mini" data-simcheck="${esc(sim.id)}"${st.busy ? ' disabled' : ''}>🔄 Conferir resultados</button>
        <button class="ghost mini" data-simdel="${esc(sim.id)}">apagar</button>
        ${sim.checked_at ? `<span class="muted"> · conferida às ${hour(Date.parse(sim.checked_at))}</span>` : ''}
        ${old ? `<div class="neg small">⚠️ ${old} entrada${old > 1 ? 's' : ''} na odd mínima do app (simulada${old > 1 ? 's' : ''} antes da regra do pior cenário): o resultado delas é otimista</div>` : ''}</div>
        <div class="scroll"><table class="scanrank simtab"><tr><th>Lente</th><th>Entradas</th><th>✓ · ↩ · ✗</th><th>Abertas</th><th>Lucro (u)</th><th>Yield</th><th>Lucro ${sym}</th><th>CLV</th></tr>
          ${rep.cats.map(([c, s]) => row(cat(c), s, cur)).join('')}${row(sim.plan ? 'Total' : 'Total (sem repetir a mesma linha)', t, cur, true)}${cond ? row('Total sem as "entrar se…"', rep.confirmed, cur, true) : ''}</table></div>
        <details data-simlist="${esc(sim.id)}"${st.open.has(sim.id) ? ' open' : ''}><summary>As ${sim.bets.length} entradas${tools && t.open ? ' <span class="muted">· ➕ registra no app de apostas a que você não fez; 🔎 as outras linhas do jogo</span>' : ''}</summary>
          <div class="scroll"><table class="scanrank simtab"><tr>${tools ? '<th></th>' : ''}<th>Hora</th><th>Jogo</th><th>Lente</th><th>Linha</th><th>Odd</th><th>Chance</th><th>Resultado</th><th>u</th><th>${sym}</th></tr>${bets}</table></div></details></div>`;
    }).join('');
    el.innerHTML = `<details class="sims" open><summary>${esc(title)} (${list.length}) — fora do app de apostas</summary>
      <p class="muted">${intro}</p>${st.msg ? `<p class="muted">${esc(st.msg)}</p>` : ''}${cards}</details>`;
  }
  el.addEventListener('click', async e => {
    const c = e.target.closest('[data-simcheck]');
    if (c) { check(c.dataset.simcheck); return; }
    const d = e.target.closest('[data-simdel]');
    if (d && confirm('Apagar esta simulação?')) { remove(d.dataset.simdel); return; }
    const add = e.target.closest('[data-simadd]'), oth = e.target.closest('[data-simoth]');
    if (!tools || !(add || oth)) return;
    const [id, i] = (add || oth).dataset[add ? 'simadd' : 'simoth'].split('|'), sim = st.list.get(id), b = sim?.bets[Number(i)];
    if (b) (add ? enter : others)(sim, b, add || oth);
  });
  // a lista de entradas aberta continua aberta quando o painel é redesenhado
  el.addEventListener('toggle', e => { const d = e.target.closest?.('details[data-simlist]'); if (d) st.open[d.open ? 'add' : 'delete'](d.dataset.simlist); }, true);

  // ➕: a linha como o plano a montou, da análise guardada; sem ela, com o que a simulação tem (simLine). O bilhete de
  // vários jogos precisa das pernas guardadas (as odds mínimas e as chances de cada uma).
  async function enter(sim, b, btn) {
    btn.disabled = true;
    try {
      if (b.legs) {
        const legs = await findLegs(b.legs, sim.scan_at);
        if (!legs) { btn.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'sem a análise guardada: use ✍️ Aposta manual' })); return; }
        const t = multiOf(legs, tools.banca), line = multiLine(t);
        tools.openEntry(line.id, t.min, { line, fx: { id: line.id, t: t.first_kickoff, home: { name: 'Múltipla' }, away: { name: `${t.n} jogos` }, league: { name: 'várias ligas' } }, btn });
        return;
      }
      const g = await gameOf(sim, b.fixtureId), line = (g && lineOfBet(g, b, tools.banca)) || simLine(b);
      tools.openEntry(b.lineId, null, { line, fx: g?.fx || { id: b.fixtureId, t: b.kickoff, home: { name: b.home }, away: { name: b.away }, league: { name: b.competition } }, btn });
    } finally { btn.disabled = false; }
  }
  // 🔎: abre (ou fecha) embaixo da entrada as outras linhas do jogo; sem a análise guardada, a análise completa (🔬)
  async function others(sim, b, btn) {
    const tr = btn.closest('tr'), next = tr.nextElementSibling;
    if (next?.classList.contains('othrow')) { next.remove(); return; }
    btn.disabled = true;
    const g = await gameOf(sim, b.fixtureId);
    btn.disabled = false;
    tr.insertAdjacentHTML('afterend', `<tr class="othrow"><td colspan="${tr.children.length}">${g ? `<div class="othbody">${othersHtml(g)}</div>`
      : '<p class="muted small">A análise deste jogo não está mais guardada neste aparelho.</p>'}
      ${tools.analyzeFixture ? `<button class="ghost mini" data-full="${b.fixtureId}" title="Abre a análise completa do jogo (todas as linhas) na aba Jogo">🔬 Análise completa do jogo</button>` : ''}</td></tr>`);
  }
  if (tools) {
    bindOthers(el, { getGame: id => games.get(id) || null, openEntry: tools.openEntry, analyzeFixture: tools.analyzeFixture, api });
    // registrou: a entrada aparece marcada (sem redesenhar o painel, que fecharia as outras linhas abertas)
    globalThis.document?.querySelector('#entryDlg')?.addEventListener('close', () => {
      const exp = exposedGames();
      for (const btn of el.querySelectorAll('[data-simadd]')) {
        const [id, i] = btn.dataset.simadd.split('|'), b = st.list.get(id)?.bets[Number(i)];
        if (b && isIn(exp, b)) btn.outerHTML = IN_TAG;
      }
    });
  }
  // a outra tela gravou ou apagou uma simulação: recarrega
  window.addEventListener('sims-changed', e => { if (e.detail !== me) load(true); });
  const next = () => st.ids.map(id => st.list.get(id)).find(x => x && due(x) && Date.now() - Date.parse(x.checked_at || 0) > 14 * 60e3);
  load().then(() => { const s = next(); if (s) check(s.id, true); });
  // com a página aberta: confere sozinha a cada 15 min o que já deve ter terminado
  setInterval(() => { const s = next(); if (s) check(s.id, true); }, 15 * 60e3)?.unref?.();   // unref: nos testes (Node) não segura o processo
  return { add, remove, has: id => st.ids.includes(id), get: id => (st.ids.includes(id) ? st.list.get(id) : null),
    say: text => { st.msg = text; render(); } };
}
