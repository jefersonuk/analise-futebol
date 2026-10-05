import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { FOCUS, buildDossier } from '../src/dossier.js';
import { MARK, briefGame, briefScan, toText } from '../src/brief.js';
import { pickGames, rankGames, scanDay } from '../src/scanner.js';

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
  // contexto do jogo e plano ao vivo do 1º tempo vão para o especialista; os confrontos crus, não
  assert.ok(d.context.text.length >= 4 && d.context.h2h_extra && d.live_1h.tables.length === 3);
  assert.ok(b.dossier.context.text.length && !b.dossier.context.h2h_extra);
  assert.match(b.dossier.live_1h.odd_min_over['mais de 3,5'].sem_escanteio, /^0' [\d,]+ \(\d+%\) · 5' /);
  assert.ok(d.lines_with_pinnacle.filter(l => FOCUS.includes(l.market)).every(l => l.context?.verdict));
  assert.ok(d.candidates_focus.every(id => d.lines_with_pinnacle.find(l => l.id === id).context.verdict !== 'contra'));
});

test('varredura enxuta: um item por jogo, na ordem da tela, com contexto e plano ao vivo', async () => {
  const api = { ...demo, stats: () => ({ api: 0, cache: 0 }) };
  const scan = await scanDay(api, { date: '2026-10-01', top: 10 });
  const ranked = pickGames(scan.games, { top: 10 });
  const b = briefScan(scan, ranked);
  assert.equal(b.games.length, ranked.length);
  assert.equal(b.games[0].top_line.id, ranked[0].line.id);
  assert.equal(b.order, 'horário (o mais próximo primeiro)');
  assert.ok(b.games.every(g => g.context.text.length && g.live_1h && g.top_line.context));
  // 20 jogos precisam caber numa conversa: ~5 KB por jogo
  assert.ok(toText(b).length / b.games.length < 5500, `${Math.round(toText(b).length / b.games.length)} bytes por jogo`);
  assert.equal(briefScan(scan, rankGames(scan.games)).games.length, rankGames(scan.games).length);
});
