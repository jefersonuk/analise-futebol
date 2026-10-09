// O painel da 🧪 simulação (sim.js) numa tela: as simulações guardadas (af:sim:<id>; índice af:simidx, a mais nova
// primeiro) que a tela mostra, cada uma com o resultado por lente, as entradas e a conferência dos resultados — sozinha
// ao abrir e a cada 15 min com a página aberta. Duas telas usam: a varredura (as simulações das varreduras, id = a hora
// da varredura) e o Plano do dia (as dos planos, id plano-…). Nada daqui vai para o app de apostas.

import { settleSim, simReport } from './sim.js';

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
  'mínima': ['mín.', 'a odd mínima do app (simulada antes da regra: na odd da Pinnacle)'] };
const IDX = 'af:simidx', DOC = id => `af:sim:${id}`;
// algum jogo da simulação já deve ter terminado e ela ainda tem entrada aberta
const due = sim => sim.bets.some(b => b.status === 'aberta' && Date.now() > b.kickoff + 110 * 60e3);
// avisa as outras telas que o índice mudou (from: quem mudou, que não precisa recarregar)
const changed = from => window.dispatchEvent(new CustomEvent('sims-changed', { detail: from }));

// el: onde o painel aparece; mine(id): as simulações desta tela; title/intro: o cabeçalho; cat(c): o nome da lente na
// tabela; onChange: a tela redesenha o que depende de estar ou não na simulação (o botão de simular).
export function simPanel({ api, el, mine, title, intro, cat = c => c, onChange = () => {} }) {
  const st = { ids: [], list: new Map(), busy: false, msg: '' }, me = Symbol('painel');
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
    const row = (name, s, strong = false) => `<tr${strong ? ' class="on"' : ''}><td>${strong ? `<b>${esc(name)}</b>` : esc(name)}</td><td>${s.n}</td><td>${s.green} · ${s.void} · ${s.red}</td>
      <td class="muted">${s.open}</td><td class="${cls(s.profit_u)}"><b>${sg(s.profit_u)}</b></td><td class="${cls(s.yield)}">${pc(s.yield)}</td>
      <td class="${cls(s.profit_brl)}">${s.done ? `R$ ${sg(s.profit_brl, 0)}` : '—'}</td><td class="${cls(s.clv)}">${pc(s.clv)}${s.clv_n ? ` <span class="muted">(${s.clv_n})</span>` : ''}</td></tr>`;
    const cards = list.slice(0, 10).map(sim => {
      const rep = simReport(sim), t = rep.total, cond = sim.bets.some(b => b.cat === 'nossa análise: entrar se…');
      const old = sim.bets.filter(b => b.odd_src === 'mínima').length;
      const when = new Date(sim.scan_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const bets = [...sim.bets].sort((a, b) => a.kickoff - b.kickoff).map(b => `<tr class="${b.status === 'aberta' ? 'weak' : ''}"><td>${hour(b.kickoff)}</td>
        <td>${esc(b.home)}${b.away ? ` x ${esc(b.away)}` : ''}</td><td class="muted">${esc(cat(b.cat))}</td><td>${esc(b.line)}</td>
        <td>${n2(b.odd)} <span class="muted" title="${esc((SRC[b.odd_src] || SRC['mínima'])[1])}">${(SRC[b.odd_src] || SRC['mínima'])[0]}</span></td><td>${pct(b.p)}</td>
        <td title="${esc(b.detail || '')}">${b.status === 'aberta' ? `<span class="muted">${esc(b.detail || 'aberta')}</span>` : `${RES[b.winner]} <span class="muted">${esc(b.detail || '')}</span>`}</td>
        <td class="${cls(b.profit_u)}">${b.profit_u == null ? '' : sg(b.profit_u)}</td><td class="${cls(b.profit_brl)}">${b.profit_brl == null ? '' : sg(b.profit_brl, 0)}</td></tr>`).join('');
      return `<div class="simcard" id="sim-${esc(sim.id)}"><div><b>${sim.plan ? `📋 Plano ${esc(sim.label || sim.date.split('-').reverse().slice(0, 2).join('/'))}` : `Varredura de ${when}`}</b> · ${t.n} entradas · ${t.done} encerradas${t.open ? `, ${t.open} em aberto` : ''} ·
        <b class="${cls(t.profit_u)}">${sg(t.profit_u)} u</b> (yield ${pc(t.yield)}) · <span class="${cls(t.profit_brl)}">R$ ${sg(t.profit_brl, 0)}</span>
        ${t.clv != null ? ` · CLV médio ${pc(t.clv)}` : ''}
        <button class="ghost mini" data-simcheck="${esc(sim.id)}"${st.busy ? ' disabled' : ''}>🔄 Conferir resultados</button>
        <button class="ghost mini" data-simdel="${esc(sim.id)}">apagar</button>
        ${sim.checked_at ? `<span class="muted"> · conferida às ${hour(Date.parse(sim.checked_at))}</span>` : ''}
        ${old ? `<div class="neg small">⚠️ ${old} entrada${old > 1 ? 's' : ''} na odd mínima do app (simulada${old > 1 ? 's' : ''} antes da regra do pior cenário): o resultado delas é otimista</div>` : ''}</div>
        <div class="scroll"><table class="scanrank simtab"><tr><th>Lente</th><th>Entradas</th><th>✓ · ↩ · ✗</th><th>Abertas</th><th>Lucro (u)</th><th>Yield</th><th>Lucro R$</th><th>CLV</th></tr>
          ${rep.cats.map(([c, s]) => row(cat(c), s)).join('')}${row(sim.plan ? 'Total' : 'Total (sem repetir a mesma linha)', t, true)}${cond ? row('Total sem as "entrar se…"', rep.confirmed, true) : ''}</table></div>
        <details><summary>As ${sim.bets.length} entradas</summary><div class="scroll"><table class="scanrank simtab"><tr><th>Hora</th><th>Jogo</th><th>Lente</th><th>Linha</th><th>Odd</th><th>Chance</th><th>Resultado</th><th>u</th><th>R$</th></tr>${bets}</table></div></details></div>`;
    }).join('');
    el.innerHTML = `<details class="sims" open><summary>${esc(title)} (${list.length}) — fora do app de apostas</summary>
      <p class="muted">${intro}</p>${st.msg ? `<p class="muted">${esc(st.msg)}</p>` : ''}${cards}</details>`;
  }
  el.addEventListener('click', async e => {
    const c = e.target.closest('[data-simcheck]');
    if (c) { check(c.dataset.simcheck); return; }
    const d = e.target.closest('[data-simdel]');
    if (d && confirm('Apagar esta simulação?')) remove(d.dataset.simdel);
  });
  // a outra tela gravou ou apagou uma simulação: recarrega
  window.addEventListener('sims-changed', e => { if (e.detail !== me) load(true); });
  const next = () => st.ids.map(id => st.list.get(id)).find(x => x && due(x) && Date.now() - Date.parse(x.checked_at || 0) > 14 * 60e3);
  load().then(() => { const s = next(); if (s) check(s.id, true); });
  // com a página aberta: confere sozinha a cada 15 min o que já deve ter terminado
  setInterval(() => { const s = next(); if (s) check(s.id, true); }, 15 * 60e3)?.unref?.();   // unref: nos testes (Node) não segura o processo
  return { add, remove, has: id => st.ids.includes(id), get: id => (st.ids.includes(id) ? st.list.get(id) : null),
    say: text => { st.msg = text; render(); } };
}
