import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, h2hGames, lineContext, profile, teamGames } from '../src/context.js';
import { isBet, isCandidate } from '../src/dossier.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 1, 18);
let seq = 1;
// jogo compacto: placar, 1º tempo, escanteios do jogo (s[4], s[9]) e do 1º tempo
const m = (daysAgo, h, a, hg, ag, { hh = 0, ha = 0, ch = 5, ca = 4, c1 = [2, 2] } = {}) => ({
  id: seq++, t: T0 - daysAgo * DAY, h, a, hn: `Time ${h}`, an: `Time ${a}`, ln: 'Liga', hg, ag, hh, ha,
  s: [5, 5, 3, 10, ch, 5, 5, 3, 10, ca], c1 });
const fx = { id: 999, t: T0, home: { id: 1, name: 'Mandante' }, away: { id: 2, name: 'Visitante' } };
const res = { pred: { goals: { h: 1.7, a: 1.1 } }, phi: {}, favor: { sup: 0.6, source: 'modelo' }, anchors: {} };

// mandante goleia em casa, visitante sofre e marca fora, confrontos com muitos gols
function goalsWorld() {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(m(7 + 14 * i, 1, 3 + (i % 5), 3, 1, { hh: 1, ha: 1 }));
  for (let i = 0; i < 10; i++) rows.push(m(10 + 14 * i, 3 + (i % 5), 2, 2, 2, { hh: 1, ha: 0 }));
  rows.push(m(60, 1, 2, 3, 2), m(250, 2, 1, 2, 2), m(420, 1, 2, 4, 1));
  return rows;
}
// tudo fechado: 1 a 0, 0 a 0
function tightWorld() {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(m(7 + 14 * i, 1, 3 + (i % 5), i % 2, 0, { ch: 3, ca: 2, c1: [1, 1] }));
  for (let i = 0; i < 10; i++) rows.push(m(10 + 14 * i, 3 + (i % 5), 2, 1, 0, { ch: 3, ca: 3, c1: [1, 1] }));
  rows.push(m(60, 1, 2, 0, 0), m(250, 2, 1, 1, 0), m(420, 1, 2, 1, 1));
  return rows;
}

test('jogos e médias do time no mando de hoje, do ponto de vista dele', () => {
  const rows = goalsWorld();
  const home = teamGames(rows, 1, T0, { venue: 'home' }), away = teamGames(rows, 2, T0, { venue: 'away' });
  assert.equal(home.length, 10);
  assert.ok(home.every(g => g.home) && away.every(g => !g.home));
  const p = profile(home);
  // os 10 mais recentes em casa incluem o confronto direto de 60 dias atrás (3 a 2)
  assert.equal(p.gf, 3); assert.equal(p.ga, 1.1); assert.equal(p.goals, 4.1); assert.equal(p.over25, 1);
  assert.equal(p.corners_for, 5); assert.equal(p.corners_against, 4); assert.equal(p.corners_1h, 4);
  assert.equal(profile(away).gf, 2);
});

test('confronto direto: junta a API (todas as competições) com a base, corta 5 anos, visto pelo mandante de hoje', () => {
  const rows = goalsWorld();
  const extra = [
    { id: 7001, t: T0 - 100 * DAY, h: 2, a: 1, hg: 0, ag: 1, hh: 0, ha: 0, ln: 'Copa' },     // só na API (copa)
    { id: rows.find(x => x.h === 1 && x.a === 2).id, t: T0 - 60 * DAY, h: 1, a: 2, hg: 3, ag: 2 },   // também na base
    { id: 7002, t: T0 - 6 * 365 * DAY, h: 1, a: 2, hg: 5, ag: 0 },                            // velho demais
  ];
  const g = h2hGames(rows, extra, 1, 2, T0);
  assert.equal(g.length, 4, 'os 3 da base + o da copa; o de 6 anos atrás fica de fora');
  const cup = g.find(x => x.league === 'Copa');
  assert.ok(cup && !cup.home && cup.gf === 1 && cup.ga === 0, 'vitória fora do mandante de hoje, pelo placar dele');
  assert.ok(g.find(x => x.t === T0 - 60 * DAY).corners, 'o jogo que está na base traz os escanteios');
});

test('contexto a favor: mando, médias e confronto direto confirmam o over', () => {
  const c = buildContext({ rows: goalsWorld(), fx, res });
  const x = lineContext('gO2.5', c, 0.62);
  assert.equal(x.verdict, 'a favor');
  assert.deepEqual(x.signals.map(s => [s.kind, s.verdict]), [['mando', 'a favor'], ['médias', 'a favor'], ['confronto direto', 'a favor']]);
  assert.match(c.ctx.text.find(t => t.startsWith('Confronto direto')), /3 jogos em 5 anos\): 4,7 gols por jogo, over 2,5 em 3\/3/);
});

test('contexto contra tira a candidata das apostas', () => {
  const c = buildContext({ rows: tightWorld(), fx, res });
  const x = lineContext('gO2.5', c, 0.62);
  assert.equal(x.verdict, 'contra');
  assert.ok(x.contra >= 2);
  const line = { id: 'gO2.5', market: 'Total de gols', tier: 'sólida', odd_min: 1.7, politica_e: 'cheia', odd_min_vs_pinnacle_pct: 2, context: x };
  assert.ok(isCandidate(line) && !isBet(line));
  assert.ok(isBet({ ...line, context: lineContext('gO2.5', buildContext({ rows: goalsWorld(), fx, res }), 0.62) }));
  // escanteios do 1º tempo pelas médias dos dois no mando: 2 por jogo contra a linha 4,5
  assert.equal(lineContext('c1O4.5', c, 0.55).signals.find(s => s.kind === 'médias').verdict, 'contra');
});

test('tabela: situação de cada time, médias da temporada em casa e fora, e o handicap contra o mais bem colocado', () => {
  const row = (team, rank, points, zone, home, away) => ({ team, rank, points, played: 25, gd: 0, group: 'Liga', zone, gf: home[1] + away[1], ga: home[2] + away[2],
    home: { played: home[0], gf: home[1], ga: home[2] }, away: { played: away[0], gf: away[1], ga: away[2] } });
  const table = [row(3, 1, 55, 'Promotion', [12, 25, 8], [13, 20, 12]), row(1, 2, 50, 'Promotion', [12, 30, 10], [13, 15, 15]),
    row(9, 17, 24, null, [12, 12, 15], [13, 10, 20]), row(2, 18, 22, 'Relegation', [12, 12, 18], [13, 9, 26])];
  const c = buildContext({ rows: goalsWorld(), fx, table, res });
  assert.equal(c.ctx.table.home.leader_gap, 5);
  assert.ok(c.ctx.table.away.in_relegation);
  assert.equal(c.ctx.table.home.home.gf_pg, 2.5);
  const tab = c.ctx.text[0];
  assert.match(tab, /Mandante 2º\/4 \(50 pts em 25 jogos, 5 pts do líder\)/);
  assert.match(tab, /Visitante 18º\/4 .*na zona de rebaixamento/);
  assert.match(c.ctx.text[1], /Mandante em casa marca 2,5 e sofre 0,8/);
  // visitante −0,5 (dando gol) contra o 2º colocado jogando em casa: tabela, médias e mando contra
  const x = lineContext('ahA-0.5', c, 0.45);
  assert.equal(x.signals.find(s => s.kind === 'tabela').verdict, 'contra');
  assert.equal(x.signals.find(s => s.kind === 'médias').verdict, 'contra');
  assert.equal(x.verdict, 'contra');
  // o mandante −0,5: a favor
  assert.equal(lineContext('ahH-0.5', c, 0.6).verdict, 'a favor');
});
