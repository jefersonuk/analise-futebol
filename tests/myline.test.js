import test from 'node:test';
import assert from 'node:assert/strict';
import { alternatives, makePricer, nearest, parseLine, verdict } from '../src/myline.js';
import { analyzeMatch, dist, raceLines } from '../src/model.js';
import { buildDossier } from '../src/dossier.js';
import { history } from '../src/dashboard.js';
import { recentGames } from '../src/insights.js';
import * as demo from '../src/demo.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('linhas no texto do surebet.com e do app', () => {
  const id = t => parseLine(t).id;
  assert.equal(id('Ninguém vai conseguir 9 escanteios'), 'crN9');
  assert.equal(id('2 primeiro a vai conseguir 5 escanteios'), 'crA5');
  assert.equal(id('Acima 7.5 - escanteios'), 'cornersO7.5');
  assert.equal(id('1 - escanteios'), 'cx1');
  assert.equal(id('2 1º período - escanteios'), 'c1x2');
  assert.equal(id('Abaixo 4.5 1º período - escanteios'), 'c1U4.5');
  assert.equal(id('Abaixo 4.5 - escanteios 2º o time'), 'cAU4.5');
  assert.equal(id('H1(-1.5) - escanteios'), 'chH-1.5');
  assert.equal(id('AH2(+0.5) 1º período - escanteios'), 'c1hA0.5');
  assert.equal(id('Acima 2.5'), 'gO2.5');
  assert.equal(id('Menos de 2,75'), 'gU2.75');
  assert.equal(id('H1(-0.25)'), 'ahH-0.25');
  assert.equal(id('Casa −0,5'), 'ahH-0.5');
  assert.equal(id('X'), 'X');
  assert.equal(id('Ambas marcam - não'), 'bttsN');
  assert.ok(parseLine('Acima 1.5 2º tempo').error);
  assert.ok(parseLine('qualquer coisa').error);
});

test('corrida a N escanteios: as três pernas somam 1 e "ninguém" é os dois abaixo de N', () => {
  const muH = 5.6, muA = 4.1, phi = 1.25;
  const L = new Map(raceLines(muH, muA, phi).map(l => [l.id, l.pWin]));
  for (const N of [3, 5, 9]) near(L.get(`crH${N}`) + L.get(`crA${N}`) + L.get(`crN${N}`), 1, 1e-9);
  // ninguém chega a 9 = P(casa < 9 e fora < 9) na divisão binomial do total
  const pN = dist(muH + muA, phi, 120), q = muA / (muH + muA);
  let both = 0;
  for (let n = 0; n <= 120; n++) {
    let c = 1;
    for (let a = 0; a <= n; a++) {
      if (a) c = c * (n - a + 1) / a;
      if (a < 9 && n - a < 9) both += pN[n] * c * q ** a * (1 - q) ** (n - a);
    }
  }
  near(L.get('crN9'), both, 1e-9);
  assert.ok(L.get('crH5') > L.get('crA5'));   // quem tem mais escanteios chega antes
});

test('histórico da corrida: jogo em que os dois chegaram fica de fora', () => {
  const g = (cf, ca) => ({ t: 0, home: true, opp: 'R', gf: 0, ga: 0, corners: [cf, ca] });
  const gs = [g(6, 2), g(3, 7), g(5, 5), g(4, 4)];
  const h = history('crH5', 'home', 'Casa', gs);
  assert.deepEqual(h.bars.map(b => b.res).reverse(), ['win', 'lose', 'lose']);   // 5–5 sai
  assert.deepEqual(history('crN5', 'home', 'Casa', gs).bars.map(b => b.res).reverse(), ['lose', 'lose', 'lose', 'win']);
  assert.deepEqual(history('cx2', 'home', 'Casa', gs).bars.map(b => b.res).reverse(), ['lose', 'win', 'lose', 'lose']);
});

test('minha linha: preço, veredito e alternativas no jogo da demo', async () => {
  const season = new Date().getUTCFullYear();
  const matches = demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1));
  const fx = demo.upcoming(demo.searchTeams('')[0].id)[0];
  const api = { ...demo, quota: () => null };
  const dossier = await buildDossier(api, { fx, matches, lg: fx.league, oddsPayload: demo.fixtureOdds(fx.id) });
  const { collect } = await import('../src/odds.js');
  const result = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair: collect(demo.fixtureOdds(fx.id).bookmakers).fair });
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(result.prep, t.id) }));
  const price = makePricer({ dossier, result, teams, banca: 44000 });

  const g = price(dossier.lines_with_pinnacle.find(l => /^g[OU]/.test(l.id) && l.odd_min >= 1.5 && l.odd_min <= 2.5).id);
  assert.equal(g.priced_by, 'pinnacle');
  const race = price('crN9');   // sem odd na API: derivado do total de escanteios ancorado na Pinnacle
  assert.match(race.priced_by, /ancorado/);
  assert.ok(race.history.home.n > 0);

  // veredito: abaixo da justa não tem valor; acima da mínima, conforme o nível
  assert.equal(verdict(g, g.fair_odd_blend * 0.95).level, 'no');
  assert.equal(verdict(g, 3.4).level, 'no');   // Política E
  assert.equal(verdict(g, null).level, 'info');
  const v = verdict(g, g.odd_min + 0.01);
  assert.ok(['ok', 'mid'].includes(v.level));
  assert.ok(v.ev > 0);

  const { alts, best } = alternatives(price, g, dossier);
  assert.ok(alts.some(a => a.kind === 'escada' && a.l.id.slice(0, 2) === g.id.slice(0, 2)));
  assert.ok(alts.every(a => a.l.odd_min >= 1.5 && a.l.odd_min <= 3));
  assert.ok(!alts.some(a => a.l.id === g.id));
  if (best) assert.notEqual(best.id, g.id);

  assert.equal(price('gO9.5'), null);
  assert.match(nearest(price, 'gO9.5'), /^gO/);
});
