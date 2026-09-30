import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMatch, dist, ev, fairOdd, politicaE, scoreMatrix, settle } from '../src/model.js';
import { fit, predict, prepare } from '../src/ratings.js';
import { leagueMatches } from '../src/demo.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const sum = e => e.reduce((s, [, p]) => s + p, 0);

function rng(seed) { let x = seed; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function pois(r, mu) { const l = Math.exp(-mu); let k = 0, p = r(); while (p > l) { k++; p *= r(); } return k; }
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};

// Liga sintética só com gols, forças conhecidas, 3 turnos completos.
function synthLeague(n = 16) {
  const r = rng(42), att = [], def = [], m = [];
  for (let i = 0; i < n; i++) { att.push(0.6 + r() * 0.8); def.push(0.6 + r() * 0.8); }
  let t = 0;
  for (let rep = 0; rep < 3; rep++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    m.push({ id: m.length, t: (t += 3600e3), h: i, a: j, hg: pois(r, 1.5 * att[i] * def[j]), ag: pois(r, 1.1 * att[j] * def[i]), s: null });
  }
  return { att, def, m, end: t + 1 };
}

test('dist soma 1, tem a média pedida e variância phi*mu', () => {
  for (const phi of [1, 1.8]) {
    const p = dist(10, phi, 120);
    near(p.reduce((s, x) => s + x, 0), 1, 1e-6);
    near(p.reduce((s, x, k) => s + x * k, 0), 10, 1e-4);
    near(p.reduce((s, x, k) => s + x * (k - 10) ** 2, 0), 10 * phi, 1e-3);
  }
});

test('matriz Dixon-Coles soma 1 e rho negativo aumenta o empate', () => {
  const dc = scoreMatrix(1.3, 1.1), ind = scoreMatrix(1.3, 1.1, 0);
  near(sum(dc.diff), 1); near(sum(dc.tot), 1);
  const draw = m => m.diff.find(([d]) => d === 0)[1];
  assert.ok(draw(dc) > draw(ind));
});

test('linha de quarto = média das meias-linhas vizinhas; linha inteira devolve no empate', () => {
  const { diff } = scoreMatrix(1.6, 1.0);
  const q = settle(diff, -0.75), a = settle(diff, -0.5), b = settle(diff, -1);
  near(q.pWin, (a.pWin + b.pWin) / 2); near(q.pLose, (a.pLose + b.pLose) / 2);
  const dnb = settle(diff, 0);
  assert.ok(dnb.pWin + dnb.pLose < 1);
  near(ev({ ...dnb, sc: [dnb] }, fairOdd(dnb)).mid, 0);
});

test('ajuste da liga recupera as forças verdadeiras', () => {
  const L = synthLeague();
  const f = fit('goals', prepare(L.m, L.end));
  const ids = L.att.map((_, i) => i);
  assert.ok(corr(ids.map(i => f.att.get(i)), L.att) > 0.85);
  assert.ok(corr(ids.map(i => f.def.get(i)), L.def) > 0.85);
  near(f.home, 1.5 / 1.1, 0.15);
});

test('shrinkage: time com um só jogo fica perto da média', () => {
  const L = synthLeague();
  L.m.push({ id: -1, t: L.end - 1, h: 99, a: 0, hg: 6, ag: 0, s: null });
  const f = fit('goals', prepare(L.m, L.end));
  assert.ok(f.att.get(99) < 1.4, `att=${f.att.get(99)}`);
  const p = predict(f, 99, 0);
  assert.ok(p.seH > predict(f, 1, 0).seH);
});

test('análise completa na liga demo: 1X2 soma 1, totais complementares, dispersão limitada', () => {
  const matches = leagueMatches(2025).concat(leagueMatches(2024));
  const res = analyzeMatch(matches, 9001, 9002, Date.UTC(2026, 0, 10));
  const p = id => res.lines.find(l => l.id === id);
  near(sum(scoreMatrix(res.pred.goals.h, res.pred.goals.a).diff), 1);
  const o = p('gO2.5'), u = p('gU2.5');
  if (o && u) near(o.pWin + u.pWin, 1);
  assert.ok(res.phi.corners >= 1 && res.phi.corners <= 1.35);
  assert.ok(res.lines.some(l => l.market === 'Total de escanteios'));
  assert.ok(res.prep.coverage === 1);
});

test('toda linha tem os 4 cenários de incerteza, mesmo com média perto de x,5', () => {
  const matches = leagueMatches(2025).concat(leagueMatches(2024));
  for (let a = 9002; a <= 9020; a++) {
    const res = analyzeMatch(matches, 9001, a, Date.UTC(2026, 0, 10));
    for (const l of res.lines) assert.ok(l.sc.length === 4 && l.sc.every(Boolean), l.id);
    assert.ok(res.lines.some(l => l.id.startsWith('cornersO')));
    assert.deepEqual(res.lines.filter(l => l.market === '1X2').map(l => l.id), ['1', 'X', '2']);
  }
});

test('política E por faixa de odd', () => {
  assert.equal(politicaE(2.09).factor, 1);
  assert.equal(politicaE(2.1).factor, 0.5);
  assert.equal(politicaE(2.5).factor, 0.5);
  assert.equal(politicaE(3).factor, 0.25);
  assert.equal(politicaE(3.01).factor, 0);
});
