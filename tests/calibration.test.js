import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { GOALS_N0, goalsCalibration } from '../src/favoritism.js';
import { analyzeMatch } from '../src/model.js';

// jogos em que o saldo real é 1,5 × o esperado: o modelo encolhe a diferença (inclinação 1,5)
function compressed(n, k = 1.5) {
  const rows = [], pre = new Map();
  for (let i = 0; i < n; i++) {
    const sup = ((i % 9) - 4) * 0.3, gd = Math.round(k * sup) + (Math.floor(i / 9) % 3) - 1;   // ruído −1, 0, +1, independente do saldo
    rows.push({ id: i, hg: Math.max(gd, 0) + 1, ag: Math.max(-gd, 0) + 1 });
    pre.set(i, { sup, xt: 2.5 });
  }
  return { rows, pre };
}

test('compressão: o saldo real cresce mais que o esperado — a correção estica, encolhida pela amostra', () => {
  const { rows, pre } = compressed(800);
  const c = goalsCalibration(rows, pre);
  assert.ok(Math.abs(c.raw_slope - 1.5) < 0.1, `inclinação medida ${c.raw_slope}`);
  const w = 800 / (800 + GOALS_N0);
  assert.ok(Math.abs(c.slope - (1 + (c.raw_slope - 1) * w)) < 0.01, 'encolhida para 1 pela amostra');
  assert.ok(c.slope > 1.25 && c.slope <= 1.6);
  assert.equal(goalsCalibration(rows.slice(0, 50), pre), null, 'poucos jogos: sem correção');
});

test('a correção entra na previsão de gols: favorito mais forte, 1X2 e handicap mudam juntos', () => {
  const season = new Date().getUTCFullYear();
  const ms = demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1));
  const fx = demo.dayFixtures()[0];
  const base = analyzeMatch(ms, fx.home.id, fx.away.id, fx.t);
  const cor = analyzeMatch(ms, fx.home.id, fx.away.id, fx.t, { favor: { goals: { slope: 1.4, intercept: 0, ratio: 1 } } });
  const s0 = base.pred.goals.h - base.pred.goals.a, s1 = cor.pred.goals.h - cor.pred.goals.a;
  assert.ok(Math.abs(s1 - 1.4 * s0) < 1e-9, `saldo ${s0} → ${s1}`);
  assert.ok(Math.abs((cor.pred.goals.h + cor.pred.goals.a) - (base.pred.goals.h + base.pred.goals.a)) < 1e-9, 'total igual');
  assert.equal(cor.anchors.goals_cal.slope, 1.4);
  const p = (r, id) => r.all.find(l => l.id === id).pWin;
  const fav = s0 > 0 ? '1' : '2';
  assert.ok(p(cor, fav) > p(base, fav), 'o favorito ganha mais vezes');
  // sem calibração (análise guardada antiga): nada muda
  assert.equal(analyzeMatch(ms, fx.home.id, fx.away.id, fx.t, { favor: { cornersPerGoal: [0, 3.31] } }).anchors.goals_cal, undefined);
});
