import * as api from './api.js';
import { MARKETS, analyze, ev, fairOdd, politicaE } from './model.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1) + '%';
const num = (x, d = 2) => x.toFixed(d);

const state = { teams: {}, games: { home: [], away: [] }, off: new Set(), odds: new Map(), result: null, market: 'Todos' };

function msg(text, err = false) {
  const el = $('#msg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', err);
}
function showQuota() {
  $('#quota').textContent = api.remaining != null ? `${api.remaining} requisições restantes hoje` : '';
}

// ---- chave ----
$('#btnKey').onclick = () => { $('#keyBox').hidden = !$('#keyBox').hidden; };
$('#btnSaveKey').onclick = () => {
  api.setKey($('#keyInput').value);
  $('#keyInput').value = '';
  $('#keyBox').hidden = true;
  msg('');
};
if (!api.getKey()) $('#keyBox').hidden = false;

// ---- escolha dos times ----
for (const box of document.querySelectorAll('.picker')) {
  const side = box.dataset.side, input = box.querySelector('input'), sel = box.querySelector('select');
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 3) return msg('Digite ao menos 3 letras do nome do time.', true);
    if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
    msg('Buscando…');
    try {
      const list = await api.searchTeams(q);
      showQuota();
      if (!list.length) return msg(`Nenhum time encontrado para "${q}".`, true);
      sel.innerHTML = list.map(t => `<option value="${t.id}">${esc(t.name)} — ${esc(t.country || '')}</option>`).join('');
      sel.hidden = false;
      sel.onchange = () => { state.teams[side] = list.find(t => t.id === Number(sel.value)); };
      sel.onchange();
      msg('');
    } catch (e) { msg(e.message, true); }
  };
  box.querySelector('.search').onclick = search;
  input.onkeydown = e => { if (e.key === 'Enter') search(); };
  input.oninput = () => { delete state.teams[side]; sel.hidden = true; };
}

// ---- análise ----
$('#btnRun').onclick = async () => {
  const { home, away } = state.teams;
  if (!home || !away) return msg('Busque e selecione os dois times.', true);
  const n = Number($('#nGames').value);
  $('#btnRun').disabled = true;
  msg('Baixando os últimos jogos…');
  try {
    [state.games.home, state.games.away] = await Promise.all([api.lastGames(home.id, n), api.lastGames(away.id, n)]);
    showQuota();
    state.off.clear();
    state.odds.clear();
    msg('');
    compute();
  } catch (e) { msg(e.message, true); }
  $('#btnRun').disabled = false;
};

function compute() {
  const on = side => state.games[side].filter(g => !state.off.has(`${side}:${g.id}`));
  state.result = analyze(on('home'), on('away'));
  $('#out').hidden = false;
  renderExpect();
  renderChips();
  renderLines();
  renderRank();
  renderGames();
  if (!state.result.exp.goals) msg('Menos de 3 jogos válidos para um dos times: amostra insuficiente.', true);
}

function renderExpect() {
  const { exp, phi } = state.result;
  $('#expect').innerHTML = Object.entries(MARKETS).map(([k, name]) => {
    const e = exp[k];
    if (!e) return `<div class="stat"><small>${name}</small><b>—</b><small>sem estatística</small></div>`;
    const se = Math.hypot(e.seH, e.seA);
    return `<div class="stat"><small>${name} esperados</small><b>${num(e.h + e.a)}</b>
      <small>casa ${num(e.h)} · fora ${num(e.a)}</small>
      <small>± ${num(se)} · ${e.n} jogos${k !== 'goals' ? ` · dispersão ${num(phi[k], 1)}` : ''}</small></div>`;
  }).join('');
}

function renderChips() {
  const names = ['Todos', ...new Set(state.result.lines.map(l => l.market))];
  $('#chips').innerHTML = names.map(m => `<button class="${m === state.market ? 'on' : ''}">${m}</button>`).join('');
  for (const b of $('#chips').children) b.onclick = () => { state.market = b.textContent; renderChips(); renderLines(); };
}

function evCells(line) {
  const odd = state.odds.get(line.id);
  if (!odd) return '<td>—</td><td>—</td><td></td>';
  const e = ev(line, odd), pe = politicaE(odd);
  const cls = v => (v > 0 ? 'pos' : 'neg');
  const tag = e.mid <= 0 ? '' : pe.factor === 0 ? '<span class="tag no">odd &gt; 3,00</span>'
    : `<span class="tag ${e.low > 0 ? 'ok' : ''}">${e.low > 0 ? 'robusto' : 'frágil'} · ${pe.label}</span>`;
  return `<td class="${cls(e.mid)}">${pct(e.mid)}</td><td class="${cls(e.low)}">${pct(e.low)}</td><td>${tag}</td>`;
}

function renderLines() {
  const rows = state.result.lines.filter(l => state.market === 'Todos' || l.market === state.market);
  $('#lines').innerHTML = `<tr><th>Mercado</th><th>Linha</th><th>Prob.</th><th>Faixa</th><th>Odd justa</th>
    <th>Odd da casa</th><th>EV</th><th>EV pior caso</th><th></th></tr>` + rows.map(l => {
    const ps = l.sc.map(s => s.pWin);
    return `<tr data-id="${l.id}"><td>${l.market}</td><td>${l.label}</td><td>${pct(l.pWin)}</td>
      <td class="muted">${pct(Math.min(...ps))}–${pct(Math.max(...ps))}</td><td>${num(fairOdd(l))}</td>
      <td><input type="number" step="0.01" min="1.01" inputmode="decimal" value="${state.odds.get(l.id) || ''}"></td>
      ${evCells(l)}</tr>`;
  }).join('');
  for (const inp of $('#lines').querySelectorAll('input')) inp.oninput = () => {
    const tr = inp.closest('tr'), id = tr.dataset.id, v = parseFloat(inp.value);
    if (v > 1) state.odds.set(id, v); else state.odds.delete(id);
    const line = state.result.lines.find(l => l.id === id);
    [...tr.children].slice(6).forEach(td => td.remove());
    tr.insertAdjacentHTML('beforeend', evCells(line));
    renderRank();
  };
}

function renderRank() {
  const rows = state.result.lines.filter(l => state.odds.has(l.id))
    .map(l => ({ l, odd: state.odds.get(l.id), e: ev(l, state.odds.get(l.id)) }))
    .sort((a, b) => b.e.mid - a.e.mid);
  if (!rows.length) { $('#rank').innerHTML = '<span class="muted">Nenhuma odd informada ainda.</span>'; return; }
  $('#rank').innerHTML = '<table>' + rows.map(({ l, odd, e }) => `<tr><td>${l.market}</td><td>${l.label}</td>
    <td>@ ${num(odd)}</td><td class="muted">justa ${num(fairOdd(l))}</td>
    <td class="${e.mid > 0 ? 'pos' : 'neg'}">EV ${pct(e.mid)}</td>
    <td class="${e.low > 0 ? 'pos' : 'neg'}">pior caso ${pct(e.low)}</td>
    <td>${politicaE(odd).label}</td></tr>`).join('') + '</table>';
}

function renderGames() {
  const col = side => `<div class="games"><b>${esc(state.teams[side].name)}</b>` + state.games[side].map(g => {
    const key = `${side}:${g.id}`, c = g.corners, s = g.shots;
    return `<label><input type="checkbox" data-key="${key}" ${state.off.has(key) ? '' : 'checked'}>
      <span>${g.date.slice(5)} ${g.home ? 'C' : 'F'} ${g.goals.f}–${g.goals.a} ${esc(g.opp)}</span>
      <span>${c ? `esc ${c.f}–${c.a} · chu ${s.f}–${s.a}` : 'sem estat.'} · ${esc(g.league)}</span></label>`;
  }).join('') + '</div>';
  $('#games').innerHTML = col('home') + col('away');
  for (const cb of $('#games').querySelectorAll('input')) cb.onchange = () => {
    if (cb.checked) state.off.delete(cb.dataset.key); else state.off.add(cb.dataset.key);
    compute();
  };
}
