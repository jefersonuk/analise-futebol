import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../src/odds.js';
import { FAV_P, favHalfWin } from '../src/favhalf.js';
import { settleLine } from '../src/settlement.js';
import { HALF_MAX, buildPlan, halfMin, planFromKeys, planKeys, planText, planFunnel } from '../src/plan.js';
import { buildPlanSim } from '../src/sim.js';

// a Pinnacle de um jogo: 1X2, o resultado do 1º tempo (13) e o handicap asiático do 1º tempo (19)
const pin = (bets) => [{ id: 4, name: 'Pinnacle', bets }];
const x12 = (h, d, a) => ({ id: 1, values: [{ value: 'Home', odd: String(h) }, { value: 'Draw', odd: String(d) }, { value: 'Away', odd: String(a) }] });
const ht = (h, d, a) => ({ id: 13, values: [{ value: 'Home', odd: String(h) }, { value: 'Draw', odd: String(d) }, { value: 'Away', odd: String(a) }] });
const ah1 = (home, away) => ({ id: 19, values: [{ value: 'Home -0.5', odd: String(home) }, { value: 'Away -0.5', odd: String(away) }] });
const res = (h, a) => ({ pred: { goals1h: { h, a } } });
const names = { home: 'Forte', away: 'Fraco' };

test('odds: o resultado do 1º tempo (13) e o handicap do 1º tempo (19) entram com a chance sem margem', () => {
  const { odds, fair } = collect(pin([x12(1.4, 4.8, 8), ht(2.05, 2.25, 7.5), ah1(2.06, 1.82)]));
  assert.equal(odds.get('1T1'), 2.05); assert.equal(odds.get('a1H-0.5'), 2.06); assert.equal(odds.get('a1A0.5'), 1.82);
  const s = fair.get('1T1') + fair.get('1TX') + fair.get('1T2');
  assert.ok(Math.abs(s - 1) < 1e-9 && fair.get('1T1') > 0.45 && fair.get('1T1') < 0.49);
});

test('favorito no 1º tempo: só com favoritismo alto (60%+), a Pinnacle do 1º tempo com 10% do modelo; sem o 13, o handicap −0,5', () => {
  const { odds, fair } = collect(pin([x12(1.4, 4.8, 8), ht(2.05, 2.25, 7.5), ah1(2.06, 1.82)]));
  const c = favHalfWin({ res: res(0.9, 0.3), fair, odds, names });
  assert.equal(c.id, '1T1'); assert.equal(c.line, 'Forte vence o 1º tempo'); assert.equal(c.pinnacle_odd, 2.05); assert.equal(c.priced_by, 'pinnacle');
  assert.ok(c.p_fav_ft >= FAV_P && c.p_model > 0.45 && Math.abs(c.p_blend - c.p_pinnacle) < 0.02, JSON.stringify(c));
  // sem o resultado do 1º tempo, o handicap −0,5 (a mesma aposta)
  const b = collect(pin([x12(1.4, 4.8, 8), ah1(2.06, 1.82)]));
  const c2 = favHalfWin({ res: res(0.9, 0.3), fair: b.fair, odds: b.odds, names });
  assert.equal(c2.id, '1T1'); assert.equal(c2.pinnacle_odd, 2.06); assert.match(c2.priced_by, /handicap asiático do 1º tempo/);
  // favorito do visitante
  const v = collect(pin([x12(8, 4.8, 1.4), ht(7.5, 2.25, 2.05)]));
  assert.equal(favHalfWin({ res: res(0.3, 0.9), fair: v.fair, odds: v.odds, names }).id, '1T2');
  // jogo equilibrado: nada
  const e = collect(pin([x12(2.1, 3.4, 3.5), ht(2.9, 2.0, 4.1)]));
  assert.equal(favHalfWin({ res: res(0.7, 0.6), fair: e.fair, odds: e.odds, names }), null);
});

test('liquidação pelo placar do intervalo', () => {
  const g = g1 => ({ home: true, opp: 'Fraco', gf: 3, ga: 1, g1 });
  assert.equal(settleLine('1T1', g([1, 0]), 'Forte').winner, 'A');
  assert.equal(settleLine('1T1', g([0, 0]), 'Forte').winner, 'RED');
  assert.equal(settleLine('1T1', g([1, 1]), 'Forte').winner, 'RED');
  assert.equal(settleLine('1T2', g([0, 1]), 'Forte').winner, 'A');
  assert.equal(settleLine('1TX', g([1, 1]), 'Forte').winner, 'A');
  assert.equal(settleLine('1T1', { home: true, opp: 'Fraco', gf: 1, ga: 0, g1: null }, 'Forte'), null, 'sem o placar do intervalo: sem resultado');
});

test('plano: até 5 favoritos no 1º tempo, de 1,70 a 2,70, pelo preço da Pinnacle (o modelo do 1º tempo não filtra) e o alvo ao alcance', () => {
  const NOW = Date.UTC(2026, 9, 14, 0), H = 3600e3;
  let id = 0;
  const G = (half, extra = {}) => { const f = ++id;
    return { fx: { id: f, t: NOW + (10 + f) * H, home: { id: f * 10, name: `Forte ${f}` }, away: { id: f * 10 + 1, name: `Fraco ${f}` }, league: { id: 9100 + f, name: `Liga ${f}` } },
      lines: [], scenario: [], fav_combos: [], fav_half: half && { id: '1T1', market: 'Resultado 1º tempo', line: `Forte ${f} vence o 1º tempo`, fav: true, half: true, side: '1',
        p_fav_ft: 0.7, p_model: 0.47, p_pinnacle: 0.46, pinnacle_odd: 2.1, p_blend: 0.461, priced_by: 'pinnacle', tier: 'especulativa', ...half }, ...extra }; };
  const games = [G({}), G({ p_blend: 0.48 }), G({ p_blend: 0.47 }), G({ p_blend: 0.465 }),          // candidatos
    G({ pinnacle_odd: 1.6 }),                                                                        // abaixo de 1,70: fora
    G({ p_model: 0.4 }),                                                                             // o modelo 6 pp abaixo: entra (ele comprime o favorito)
    G({ p_blend: 0.38, p_pinnacle: 0.38, pinnacle_odd: 2.5 }),                                     // alvo 2,68: 7% acima — entraria, mas é copa
    G(null), G({ p_blend: 0.49 }), G({ p_blend: 0.455 }),                                           // mais dois candidatos: 7, entram os 5 mais prováveis
    G({ p_pinnacle: 0.44, pinnacle_odd: 2.05 })];                                                   // alvo 2,32: 13% acima da Pinnacle — fora
  games[6].conditions = ['copa: risco de rodízio — confirmar a escalação'];                       // copa: fora
  const scan = { generated_at: new Date(NOW).toISOString(), date: '2026-10-14', games };
  const plan = buildPlan(scan, { now: NOW });
  assert.equal(HALF_MAX, 5);
  assert.equal(plan.halves.length, HALF_MAX);
  assert.deepEqual(plan.halves.map(x => x.g.fx.id).sort((a, b) => a - b), [1, 2, 3, 4, 9]);
  const h = plan.halves.find(x => x.g.fx.id === 2);
  assert.equal(h.line.odd_min, halfMin(h.line)); assert.equal(h.line.odd_min, Math.round(100 * 1.02 / 0.46) / 100, 'pela chance da Pinnacle');
  assert.equal(halfMin({ p_blend: 0.62 }), 1.7, 'nunca abaixo de 1,70 (a faixa do 1X2)');
  // desmarcado, some; guardado e refeito; texto; simulação na odd da Pinnacle
  assert.equal(buildPlan(scan, { now: NOW, markets: ['gols', 'favorito'] }).halves.length, 0);
  assert.deepEqual(planFromKeys(scan, planKeys(plan)).halves.map(x => x.g.fx.id), plan.halves.map(x => x.g.fx.id));
  assert.match(planText(plan), /FAVORITO NO 1º TEMPO \(5\)\n1\. .* — Forte \d vence o 1º tempo · odd ≥ [\d,]+ \(Pinnacle 2,10\) · 20 €\n/);
  const sim = buildPlanSim(plan).bets.filter(b => b.cat === 'Plano: favorito 1º tempo');
  assert.equal(sim.length, 5); assert.ok(sim.every(b => b.odd === 2.1 && b.odd_src === 'pinnacle' && b.lineId === '1T1' && b.stake_brl === 20), 'a favor da Pinnacle: entrada cheia');
  // funil: os 5 no bloco, os outros dois no bloco cheio
  const f = planFunnel(scan, plan);
  assert.deepEqual([f.half, f.full], [5, 2]);
});
