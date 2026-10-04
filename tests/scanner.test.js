import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { HANDICAP, MAIN_MARKETS, SCAN_MARKETS, bestLine, rankGames, scanDay } from '../src/scanner.js';
import { isMain, isUnder, isValueBet } from '../src/consistency.js';

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

test('varredura: valor nas linhas principais, só com preço da Pinnacle', async () => {
  const api = demoApi();
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.v, 2);
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 10);
  // guardados: os 5 melhores de cada filtro da tela
  const filters = [null, ...SCAN_MARKETS];
  assert.ok(scan.games.length > 0 && scan.games.every(g => filters.some(market => rankGames(scan.games, { market }).slice(0, 5).some(x => x.g === g))));
  const lines = scan.games.flatMap(g => g.lines);
  // só as linhas principais (escanteios 1T 4/4,5, jogo 8/8,5, gols 1T 1,5, gols 1,5/2,5) e o handicap de escanteios do jogo
  assert.ok(lines.every(l => (isMain(l.id) || l.market === HANDICAP) && l.priced_by === 'pinnacle'));
  assert.ok(!lines.some(l => /^(c1O3\.5|cornersO7)/.test(l.id) || l.market === 'Handicap escanteios 1T' || l.market === 'Handicap asiático'));
  for (const m of MAIN_MARKETS) assert.ok(lines.some(l => l.market === m), m);
  assert.ok(lines.every(l => typeof l.value_pct === 'number' && ['confirmado', 'sem confirmação', 'sem valor'].includes(l.value_level)));
  // gols do 1º tempo vêm da Pinnacle (mercado 6) e do placar do 1º tempo dos jogos passados
  const g1 = lines.find(l => l.id === 'g1O1.5');
  assert.ok(g1 && g1.history.home.n > 0 && g1.history.home.what === 'gols no 1º tempo');
  // linha do jogo: sempre uma linha principal; apostas de valor primeiro; under só quando é aposta
  const ranked = rankGames(scan.games);
  assert.ok(ranked.every(x => MAIN_MARKETS.includes(x.line.market) && (!isUnder(x.line.id) || isValueBet(x.line))));
  const bets = ranked.map(x => isValueBet(x.line));
  assert.deepEqual(bets, [...bets].sort((a, b) => b - a));
  // histórico do 1º tempo buscado só para os times, e só nos jogos com valor nos escanteios do 1º tempo
  assert.ok(api.halfAsked.every(s => /^tm\d+$/.test(s)));
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

test('linha do jogo: aposta de valor primeiro, depois mais valor; under só como aposta; handicap só no filtro dele', () => {
  const L = (id, market, level, value, extra = {}) => ({ id, market, value_level: level, value_pct: value, odd_min: 1.8, politica_e: 'cheia',
    odd_min_vs_pinnacle_pct: 2, ...extra });
  const g25 = L('gO2.5', 'Total de gols', 'sem confirmação', 4), c45 = L('c1O4.5', 'Total escanteios 1T', 'confirmado', 2.5);
  assert.equal(bestLine([g25, c45]).id, 'c1O4.5', 'valor confirmado antes de valor maior sem confirmação');
  assert.equal(bestLine([g25, L('cornersO8.5', 'Total de escanteios', 'sem confirmação', 5)]).id, 'cornersO8.5', 'mesmo nível: mais valor');
  const under = L('gU2.5', 'Total de gols', 'confirmado', 3), over = L('gO1.5', 'Total de gols', 'sem valor', -1);
  assert.equal(bestLine([under, over], { market: 'Total de gols' }).id, 'gO1.5', 'under com +3% não aparece');
  assert.equal(bestLine([{ ...under, value_pct: 5 }, over], { market: 'Total de gols' }).id, 'gU2.5', 'under confirmado com +5% é aposta');
  const hcp = L('chA1.5', 'Handicap de escanteios', 'confirmado', 6);
  assert.equal(bestLine([hcp, g25]).id, 'gO2.5', 'handicap fica fora da linha do jogo');
  assert.equal(bestLine([hcp, g25], { market: HANDICAP }).id, 'chA1.5');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'confirmado', 3, { odd_min: 3.4, politica_e: 'não entrar' })]), null, 'odd acima de 3,00 fica de fora');
});
