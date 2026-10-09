// Múltipla de várias partidas (acumulada): uma perna por jogo, só over de gols do jogo (1,5 e 2,5) com chance alta.
//
// A conta que manda: com odds justas, a chance de acertar todas é 1 ÷ odd total — uma múltipla de odd 6 acerta ~17%,
// sejam 3 pernas de 1,82 ou 5 de 1,43. "Perna segura" não muda isso; o que muda é a margem da casa, que se multiplica
// a cada perna (5 pernas com 5% de margem cada: −23% de EV). Então só vale montar com pernas em que a casa paga pelo
// menos a nossa justa: o app dá a mínima de cada perna e a do bilhete, a chance de acertar tudo e o EV na odd da casa.
//
// A chance de cada perna é a MENOR entre a nossa (análise) e a mistura com a Pinnacle: o erro de uma perna se multiplica
// com o das outras, e o nosso histórico mostra otimismo do modelo.
//
// Linhas asiáticas na perna (escolha do operador quando a casa não tem o 1,5): mais de 1,75, de 2 e de 2,25 perdem só com
// 0 ou 1 gol, como o 1,5; com exatamente 2 gols o 1,75 ganha metade, o 2 devolve e o 2,25 perde metade; com 3 ou mais
// pagam a odd inteira. As chances saem do over 1,5 e do over 2,5 do próprio jogo: P(2 gols) = P(+1,5) − P(+2,5).
// Na múltipla, cada perna multiplica o bilhete pelo que ela paga: ganha = a odd, meia vitória = (1 + odd)/2, devolve = 1,
// meia derrota = 1/2, perde = 0.

import { pinMargin } from './odds.js';

export const MULTI = 'multipla';            // a aba da varredura
// chance mínima de cada perna por linha: o over 2,5 é a linha seguinte, para o jogo em que a casa não tem o 1,5
export const LEG_P = { 'gO1.5': 0.72, 'gO2.5': 0.6 };
export const MAX_LEGS = 6;
export const TARGETS = [3, 4, 6, 8];     // odd total (justa) que o bilhete automático procura
export const TARGET = 6;
export const MARGIN = 1.05;              // o bilhete só vale com a odd total ≥ justa × 1,05
export const STAKE_CAP = 0.005;          // entrada: ¼ Kelly, no máximo 0,5% da banca (múltipla tem variância alta)
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;

// Desfechos de uma perna: { w: ganha, hw: meia vitória, push: devolve, hl: meia derrota, l: perde }.
const binary = p => ({ w: p, hw: 0, push: 0, hl: 0, l: 1 - p });
// O que a perna devolve, por unidade, na odd o (valor esperado) e a odd justa (a que zera o valor esperado).
export const legEV = (x, o) => x.w * o + x.hw * (1 + o) / 2 + x.push + x.hl / 2;
export const fairOf = x => (1 - x.hw / 2 - x.push - x.hl / 2) / (x.w + x.hw / 2);
// As linhas asiáticas entre o 1,5 e o 2,5, pela chance de 2+ gols (p15) e de 3+ (p25).
export const ASIAN = [
  ['gO1.75', 'Mais de 1,75', (p15, p25) => ({ w: p25, hw: p15 - p25, push: 0, hl: 0, l: 1 - p15 })],
  ['gO2', 'Mais de 2', (p15, p25) => ({ w: p25, hw: 0, push: p15 - p25, hl: 0, l: 1 - p15 })],
  ['gO2.25', 'Mais de 2,25', (p15, p25) => ({ w: p25, hw: 0, push: 0, hl: p15 - p25, l: 1 - p15 })],
];
const outOf = l => l.out || binary(l.p), outPinOf = l => l.outPin || binary(l.p_pinnacle);

// Os jogos possíveis da varredura (que ainda não começaram; sem jogo difícil), cada um com as linhas que passam
// (over 1,5 com 72%+, over 2,5 com 60%+; contexto que não é contra; a nossa chance não mais que 2 pp abaixo da
// Pinnacle). quoted: a Pinnacle cota a linha neste jogo — sem isso a chance sai do total dela e a casa costuma
// não ter a linha (o over 1,5 de jogo de muito gol). A perna do jogo: a cotada de maior chance; senão a de maior chance.
// Ordem: com linha cotada, contexto a favor, a chance da Pinnacle.
export function multiGames(games, { now = Date.now() } = {}) {
  const out = [];
  for (const g of games) {
    if (g.hard || g.fx.t <= now + 10 * 60e3) continue;
    const ours = new Map((g.scenario || []).map(l => [l.id, l.p_nossa]));
    const base = { fixtureId: g.fx.id, kickoff: g.fx.t, home: g.fx.home.name, away: g.fx.away.name, competition: g.fx.league.name, market: 'Total de gols' };
    const pOf = l => Math.min(l.p_blend, ours.get(l.id) ?? 1), m = pinMargin(g.lines || []);
    const options = (g.lines || []).filter(l => LEG_P[l.id] && l.p_pinnacle != null && l.context?.verdict !== 'contra').map(l => {
      const p = pOf(l);
      return { ...base, key: `${g.fx.id}:${l.id}`, lineId: l.id, market: l.market, line: l.line, p: r3(p), p_pinnacle: l.p_pinnacle, p_nossa: ours.get(l.id) ?? null,
        fair: r2(1 / p), out: binary(r3(p)), outPin: binary(l.p_pinnacle), pinnacle_odd: l.pinnacle_odd ?? null, quoted: !l.derived && l.pinnacle_odd != null,
        // a odd que a Pinnacle pagaria onde não cota a linha (simulação no pior cenário): pela chance e pela margem dela
        pin_est: l.pinnacle_odd > 1 || !(l.p_pinnacle > 0) ? null : r2(1 / (l.p_pinnacle * m)), context: l.context?.verdict || null };
    }).filter(l => l.p >= LEG_P[l.lineId] && l.p >= l.p_pinnacle - 0.02);
    // as asiáticas do jogo (perdem só com 0 ou 1 gol, como o 1,5): quando o 1,5 passa e há o 2,5 para medir os 2 gols
    const o15 = options.find(o => o.lineId === 'gO1.5'), l25 = (g.lines || []).find(l => l.id === 'gO2.5' && l.p_pinnacle != null);
    if (o15 && l25) {
      const p25 = Math.min(pOf(l25), o15.p), q25 = Math.min(l25.p_pinnacle, o15.p_pinnacle);
      for (const [id, label, f] of ASIAN) {
        const x = f(o15.p, p25), xp = f(o15.p_pinnacle, q25);
        options.push({ ...base, key: `${g.fx.id}:${id}`, lineId: id, line: label, p: o15.p, p_pinnacle: o15.p_pinnacle, p_nossa: null, p_win: r3(p25),
          fair: r2(fairOf(x)), out: x, outPin: xp, pinnacle_odd: null, pin_est: r2(fairOf(xp) / m), quoted: false, asian: true, context: o15.context });
      }
    }
    options.sort((a, b) => b.quoted - a.quoted || !!a.asian - !!b.asian || b.p - a.p);
    if (options.length) out.push({ fixtureId: g.fx.id, options, best: options[0] });
  }
  return out.sort((a, b) => legOrder(a.best, b.best));
}
// Preferência entre pernas: linha cotada, contexto a favor, a chance da Pinnacle, a nossa.
const fav = l => (l.context === 'a favor' ? 1 : 0);
export const legOrder = (a, b) => b.quoted - a.quoted || fav(b) - fav(a) || b.p_pinnacle - a.p_pinnacle || b.p - a.p;
// A perna de cada jogo (a preferida), na ordem de multiGames.
export const multiLegs = (games, opts) => multiGames(games, opts).map(x => x.best);

// O bilhete automático: as primeiras pernas da lista até a odd justa total chegar no alvo (no máximo MAX_LEGS).
// Só pernas com a linha cotada pela Pinnacle: as outras a casa costuma não ter (marque à mão se tiver).
export function autoTicket(legs, { target = TARGET, maxLegs = MAX_LEGS } = {}) {
  const pick = [];
  let fair = 1;
  for (const l of legs.filter(x => x.quoted)) {
    if (fair >= target || pick.length >= maxLegs) break;
    pick.push(l); fair *= l.fair;
  }
  return pick;
}

// Bilhetes por faixa de horário, do mais próximo ao mais longe: a faixa começa no jogo mais cedo que sobrou e vai até
// `band` depois; dentro dela, as melhores pernas (legOrder) até a odd justa do alvo (no máximo MAX_LEGS). O que sobra
// na faixa entra no bilhete seguinte; perna que não fecha bilhete de 2 fica de fora. Cada jogo entra em um bilhete só.
// legs: as pernas que podem entrar (quem chama decide: cotadas, sem jogo que já tem entrada).
export const BANDS = [1, 2, 3];          // horas
export const BAND = 2;
export function bandTickets(legs, { target = TARGET, band = BAND, maxLegs = MAX_LEGS } = {}) {
  let pool = [...legs].sort((a, b) => a.kickoff - b.kickoff);
  const out = [];
  while (pool.length) {
    const start = pool[0].kickoff, inBand = pool.filter(l => l.kickoff < start + band * 3600e3).sort(legOrder);
    const pick = [];
    let fair = 1;
    for (const l of inBand) { if (fair >= target || pick.length >= maxLegs) break; pick.push(l); fair *= l.fair; }
    if (pick.length >= 2) {
      out.push(pick.sort((a, b) => a.kickoff - b.kickoff));
      const used = new Set(pick.map(l => l.key));
      pool = pool.filter(l => !used.has(l.key));
    } else pool = pool.slice(1);
  }
  return out;
}

// A conta do bilhete. house: Map(key -> odd da casa na perna) e/ou houseTotal (a odd total que a casa mostra).
// p_all: chance de nenhuma perna perder (com perna asiática, "não perder" inclui devolver e meia); p_win_all: todas
// inteiras. EV: com a odd de cada perna, o produto do que cada uma devolve; só com a total, ela repartida entre as
// pernas na proporção das justas.
export function ticketOf(legs, { house = new Map(), houseTotal = null, banca = 44000 } = {}) {
  const n = legs.length;
  if (!n) return null;
  const xs = legs.map(outOf), fairs = xs.map(fairOf);
  const pAll = xs.reduce((t, x) => t * (1 - x.l), 1), pWin = xs.reduce((t, x) => t * x.w, 1);
  const pPin = legs.reduce((t, l) => t * (1 - outPinOf(l).l), 1);
  const legMargin = MARGIN ** (1 / n);
  const each = legs.map((l, i) => { const o = house.get(l.key) ?? null, min = r2(fairs[i] * legMargin);
    return { ...l, min, house: o, below: o != null && o < min }; });
  const allHouse = each.every(l => l.house > 1) ? each.reduce((t, l) => t * l.house, 1) : null;
  const odd = houseTotal > 1 ? houseTotal : allHouse;
  const fair = fairs.reduce((t, f) => t * f, 1), min = fair * MARGIN;
  const evAt = o => (allHouse && !(houseTotal > 1) && o === odd ? xs.reduce((t, x, i) => t * legEV(x, each[i].house), 1)
    : xs.reduce((t, x, i) => t * legEV(x, fairs[i] * (o / fair) ** (1 / n)), 1)) - 1;
  const ev = odd ? evAt(odd) : null;
  const kellyAt = o => { const e = evAt(o); return e > 0 ? Math.round(Math.min(0.25 * e / (o - 1), STAKE_CAP) * banca) : 0; };
  const stake = odd ? kellyAt(odd) : 0;
  return { n, legs: each, p_all: r3(pAll), p_win_all: r3(pWin), p_pinnacle_all: r3(pPin), asian: legs.some(l => l.asian), fair: r2(fair), min: r2(min),
    odd: odd ? r2(odd) : null, ev: ev == null ? null : r3(ev),
    stake: odd ? stake : null, stake_at_min: kellyAt(min), stake_cap: Math.round(STAKE_CAP * banca), first_kickoff: Math.min(...legs.map(l => l.kickoff)), last_kickoff: Math.max(...legs.map(l => l.kickoff)),
    verdict: !odd ? 'sem odd' : odd >= min && !each.some(l => l.below) ? 'vale' : odd >= fair ? 'no limite' : 'não vale' };
}

// A "linha" que o formulário de entrada e o app de apostas recebem.
export function multiLine(t) {
  const legs = t.legs.map(l => ({ fixtureId: l.fixtureId, lineId: l.lineId, home: l.home, away: l.away, kickoff: new Date(l.kickoff).toISOString(),
    competition: l.competition, mercado: l.market, linha: l.line, p: l.p, p_pinnacle: l.p_pinnacle, fair_odd: l.fair, odd_min: l.min, odd_casa: l.house,
    ...(l.asian ? { asiatica: true } : {}) }));
  return { id: `multi:${t.legs.map(l => l.key).join(',')}`, multi: true, market: 'Múltipla', line: `${t.n} perna${t.n > 1 ? 's' : ''}: ${t.legs.map(l => `${l.home} x ${l.away} ${l.line}`).join(' · ')}`,
    legs, p_blend: t.p_all, p_pinnacle: t.p_pinnacle_all, fair_odd_blend: t.fair, odd_min: t.min, tier: 'múltipla', priced_by: 'pinnacle', entry_brl: t.stake || t.stake_at_min || null,
    asian: !!t.asian,
    first_kickoff: t.first_kickoff, last_kickoff: t.last_kickoff };
}

// Liquidação: os resultados de cada perna ('A' | 'HW' | 'VOID' | 'HL' | 'RED' | null = ainda não). Uma perdida perde tudo.
// Devolução ou meia numa perna (jogo cancelado, linha asiática): a casa recalcula a odd — mult é o quanto o bilhete
// paga por unidade quando se sabe a odd de cada perna (odds); na aposta real fica para conferir e marcar à mão.
const PAYS = { A: o => o, HW: o => (1 + o) / 2, VOID: () => 1, HL: () => 0.5 };
export function settleMulti(results, odds = null) {
  if (results.some(r => r === 'RED')) return { winner: 'RED', done: true, mult: 0 };
  if (results.some(r => r == null)) return { winner: null, done: false };
  const mult = odds?.every(o => o > 1) ? r3(results.reduce((t, r, i) => t * PAYS[r](odds[i]), 1)) : null;
  if (results.some(r => r !== 'A')) return { winner: null, done: true, manual: true, mult };
  return { winner: 'A', done: true, mult };
}
