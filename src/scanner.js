// Varredura do dia: todos os jogos por começar com odds da Pinnacle, analisados pelo mesmo modelo do app.
// A linha de cada jogo é a de escanteios do 1º tempo quando a Pinnacle cota o 1º tempo e há candidata
// nele; senão, a mais consistente de gols e escanteios do jogo (totais e handicaps). Liga sem estatística
// de escanteios na API (USL Championship, Liga de Expansión, Primera B…) entra só com os mercados de gols.
//
// Custo (o que manda no desenho):
//   1. jogos do dia: 1 requisição; odds da Pinnacle de todos os mercados lidos: 1 por 10 jogos (nenhuma
//      busca jogo a jogo)
//   2. cada liga: ~60 requisições na primeira vez (3 temporadas com estatística), depois só o que é novo.
//      Os escanteios do 1º tempo da liga inteira (1 requisição por jogo) NÃO são baixados: a média do
//      1º tempo de cada time sai dos escanteios do jogo × fração do 1º tempo, e o total é ancorado na Pinnacle
//   3. os 1,5×N melhores jogos no 1º tempo: escanteios do 1º tempo dos últimos 10 jogos de cada time (até 20
//      requisições por jogo na primeira vez; ficam guardados), que entram no histórico e na consistência
// O orçamento de requisições é respeitado: ligas e históricos que não cabem ficam de fora e são listados.

import { analyzeMatch, politicaE } from './model.js';
import { collect } from './odds.js';
import { recentGames } from './insights.js';
import { FRIENDLIES, byConsistency, contraAlert, favorSummary, isCandidate, priceLines, rolesNow, seasonsFor } from './dossier.js';
import { favorFor } from './favoritism.js';
import { underOk } from './consistency.js';

export const H1_MARKETS = ['Total escanteios 1T', 'Handicap escanteios 1T'];
export const GOAL_MARKETS = ['Total de gols', 'Handicap asiático'];
export const CORNER_MARKETS = ['Total de escanteios', 'Handicap de escanteios'];
export const ALL_MARKETS = H1_MARKETS.concat(GOAL_MARKETS, CORNER_MARKETS);
export const EXTRA_MARKETS = ['Total de gols', 'Total de escanteios'];   // colunas da tabela
export const H1 = '1T';   // filtro dos dois mercados do 1º tempo
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

// jogável: odd mínima na faixa operada, linha que o mercado oferece (não "favorito +x") e over primeiro
// (under só âncora, como nas candidatas)
const playable = l => l.odd_min >= 1.5 && politicaE(l.odd_min).factor > 0 && !l.inviable && underOk(l);
// Melhor linha de um jogo: candidata (âncora/sólida) primeiro; senão a mais consistente jogável.
// market: um mercado, H1 (os dois do 1º tempo) ou null (a do jogo: o 1º tempo quando há candidata nele,
// senão a mais consistente de todos os mercados da varredura).
export function bestLine(lines, { market = null } = {}) {
  const pick = ms => {
    const pool = lines.filter(l => ms.includes(l.market) && playable(l)).sort(byConsistency);
    return pool.find(isCandidate) || pool[0] || null;
  };
  if (market === H1) return pick(H1_MARKETS);
  if (market) return pick([market]);
  const h1 = pick(H1_MARKETS);
  return h1 && isCandidate(h1) ? h1 : pick(ALL_MARKETS);
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
  const markets = noCorners ? GOAL_MARKETS : ALL_MARKETS;
  const now = rolesNow(res.favor);
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id), roleNow: now[role] }));
  const ageMin = oddsP.updatedAt ? Math.round((Date.now() - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const alerts = ageMin > 90 ? [`odds da Pinnacle com ${ageMin} min`] : [];
  if (teamBase) alerts.push('base: jogos dos dois times em todas as competições (amostra menor que a de uma liga)');
  const names = { home: fx.home.name, away: fx.away.name }, contra = !noCorners && contraAlert(res.favor, names);
  if (contra) alerts.push(contra);
  const { priced, anchored } = priceLines(res, { odds, fair, alerts, teams, banca, only: l => markets.includes(l.market) });
  const lines = priced.concat(anchored);
  const best = Object.fromEntries(ALL_MARKETS.map(m => [m, bestLine(lines, { market: m })]));
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

// Ordem dos jogos: a melhor linha de cada um (no filtro pedido), candidatas primeiro,
// depois consistência.
export function rankGames(games, opts = {}) {
  return games.map(g => ({ g, line: bestLine(g.lines, opts) })).filter(x => x.line)
    .sort((a, b) => isCandidate(b.line) - isCandidate(a.line) || byConsistency(a.line, b.line));
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

  // 2ª passada: histórico do 1º tempo dos dois times nos jogos mais promissores no 1º tempo
  const short = rankGames(games, { market: H1 }).slice(0, Math.ceil(top * 1.5));
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

  // Guardados: os N melhores de cada filtro da tela (o do jogo, o 1º tempo e cada mercado), na ordem do
  // filtro do jogo.
  const keep = new Set();
  for (const market of [null, H1, ...ALL_MARKETS]) for (const { g } of rankGames(games, { market }).slice(0, top)) keep.add(g);
  // de cada jogo, só as linhas que a tela e o especialista mostram (odd mínima de 1,40 a 3,00, oferecida pelo mercado)
  for (const g of keep) g.lines = g.lines.filter(l => !l.inviable && l.odd_min >= 1.4 && l.odd_min <= 3);
  const ranked = rankGames([...keep]).map(x => x.g);
  return { date, generated_at: new Date().toISOString(), requests: used(), budget, top, fixtures: fixtures.length,
    with_odds: pool.length, with_1h: pool.filter(has1h).length, analyzed: games.length, games: ranked, skipped };
}
