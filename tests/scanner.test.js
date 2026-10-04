import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { HANDICAP, MAIN_MARKETS, SCAN_MARKETS, bestLine, rankGames, scanDay } from '../src/scanner.js';
import { isMain, isMainLine, isUnder, rankTier } from '../src/consistency.js';
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

test('varredura: maior chance de ganho nas linhas principais, só com preço da Pinnacle', async () => {
  const api = demoApi();
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.v, 3);
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 10);
  // guardados: os 5 melhores de cada filtro da tela
  const filters = [null, ...SCAN_MARKETS];
  assert.ok(scan.games.length > 0 && scan.games.every(g => filters.some(market => rankGames(scan.games, { market }).slice(0, 5).some(x => x.g === g))));
  const lines = scan.games.flatMap(g => g.lines);
  // só as linhas principais com preço da Pinnacle: escanteios 1T 4/4,5/5 e jogo 8/8,5/9 (over e under), gols 1T 1,5 e
  // jogo 1,5/2,5 (só over) e o handicap de escanteios do jogo
  assert.ok(lines.every(l => isMainLine(l) && l.priced_by === 'pinnacle'));
  assert.ok(!lines.some(l => /^(c1[OU]3\.5|corners[OU]7|gU|g1U)/.test(l.id) || ['Handicap escanteios 1T', 'Handicap asiático'].includes(l.market)));
  for (const id of ['c1O5', 'c1U4.5', 'cornersO9', 'cornersU8.5', 'g1O1.5', 'gO2.5']) assert.ok(lines.some(l => l.id === id), id);
  for (const m of MAIN_MARKETS.concat(HANDICAP)) assert.ok(lines.some(l => l.market === m), m);
  // gols do 1º tempo vêm da Pinnacle (mercado 6) e do placar do 1º tempo dos jogos passados
  const g1 = lines.find(l => l.id === 'g1O1.5');
  assert.ok(g1 && g1.history.home.n > 0 && g1.history.home.what === 'gols no 1º tempo');
  // ordem: candidatas primeiro; entre elas o nível nunca melhora ao descer (under de escanteios sem desconto)
  const ranked = rankGames(scan.games), cands = ranked.map(x => isCandidate(x.line));
  assert.deepEqual(cands, [...cands].sort((a, b) => b - a));
  const tiers = ranked.filter(x => isCandidate(x.line)).map(x => rankTier(x.line));
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
  assert.ok(ranked.every(x => x.line.odd_min >= 1.5 && x.line.odd_min <= 3));
  assert.ok(api.halfAsked.length > 0 && api.halfAsked.every(s => /^tm\d+$/.test(s)));
});

test('sem escanteios do 1º tempo na Pinnacle: seguem escanteios do jogo e gols', async () => {
  const base = demoApi();
  const no77 = () => demo.dayOdds().map(o => ({ ...o, bookmakers: o.bookmakers.map(b => ({ ...b, bets: b.bets.filter(x => x.id !== 77) })) }));
  const scan = await scanDay({ ...base, dayOdds: no77 }, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 0);
  assert.ok(scan.games.length > 0);
  for (const g of scan.games) {
    assert.equal(g.pinnacle_1h, null);
    assert.ok(g.lines.every(l => l.market !== 'Total escanteios 1T'), 'sem o total 1T da Pinnacle não há linha do 1º tempo');
  }
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols 1T')), 'gols do 1º tempo continuam');
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
    assert.ok(g.lines.length && g.lines.every(l => ['Total de gols', 'Total de gols 1T'].includes(l.market)));
    assert.equal(g.pinnacle_1h, null);
    assert.equal(g.alerts.length, 0, 'a falta de escanteios não deixa as linhas de gols frágeis');
  }
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols' && !l.fragile)));
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

test('linha do jogo: candidata primeiro, depois a mais consistente; under de escanteios das linhas principais vale igual', () => {
  const L = (id, market, tier, score, extra = {}) => ({ id, market, tier, consistency_score: score, odd_min: 1.7, politica_e: 'cheia',
    fragile: false, odd_min_vs_pinnacle_pct: 2, ...extra });
  const o25 = L('gO2.5', 'Total de gols', 'sólida', 0.58), u85 = L('cornersU8.5', 'Total de escanteios', 'sólida', 0.62);
  assert.equal(bestLine([o25, u85]).id, 'cornersU8.5', 'under de escanteios sólida, sem desconto, com mais chance');
  assert.equal(bestLine([o25, { ...u85, odd_min_vs_pinnacle_pct: 7 }]).id, 'gO2.5', 'preço difícil perde a vez para a candidata');
  const hcp = L('chA1.5', 'Handicap de escanteios', 'âncora', 0.7);
  assert.equal(bestLine([hcp, o25]).id, 'chA1.5', 'handicap de escanteios do jogo entra na linha do jogo');
  assert.equal(bestLine([hcp, o25], { market: 'Total de gols' }).id, 'gO2.5');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'âncora', 0.7, { odd_min: 1.4 })]), null, 'odd mínima abaixo de 1,50 fica de fora');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'âncora', 0.7, { odd_min: 3.4, politica_e: 'não entrar' })]), null, 'acima de 3,00 também');
});
