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
  assert.deepEqual(by.get(1).options.map(o => o.lineId), ['gO2.5', 'gO1.5', 'gO1.75', 'gO2', 'gO2.25'], 'dá para trocar para o 1,5 e as asiáticas');
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
  assert.deepEqual(settleMulti(['A', 'A', 'A']), { winner: 'A', done: true, mult: null });
  assert.deepEqual(settleMulti(['A', 'A'], [1.5, 2]), { winner: 'A', done: true, mult: 3 });
  assert.deepEqual(settleMulti(['A', 'RED', null]), { winner: 'RED', done: true, mult: 0 });
  assert.deepEqual(settleMulti(['A', null]), { winner: null, done: false });
  assert.equal(settleMulti(['A', 'VOID']).manual, true);
  // asiáticas: devolução vale 1, meia vitória (1 + odd)/2, meia derrota 1/2 — o bilhete segue
  assert.deepEqual(settleMulti(['A', 'VOID', 'HW', 'HL'], [1.5, 1.6, 1.8, 2]), { winner: null, done: true, manual: true, mult: 1.05 });
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

test('bilhetes por faixa de horário: do mais próximo ao mais longe, cada jogo num bilhete só', async () => {
  const { bandTickets } = await import('../src/multiple.js');
  const leg = (k, h, p = 0.75, extra = {}) => ({ key: `${k}:gO1.5`, fixtureId: k, kickoff: NOW + h * H, p, p_pinnacle: p, fair: 1 / p, quoted: true, context: 'neutro', ...extra });
  // 13h: três jogos; 13h30: um; 16h: dois; 20h: um sozinho
  const legs = [leg(1, 1), leg(2, 1, 0.8), leg(3, 1, 0.78), leg(4, 1.5), leg(5, 4), leg(6, 4.5), leg(7, 8)];
  const ts = bandTickets(legs, { target: 3, band: 2 });
  assert.deepEqual(ts.map(t => t.map(l => l.fixtureId).sort()), [[1, 2, 3, 4], [5, 6]], 'faixa de 2 h a partir do primeiro jogo; o das 20h sozinho fica de fora');
  assert.ok(ts[0][0].kickoff <= ts[1][0].kickoff);
  const once = new Set(ts.flat().map(l => l.fixtureId));
  assert.equal(once.size, ts.flat().length);
  // alvo baixo: a faixa rende dois bilhetes, as melhores pernas primeiro
  const t2 = bandTickets(legs.slice(0, 4), { target: 1.6, band: 2 });
  assert.deepEqual(t2.map(t => t.map(l => l.fixtureId).sort()), [[2, 3], [1, 4]]);
  // faixa de 1 h: o jogo das 13h30 entra com os das 13h; com 0,5 h, não
  assert.equal(bandTickets(legs, { target: 3, band: 1 })[0].length, 4);
});

test('exposição: jogo que já tem entrada (app de apostas ou caixa de envio) é reconhecido', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const { exposedGames, BETS_KEY, INBOX_KEY } = await import('../src/entry.js');
  const iso = h => new Date(Date.now() + h * H).toISOString();
  mem.set(BETS_KEY, JSON.stringify({ surebets: [
    { event: 'Holon Yermiyahu x Nordia Jerusalem — Handicap asiático: Nordia +1,5', date: iso(1).slice(0, 16), analise: { fixtureId: 11, kickoff: iso(1) } },
    { event: 'Casa Velha x Fora Velha — Gols', winner: 'A', date: iso(-30).slice(0, 16), analise: { fixtureId: 12, kickoff: iso(-30) } },   // passou: não pesa
    { event: 'Múltipla (2) — …', analise: { multi: true, fixtureId: 14, kickoff: iso(2), legs: [{ fixtureId: 13, home: 'A', away: 'B' }, { fixtureId: 14, home: 'C', away: 'D' }] } },
    { event: 'Vänersborgs FK x Kumla — Gols: Mais de 1,5', winner: null, date: iso(1).slice(0, 16) },                                  // à mão, sem o jogo da API
  ] }));
  mem.set(INBOX_KEY, JSON.stringify([{ event: 'X x Y — Gols', analise: { fixtureId: 15, home: 'X', away: 'Y', kickoff: iso(3) } }]));
  const e = exposedGames();
  assert.ok(e.has(11) && e.has(13) && e.has(14) && e.has(15));
  assert.ok(!e.has(12), 'aposta liquidada de jogo que já passou não conta');
  assert.ok(e.has(999, 'Vanersborgs FK', 'Kumla'), 'à mão: pelo nome dos times');
  assert.ok(!e.has(998, 'Kumla', 'Outro'));
  delete globalThis.localStorage;
});

test('perna asiática: 1,75 / 2 / 2,25 perdem só com 0–1 gol; as chances e a justa saem do 1,5 e do 2,5 do jogo', async () => {
  const { ASIAN, fairOf, legEV } = await import('../src/multiple.js');
  id = 0;
  const o25 = { id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', p_blend: 0.55, p_pinnacle: 0.55, pinnacle_odd: 1.78, context: { verdict: 'neutro' } };
  const [m] = multiGames([game({ p: 0.8, pin: 0.8, extra: [o25] })], { now: NOW });
  const by = Object.fromEntries(m.options.map(o => [o.lineId, o]));
  // 2 gols = 25%: o 2 devolve (justa = 0,75/0,55), o 1,75 ganha metade, o 2,25 perde metade
  assert.equal(by['gO2'].fair, Math.round((0.75 / 0.55) * 100) / 100);
  assert.ok(by['gO1.75'].fair < by['gO2'].fair && by['gO2'].fair < by['gO2.25'].fair && by['gO2.25'].fair < 1 / 0.55, 'entre a justa do 1,5 e a do 2,5');
  assert.ok(!by['gO2.5'], 'o 2,5 a 55% não passa como perna (60%+)');
  assert.ok(['gO1.75', 'gO2', 'gO2.25'].every(k => by[k].p === 0.8 && by[k].asian && !by[k].quoted), 'não perde = a chance do 1,5; fora do automático');
  for (const [k] of ASIAN) assert.ok(Math.abs(legEV(by[k].out, fairOf(by[k].out)) - 1) < 1e-9, 'na justa o valor esperado é 1');
  // no bilhete: com a perna de 2, a chance de não perder segue a do 1,5 e o EV usa devolução
  const other = multiGames([game({ p: 0.78, pin: 0.78 })], { now: NOW })[0].best;
  const t = ticketOf([by['gO2'], other], { houseTotal: by['gO2'].fair * other.fair * 1.1 });
  assert.equal(t.p_all, Math.round(0.8 * 0.78 * 1000) / 1000);
  // odd total 10% acima da justa: a parte que devolve (os 2 gols) não ganha com a odd maior — o EV fica abaixo de 10%
  // (√1,1 × 0,75 + 0,25) × √1,1 − 1 ≈ +8,7% (com as justas arredondadas, ~8%)
  assert.ok(t.asian && t.ev > 0.07 && t.ev < 0.095, `EV ${t.ev}`);
});
