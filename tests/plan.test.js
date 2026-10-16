import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { BLOCKS, COMBO_KEY, COMBO_ODDS, COMBO_P, FAV_KEY, FAV_ODDS, FAV_P, GOALS_KEY, GOALS_ODDS, HALF_KEY, HALF_MAX, LENS, PER_LEAGUE, PLAN_DEFAULT, PLAN_MAX, PLAN_OPTIONS,
  agreeMin, buildPlan, favMin, halfMin, lineOfBet, needOf, planChance, planEntries, planFromKeys, planFunnel, planKeys, planText, simLine, valueOf } from '../src/plan.js';
import { buildPlanSim } from '../src/sim.js';
import { PLAN_SCAN, scanDay } from '../src/scanner.js';

const NOW = Date.UTC(2026, 9, 16, 23), H = 3600e3;
let id = 0;
const ctx = (verdict = 'neutro') => ({ verdict, signals: [] });
// o mais de 1,5 consistente (🤝) e a vitória do mandante no 1X2 (🏆), com a odd da Pinnacle pela chance dela (margem de 2,5% e 3%)
const over15 = (p, extra = {}) => ({ id: 'gO1.5', market: 'Total de gols', line: 'Mais de 1,5', tier: 'âncora', consistency_score: 0.8, p_model: p + 0.01, p_blend: p,
  p_pinnacle: p, pinnacle_odd: +(1 / p / 1.025).toFixed(2), politica_e: 'cheia', context: ctx(), ...extra });
const home1 = (p, extra = {}) => ({ id: '1', market: '1X2', line: 'Casa vence', tier: 'sólida', p_model: p - 0.06, p_blend: p - 0.01, p_pinnacle: p,
  pinnacle_odd: +(1 / p / 1.03).toFixed(2), hit_rate_last10: 0.6, context: ctx(), ...extra });
// um jogo de amanhã (o mandante C<id> é o favorito):
//   ours: [p_nossa, p_pinnacle, odd da Pinnacle] da 🎯 no mais de 2,5 (cond: "entrar se…"); agree: a chance do mais de 1,5 (🤝);
//   fav: a chance do mandante vencer pela Pinnacle (🏆); combo: a vitória do mandante + 1,5 (🔗; + 2,5 e + 3,5 com 18 pp a menos
//   cada, mínima = justa × 1,05); half: a chance do mandante vencer o 1º tempo (⏱️)
const G = ({ h = 14, lg = 1, ours = null, cond = false, agree = null, fav = null, combo = null, half = null, hard = null, conditions = [] } = {}) => {
  const f = ++id;
  return { fx: { id: f, t: NOW + h * H, home: { id: f * 10, name: `C${f}` }, away: { id: f * 10 + 1, name: `F${f}` }, league: { id: lg, name: `Liga ${lg}` } }, hard, conditions,
    scenario: ours ? [{ id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', bet: !cond, conditional: cond, contra: ours[0] - ours[1] >= 0.05, p_nossa: ours[0], p_pinnacle: ours[1],
      pinnacle_odd: ours[2], odd_min: +(1.05 / ours[0]).toFixed(2), entry_brl: 150, why: 'modelo +3 · cenário +2' }] : [],
    lines: [...(agree ? [over15(agree)] : []), ...(fav ? [home1(fav)] : [])],
    fav_combos: combo ? [1.5, 2.5, 3.5].map((L, k) => { const p = combo - k * 0.18; return { id: `cb:1+gO${L}`, market: 'Combo', combo: true, fav: true, line: `C${f} vence + Mais de ${L} gols`,
      legs: [{ id: '1', line: `C${f} vence`, p: 0.7, push: 0, fair_odd: 1.43 }, { id: `gO${L}`, line: `Mais de ${L} gols`, p: 0.8 - k * 0.25, fair_odd: 1.25 }],
      tier: 'especulativa', p_blend: p, p_pinnacle: p, push_pinnacle: 0, fair_odd_blend: +(1 / p).toFixed(2), odd_min: +(1.05 / p).toFixed(2), entry_brl: 100 }; }) : [],
    fav_half: half ? { id: '1T1', market: 'Resultado 1º tempo', line: `C${f} vence o 1º tempo`, fav: true, half: true, side: '1', p_fav_ft: 0.7, p_model: half, p_pinnacle: half,
      p_blend: half, pinnacle_odd: +(1 / half / 1.04).toFixed(2), priced_by: 'pinnacle', tier: 'especulativa' } : null };
};
const scanOf = (games, extra = {}) => ({ generated_at: new Date(NOW).toISOString(), date: '2026-10-17', games, ...extra });
const byId = xs => xs.map(x => [x.g.fx.id, x.lens ?? x.line?.id ?? x.combo?.id]).sort((a, b) => a[0] - b[0]);

test('o foco (16/10): quatro blocos, até 20 entradas, 5 por liga e até 5 no 1º tempo', () => {
  assert.deepEqual(BLOCKS, [COMBO_KEY, GOALS_KEY, FAV_KEY, HALF_KEY]);
  assert.deepEqual(PLAN_OPTIONS.map(([k]) => k), BLOCKS); assert.deepEqual(PLAN_DEFAULT, BLOCKS);
  assert.deepEqual([PLAN_MAX, PER_LEAGUE, HALF_MAX], [20, 5, 5]);
  assert.deepEqual([COMBO_P, COMBO_ODDS, GOALS_ODDS, FAV_P, FAV_ODDS], [0.45, [1.65, 2.7], [1.3, 2.7], 0.5, [1.5, 2.7]]);
  assert.equal(valueOf({ p_nossa: 0.6, p_pinnacle: 0.5, pinnacle_odd: 2 }), 0.1);
});

test('⚽ total de gols: a 🎯 nossa leitura (pelo valor) primeiro; sem ela, o over consistente em 🤝 acordo com a Pinnacle; só over, odd da Pinnacle de 1,30 a 2,70', () => {
  id = 0;
  const games = [
    G({ lg: 1, ours: [0.62, 0.55, 1.95] }),                    // 🎯: valor 14,1%, contra a Pinnacle (7 pp acima dela)
    G({ lg: 2, ours: [0.6, 0.56, 1.85], agree: 0.72 }),        // 🎯 e 🤝 no mesmo jogo: a 🎯 (valor 7,3%)
    G({ lg: 3, agree: 0.72 }),                                  // 🤝
    G({ lg: 4, ours: [0.6, 0.5, 1.62] }),                      // 🎯 sem valor (55% × 1,62 < 1) e sem 🤝: fora
    G({ lg: 5, ours: [0.85, 0.8, 1.22] }),                     // a Pinnacle a 1,22: abaixo de 1,30
    G({ lg: 6, ours: [0.62, 0.55, 1.95], cond: true }),        // "entrar se…": fora
    G({ lg: 7, agree: 0.72, conditions: ['copa: risco de rodízio — confirmar a escalação'] }),   // escalação: fora
    G({ lg: 8, agree: 0.72, conditions: ['dúvida: Fulano (F8) — confirmar se joga'] }),          // dúvida de desfalque: o 🤝 entra (a Pinnacle já embute)
    G({ lg: 9, agree: 0.72, hard: { reasons: ['base'] } }),    // jogo difícil: fora
    G({ lg: 10 }),                                              // under: nunca
  ];
  games[9].scenario = [{ id: 'gU2.5', market: 'Total de gols', line: 'Menos de 2,5', bet: true, p_nossa: 0.62, p_pinnacle: 0.55, pinnacle_odd: 1.95 }];
  const plan = buildPlan(scanOf(games), { now: NOW });
  assert.deepEqual(byId(plan.goals), [[1, 'ours'], [2, 'ours'], [3, 'agree'], [8, 'agree']]);
  assert.deepEqual([plan.sameGame.length, plan.fav.length, plan.halves.length], [0, 0, 0]);
  const g1 = plan.goals.find(x => x.g.fx.id === 1), g3 = plan.goals.find(x => x.g.fx.id === 3);
  assert.equal(g1.value, valueOf(g1.line)); assert.equal(g1.value, 0.141);
  assert.equal(g3.value, needOf(g3.line)); assert.equal(g3.line.odd_min, agreeMin(over15(0.72)));
  // texto: a frente e a entrada (a 🎯 contra a Pinnacle: metade)
  const txt = planText(plan, { dateLabel: 'sábado, 17/10' });
  assert.match(txt, /^PLANO sábado, 17\/10 · entrada 20 € a favor da Pinnacle, 10 € contra\n\nTOTAL DE GOLS \(4\)\n/);
  assert.match(txt, new RegExp(`C1 x F1 — Mais de 2,5 · odd ≥ [\\d,]+ \\(Pinnacle 1,95\\) · ${LENS.ours} · contra a Pinnacle · 10 €`));
  assert.match(txt, new RegExp(`C3 x F3 — Mais de 1,5 · odd ≥ 1,42 \\(Pinnacle 1,36\\) · ${LENS.agree} · 20 €`));
  assert.match(txt, /\n\nTOTAL: 4 entradas · 70 €$/, '10 € + 3 × 20 €');
  // simulação: o total de gols separado pela frente, na odd da Pinnacle
  const sim = buildPlanSim(plan);
  assert.deepEqual([...new Set(sim.bets.map(b => b.cat))].sort(), ['Plano: total de gols (acordo com a Pinnacle)', 'Plano: total de gols (nossa leitura)']);
  assert.ok(sim.bets.every(b => b.odd_src === 'pinnacle'));
  assert.equal(sim.bets.reduce((t, b) => t + b.stake_brl, 0), 70);
});

test('🤝 gols: alvo = a justa + 2% (piso 1,30) até 8% acima da Pinnacle; fora o contexto contra, a especulativa, o modelo 5 pp abaixo e a linha que ela não cota', () => {
  id = 0;
  const mk = extra => { const g = G({ lg: 20 + id }); g.lines = [over15(0.64, extra)]; return g; };
  const games = [
    mk({ odd_min: 1.64 }),                                                  // 64% a 1,52: alvo 1,59 (4,6% acima) — entra
    mk({ p_blend: 0.6, p_pinnacle: 0.6, pinnacle_odd: 1.5 }),              // alvo 1,70: 13% acima da Pinnacle — fora
    mk({ context: ctx('contra') }),                                          // contexto contra: fora
    mk({ tier: 'especulativa' }),                                            // sem consistência: fora
    mk({ p_model: 0.58 }),                                                   // o modelo 6 pp abaixo da Pinnacle: fora
    mk({ derived: true }),                                                   // a Pinnacle não cota a linha (derivada): fora
    mk({ p_blend: 0.8, p_pinnacle: 0.8, p_model: 0.81, pinnacle_odd: 1.22 }),   // a Pinnacle a 1,22: abaixo de 1,30
  ];
  const plan = buildPlan(scanOf(games), { now: NOW });
  assert.deepEqual(byId(plan.goals), [[1, 'agree']]);
  const a = plan.goals[0];
  assert.equal(a.line.odd_min, 1.59); assert.equal(agreeMin(over15(0.64)), Math.round(100 * 1.02 / 0.64) / 100);
  assert.equal(a.value, Math.round((1.59 / 1.52 - 1) * 1000) / 1000);
  assert.ok(a.line.entry_brl > 0, 'a entrada sai do alvo (¼ Kelly)');
  assert.equal(games[0].lines[0].odd_min, 1.64, 'a linha da varredura fica como está');
  assert.equal(agreeMin({ p_blend: 0.8 }), 1.3, 'nunca abaixo de 1,30');
  assert.match(planText(plan), /odd ≥ 1,59 \(Pinnacle 1,52\)/);
  const sim = buildPlanSim(plan).bets[0];
  assert.deepEqual([sim.odd, sim.odd_src, sim.cat, sim.stake_brl], [1.52, 'pinnacle', 'Plano: total de gols (acordo com a Pinnacle)', 20]);
});

test('🏆 vitória do favorito: o lado com 50%+ pela Pinnacle, cotado de 1,50 a 2,70; alvo = a justa dela + 2% (piso 1,50) até 8% acima; o modelo não filtra', () => {
  id = 0;
  const games = [
    G({ lg: 1, fav: 0.6 }),                          // 60% a 1,62: entra (alvo 1,70)
    G({ lg: 2, fav: 0.5 }),                          // 50% a 1,94: entra (alvo 2,04)
    G({ lg: 3, fav: 0.47 }),                         // jogo equilibrado (47%): fora — acertou 1 de 14 nas simulações
    G({ lg: 4, fav: 0.7 }),                          // 70% a 1,39: abaixo de 1,50 — fora (é jogo para o mesmo jogo ou o 1º tempo)
    G({ lg: 5, fav: 0.55, conditions: ['copa: risco de rodízio — confirmar a escalação'] }),   // escalação: fora
    G({ lg: 6, fav: 0.55, conditions: ['dúvida: Fulano (C6) — confirmar se joga'] }),          // dúvida: entra (o preço é o da Pinnacle)
    G({ lg: 7, fav: 0.56, hard: { reasons: ['base'] } }),                                       // jogo difícil: fora
  ];
  const away = G({ lg: 8 }); away.lines = [{ ...home1(0.58), id: '2', line: 'Fora vence' }, { ...home1(0.24), id: 'X', line: 'Empate' }];
  const far = G({ lg: 9 }); far.lines = [home1(0.6, { pinnacle_odd: 1.55 })];   // alvo 1,70: 9,7% acima da Pinnacle — fora
  const model = G({ lg: 10 }); model.lines = [home1(0.58, { p_model: 0.45 })];  // o modelo comprime o favorito: entra mesmo assim
  games.push(away, far, model);
  const plan = buildPlan(scanOf(games), { now: NOW });
  assert.deepEqual(byId(plan.fav), [[1, '1'], [2, '1'], [6, '1'], [8, '2'], [10, '1']]);
  const f1 = plan.fav.find(x => x.g.fx.id === 1);
  assert.deepEqual([f1.line.odd_min, f1.line.fav, f1.value], [1.7, true, null]);
  assert.equal(favMin(home1(0.5)), 2.04); assert.equal(favMin({ p_pinnacle: 0.7 }), 1.5, 'nunca abaixo de 1,50');
  assert.equal(games[0].lines[0].odd_min, undefined, 'a linha da varredura fica como está');
  // texto com o nome do favorito; simulação na odd da Pinnacle, entrada cheia
  const txt = planText(plan);
  assert.match(txt, /VITÓRIA DO FAVORITO \(5\)\n1\. .* — C1 vence · odd ≥ 1,70 \(Pinnacle 1,62\) · 20 €\n/);
  assert.match(txt, / — F8 vence · odd ≥ 1,76 \(Pinnacle 1,67\) · 20 €/);
  const sim = buildPlanSim(plan).bets;
  assert.ok(sim.length === 5 && sim.every(b => b.cat === 'Plano: vitória do favorito' && b.odd_src === 'pinnacle' && b.stake_brl === 20));
  assert.equal(sim.find(b => b.fixtureId === 1).odd, 1.62);
  assert.equal(planFunnel(scanOf(games), plan).fav, 5);
});

test('🔗 mesmo jogo: vitória do favorito + 1,5; se ela paga menos de 1,65, a de 2,5 (e a de 3,5); abaixo de 45% ou com escalação a conferir, fora', () => {
  id = 0;
  const games = [
    G({ lg: 1, combo: 0.58 }),                       // 1,5 a 1,81: entra a de 1,5
    G({ lg: 2, combo: 0.72 }),                       // 1,5 a 1,46 (pouco): entra a de 2,5 (54% a 1,94)
    G({ lg: 3, combo: 0.645 }),                      // 1,5 a 1,63 (abaixo de 1,65): a de 2,5 (46,5% a 2,26)
    G({ lg: 4, combo: 0.47 }),                       // 1,5 a 47% (2,23): entra
    G({ lg: 5, combo: 0.44 }),                       // 1,5 a 44%: fora (2,5 a 26% também)
    G({ lg: 6, combo: 0.9 }),                        // favorito muito forte: 1,5 a 1,17 e 2,5 a 1,46 pagam pouco; entra a de 3,5 (54% a 1,94)
    G({ lg: 7, combo: 0.6, conditions: ['copa: risco de rodízio — confirmar a escalação'] }),   // copa: fora
    G({ lg: 8, combo: 0.6, conditions: ['dúvida: Beltrano (C8) — confirmar se joga'] }),        // dúvida: entra
  ];
  const plan = buildPlan(scanOf(games), { now: NOW });
  assert.deepEqual(byId(plan.sameGame), [[1, 'cb:1+gO1.5'], [2, 'cb:1+gO2.5'], [3, 'cb:1+gO2.5'], [4, 'cb:1+gO1.5'], [6, 'cb:1+gO3.5'], [8, 'cb:1+gO1.5']]);
  assert.ok(plan.sameGame.every(x => x.combo.p_blend >= COMBO_P && x.combo.odd_min >= COMBO_ODDS[0] && x.combo.odd_min <= COMBO_ODDS[1]));
  // trocou a linha de gols na tela: as chaves guardam a escolhida
  const i = plan.sameGame.findIndex(x => x.g.fx.id === 1);
  plan.sameGame[i] = { g: plan.sameGame[i].g, combo: plan.sameGame[i].g.fav_combos[1] };
  assert.equal(planFromKeys(scanOf(games), planKeys(plan)).sameGame[i].combo.id, 'cb:1+gO2.5');
  // na simulação, na odd que a Pinnacle pagaria (a justa pelas chances dela com a margem dela)
  const sim = buildPlanSim(plan).bets.filter(x => x.cat === 'Plano: mesmo jogo');
  assert.equal(sim.length, 6); assert.ok(sim.every(b => b.stake_brl === 20), 'preço da Pinnacle: entrada cheia');
  for (const b of sim) {
    const c = plan.sameGame.find(x => x.g.fx.id === b.fixtureId).combo;
    assert.equal(b.odd_src, 'pinnacle est.');
    assert.ok(b.odd < c.odd_min && b.odd < c.fair_odd_blend, `${b.odd} abaixo da justa ${c.fair_odd_blend} e da mínima ${c.odd_min}: o pior cenário`);
  }
  assert.match(planText(plan), /^PLANO .*\n\nMESMO JOGO \(6\)\n1\. .* · odd ≥ [\d,]+ · 20 €\n/);
});

test('⏱️ favorito no 1º tempo no plano: até 5, os mais prováveis', () => {
  id = 0;
  const games = Array.from({ length: 7 }, (_, i) => G({ lg: 400 + i, half: 0.46 + i * 0.005 }));
  const plan = buildPlan(scanOf(games), { now: NOW });
  assert.equal(plan.halves.length, HALF_MAX);
  assert.deepEqual(plan.halves.map(x => x.g.fx.id).sort((a, b) => a - b), [3, 4, 5, 6, 7]);
  assert.ok(plan.halves.every(x => x.line.odd_min === halfMin(x.line)));
  assert.equal(planFunnel(scanOf(games), plan).full, 2, 'os outros dois: o bloco cheio');
});

test('rodízio: até 20 entradas, o bloco com menos entradas pega o próximo jogo (no empate, mesmo jogo, gols, favorito, 1º tempo); um jogo uma vez só', () => {
  id = 0;
  const games = [
    ...Array.from({ length: 6 }, (_, i) => G({ lg: 100 + i, combo: 0.5 + i * 0.01 })),
    ...Array.from({ length: 6 }, (_, i) => G({ lg: 200 + i, agree: 0.72 })),
    ...Array.from({ length: 6 }, (_, i) => G({ lg: 300 + i, fav: 0.5 + i * 0.01 })),
    ...Array.from({ length: 7 }, (_, i) => G({ lg: 400 + i, half: 0.46 + i * 0.005 })),
    G({ lg: 500, combo: 0.6, agree: 0.72, fav: 0.55, half: 0.5 }),   // candidato nos quatro: entra uma vez, no primeiro que o pega (o mesmo jogo)
  ];
  const scan = scanOf(games), plan = buildPlan(scan, { now: NOW });
  const xs = planEntries(plan), ids = xs.map(x => x.g.fx.id);
  assert.equal(xs.length, PLAN_MAX);
  assert.equal(new Set(ids).size, ids.length, 'nenhum jogo repetido');
  assert.deepEqual([plan.sameGame.length, plan.goals.length, plan.fav.length, plan.halves.length], [5, 5, 5, 5]);
  assert.ok(plan.sameGame.some(x => x.g.fx.id === 26) && ids.filter(f => f === 26).length === 1);
  assert.deepEqual(plan.sameGame.map(x => x.combo.p_blend).sort(), [0.52, 0.53, 0.54, 0.55, 0.6], 'os de maior chance');
  // o funil: os que sobraram com candidato ficam no "plano cheio"; as contas fecham
  const f = planFunnel(scan, plan);
  assert.deepEqual([f.same, f.goals, f.fav, f.half, f.full], [5, 5, 5, 5, 6]);
  // as chaves refazem o mesmo plano
  const back = planFromKeys(scan, planKeys(plan));
  assert.deepEqual(planEntries(back).map(x => `${x.block}:${x.g.fx.id}:${x.line.id}`), xs.map(x => `${x.block}:${x.g.fx.id}:${x.line.id}`));
  // texto e simulação com os quatro blocos
  const txt = planText(plan);
  assert.deepEqual(txt.match(/^[A-ZÁÉÍÓÚÃÕÇº 0-9]+ \(\d+\)$/gm), ['MESMO JOGO (5)', 'TOTAL DE GOLS (5)', 'VITÓRIA DO FAVORITO (5)', 'FAVORITO NO 1º TEMPO (5)']);
  assert.match(txt, /\n\nTOTAL: 20 entradas · 400 €$/);
  const sim = buildPlanSim(plan);
  assert.equal(sim.bets.length, 20);
  assert.deepEqual([...new Set(sim.bets.map(b => b.cat))], ['Plano: mesmo jogo', 'Plano: total de gols (acordo com a Pinnacle)', 'Plano: vitória do favorito', 'Plano: favorito 1º tempo']);
});

test('no máximo 5 por liga; jogo com entrada e jogo que já começou ficam fora', () => {
  id = 0;
  const games = [...Array.from({ length: 7 }, () => G({ lg: 1, agree: 0.72 })), G({ lg: 2, fav: 0.55 }), G({ lg: 3, fav: 0.55, h: -1 })];
  const exposed = { has: f => f === 8 };
  const scan = scanOf(games), plan = buildPlan(scan, { now: NOW, exposed });
  assert.equal(plan.goals.length, PER_LEAGUE);
  assert.equal(plan.fav.length, 0);
  assert.equal(plan.stats.exposed, 1);
  const f = planFunnel(scan, plan, { exposed });
  assert.deepEqual([f.goals, f.cap, f.exposed, f.started], [5, 2, 1, 1]);
});

test('funil do plano: cada jogo analisado cai numa etapa só e as contas fecham', () => {
  id = 0;
  const games = [
    ...Array.from({ length: 7 }, (_, i) => G({ lg: 1, ours: [0.56 + i * 0.01, 0.5, 2.0] })),   // 5 em gols, 2 no teto da liga
    G({ lg: 2, ours: [0.6, 0.5, 2.0], cond: true }),                                               // entrar se…: escalação
    G({ lg: 3, ours: [0.6, 0.5, 2.0], hard: { reasons: ['base'] } }),                              // jogo difícil
    G({ lg: 4, ours: [0.6, 0.5, 2.0], h: -1 }),                                                    // já começou
    G({ lg: 5, ours: [0.46, 0.5, 2.0] }),                                                          // sem valor: nenhuma linha passou
    G({ lg: 6, ours: [0.62, 0.5, 2.1] }),                                                          // já tem entrada
  ];
  const scan = scanOf(games, { fixtures: 40, with_odds: 14, outside: 9, analyzed: 13, skipped: [{ why: 'liga fora do orçamento de requisições' }] });
  const exposed = { has: f => f === 12 };
  const plan = buildPlan(scan, { now: NOW, exposed });
  const f = planFunnel(scan, plan, { exposed });
  assert.deepEqual({ goals: f.goals, cap: f.cap, lineup: f.lineup, hard: f.hard, started: f.started, none: f.none, exposed: f.exposed },
    { goals: 5, cap: 2, lineup: 1, hard: 1, started: 1, none: 1, exposed: 1 });
  assert.equal(f.quoted, 23); assert.equal(f.unkept, 1); assert.deepEqual(f.skipped, { 'limite de requisições': 1 });
  const placed = ['same', 'goals', 'fav', 'half', 'started', 'small', 'exposed', 'cap', 'full', 'hard', 'lineup', 'none'].reduce((s, k) => s + f[k], 0);
  assert.equal(placed + f.unkept, f.analyzed, 'analisados = não guardados + destinos');
  // guardado pelas chaves: o mesmo funil (a hora do plano vai junto)
  assert.deepEqual(planFunnel(scan, planFromKeys(scan, planKeys(plan)), { exposed }), f);
});

test('blocos e ligas marcados: só os blocos escolhidos; com "só as grandes", as ligas menores ficam fora', () => {
  id = 0;
  const games = [G({ lg: 39, combo: 0.55 }), G({ lg: 9002, agree: 0.72 }), G({ lg: 9003, fav: 0.55 }), G({ lg: 9004, half: 0.48 })];   // 39: Premier League
  const scan = scanOf(games);
  const only = buildPlan(scan, { now: NOW, markets: [GOALS_KEY, FAV_KEY] });
  assert.deepEqual(planEntries(only).map(x => x.block), [GOALS_KEY, FAV_KEY]);
  assert.deepEqual(planFromKeys(scan, planKeys(only)).markets, [GOALS_KEY, FAV_KEY]);
  const big = buildPlan(scan, { now: NOW, big: true });
  assert.deepEqual(planEntries(big).map(x => x.g.fx.id), [1]);
  assert.equal(big.stats.small, 3);
  assert.equal(planFromKeys(scan, planKeys(big)).big, true);
  assert.deepEqual(planEntries(buildPlan(scan, { now: NOW })).map(x => x.block), BLOCKS, 'todos marcados: um de cada');
});

test('chaves do plano: a guarda de antes do foco (v 2) e a varredura que mudou montam de novo', () => {
  id = 0;
  const games = [G({ lg: 1, agree: 0.72 }), G({ lg: 2, fav: 0.55 })];
  const scan = scanOf(games), plan = buildPlan(scan, { now: NOW });
  assert.equal(planKeys(plan).v, 3);
  assert.equal(planFromKeys(scan, { scan_at: plan.scan_at, singles: [], sameGame: [], multis: [] }), null, 'guarda de antes do foco');
  assert.equal(planFromKeys(scanOf([games[0]]), planKeys(plan)), null, 'o jogo do favorito saiu da varredura');
});

test('planChance: a maior chance entre os candidatos do jogo (a varredura do plano guarda por ela); sem candidato, 0', () => {
  id = 0;
  assert.equal(planChance(G({ combo: 0.55 })), 0.55);
  assert.equal(planChance(G({ fav: 0.55 })), 0.55);
  assert.equal(planChance(G({ ours: [0.62, 0.55, 1.95] })), 0.62);
  assert.equal(planChance(G({ ours: [0.62, 0.55, 1.95], cond: true })), 0.62, 'antes do contexto, o "entrar se…" conta');
  assert.equal(planChance(G({ fav: 0.45 })), 0);
  assert.equal(planChance(G({})), 0);
  assert.equal(planChance(G({ combo: 0.55, fav: 0.6 })), 0.6);
  assert.equal(planChance(G({ combo: 0.55, fav: 0.6 }), { markets: [COMBO_KEY] }), 0.55);
});

test('varredura do plano na demo: guarda só jogos com candidato; o plano sai nos blocos e sem jogo repetido', async () => {
  const sc = await scanDay({ ...demo, stats: () => ({ api: 0, cache: 0 }) }, { date: '2026-10-01', top: 3 * PLAN_MAX, half: false, markets: [PLAN_SCAN] });
  assert.deepEqual(sc.markets, [PLAN_SCAN]);
  assert.ok(sc.games.length && sc.games.every(g => planChance(g) > 0), 'só jogos com candidato');
  const plan = buildPlan(sc, { now: 0 });
  const xs = planEntries(plan), ids = xs.map(x => x.g.fx.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(xs.length > 0 && xs.length <= PLAN_MAX, 'a demo rende alguma entrada');
  assert.ok(xs.every(x => BLOCKS.includes(x.block)));
});

test('janela de horas a partir de agora: exata no plano (expand: false), crescente na varredura (padrão)', async () => {
  const now = Date.UTC(2026, 9, 8, 15);
  const fx = (id, h) => ({ id, t: now + h * H, league: { id: 9, season: 2026, name: 'Liga' }, home: { id: id * 10, name: `A${id}` }, away: { id: id * 10 + 1, name: `B${id}` } });
  const list = [fx(1, 0.5), fx(2, 0.9), fx(3, 3), fx(4, 7)];
  const api = { stats: () => ({ api: 0 }), dayFixtures: async () => list, dayOdds: async () => list.map(f => ({ fixture: f.id, bookmakers: [{ bets: [{ id: 1 }] }] })),
    hasLeague: async () => true, leagueMatches: async () => [], attachHalfCorners: async (a, b, ms) => ms };
  const exact = await scanDay(api, { hours: 1, now, top: 20, half: false, expand: false });
  assert.equal(exact.fixtures, 2, 'só os jogos da próxima hora');
  assert.equal(exact.hours, 1);
  assert.ok(exact.window.to - exact.window.from <= H);
  const grown = await scanDay(api, { hours: 1, now, top: 20, half: false });
  assert.ok(grown.hours > 1 && grown.fixtures === 4, 'a varredura amplia quando falta jogo');
});

test('simulação do plano: uma por montagem, com o nome da janela', () => {
  const plan = { date: '2026-10-08', scan_at: new Date(NOW).toISOString(), sameGame: [], goals: [], fav: [], halves: [] };
  const sim = buildPlanSim(plan, { id: 'plano-123', win: 'h4', label: '08/10, 13:12–17:12 (próximas 4 h)' });
  assert.equal(sim.id, 'plano-123'); assert.equal(sim.win, 'h4'); assert.match(sim.label, /próximas 4 h/);
  assert.equal(buildPlanSim(plan).id, 'plano-2026-10-08', 'sem id: um por data');
});

test('simulação → linha do ➕: a do plano (🤝 e favorito com o alvo, 1º tempo com a mínima dele, combo e nossa leitura como estão); sem a análise, a da simulação', () => {
  const ag = over15(0.64), fv = home1(0.6);
  const sc = { id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', scenario: true, p_nossa: 0.62, p_pinnacle: 0.55, pinnacle_odd: 1.95, odd_min: 1.69, contra: true };
  const cb = { id: 'cb:1+gO1.5', market: 'Combo', line: 'C vence + Mais de 1,5', combo: true, fav: true, p_blend: 0.55, odd_min: 1.91 };
  const half = { id: '1T1', market: 'Resultado 1º tempo', line: 'C vence o 1º tempo', fav: true, p_blend: 0.47, p_pinnacle: 0.46, pinnacle_odd: 2.1, odd_min: 2.19 };
  const g = { fx: { id: 7 }, lines: [ag, fv], scenario: [sc], fav_combos: [cb], fav_half: half };
  const b = (cat, lineId) => ({ cat, lineId });
  assert.equal(lineOfBet(g, b('Plano: total de gols (acordo com a Pinnacle)', 'gO1.5')).odd_min, agreeMin(ag), 'o alvo do 🤝, não a mínima do app');
  const f = lineOfBet(g, b('Plano: vitória do favorito', '1'));
  assert.deepEqual([f.odd_min, f.fav], [favMin(fv), true]);
  assert.equal(lineOfBet(g, b('Plano: favorito 1º tempo', '1T1')).odd_min, halfMin(half));
  assert.equal(lineOfBet(g, b('Plano: total de gols (nossa leitura)', 'gO2.5')), sc);
  assert.equal(lineOfBet(g, b('Plano: mesmo jogo', 'cb:1+gO1.5')), cb);
  assert.equal(lineOfBet(g, b('Gols', 'gO9.5')), null, 'a análise não tem a linha');
  const s = simLine({ lineId: 'cb:1+gO2.5', market: 'Combo', line: 'C vence + Mais de 2,5 gols', p: 0.5, p_pinnacle: 0.49, odd: 2.1, odd_src: 'pinnacle est.' });
  assert.deepEqual([s.from_sim, s.combo, s.p_blend, s.fair_odd_blend, s.odd_min, s.pinnacle_odd, s.priced_by], [true, true, 0.5, 2, null, null, 'simulação']);
  assert.equal(simLine({ lineId: 'gO2.5', p: 0.6, odd: 1.7, odd_src: 'pinnacle' }).priced_by, 'pinnacle', 'na odd da Pinnacle: o CLV é medido');
});
