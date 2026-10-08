import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { ODDS, PER_LEAGUE, SAME_GAME, SINGLES, buildPlan, planFromKeys, planKeys, planText, valueOf } from '../src/plan.js';
import { buildPlanSim } from '../src/sim.js';
import { scanDay } from '../src/scanner.js';

const NOW = Date.UTC(2026, 9, 8, 23), H = 3600e3;
let id = 0;
// jogo de amanhã: simples da nossa análise (aposta, entrar se…), combo e perna de múltipla
const G = ({ h = 14, lg = 1, single = null, cond = false, combo = null, over = null, hard = null } = {}) => {
  const f = ++id;
  return { fx: { id: f, t: NOW + h * H, home: { id: f * 10, name: `C${f}` }, away: { id: f * 10 + 1, name: `F${f}` }, league: { id: lg, name: `Liga ${lg}` } }, hard,
    scenario: single ? [{ id: 'ahA0.5', market: 'Handicap asiático', line: `F${f} +0,5`, bet: !cond, conditional: cond, p_nossa: single[0], p_pinnacle: single[1],
      pinnacle_odd: single[2], odd_min: 1.05 / single[0], entry_brl: 150, why: 'modelo +3 · cenário +2' }] : [],
    combos: combo ? [{ id: 'cb:dcH|gO1.5', market: 'Combo', line: `C${f} ou empate + Mais de 1,5`, tier: 'sólida', consistency_score: 0.7, p_blend: combo, p_pinnacle: combo,
      odd_min: 1.55, fragile: false, odd_min_vs_pinnacle_pct: 0, politica_e: 'cheia', entry_brl: 100, context: { verdict: 'neutro', signals: [] } }] : [],
    lines: over ? [{ id: 'gO1.5', market: 'Total de gols', line: 'Mais de 1,5', p_blend: over, p_pinnacle: over, pinnacle_odd: +(1 / over / 1.025).toFixed(2), context: { verdict: 'neutro', signals: [] } }] : [] };
};

test('simples: as apostas da nossa análise pelo valor conservador; fora "entrar se…", jogo difícil e odd fora de 1,80–2,70; até 3 por liga e 10 no total', () => {
  id = 0;
  const games = [
    ...Array.from({ length: 5 }, (_, i) => G({ lg: 1, single: [0.56 + i * 0.01, 0.48, 2.05] })),   // liga 1: cinco, só 3 entram
    ...Array.from({ length: 9 }, (_, i) => G({ lg: 2 + i, single: [0.55, 0.49, 2.0] })),
    G({ lg: 20, single: [0.7, 0.6, 2.1], cond: true }), G({ lg: 21, single: [0.7, 0.6, 2.1], hard: { reasons: ['base'] } }), G({ lg: 22, single: [0.8, 0.7, 1.5] }),
  ];
  const plan = buildPlan({ generated_at: new Date(NOW).toISOString(), date: '2026-10-09', games }, { now: NOW });
  assert.equal(plan.singles.length, SINGLES[1]);
  assert.equal(plan.singles.filter(x => x.g.fx.league.id === 1).length, PER_LEAGUE);
  assert.ok(plan.singles.every(x => x.line.bet && !x.line.conditional && x.line.pinnacle_odd >= ODDS[0] && x.line.pinnacle_odd <= ODDS[1] && !x.g.hard));
  assert.ok(plan.singles.slice(1).every((x, i) => x.g.fx.t >= plan.singles[i].g.fx.t), 'em ordem de horário');
  assert.equal(valueOf({ p_nossa: 0.6, p_pinnacle: 0.5, pinnacle_odd: 2 }), 0.1);
});

test('um jogo uma vez só; mesmo jogo e múltiplas nos jogos que sobraram; jogo com entrada fica fora', () => {
  id = 0;
  const games = [
    G({ single: [0.6, 0.5, 2.0], combo: 0.75, over: 0.8 }),           // vira simples: o combo e a perna dele não entram
    ...Array.from({ length: 7 }, (_, i) => G({ lg: 3, combo: 0.65 + i * 0.02, over: 0.78 })),
    ...Array.from({ length: 12 }, (_, i) => G({ lg: 4 + i, over: 0.75 + (i % 3) * 0.03 })),
    G({ lg: 30, single: [0.62, 0.5, 2.1] }),                            // já tem entrada
  ];
  const exposed = { has: f => f === 21 };
  const plan = buildPlan({ generated_at: new Date(NOW).toISOString(), date: '2026-10-09', games }, { now: NOW, exposed, target: 4 });
  const ids = [...plan.singles.map(x => x.g.fx.id), ...plan.sameGame.map(x => x.g.fx.id), ...plan.multis.flatMap(t => t.legs.map(l => l.fixtureId))];
  assert.equal(new Set(ids).size, ids.length, 'nenhum jogo repetido');
  assert.deepEqual(plan.singles.map(x => x.g.fx.id), [1]);
  assert.equal(plan.sameGame.length, SAME_GAME);
  assert.ok(plan.sameGame.every(x => x.g.fx.id !== 1));
  assert.ok(plan.sameGame.map(x => x.combo.p_blend).every(p => p >= 0.69), 'os 5 combos de maior chance');
  assert.equal(plan.multis.length, 2);
  assert.ok(plan.multis.every(t => t.n >= 2 && t.fair >= 3.9 || t.n === 6));
  assert.ok(!ids.includes(21), 'jogo que já tem entrada fica fora');
  assert.equal(plan.stats.exposed, 1);
  // guardado pelas chaves e refeito igual
  const again = planFromKeys({ games }, planKeys(plan));
  assert.deepEqual(again.singles.map(x => x.line.id), plan.singles.map(x => x.line.id));
  assert.deepEqual(again.multis.map(t => t.legs.map(l => l.key)), plan.multis.map(t => t.legs.map(l => l.key)));
  // texto para copiar e a simulação do plano
  const txt = planText(plan, { dateLabel: 'sexta, 09/10' });
  assert.match(txt, /^PLANO sexta, 09\/10\n\nSIMPLES \(1\)\n1\. .* — F1 \+0,5 · odd ≥ [\d,]+ \(Pinnacle 2,00\) · R\$ 150/);
  assert.match(txt, /MÚLTIPLA 1 \(\d pernas\) · odd total ≥ [\d,]+ · acerta tudo \d+%/);
  assert.match(txt, /MESMO JOGO \(5\)/);
  const sim = buildPlanSim(plan);
  assert.equal(sim.id, 'plano-2026-10-09');
  assert.deepEqual([...new Set(sim.bets.map(b => b.cat))], ['Plano: simples', 'Plano: múltipla', 'Plano: mesmo jogo']);
  assert.equal(sim.bets.length, 1 + 2 + 5);
});

test('varredura do dia da demo: o plano sai com as três partes possíveis e sem jogo repetido', async () => {
  const sc = await scanDay({ ...demo, stats: () => ({ api: 0, cache: 0 }) }, { date: '2026-10-01', top: 30, half: false });
  const plan = buildPlan(sc, { now: 0 });
  const ids = [...plan.singles.map(x => x.g.fx.id), ...plan.sameGame.map(x => x.g.fx.id), ...plan.multis.flatMap(t => t.legs.map(l => l.fixtureId))];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(plan.singles.length <= SINGLES[1] && plan.sameGame.length <= SAME_GAME && plan.multis.length <= 2);
  assert.ok(ids.length > 0, 'a demo rende alguma entrada');
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
  const plan = { date: '2026-10-08', scan_at: new Date(NOW).toISOString(), singles: [], sameGame: [], multis: [] };
  const sim = buildPlanSim(plan, { id: 'plano-123', win: 'h4', label: '08/10, 13:12–17:12 (próximas 4 h)' });
  assert.equal(sim.id, 'plano-123'); assert.equal(sim.win, 'h4'); assert.match(sim.label, /próximas 4 h/);
  assert.equal(buildPlanSim(plan).id, 'plano-2026-10-08', 'sem id: um por data');
});
