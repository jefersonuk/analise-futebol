import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, dist, ev, fairOdd, politicaE, teamRates } from '../src/model.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const game = (home, gf, ga, cf, ca) => ({
  home, goals: { f: gf, a: ga }, corners: { f: cf, a: ca },
  shots: { f: 12, a: 10 }, sot: { f: 4, a: 3 },
});
const strong = [game(true, 3, 0, 8, 3), game(false, 2, 1, 6, 4), game(true, 2, 0, 7, 2), game(false, 1, 1, 5, 5), game(true, 4, 1, 9, 3)];
const weak = [game(false, 0, 2, 3, 7), game(true, 1, 1, 4, 5), game(false, 0, 3, 2, 8), game(true, 1, 2, 5, 6), game(false, 1, 2, 3, 6)];

test('dist soma 1 e tem a média pedida (Poisson e binomial negativa)', () => {
  for (const phi of [1, 1.8]) {
    const p = dist(10, phi, 80);
    near(p.reduce((s, x) => s + x, 0), 1, 1e-6);
    near(p.reduce((s, x, k) => s + x * k, 0), 10, 1e-4);
  }
});

test('binomial negativa tem variância phi*mu', () => {
  const p = dist(10, 1.8, 120);
  near(p.reduce((s, x, k) => s + x * (k - 10) ** 2, 0), 18, 1e-3);
});

test('teamRates pondera o mando em dobro', () => {
  const g = [game(true, 3, 0, 5, 5), game(false, 0, 0, 5, 5), game(false, 0, 0, 5, 5)];
  near(teamRates(g, true).goals.f.mean, 6 / 4);
  near(teamRates(g, false).goals.f.mean, 3 / 5);
});

test('1X2 soma 1 e o time forte é favorito', () => {
  const { lines } = analyze(strong, weak);
  const p = id => lines.find(l => l.id === id)?.pWin ?? 0;
  const all = analyze(strong, weak).lines.filter(l => l.market === '1X2');
  assert.ok(p('1') > 0.5);
  assert.ok(all.every(l => l.pWin >= 0.2 && l.pWin <= 0.8));
});

test('over e under da mesma linha são complementares', () => {
  const { lines } = analyze(strong, strong);
  const o = lines.find(l => l.id === 'gO2.5'), u = lines.find(l => l.id === 'gU2.5');
  near(o.pWin + u.pWin, 1);
  const co = lines.find(l => l.id.startsWith('cornersO')), cu = lines.find(l => l.id === co.id.replace('O', 'U'));
  near(co.pWin + cu.pWin, 1);
});

test('handicap inteiro desconta o push; odd justa zera o EV', () => {
  const { lines } = analyze(strong, strong);
  const dnb = lines.find(l => l.id === 'ahH0');
  assert.ok(dnb.pWin + dnb.pLose < 1);
  near(ev(dnb, fairOdd(dnb)).mid, 0);
  assert.ok(ev(dnb, fairOdd(dnb)).low < 0);
});

test('sem estatísticas o mercado some, gols continua', () => {
  const bare = strong.map(g => ({ ...g, corners: null, shots: null, sot: null }));
  const { lines, exp } = analyze(bare, bare);
  assert.equal(exp.corners, null);
  assert.ok(lines.some(l => l.market === 'Gols'));
  assert.ok(!lines.some(l => l.market === 'Escanteios'));
});

test('política E por faixa de odd', () => {
  assert.equal(politicaE(2.09).factor, 1);
  assert.equal(politicaE(2.1).factor, 0.5);
  assert.equal(politicaE(2.5).factor, 0.5);
  assert.equal(politicaE(3).factor, 0.25);
  assert.equal(politicaE(3.01).factor, 0);
});
