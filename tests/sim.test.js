import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { CATS, UNIT, buildSim, settleSim, simReport, summarize } from '../src/sim.js';
import { scanDay } from '../src/scanner.js';

const T0 = Date.UTC(2026, 9, 8, 14), H = 3600e3;
const L = (id, market, extra = {}) => ({ id, market, line: id, tier: 'âncora', consistency_score: 0.8, odd_min: 1.6, politica_e: 'cheia', fragile: false,
  odd_min_vs_pinnacle_pct: 0, p_blend: 0.7, p_pinnacle: 0.68, entry_brl: 200, context: { verdict: 'neutro', signals: [] }, ...extra });
const G = (id, extra = {}) => ({ fx: { id, t: T0 + H, home: { id: id * 10, name: `C${id}` }, away: { id: id * 10 + 1, name: `F${id}` }, league: { name: 'Liga' } }, lines: [], ...extra });
const scan = { generated_at: new Date(T0).toISOString(), games: [
  G(1, { scenario: [{ id: 'ahA0.5', market: 'Handicap asiático', line: 'F1 +0,5', bet: true, p_nossa: 0.55, p_blend: 0.55, p_pinnacle: 0.48, pinnacle_odd: 2.05, entry_brl: 150 }],
    lines: [L('gO2.5', 'Total de gols', { pinnacle_odd: 1.7 }), L('cornersO9.5', 'Total de escanteios', { model_only: true })] }),
  G(2, { scenario: [{ id: '1', market: '1X2', line: 'C2 vence', conditional: true, p_nossa: 0.5, p_blend: 0.5, p_pinnacle: 0.44, pinnacle_odd: 2.2, entry_brl: 100 }],
    combos: [L('cb:dcH|gO1.5', 'Combo', { odd_min: 1.55, combo: true })] }),
  G(3, { lines: [L('gO2.5', 'Total de gols', { tier: 'especulativa', p_blend: 0.5, p_pinnacle: 0.5, pinnacle_odd: 1.9 })] }),   // não é aposta: fora
] };

test('entradas: o que cada aba propôs, com a odd da Pinnacle (ou a mínima quando ela não cota)', () => {
  const sim = buildSim(scan);
  const by = k => sim.bets.find(b => b.key.startsWith(k));
  assert.deepEqual(sim.bets.map(b => b.cat).sort(), ['Combo', 'Escanteios', 'Gols', 'nossa análise: aposta', 'nossa análise: entrar se…'].sort());
  assert.equal(by('nossa análise: aposta|1').odd, 2.05); assert.equal(by('nossa análise: aposta|1').odd_src, 'pinnacle');
  assert.equal(by('Gols|1').odd, 1.7); assert.equal(by('Escanteios|1').odd_src, 'mínima'); assert.equal(by('Escanteios|1').odd, 1.6);
  assert.equal(by('Combo|2').odd, 1.55); assert.equal(by('nossa análise: entrar se…|2').stake_brl, 100);
  assert.ok(!sim.bets.some(b => b.fixtureId === 3), 'especulativa não é proposta');
  assert.equal(sim.id, String(T0));
});

test('liquidação: resultados, unidades, R$, CLV; aberto até o jogo acabar; cancelado anula', async () => {
  const sim = buildSim(scan);
  const fixtures = new Map([[1, { finished: true, score: 'C1 1–1 F1', game: {} }], [2, { finished: false, long: 'Second Half' }]]);
  const RESULT = { 'ahA0.5': 'A', 'gO2.5': 'RED', 'cornersO9.5': 'A' };
  const io = { fixtures: async () => fixtures, settle: lineId => ({ winner: RESULT[lineId] }), halfCorners: async () => null,
    closing: async () => new Map([['ahA0.5', 0.52], ['gO2.5', 0.6]]) };
  const r = await settleSim(sim, io);
  assert.deepEqual(r, { settled: 3, pending: 2 });
  const b = k => sim.bets.find(x => x.key.startsWith(k));
  assert.equal(b('nossa análise: aposta|1').profit_u, 1.05); assert.equal(b('nossa análise: aposta|1').profit_brl, 157.5);
  assert.equal(b('nossa análise: aposta|1').clv, 0.066, '2,05 contra a justa 1/0,52');
  assert.equal(b('Gols|1').profit_u, -1); assert.equal(b('Escanteios|1').clv, null, 'odd mínima: sem CLV');
  assert.equal(b('Combo|2').status, 'aberta'); assert.equal(b('Combo|2').detail, 'Second Half');
  fixtures.set(2, { cancelled: true, finished: false });
  await settleSim(sim, io);
  assert.equal(b('Combo|2').winner, 'VOID'); assert.equal(b('Combo|2').profit_u, 0);
  const rep = simReport(sim);
  assert.equal(rep.total.n, 5); assert.equal(rep.total.done, 5);
  assert.equal(rep.total.profit_u, 1.05 - 1 + 0.6, 'aposta 1,05 − gols 1 + escanteios 0,6; anuladas 0');
  assert.equal(rep.confirmed.n, 4, 'sem a "entrar se…"');
  assert.deepEqual(rep.cats.map(([c]) => c), CATS.filter(c => sim.bets.some(x => x.cat === c)));
});

test('a mesma linha do mesmo jogo proposta por duas lentes conta uma vez no total', () => {
  const s = { generated_at: scan.generated_at, games: [G(5, { scenario: [{ id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', bet: true, p_nossa: 0.62, pinnacle_odd: 1.8, entry_brl: 100 }],
    lines: [L('gO2.5', 'Total de gols', { pinnacle_odd: 1.8 })] })] };
  const sim = buildSim(s);
  assert.equal(sim.bets.length, 2);
  for (const b of sim.bets) Object.assign(b, { status: 'encerrada', winner: 'A', profit_u: UNIT.A(b.odd), profit_brl: 80 });
  const rep = simReport(sim);
  assert.equal(rep.total.n, 1); assert.equal(rep.total.profit_u, 0.8);
  assert.equal(summarize(sim.bets).profit_u, 1.6);
});

test('varredura da demo: monta a simulação com as lentes e a múltipla', async () => {
  const sc = await scanDay({ ...demo, stats: () => ({ api: 0, cache: 0 }) }, { date: '2026-10-01', top: 10 });
  const sim = buildSim({ ...sc, generated_at: new Date(0).toISOString() });
  assert.ok(sim.bets.length > 0);
  assert.ok(sim.bets.every(b => b.odd > 1 && b.status === 'aberta' && CATS.includes(b.cat)));
  const m = sim.bets.find(b => b.cat === 'Múltipla');
  if (m) assert.ok(m.legs.length >= 2 && Math.abs(m.odd - m.legs.reduce((t, l) => t * l.odd, 1)) < 0.02);
});

test('múltipla: o bilhete automático da hora da varredura; uma perna perdida perde', async () => {
  const leg = id => G(id, { lines: [L('gO1.5', 'Total de gols', { p_blend: 0.8, p_pinnacle: 0.8, pinnacle_odd: 1.22 })] });
  const sim = buildSim({ generated_at: scan.generated_at, games: [leg(7), leg(8), leg(9)] });
  const m = sim.bets.find(b => b.cat === 'Múltipla');
  assert.equal(m.legs.length, 3); assert.equal(m.odd, 1.82, '1,22³ (alvo 6 não alcançado: as 3 pernas)');
  const io = { fixtures: async () => new Map([7, 8, 9].map(i => [i, { finished: true, score: 'x' }])),
    settle: (lineId, f) => ({ winner: f === io.last ? 'RED' : 'A' }), halfCorners: async () => null, closing: null };
  const fs = await io.fixtures(); io.last = fs.get(9); io.fixtures = async () => fs;
  await settleSim(sim, io);
  assert.equal(m.winner, 'RED'); assert.equal(m.profit_u, -1);
});

test('múltipla com perna asiática: devolução e meia pagam pelo produto do que cada perna pagou', async () => {
  const sim = { id: 't', bets: [{ key: 'Múltipla|x', cat: 'Plano: múltipla', fixtureId: null, kickoff: T0, legs: [
    { fixtureId: 1, lineId: 'gO2', home: 'A', away: 'B', line: 'Mais de 2', odd: 1.5 },
    { fixtureId: 2, lineId: 'gO1.75', home: 'C', away: 'D', line: 'Mais de 1,75', odd: 1.4 },
    { fixtureId: 3, lineId: 'gO1.5', home: 'E', away: 'F', line: 'Mais de 1,5', odd: 1.3 }], odd: 2.73, stake_brl: 100, status: 'aberta' }] };
  const RES = { 1: 'VOID', 2: 'HW', 3: 'A' };
  const io = { fixtures: async () => new Map([1, 2, 3].map(i => [i, { finished: true, score: `jogo ${i}`, id: i }])), settle: (lineId, f) => ({ winner: RES[f.id] }),
    halfCorners: async () => null, closing: null };
  await settleSim(sim, io);
  const b = sim.bets[0];
  // 1 (devolve) × 1,2 (meia de 1,4) × 1,3 = 1,56 → lucro +0,56 u
  assert.equal(b.mult, 1.56); assert.equal(b.profit_u, 0.56); assert.equal(b.winner, 'A'); assert.equal(b.profit_brl, 56);
});
