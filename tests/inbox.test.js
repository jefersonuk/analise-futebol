import test from 'node:test';
import assert from 'node:assert/strict';
import { dropItems, pullItems, pushItems } from '../src/inbox.js';

// GitHub de mentira para /contents: guarda um arquivo com sha e recusa escrita com sha velho.
function fakeGitHub() {
  let file = null, n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (!init.method) return file ? json(200, { content: file.content, sha: file.sha }) : json(404, {});
    const body = JSON.parse(init.body);
    if ((file?.sha || undefined) !== body.sha) return json(409, {});
    file = { content: body.content, sha: `s${++n}` };
    return json(200, { content: { sha: file.sha } });
  };
}
const cfg = { repo: 'me/cache', token: 't' };
const item = (id, casa = 'Cloudbet') => ({ id, casa, odd: 1.8, stake: 104.6, stakeNat: 20, cur: 'USD', event: 'A x B — Mais de 2,5' });

test('caixa da nuvem: junta sem duplicar, lê e tira o que foi registrado', async () => {
  fakeGitHub();
  assert.deepEqual(await pullItems(cfg), []);
  assert.equal(await pushItems([item('a1')], cfg), true);
  await pushItems([item('a1'), item('a2', 'Sportmarket')], cfg);   // a1 de novo: não duplica
  assert.deepEqual((await pullItems(cfg)).map(i => i.id), ['a1', 'a2']);
  await dropItems(['a1'], cfg);
  const left = await pullItems(cfg);
  assert.deepEqual(left.map(i => i.id), ['a2']);
  assert.equal(left[0].stakeNat, 20);
  assert.equal(await pushItems([item('x')], null), false, 'sem nuvem configurada');
});
