import test from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../src/dashboard.js';
import { consistency } from '../src/consistency.js';

// recentGames devolve do mais recente para o mais antigo; o gráfico inverte (antigo à esquerda).
const g = (gf, ga, cf, ca, home = true) => ({ t: 0, home, opp: 'Rival', gf, ga, corners: [cf, ca], shots: [10, 8], sot: [4, 3] });
const games = [g(3, 1, 7, 2), g(1, 1, 4, 5), g(0, 2, 3, 6), g(2, 0, 6, 3)];
const res = (id, role) => history(id, role, 'Time', games).bars.map(b => b.res).reverse();

test('over/under de gols pelo total de cada jogo', () => {
  assert.deepEqual(res('gO2.5', 'home'), ['win', 'lose', 'lose', 'lose']);
  assert.deepEqual(res('gU2.5', 'away'), ['lose', 'win', 'win', 'win']);
  assert.equal(history('gO2.5', 'home', 'Time', games).wins, 1);
});

test('linha inteira e de quarto: devolve e meio resultado', () => {
  assert.deepEqual(res('gO2', 'home'), ['win', 'push', 'push', 'push']);
  assert.deepEqual(res('gO2.25', 'home'), ['win', 'hl', 'hl', 'hl']);
});

test('handicap: saldo do próprio time, lado certo para mandante e visitante', () => {
  // aposta no mandante −1: para o time mandante, ganha com saldo ≥ 2
  assert.deepEqual(res('ahH-1', 'home'), ['win', 'lose', 'lose', 'win']);
  // mesma aposta vista pelo visitante: ganha quando ELE perde por 2+
  assert.deepEqual(res('ahH-1', 'away'), ['lose', 'lose', 'win', 'lose']);
  assert.deepEqual(res('X', 'home'), ['lose', 'win', 'lose', 'lose']);
  assert.deepEqual(res('1', 'home'), ['win', 'lose', 'lose', 'win']);
});

test('escanteios por time: do próprio time ou cedidos pelo adversário', () => {
  const own = history('cHO4.5', 'home', 'Casa', games), ced = history('cHO4.5', 'away', 'Fora', games);
  assert.match(own.what, /escanteios do Casa/);
  assert.match(ced.what, /cedidos pelo Fora/);
  assert.deepEqual(own.bars.map(b => b.v).reverse(), [7, 4, 3, 6]);
  assert.deepEqual(ced.bars.map(b => b.v).reverse(), [2, 5, 6, 3]);
});


test('consistência: acerto alto e estável vira âncora; histórico contra derruba para especulativa', () => {
  assert.equal(consistency({ p: 0.64, pLow: 0.55, hits: [{ wins: 7, n: 10 }, { wins: 6, n: 10 }] }).tier, 'âncora');
  assert.equal(consistency({ p: 0.64, pLow: 0.55, hits: [{ wins: 7, n: 10 }, { wins: 4, n: 10 }] }).tier, 'sólida');
  assert.equal(consistency({ p: 0.6, pLow: 0.5, hits: [{ wins: 4, n: 10 }, { wins: 4, n: 10 }] }).tier, 'especulativa');
  assert.equal(consistency({ p: 0.45, pLow: 0.35, hits: [{ wins: 9, n: 10 }, { wins: 9, n: 10 }] }).tier, 'especulativa');
  const a = consistency({ p: 0.62, pLow: 0.52, hits: [{ wins: 8, n: 10 }, { wins: 8, n: 10 }] });
  const b = consistency({ p: 0.62, pLow: 0.52, hits: [{ wins: 5, n: 10 }, { wins: 5, n: 10 }] });
  assert.ok(a.score > b.score);
});

test('handicap de escanteios 1T usa o saldo de escanteios do 1º tempo do time', () => {
  const gs = [{ ...g(1, 0, 6, 2), c1: [3, 1] }, { ...g(0, 0, 4, 4), c1: [1, 2] }, { ...g(2, 2, 5, 5), c1: null }];
  const home = history('c1hH-1', 'home', 'Casa', gs), away = history('c1hH-1', 'away', 'Fora', gs);
  assert.deepEqual(home.bars.map(b => b.v).reverse(), [2, -1]);   // jogo sem dado de 1º tempo fica de fora
  assert.deepEqual(home.bars.map(b => b.res).reverse(), ['win', 'lose']);
  assert.deepEqual(away.bars.map(b => b.res).reverse(), ['lose', 'push']);   // visto pelo visitante: perder o 1T por 1 = devolve
  assert.deepEqual(history('c1O2.5', 'home', 'Casa', gs).bars.map(b => b.res).reverse(), ['win', 'win']);
});

import { pickDashboard } from '../src/dashboard.js';

test('painel em foco: candidata de cada mercado, escada só na faixa 1,50–3,00', () => {
  const L = (id, market, tier, score, odd) => ({ id, market, tier, consistency_score: score, odd_min: odd, politica_e: odd > 3 ? 'não entrar' : 'cheia', odd_min_vs_pinnacle_pct: 0, p_model_range: [0.5, 0.6] });
  const dossier = {
    focus_markets: ['Total de gols', 'Handicap escanteios 1T'],
    candidates_focus: ['gO1.5', 'c1hA1.5'], candidates: ['gO1.5'],
    lines_with_pinnacle: [L('gO1.5', 'Total de gols', 'sólida', 0.6, 1.7), L('gO2.5', 'Total de gols', 'especulativa', 0.4, 2.2), L('1', '1X2', 'sólida', 0.6, 1.9)],
    lines_anchored: [L('c1hA1.5', 'Handicap escanteios 1T', 'sólida', 0.6, 1.75), L('c1hA3', 'Handicap escanteios 1T', 'âncora', 0.9, 1.23), L('c1hA1', 'Handicap escanteios 1T', 'sólida', 0.55, 2.0)],
  };
  const side = id => id.replace(/-?[\d.]+$/, '');
  const ids = pickDashboard(dossier, 5, { focus: true, side }).map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ['gO1.5', 'c1hA1.5', 'c1hA1']);   // escada pula a odd 1,23
  assert.ok(!ids.includes('1'));                                     // foco não mostra 1X2
  assert.ok(pickDashboard(dossier, 5, { focus: false, side }).some(l => l.id === '1'));
});
