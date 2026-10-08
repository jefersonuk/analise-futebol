// Simulação: registra como se tivéssemos entrado em TUDO o que uma varredura propôs, com a odd da Pinnacle da hora da
// varredura como odd de entrada, e liquida pelos resultados da API — para medir lucro e prejuízo de cada lente sem
// mexer nas apostas reais (fica guardada à parte: af:sim:<id>; nunca vai para o app de apostas).
//
// O que entra (o que cada aba da varredura marca como entrada):
//   nossa análise   a linha com status "aposta" de cada jogo; sem aposta, a "entrar se…" (marcada à parte: sem conferir)
//   linhas          em cada mercado da varredura (gols, gols 1T, handicap de gols, 1X2, escanteios, escanteios 1T,
//                   chutes), a linha do jogo naquela aba quando ela é aposta
//   combo           o combo do jogo na aba Combos, quando é aposta
//   múltipla        o bilhete automático da aba Múltipla (alvo padrão), com 2 pernas ou mais
// Odd: a da Pinnacle na própria linha; quando a Pinnacle não cota (linha derivada, só do modelo, combo), a odd mínima
// do app (odd_src = 'mínima'). Lucro em unidades (stake fixa de 1) e em R$ (a entrada proposta pelo app).

import { COMBOS, FILTER_KEYS, bestLine } from './scanner.js';
import { isBet } from './dossier.js';
import { TARGET, autoTicket, multiLegs, settleMulti, ticketOf } from './multiple.js';

export const CATS = ['nossa análise: aposta', 'nossa análise: entrar se…', 'Gols', 'Gols 1T', 'Handicap gols', '1X2', 'Escanteios', 'Escanteios 1T',
  'Chutes', 'Combo', 'Múltipla'];
const CAT_OF = { 'Total de gols': 'Gols', 'Total de gols 1T': 'Gols 1T', 'Handicap asiático': 'Handicap gols', '1X2': '1X2', 'Total de escanteios': 'Escanteios',
  'Total escanteios 1T': 'Escanteios 1T', 'Total de chutes': 'Chutes', 'Total de chutes no gol': 'Chutes' };
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
// lucro por unidade de stake em cada resultado
export const UNIT = { A: o => o - 1, HW: o => (o - 1) / 2, VOID: () => 0, HL: () => -0.5, RED: () => -1 };

const base = (g, l, cat, odd, oddSrc, stake) => ({
  key: `${cat}|${g.fx.id}|${l.id}`, cat, fixtureId: g.fx.id, kickoff: g.fx.t, home: g.fx.home.name, away: g.fx.away.name, competition: g.fx.league.name,
  lineId: l.id, market: l.market, line: l.line, odd: r2(odd), odd_src: oddSrc, p: r3(l.p_nossa ?? l.p_blend), p_pinnacle: l.p_pinnacle ?? null,
  stake_brl: stake > 0 ? stake : 0, status: 'aberta', winner: null, profit_u: null, profit_brl: null, clv: null, detail: null });
const priced = l => (l.pinnacle_odd > 1 ? [l.pinnacle_odd, 'pinnacle'] : [l.odd_min, 'mínima']);

// As entradas de uma varredura. scan: scanDay (games com lines, scenario, combos).
export function buildSim(scan, { banca = 44000 } = {}) {
  const at = Date.parse(scan.generated_at) || Date.now(), bets = [];
  for (const g of scan.games) {
    // nossa análise: a aposta do jogo; sem ela, a "entrar se…"
    const sc = (g.scenario || []).find(l => l.bet) || (g.scenario || []).find(l => l.conditional);
    if (sc?.pinnacle_odd > 1) bets.push(base(g, sc, sc.bet ? CATS[0] : CATS[1], sc.pinnacle_odd, 'pinnacle', sc.entry_brl));
    // linhas principais: a linha do jogo em cada aba de mercado, quando é aposta
    const seen = new Set();
    for (const m of FILTER_KEYS.filter(k => k !== COMBOS)) {
      const l = bestLine(g.lines || [], { market: m });
      if (!l || !isBet(l) || seen.has(l.id)) continue;
      seen.add(l.id);
      const [odd, src] = priced(l);
      bets.push(base(g, l, CAT_OF[l.market] || l.market, odd, src, l.entry_brl));
    }
    // combo: o do jogo na aba Combos (a Pinnacle não cota combo: odd mínima)
    const cb = (g.combos || []).find(isBet);
    if (cb) bets.push(base(g, cb, 'Combo', cb.odd_min, 'mínima', cb.entry_brl));
  }
  // múltipla: o bilhete automático, como a aba montava na hora da varredura
  const legs = autoTicket(multiLegs(scan.games, { now: at }), { target: TARGET });
  if (legs.length >= 2) {
    const odd = legs.reduce((t, l) => t * l.pinnacle_odd, 1), t = ticketOf(legs, { houseTotal: odd, banca });
    bets.push({ key: `Múltipla|${legs.map(l => l.key).join(',')}`, cat: 'Múltipla', fixtureId: null, kickoff: Math.min(...legs.map(l => l.kickoff)),
      home: `Múltipla (${legs.length})`, away: '', competition: [...new Set(legs.map(l => l.competition))].join(', '), lineId: 'multi', market: 'Múltipla',
      line: legs.map(l => `${l.home} x ${l.away} ${l.line}`).join(' · '), odd: r2(odd), odd_src: 'pinnacle', p: t.p_all, p_pinnacle: t.p_pinnacle_all,
      // entrada: a do bilhete na odd da Pinnacle; se ali não vale (margem), a que o app propõe na odd mínima
      stake_brl: t.stake || t.stake_at_min || 0, legs: legs.map(l => ({ fixtureId: l.fixtureId, lineId: l.lineId, home: l.home, away: l.away, line: l.line, odd: l.pinnacle_odd })),
      status: 'aberta', winner: null, profit_u: null, profit_brl: null, clv: null, detail: null });
  }
  return { id: `${at}`, scan_at: new Date(at).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    window: scan.window ? { from: scan.window.from, to: scan.window.to } : null, date: scan.date || null, bets };
}

function close(b, winner, detail) {
  b.winner = winner; b.status = 'encerrada'; b.detail = detail;
  b.profit_u = r3(UNIT[winner](b.odd)); b.profit_brl = r2(b.profit_u * b.stake_brl);
}

// Liquida o que está aberto. io (settlement.js simIO): { fixtures(ids) -> Map(id -> { finished, cancelled, long, score, … }),
// settle(lineId, jogo, c1) -> { winner, manual }, halfCorners(id, jogo) -> [casa, fora] | null, closing(id) -> Map(lineId -> chance justa) }.
// Jogo cancelado: anulada. Combo/múltipla que a casa recalcula (devolução numa perna): anulada (aproximação).
export async function settleSim(sim, io) {
  const open = sim.bets.filter(b => b.status === 'aberta');
  const ids = [...new Set(open.flatMap(b => (b.legs ? b.legs.map(l => l.fixtureId) : [b.fixtureId])))];
  if (!ids.length) return { settled: 0, pending: 0 };
  const fs = await io.fixtures(ids), c1 = new Map(), closing = new Map();
  const leg = async (fixtureId, lineId) => {
    const f = fs.get(fixtureId);
    if (!f) return { r: null, txt: 'jogo não encontrado' };
    if (f.cancelled) return { r: 'VOID', txt: 'jogo não disputado' };
    if (!f.finished) return { r: null, txt: f.long || 'em andamento' };
    let k1 = null;
    if (/^c1/.test(lineId)) { if (!c1.has(fixtureId)) c1.set(fixtureId, await io.halfCorners(fixtureId, f).catch(() => null)); k1 = c1.get(fixtureId); }
    const x = io.settle(lineId, f, k1);
    return { r: x?.manual ? 'VOID' : x?.winner ?? null, txt: `${f.score}${x?.manual ? ' (devolução numa perna: anulada)' : ''}`, manual: !!x?.manual, f };
  };
  let settled = 0;
  for (const b of open) {
    if (b.legs) {
      const rs = [];
      for (const l of b.legs) rs.push(await leg(l.fixtureId, l.lineId));
      const s = settleMulti(rs.map(x => x.r));
      if (s.done) { close(b, s.manual ? 'VOID' : s.winner, rs.map((x, i) => `${b.legs[i].home} x ${b.legs[i].away}: ${x.txt}`).join(' · ')); settled++; }
      continue;
    }
    const x = await leg(b.fixtureId, b.lineId);
    if (!x.r) { b.detail = x.txt; continue; }
    close(b, x.r, x.txt); settled++;
    // CLV: a odd de entrada contra a justa de fechamento da Pinnacle (só quando a entrada foi na odd dela)
    if (b.odd_src === 'pinnacle' && io.closing) {
      if (!closing.has(b.fixtureId)) closing.set(b.fixtureId, await io.closing(b.fixtureId).catch(() => null));
      const p = closing.get(b.fixtureId)?.get(b.lineId);
      if (p) b.clv = r3(b.odd * p - 1);
    }
  }
  sim.updated_at = new Date().toISOString();
  sim.checked_at = sim.updated_at;
  return { settled, pending: sim.bets.filter(b => b.status === 'aberta').length };
}

// Resumo de um grupo de entradas: quantas, resultado, lucro em unidades e em R$, yield, CLV médio.
export function summarize(bets) {
  const done = bets.filter(b => b.status === 'encerrada'), cnt = w => done.filter(b => b.winner === w).length;
  const u = done.reduce((t, b) => t + b.profit_u, 0), brl = done.reduce((t, b) => t + b.profit_brl, 0);
  const staked = done.filter(b => b.winner !== 'VOID').length, stakedBrl = done.filter(b => b.winner !== 'VOID').reduce((t, b) => t + b.stake_brl, 0);
  const clv = done.filter(b => b.clv != null);
  return { n: bets.length, done: done.length, open: bets.length - done.length, green: cnt('A') + cnt('HW'), red: cnt('RED') + cnt('HL'), void: cnt('VOID'),
    profit_u: r2(u), yield: staked ? r3(u / staked) : null, profit_brl: r2(brl), yield_brl: stakedBrl ? r3(brl / stakedBrl) : null,
    clv: clv.length ? r3(clv.reduce((t, b) => t + b.clv, 0) / clv.length) : null, clv_n: clv.length };
}

// Por categoria (na ordem de CATS) e o total sem contar duas vezes a mesma linha do mesmo jogo (a nossa análise e a
// aba do mercado podem propor a mesma).
export function simReport(sim) {
  const cats = CATS.map(c => [c, summarize(sim.bets.filter(b => b.cat === c))]).filter(([, s]) => s.n);
  const uniq = new Map();
  for (const b of sim.bets) { const k = b.legs ? b.key : `${b.fixtureId}|${b.lineId}`; if (!uniq.has(k)) uniq.set(k, b); }
  const real = sim.bets.filter(b => b.cat !== CATS[1]);   // sem as "entrar se…" que não foram conferidas
  return { cats, total: summarize([...uniq.values()]), confirmed: summarize(real.filter(b => uniq.get(b.legs ? b.key : `${b.fixtureId}|${b.lineId}`) === b)) };
}
