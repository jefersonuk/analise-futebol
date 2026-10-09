import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { BANDS, bandOf, buildScenario, conditionsOf, derbyOf, modelProb, motivation, scenarioDelta, scenarioLines, scenarioProb, scenarioSignal,
  scenarioText, strengthLevels } from '../src/scenario.js';
import { lineContext } from '../src/context.js';
import { CENARIO, rankGames, scanDay } from '../src/scanner.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 8, 19);
const fx = { id: 1, t: T0, home: { id: 1, name: 'Masar' }, away: { id: 2, name: 'Dakhleya' }, league: { id: 9, name: 'Liga' } };
// níveis na base: Masar forte, Dakhleya fraco; os rivais de Masar em casa são fracos, os mandantes que recebem a Dakhleya são fortes
const levels = new Map([[1, 'forte'], [2, 'fraco'], ...Array.from({ length: 10 }, (_, k) => [[10 + k, 'fraco'], [20 + k, 'forte'], [30 + k, 'médio']]).flat()]);
function world({ homeScore = [3, 0], awayScore = [0, 3], n = 10 } = {}) {
  const rows = [];
  let id = 100;
  for (let k = 0; k < n; k++) {
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY, h: 1, a: 10 + k, hn: 'Masar', an: `Fraco ${k}`, ln: 'Liga', hg: homeScore[0], ag: homeScore[1], sup: 1.2, xt: 2.6 });
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY - DAY, h: 20 + k, a: 2, hn: `Forte ${k}`, an: 'Dakhleya', ln: 'Liga', hg: awayScore[1], ag: awayScore[0], sup: 1.3, xt: 2.6 });
    rows.push({ id: id++, t: T0 - (k + 1) * 7 * DAY - 2 * DAY, h: 30 + k, a: 1, hn: `Médio ${k}`, an: 'Masar', ln: 'Liga', hg: 0, ag: 0, sup: -0.5, xt: 2.4 });
  }
  return rows;
}
const base = { s: 1.3, T: 2.8 }, market = { s: 1.3, T: 2.8 };

test('papel e nível', () => {
  assert.deepEqual([1.4, 1, 0.6, 0.35, 0.2, -0.34, -0.35, -0.9, -1, -2].map(bandOf), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(BANDS[bandOf(1.3)], 'favorito forte');
  const fit = { teams: new Set([1, 2, 3, 4, 5, 6]), games: new Map([1, 2, 3, 4, 5, 6].map(t => [t, 10])),
    att: new Map([[1, 1.6], [2, 1.3], [3, 1.0], [4, 1.0], [5, 0.8], [6, 0.6]]), def: new Map([[1, 0.6], [2, 0.8], [3, 1.0], [4, 1.0], [5, 1.2], [6, 1.5]]) };
  const lv = strengthLevels(fit);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(t => lv.get(t)), ['forte', 'forte', 'médio', 'médio', 'fraco', 'fraco']);
});

test('cenário pelo nível do adversário: o favorito que goleia os fracos e a zebra que apanha dos fortes', () => {
  const sc = buildScenario({ rows: world(), fx, base, market, levels });
  assert.equal(sc.home.how, 'em casa contra times fracos');
  assert.equal(sc.away.how, 'fora contra times fortes');
  assert.equal(sc.home.n, 10, 'os jogos contra médios não entram');
  assert.ok(sc.adj_sup > 0.4 && sc.adj_sup <= 0.6, `correção ${sc.adj_sup}`);
  assert.ok(sc.agree && sc.enough);
  assert.ok(scenarioDelta('ahH-1.5', sc) > 0.05 && scenarioDelta('ahA1.5', sc) < -0.05);
  assert.ok(Math.abs(modelProb('1', sc) - scenarioProb('1', sc) + scenarioDelta('1', sc)) < 1e-9);
});

test('o caso Rosenborg: goleia os fracos em casa, mas contra os fortes não vence — o cenário de hoje é contra forte', () => {
  const rows = [];
  let id = 1;
  const add = (opp, lvl, hg, ag, k) => rows.push({ id: id++, t: T0 - k * 5 * DAY, h: 1, a: opp, hn: 'Rosenborg', an: `${lvl} ${opp}`, ln: 'U19', hg, ag, sup: 1.0, xt: 3.5 });
  for (let k = 0; k < 6; k++) add(10 + k, 'fraco', 6, 1, k + 1);                    // goleadas nos fracos
  for (let k = 0; k < 5; k++) add(20 + k, 'forte', k % 2 ? 1 : 2, 2, k + 10);        // 2–2, 1–2… contra os fortes
  const lv = new Map([[1, 'forte'], [2, 'forte'], ...Array.from({ length: 6 }, (_, k) => [10 + k, 'fraco']), ...Array.from({ length: 5 }, (_, k) => [20 + k, 'forte'])]);
  const f2 = { ...fx, home: { id: 1, name: 'Rosenborg' }, away: { id: 2, name: 'Lillestrøm' } };
  const sc = buildScenario({ rows, fx: f2, base: { s: 0.8, T: 4.6 }, market: { s: 1.3, T: 4.9 }, levels: lv });
  assert.equal(sc.home.how, 'em casa contra times fortes');
  assert.deepEqual([sc.home.w, sc.home.d, sc.home.l], [0, 3, 2]);
  assert.ok(sc.home.resid < -1, 'contra os fortes rende bem abaixo do esperado');
  assert.ok(sc.sup < 0.8, `a nossa leitura aproxima os times: ${sc.sup}`);
  assert.match(scenarioText(sc, { home: 'Rosenborg', away: 'Lillestrøm' }).join(' '), /discordamos/);
});

test('nossa análise na linha: aposta quando o mercado paga a nossa mínima; senão na mira; condição vira "entrar se"', () => {
  const sc = buildScenario({ rows: world(), fx, base, market, levels });
  const L = (id, odd, p) => ({ id, market: id.startsWith('ah') ? 'Handicap asiático' : id === '1' ? '1X2' : 'Total de gols', line: id, pinnacle_odd: odd, p_pinnacle: p });
  const pFav = scenarioProb('ahH-1.5', sc);
  const out = scenarioLines(sc, [L('ahH-1.5', 2.1, 0.48), L('ahA1.5', 1.6, 0.6), L('ahH-1', 1.4, 0.68), L('ahH-0.5', 1.3, 0.75), L('1', 1.3, 0.75), L('gU2.5', 2, 0.5)]);
  const by = id => out.find(l => l.id === id);
  const fav = by('ahH-1.5');
  assert.ok(Math.abs(fav.p_nossa - Math.round(pFav * 100) / 100) < 0.011, 'a chance é a nossa, não a da Pinnacle');
  assert.equal(fav.status, 'aposta', `favorito −1,5: ${fav.why_not} ${fav.conditions}`);
  assert.ok(fav.contra && fav.tier === 'contra a Pinnacle' && fav.diff_pp > 5);
  assert.match(fav.why, /modelo .* · cenário \+/);
  assert.equal(by('ahH-1').status, 'na mira', 'a Pinnacle paga 1,40, abaixo da nossa mínima e do alvo');
  assert.equal(by('ahH-0.5'), undefined, '−0,5 é a própria vitória');
  assert.equal(by('gU2.5'), undefined, 'só over');
  assert.equal(by('ahA1.5').status, 'sem aposta', 'a nossa chance na zebra +1,5 fica abaixo de 45%');
  // a nossa leitura 12 pp ou mais longe da Pinnacle: entrar só depois de conferir escalação e notícias
  const far = scenarioLines(sc, [L('ahH-1.5', 2.2, 0.42)])[0];
  assert.equal(far.status, 'entrar se');
  assert.match(far.conditions.join(), /pp acima da Pinnacle/);
  const cond = scenarioLines(sc, [L('ahH-1.5', 2.1, 0.48)], { conditions: ['copa: risco de rodízio — confirmar a escalação'] })[0];
  assert.equal(cond.status, 'entrar se');
  assert.deepEqual(cond.conditions, ['copa: risco de rodízio — confirmar a escalação']);
  // ligas diferentes sem jogos entre elas: sem base para a nossa leitura
  const un = scenarioLines(sc, [L('ahH-1.5', 2.1, 0.48)], { hard: { reasons: ['Liga A x Liga B: só 3 jogos entre times das duas ligas na base'] } })[0];
  assert.equal(un.status, 'sem aposta');
});

test('checagem de cenário nas linhas da outra lente: zebra que apanha dos fortes vira contra', () => {
  const sc = buildScenario({ rows: world(), fx, base, market, levels });
  const sig = scenarioSignal('ahA1.5', sc, 0.66);
  assert.equal(sig.verdict, 'contra');
  assert.ok(sig.strong);
  const c = { ctx: { scenario: sc, venue10: { home: {}, away: {} }, table: null }, games: { homeVenue: [], awayVenue: [], h2h: [] }, names: { home: 'Masar', away: 'Dakhleya' } };
  assert.equal(lineContext('ahA1.5', c, 0.66).verdict, 'contra');
});

test('condições do jogo, motivação e clássico', () => {
  assert.match(conditionsOf({ fx, hard: { reasons: ['Rosenborg U19 e Lillestrøm U19: time de base, reservas ou B'] } })[0], /base\/B/);
  assert.match(conditionsOf({ fx: { ...fx, league: { name: 'Copa do Brasil' } } })[0], /copa/);
  assert.match(conditionsOf({ fx, injuries: [{ team: 1, player: 'Fulano', type: 'Questionable', reason: 'Knock' }, { team: 2, player: 'X', type: 'Missing Fixture', reason: 'Suspended' }] })[0], /dúvida: Fulano \(Masar\)/);
  assert.deepEqual(conditionsOf({ fx }), []);
  assert.match(motivation({ rank: 1, of: 18, leader_gap: 0, played: 20 }), /título/);
  assert.match(motivation({ rank: 17, of: 18, leader_gap: 30, in_relegation: true, played: 20 }), /rebaixamento/);
  assert.equal(derbyOf({ city: 'Rio de Janeiro' }, { city: 'Rio De Janeiro' }), 'clássico local (Rio de Janeiro)');
  assert.equal(derbyOf({ city: 'Rio de Janeiro' }, { city: 'São Paulo' }), null);
});

test('varredura: aba Nossa análise com aposta e "entrar se", aposta primeiro; v 11', async () => {
  let n = 0;
  const scan = await scanDay({ ...demo, stats: () => ({ api: n, cache: 0 }) }, { date: '2026-10-01', top: 10, budget: 5000 });
  assert.equal(scan.v, 11);
  const r = rankGames(scan.games, { market: CENARIO });
  assert.ok(r.every(x => x.line.ours && (x.line.bet || x.line.conditional) && x.g.scenario.includes(x.line)));
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].line.bet >= r[i].line.bet, 'aposta antes de "entrar se"');
  for (const g of scan.games) for (const l of g.scenario || []) {
    assert.ok(!/^gU|^g1/.test(l.id) && !l.history);
    if (l.bet) assert.ok(l.p_nossa >= 0.45 && l.pinnacle_odd >= l.odd_min && l.pinnacle_odd >= 1.8 && l.pinnacle_odd <= 2.7);
  }
  assert.ok(scan.games.every(g => g.context.scenario?.base), 'cada jogo leva a nossa leitura no contexto');
});

test('análise completa: o dossiê traz as linhas da nossa análise', async () => {
  const { buildDossier } = await import('../src/dossier.js');
  const { favorFor } = await import('../src/favoritism.js');
  const season = new Date().getUTCFullYear();
  const matches = favorFor(demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1))).matches;
  const f = demo.upcoming(demo.searchTeams('')[0].id)[0];
  const d = await buildDossier({ ...demo, quota: () => null }, { fx: f, matches, lg: f.league, oddsPayload: demo.fixtureOdds(f.id) });
  assert.ok(d.context.scenario?.base);
  assert.ok(d.scenario_lines.every(l => l.ours && !l.history && !/^gU/.test(l.id)));
});

test('reabrir análise guardada antes da nossa análise: refaz a leitura com o modelo atual, sem quebrar', async () => {
  const { buildDossier, repriceDossier } = await import('../src/dossier.js');
  const { favorFor } = await import('../src/favoritism.js');
  const { analyzeMatch } = await import('../src/model.js');
  const { collect } = await import('../src/odds.js');
  const { recentGames } = await import('../src/insights.js');
  const season = new Date().getUTCFullYear();
  const fv = favorFor(demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1)));
  const f = demo.upcoming(demo.searchTeams('')[0].id)[0], oddsP = demo.fixtureOdds(f.id);
  const d = await buildDossier({ ...demo, quota: () => null }, { fx: f, matches: fv.matches, lg: f.league, oddsPayload: oddsP, favor: fv.cal });
  // o formato da versão anterior: sem o modelo separado do cenário (sc.base), linhas de cenário antigas
  const old = { ...d, context: { ...d.context, scenario: { band: { home: 'favorito', away: 'zebra' }, home: { n: 6 }, away: { n: 6 }, sup: 0.5, total: 2.6,
    adj_sup: 0.1, adj_total: 0, derby: 'clássico local (Cairo)' } }, scenario_lines: [{ id: 'gO2.5', scenario: true }] };
  assert.deepEqual(scenarioLines(old.context.scenario, d.lines_with_pinnacle), []);
  assert.deepEqual(scenarioText(old.context.scenario, { home: 'A', away: 'B' }), []);
  assert.equal(scenarioSignal('1', old.context.scenario, 0.5), null);
  const res = analyzeMatch(fv.matches, f.home.id, f.away.id, f.t, { fair: collect(oddsP.bookmakers).fair, favor: fv.cal });
  const teams = [['home', f.home], ['away', f.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id) }));
  const again = repriceDossier(old, res, oddsP, teams);
  assert.ok(again.context.scenario?.base, 'leitura refeita no formato atual');
  assert.equal(again.context.scenario.derby, 'clássico local (Cairo)', 'o clássico guardado continua');
  assert.ok(again.context.text.some(t => t.startsWith('Nossa leitura')));
  assert.deepEqual(again.scenario_lines.map(l => l.id), d.scenario_lines.map(l => l.id));
  assert.ok(again.scenario_lines.every(l => l.ours && l.status));
});
