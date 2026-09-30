import * as api from './api.js';
import { METRICS, analyzeMatch, ev, fairOdd, politicaE } from './model.js';
import { buildInsights, recentGames } from './insights.js';
import { collect } from './odds.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1) + '%';
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const date = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const hour = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const SEASONS_BACK = 2;   // temporada atual + 2 anteriores (o decaimento cuida do peso)

const state = { fixtures: [], fixture: null, result: null, odds: new Map(), books: new Map(), pinn: new Map(), market: 'Todos' };

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

// ---- time -> próximos jogos ----
async function search() {
  const q = $('#teamInput').value.trim();
  if (q.length < 3) return msg('Digite ao menos 3 letras do nome do time.', true);
  if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
  msg('Buscando…');
  try {
    const list = await api.searchTeams(q);
    showQuota();
    if (!list.length) return msg(`Nenhum time encontrado para "${q}".`, true);
    const sel = $('#teamSel');
    sel.innerHTML = list.map(t => `<option value="${t.id}">${esc(t.name)} — ${esc(t.country)}</option>`).join('');
    sel.hidden = false;
    await loadFixtures();
  } catch (e) { msg(e.message, true); }
}
async function loadFixtures() {
  msg('Buscando próximos jogos…');
  $('#btnRun').disabled = true;
  try {
    state.fixtures = await api.upcoming(Number($('#teamSel').value));
    showQuota();
    const sel = $('#fixSel');
    sel.hidden = !state.fixtures.length;
    if (!state.fixtures.length) return msg('Esse time não tem jogos agendados.', true);
    sel.innerHTML = state.fixtures.map((f, i) =>
      `<option value="${i}">${hour(f.t)} · ${esc(f.home.name)} x ${esc(f.away.name)} · ${esc(f.league.name)}</option>`).join('');
    $('#btnRun').disabled = false;
    msg('');
  } catch (e) { msg(e.message, true); }
}
$('#btnSearch').onclick = search;
$('#teamInput').onkeydown = e => { if (e.key === 'Enter') search(); };
$('#teamSel').onchange = loadFixtures;

// ---- análise ----
async function baseLeague(fx) {
  const s = fx.league.season;
  const [lh, la] = await Promise.all([api.leaguesOf(fx.home.id, s), api.leaguesOf(fx.away.id, s)]);
  const common = lh.filter(l => la.some(x => x.id === l.id));
  return common.find(l => l.id === fx.league.id) || common[0] || null;
}

$('#btnRun').onclick = async () => {
  const fx = state.fixtures[Number($('#fixSel').value)];
  if (!fx) return;
  $('#btnRun').disabled = true;
  try {
    msg('Identificando a liga…');
    const lg = await baseLeague(fx);
    if (!lg) throw new Error('Os dois times não disputam a mesma liga nesta temporada: confronto entre ligas ainda não é suportado.');
    const S = fx.league.season, seasons = [];
    for (let s = S; s >= S - SEASONS_BACK; s--) if (s !== 2020) seasons.push(s);   // 2020/21 sem público distorce o mando
    let matches = [];
    for (const s of seasons) {
      try {
        matches = matches.concat(await api.leagueMatches(lg.id, s, (d, n) => msg(`Baixando ${lg.name} ${s}: ${d}/${n} jogos…`)));
      } catch (e) { if (s === S) throw e; }
      showQuota();
    }
    msg('Ajustando forças da liga…');
    state.fixture = { ...fx, base: lg, seasons, n: matches.length };
    state.result = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t);
    state.odds.clear(); state.books.clear(); state.pinn.clear();
    state.market = 'Todos';
    msg('');
    render();
  } catch (e) { msg(e.message, true); }
  $('#btnRun').disabled = false;
};

// Odds da Pinnacle em cada linha + probabilidade dela sem margem.
$('#btnOdds').onclick = async () => {
  if (!state.result) return;
  $('#btnOdds').disabled = true;
  msg('Buscando odds…');
  try {
    const { odds, fair } = collect(await api.fixtureOdds(state.fixture.id));
    showQuota();
    const ids = new Set(state.result.lines.map(l => l.id));
    let n = 0;
    for (const [id, odd] of odds) if (ids.has(id)) { state.odds.set(id, odd); state.books.set(id, 'Pinnacle'); n++; }
    state.pinn = fair;
    msg(n ? '' : 'A API não tem odds da Pinnacle para as linhas deste jogo (ainda).', !n);
    renderLines();
    renderRank();
  } catch (e) { msg(e.message, true); }
  $('#btnOdds').disabled = false;
};

function render() {
  const fx = state.fixture, r = state.result;
  $('#out').hidden = false;
  $('#title').textContent = `${fx.home.name} x ${fx.away.name} — ${hour(fx.t)}`;
  const cup = fx.base.id !== fx.league.id ? `Jogo de ${fx.league.name}; forças medidas em ${fx.base.name}. ` : '';
  $('#basis').textContent = `${cup}Base: ${r.prep.rows.length} jogos de ${fx.base.name} (${fx.seasons.join(', ')}), `
    + `peso decrescente com o tempo (meia-vida ≈ 1 ano), ${(r.prep.coverage * 100).toFixed(0)}% com estatística de chutes.`;
  if (!r.lines.length) return msg('Jogos insuficientes na liga para ajustar o modelo.', true);
  renderExpect();
  $('#insights').innerHTML = buildInsights(r, fx.home.id, fx.away.id, { home: fx.home.name, away: fx.away.name })
    .map(i => `<li class="${i.tone}">${esc(i.text)}</li>`).join('');
  renderChips();
  renderLines();
  renderRank();
  renderGames();
}

function renderExpect() {
  const { pred, fits, phi } = state.result;
  $('#expect').innerHTML = Object.entries(METRICS).map(([k, m]) => {
    const e = pred[k];
    if (!e) return `<div class="stat"><small>${m.name}</small><b>—</b><small>sem estatística na liga</small></div>`;
    const lg = fits[k].avgH + fits[k].avgA;
    return `<div class="stat"><small>${m.name} esperados</small><b>${num(e.h + e.a)}</b>
      <small>casa ${num(e.h)} · fora ${num(e.a)}</small>
      <small>média da liga ${num(lg)}${k !== 'goals' ? ` · dispersão ${num(phi[k])}` : ''}</small></div>`;
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
  $('#lines').innerHTML = `<tr><th>Mercado</th><th>Linha</th><th>Modelo</th><th>Faixa</th><th>Odd justa</th>
    <th>Pinnacle</th><th>Odd da casa</th><th>Casa</th><th>EV</th><th>EV pior caso</th><th></th></tr>` + rows.map(l => {
    const ps = l.sc.map(s => s.pWin);
    return `<tr data-id="${l.id}"><td>${l.market}</td><td>${l.label}</td><td>${pct(l.pWin)}</td>
      <td class="muted">${pct(Math.min(...ps))}–${pct(Math.max(...ps))}</td><td>${num(fairOdd(l))}</td>
      <td>${pinnCell(l)}</td>
      <td><input type="number" step="0.01" min="1.01" inputmode="decimal" value="${state.odds.get(l.id) || ''}"></td>
      <td class="book">${esc(state.books.get(l.id) || '')}</td>${evCells(l)}</tr>`;
  }).join('');
  for (const inp of $('#lines').querySelectorAll('input')) inp.oninput = () => {
    const tr = inp.closest('tr'), id = tr.dataset.id, v = parseFloat(inp.value);
    if (v > 1) { state.odds.set(id, v); state.books.set(id, 'manual'); } else { state.odds.delete(id); state.books.delete(id); }
    const line = state.result.lines.find(l => l.id === id);
    tr.children[7].textContent = state.books.get(id) || '';
    [...tr.children].slice(8).forEach(td => td.remove());
    tr.insertAdjacentHTML('beforeend', evCells(line));
    renderRank();
  };
}

// Probabilidade da Pinnacle sem margem para a linha. Linha inteira/quarto: a Pinnacle devolve o push,
// então comparamos pela probabilidade efetiva de ganho do modelo.
function pinnCell(l) {
  const p = state.pinn.get(l.id);
  if (p == null) return '<span class="muted">—</span>';
  const model = l.pWin / (l.pWin + l.pLose), d = model - p;
  return `${pct(p)} <span class="${Math.abs(d) >= 0.05 ? (d > 0 ? 'pos' : 'neg') : 'muted'}">(${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)})</span>`;
}

function renderRank() {
  const rows = state.result.lines.filter(l => state.odds.has(l.id))
    .map(l => ({ l, odd: state.odds.get(l.id), e: ev(l, state.odds.get(l.id)) }))
    .sort((a, b) => b.e.mid - a.e.mid);
  if (!rows.length) { $('#rank').innerHTML = '<span class="muted">Nenhuma odd informada ainda.</span>'; return; }
  $('#rank').innerHTML = '<div class="scroll"><table>' + rows.map(({ l, odd, e }) => `<tr><td>${l.market}</td><td>${l.label}</td>
    <td>@ ${num(odd)}</td><td class="book">${esc(state.books.get(l.id) || '')}</td>
    <td class="muted">justa ${num(fairOdd(l))}</td>
    <td class="muted">${state.pinn.has(l.id) ? `Pinnacle ${pct(state.pinn.get(l.id))}` : ''}</td>
    <td class="${e.mid > 0 ? 'pos' : 'neg'}">EV ${pct(e.mid)}</td>
    <td class="${e.low > 0 ? 'pos' : 'neg'}">pior caso ${pct(e.low)}</td>
    <td>${politicaE(odd).label}</td></tr>`).join('') + '</table></div>';
}

function renderGames() {
  const { prep } = state.result, fx = state.fixture;
  const pair = p => (p ? `${p[0]}–${p[1]}` : '—');
  const col = team => `<div class="games scroll"><b>${esc(team.name)}</b><table>
    <tr><th>Data</th><th>Adversário</th><th>Placar</th><th>xG</th><th>Chutes</th><th>Esc.</th></tr>`
    + recentGames(prep, team.id).map(g => `<tr><td>${date(g.t)} ${g.home ? 'C' : 'F'}</td><td>${esc(g.opp)}</td>
      <td>${g.gf}–${g.ga}</td><td>${g.xf != null ? `${num(g.xf, 1)}–${num(g.xa, 1)}` : '—'}</td>
      <td>${pair(g.shots)}</td><td>${pair(g.corners)}</td></tr>`).join('') + '</table></div>';
  $('#games').innerHTML = col(fx.home) + col(fx.away);
}
