import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { scoreGrid, scoreMatrix, marketSupremacy, impliedTotal } from '../src/model.js';
import { comboLines, comboOutcome, isCombo, liveCombo, parseCombo, settleCombo } from '../src/combos.js';
import { COMBOS, pickGames, rankGames, scanDay } from '../src/scanner.js';
import { isBet } from '../src/dossier.js';
import { liveLine, settleLine } from '../src/settlement.js';
import { marketOfId } from '../src/myline.js';
import { collect } from '../src/odds.js';

const names = { home: 'Alfa', away: 'Beta' };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('grade de placares: soma 1 e bate com a matriz Dixon-Coles do modelo', () => {
  const g = scoreGrid(1.6, 1.1), m = scoreMatrix(1.6, 1.1);
  near(g.reduce((s, x) => s + x[2], 0), 1, 1e-9, 'soma');
  for (const [d, p] of m.diff) near(g.filter(([i, j]) => i - j === d).reduce((s, x) => s + x[2], 0), p, 1e-9, `diferença ${d}`);
  for (const [t, p] of m.tot) near(g.filter(([i, j]) => i + j === t).reduce((s, x) => s + x[2], 0), p, 1e-9, `total ${t}`);
});

test('as pernas não são independentes: favorito vencendo anda junto com gols; dupla chance do azarão, não', () => {
  const g = scoreGrid(2.0, 0.8), c = id => parseCombo(id, names);
  const P = f => g.reduce((s, [i, j, p]) => s + (f(i, j) ? p : 0), 0);
  const corr = id => { const x = c(id); return P((i, j) => comboOutcome(x, i, j) === 1) / (P((i, j) => x.result.f(i, j) === 1) * P((i, j) => x.goals.f(i, j) === 1)); };
  assert.ok(corr('cb:1+gO2.5') > 1.05, `favorito vence + over: ${corr('cb:1+gO2.5')}`);
  assert.ok(corr('cb:X2+gO2.5') < 0.95, `azarão ou empate + over: ${corr('cb:X2+gO2.5')}`);
});

test('pernas e liquidação do combo no placar', () => {
  const c = id => parseCombo(id, names);
  assert.equal(c('cb:1+gO2.5').result.label, 'Alfa vence');
  assert.equal(c('cb:X2+gO1.5').goals.label, 'Mais de 1,5 gols');
  assert.equal(c('cb:gU2.5+gO1.5'), null, 'sem perna de resultado conhecida');
  assert.equal(c('cb:1+gU2.5'), null, 'só over de gols');
  const o = (id, h, a) => comboOutcome(c(id), h, a);
  assert.deepEqual([o('cb:1+gO2.5', 2, 1), o('cb:1+gO2.5', 1, 0), o('cb:1+gO2.5', 1, 2)], [1, -1, -1]);
  assert.deepEqual([o('cb:1X+gO1.5', 1, 1), o('cb:1X+gO1.5', 0, 0)], [1, -1]);
  // empate anula: empate com gols = vale só a perna de gols (0); empate sem gols suficientes = perde
  assert.deepEqual([o('cb:dnb1+gO2.5', 2, 2), o('cb:dnb1+gO2.5', 1, 1), o('cb:dnb1+gO2.5', 3, 0)], [0, -1, 1]);
  assert.deepEqual([o('cb:ahH-1.5+gO2.5', 2, 0), o('cb:ahH-1.5+gO2.5', 3, 1), o('cb:ahA1.5+gO2.5', 3, 2), o('cb:ahA1.5+gO2.5', 3, 1)], [-1, 1, 1, -1]);
  assert.deepEqual(settleCombo('cb:1+gO2.5', 3, 1, names).winner, 'A');
  const m = settleCombo('cb:dnb1+gO2.5', 2, 2, names);
  assert.ok(m.manual && m.winner === null && /vale só a perna de gols/.test(m.detail));
  assert.ok(isCombo('cb:12+gO2.5') && !isCombo('gO2.5'));
  assert.equal(marketOfId('cb:1+gO1.5'), 'Combo');
});

// jogo do demo com favorito claro: a matriz do mercado reproduz a Pinnacle, e as pernas andam juntas no favorito
function demoGame(pick) {
  const season = new Date().getUTCFullYear();
  const matches = demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1));
  const fx = demo.dayFixtures().map(f => ({ f, fair: collect(demo.fixtureOdds(f.id).bookmakers).fair })).sort(pick)[0];
  return { matches, ...fx };
}

test('combos de um jogo: chance da matriz da Pinnacle, correlação e as regras da lista', async () => {
  const { analyzeMatch } = await import('../src/model.js');
  const { recentGames } = await import('../src/insights.js');
  const { rolesNow } = await import('../src/dossier.js');
  const { matches, f: fx, fair } = demoGame((a, b) => b.fair.get('1') - a.fair.get('1'));   // o mandante mais favorito
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair });
  const now = rolesNow(res.favor);
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id), roleNow: now[role] }));
  const nm = { home: fx.home.name, away: fx.away.name };
  // a grade do mercado reproduz o 1X2 sem margem da Pinnacle
  const T = impliedTotal(fair, 'g', 1).implied_total, s = marketSupremacy(fair, T), mk = scoreGrid((T + s) / 2, (T - s) / 2);
  near(mk.filter(([i, j]) => i > j).reduce((t, x) => t + x[2], 0) - mk.filter(([i, j]) => i < j).reduce((t, x) => t + x[2], 0),
    fair.get('1') - fair.get('2'), 0.002, 'P(1) − P(2)');
  const cs = comboLines({ res, fair, teams, names: nm });
  assert.ok(cs.length, 'algum combo');
  for (const c of cs) {
    assert.ok(c.p_blend >= 0.6, `${c.line}: piso de 60%`);
    assert.ok(c.odd_min >= 1.5 && c.odd_min <= 3, `${c.line}: odd mínima ${c.odd_min}`);
    assert.ok(c.fair_odd_blend >= 1.1 * Math.max(...c.legs.map(x => x.fair_odd)) - 0.01, `${c.line}: a segunda perna sobe a odd`);
    assert.ok(/^gO/.test(c.legs[1].id), 'perna de gols só over');
    assert.ok(c.history.home && c.history.away, 'histórico dos dois times');
    assert.equal(c.market, 'Combo');
  }
  // favorito vencendo e jogo com gols andam juntos
  for (const c of cs.filter(x => ['1', 'dnb1', 'ahH-1.5'].includes(x.legs[0].id))) assert.ok(c.corr > 1, `${c.line}: correlação ${c.corr}`);
  // jogo difícil ou sem Pinnacle: sem combos
  assert.deepEqual(comboLines({ res, fair, teams, names: nm, hard: { reasons: ['x'] } }), []);
  assert.deepEqual(comboLines({ res, fair: new Map(), teams, names: nm }), []);
});

test('varredura: filtro Combos com os melhores combos, aposta primeiro; v 8', async () => {
  let n = 0;
  const api = { ...demo, stats: () => ({ api: n, cache: 0 }) };
  const scan = await scanDay(api, { date: '2026-10-01', top: 10, budget: 5000 });
  assert.equal(scan.v, 8);
  const r = rankGames(scan.games, { market: COMBOS });
  assert.ok(r.every(x => x.line.combo && x.g.combos.includes(x.line)));
  for (let i = 1; i < r.length; i++) assert.ok(isBet(r[i - 1].line) >= isBet(r[i].line), 'apostas primeiro');
  assert.ok(pickGames(scan.games, { market: COMBOS, top: 3 }).length <= 3);
  assert.ok(scan.games.filter(g => g.hard).every(g => !g.combos.length), 'jogo difícil sem combos');
});

test('conferência e ao vivo de um combo', () => {
  const game = { gf: 2, ga: 1, opp: 'Beta' };
  assert.equal(settleLine('cb:1+gO2.5', game, 'Alfa').winner, 'A');
  assert.equal(settleLine('cb:2+gO2.5', game, 'Alfa').winner, 'RED');
  const info = (goals, finished = false) => ({ home: 'Alfa', away: 'Beta', goals, finished, game: { gf: goals[0], ga: goals[1] } });
  const a = liveLine('cb:1+gO2.5', info([1, 0]));
  assert.deepEqual([a.need, a.locked, a.leg], [2, false, 'Alfa vence: ganha agora']);
  const b = liveCombo('cb:X2+gO1.5', info([2, 0]));
  assert.deepEqual([b.need, b.now, b.leg], [0, 'RED', 'Beta ou empate: perde agora']);
  assert.equal(liveLine('cb:1+gO2.5', info([3, 1], true)).locked, true);
});

test('entrada de um combo vai para o app de apostas com o id do combo (conferência automática)', async () => {
  const { buildEntry } = await import('../src/entry.js');
  const fx = { id: 9, t: Date.UTC(2026, 9, 7, 19), home: { name: 'Alfa' }, away: { name: 'Beta' }, league: { name: 'Liga' } };
  const line = { id: 'cb:1+gO1.5', market: 'Combo', combo: true, line: 'Alfa vence + Mais de 1,5 gols', tier: 'sólida', p_blend: 0.64, fair_odd_blend: 1.56, odd_min: 1.64, priced_by: 'combo' };
  const it = buildEntry({ line, fx, casa: 'Superbet', currency: 'BRL', odd: 1.8, stake: 100 });
  assert.equal(it.market, 'Combo (criar aposta)');
  assert.equal(it.event, 'Alfa x Beta — Combo: Alfa vence + Mais de 1,5 gols');
  assert.deepEqual([it.analise.lineId, it.analise.fixtureId], ['cb:1+gO1.5', 9]);
});
