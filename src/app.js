import * as api from './api.js';
import { METRICS, analyzeMatch, ev, fairOdd, politicaE, sideLabel } from './model.js';
import { buildInsights, recentGames } from './insights.js';
import { collect } from './odds.js';
import { initEntry } from './entryview.js';
import { listSaved, loadAnalysis, saveAnalysis } from './saved.js';
import { bindTooltips, pickDashboard, renderDashboard } from './dashboard.js';
import { FOCUS, ODDS_STALE_MIN, buildDossier, loadLeague, resolveBase, side } from './dossier.js';
import { alternatives, makePricer, nearest, parseLine, renderMyLine, verdict } from './myline.js';
import { initScan } from './scanview.js';
import { bindSpecialist, briefGame } from './brief.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const date = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const hour = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const BANCA = 44000;
// Rótulo da linha com o nome dos times do jogo aberto ("CRB −2,5", não "Fora −2,5").
const named = label => sideLabel(label, state.fixture?.home.name, state.fixture?.away.name);

const state = { teams: [], fixtures: [], fixture: null, result: null, matches: [], dossier: null, oddsP: null, focus: true,
  odds: new Map(), books: new Map(), pinn: new Map(), market: 'Todos', price: null, my: null };

function msg(text, err = false) {
  const el = $('#msg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', err);
}
let statsAt = api.stats();   // contador no início da ação atual
const startAction = () => { statsAt = api.stats(); };
function showQuota() {
  const s = api.stats(), used = s.api - statsAt.api, hits = s.cache - statsAt.cache;
  $('#quota').textContent = [api.remaining != null ? `${api.remaining} requisições restantes hoje` : '',
    used || hits ? `esta ação: ${used} na API, ${hits} do cache` : '',
    api.cloudStatus()?.ok ? '☁️ nuvem' : ''].filter(Boolean).join(' · ');
  showCloud();
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

// ---- cache na nuvem (GitHub) ----
function showCloud(text, err = false) {
  const s = api.cloudStatus(), el = $('#cloudInfo');
  el.classList.toggle('err', err || s?.ok === false);
  $('#btnPushCloud').hidden = !s?.ok;
  el.textContent = text || (!s ? 'Nuvem desligada: o cache fica só neste navegador.'
    : s.ok === false ? `Nuvem com erro: ${s.error}`
      : s.ok ? `Nuvem conectada (${s.repo}): ${s.files} arquivos · nesta sessão ${s.down} baixados, ${s.up} enviados${s.error ? ` · último erro: ${s.error}` : ''}`
        : `Nuvem: ${s.repo} (conectando…)`);
}
$('#ghRepo').value = api.getCloud()?.repo || '';
$('#btnSaveCloud').onclick = async () => {
  const repo = $('#ghRepo').value.trim(), token = $('#ghToken').value.trim() || api.getCloud()?.token;
  if (!repo) { api.setCloud(null); return showCloud(); }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return showCloud('Repositório no formato dono/nome.', true);
  if (!token) return showCloud('Cole o token do GitHub.', true);
  api.setCloud({ repo, token });
  $('#ghToken').value = '';
  showCloud('Conectando…');
  try { await api.checkCloud(); showCloud(); } catch (e) { api.setCloud(null); showCloud(`Não conectou: ${e.message}`, true); }
};
$('#btnPushCloud').onclick = async () => {
  $('#btnPushCloud').disabled = true;
  try {
    const n = await api.pushAllToCloud((d, t) => showCloud(`Enviando o cache deste navegador: ${d}/${t}…`));
    showCloud(); $('#cloudInfo').textContent += ` · ${n} arquivos deste navegador conferidos`;
  } catch (e) { showCloud(e.message, true); }
  $('#btnPushCloud').disabled = false;
};
if (api.getCloud()) api.checkCloud().then(() => showCloud(), () => showCloud());
else showCloud();

// ---- time -> próximos jogos ----
async function search(fromApi = false) {
  startAction();
  const q = $('#teamInput').value.trim();
  if (q.length < 3) return msg('Digite ao menos 3 letras do nome do time.', true);
  if (!api.getKey()) return msg('Informe a chave da API em ⚙️ Chave.', true);
  msg('Buscando…');
  try {
    const list = await api.searchTeams(q, { fromApi });
    state.teams = list;
    showQuota();
    $('#btnSearchApi').hidden = fromApi;
    if (!list.length) return msg(`Nenhum time encontrado para "${q}".`, true);
    const sel = $('#teamSel');
    sel.innerHTML = list.map(t => `<option value="${t.id}">${esc(t.name)}${t.country ? ` — ${esc(t.country)}` : ''}${t.national ? ' · seleção' : ''}</option>`).join('');
    sel.hidden = false;
    await loadFixtures();
    if (list.some(t => t.local)) msg('Times do seu histórico (sem gastar requisição). Não achou? Use "Buscar na API".');
  } catch (e) { msg(e.message, true); }
}
// Busca manual: jogos em andamento do time (no topo) + próximos jogos.
const liveTag = f => (f.live ? `🔴 AO VIVO ${f.live.elapsed ?? ''}' · ${f.live.goals[0] ?? 0}–${f.live.goals[1] ?? 0} · ` : '');
async function loadFixtures() {
  msg('Buscando jogos ao vivo e próximos…');
  $('#btnRun').disabled = true;
  try {
    const id = Number($('#teamSel').value);
    const [next, live] = await Promise.all([api.upcoming(id), api.liveOf(id).catch(() => [])]);
    state.fixtures = live.concat(next.filter(f => !live.some(l => l.id === f.id)));
    showQuota();
    const sel = $('#fixSel');
    sel.hidden = !state.fixtures.length;
    if (!state.fixtures.length) return msg('Esse time não tem jogo ao vivo nem agendado.', true);
    sel.innerHTML = state.fixtures.map((f, i) =>
      `<option value="${i}">${liveTag(f)}${hour(f.t)} · ${esc(f.home.name)} x ${esc(f.away.name)} · ${esc(f.league.name)}</option>`).join('');
    $('#btnRun').disabled = false;
    msg('');
  } catch (e) { msg(e.message, true); }
}
$('#btnSearch').onclick = () => search();
$('#btnSearchApi').onclick = () => search(true);
$('#teamInput').onkeydown = e => { if (e.key === 'Enter') search(); };
$('#teamSel').onchange = loadFixtures;

// ---- análise ----
const selectedTeam = () => state.teams.find(t => t.id === Number($('#teamSel').value)) || { id: Number($('#teamSel').value) };

// Analisa o jogo selecionado; devolve true quando a análise ficou pronta na tela. Se o jogo tem análise
// guardada (até o horário dele), abre a cópia sem chamar a API.
async function runAnalysis() {
  startAction();
  const fx = state.fixtures[Number($('#fixSel').value)];
  if (!fx || state.running) return false;
  state.running = true;
  $('#btnRun').disabled = true;
  try {
    const snap = await loadAnalysis(fx.id);
    if (snap) { openSnapshot(fx.live ? { ...snap, fixture: { ...snap.fixture, live: fx.live } } : snap); return true; }
    msg('Identificando a liga…');
    const lg = await resolveBase(api.dossierApi, fx, !!selectedTeam().national);
    if (!lg) throw new Error('Não encontrei a liga de nenhum dos dois times nesta temporada.');
    const { matches, seasons } = await loadLeague(api.dossierApi, lg, fx.league.season, t => { msg(t); showQuota(); });
    showQuota();
    msg('Ajustando forças da liga…');
    state.fixture = { ...fx, base: lg, seasons, n: matches.length };
    state.matches = matches;
    state.odds.clear(); state.books.clear(); state.pinn.clear();
    state.market = 'Todos';
    state.my = null;
    await refreshOdds();
    msg('');
    render();
    return true;
  } catch (e) { msg(e.message, true); return false; }
  finally { state.running = false; $('#btnRun').disabled = false; }
}
// Botão "Analisar jogo": pronta a análise, a tela desce até o resultado.
$('#btnRun').onclick = async () => { if (await runAnalysis()) $('#out').scrollIntoView({ block: 'start' }); };

// Refaz o modelo com as odds de state.oddsP (sem requisição): o total de escanteios do 1º tempo é
// ancorado no da Pinnacle, e a tabela recebe as odds dela.
function applyOdds() {
  const { odds, fair } = collect(state.oddsP.bookmakers);
  // refaz o modelo com as odds: o total de escanteios do 1º tempo é ancorado no da Pinnacle
  state.result = analyzeMatch(state.matches, state.fixture.home.id, state.fixture.away.id, state.fixture.t, { fair });
  for (const [id, b] of state.books) if (b === 'Pinnacle') { state.odds.delete(id); state.books.delete(id); }
  const ids = new Set(state.result.lines.map(l => l.id));
  for (const [id, odd] of odds) if (ids.has(id) && state.books.get(id) !== 'manual') { state.odds.set(id, odd); state.books.set(id, 'Pinnacle'); }
  state.pinn = fair;
}

// Busca as odds da Pinnacle agora (sem cache), refaz o modelo e o dossiê e guarda a análise até o jogo.
async function refreshOdds() {
  msg('Buscando odds da Pinnacle…');
  state.oddsP = await api.fixtureOdds(state.fixture.id);
  applyOdds();
  msg('Montando o dossiê (desfalques, tabela, descanso)…');
  state.dossier = await buildDossier(api.dossierApi, {
    fx: state.fixture, team: selectedTeam(), fixtures: state.fixtures, national: !!state.fixture.base.national,
    matches: state.matches, lg: state.fixture.base, oddsPayload: state.oddsP, banca: BANCA,
  });
  state.price = makePricer({ dossier: state.dossier, result: state.result, teams: teamsHist(), banca: BANCA });
  showQuota();
  state.savedAt = null;
  saveAnalysis({ fixture: state.fixture, team: selectedTeam(), matches: state.matches, oddsP: state.oddsP, dossier: state.dossier })
    .then(renderSaved, () => { /* sem armazenamento: segue sem cópia */ });
}

// Abre uma análise guardada: remonta modelo, tabela e painel a partir da cópia, sem requisição.
function openSnapshot(snap) {
  const fx = snap.fixture;
  state.teams = [snap.team || { id: fx.home.id, name: fx.home.name }];
  state.fixtures = [fx];
  $('#teamSel').innerHTML = `<option value="${state.teams[0].id}">${esc(state.teams[0].name || fx.home.name)}</option>`;
  $('#fixSel').innerHTML = `<option value="0">${hour(fx.t)} · ${esc(fx.home.name)} x ${esc(fx.away.name)} · ${esc(fx.league.name)}</option>`;
  $('#teamSel').hidden = false; $('#fixSel').hidden = false;
  state.fixture = fx; state.matches = snap.matches; state.oddsP = snap.oddsP; state.dossier = snap.dossier;
  state.odds.clear(); state.books.clear(); state.pinn.clear();
  state.market = 'Todos'; state.my = null; state.savedAt = snap.savedAt;
  applyOdds();
  state.price = makePricer({ dossier: state.dossier, result: state.result, teams: teamsHist(), banca: BANCA });
  render();
  showQuota();   // contador desta ação (0 na API), não o da ação anterior
  msg(`Análise guardada às ${new Date(snap.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}: aberta sem gastar requisição. `
    + 'Para odds e desfalques de agora, use 🔄 Atualizar odds.');
}

// Lista "📂 Guardadas": jogos com análise pronta até o horário deles.
async function renderSaved() {
  let list = [];
  try { list = await listSaved(); } catch { /* sem armazenamento */ }
  const el = $('#savedList');
  el.hidden = !list.length;
  el.innerHTML = list.length ? '<span class="muted">📂 Guardadas até o jogo:</span>' + list.map(x =>
    `<button data-saved="${x.id}">${esc(x.home)} x ${esc(x.away)} · ${hour(x.t)}</button>`).join('') : '';
}
$('#savedList').onclick = async e => {
  const b = e.target.closest('[data-saved]');
  if (!b || state.running) return;
  startAction();
  const snap = await loadAnalysis(Number(b.dataset.saved));
  if (!snap) { msg('Essa análise não está mais guardada (o jogo já começou?).', true); return renderSaved(); }
  openSnapshot(snap);
  $('#out').scrollIntoView({ block: 'start' });
};
renderSaved();

$('#btnOdds').onclick = async () => {
  startAction();
  if (!state.result) return;
  $('#btnOdds').disabled = true;
  try {
    await refreshOdds();
    msg('');
    renderLines();
    renderRank();
    renderDash();
    if (state.my) runMy();
  } catch (e) { msg(e.message, true); }
  $('#btnOdds').disabled = false;
};

function renderOddsInfo() {
  const p = state.oddsP, el = $('#oddsInfo');
  if (!p || !p.bookmakers.length) { el.className = 'oddsbar stale'; el.textContent = 'A API não tem odds da Pinnacle para este jogo (ainda).'; return; }
  const age = p.updatedAt ? Math.round((Date.now() - Date.parse(p.updatedAt)) / 60e3) : null;   // idade agora (vale para análise guardada)
  const when = p.updatedAt ? new Date(p.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '?';
  el.className = `oddsbar${age > ODDS_STALE_MIN ? ' stale' : ''}`;
  el.textContent = `Odds da Pinnacle: última atualização da API às ${when} (há ${age ?? '?'} min). `
    + (age > ODDS_STALE_MIN ? 'Odd velha: confira o preço atual antes de entrar; as linhas ficam marcadas como frágeis. ' : '')
    + 'A API atualiza as odds a cada ~3 h; você pode corrigir qualquer odd na tabela.';
}

function render() {
  const fx = state.fixture, r = state.result;
  $('#out').hidden = false;
  $('#title').textContent = `${fx.home.name} x ${fx.away.name} — ${hour(fx.t)}`;
  const cup = fx.base.cross ? `Jogo entre ligas (${fx.league.name}): forças medidas em ${fx.base.name}; os jogos da competição entre times das duas ligas põem as ligas na mesma escala. `
    : fx.base.national ? `Jogo de seleções (${fx.league.name}): forças medidas nos jogos dos dois times e de todos os adversários que eles enfrentaram (amistosos com metade do peso). `
    : fx.base.id !== fx.league.id ? `Jogo de ${fx.league.name}; forças medidas em ${fx.base.name}. ` : '';
  const live = fx.live ? `🔴 Jogo em andamento (${fx.live.elapsed ?? '?'}', ${fx.live.goals[0] ?? 0}–${fx.live.goals[1] ?? 0} quando você buscou): `
    + 'esta é a análise pré-jogo; as linhas valem para o jogo inteiro desde o apito inicial e não levam em conta placar, minuto nem odds ao vivo. ' : '';
  $('#basis').textContent = `${live}${cup}Base: ${r.prep.rows.length} jogos de ${fx.base.name} (${fx.seasons.join(', ')}), `
    + `peso decrescente com o tempo (meia-vida ≈ 1 ano), ${(r.prep.coverage * 100).toFixed(0)}% com estatística de chutes, `
    + `${(r.prep.coverage1h * 100).toFixed(0)}% com escanteios do 1º tempo (a API só tem desde 2024).`
    + (r.anchors.corners1h ? ` Total de escanteios do 1º tempo ancorado na Pinnacle: modelo ${num(r.anchors.corners1h.model_total)} → `
      + `${num(r.anchors.corners1h.model_total * r.anchors.corners1h.factor)} (Pinnacle ${num(r.anchors.corners1h.pinnacle_total)}).` : '');
  if (!r.lines.length) return msg('Jogos insuficientes na liga para ajustar o modelo.', true);
  renderExpect();
  $('#insights').innerHTML = buildInsights(r, fx.home.id, fx.away.id, { home: fx.home.name, away: fx.away.name })
    .map(i => `<li class="${i.tone}">${esc(i.text)}</li>`).join('');
  renderChips();
  renderLines();
  renderRank();
  renderDash();
  renderMyForm();
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
    return `<tr data-id="${l.id}"><td>${l.market}</td><td>${esc(named(l.label))}</td><td>${pct(l.pWin)}</td>
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

function renderDash() {
  renderOddsInfo();
  if (!state.dossier) { $('#dash').innerHTML = ''; return; }
  const teams = teamsHist();
  $('#dashMode').innerHTML = [['Foco: gols + escanteios 1T', true], ['Todos os mercados', false]]
    .map(([t, f]) => `<button class="${state.focus === f ? 'on' : ''}" data-f="${f}">${t}</button>`).join('');
  for (const b of $('#dashMode').children) b.onclick = () => { state.focus = b.dataset.f === 'true'; renderDash(); };
  $('#dash').innerHTML = renderDashboard(pickDashboard(state.dossier, 5, { focus: state.focus, side }), teams);
  bindTooltips($('#dash'));
}

// Últimos jogos de cada time, no formato dos gráficos.
function teamsHist() {
  const { prep } = state.result, fx = state.fixture;
  return [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(prep, t.id) }));
}

// ---- minha linha: análise focada na linha que vou apostar ----
const cond = l => l.pWin / (l.pWin + l.pLose);
const thr = id => parseFloat(id.match(/-?[\d.]+$/)?.[0]) || 0;
function renderMyForm() {
  const all = state.result.all || state.result.lines;
  const markets = [...new Set(all.map(l => l.market))].sort((a, b) => FOCUS.includes(b) - FOCUS.includes(a));
  $('#myMarket').innerHTML = markets.map(m => `<option>${esc(m)}</option>`).join('');
  fillMyLines();
  $('#myOut').innerHTML = '';
  $('#myMsg').hidden = true;
}
function fillMyLines(selected) {
  const market = $('#myMarket').value, all = state.result.all || state.result.lines;
  const rows = all.filter(l => l.market === market && (l.id === selected || (cond(l) > 0.05 && cond(l) < 0.95)))
    .sort((a, b) => side(a.id).localeCompare(side(b.id)) || thr(a.id) - thr(b.id));
  $('#myLine').innerHTML = rows.map(l => `<option value="${esc(l.id)}">${esc(named(l.label))} · acerta ${pct(cond(l))}</option>`).join('');
  if (selected) $('#myLine').value = selected;
}
function selectMy(id) {
  const l = (state.result.all || state.result.lines).find(x => x.id === id);
  if (!l) return false;
  $('#myMarket').value = l.market;
  fillMyLines(id);
  return true;
}
function myMsg(text, err = false) {
  const el = $('#myMsg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', err);
}
$('#myText').oninput = () => {
  const text = $('#myText').value.trim();
  if (!text || !state.price) return myMsg('');
  const p = parseLine(text, { names: { home: state.fixture.home.name, away: state.fixture.away.name } });
  if (p.error) return myMsg(p.error, true);
  if (!state.price(p.id)) {
    const near = nearest(state.price, p.id);
    if (near && selectMy(near)) return myMsg(`Essa linha está fora do que o modelo calcula; selecionei a mais próxima: ${state.price(near).line}.`, true);
    return myMsg('O modelo não calcula essa linha para este jogo.', true);
  }
  selectMy(p.id);
  const l = state.price(p.id);
  myMsg(`Entendi: ${l.market} — ${l.line}`);
};
$('#myText').onkeydown = e => { if (e.key === 'Enter') $('#myRun').click(); };
$('#myOdd').onkeydown = e => { if (e.key === 'Enter') $('#myRun').click(); };
$('#myMarket').onchange = () => fillMyLines();
$('#myRun').onclick = () => {
  if (!state.price || !$('#myLine').value) return;
  state.my = { id: $('#myLine').value, odd: parseFloat($('#myOdd').value) || null };
  runMy();
};
function runMy() {
  const line = state.price(state.my.id);
  if (!line) { state.my = null; return myMsg('Essa linha não existe mais com as odds atuais.', true); }
  const v = verdict(line, state.my.odd), { alts, best } = alternatives(state.price, line, state.dossier);
  const alerts = state.dossier.data_quality.alerts;
  if (alerts.length) v.notes.push(`Alertas do jogo: ${alerts.join('; ')}.`);
  $('#myOut').innerHTML = renderMyLine({ line, v, alts, best, teams: teamsHist(), odd: state.my.odd });
  bindTooltips($('#myOut'));
}
$('#myOut').addEventListener('click', e => {
  const a = e.target.closest('[data-analyze]');
  if (a) {
    selectMy(a.dataset.analyze);
    $('#myOdd').value = '';
    $('#myText').value = '';
    myMsg('Linha trocada: informe a odd da sua casa para ver o EV.');
    state.my = { id: a.dataset.analyze, odd: null };
    runMy();
    $('#mySec').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const b = e.target.closest('[data-enter]');
  if (b) openEntry(b.dataset.enter, b.dataset.enter === state.my?.id ? state.my.odd : null);
});

function renderRank() {
  const rows = state.result.lines.filter(l => state.odds.has(l.id))
    .map(l => ({ l, odd: state.odds.get(l.id), e: ev(l, state.odds.get(l.id)) }))
    .sort((a, b) => b.e.mid - a.e.mid);
  if (!rows.length) { $('#rank').innerHTML = '<span class="muted">Nenhuma odd informada ainda.</span>'; return; }
  $('#rank').innerHTML = '<div class="scroll"><table>' + rows.map(({ l, odd, e }) => `<tr><td>${l.market}</td><td>${esc(named(l.label))}</td>
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
    <tr><th>Data</th><th>Adversário</th><th>Gols pró–contra</th><th>xG pró–contra</th><th>Chutes pró–contra</th><th>Esc. pró–contra</th></tr>`
    + recentGames(prep, team.id).map(g => `<tr><td>${date(g.t)} ${g.home ? 'C' : 'F'}</td><td>${esc(g.opp)}</td>
      <td>${g.gf}–${g.ga}</td><td>${g.xf != null ? `${num(g.xf, 1)}–${num(g.xa, 1)}` : '—'}</td>
      <td>${pair(g.shots)}</td><td>${pair(g.corners)}</td></tr>`).join('') + '</table></div>';
  $('#games').innerHTML = col(fx.home) + col(fx.away);
}

// ---- entrar numa linha: manda a aposta para o app de apostas de valor (entryview.js) ----
const openEntry = initEntry({ getLine: id => state.price?.(id) || null, getFixture: () => state.fixture });
$('#dash').addEventListener('click', e => {
  const b = e.target.closest('[data-enter]');
  if (b) openEntry(b.dataset.enter);
});

// ---- varredura do dia ----
// Analisa um jogo vindo de fora da busca (varredura do dia), pelo mesmo fluxo do botão "Analisar jogo".
async function analyzeFixture(fx, national) {
  if (state.running) { msg('Espere a análise em andamento terminar.', true); return false; }
  state.teams = [{ id: fx.home.id, name: fx.home.name, national }];
  state.fixtures = [fx];
  $('#teamSel').innerHTML = `<option value="${fx.home.id}">${esc(fx.home.name)}</option>`;
  $('#fixSel').innerHTML = `<option value="0">${hour(fx.t)} · ${esc(fx.home.name)} x ${esc(fx.away.name)} · ${esc(fx.league.name)}</option>`;
  $('#teamSel').hidden = false; $('#fixSel').hidden = false;
  $('#teamInput').value = fx.home.name;
  return runAnalysis();
}
initScan({ api, openEntry, analyzeFixture, banca: BANCA });
bindSpecialist($('#btnSpec'), () => state.dossier && briefGame(state.dossier));
