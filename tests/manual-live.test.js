import test from 'node:test';
import assert from 'node:assert/strict';
import { manualLine } from '../src/entryview.js';
import { marketOfId } from '../src/myline.js';
import { buildEntry } from '../src/entry.js';
import { liveFixtures, liveLine } from '../src/settlement.js';

const fx = { id: 777, t: Date.UTC(2026, 9, 7, 19), home: { id: 1, name: 'Mandante FC' }, away: { id: 2, name: 'Visitante SC' }, league: { name: 'Liga' } };

test('entrada manual: a linha digitada vira id e mercado do app; sem reconhecer, vai como texto', () => {
  const c = manualLine('Mais de 9,5 escanteios', fx);
  assert.deepEqual([c.id, c.market, c.recognized, c.manual, c.tier], ['cornersO9.5', 'Total de escanteios', true, true, 'manual']);
  assert.equal(manualLine('Abaixo 4.5 1º período - escanteios', fx).id, 'c1U4.5');
  assert.equal(manualLine('Visitante SC +1', fx).market, 'Handicap asiático');
  assert.equal(manualLine('Acima 2.5', fx).market, 'Total de gols');
  const t = manualLine('Jogador X marca a qualquer momento', fx);
  assert.deepEqual([t.id, t.market, t.recognized, t.line], [null, 'Entrada manual', false, 'Jogador X marca a qualquer momento']);
  for (const [id, m] of [['1', '1X2'], ['ahH-1', 'Handicap asiático'], ['g1O1.5', 'Total de gols 1T'], ['c1hA1', 'Handicap escanteios 1T'],
    ['chH-2', 'Handicap de escanteios'], ['cHO5.5', 'Escanteios por time'], ['crN9', 'Corrida de escanteios'], ['bttsY', 'Ambas marcam']])
    assert.equal(marketOfId(id), m, id);
});

test('entrada manual vai para o app de apostas marcada, sem os números do modelo', () => {
  const it = buildEntry({ line: manualLine('Mais de 9,5 escanteios', fx), fx, casa: 'Superbet', currency: 'BRL', odd: 1.9, stake: 100 });
  assert.equal(it.analise.manual, true);
  assert.equal(it.analise.lineId, 'cornersO9.5');
  assert.equal(it.analise.fixtureId, 777);
  assert.equal(it.prob, null);
  assert.match(it.event, /^Mandante FC x Visitante SC — Total de escanteios: Mais de 9,5 escanteios$/);
  // jogo digitado (fora da API): sem fixtureId, o resultado fica à mão no app de apostas
  const free = { ...fx, id: null };
  assert.equal(buildEntry({ line: manualLine('Over 2.5', free), fx: free, casa: 'X', odd: 2, stake: 50 }).analise.fixtureId, null);
});

// API-Football simulada: /fixtures?ids= e /fixtures/statistics?half=true
function fakeApi(fixtures, half = {}) {
  const calls = [];
  globalThis.localStorage = { getItem: k => (k === 'af:key' ? 'chave' : null) };
  globalThis.fetch = async url => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    let response = [];
    if (u.pathname === '/fixtures') response = u.searchParams.get('ids').split('-').map(Number).map(id => fixtures[id]).filter(Boolean);
    if (u.pathname === '/fixtures/statistics') response = half[u.searchParams.get('fixture')] || [];
    return { ok: true, json: async () => ({ errors: [], response }) };
  };
  return calls;
}
const fixture = (id, short, elapsed, goals, ht, corners) => ({
  fixture: { id, timestamp: 1791400000, status: { short, long: short, elapsed } },
  teams: { home: { id: 1, name: 'Mandante FC' }, away: { id: 2, name: 'Visitante SC' } },
  goals: { home: goals[0], away: goals[1] }, score: { halftime: { home: ht[0], away: ht[1] }, fulltime: { home: null, away: null } },
  statistics: corners ? [{ team: { id: 1 }, statistics: [{ type: 'Corner Kicks', value: corners[0] }] }, { team: { id: 2 }, statistics: [{ type: 'Corner Kicks', value: corners[1] }] }] : [],
});

test('ao vivo: placar, minuto e escanteios de vários jogos numa requisição; a linha diz como está agora', async () => {
  const calls = fakeApi({ 1: fixture(1, '1H', 30, [1, 0], [null, null], [3, 1]), 2: fixture(2, '2H', 63, [2, 1], [1, 1], [6, 4]) },
    { 2: [{ team: { id: 1 }, statistics_1h: [{ type: 'Corner Kicks', value: 2 }] }, { team: { id: 2 }, statistics_1h: [{ type: 'Corner Kicks', value: 3 }] }] });
  const info = await liveFixtures([1, 2], { needC1: new Set([2]) });
  assert.equal(calls.filter(c => c.startsWith('/fixtures?')).length, 1, 'uma requisição para os dois jogos');
  const a = info.get(1), b = info.get(2);
  assert.deepEqual([a.status, a.elapsed, a.goals, a.corners, a.c1, a.live], ['1H', 30, [1, 0], [3, 1], [3, 1], true]);
  assert.deepEqual(b.c1, [2, 3], 'passado o intervalo, o 1º tempo vem da estatística por tempo');
  // 1º tempo, 30': 4 escanteios no 1T — Mais de 4,5 ainda falta 1; Mais de 3,5 já bateu (over não volta)
  assert.deepEqual(liveLine('c1O4.5', a), { value: 4, threshold: 4.5, what: 'escanteios no 1º tempo', now: 'RED', locked: false, need: 1 });
  assert.equal(liveLine('c1O3.5', a).locked, true);
  // 2º tempo: a linha do 1º tempo já está decidida; Mais de 9,5 escanteios do jogo com 10 já bateu
  assert.deepEqual([liveLine('c1O4.5', b).now, liveLine('c1O4.5', b).locked], ['A', true]);
  assert.deepEqual([liveLine('cornersO9.5', b).now, liveLine('cornersO9.5', b).locked], ['A', true]);
  // under que ainda está de pé não está decidido; gols do jogo pelo placar atual
  assert.deepEqual([liveLine('gU3.5', b).now, liveLine('gU3.5', b).locked], ['A', false]);
  assert.equal(liveLine('gO3.5', b).need, 1);
  assert.equal(liveLine(null, b), null);
});
