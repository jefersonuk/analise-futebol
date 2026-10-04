import test from 'node:test';
import assert from 'node:assert/strict';
import { gameOf, settleLine } from '../src/settlement.js';

// Jogo no formato da API: 2–1, escanteios 7–3, 1º tempo 4–1
const f = {
  fixture: { timestamp: 1790000000 }, teams: { home: { id: 1, name: 'Casa' }, away: { id: 2, name: 'Fora' } },
  goals: { home: 2, away: 1 }, score: { fulltime: { home: 2, away: 1 } },
  statistics: [1, 2].map((id, i) => ({ team: { id }, statistics: [
    { type: 'Shots insidebox', value: 8 - i * 4 }, { type: 'Shots outsidebox', value: 4 }, { type: 'Shots on Goal', value: 5 - i },
    { type: 'Total Shots', value: 12 - i * 4 }, { type: 'Corner Kicks', value: i ? 3 : 7 }] })),
};
const g = gameOf(f, [4, 1]);

test('liquida linhas da análise no resultado real', () => {
  const w = id => settleLine(id, g, 'Casa')?.winner;
  assert.equal(w('gO2.5'), 'A');
  assert.equal(w('gO3'), 'VOID');      // 3 gols na linha 3: devolve
  assert.equal(w('gU2.75'), 'HL');     // meia derrota
  assert.equal(w('1'), 'A');
  assert.equal(w('ahA0.5'), 'RED');
  assert.equal(w('ahH-1'), 'VOID');    // venceu por 1 com −1
  assert.equal(w('cornersO9.5'), 'A');
  assert.equal(w('c1hA1.5'), 'RED');   // 1º tempo 4–1: visitante +1,5 perde
  assert.equal(w('c1hH-2.5'), 'A');
  assert.equal(w('c1O4.5'), 'A');
});

test('sem escanteios do 1º tempo, a linha de 1º tempo fica sem liquidação', () => {
  assert.equal(settleLine('c1hA1.5', gameOf(f, null), 'Casa'), null);
});

test('gols do 1º tempo liquidados pelo placar do intervalo', () => {
  const ht = gameOf({ ...f, score: { ...f.score, halftime: { home: 1, away: 1 } } }, null);
  assert.deepEqual(ht.g1, [1, 1]);
  assert.equal(settleLine('g1O1.5', ht, 'Casa').winner, 'A');
  assert.equal(settleLine('g1U1.5', ht, 'Casa').winner, 'RED');
  assert.equal(settleLine('g1O1.5', gameOf(f, null), 'Casa'), null, 'sem placar do intervalo, sem liquidação');
});
