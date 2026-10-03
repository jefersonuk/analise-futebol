import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { ALL_MARKETS, EXTRA_MARKETS, GOAL_MARKETS, H1, H1_MARKETS, bestLine, rankGames, scanDay } from '../src/scanner.js';
import { rankTier } from '../src/consistency.js';
import { isCandidate } from '../src/dossier.js';

// Demo sem os escanteios do 1º tempo da liga (como na varredura real): só os dos times, sob demanda.
function demoApi({ noHalf = true } = {}) {
  let n = 0;
  const strip = ms => ms.map(m => (noHalf ? { ...m, c1: undefined } : m));
  const halfAsked = [];
  return {
    ...demo,
    stats: () => ({ api: n, cache: 0 }),
    leagueMatches: (id, s) => { n += 1; return strip(demo.leagueMatches(id, s)); },
    attachHalfCorners: (scope, season, ms, _p, opts = {}) => {
      if (opts.onlyCached) return ms;
      halfAsked.push(scope); n += ms.length;
      const full = new Map(demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1)).map(m => [m.id, m]));
      return ms.map(m => ({ ...m, c1: full.get(m.id)?.c1 ?? null }));
    },
    halfAsked,
  };
}

test('varredura: 1º tempo primeiro, gols e escanteios do jogo quando o 1º tempo não tem candidata', async () => {
  const api = demoApi();
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 10);
  assert.equal(scan.top, 5);
  // guardados: os 5 melhores de cada filtro da tela
  const filters = [null, H1, ...ALL_MARKETS];
  assert.ok(scan.games.length > 0 && scan.games.every(g => filters.some(market => rankGames(scan.games, { market }).slice(0, 5).some(x => x.g === g))));
  for (const g of scan.games) {
    assert.ok(g.pinnacle_1h, 'total 1T ancorado na Pinnacle');
    assert.ok(g.share_1h > 0.3 && g.share_1h < 0.6, 'média do 1º tempo pela fração dos escanteios do jogo');
  }
  // histórico do 1º tempo buscado só para os times dos jogos mais promissores no 1º tempo
  const h1 = rankGames(scan.games, { market: H1 });
  assert.ok(h1.length > 0 && h1.every(x => H1_MARKETS.includes(x.line.market)));
  assert.ok(api.halfAsked.length > 0 && api.halfAsked.every(s => /^tm\d+$/.test(s)));
  assert.ok(h1[0].g.c1_known.every(n => n > 0));
  // linha de cada jogo: a do 1º tempo quando ela é candidata; senão a mais consistente dos mercados da varredura
  for (const { g, line } of rankGames(scan.games)) {
    const best1h = bestLine(g.lines, { market: H1 });
    if (best1h && isCandidate(best1h)) assert.equal(line.id, best1h.id);
    else assert.ok(ALL_MARKETS.includes(line.market));
  }
  // gols e escanteios do jogo (totais e handicaps) com preço da Pinnacle, vindo das odds do dia
  for (const m of EXTRA_MARKETS) assert.ok(scan.games.some(g => g.best[m]), m);
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols' && l.priced_by === 'pinnacle')));
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Handicap asiático' && l.priced_by === 'pinnacle')));
  assert.ok(rankGames(scan.games, { market: 'Total de gols' }).every(x => x.line.market === 'Total de gols'));
  // linhas do 1º tempo de 0,5 em 0,5 (meias e inteiras), sem quartos
  assert.ok(scan.games.every(g => g.lines.filter(l => H1_MARKETS.includes(l.market)).every(l => Math.abs(parseFloat(l.id.match(/-?[\d.]+$/)[0]) * 2 % 1) < 1e-9)));
  assert.ok(h1[0].g.lines.some(l => /^c1(O|U)\d+$/.test(l.id)), 'linha inteira do total 1T');
  // ordem: entre candidatas, o nível nunca melhora ao descer o ranking
  const cands = rankGames(scan.games).map(x => x.line).filter(isCandidate);
  for (let i = 1; i < cands.length; i++) assert.ok(rankTier(cands[i - 1]) <= rankTier(cands[i]));
});

test('sem escanteios do 1º tempo na Pinnacle: o jogo entra pelos gols e escanteios do jogo', async () => {
  const base = demoApi();
  const no77 = () => demo.dayOdds().map(o => ({ ...o, bookmakers: o.bookmakers.map(b => ({ ...b, bets: b.bets.filter(x => x.id !== 77) })) }));
  const scan = await scanDay({ ...base, dayOdds: no77 }, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 0);
  assert.ok(scan.games.length > 0);
  for (const g of scan.games) {
    assert.equal(g.pinnacle_1h, null);
    assert.ok(g.lines.every(l => !H1_MARKETS.includes(l.market)), 'sem o total 1T da Pinnacle não há linha do 1º tempo');
  }
  assert.ok(rankGames(scan.games).every(x => ALL_MARKETS.includes(x.line.market) && !H1_MARKETS.includes(x.line.market)));
  assert.equal(base.halfAsked.length, 0, 'sem 1º tempo, nada de histórico do 1º tempo');
});

test('liga sem estatística de escanteios na API: o jogo entra só com os mercados de gols', async () => {
  const base = demoApi();
  const api = { ...base, leagueMatches: (id, s) => base.leagueMatches(id, s).map(m => ({ ...m, s: null })) };
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.ok(scan.games.length > 0, 'gols seguem analisados');
  assert.equal(scan.skipped.length, 0);
  for (const g of scan.games) {
    assert.match(g.no_corners, /não tem estatística de escanteios/);
    assert.ok(g.lines.length && g.lines.every(l => GOAL_MARKETS.includes(l.market)));
    assert.equal(g.pinnacle_1h, null);
    assert.equal(g.alerts.length, 0, 'a falta de escanteios não deixa as linhas de gols frágeis');
  }
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols' && l.priced_by === 'pinnacle' && !l.fragile)));
  assert.equal(base.halfAsked.length, 0);
});

test('varredura respeita o orçamento: liga nova que não cabe fica de fora', async () => {
  const api = { ...demoApi(), hasLeague: () => false };
  const scan = await scanDay(api, { date: '2026-10-01', budget: 10 });
  assert.equal(scan.games.length, 0);
  assert.ok(scan.skipped.length > 0 && scan.skipped.every(s => /orçamento/.test(s.why)));
});

test('seleções e copas: sem histórico na liga, a base vira os jogos dos times em todas as competições', async () => {
  const base = demoApi();
  const asked = [];
  const api = {
    ...base,
    leagueMatches: () => [],   // torneio sem jogos anteriores dos times (Nations League, copa)
    teamMatches: (id, s) => { asked.push(id); return demo.teamMatches(id, s).map(m => ({ ...m, c1: undefined })); },
  };
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.ok(scan.games.length > 0, 'jogos analisados pela base dos times');
  assert.ok(scan.games.every(g => g.team_base && g.alerts.some(a => /todas as competições/.test(a))));
  assert.ok(scan.games.every(g => g.lines.every(l => l.fragile)));
  assert.equal(new Set(asked).size, 20, 'todos os times dos jogos do torneio, juntos numa base');
});

test('linha do jogo: 1º tempo quando é candidata; senão o mercado mais consistente; under só âncora', () => {
  const L = (id, market, tier, extra = {}) => ({ id, market, tier, odd_min: 1.7, politica_e: 'cheia', consistency_score: 0.6, fragile: false,
    odd_min_vs_pinnacle_pct: 2, ...extra });
  const goals = L('gO2.5', 'Total de gols', 'âncora', { consistency_score: 0.7 });
  const h1 = L('c1O4.5', 'Total escanteios 1T', 'sólida', { fragile: true, odd_min_vs_pinnacle_pct: null });
  assert.equal(bestLine([goals, h1]).id, 'c1O4.5', 'candidata do 1º tempo vem primeiro');
  assert.equal(bestLine([goals, { ...h1, tier: 'especulativa' }]).id, 'gO2.5', 'sem candidata no 1º tempo, o mais consistente');
  assert.equal(bestLine([goals, h1], { market: H1 }).id, 'c1O4.5');
  const under = L('gU2.5', 'Total de gols', 'sólida', { consistency_score: 0.8 }), over = L('gO1.5', 'Total de gols', 'especulativa');
  assert.equal(bestLine([under, over], { market: 'Total de gols' }).id, 'gO1.5', 'under sólida nunca é a linha mostrada');
  assert.equal(bestLine([{ ...under, tier: 'âncora' }, over], { market: 'Total de gols' }).id, 'gU2.5', 'under âncora pode');
});
