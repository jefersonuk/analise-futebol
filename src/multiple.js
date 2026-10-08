// Múltipla de várias partidas (acumulada): uma perna por jogo, só over de gols do jogo (1,5 e 2,5) com chance alta.
//
// A conta que manda: com odds justas, a chance de acertar todas é 1 ÷ odd total — uma múltipla de odd 6 acerta ~17%,
// sejam 3 pernas de 1,82 ou 5 de 1,43. "Perna segura" não muda isso; o que muda é a margem da casa, que se multiplica
// a cada perna (5 pernas com 5% de margem cada: −23% de EV). Então só vale montar com pernas em que a casa paga pelo
// menos a nossa justa: o app dá a mínima de cada perna e a do bilhete, a chance de acertar tudo e o EV na odd da casa.
//
// A chance de cada perna é a MENOR entre a nossa (análise) e a mistura com a Pinnacle: o erro de uma perna se multiplica
// com o das outras, e o nosso histórico mostra otimismo do modelo.

export const MULTI = 'multipla';            // a aba da varredura
export const LEG_P = 0.72;               // chance mínima de cada perna
export const MAX_LEGS = 6;
export const TARGETS = [3, 4, 6, 8];     // odd total (justa) que o bilhete automático procura
export const TARGET = 6;
export const MARGIN = 1.05;              // o bilhete só vale com a odd total ≥ justa × 1,05
export const STAKE_CAP = 0.005;          // entrada: ¼ Kelly, no máximo 0,5% da banca (múltipla tem variância alta)
const LEG_IDS = new Set(['gO1.5', 'gO2.5']);
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;

// As pernas possíveis da varredura (jogos que ainda não começaram; sem jogo difícil; contexto que não é contra; com a
// chance da Pinnacle). Uma por jogo: a de maior chance. Ordem: contexto a favor, depois a chance da Pinnacle.
export function multiLegs(games, { now = Date.now(), minP = LEG_P } = {}) {
  const out = [];
  for (const g of games) {
    if (g.hard || g.fx.t <= now + 10 * 60e3) continue;
    const ours = new Map((g.scenario || []).map(l => [l.id, l.p_nossa]));
    const legs = (g.lines || []).filter(l => LEG_IDS.has(l.id) && l.p_pinnacle != null && l.context?.verdict !== 'contra').map(l => {
      const p = Math.min(l.p_blend, ours.get(l.id) ?? 1);
      return { key: `${g.fx.id}:${l.id}`, fixtureId: g.fx.id, kickoff: g.fx.t, home: g.fx.home.name, away: g.fx.away.name, competition: g.fx.league.name,
        lineId: l.id, market: l.market, line: l.line, p: r3(p), p_pinnacle: l.p_pinnacle, p_nossa: ours.get(l.id) ?? null, fair: r2(1 / p),
        pinnacle_odd: l.pinnacle_odd ?? null, context: l.context?.verdict || null, derived: !!l.derived };
    }).filter(l => l.p >= minP && l.p >= l.p_pinnacle - 0.02);
    if (legs.length) out.push(legs.sort((a, b) => b.p - a.p)[0]);
  }
  const fav = l => (l.context === 'a favor' ? 1 : 0);
  return out.sort((a, b) => fav(b) - fav(a) || b.p_pinnacle - a.p_pinnacle || b.p - a.p);
}

// O bilhete automático: as primeiras pernas da lista até a odd justa total chegar no alvo (no máximo MAX_LEGS).
export function autoTicket(legs, { target = TARGET, maxLegs = MAX_LEGS } = {}) {
  const pick = [];
  let fair = 1;
  for (const l of legs) {
    if (fair >= target || pick.length >= maxLegs) break;
    pick.push(l); fair /= l.p;
  }
  return pick;
}

// A conta do bilhete. house: Map(key -> odd da casa na perna) e/ou houseTotal (a odd total que a casa mostra).
export function ticketOf(legs, { house = new Map(), houseTotal = null, banca = 44000 } = {}) {
  const n = legs.length;
  if (!n) return null;
  const pAll = legs.reduce((t, l) => t * l.p, 1), pPin = legs.reduce((t, l) => t * l.p_pinnacle, 1);
  const legMargin = MARGIN ** (1 / n);
  const each = legs.map(l => { const o = house.get(l.key) ?? null, min = r2(l.fair * legMargin);
    return { ...l, min, house: o, below: o != null && o < min }; });
  const allHouse = each.every(l => l.house > 1) ? each.reduce((t, l) => t * l.house, 1) : null;
  const odd = houseTotal > 1 ? houseTotal : allHouse;
  const fair = 1 / pAll, min = fair * MARGIN;
  const ev = odd ? pAll * odd - 1 : null;
  const kellyAt = o => { const e = pAll * o - 1; return e > 0 ? Math.round(Math.min(0.25 * e / (o - 1), STAKE_CAP) * banca) : 0; };
  const stake = odd ? kellyAt(odd) : 0;
  return { n, legs: each, p_all: r3(pAll), p_pinnacle_all: r3(pPin), fair: r2(fair), min: r2(min), odd: odd ? r2(odd) : null, ev: ev == null ? null : r3(ev),
    stake: odd ? stake : null, stake_at_min: kellyAt(min), stake_cap: Math.round(STAKE_CAP * banca), first_kickoff: Math.min(...legs.map(l => l.kickoff)), last_kickoff: Math.max(...legs.map(l => l.kickoff)),
    verdict: !odd ? 'sem odd' : odd >= min && !each.some(l => l.below) ? 'vale' : odd >= fair ? 'no limite' : 'não vale' };
}

// A "linha" que o formulário de entrada e o app de apostas recebem.
export function multiLine(t) {
  const legs = t.legs.map(l => ({ fixtureId: l.fixtureId, lineId: l.lineId, home: l.home, away: l.away, kickoff: new Date(l.kickoff).toISOString(),
    competition: l.competition, mercado: l.market, linha: l.line, p: l.p, p_pinnacle: l.p_pinnacle, fair_odd: l.fair, odd_min: l.min, odd_casa: l.house }));
  return { id: `multi:${t.legs.map(l => l.key).join(',')}`, multi: true, market: 'Múltipla', line: `${t.n} perna${t.n > 1 ? 's' : ''}: ${t.legs.map(l => `${l.home} x ${l.away} ${l.line}`).join(' · ')}`,
    legs, p_blend: t.p_all, p_pinnacle: t.p_pinnacle_all, fair_odd_blend: t.fair, odd_min: t.min, tier: 'múltipla', priced_by: 'pinnacle', entry_brl: t.stake || t.stake_at_min || null,
    first_kickoff: t.first_kickoff, last_kickoff: t.last_kickoff };
}

// Liquidação: os resultados de cada perna ('A' | 'RED' | 'VOID' | null = ainda não). Uma perdida perde tudo; anulada
// (jogo cancelado ou devolução) sai do bilhete e a casa recalcula a odd — marcar à mão.
export function settleMulti(results) {
  if (results.some(r => r === 'RED' || r === 'HL')) return { winner: 'RED', done: true };
  if (results.some(r => r == null)) return { winner: null, done: false };
  if (results.some(r => r !== 'A')) return { winner: null, done: true, manual: true };
  return { winner: 'A', done: true };
}
