import test from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../src/dashboard.js';

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
