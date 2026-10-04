import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, devig } from '../src/odds.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// Recorte real da resposta de /odds (formato da API-Football).
const books = [
  { id: 4, name: 'Pinnacle', bets: [
    { id: 1, values: [{ value: 'Home', odd: '1.49' }, { value: 'Draw', odd: '4.48' }, { value: 'Away', odd: '5.48' }] },
    { id: 4, values: [{ value: 'Home -1.25', odd: '2.03' }, { value: 'Away -1.25', odd: '1.81' }] },
    { id: 45, values: [{ value: 'Over 9.5', odd: '1.69' }, { value: 'Under 9.5', odd: '2.04' }] },
  ] },
  { id: 8, name: 'Bet365', bets: [
    { id: 1, values: [{ value: 'Home', odd: '1.45' }, { value: 'Draw', odd: '4.20' }, { value: 'Away', odd: '5.75' }] },
    { id: 4, values: [{ value: 'Home -1.25', odd: '2.00' }, { value: 'Away -1.25', odd: '1.80' }] },
    { id: 5, values: [{ value: 'Over 3.0', odd: '1.76' }] },
  ] },
  { id: 2, name: 'Marathonbet', bets: [{ id: 1, values: [{ value: 'Away', odd: '9.00' }] }] },
];

test('devig power soma 1 e puxa mais margem do azarão', () => {
  const p = devig([1.49, 4.48, 5.48]);
  near(p.reduce((s, x) => s + x, 0), 1);
  const prop = [1.49, 4.48, 5.48].map(o => 1 / o), z = prop.reduce((s, x) => s + x, 0);
  assert.ok(p[2] < prop[2] / z && p[0] > prop[0] / z);
});

test('usa só a Pinnacle e mapeia os mercados', () => {
  const { odds, fair } = collect(books);
  assert.equal(odds.get('2'), 5.48);
  assert.equal(odds.get('ahH-1.25'), 2.03);
  assert.equal(odds.get('ahA1.25'), 1.81);   // "Away -1.25" = visitante +1,25
  assert.equal(odds.get('cornersO9.5'), 1.69);
  assert.ok(!odds.has('gO3'));               // só a Bet365 ofereceu
  near(fair.get('cornersO9.5') + fair.get('cornersU9.5'), 1);
  near(fair.get('1') + fair.get('X') + fair.get('2'), 1);
});

test('escanteios da Pinnacle: handicap (56) e por time (57/58), formato real da API', () => {
  // São Paulo x Santos, 02/10/2026 (valores reais da API)
  const bets = [
    { id: 56, values: [['Home -1', '1.60'], ['Away -1', '2.20'], ['Home -2', '1.96'], ['Away -2', '1.79'], ['Home +0', '1.69'], ['Away +0', '2.03']].map(([value, odd]) => ({ value, odd })) },
    { id: 57, values: [{ value: 'Over 5.5', odd: '1.65' }, { value: 'Under 5.5', odd: '2.15' }] },
    { id: 58, values: [{ value: 'Over 4.5', odd: '2.04' }, { value: 'Under 4.5', odd: '1.72' }] },
  ];
  const { odds, fair } = collect([{ id: 4, bets }]);
  assert.equal(odds.get('chH-1'), 1.6);
  assert.equal(odds.get('chA1'), 2.2);          // "Away -1" = visitante +1
  assert.equal(odds.get('chA0'), 2.03);
  assert.ok(Math.abs(fair.get('chH-1') + fair.get('chA1') - 1) < 1e-9);
  assert.equal(odds.get('cHO5.5'), 1.65);
  assert.equal(odds.get('cAU4.5'), 1.72);
  assert.ok(Math.abs(fair.get('cHO5.5') + fair.get('cHU5.5') - 1) < 1e-9);
});

test('gols do 1º tempo da Pinnacle (mercado 6), formato real da API', () => {
  // FC Tulsa x Sacramento Republic, 03/10/2026 (valores reais da API)
  const bets = [{ id: 6, values: [['Over 1.5', '3.40'], ['Under 1.5', '1.32'], ['Over 0.5', '1.47'], ['Under 0.5', '2.67']].map(([value, odd]) => ({ value, odd })) }];
  const { odds, fair } = collect([{ id: 4, bets }]);
  assert.equal(odds.get('g1O1.5'), 3.4);
  assert.equal(odds.get('g1U0.5'), 2.67);
  assert.ok(!odds.has('gO1.5'), 'não se mistura com os gols do jogo');
  near(fair.get('g1O1.5') + fair.get('g1U1.5'), 1);
});
