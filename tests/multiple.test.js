import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { LEG_P, MARGIN, STAKE_CAP, autoTicket, multiGames, multiLegs, multiLine, settleMulti, ticketOf } from '../src/multiple.js';
import { buildEntry } from '../src/entry.js';
import { liveMulti } from '../src/settlement.js';
import { scanDay } from '../src/scanner.js';

const NOW = Date.UTC(2026, 9, 8, 12), H = 3600e3;
let id = 0;
const game = ({ t = NOW + 2 * H, p = 0.8, pin = 0.79, nossa = null, ctx = 'neutro', hard = null, derived = false, extra = [] } = {}) => {
  const fid = ++id;
  return { fx: { id: fid, t, home: { id: fid * 10, name: `Casa${fid}` }, away: { id: fid * 10 + 1, name: `Fora${fid}` }, league: { name: 'Liga' } }, hard,
    lines: [{ id: 'gO1.5', market: 'Total de gols', line: 'Mais de 1,5', p_blend: p, p_pinnacle: pin, context: { verdict: ctx },
      ...(derived ? { derived: true } : { pinnacle_odd: Math.round(100 / pin / 1.025) / 100 }) }, ...extra],
    scenario: nossa != null ? [{ id: 'gO1.5', p_nossa: nossa }] : [] };
};

test('pernas: só over de gols com chance alta, uma por jogo, a menor chance entre a nossa e a mistura', () => {
  id = 0;
  const gs = [game({ p: 0.82, pin: 0.8, ctx: 'a favor' }), game({ p: 0.85, pin: 0.84, nossa: 0.83 }), game({ p: 0.7, pin: 0.7 }),
    game({ hard: { reasons: ['base'] } }), game({ t: NOW + 5 * 60e3 }), game({ ctx: 'contra' }), game({ p: 0.8, pin: 0.86 }),
    game({ p: 0.8, pin: 0.78, extra: [{ id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', p_blend: 0.74, p_pinnacle: 0.73, pinnacle_odd: 1.33, context: { verdict: 'neutro' } }] })];
  const legs = multiLegs(gs, { now: NOW });
  assert.deepEqual(legs.map(l => l.fixtureId), [1, 2, 8], 'a favor primeiro; depois a chance da Pinnacle');
  assert.equal(legs[1].p, 0.83, 'a nossa (0,83) abaixo da mistura (0,85): vale a menor');
  assert.equal(multiLegs([game({ p: 0.85, pin: 0.84, nossa: 0.76 })], { now: NOW }).length, 0, 'nós bem abaixo da Pinnacle: fora');
  assert.equal(legs[2].lineId, 'gO1.5', 'uma perna por jogo: a de maior chance');
  assert.ok(legs.every(l => l.p >= LEG_P[l.lineId]));
});

test('linha disponível: over 1,5 que a Pinnacle não cota passa para o over 2,5 cotado; o bilhete automático só usa linha cotada', () => {
  id = 0;
  const o25 = (p, odd) => ({ id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', p_blend: p, p_pinnacle: p, ...(odd ? { pinnacle_odd: odd } : { derived: true }), context: { verdict: 'neutro' } });
  const gs = [game({ p: 0.84, pin: 0.84, derived: true, extra: [o25(0.64, 1.52)] }),   // 1,5 não cotado, 2,5 cotado: entra pelo 2,5
    game({ p: 0.77, pin: 0.77, derived: true }),                                           // só o 1,5 não cotado: aparece, mas fora do automático
    game({ p: 0.84, pin: 0.84, derived: true, extra: [o25(0.55, 1.75)] }),                 // 2,5 abaixo de 60%: fica o 1,5 não cotado
    game({ p: 0.75, pin: 0.75 })];                                                         // 1,5 cotado
  const ms = multiGames(gs, { now: NOW });
  const by = new Map(ms.map(m => [m.fixtureId, m]));
  assert.equal(by.get(1).best.lineId, 'gO2.5'); assert.ok(by.get(1).best.quoted);
  assert.deepEqual(by.get(1).options.map(o => o.lineId), ['gO2.5', 'gO1.5'], 'dá para trocar para o 1,5');
  assert.equal(by.get(2).best.quoted, false); assert.equal(by.get(3).best.lineId, 'gO1.5');
  assert.deepEqual(ms.slice(0, 2).map(m => m.fixtureId).sort(), [1, 4], 'cotadas primeiro');
  assert.deepEqual(autoTicket(ms.map(m => m.best), { target: 100 }).map(l => l.fixtureId).sort(), [1, 4]);
});

test('bilhete: chance de acertar tudo, justa, mínima, mínima de cada perna, veredito e entrada', () => {
  id = 0;
  const legs = multiLegs([0.8, 0.78, 0.76, 0.75, 0.74, 0.73, 0.72].map(p => game({ p, pin: p })), { now: NOW });
  const pick = autoTicket(legs, { target: 4 });
  const fair = pick.reduce((t, l) => t / l.p, 1);
  assert.ok(fair >= 4 && pick.reduce((t, l, i) => (i < pick.length - 1 ? t / l.p : t), 1) < 4, 'para no alvo');
  assert.equal(autoTicket(legs, { target: 100 }).length, 6, 'no máximo 6 pernas');
  const t = ticketOf(pick, { banca: 44000 });
  assert.equal(t.verdict, 'sem odd'); assert.equal(t.stake, null);
  assert.ok(Math.abs(t.p_all * t.fair - 1) < 0.01, 'com odds justas, acertar tudo = 1 ÷ odd total');
  assert.ok(Math.abs(t.min - t.fair * MARGIN) < 0.02);
  // a casa paga a mínima: vale, com entrada ¼ Kelly até 0,5% da banca
  const ok = ticketOf(pick, { houseTotal: t.min + 0.3, banca: 44000 });
  assert.equal(ok.verdict, 'vale'); assert.ok(ok.ev > 0 && ok.stake > 0 && ok.stake <= STAKE_CAP * 44000);
  // abaixo da justa: não vale e sem entrada; uma perna abaixo da mínima dela marca a perna
  const bad = ticketOf(pick, { houseTotal: t.fair * 0.85, banca: 44000 });
  assert.equal(bad.verdict, 'não vale'); assert.equal(bad.stake, 0);
  const house = new Map(pick.map((l, i) => [l.key, i === 0 ? 1.1 : l.fair * 1.2]));
  const leg = ticketOf(pick, { house, banca: 44000 });
  assert.ok(leg.legs[0].below && !leg.legs[1].below); assert.notEqual(leg.verdict, 'vale', 'perna abaixo da mínima: não é "vale"');
});

test('registro no app de apostas: pernas, última perna para a conferência, primeira para o ao vivo', () => {
  id = 0;
  const legs = multiLegs([game({ t: NOW + 3 * H }), game({ t: NOW + H }), game({ t: NOW + 2 * H })], { now: NOW });
  const t = ticketOf(legs, { houseTotal: 2.5 }), line = multiLine(t);
  const e = buildEntry({ line, fx: null, casa: 'Overtime', currency: 'USD', odd: 2.5, stake: 55, stakeNat: 10 });
  assert.equal(e.market, 'Múltipla'); assert.match(e.event, /^Múltipla \(3\) — Casa1 x Fora1 Mais de 1,5 · /);
  assert.equal(e.analise.multi, true); assert.equal(e.analise.legs.length, 3); assert.equal(e.analise.lineId, 'multi');
  assert.equal(e.analise.fixtureId, 1, 'a última perna a começar'); assert.equal(Date.parse(e.analise.first_kickoff), NOW + H);
  assert.equal(e.prob, t.p_all);
});

test('liquidação e ao vivo: uma perna perdida perde tudo; todas ganhas ganha; anulada vai à mão', () => {
  assert.deepEqual(settleMulti(['A', 'A', 'A']), { winner: 'A', done: true });
  assert.deepEqual(settleMulti(['A', 'RED', null]), { winner: 'RED', done: true });
  assert.deepEqual(settleMulti(['A', null]), { winner: null, done: false });
  assert.equal(settleMulti(['A', 'VOID']).manual, true);
  const info = new Map([[1, { status: '2H', live: true, finished: false, elapsed: 60, goals: [1, 1], home: 'A', game: { t: NOW, home: true, opp: 'B', gf: 1, ga: 1, g1: null } }],
    [2, { status: '1H', live: true, finished: false, elapsed: 20, goals: [0, 0], home: 'C', game: { t: NOW, home: true, opp: 'D', gf: 0, ga: 0, g1: null } }],
    [3, { status: 'NS', live: false, finished: false, goals: [0, 0], home: 'E', game: null }]]);
  const m = liveMulti([1, 2, 3].map(f => ({ fixtureId: f, lineId: 'gO1.5', home: 'X', away: 'Y', linha: 'Mais de 1,5' })), info);
  assert.equal(m.won, 1); assert.equal(m.lost, 0); assert.equal(m.legs[1].line.need, 2); assert.equal(m.legs[2].line, null);
});

test('varredura da demo: a aba Múltipla tem pernas e monta o bilhete', async () => {
  const scan = await scanDay({ ...demo, stats: () => ({ api: 0, cache: 0 }) }, { date: '2026-10-01', top: 10 });
  const legs = multiLegs(scan.games, { now: 0 });
  assert.ok(legs.length >= 2, `${legs.length} pernas`);
  const t = ticketOf(autoTicket(legs, { target: 3 }));
  assert.ok(t.n >= 1 && t.p_all > 0 && t.fair >= 1);
});
