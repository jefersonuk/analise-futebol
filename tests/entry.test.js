import test from 'node:test';
import assert from 'node:assert/strict';

// o app de apostas no localStorage do navegador (os dois apps dividem o endereço)
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { BETS_KEY, betsApp } = await import('../src/entry.js');
const { STAKE, MAIN_HOUSE, isContra, money, stakeOf } = await import('../src/stake.js');

test('casa principal (Sportmarket) primeiro na lista, mesmo sem saldo; entrada de 20 € a favor da Pinnacle e 10 € contra', () => {
  assert.equal(MAIN_HOUSE, 'Sportmarket'); assert.deepEqual(STAKE, { value: 20, cur: 'EUR' });
  // contra = a marcação "contra a Pinnacle" da nossa leitura (5 pp ou mais acima dela); o resto entra cheio
  assert.equal(stakeOf({ scenario: true, contra: true, diff_pp: 7 }), 10); assert.equal(stakeOf({ scenario: true, contra: false, diff_pp: 4 }), 20);
  assert.equal(stakeOf({ tier: 'âncora', p_blend: 0.66 }), 20, '🤝: o preço é o da Pinnacle'); assert.equal(stakeOf({ combo: true, fav: true }), 20);
  assert.equal(stakeOf({ multi: true, legs: [] }), 20); assert.equal(stakeOf(null), 20); assert.ok(isContra({ contra: true }) && !isContra({ contra: 'sim' }));
  assert.equal(money(10), '10 €'); assert.equal(money(150, 'BRL'), 'R$ 150'); assert.equal(money(-8.5, 'EUR', 2), '−8,50 €');
  store.set(BETS_KEY, JSON.stringify({ balances: [{ name: 'Bet365', value: 900, currency: 'BRL' }, { name: 'Sportmarket', value: 120, currency: 'EUR' },
    { name: 'Betano', value: 2000, currency: 'BRL' }, { name: 'Nubank', value: 5000 }], eurRate: 6.2 }));
  const a = betsApp();
  assert.deepEqual(a.houses.map(h => h.name), ['Sportmarket', 'Betano', 'Bet365'], 'a principal primeiro, depois por saldo; banco fora');
  assert.equal(a.rates.EUR, 6.2);
  // sem a Sportmarket no app de apostas: entra como primeira, em €, sem saldo
  store.set(BETS_KEY, JSON.stringify({ balances: [{ name: 'Bet365', value: 900, currency: 'BRL' }] }));
  const b = betsApp();
  assert.deepEqual(b.houses.map(h => [h.name, h.currency, !!h.missing]), [['Sportmarket', 'EUR', true], ['Bet365', 'BRL', false]]);
  store.delete(BETS_KEY);
  assert.deepEqual(betsApp().houses.map(h => h.name), ['Sportmarket'], 'sem o app de apostas neste navegador');
});
