import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/myline.js';
import { checkBet, liveLine, settleLine } from '../src/settlement.js';
import { buildTicket, legOf, pickMatches, splitLegs, ticketKind } from '../src/ticket.js';

const names = { home: 'Flamengo', away: 'Palmeiras' };
const fx = { id: 11, t: Date.UTC(2026, 9, 15, 23, 30), home: { id: 1, name: 'Flamengo' }, away: { id: 2, name: 'Palmeiras' }, league: { name: 'Serie A' } };
const fx2 = { id: 22, t: Date.UTC(2026, 9, 16, 19), home: { id: 3, name: 'Real Madrid' }, away: { id: 4, name: 'Getafe' }, league: { name: 'La Liga' } };
const typed = { id: null, t: Date.UTC(2026, 9, 16, 15), home: { name: 'Time A' }, away: { name: 'Time B' }, league: { name: 'Várzea' } };

test('aposta manual: dupla chance, gols de um time e resultado do 1º tempo (só com settle; sem ele, como antes)', () => {
  const p = t => parseLine(t, { names, settle: true }).id;
  assert.deepEqual(['Flamengo ou empate', '1X', 'Palmeiras ou empate', 'x2', 'Flamengo ou Palmeiras', '12', 'dupla chance 1X'].map(p), ['1X', '1X', 'X2', 'X2', '12', '12', '1X']);
  assert.deepEqual(['Flamengo mais de 1,5', 'Mais de 1,5 gols do Flamengo', 'Palmeiras menos de 0,5', 'Flamengo marca', 'Palmeiras não marca'].map(p),
    ['gHO1.5', 'gHO1.5', 'gAU0.5', 'gHO0.5', 'gAU0.5']);
  assert.equal(p('Flamengo mais de 4,5 escanteios'), 'cHO4.5');
  assert.deepEqual(['Flamengo vence o 1º tempo', 'Vitória do Palmeiras no 1º tempo', 'Empate no 1º tempo'].map(p), ['1T1', '1T2', '1TX']);
  assert.deepEqual(['Flamengo vence', 'Vitória do Flamengo', 'Empate', 'Mais de 2,5', 'Ambas marcam', 'Flamengo -1', 'Mais de 9,5 escanteios'].map(p),
    ['1', '1', 'X', 'gO2.5', 'bttsY', 'ahH-1', 'cornersO9.5']);
  assert.match(parseLine('Flamengo mais de 10,5 chutes', { names, settle: true }).error, /Chutes de um time/);
  // outros mercados que parecem estes não viram linha errada: ficam para marcar à mão
  assert.ok(parseLine('Flamengo marca primeiro', { names, settle: true }).error);
  assert.ok(parseLine('Flamengo vence 1º tempo e jogo', { names, settle: true }).error);
  assert.equal(p('1º tempo: empate'), '1TX');
  // sem settle (a "Minha linha" da análise, que precisa do preço do modelo): o de antes
  assert.equal(parseLine('Flamengo mais de 1,5', { names }).id, 'gO1.5');
  assert.ok(parseLine('Flamengo ou empate', { names }).error);
});

test('conferência das linhas novas pelo placar', () => {
  const g = (gf, ga, g1 = null) => ({ t: 0, home: true, opp: 'Palmeiras', gf, ga, g1, corners: null, shots: null, sot: null, c1: null });
  const w = (id, gm) => settleLine(id, gm, 'Flamengo').winner;
  assert.deepEqual([w('1X', g(1, 1)), w('1X', g(2, 0)), w('1X', g(0, 1))], ['A', 'A', 'RED']);
  assert.deepEqual([w('X2', g(1, 1)), w('X2', g(0, 2)), w('X2', g(1, 0))], ['A', 'A', 'RED']);
  assert.deepEqual([w('12', g(1, 1)), w('12', g(2, 1))], ['RED', 'A']);
  assert.deepEqual([w('gHO1.5', g(2, 0)), w('gHO1.5', g(1, 3)), w('gAU0.5', g(3, 0)), w('gAU0.5', g(3, 1))], ['A', 'RED', 'A', 'RED']);
  assert.deepEqual([w('1T1', g(1, 1, [1, 0])), w('1TX', g(2, 0, [0, 0])), w('1T2', g(2, 1, [1, 1]))], ['A', 'A', 'RED']);
  // ao vivo: gols de um time que ainda faltam
  const info = { home: 'Flamengo', status: '2H', finished: false, game: g(1, 0) };
  assert.deepEqual([liveLine('gHO1.5', info).need, liveLine('gHO1.5', info).locked], [1, false]);
  assert.equal(liveLine('gHO0.5', info).locked, true, 'over de um time que já bateu não volta');
});

test('bilhete: pernas, tipo (simples, mesmo jogo, múltipla) e o registro para o app de apostas', () => {
  assert.deepEqual(splitLegs('Flamengo vence + Mais de 2,5 gols'), ['Flamengo vence', 'Mais de 2,5 gols']);
  assert.deepEqual(splitLegs('Flamengo +1,5'), ['Flamengo +1,5'], '"+1,5" é handicap, não separa');
  const same = splitLegs('Flamengo vence + Mais de 2,5 gols').map(t => legOf(fx, t));
  assert.deepEqual(same.map(l => [l.lineId, l.mercado, l.auto]), [['1', '1X2', true], ['gO2.5', 'Total de gols', true]]);
  assert.equal(ticketKind(same), 'mesmo jogo');
  const it = buildTicket({ legs: same, casa: 'Bet365', currency: 'BRL', odd: 2.4, stake: 100 });
  assert.equal(it.market, 'Combo (criar aposta)');
  assert.equal(it.event, 'Flamengo x Palmeiras — Mesmo jogo: Flamengo vence + Mais de 2,5 gols');
  assert.deepEqual([it.analise.manual, it.analise.multi, it.analise.same_game, it.analise.fixtureId, it.analise.home, it.analise.mercado], [true, true, true, 11, 'Flamengo', 'Mesmo jogo']);
  assert.ok(it.analise.legs.every(l => !('auto' in l) && !('error' in l) && l.odd_casa === null));
  // múltipla com jogo digitado (fora da API) e linha não reconhecida: vai, e essa perna fica para marcar à mão
  const legs = [same[0], legOf(fx2, 'Ambas marcam'), legOf(typed, 'Gol olímpico')];
  assert.equal(ticketKind(legs), 'múltipla');
  assert.deepEqual(legs.map(l => l.auto), [true, true, false]);
  const m = buildTicket({ legs, casa: 'Superbet', currency: 'BRL', odd: 5.1, stake: 50 });
  assert.equal(m.market, 'Múltipla');
  assert.equal(m.analise.fixtureId, 22, 'o último jogo da API (o digitado não tem id)');
  assert.equal(m.analise.first_kickoff, new Date(fx.t).toISOString());
  assert.equal(m.analise.kickoff, new Date(fx2.t).toISOString());
  assert.equal(m.analise.legs[2].fixtureId, null);
  // uma perna só: a simples de antes (manual, com o jogo e a linha)
  const one = buildTicket({ legs: [legOf(fx2, 'Real Madrid -1,5')], casa: 'X', currency: 'EUR', odd: 2, stake: 120, stakeNat: 20 });
  assert.deepEqual([one.market, one.analise.manual, one.analise.multi, one.analise.lineId, one.analise.fixtureId], ['Handicap Asiático', true, undefined, 'ahH-1.5', 22]);
  assert.equal(one.event, 'Real Madrid x Getafe — Handicap asiático: Real Madrid -1,5');
  // a lista do dia: o time digitado (3 letras, sem acento), por horário
  const list = [fx2, fx, { ...fx, id: 33, t: fx.t - 3600e3, home: { name: 'Flamengo B' }, away: { name: 'Vasco' } }];
  assert.deepEqual(pickMatches(list, 'flam').map(f => f.id), [33, 11]);
  assert.deepEqual(pickMatches(list, 'ge').map(f => f.id), [], 'menos de 3 letras: nada');
  assert.deepEqual(pickMatches(list, 'GETÁ').map(f => f.id), [22]);
});

// API-Football simulada para a conferência
function fakeApi(fixtures, odds = {}) {
  const calls = [];
  globalThis.localStorage = { getItem: k => (k === 'af:key' ? 'chave' : null) };
  globalThis.fetch = async url => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    let response = [];
    if (u.pathname === '/fixtures') response = u.searchParams.get('ids').split('-').map(Number).map(id => fixtures[id]).filter(Boolean);
    if (u.pathname === '/odds') response = odds[u.searchParams.get('fixture')] || [];
    return { ok: true, json: async () => ({ errors: [], response }) };
  };
  return calls;
}
const fixture = (id, short, goals) => ({ fixture: { id, timestamp: 1791400000, status: { short, long: short } },
  teams: { home: { id: 1, name: 'Flamengo' }, away: { id: 2, name: 'Palmeiras' } }, goals: { home: goals[0], away: goals[1] },
  score: { halftime: { home: 0, away: 0 }, fulltime: { home: goals[0], away: goals[1] } }, statistics: [] });

test('conferência do bilhete manual: o mesmo jogo pedido uma vez, sem CLV; perna fora da API fica para marcar à mão', async () => {
  const calls = fakeApi({ 11: fixture(11, 'FT', [3, 1]), 22: fixture(22, 'FT', [0, 0]) });
  const same = buildTicket({ legs: splitLegs('Flamengo vence + Mais de 2,5 gols').map(t => legOf(fx, t)), casa: 'X', currency: 'BRL', odd: 2.4, stake: 100 });
  const r = await checkBet(same.analise, 2.4);
  assert.deepEqual([r.status, r.winner, r.clv], ['encerrado', 'A', null]);
  assert.equal(calls.filter(c => c.startsWith('/fixtures?')).length, 1);
  assert.match(calls[0], /ids=11$/, 'o jogo uma vez só');
  assert.ok(!calls.some(c => c.startsWith('/odds')), 'no mesmo jogo, sem CLV pelo produto das justas');
  // perna perdida perde o bilhete, mesmo com a perna digitada sem conferir
  const lost = buildTicket({ legs: [legOf(fx2, 'Ambas marcam'), legOf(typed, 'Gol olímpico')], casa: 'X', currency: 'BRL', odd: 4, stake: 50 });
  assert.equal((await checkBet(lost.analise, 4)).winner, 'RED');
  // as conferíveis ganharam: a digitada espera a marcação à mão
  const open = buildTicket({ legs: [legOf(fx, 'Flamengo vence'), legOf(typed, 'Gol olímpico')], casa: 'X', currency: 'BRL', odd: 4, stake: 50 });
  const o = await checkBet(open.analise, 4);
  assert.equal(o.status, 'pendente');
  assert.match(o.detail, /Time A x Time B Gol olímpico: marcar à mão/);
});
