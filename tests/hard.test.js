import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { MIN_LINKS, applyHard, hardGame, isYouth } from '../src/hard.js';
import { buildDossier, isBet, repriceDossier, teamNames } from '../src/dossier.js';
import { analyzeMatch } from '../src/model.js';
import { collect } from '../src/odds.js';
import { recentGames } from '../src/insights.js';
import { scanDay } from '../src/scanner.js';

test('time de base, reservas ou B pelo nome', () => {
  for (const n of ['Fulham U21', 'Arsenal U23', 'Real Madrid II', 'Benfica B', 'Jong Ajax', 'Juventus Next Gen', 'Flamengo Sub-20',
    'Inter Miami CF II', 'Liverpool Reserves'])
    assert.ok(isYouth(n), n);
  for (const n of ['AFC Hornchurch', 'Bayern München', 'Club Brugge KV', 'Boavista', 'Arsenal W', 'Atlético Mineiro', 'Blackburn Rovers', 'Botafogo',
    'Boca Juniors', 'Argentinos Juniors', 'Universitatea Craiova', 'Young Boys'])
    assert.ok(!isYouth(n), n);
});

// base com duas ligas (100 e 200) e uma copa entre elas (300) com `links` jogos entre times das duas ligas
function base(links) {
  const rows = [];
  let id = 1, t = Date.UTC(2026, 0, 1);
  const g = (h, a, lg) => rows.push({ id: id++, t: (t += 864e5), h, a, lg, ln: `Liga ${lg}`, hg: 1, ag: 1 });
  for (let r = 0; r < 4; r++) for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) if (i !== j) { g(i, j, 100); g(10 + i, 10 + j, 200); }
  for (let k = 0; k < links; k++) g(1 + (k % 6), 11 + ((k * 5) % 6), 300);
  return rows;
}
const cupFx = { home: { id: 1, name: 'Clube Alfa' }, away: { id: 11, name: 'Clube Beta' }, league: { id: 300, name: 'Copa' } };

test('ligas diferentes: difícil com poucos jogos entre elas, normal com bastante', () => {
  const few = hardGame({ fx: cupFx, rows: base(5) });
  assert.ok(few && few.reasons.some(r => /Liga 100 x Liga 200: só 5 jogos entre times das duas ligas/.test(r)));
  assert.equal(hardGame({ fx: cupFx, rows: base(MIN_LINKS + 5) }), null);
  // mesma liga: nada
  assert.equal(hardGame({ fx: { ...cupFx, away: { id: 2, name: 'Clube Gama' }, league: { id: 100, name: 'Liga 100' } }, rows: base(0) }), null);
  // time de base: difícil mesmo na mesma liga
  assert.match(hardGame({ fx: { ...cupFx, away: { id: 2, name: 'Clube Gama U21' }, league: { id: 100, name: 'Liga 100' } }, rows: base(0) }).reasons[0], /Clube Gama U21: time de base/);
});

test('regra: só over de gols com a odd da Pinnacle, com metade da entrada; o resto fica bloqueado', () => {
  const hard = { reasons: ['x'] }, L = (id, extra) => ({ id, priced_by: 'pinnacle', entry_brl: 200, ...extra });
  const over = applyHard(L('gO2.5'), hard);
  assert.equal(over.entry_brl, 100);
  assert.ok(over.reduced && !over.blocked);
  assert.ok(applyHard(L('g1O1.5'), hard).reduced);
  for (const l of [L('cornersO9'), L('ahH-0.5'), L('c1O4.5'), L('gO2.5', { priced_by: 'derivada do total da Pinnacle', derived: true }), L('gO2.5', { priced_by: 'só o modelo' })])
    assert.ok(applyHard(l, hard).blocked, l.id + ' ' + l.priced_by);
  assert.deepEqual(applyHard(L('cornersO9'), null), L('cornersO9'), 'jogo normal: nada muda');
  const cand = { tier: 'sólida', odd_min: 1.7, politica_e: 'cheia', odd_min_vs_pinnacle_pct: 2, p_blend: 0.65 };
  assert.ok(!isBet({ ...cand, id: 'cornersO9', blocked: 'x' }));
});

test('varredura: jogo com time sub-21 só deixa over de gols da Pinnacle, sem plano ao vivo', async () => {
  let n = 0;
  const round = demo.dayFixtures().map((f, i) => (i === 0 ? { ...f, home: { ...f.home, name: `${f.home.name} U21` } } : f));
  const api = { ...demo, stats: () => ({ api: n, cache: 0 }), dayFixtures: () => round };
  const scan = await scanDay(api, { date: '2026-10-01', top: 10, budget: 5000 });
  const g = scan.games.find(x => x.fx.id === round[0].id);
  assert.ok(g.hard && /U21: time de base/.test(g.hard.reasons[0]));
  assert.equal(g.live1h, null);
  assert.ok(g.alerts.some(a => a.startsWith('jogo difícil')));
  assert.ok(g.lines.every(l => (l.priced_by === 'pinnacle' && /^g1?O/.test(l.id) ? l.reduced && !l.blocked : l.blocked)));
  assert.ok(g.lines.filter(isBet).every(l => /^g1?O/.test(l.id)));
  assert.ok(scan.games.filter(x => x !== g).every(x => !x.hard && x.lines.every(l => !l.blocked)), 'os outros jogos não mudam');
});

test('análise completa: jogo difícil no dossiê, candidatas só over de gols, e a regra continua ao reabrir', async () => {
  const season = new Date().getUTCFullYear();
  const matches = demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1));
  const f0 = demo.upcoming(demo.searchTeams('')[0].id)[0], fx = { ...f0, away: { ...f0.away, name: `${f0.away.name} II` } };
  const oddsP = demo.fixtureOdds(fx.id);
  const d = await buildDossier({ ...demo, quota: () => null }, { fx, matches, lg: fx.league, oddsPayload: oddsP });
  assert.ok(d.hard_game && d.live_1h === null);
  assert.ok(d.data_quality.alerts.some(a => /^jogo difícil de analisar/.test(a)));
  const all = d.lines_with_pinnacle.concat(d.lines_anchored);
  assert.ok(d.candidates.concat(d.candidates_focus).every(id => /^g1?O/.test(id)));
  assert.ok(all.filter(l => !/^g1?O/.test(l.id) || l.priced_by !== 'pinnacle').every(l => l.blocked));
  // reabrir uma análise guardada: refaz o preço e mantém a regra
  const { fair } = collect(oddsP.bookmakers);
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair });
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id) }));
  assert.deepEqual(teamNames(teams), { home: fx.home.name, away: fx.away.name });
  const again = repriceDossier(d, res, oddsP, teams);
  assert.deepEqual(again.hard_game, d.hard_game);
  assert.equal(again.live_1h, null);
  assert.ok(again.lines_with_pinnacle.filter(l => !/^g1?O/.test(l.id)).every(l => l.blocked));
});
