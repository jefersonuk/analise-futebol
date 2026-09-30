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

test('mapeia mercados e ignora Pinnacle/Marathonbet na melhor odd', () => {
  const { best, pinn } = collect(books);
  assert.deepEqual(best.get('2'), { odd: 5.75, book: 'Bet365' });
  assert.equal(best.get('ahH-1.25').odd, 2.0);
  assert.equal(best.get('ahA1.25').odd, 1.8);   // "Away -1.25" = visitante +1,25
  assert.equal(best.get('gO3').odd, 1.76);
  assert.ok(!best.has('cornersO9.5'));           // só a Pinnacle ofereceu
  near(pinn.get('cornersO9.5') + pinn.get('cornersU9.5'), 1);
  near(pinn.get('1') + pinn.get('X') + pinn.get('2'), 1);
});
