// Varredura do dia: os jogos em que a Pinnacle cota escanteios do 1º tempo, analisados pelo mesmo modelo
// do app, ordenados pela linha de escanteios do 1º tempo mais consistente de cada jogo.
//
// Custo (o que manda no desenho):
//   1. jogos do dia: 1 requisição; odds da Pinnacle do mercado 77 (total de escanteios 1T): 1 por 10 jogos
//   2. cada liga: ~60 requisições na primeira vez (3 temporadas com estatística), depois só o que é novo.
//      Os escanteios do 1º tempo da liga inteira (1 requisição por jogo) NÃO são baixados: a média do
//      1º tempo de cada time sai dos escanteios do jogo × fração do 1º tempo, e o total é ancorado na Pinnacle
//   3. os 1,5×N melhores jogos: escanteios do 1º tempo dos últimos 10 jogos de cada time (até 20
//      requisições por jogo na primeira vez; ficam guardados), que entram no histórico e na consistência
// O orçamento de requisições é respeitado: ligas e históricos que não cabem ficam de fora e são listados.

import { analyzeMatch, politicaE } from './model.js';
import { collect } from './odds.js';
import { recentGames } from './insights.js';
import { byConsistency, isCandidate, priceLines, seasonsFor } from './dossier.js';

export const SCAN_MARKETS = ['Total escanteios 1T', 'Handicap escanteios 1T'];
const LEAGUE_COST = 70, TEAM_COST = 10, MIN_GAMES = 8;
const r2 = x => Math.round(x * 100) / 100;

const playable = l => l.odd_min >= 1.5 && politicaE(l.odd_min).factor > 0;
// Melhor linha de um jogo: candidata (âncora/sólida) primeiro; senão a mais consistente jogável.
// market: um mercado ou null (os dois).
export function bestLine(lines, { market = null } = {}) {
  const pool = lines.filter(l => (market ? l.market === market : SCAN_MARKETS.includes(l.market)) && playable(l))
    .sort(byConsistency);
  return pool.find(isCandidate) || pool[0] || null;
}

function analyze(fx, matches, oddsP, banca) {
  const { odds, fair } = collect(oddsP.bookmakers);
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair, share1hBelow: 0.5 });
  if (!res.lines.length) return { skip: 'jogos insuficientes na liga' };
  const games = id => res.fits.corners?.games.get(id) || 0;
  const thin = [fx.home, fx.away].filter(t => games(t.id) < MIN_GAMES);
  if (thin.length) return { skip: `${thin.map(t => t.name).join(' e ')} com menos de ${MIN_GAMES} jogos na liga` };
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id) }));
  const ageMin = oddsP.updatedAt ? Math.round((Date.now() - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const alerts = ageMin > 90 ? [`odds da Pinnacle com ${ageMin} min`] : [];
  const { priced, anchored } = priceLines(res, { odds, fair, alerts, teams, banca, only: l => SCAN_MARKETS.includes(l.market) });
  const lines = priced.concat(anchored);
  const best = Object.fromEntries(SCAN_MARKETS.map(m => [m, bestLine(lines, { market: m })]));
  const a = res.anchors;
  return {
    fx, teams, lines, best, alerts, odds_age_min: ageMin,
    c1_known: teams.map(t => t.games.filter(g => g.c1).length),
    pinnacle_1h: a.corners1h ? { line: a.corners1h.from_line, total: r2(a.corners1h.pinnacle_total), model: r2(a.corners1h.model_total) } : null,
    share_1h: a.corners1hShare ? r2(a.corners1hShare.share) : null,
    expected_1h: res.pred.corners1h ? { home: r2(res.pred.corners1h.h), away: r2(res.pred.corners1h.a) } : null,
  };
}

// Ordem dos jogos: a melhor linha de cada um (no mercado pedido), candidatas primeiro,
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
  onProgress(`${fixtures.length} jogos ainda por começar. Buscando quais têm escanteios do 1º tempo na Pinnacle…`);
  const odds = new Map((await api.dayOdds(date, 77)).map(o => [o.fixture, o]));
  const pool = fixtures.filter(f => odds.has(f.id));
  const leagues = new Map();
  for (const f of pool) {
    const k = f.league.id;
    if (!leagues.has(k)) leagues.set(k, { lg: f.league, fixtures: [], cached: await api.hasLeague(k, f.league.season) });
    leagues.get(k).fixtures.push(f);
  }
  // ligas já guardadas primeiro (custo ~0), depois as com mais jogos
  const order = [...leagues.values()].sort((a, b) => b.cached - a.cached || b.fixtures.length - a.fixtures.length);

  // 1ª passada: modelo com a média do 1º tempo vinda dos escanteios do jogo
  const base = new Map(), games = [];
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
    base.set(L.lg.id, matches);
    for (const fx of L.fixtures) {
      const a = analyze(fx, matches, { ...odds.get(fx.id), fetchedAt: Date.now() }, banca);
      if (a.skip) skipped.push({ fx, why: a.skip }); else games.push(a);
    }
  }

  // 2ª passada: histórico do 1º tempo dos dois times nos jogos mais promissores
  const short = rankGames(games).slice(0, Math.ceil(top * 1.5));
  let gi = 0;
  for (const { g } of short) {
    gi++;
    const missing = g.teams.reduce((n, t) => n + t.games.filter(x => !x.c1).length, 0);
    if (missing && used() + Math.min(missing, 2 * TEAM_COST) > budget) { g.no_history = 'sem histórico do 1º tempo (orçamento)'; continue; }
    if (!missing) continue;
    onProgress(`Histórico do 1º tempo ${gi}/${short.length}: ${g.fx.home.name} x ${g.fx.away.name} · ${used()} requisições`);
    const matches = base.get(g.fx.league.id), byId = new Map(matches.map(m => [m.id, m]));
    try {
      for (const t of [g.fx.home, g.fx.away]) {
        const last = matches.filter(m => (m.h === t.id || m.a === t.id) && m.t < g.fx.t).sort((x, y) => y.t - x.t).slice(0, 10);
        const withC1 = await api.attachHalfCorners(`tm${t.id}`, g.fx.league.season, last);
        for (const m of withC1) if (m.c1 && byId.has(m.id)) byId.get(m.id).c1 = m.c1;
      }
      Object.assign(g, analyze(g.fx, matches, { ...odds.get(g.fx.id), fetchedAt: Date.now() }, banca));
    } catch (e) { g.no_history = `histórico do 1º tempo falhou: ${e.message}`; }
  }

  const ranked = rankGames(games).slice(0, top).map(x => x.g);
  return { date, generated_at: new Date().toISOString(), requests: used(), budget, fixtures: fixtures.length, with_odds: pool.length,
    analyzed: games.length, games: ranked, skipped };
}
