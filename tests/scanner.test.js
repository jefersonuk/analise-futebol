import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { SCAN_MARKETS, isAsian, rankGames, scanDay } from '../src/scanner.js';
import { TIER_ORDER } from '../src/consistency.js';

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

test('varredura: ranking pela linha de escanteios do 1º tempo mais consistente, com histórico dos times', async () => {
  const api = demoApi();
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.with_odds, 10);
  assert.ok(scan.games.length > 0 && scan.games.length <= 5);
  for (const g of scan.games) {
    assert.ok(SCAN_MARKETS.some(m => g.best[m]));
    assert.ok(g.pinnacle_1h, 'total 1T ancorado na Pinnacle');
    assert.ok(g.share_1h > 0.3 && g.share_1h < 0.6, 'média do 1º tempo pela fração dos escanteios do jogo');
  }
  // histórico do 1º tempo buscado só para os times dos jogos mais promissores
  assert.ok(api.halfAsked.length > 0 && api.halfAsked.every(s => /^tm\d+$/.test(s)));
  assert.ok(scan.games[0].c1_known.every(n => n > 0));
  // ordem: nível de consistência nunca piora ao descer o ranking entre candidatas
  const ranked = rankGames(scan.games).map(x => x.line);
  // linhas asiáticas do 1º tempo: quartos existem e o filtro só deixa inteiras e de quarto
  assert.ok(scan.games[0].lines.some(l => /^c1(O|U|h[HA])-?\d+\.(25|75)$/.test(l.id)));
  assert.ok(rankGames(scan.games, { asian: true }).every(x => isAsian(x.line.id)));
  assert.equal(isAsian('c1O4.5'), false); assert.equal(isAsian('c1hH-0.75'), true); assert.equal(isAsian('c1U4'), true);
  for (let i = 1; i < ranked.length; i++) assert.ok(TIER_ORDER[ranked[i - 1].tier] <= TIER_ORDER[ranked[i].tier] || ranked[i - 1].tier === 'âncora');
});

test('varredura respeita o orçamento: liga nova que não cabe fica de fora', async () => {
  const api = { ...demoApi(), hasLeague: () => false };
  const scan = await scanDay(api, { date: '2026-10-01', budget: 10 });
  assert.equal(scan.games.length, 0);
  assert.ok(scan.skipped.length > 0 && scan.skipped.every(s => /orçamento/.test(s.why)));
});
