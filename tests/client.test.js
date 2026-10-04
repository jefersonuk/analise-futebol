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

import { domesticLeague, loadCross, resolveBase } from '../src/dossier.js';

test('liga nacional do time: ignora estaduais, copas e base', () => {
  assert.equal(domesticLeague([{ id: 624, name: 'Carioca - 1' }, { id: 71, name: 'Serie A' }]).id, 71);
  assert.equal(domesticLeague([{ id: 9001, name: 'Paulista - A1' }, { id: 9002, name: 'Primera División' }]).id, 9002);
});

test('Libertadores entre ligas: base com as duas ligas e a própria copa', async () => {
  const fx = { league: { id: 13, name: 'CONMEBOL Libertadores', season: 2026 }, home: { id: 127, name: 'Flamengo' }, away: { id: 435, name: 'River Plate' } };
  const api = { leaguesOf: async id => (id === 127 ? [{ id: 624, name: 'Carioca - 1' }, { id: 71, name: 'Serie A' }] : [{ id: 128, name: 'Liga Profesional Argentina' }]) };
  const base = await resolveBase(api, fx, false);
  assert.equal(base.cross, true);
  assert.deepEqual(base.leagues.map(l => l.id), [71, 128, 13]);
  // mesma liga: continua usando a liga
  const same = await resolveBase({ leaguesOf: async () => [{ id: 71, name: 'Serie A' }] }, { ...fx, away: { id: 121, name: 'Palmeiras' } }, false);
  assert.equal(same.id, 71);

  const now = Date.now(), m = (id, h, a, lg) => ({ id, t: now - id * 864e5, h, a, hn: `T${h}`, an: `T${a}`, hg: 1, ag: 0, lg, s: null });
  const byLeague = { 71: [m(1, 127, 121, 71)], 128: [m(2, 451, 450, 128), m(4, 435, 451, 128)], 13: [m(3, 127, 450, 13), m(1, 127, 121, 71)] };
  const seen = [];
  const { matches } = await loadCross({
    leagueMatches: async (l, s) => (s === 2026 ? byLeague[l] || [] : []),
    attachHalfCorners: async (scope, s, ms) => { seen.push(scope); return ms.map(x => ({ ...x, c1: [1, 1] })); },
  }, base, 2026);
  assert.deepEqual(matches.map(x => x.id).sort(), [1, 2, 3, 4]);           // sem duplicar
  assert.ok(matches.find(x => x.id === 3).c1);                              // jogo do Flamengo na copa ganha 1º tempo
  assert.equal(matches.find(x => x.id === 2).c1, undefined);                // jogo só de outros times: sem custo
  assert.ok(seen.every(s => s === 'tm127' || s === 'tm435'));
});

test('jogos ao vivo: uma consulta live=all por minuto, filtrada pelo time, com minuto e placar', async () => {
  const live = [
    { fixture: { id: 7, timestamp: (Date.now() - 40 * 60e3) / 1000, status: { short: '1H', elapsed: 37 } }, league: { id: 5, name: 'UEFA Nations League', season: 2026 },
      teams: { home: { id: 101, name: 'Kazakhstan' }, away: { id: 102, name: 'Faroe Islands' } }, goals: { home: 1, away: 0 } },
    { fixture: { id: 8, timestamp: Date.now() / 1000, status: { short: '2H', elapsed: 60 } }, league: { id: 71, name: 'Serie A', season: 2026 },
      teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } }, goals: { home: 0, away: 0 } },
  ];
  const calls = [];
  const client = makeClient({ get: async (p, params) => { calls.push(params); return live; }, load: async () => null, save: async () => {} });
  const k = await client.liveOf(101);
  assert.equal(k.length, 1);
  assert.equal(k[0].id, 7);
  assert.deepEqual(k[0].live, { status: '1H', elapsed: 37, goals: [1, 0] });
  assert.equal(k[0].league.season, 2026);
  await client.liveOf(102); await client.liveOf(999);
  assert.equal(calls.length, 1, 'uma consulta só dentro do minuto');
  assert.deepEqual(calls[0], { live: 'all' });
});

test('placar do 1º tempo: guardado nos jogos novos e completado uma vez nos antigos', async () => {
  const now = Date.now();
  const withHt = (f, h, a) => ({ ...f, score: { ...f.score, halftime: { home: h, away: a } } });
  const list = [withHt(fx(1, now - 48 * H, 'FT'), 1, 0), withHt(fx(2, now - 72 * H, 'FT'), 0, 0)];
  const mem = new Map(), calls = [];
  mem.set('af:lg:5:2026', { t: now, next: null, m: { 2: { id: 2, t: now - 72 * H, h: 1, a: 2, hg: 1, ag: 0, s: null } } });   // guardado antes
  const client = makeClient({
    get: async (path, params) => { calls.push(path); return params.ids ? params.ids.split('-').map(Number).map(id => list.find(f => f.fixture.id === id)) : list; },
    load: async k => mem.get(k) ?? null, save: async (k, v) => mem.set(k, v),
  });
  const ms = await client.leagueMatches(5, 2026);
  assert.deepEqual([ms.find(m => m.id === 1).hh, ms.find(m => m.id === 1).ha], [1, 0]);
  assert.deepEqual([ms.find(m => m.id === 2).hh, ms.find(m => m.id === 2).ha], [0, 0], 'jogo antigo completado pela lista');
  const n = calls.length;
  await client.leagueMatches(5, 2026);
  assert.equal(calls.length, n, 'completado uma vez: depois volta ao cache');
});
