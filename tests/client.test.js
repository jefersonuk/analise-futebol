import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../src/client.js';
import { FRIENDLIES, loadNational } from '../src/dossier.js';

const H = 3600e3;
const fx = (id, t, status, h = 1, a = 2, lg = 99) => ({
  fixture: { id, timestamp: t / 1000, status: { short: status } }, league: { id: lg, name: 'L' },
  teams: { home: { id: h, name: `T${h}` }, away: { id: a, name: `T${a}` } },
  goals: { home: 1, away: 0 }, score: { fulltime: { home: 1, away: 0 } }, statistics: [],
});

function fakeApi(list) {
  const mem = new Map(), calls = [];
  const get = async (path, params) => {
    calls.push(path + JSON.stringify(params));
    if (params.ids) return params.ids.split('-').map(Number).map(id => list.find(f => f.fixture.id === id));
    return list;
  };
  return { client: makeClient({ get, load: async k => mem.get(k) ?? null, save: async (k, v) => mem.set(k, v) }), calls };
}

test('cache: lista da liga não é rebaixada enquanto nenhum jogo agendado terminou', async () => {
  const now = Date.now();
  const list = [fx(1, now - 48 * H, 'FT'), fx(2, now + 48 * H, 'NS')];
  const { client, calls } = fakeApi(list);
  await client.leagueMatches(5, 2026);
  const first = calls.length;
  assert.ok(first >= 1);
  await client.leagueMatches(5, 2026);
  assert.equal(calls.length, first, 'segunda consulta sem chamar a API');
  assert.equal(client.stats().cache, 1);
});

test('cache: quando o jogo agendado já deveria ter terminado, a lista é atualizada', async () => {
  const now = Date.now();
  const list = [fx(1, now - 48 * H, 'FT'), fx(2, now - 3 * H, 'NS')];   // agendado há 3 h: já acabou
  const { client, calls } = fakeApi(list);
  await client.leagueMatches(5, 2026);
  const first = calls.length;
  await client.leagueMatches(5, 2026);
  assert.ok(calls.length > first, 'rebaixou a lista');
});

test('busca de time fica guardada (90 dias)', async () => {
  const mem = new Map(); let n = 0;
  const client = makeClient({
    get: async () => { n++; return [{ team: { id: 6, name: 'Brazil', country: 'Brazil', national: true } }]; },
    load: async k => mem.get(k) ?? null, save: async (k, v) => mem.set(k, v),
  });
  const a = await client.searchTeams('Brazil'), b = await client.searchTeams('brazil');
  assert.equal(n, 1);
  assert.deepEqual(a, b);
  assert.equal(a[0].national, true);
});

test('seleções: base com os dois times e os adversários; amistoso com metade do peso', async () => {
  const now = Date.now(), d = 24 * H;
  const m = (id, h, a, lg = 34) => ({ id, t: now - id * d, h, a, hn: `T${h}`, an: `T${a}`, hg: 1, ag: 0, lg, s: null });
  const games = {
    6: [m(1, 6, 30), m(2, 40, 6, FRIENDLIES)],      // Brasil x 30 (eliminatória), 40 x Brasil (amistoso)
    7: [m(3, 7, 30)],                               // Índia x 30
    30: [m(1, 6, 30), m(3, 7, 30), m(4, 30, 50)],   // adversário 30 e um jogo dele contra 50
    40: [m(2, 40, 6, FRIENDLIES)],
  };
  const fetched = [];
  const api = {
    teamMatches: async (id, s) => { fetched.push(id); return s === 2026 ? games[id] || [] : []; },
    attachHalfCorners: async (scope, s, ms) => ms.map(x => ({ ...x, c1: [2, 1] })),
  };
  const { matches } = await loadNational(api, { national: true, teams: [{ id: 6, name: 'Brasil' }, { id: 7, name: 'Índia' }] }, 2026);
  assert.deepEqual([...new Set(fetched)].sort((a, b) => a - b), [6, 7, 30, 40]);   // buscou os adversários
  assert.deepEqual(matches.map(x => x.id).sort(), [1, 2, 3, 4]);                    // sem duplicar jogos
  assert.equal(matches.find(x => x.id === 2).wm, 0.5);                              // amistoso pesa metade
  assert.equal(matches.find(x => x.id === 1).wm, undefined);
  assert.deepEqual(matches.find(x => x.id === 1).c1, [2, 1]);                       // 1º tempo dos jogos próprios
  assert.equal(matches.find(x => x.id === 4).c1, undefined);                        // jogo só de adversários: sem custo extra
});
