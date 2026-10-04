import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, withCloud } from '../src/cloud.js';
import { makeClient } from '../src/client.js';

// GitHub de mentira: repositório privado em memória, com controle de sha como a API real.
function fakeGitHub({ priv = true } = {}) {
  const files = new Map();
  let n = 0, puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), p = u.pathname.replace(/^\/repos\/me\/cache/, '');
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (p === '') return json(200, { private: priv, default_branch: 'main' });
    if (p.startsWith('/git/trees/')) return files.size ? json(200, { tree: [...files].map(([path, f]) => ({ path, sha: f.sha, type: 'blob' })) }) : json(409, {});
    const path = decodeURIComponent(p.replace('/contents/', ''));
    if (!init.method) return files.has(path) ? json(200, JSON.parse(files.get(path).text)) : json(404, {});
    const body = JSON.parse(init.body), cur = files.get(path);
    if ((cur?.sha || undefined) !== body.sha) return json(409, {});
    const f = { sha: `s${++n}`, text: Buffer.from(body.content, 'base64').toString('utf8') };
    files.set(path, f); puts++;
    return json(200, { content: { sha: f.sha } });
  };
  return { files, puts: () => puts };
}
const device = () => { const m = new Map(); return { load: async k => m.get(k) ?? null, save: async (k, v) => m.set(k, v), m }; };
const cfg = { repo: 'me/cache', token: 't' };

test('liga baixada num dispositivo vem da nuvem no outro, sem chamar a API', async () => {
  const gh = fakeGitHub(), now = Date.now();
  const list = [{ fixture: { id: 1, timestamp: (now - 864e5 * 3) / 1000, status: { short: 'FT' } }, league: { id: 71, name: 'L' },
    teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } }, goals: { home: 2, away: 1 }, score: { fulltime: { home: 2, away: 1 } },
    statistics: [] }];
  let calls = 0;
  const get = async (path, params) => { calls++; return params.ids ? list : list; };

  const a = withCloud(device(), cfg);
  await makeClient({ get, load: a.load, save: a.save }).leagueMatches(71, 2026);
  await a.flush();
  assert.ok(gh.files.has('cache/af_lg_71_2026.json'));
  const before = calls;

  const b = withCloud(device(), cfg);
  const games = await makeClient({ get, load: b.load, save: b.save }).leagueMatches(71, 2026);
  assert.equal(calls, before, 'o segundo dispositivo não chamou a API');
  assert.equal(games.length, 1);
  assert.equal(b.status().down, 1);
});

test('dois dispositivos com jogos diferentes: a nuvem fica com a soma', async () => {
  const gh = fakeGitHub();
  const a = withCloud(device(), cfg), b = withCloud(device(), cfg);
  await a.save('af:h1:71:2026', { m: { 1: [3, 2], 2: null } });
  await a.flush();
  await b.save('af:h1:71:2026', { m: { 2: [1, 1], 3: [4, 0] } });   // b ainda não viu a versão de a
  await b.flush();
  const final = JSON.parse(gh.files.get('cache/af_h1_71_2026.json').text);
  assert.deepEqual(final.m, { 1: [3, 2], 2: [1, 1], 3: [4, 0] });   // o dado vence o "sem dado"
});

test('não envia para repositório público e não sobe chaves que não são de histórico', async () => {
  const gh = fakeGitHub({ priv: false });
  const a = withCloud(device(), cfg);
  await a.save('af:lg:71:2026', { t: 1, next: null, m: {} });
  await a.flush();
  assert.equal(gh.puts(), 0);
  assert.match(a.status().error, /público/);

  const gh2 = fakeGitHub();
  const c = withCloud(device(), cfg);
  await c.save('af:next:5', { t: 1, d: [] });
  await c.flush();
  assert.equal(gh2.puts(), 0);
});

test('junção de listas de jogos: estatística de quem tiver, atualização mais recente', () => {
  const a = { t: 10, next: null, m: { 1: { id: 1, s: [1] }, 2: { id: 2 } } };
  const b = { t: 20, next: 99, m: { 2: { id: 2, s: null }, 3: { id: 3 } } };
  const m = merge('af:lg:1:2026', a, b);
  assert.deepEqual(Object.keys(m.m).sort(), ['1', '2', '3']);
  assert.equal(m.m[2].s, null);
  assert.equal(m.t, 20);
  assert.equal(m.next, 99);
});

test('junção de listas de jogos: placar do 1º tempo de quem tiver', () => {
  const a = { t: 30, next: null, m: { 1: { id: 1, s: [1], hh: 1, ha: 0 }, 2: { id: 2, s: null, hh: null, ha: null } } };
  const b = { t: 20, next: null, m: { 1: { id: 1, s: [1] }, 2: { id: 2, s: null } } };   // outro aparelho, versão antiga
  const m = merge('af:lg:1:2026', a, b);
  assert.deepEqual([m.m[1].hh, m.m[1].ha], [1, 0]);
  assert.equal(m.m[2].hh, null);
});
