// Simulação: registra como se tivéssemos entrado em TUDO o que uma varredura propôs, com a odd da Pinnacle da hora da
// varredura como odd de entrada, e liquida pelos resultados da API — para medir lucro e prejuízo de cada lente sem
// mexer nas apostas reais (fica guardada à parte: af:sim:<id>; nunca vai para o app de apostas).
//
// O que entra (o que cada aba da varredura marca como entrada):
//   nossa análise   a linha com status "aposta" de cada jogo; sem aposta, a "entrar se…" (marcada à parte: sem conferir)
//   linhas          em cada mercado da varredura (gols, gols 1T, handicap de gols, 1X2, escanteios, escanteios 1T,
//                   chutes), a linha do jogo naquela aba quando ela é aposta
//   combo           o combo do jogo na aba Combos, quando é aposta
//   múltipla        os bilhetes por faixa de horário da aba Múltipla (alvo e faixa padrão), com 2 pernas ou mais
// Odd: sempre a da Pinnacle na hora — o pior cenário (regra do Jeferson, 09/10/2026: "nem sempre vou encontrar a odd
// mínima; simule na odd que você puxou da Pinnacle naquele momento; o que vier além disso é bônus"). Onde ela não cota a
// aposta exata (linha derivada do total, combo, perna asiática), a odd que ela pagaria: a justa pelas chances dela, com a
// margem dela no jogo em cada perna (odd_src = 'pinnacle est.'). Sem nenhuma chance da Pinnacle (linha só do modelo), a
// entrada fica fora. Simulações antigas podem ter odd_src = 'mínima' (a odd mínima do app, antes desta regra).
// Lucro em unidades (stake fixa de 1) e em R$ (a entrada proposta pelo app).

import { CENARIO, COMBOS, FILTER_KEYS, bestLine } from './scanner.js';
import { isBet } from './dossier.js';
import { MULTI, TARGET, bandTickets, multiLegs, settleMulti, ticketOf } from './multiple.js';
import { pinMargin } from './odds.js';

export const CATS = ['Plano: simples (nossa leitura)', 'Plano: simples (acordo com a Pinnacle)', 'Plano: simples', 'Plano: múltipla', 'Plano: mesmo jogo', 'nossa análise: aposta', 'nossa análise: entrar se…', 'Gols', 'Gols 1T',
  'Handicap gols', '1X2', 'Escanteios', 'Escanteios 1T', 'Chutes', 'Combo', 'Múltipla'];
const CAT_OF = { 'Total de gols': 'Gols', 'Total de gols 1T': 'Gols 1T', 'Handicap asiático': 'Handicap gols', '1X2': '1X2', 'Total de escanteios': 'Escanteios',
  'Total escanteios 1T': 'Escanteios 1T', 'Total de chutes': 'Chutes', 'Total de chutes no gol': 'Chutes' };
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
// lucro por unidade de stake em cada resultado
export const UNIT = { A: o => o - 1, HW: o => (o - 1) / 2, VOID: () => 0, HL: () => -0.5, RED: () => -1 };

const base = (g, l, cat, odd, oddSrc, stake) => ({
  key: `${cat}|${g.fx.id}|${l.id}`, cat, fixtureId: g.fx.id, kickoff: g.fx.t, home: g.fx.home.name, away: g.fx.away.name, competition: g.fx.league.name,
  lineId: l.id, market: l.market, line: l.line, odd: r2(odd), odd_src: oddSrc, p: r3(l.p_nossa ?? l.p_blend), p_pinnacle: l.p_pinnacle ?? null,
  stake_brl: stake > 0 ? stake : 0, status: 'aberta', winner: null, profit_u: null, profit_brl: null, clv: null, detail: null });
// [odd, origem] de uma linha: a da Pinnacle; derivada, a que ela pagaria (1 / (chance dela × margem)); sem chance dela, nada
export function linePin(l, g) {
  if (l.pinnacle_odd > 1) return [l.pinnacle_odd, 'pinnacle'];
  return l.p_pinnacle > 0 ? [1 / (l.p_pinnacle * pinMargin(g?.lines)), 'pinnacle est.'] : [null, null];
}
// o combo como a Pinnacle pagaria: a justa pelas chances dela (empate anula com a perna de gols certa devolve, como na
// liquidação), com a margem dela em cada perna. Combo guardado antes de push_pinnacle: a devolução na proporção da mistura.
export function comboPin(c, g) {
  const push = c.push_pinnacle ?? (c.p_blend > 0 ? (c.p_pinnacle * (c.push_prob || 0)) / c.p_blend : 0), win = c.p_pinnacle - push;
  return win > 0 ? [(1 - push) / win / pinMargin(g?.lines) ** (c.legs?.length || 2), 'pinnacle est.'] : [null, null];
}
// o bilhete: o produto da odd da Pinnacle em cada perna (onde ela não cota a linha, a que ela pagaria: pin_est)
const legPin = l => (l.pinnacle_odd > 1 ? l.pinnacle_odd : l.pin_est > 1 ? l.pin_est : null);
export function ticketPin(legs) {
  const os = legs.map(legPin);
  return os.every(Boolean) ? [os.reduce((t, o) => t * o, 1), legs.every(l => l.pinnacle_odd > 1) ? 'pinnacle' : 'pinnacle est.'] : [null, null];
}

// As entradas de uma varredura. scan: scanDay (games com lines, scenario, combos); só as das linhas que ela buscou
// (scan.markets; null = todas).
export function buildSim(scan, { banca = 44000 } = {}) {
  const at = Date.parse(scan.generated_at) || Date.now(), bets = [], want = k => !scan.markets || scan.markets.includes(k);
  for (const g of scan.games) {
    // nossa análise: a aposta do jogo; sem ela, a "entrar se…"
    const sc = want(CENARIO) && ((g.scenario || []).find(l => l.bet) || (g.scenario || []).find(l => l.conditional));
    if (sc?.pinnacle_odd > 1) bets.push(base(g, sc, sc.bet ? 'nossa análise: aposta' : 'nossa análise: entrar se…', sc.pinnacle_odd, 'pinnacle', sc.entry_brl));
    // linhas principais: a linha do jogo em cada aba de mercado, quando é aposta
    const seen = new Set();
    for (const m of FILTER_KEYS.filter(k => k !== COMBOS && want(k))) {
      const l = bestLine(g.lines || [], { market: m });
      if (!l || !isBet(l) || seen.has(l.id)) continue;
      seen.add(l.id);
      const [odd, src] = linePin(l, g);
      if (odd) bets.push(base(g, l, CAT_OF[l.market] || l.market, odd, src, l.entry_brl));   // só do modelo: fora
    }
    // combo: o do jogo na aba Combos (a Pinnacle não cota combo: a odd que ela pagaria)
    const cb = want(COMBOS) && (g.combos || []).find(isBet), [co, cs] = cb ? comboPin(cb, g) : [];
    if (co) bets.push(base(g, cb, 'Combo', co, cs, cb.entry_brl));
  }
  // múltipla: os bilhetes por faixa de horário, como a aba montava na hora da varredura (só linha cotada)
  if (want(MULTI)) for (const legs of bandTickets(multiLegs(scan.games, { now: at }).filter(l => l.quoted), { target: TARGET })) { const b = multiBet(legs, banca, 'Múltipla'); if (b) bets.push(b); }
  return { id: `${at}`, scan_at: new Date(at).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    window: scan.window ? { from: scan.window.from, to: scan.window.to } : null, date: scan.date || null, bets };
}

// Uma múltipla (pernas de multiple.js) na odd da Pinnacle: o produto das odds dela em cada perna (perna asiática, que ela
// não cota aqui: a que ela pagaria — e o bilhete fica sem CLV). Perna sem chance da Pinnacle: o bilhete fica fora (null).
function multiBet(legs, banca, cat) {
  const [odd, src] = ticketPin(legs);
  if (!odd) return null;
  const t = ticketOf(legs, { houseTotal: odd, banca });
  return { key: `${cat}|${legs.map(l => l.key).join(',')}`, cat, fixtureId: null, kickoff: Math.min(...legs.map(l => l.kickoff)),
    home: `Múltipla (${legs.length})`, away: '', competition: [...new Set(legs.map(l => l.competition))].join(', '), lineId: 'multi', market: 'Múltipla',
    line: legs.map(l => `${l.home} x ${l.away} ${l.line}`).join(' · '), odd: r2(odd), odd_src: src, p: t.p_all, p_pinnacle: t.p_pinnacle_all,
    // entrada: a do bilhete na odd da Pinnacle; se ali não vale (margem), a que o app propõe na odd mínima
    stake_brl: t.stake || t.stake_at_min || 0, legs: legs.map(l => ({ fixtureId: l.fixtureId, lineId: l.lineId, home: l.home, away: l.away, line: l.line, odd: r2(legPin(l)) })),
    status: 'aberta', winner: null, profit_u: null, profit_brl: null, clv: null, detail: null };
}

// O Plano do dia (plan.js) na simulação, na odd da Pinnacle da hora do plano: as simples na dela, os combos e as pernas
// asiáticas na que ela pagaria, as múltiplas no produto. id: um por montagem (planview: plano-<hora da varredura>);
// win: a janela escolhida (h4, d1…); label: o nome do plano no painel.
export function buildPlanSim(plan, { banca = 44000, id = `plano-${plan.date}`, win = null, label = null } = {}) {
  const bets = [
    ...plan.singles.map(({ g, line, lens }) => base(g, line, lens === 'agree' ? 'Plano: simples (acordo com a Pinnacle)' : 'Plano: simples (nossa leitura)',
      line.pinnacle_odd, 'pinnacle', line.entry_brl)),
    ...plan.multis.map(t => multiBet(t.legs, banca, 'Plano: múltipla')).filter(Boolean),
    ...plan.sameGame.flatMap(({ g, combo }) => { const [odd, src] = comboPin(combo, g); return odd ? [base(g, combo, 'Plano: mesmo jogo', odd, src, combo.entry_brl)] : []; }),
  ];
  const now = new Date().toISOString();
  return { id, plan: true, win, label, date: plan.date, scan_at: plan.scan_at, created_at: now, updated_at: now, window: null, bets };
}

// mult: o quanto a múltipla pagou por unidade quando uma perna devolveu ou deu meia (o lucro sai dele)
function close(b, winner, detail, mult = null) {
  b.winner = winner; b.status = 'encerrada'; b.detail = detail;
  b.profit_u = r3(mult != null ? mult - 1 : UNIT[winner](b.odd)); b.profit_brl = r2(b.profit_u * b.stake_brl);
  if (mult != null) b.mult = mult;
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
      const s = settleMulti(rs.map(x => x.r), b.legs.map(l => l.odd));
      const txt = rs.map((x, i) => `${b.legs[i].home} x ${b.legs[i].away}: ${x.txt}`).join(' · ');
      // devolução ou meia numa perna: o bilhete paga o produto do que cada perna pagou
      if (s.done) { if (s.manual && s.mult != null) close(b, s.mult > 1 ? 'A' : s.mult === 1 ? 'VOID' : 'HL', txt, s.mult); else close(b, s.manual ? 'VOID' : s.winner, txt); settled++; }
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
  const real = sim.bets.filter(b => b.cat !== 'nossa análise: entrar se…');   // sem as "entrar se…" que não foram conferidas
  return { cats, total: summarize([...uniq.values()]), confirmed: summarize(real.filter(b => uniq.get(b.legs ? b.key : `${b.fixtureId}|${b.lineId}`) === b)) };
}
