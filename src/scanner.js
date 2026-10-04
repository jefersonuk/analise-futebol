// Varredura do dia: valor nas linhas principais do pré-jogo (consistency.js: escanteios 1T 4 e 4,5,
// escanteios do jogo 8 e 8,5, gols 1T 1,5, gols do jogo 1,5 e 2,5) de todos os jogos por começar com odds da
// Pinnacle, pelo mesmo modelo do app. Só linhas que a Pinnacle cota (o valor é medido contra ela). Handicap
// de escanteios do jogo fica num filtro à parte. Liga sem estatística de escanteios na API (USL Championship,
// Liga de Expansión, Primera B…) entra só com os mercados de gols.
//
// Custo (o que manda no desenho):
//   1. jogos do dia: 1 requisição; odds da Pinnacle de todos os mercados lidos: 1 por 10 jogos (nenhuma
//      busca jogo a jogo)
//   2. cada liga: ~60 requisições na primeira vez (3 temporadas com estatística), depois só o que é novo.
//      Os escanteios do 1º tempo da liga inteira (1 requisição por jogo) NÃO são baixados: a média do
//      1º tempo de cada time sai dos escanteios do jogo × fração do 1º tempo, e o total é ancorado na Pinnacle
//   3. os 1,5×N jogos com mais valor nos escanteios do 1º tempo: escanteios do 1º tempo dos últimos 10 jogos
//      de cada time (até 20 requisições por jogo na primeira vez; ficam guardados), que confirmam ou não o valor
// O orçamento de requisições é respeitado: ligas e históricos que não cabem ficam de fora e são listados.

import { analyzeMatch, politicaE } from './model.js';
import { collect } from './odds.js';
import { recentGames } from './insights.js';
import { FRIENDLIES, contraAlert, favorSummary, priceLines, rolesNow, seasonsFor } from './dossier.js';
import { favorFor } from './favoritism.js';
import { MAIN_LINES, byValue, isMain, isUnder, isValueBet } from './consistency.js';

export const MAIN_MARKETS = Object.keys(MAIN_LINES);   // escanteios 1T, escanteios do jogo, gols 1T, gols do jogo
export const HANDICAP = 'Handicap de escanteios';      // jogo inteiro, nas linhas da Pinnacle: filtro à parte
export const SCAN_MARKETS = MAIN_MARKETS.concat(HANDICAP);
const GOALS_ONLY = ['Total de gols 1T', 'Total de gols'];
// MIN_GAMES: jogos-equivalentes (com o decaimento) de cada time na base — de gols para analisar o jogo,
// de escanteios para os mercados de escanteios (jogo e 1º tempo).
const LEAGUE_COST = 70, TEAM_COST = 10, MIN_GAMES = 8;
const DAY = 864e5;
// Liga sem histórico suficiente dos times (seleções, copas, base, feminino, 2ª fase): a base passa a ser
// os jogos dos times em todas as competições (3 temporadas, até 4 anos), juntando todos os times do mesmo
// torneio no dia — os confrontos entre eles (eliminatórias, Nations League) ligam as forças. Amistoso pesa metade.
async function teamPool(api, fixtures, S, onProgress) {
  const teams = new Map(fixtures.flatMap(f => [[f.home.id, f.home.name], [f.away.id, f.away.name]]));
  const cutoff = Date.now() - 4 * 365 * DAY, byId = new Map();
  let i = 0;
  for (const [id, name] of teams) {
    i++;
    for (const s of [S, S - 1, S - 2]) {
      try {
        for (const m of await api.teamMatches(id, s, (d, n) => onProgress(`${name} ${s}: estatísticas ${d}/${n}…`)))
          if (m.t >= cutoff) byId.set(m.id, m);
      } catch { /* temporada sem jogos */ }
    }
    onProgress(`Histórico dos times (${i}/${teams.size}): ${name}…`);
  }
  return [...byId.values()].map(m => (m.lg === FRIENDLIES ? { ...m, wm: 0.5 } : m));
}
const r2 = x => Math.round(x * 100) / 100;

// jogável: odd mínima na faixa operada (1,50–3,00), linha que o mercado oferece (não "favorito +x") e over
// primeiro (under só quando é aposta de valor)
const playable = l => l.odd_min >= 1.5 && politicaE(l.odd_min).factor > 0 && !l.inviable && (!isUnder(l.id) || isValueBet(l));
// Melhor linha de um jogo: aposta de valor primeiro; senão a de mais valor jogável.
// market: um mercado ou null (as linhas principais: escanteios 1T e do jogo, gols 1T e do jogo).
export function bestLine(lines, { market = null } = {}) {
  const ms = market ? [market] : MAIN_MARKETS;
  const pool = lines.filter(l => ms.includes(l.market) && playable(l)).sort(byValue);
  return pool.find(isValueBet) || pool[0] || null;
}

// favor: calibração da base (favoritism.js): escanteios por gol de superioridade na liga.
// Sem gols suficientes na base o jogo fica de fora (thin: tenta de novo pela base dos times); sem escanteios
// suficientes, segue só com os mercados de gols.
function analyze(fx, matches, oddsP, banca, teamBase = false, favor = null) {
  const { odds, fair } = collect(oddsP.bookmakers);
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair, share1hBelow: 0.5, favor });
  const thin = k => [fx.home, fx.away].filter(t => (res.fits[k]?.games.get(t.id) || 0) < MIN_GAMES).map(t => t.name).join(' e ');
  if (!res.lines.length || thin('goals')) return { skip: `${thin('goals') || 'os times'} com menos de ${MIN_GAMES} jogos na base`, thin: true };
  const cornersThin = thin('corners');
  const noCorners = !cornersThin ? null : res.prep.coverage === 0
    ? 'só gols: a API não tem estatística de escanteios dos jogos desta base'
    : `só gols: ${cornersThin} com menos de ${MIN_GAMES} jogos com estatística de escanteios na base`;
  const markets = noCorners ? GOALS_ONLY : SCAN_MARKETS;
  const now = rolesNow(res.favor);
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id), roleNow: now[role] }));
  const ageMin = oddsP.updatedAt ? Math.round((Date.now() - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const alerts = ageMin > 90 ? [`odds da Pinnacle com ${ageMin} min`] : [];
  if (teamBase) alerts.push('base: jogos dos dois times em todas as competições (amostra menor que a de uma liga)');
  const names = { home: fx.home.name, away: fx.away.name }, contra = !noCorners && contraAlert(res.favor, names);
  if (contra) alerts.push(contra);
  // só linhas com preço da Pinnacle: as principais e o handicap de escanteios que ela cota
  const { priced } = priceLines(res, { odds, fair, alerts, teams, banca, only: l => markets.includes(l.market) && (isMain(l.id) || l.market === HANDICAP) });
  const lines = priced;
  const best = Object.fromEntries(SCAN_MARKETS.map(m => [m, bestLine(lines, { market: m })]));
  const a = res.anchors, h1 = !noCorners;
  return {
    fx, teams, lines, best, alerts, odds_age_min: ageMin, team_base: teamBase, no_corners: noCorners,
    favor: res.favor && Object.fromEntries(Object.entries(res.favor).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
    favor_text: favorSummary(res.favor, names),
    c1_known: teams.map(t => t.games.filter(g => g.c1).length),
    pinnacle_1h: h1 && a.corners1h ? { line: a.corners1h.from_line, total: r2(a.corners1h.pinnacle_total), model: r2(a.corners1h.model_total) } : null,
    share_1h: h1 && a.corners1hShare ? r2(a.corners1hShare.share) : null,
    expected_1h: h1 && res.pred.corners1h ? { home: r2(res.pred.corners1h.h), away: r2(res.pred.corners1h.a) } : null,
  };
}

// Ordem dos jogos: a melhor linha de cada um (no filtro pedido), apostas de valor primeiro, depois valor.
export function rankGames(games, opts = {}) {
  return games.map(g => ({ g, line: bestLine(g.lines, opts) })).filter(x => x.line)
    .sort((a, b) => isValueBet(b.line) - isValueBet(a.line) || byValue(a.line, b.line));
}

// api: o mesmo conjunto do dossiê (dayFixtures, dayOdds, hasLeague, leagueMatches, attachHalfCorners, stats).
export async function scanDay(api, { date, top = 20, budget = 1500, banca = 44000, onProgress = () => {} }) {
  const used = (() => { const s0 = api.stats().api; return () => api.stats().api - s0; })();
  const skipped = [];
  onProgress('Buscando os jogos do dia…');
  const fixtures = (await api.dayFixtures(date)).filter(f => f.t > Date.now() + 10 * 60e3);
  onProgress(`${fixtures.length} jogos ainda por começar. Buscando as odds da Pinnacle do dia…`);
  // todos os mercados que o app lê, de todos os jogos da data (1 requisição por 10 jogos)
  const odds = new Map((await api.dayOdds(date)).filter(o => o.bookmakers.some(b => b.bets?.length)).map(o => [o.fixture, o]));
  const pool = fixtures.filter(f => odds.has(f.id));
  const has1h = f => odds.get(f.id).bookmakers.some(b => b.bets.some(x => x.id === 77));
  const oddsOf = fx => odds.get(fx.id);
  const leagues = new Map();
  for (const f of pool) {
    const k = f.league.id;
    if (!leagues.has(k)) leagues.set(k, { lg: f.league, fixtures: [], cached: await api.hasLeague(k, f.league.season) });
    leagues.get(k).fixtures.push(f);
  }
  // ligas já guardadas primeiro (custo ~0), depois as com mais jogos
  const order = [...leagues.values()].sort((a, b) => b.cached - a.cached || b.fixtures.length - a.fixtures.length);

  // 1ª passada: modelo com a média do 1º tempo vinda dos escanteios do jogo
  const base = new Map(), favorBy = new Map(), games = [];
  let li = 0;
  for (const L of order) {
    li++;
    if (!L.cached && used() + LEAGUE_COST > budget) { skipped.push(...L.fixtures.map(f => ({ fx: f, why: 'liga fora do orçamento de requisições' }))); continue; }
    onProgress(`Liga ${li}/${order.length}: ${L.lg.name}${L.cached ? '' : ' (primeira vez: baixando o histórico)'}… · ${used()} requisições`);
    let matches = [];
    try {
      const S = L.lg.season;
      for (const s of seasonsFor(S)) {
        try {
          let ms = await api.leagueMatches(L.lg.id, s, (d, n) => onProgress(`${L.lg.name} ${s}: estatísticas ${d}/${n}… · ${used()} requisições`));
          if (s >= S - 1) ms = await api.attachHalfCorners(L.lg.id, s, ms, null, { onlyCached: true });
          matches = matches.concat(ms);
        } catch (e) { if (s === S) throw e; }
      }
    } catch (e) { skipped.push(...L.fixtures.map(f => ({ fx: f, why: `liga não carregou: ${e.message}` }))); continue; }
    onProgress(`${L.lg.name}: medindo favoritismo × escanteios na liga… · ${used()} requisições`);
    const fv = favorFor(matches);
    matches = fv.matches;
    favorBy.set(L.lg.id, fv.cal);
    base.set(L.lg.id, matches);
    for (const fx of L.fixtures) {
      const a = analyze(fx, matches, oddsOf(fx), banca, false, fv.cal);
      if (a.skip) skipped.push({ fx, why: a.skip, thin: a.thin }); else games.push(a);
    }
  }

  // Jogos cuja liga não tem histórico dos times: base pelos jogos dos times, um conjunto por torneio
  const byLeague = new Map();
  for (const s of skipped.filter(x => x.thin)) {
    if (!byLeague.has(s.fx.league.id)) byLeague.set(s.fx.league.id, []);
    byLeague.get(s.fx.league.id).push(s);
  }
  for (const group of [...byLeague.values()].sort((a, b) => b.length - a.length)) {
    const fxs = group.map(s => s.fx), lg = fxs[0].league;
    const cost = fxs.length * 2 * TEAM_COST;
    if (used() + cost > budget) { group.forEach(s => { s.why = 'times sem histórico na liga; base pelos times fora do orçamento'; }); continue; }
    onProgress(`${lg.name}: montando a base pelos jogos dos times… · ${used()} requisições`);
    let matches;
    try { matches = await teamPool(api, fxs, lg.season, t => onProgress(`${lg.name}: ${t} · ${used()} requisições`)); }
    catch (e) { group.forEach(s => { s.why = `base pelos times falhou: ${e.message}`; }); continue; }
    const fvp = favorFor(matches);
    matches = fvp.matches;
    favorBy.set(`tp${lg.id}`, fvp.cal);   // à parte da base da liga: os outros jogos da liga seguem nela
    base.set(`tp${lg.id}`, matches);
    for (const s of group) {
      const a = analyze(s.fx, matches, oddsOf(s.fx), banca, true, fvp.cal);
      if (a.skip) s.why = `${a.skip}, mesmo somando todas as competições`;
      else { games.push(a); skipped.splice(skipped.indexOf(s), 1); }
    }
  }

  // 2ª passada: histórico do 1º tempo dos dois times nos jogos com mais valor nos escanteios do 1º tempo
  const short = rankGames(games, { market: 'Total escanteios 1T' }).filter(x => x.line.value_pct > 0).slice(0, Math.ceil(top * 1.5));
  let gi = 0;
  for (const { g } of short) {
    gi++;
    const missing = g.teams.reduce((n, t) => n + t.games.filter(x => !x.c1).length, 0);
    if (missing && used() + Math.min(missing, 2 * TEAM_COST) > budget) { g.no_history = 'sem histórico do 1º tempo (orçamento)'; continue; }
    if (!missing) continue;
    onProgress(`Histórico do 1º tempo ${gi}/${short.length}: ${g.fx.home.name} x ${g.fx.away.name} · ${used()} requisições`);
    const key = g.team_base ? `tp${g.fx.league.id}` : g.fx.league.id;
    const matches = base.get(key), byId = new Map(matches.map(m => [m.id, m]));
    try {
      for (const t of [g.fx.home, g.fx.away]) {
        const last = matches.filter(m => (m.h === t.id || m.a === t.id) && m.t < g.fx.t).sort((x, y) => y.t - x.t).slice(0, 10);
        const withC1 = await api.attachHalfCorners(`tm${t.id}`, g.fx.league.season, last);
        for (const m of withC1) if (m.c1 && byId.has(m.id)) byId.get(m.id).c1 = m.c1;
      }
      const a = analyze(g.fx, matches, oddsOf(g.fx), banca, g.team_base, favorBy.get(key));
      if (!a.skip) Object.assign(g, a);
    } catch (e) { g.no_history = `histórico do 1º tempo falhou: ${e.message}`; }
  }

  // Guardados: os N melhores de cada filtro da tela (as linhas principais e cada mercado), na ordem das
  // linhas principais (jogo só com handicap jogável vai para o fim).
  const keep = new Set();
  for (const market of [null, ...SCAN_MARKETS]) for (const { g } of rankGames(games, { market }).slice(0, top)) keep.add(g);
  const pos = new Map(rankGames([...keep]).map((x, i) => [x.g, i]));
  const ranked = [...keep].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
  // v 2: valor nas linhas principais (a tela avisa quando a varredura guardada é de antes)
  return { v: 2, date, generated_at: new Date().toISOString(), requests: used(), budget, top, fixtures: fixtures.length,
    with_odds: pool.length, with_1h: pool.filter(has1h).length, analyzed: games.length, games: ranked, skipped };
}
