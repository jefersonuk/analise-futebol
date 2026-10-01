import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { buildDossier } from '../src/dossier.js';
import { MARK, briefGame, briefScan, toText } from '../src/brief.js';
import { rankGames, scanDay } from '../src/scanner.js';

test('dossiê enxuto do jogo: mantém foco e candidatas, cabe folgado no limite do especialista', async () => {
  const season = new Date().getUTCFullYear();
  const matches = demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1));
  const fx = demo.upcoming(demo.searchTeams('')[0].id)[0];
  const d = await buildDossier({ ...demo, quota: () => null }, { fx, matches, lg: fx.league, oddsPayload: demo.fixtureOdds(fx.id) });
  const b = briefGame(d), text = toText(b);
  const ids = new Set(b.dossier.lines_with_pinnacle.concat(b.dossier.lines_anchored).map(l => l.id));
  for (const id of [...d.candidates_focus, ...d.candidates]) assert.ok(ids.has(id), id);
  assert.ok(text.startsWith(`${MARK} jogo\n`));
  assert.deepEqual(JSON.parse(text.slice(text.indexOf('\n') + 1)).dossier.fixture, d.fixture);
  assert.ok(text.length < JSON.stringify(d).length / 2, 'bem menor que o dossiê inteiro');
  assert.ok(text.length < 120e3, `${text.length} bytes`);
});

test('varredura enxuta: um item por jogo do ranking', async () => {
  const api = { ...demo, stats: () => ({ api: 0, cache: 0 }) };
  const scan = await scanDay(api, { date: '2026-10-01', top: 10 });
  const ranked = rankGames(scan.games);
  const b = briefScan(scan, ranked);
  assert.equal(b.games.length, ranked.length);
  assert.equal(b.games[0].top_line.id, ranked[0].line.id);
  assert.ok(toText(b).length < 200e3);
});
