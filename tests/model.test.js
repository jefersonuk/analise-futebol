import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMatch, dist, ev, fairOdd, politicaE, scoreMatrix, settle } from '../src/model.js';
import { fit, predict, prepare } from '../src/ratings.js';
import { leagueMatches } from '../src/demo.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const sum = e => e.reduce((s, [, p]) => s + p, 0);

function rng(seed) { let x = seed; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function pois(r, mu) { const l = Math.exp(-mu); let k = 0, p = r(); while (p > l) { k++; p *= r(); } return k; }
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};

// Liga sintética só com gols, forças conhecidas, 3 turnos completos.
function synthLeague(n = 16) {
  const r = rng(42), att = [], def = [], m = [];
  for (let i = 0; i < n; i++) { att.push(0.6 + r() * 0.8); def.push(0.6 + r() * 0.8); }
  let t = 0;
  for (let rep = 0; rep < 3; rep++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    m.push({ id: m.length, t: (t += 3600e3), h: i, a: j, hg: pois(r, 1.5 * att[i] * def[j]), ag: pois(r, 1.1 * att[j] * def[i]), s: null });
  }
  return { att, def, m, end: t + 1 };
}

test('dist soma 1, tem a média pedida e variância phi*mu', () => {
  for (const phi of [1, 1.8]) {
    const p = dist(10, phi, 120);
    near(p.reduce((s, x) => s + x, 0), 1, 1e-6);
    near(p.reduce((s, x, k) => s + x * k, 0), 10, 1e-4);
    near(p.reduce((s, x, k) => s + x * (k - 10) ** 2, 0), 10 * phi, 1e-3);
  }
});

test('matriz Dixon-Coles soma 1 e rho negativo aumenta o empate', () => {
  const dc = scoreMatrix(1.3, 1.1), ind = scoreMatrix(1.3, 1.1, 0);
  near(sum(dc.diff), 1); near(sum(dc.tot), 1);
  const draw = m => m.diff.find(([d]) => d === 0)[1];
  assert.ok(draw(dc) > draw(ind));
});

test('linha de quarto = média das meias-linhas vizinhas; linha inteira devolve no empate', () => {
  const { diff } = scoreMatrix(1.6, 1.0);
  const q = settle(diff, -0.75), a = settle(diff, -0.5), b = settle(diff, -1);
  near(q.pWin, (a.pWin + b.pWin) / 2); near(q.pLose, (a.pLose + b.pLose) / 2);
  const dnb = settle(diff, 0);
  assert.ok(dnb.pWin + dnb.pLose < 1);
  near(ev({ ...dnb, sc: [dnb] }, fairOdd(dnb)).mid, 0);
});

test('ajuste da liga recupera as forças verdadeiras', () => {
  const L = synthLeague();
  const f = fit('goals', prepare(L.m, L.end));
  const ids = L.att.map((_, i) => i);
  assert.ok(corr(ids.map(i => f.att.get(i)), L.att) > 0.85);
  assert.ok(corr(ids.map(i => f.def.get(i)), L.def) > 0.85);
  near(f.home, 1.5 / 1.1, 0.15);
});

test('mando próprio: time da altitude aparece com gap alto, os demais perto de 1', () => {
  const r = rng(7), n = 16, m = [];
  let t = 0;
  for (let rep = 0; rep < 3; rep++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    // time 0: forte em casa (×1,6 a favor, ÷1,6 contra) e fraco fora (o inverso, ×1,25)
    m.push({ id: m.length, t: (t += 3600e3), h: i, a: j, s: null,
      hg: pois(r, 1.4 * (i === 0 ? 1.6 : 1) * (j === 0 ? 1.25 : 1)), ag: pois(r, 1.1 / (i === 0 ? 1.6 : 1) / (j === 0 ? 1.25 : 1)) });
  }
  const f = fit('goals', prepare(m, t + 1));
  assert.ok(f.gap.get(0) > 1.2, `gap=${f.gap.get(0)}`);
  const others = [...f.gap].filter(([k]) => k !== 0).map(([, v]) => v);
  assert.ok(others.every(v => v > 0.8 && v < 1.2), others.join(','));
  const p = predict(f, 0, 5), q = predict(f, 5, 0);
  assert.ok(p.h / p.a > 2 * (q.a / q.h), 'forte em casa, fraco fora');
});

test('shrinkage: time com um só jogo fica perto da média', () => {
  const L = synthLeague();
  L.m.push({ id: -1, t: L.end - 1, h: 99, a: 0, hg: 6, ag: 0, s: null });
  const f = fit('goals', prepare(L.m, L.end));
  assert.ok(f.att.get(99) < 1.4, `att=${f.att.get(99)}`);
  const p = predict(f, 99, 0);
  assert.ok(p.seH > predict(f, 1, 0).seH);
});

test('análise completa na liga demo: 1X2 soma 1, totais complementares, dispersão limitada', () => {
  const matches = leagueMatches(1, 2025).concat(leagueMatches(1, 2024));
  const res = analyzeMatch(matches, 9001, 9002, Date.UTC(2026, 0, 10));
  const p = id => res.lines.find(l => l.id === id);
  near(sum(scoreMatrix(res.pred.goals.h, res.pred.goals.a).diff), 1);
  const o = p('gO2.5'), u = p('gU2.5');
  if (o && u) near(o.pWin + u.pWin, 1);
  assert.ok(res.phi.corners >= 1 && res.phi.corners <= 1.35);
  assert.ok(res.lines.some(l => l.market === 'Total de escanteios'));
  assert.ok(res.prep.coverage === 1);
});

test('toda linha tem os 4 cenários de incerteza, mesmo com média perto de x,5', () => {
  const matches = leagueMatches(1, 2025).concat(leagueMatches(1, 2024));
  for (let a = 9002; a <= 9020; a++) {
    const res = analyzeMatch(matches, 9001, a, Date.UTC(2026, 0, 10));
    for (const l of res.lines) assert.ok(l.sc.length === 4 && l.sc.every(Boolean), l.id);
    assert.ok(res.lines.some(l => l.id.startsWith('cornersO')));
    assert.deepEqual(res.lines.filter(l => l.market === '1X2').map(l => l.id), ['1', 'X', '2']);
  }
});

test('política E por faixa de odd', () => {
  assert.equal(politicaE(2.09).factor, 1);
  assert.equal(politicaE(2.1).factor, 0.5);
  assert.equal(politicaE(2.5).factor, 0.5);
  assert.equal(politicaE(3).factor, 0.25);
  assert.equal(politicaE(3.01).factor, 0);
});

test('escanteios 1º tempo: total ancorado na Pinnacle e handicap coerente', () => {
  const matches = leagueMatches(1, 2025).concat(leagueMatches(1, 2024));
  const free = analyzeMatch(matches, 9001, 9002, Date.UTC(2026, 0, 10));
  const model = free.pred.corners1h.h + free.pred.corners1h.a;
  // Pinnacle "precifica" 4,5 com over a 40%: total implícito abaixo do modelo
  const fair = new Map([['c1O4.5', 0.4], ['c1U4.5', 0.6]]);
  const anc = analyzeMatch(matches, 9001, 9002, Date.UTC(2026, 0, 10), { fair });
  const t = anc.pred.corners1h.h + anc.pred.corners1h.a;
  assert.ok(anc.anchors.corners1h && t < model, `${t} vs ${model}`);
  near(anc.pred.corners1h.h / anc.pred.corners1h.a, free.pred.corners1h.h / free.pred.corners1h.a, 1e-9);   // divisão entre os times mantida
  const h = id => anc.lines.find(l => l.id === id);
  const home = h('c1hH-0.5'), away = h('c1hA0.5');
  if (home && away) near(home.pWin + away.pWin, 1, 1e-9);
  assert.ok(anc.lines.some(l => l.market === 'Handicap escanteios 1T'));
});

import { diffDist, impliedCornerDiff, marketSupremacy, CORNERS_PER_GOAL } from '../src/model.js';
import { inviableReason, priceLines, isCandidate } from '../src/dossier.js';
import { recentGames } from '../src/insights.js';
import { isQuarter } from '../src/consistency.js';

test('handicap de escanteios da Pinnacle: a diferença implícita volta ao valor que gerou o preço', () => {
  for (const D of [-2.5, -0.8, 0, 1.3, 3]) {
    const T = 10.4, h = -1.5;   // linha "mandante −1,5"
    const r = settle(diffDist((T + D) / 2, (T - D) / 2, 1.2), h);
    const fair = new Map([[`chH${h}`, r.pWin / (r.pWin + r.pLose)], [`chA${-h}`, r.pLose / (r.pWin + r.pLose)]]);
    near(impliedCornerDiff(fair, T, 1.2), D, 0.01);
  }
});

// Liga sintética com escanteios, para o cenário "favorito fora de casa".
function cornersLeague() {
  const season = new Date().getUTCFullYear();
  return [season - 1, season].flatMap(s => leagueMatches(1, s));
}
const fairOf = (pairs) => new Map(pairs);
const x12 = (h, d, a) => { const z = 1 / h + 1 / d + 1 / a; return [['1', 1 / h / z], ['X', 1 / d / z], ['2', 1 / a / z]]; };

test('favorito pelo 1X2 leva os escanteios: a divisão segue o mercado, o total não muda', () => {
  const ms = cornersLeague(), h = ms[0].h, a = ms[1].a, t = ms[ms.length - 1].t + 864e5;
  const base = analyzeMatch(ms, h, a, t, {});
  // Helmond x Heracles: 6,30 / 5,12 / 1,51 e total de gols 2,9 (Over/Under 2,5 sem margem ~0,58)
  const fair = fairOf([...x12(6.302, 5.124, 1.509), ['gO2.5', 0.58], ['gU2.5', 0.42]]);
  const res = analyzeMatch(ms, h, a, t, { fair });
  const sup = res.favor.sup;
  assert.ok(sup < -1, `superioridade do visitante: ${sup}`);
  near(res.favor.diff_market, CORNERS_PER_GOAL[0] + CORNERS_PER_GOAL[1] * sup, 1e-9);
  assert.equal(res.favor.corners_source, '1x2');
  assert.ok(res.pred.corners.h - res.pred.corners.a < -2, 'visitante favorito com mais escanteios');
  near(res.pred.corners.h + res.pred.corners.a, base.pred.corners.h + base.pred.corners.a, 1e-9);
  assert.ok(res.pred.corners1h.h < res.pred.corners1h.a, '1º tempo segue o jogo');
  // handicap positivo para o favorito: inviável; para o azarão: jogável
  assert.match(inviableReason('c1hA1.5', res.favor, { home: 'Helmond', away: 'Heracles' }), /Heracles é o favorito/);
  assert.equal(inviableReason('c1hH1.5', res.favor, { home: 'Helmond', away: 'Heracles' }), null);
  assert.equal(inviableReason('ahA0.5', res.favor, {}) != null, true);
  assert.equal(inviableReason('ahA-1.5', res.favor, {}), null);   // favorito dando handicap: existe
  const teams = [['home', h], ['away', a]].map(([role, id]) => ({ role, name: role === 'home' ? 'Helmond' : 'Heracles', games: recentGames(res.prep, id) }));
  const { priced, anchored } = priceLines(res, { odds: new Map(), fair, alerts: [], teams });
  const fav = anchored.concat(priced).filter(l => /^c1hA\d/.test(l.id) && parseFloat(l.id.slice(4)) > 0);
  assert.ok(fav.every(l => l.inviable && !isCandidate(l)), 'Heracles +x no 1T nunca é candidata');
  assert.ok(res.all.find(l => l.id === 'c1hA1.5').pWin > 0.75, 'e o favorito +1,5 no 1T fica com acerto alto (odd de mercado baixa)');
});

test('jogo equilibrado: handicap positivo vale para os dois lados', () => {
  const ms = cornersLeague(), h = ms[0].h, a = ms[1].a, t = ms[ms.length - 1].t + 864e5;
  const res = analyzeMatch(ms, h, a, t, { fair: fairOf([...x12(2.6, 3.3, 2.75), ['gO2.5', 0.5], ['gU2.5', 0.5]]) });
  assert.ok(Math.abs(res.favor.sup) < 0.35);
  assert.equal(inviableReason('c1hA0.5', res.favor), null);
  assert.equal(inviableReason('c1hH0.5', res.favor), null);
});

test('modelo contra o mercado: alerta quando o modelo dá os escanteios ao outro time', () => {
  const ms = cornersLeague(), t = ms[ms.length - 1].t + 864e5;
  // procura um confronto em que o modelo dá mais escanteios ao mandante
  const pairs = [...new Set(ms.map(m => m.h))].flatMap(h => [...new Set(ms.map(m => m.a))].filter(a => a !== h).map(a => [h, a]));
  const [h, a] = pairs.find(([h, a]) => { const r = analyzeMatch(ms, h, a, t, {}); return r.pred.corners.h - r.pred.corners.a > 1.5; });
  const res = analyzeMatch(ms, h, a, t, { fair: fairOf([...x12(7, 5, 1.45), ['gO2.5', 0.6], ['gU2.5', 0.4]]) });
  assert.equal(res.favor.contra, true);
  assert.ok(res.pred.corners.h < res.pred.corners.a);
  near(res.favor.diff, res.favor.diff_market, 1e-9);   // modelo na direção errada: só o mercado
});

test('gols do 1º tempo: modelo pelo placar do intervalo, linhas de 0,5 em 0,5', () => {
  const season = new Date().getUTCFullYear();
  const ms = leagueMatches(1, season).concat(leagueMatches(1, season - 1));
  const res = analyzeMatch(ms, ms[0].h, ms[0].a, Date.now());
  const g = res.pred.goals, g1 = res.pred.goals1h;
  assert.ok(g1, 'previsão do 1º tempo');
  const share = (g1.h + g1.a) / (g.h + g.a);
  assert.ok(share > 0.3 && share < 0.6, `1º tempo = ${share} dos gols (demo: 45%)`);
  const o15 = res.lines.find(l => l.id === 'g1O1.5');
  assert.equal(o15.market, 'Total de gols 1T');
  assert.ok(res.all.filter(l => l.market === 'Total de gols 1T').every(l => Math.abs(parseFloat(l.id.slice(3)) * 2 % 1) < 1e-9));
  const noHalf = analyzeMatch(ms.map(m => ({ ...m, hh: null, ha: null })), ms[0].h, ms[0].a, Date.now());
  assert.equal(noHalf.pred.goals1h, null, 'sem placar do intervalo não há linha do 1º tempo');
});

test('linhas asiáticas fracionadas (,25 e ,75) ficam fora: handicap e total de gols só em linha inteira e meia', () => {
  assert.ok(isQuarter('ahH-0.75') && isQuarter('ahA1.25') && isQuarter('gO2.25') && isQuarter('c1O4.25'));
  assert.ok(!isQuarter('ahH-0.5') && !isQuarter('ahA1') && !isQuarter('gO2.5') && !isQuarter('cornersO10') && !isQuarter('1'));
  const season = new Date().getUTCFullYear(), ms = leagueMatches(1, season).concat(leagueMatches(1, season - 1));
  const res = analyzeMatch(ms, ms[0].h, ms[0].a, Date.now());
  assert.ok(res.all.length > 0 && !res.all.some(l => isQuarter(l.id)));
  assert.ok(res.all.some(l => l.id === 'ahH-1') && res.all.some(l => l.id === 'ahA0.5') && res.all.some(l => l.id === 'gU3'));
});
