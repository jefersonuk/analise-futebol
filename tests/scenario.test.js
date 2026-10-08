import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { BANDS, bandOf, buildScenario, derbyOf, motivation, scenarioDelta, scenarioLines, scenarioSignal, scenarioText } from '../src/scenario.js';
import { lineContext } from '../src/context.js';
import { CENARIO, rankGames, scanDay } from '../src/scanner.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 8, 19);
const fx = { id: 1, t: T0, home: { id: 1, name: 'Masar' }, away: { id: 2, name: 'Dakhleya' }, league: { id: 9, name: 'Liga' } };
// Masar em casa como favorito forte: vence por 3 (esperado +1,2); Dakhleya fora como zebra forte: perde por 3 (esperado −1,3)
function world({ homeScore = [3, 0], awayScore = [0, 3], n = 10 } = {}) {
  const rows = [];
  let id = 100;
  for (let k = 0; k < n; k++) {
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY, h: 1, a: 10 + k, hn: 'Masar', an: `Rival ${k}`, ln: 'Liga', hg: homeScore[0], ag: homeScore[1], sup: 1.2, xt: 2.6 });
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY - DAY, h: 20 + k, a: 2, hn: `Mandante ${k}`, an: 'Dakhleya', ln: 'Liga', hg: awayScore[1], ag: awayScore[0], sup: 1.3, xt: 2.6 });
    // jogos de outro papel: não entram no cenário
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY - 2 * DAY, h: 30 + k, a: 1, hn: `Grande ${k}`, an: 'Masar', ln: 'Liga', hg: 0, ag: 0, sup: 0.1, xt: 2.4 });
  }
  return rows;
}
const market = { s: 1.3, T: 2.8, source: 'pinnacle' };

test('papel pela superioridade esperada', () => {
  assert.deepEqual([1.4, 1, 0.6, 0.35, 0.2, -0.34, -0.35, -0.9, -1, -2].map(bandOf), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(BANDS[bandOf(1.3)], 'favorito forte');
});

test('cenário: o favorito que goleia nesse papel e a zebra que desaba puxam o saldo além da Pinnacle', () => {
  const sc = buildScenario({ rows: world(), fx, market });
  assert.equal(sc.band.home, 'favorito forte');
  assert.equal(sc.band.away, 'zebra forte');
  assert.equal(sc.home.n, 10, 'só os jogos em casa como favorito forte');
  assert.deepEqual([sc.home.w, sc.home.win2, sc.away.l, sc.away.lose2], [10, 1, 10, 1]);
  assert.ok(sc.home.resid > 1.5 && sc.away.resid < -1.5);
  assert.ok(sc.adj_sup > 0.4 && sc.adj_sup <= 0.6, `correção ${sc.adj_sup} (encolhida e com teto)`);
  assert.ok(sc.agree && sc.enough);
  // a correção move as linhas para o lado certo
  assert.ok(scenarioDelta('ahH-1.5', sc) > 0.05, 'favorito −1,5 sobe');
  assert.ok(scenarioDelta('ahA1.5', sc) < -0.05, 'zebra +1,5 cai');
  // sem nada além do esperado, nada muda
  const flat = buildScenario({ rows: world({ homeScore: [1, 0], awayScore: [0, 1] }).map(r => ({ ...r, sup: r.sup === 1.2 ? 1 : r.sup === 1.3 ? 1 : r.sup })), fx, market });
  assert.ok(Math.abs(flat.adj_sup) < 0.05, `sem desvio: ${flat.adj_sup}`);
});

test('checagem de cenário: handicap positivo na zebra que leva goleada vira contra e sai das apostas', () => {
  const sc = buildScenario({ rows: world(), fx, market });
  const sig = scenarioSignal('ahA1.5', sc, 0.66);
  assert.equal(sig.verdict, 'contra');
  assert.ok(sig.strong);
  assert.equal(scenarioSignal('ahH-1.5', sc, 0.45).verdict, 'a favor');
  // no contexto da linha, o cenário forte contra decide sozinho
  const c = { ctx: { scenario: sc, venue10: { home: {}, away: {} }, table: null }, games: { homeVenue: [], awayVenue: [], h2h: [] }, names: { home: 'Masar', away: 'Dakhleya' } };
  assert.equal(lineContext('ahA1.5', c, 0.66).verdict, 'contra');
  assert.match(scenarioText(sc, c.names).join(' '), /Masar em casa como favorito forte \(10 jogos\): 10V 0E 0D/);
});

test('aposta de cenário: odd perto de 2, valor na odd da Pinnacle, amostra e os dois lados de acordo', () => {
  const sc = buildScenario({ rows: world(), fx, market });
  const L = (id, line, odd, p) => ({ id, market: id.startsWith('ah') ? 'Handicap asiático' : id === '1' ? '1X2' : 'Total de gols', line, pinnacle_odd: odd, p_pinnacle: p });
  const out = scenarioLines(sc, [L('ahH-1.5', 'Masar −1,5', 2.05, 0.47), L('ahA1.5', 'Dakhleya +1,5', 1.85, 0.53), L('1', 'Masar vence', 1.3, 0.75),
    L('ahH-0.5', 'Masar −0,5', 1.3, 0.75), L('gU2.5', 'Menos de 2,5', 2.0, 0.49)], { banca: 44000 });
  const by = id => out.find(l => l.id === id);
  assert.ok(by('ahH-1.5').bet, `favorito −1,5: ${by('ahH-1.5').why_not}`);
  assert.ok(by('ahH-1.5').odd_min >= 1.8 && by('ahH-1.5').odd_min <= 2.05);
  assert.ok(!by('ahA1.5').bet && by('ahA1.5').ev_pinnacle < 0, 'zebra +1,5 sem valor pelo cenário');
  assert.ok(!by('1').bet && /fora do alvo/.test(by('1').why_not.join()), 'odd 1,30 fora do alvo');
  assert.equal(by('ahH-0.5'), undefined, '−0,5 é a própria vitória');
  assert.equal(by('gU2.5'), undefined, 'só over');
  assert.equal(out[0].id, 'ahH-1.5', 'aposta primeiro');
  // jogo difícil: nada vira aposta
  assert.ok(scenarioLines(sc, [L('ahH-1.5', 'x', 2.05, 0.47)], { hard: { reasons: ['x'] } }).every(l => !l.bet));
});

test('motivação pela tabela e clássico pela cidade', () => {
  assert.match(motivation({ rank: 1, of: 18, leader_gap: 0, played: 20 }), /título/);
  assert.match(motivation({ rank: 17, of: 18, leader_gap: 30, in_relegation: true, played: 20 }), /rebaixamento/);
  assert.match(motivation({ rank: 14, of: 18, leader_gap: 25, above_relegation: 2, played: 20 }), /pressionado/);
  assert.equal(motivation({ rank: 9, of: 18, leader_gap: 10, above_relegation: 12, played: 10 }), null);
  assert.equal(derbyOf({ city: 'Rio de Janeiro' }, { city: 'Rio De Janeiro' }), 'clássico local (Rio de Janeiro)');
  assert.equal(derbyOf({ city: 'Rio de Janeiro' }, { city: 'São Paulo' }), null);
  assert.equal(derbyOf(null, { city: 'X' }), null);
});

test('varredura: aba Cenário só com jogos que têm aposta de cenário, maior valor primeiro; v 9', async () => {
  let n = 0;
  const scan = await scanDay({ ...demo, stats: () => ({ api: n, cache: 0 }) }, { date: '2026-10-01', top: 10, budget: 5000 });
  assert.equal(scan.v, 9);
  const r = rankGames(scan.games, { market: CENARIO });
  assert.ok(r.length, 'jogos com leitura de cenário');
  assert.ok(r.every(x => x.line.scenario && x.line.bet && x.g.scenario.includes(x.line)), 'só jogos com aposta de cenário');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].line.ev_pinnacle >= r[i].line.ev_pinnacle, 'maior valor primeiro');
  for (const g of scan.games) for (const l of g.scenario || []) {
    assert.ok(!/^gU|^g1/.test(l.id), 'só over e só gols do jogo');
    if (l.bet) assert.ok(l.pinnacle_odd >= 1.8 && l.pinnacle_odd <= 2.7 && l.p_scenario >= 0.45 && l.ev_pinnacle >= 0.05);
  }
  assert.ok(scan.games.every(g => g.context.scenario), 'cada jogo leva o cenário no contexto');
  assert.ok(scan.games.every(g => (g.scenario || []).every(l => !l.history)), 'linha de cenário sem o histórico da outra lente');
});

test('análise completa: o dossiê traz as apostas de cenário e a leitura no contexto', async () => {
  const { buildDossier } = await import('../src/dossier.js');
  const { favorFor } = await import('../src/favoritism.js');
  const season = new Date().getUTCFullYear();
  const matches = favorFor(demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1))).matches;
  const fx = demo.upcoming(demo.searchTeams('')[0].id)[0];
  const d = await buildDossier({ ...demo, quota: () => null }, { fx, matches, lg: fx.league, oddsPayload: demo.fixtureOdds(fx.id) });
  assert.ok(d.context.scenario && d.context.scenario.band.home);
  assert.ok(Array.isArray(d.scenario_lines));
  assert.ok(d.scenario_lines.every(l => l.scenario && !l.history && !/^gU/.test(l.id)));
});
