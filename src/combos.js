// Combos de duas pernas no mesmo jogo ("criar aposta"): um resultado — vitória, dupla chance, empate anula ou
// handicap de gols ±1,5 — mais o over de gols do jogo (1,5, 2,5 ou 3,5; só over, regra do Jeferson). A segunda
// perna sobe a odd; o combo só interessa se ainda acerta 60%+.
//
// As pernas não são independentes (favorito vencendo e jogo com gols andam juntos; dupla chance do azarão e jogo
// aberto, não), então a chance sai da matriz de placares, não do produto das duas:
//   • mercado: Dixon-Coles com o total de gols e a superioridade que a Pinnacle precifica (o 1X2 e o total dela,
//     sem margem, saem iguais na matriz);
//   • modelo (forças da liga) com 10% de peso, placar a placar (a mesma mistura log-linear das linhas de gols);
//   • pior cenário: o modelo com ±1 erro-padrão em cada time, como nas linhas.
// Empate anula com empate: a perna volta e vale só a de gols (regra da maioria das casas — confira na sua). A odd
// justa conta isso com a odd da perna de gols numa casa soft (justa ÷ 1,05); na liquidação, esse caso fica para
// marcar à mão.
// Entram combos com chance ≥ 60%, odd mínima 1,50–3,00 (Política E) e que pagam pelo menos 10% mais que a
// melhor perna sozinha — senão a segunda perna não acrescenta nada.

import { SCENARIOS, impliedTotal, marketSupremacy, politicaE, roleOf, scoreGrid, stakeFor } from './model.js';
import { HIT_MIN, ODD_FLOOR, consistency } from './consistency.js';
import { inviableReason, roleWeight } from './dossier.js';

export const COMBO = 'Combo';
const W_MODEL = 0.1, SOFT = 1.05, MARGIN = 1.05, LIFT = 1.1, KEEP = 6;
const num = x => String(x).replace('.', ',');
const r = (x, d = 3) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sgn = x => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);   // 1 ganha, 0 devolve, −1 perde

// Pernas de resultado: id, rótulo (com os nomes) e o resultado no placar (h, a).
const RESULT = {
  1: { label: n => `${n.home} vence`, f: (h, a) => (h > a ? 1 : -1) },
  2: { label: n => `${n.away} vence`, f: (h, a) => (a > h ? 1 : -1) },
  '1X': { label: n => `${n.home} ou empate`, f: (h, a) => (h >= a ? 1 : -1) },
  X2: { label: n => `${n.away} ou empate`, f: (h, a) => (a >= h ? 1 : -1) },
  12: { label: n => `${n.home} ou ${n.away} (sem empate)`, f: (h, a) => (h !== a ? 1 : -1) },
  dnb1: { label: n => `${n.home} (empate anula)`, f: (h, a) => sgn(h - a) },
  dnb2: { label: n => `${n.away} (empate anula)`, f: (h, a) => sgn(a - h) },
  'ahH-1.5': { label: n => `${n.home} −1,5`, f: (h, a) => sgn(h - a - 1.5) },
  'ahA-1.5': { label: n => `${n.away} −1,5`, f: (h, a) => sgn(a - h - 1.5) },
  'ahH1.5': { label: n => `${n.home} +1,5`, f: (h, a) => sgn(h - a + 1.5) },
  'ahA1.5': { label: n => `${n.away} +1,5`, f: (h, a) => sgn(a - h + 1.5) },
};
const GOALS = [1.5, 2.5, 3.5];
const goalLeg = L => ({ id: `gO${L}`, label: `Mais de ${num(L)} gols`, f: (h, a) => (h + a > L ? 1 : -1) });

export const isCombo = id => /^cb:/.test(id || '');
// 'cb:1X+gO1.5' -> as duas pernas
export function parseCombo(id, names = { home: 'Mandante', away: 'Visitante' }) {
  const m = String(id || '').match(/^cb:(.+)\+gO([\d.]+)$/);
  if (!m || !RESULT[m[1]]) return null;
  const R = RESULT[m[1]], G = goalLeg(+m[2]);
  return { result: { id: m[1], label: R.label(names), f: R.f }, goals: { id: G.id, label: G.label, f: G.f, line: +m[2] } };
}
// Resultado do combo num placar: 1 ganha, 0 empate anula com a perna de gols ganhando (vale só ela), −1 perde.
export function comboOutcome(c, h, a) {
  const x = c.result.f(h, a), y = c.goals.f(h, a);
  return x === -1 || y === -1 ? -1 : x === 1 ? 1 : 0;
}

// Grades placar a placar: mistura log-linear (geométrica) mercado × modelo, normalizada.
function pool(mk, md, w = W_MODEL) {
  const q = mk.map(([i, j, p], k) => [i, j, p ** (1 - w) * md[k][2] ** w]), z = q.reduce((s, x) => s + x[2], 0);
  return q.map(([i, j, p]) => [i, j, p / z]);
}
// win: as duas ganham; push: a de resultado devolve e a de gols ganha; lose: o resto
function probs(grid, c) {
  let win = 0, push = 0;
  for (const [i, j, p] of grid) { const o = comboOutcome(c, i, j); if (o === 1) win += p; else if (o === 0) push += p; }
  return { win, push, lose: 1 - win - push };
}
const legP = (grid, f) => grid.reduce((s, [i, j, p]) => { const o = f(i, j); return { w: s.w + (o === 1 ? p : 0), l: s.l + (o === -1 ? p : 0) }; }, { w: 0, l: 0 });

// Histórico do combo nos últimos jogos de cada time, com o placar visto como o de hoje (para o visitante de hoje,
// os gols dele são os do "visitante"). Pesado pelo papel, como as linhas (dossier.js lineHistory).
function comboHistory(c, teams) {
  const one = t => {
    if (!t?.games?.length) return null;
    let wins = 0, n = 0, rw = 0, rn = 0;
    for (const g of t.games) {
      if (g.gf == null || g.ga == null) continue;
      const [h, a] = t.role === 'home' ? [g.gf, g.ga] : [g.ga, g.gf];
      const o = comboOutcome(c, h, a), win = o === 1 ? 1 : o === 0 ? 0.5 : 0, w = roleWeight(t.roleNow, roleOf(g.sup));
      wins += w * win; n += w; rw += win; rn++;
    }
    return rn ? { what: 'combo', rule: 'as duas pernas no placar final', hits: `${num(rw)}/${rn}`, raw: { wins: rw, n: rn }, wins: r(wins, 2), n: r(n, 2), role_now: t.roleNow ?? null } : null;
  };
  return { home: one(teams.find(t => t.role === 'home')), away: one(teams.find(t => t.role === 'away')) };
}

// Combos de um jogo, do mais consistente ao menos (até KEEP). res: analyzeMatch; fair: Pinnacle sem margem;
// teams: [{ role, name, games, roleNow }]; hard: jogo difícil (sem combos).
export function comboLines({ res, fair, teams, names, banca = 44000, hard = null }) {
  const gp = res?.pred?.goals;
  if (hard || !gp || !fair?.size || !fair.has('1') || !fair.has('2')) return [];
  const T = impliedTotal(fair, 'g', 1)?.implied_total, s = T ? marketSupremacy(fair, T) : null;
  if (!T || s == null) return [];
  const mk = scoreGrid((T + s) / 2, (T - s) / 2), md = scoreGrid(gp.h, gp.a), bl = pool(mk, md);
  const sc = SCENARIOS.map(([x, y]) => scoreGrid(gp.h * Math.exp(x * (gp.seH || 0)), gp.a * Math.exp(y * (gp.seA || 0))));
  const out = [];
  for (const rid of Object.keys(RESULT)) {
    if (inviableReason(rid, res.favor, names)) continue;   // "favorito +1,5" não sai a preço jogável
    for (const L of GOALS) {
      const c = parseCombo(`cb:${rid}+gO${L}`, names), b = probs(bl, c);
      if (b.win <= 0.01) continue;
      const rb = legP(bl, c.result.f), gb = legP(bl, c.goals.f);
      const fairR = 1 + rb.l / rb.w, fairG = 1 / gb.w;
      // odd justa do combo: EV 0 com o empate anula pagando a perna de gols numa casa soft
      const oddG = fairG / SOFT, fair0 = (1 - b.push * oddG) / b.win, p = b.win + b.push;
      if (!(fair0 > 1) || p < HIT_MIN || fair0 < LIFT * Math.max(fairR, fairG)) continue;
      const oddMin = Math.max(ODD_FLOOR, fair0 * MARGIN), pe = politicaE(oddMin);
      if (pe.factor === 0) continue;
      const m = probs(mk, c), mo = probs(md, c), range = sc.map(g => { const x = probs(g, c); return x.win + x.push; });
      const hi = comboHistory(c, teams), hits = [hi.home, hi.away].filter(Boolean);
      const cons = consistency({ p, pLow: Math.min(...range), hits });
      const raw = hits.reduce((a, h) => ({ w: a.w + h.raw.wins, n: a.n + h.raw.n }), { w: 0, n: 0 });
      // EV na odd mínima com o caso "vale só a perna de gols"
      const pEff = (b.win * oddMin + b.push * oddG) / oddMin;
      out.push({
        id: `cb:${rid}+gO${L}`, market: COMBO, combo: true, line: `${c.result.label} + ${c.goals.label}`,
        legs: [{ id: rid, line: c.result.label, p: r(rb.w), push: r(1 - rb.w - rb.l), fair_odd: r(fairR, 2) },
          { id: c.goals.id, line: c.goals.label, p: r(gb.w), fair_odd: r(fairG, 2) }],
        p_blend: r(p), p_full: r(b.win), push_prob: r(b.push), p_pinnacle: r(m.win + m.push), push_pinnacle: r(m.push), p_model: r(mo.win + mo.push),
        p_model_range: [r(Math.min(...range)), r(Math.max(...range))],
        // quanto as pernas andam juntas: chance das duas ganharem ÷ produto das chances de cada uma
        corr: r(b.win / (rb.w * gb.w)), odd_indep: r(fairR * fairG, 2),
        fair_odd_blend: r(fair0, 2), odd_min: r(oddMin, 2), odd_min_vs_pinnacle_pct: null, pinnacle_odd: null, fragile: true,
        priced_by: 'combo: placares da Pinnacle (1X2 e total de gols) + 10% do modelo',
        tier: cons.tier, consistency_score: r(cons.score), hit_rate_last10: raw.n ? r(raw.w / raw.n, 2) : null, hit_rate_role: r(cons.hit_rate, 2),
        ...stakeFor(pEff, oddMin, banca), history: hi,
      });
    }
  }
  const TIER = { 'âncora': 0, 'sólida': 1, 'especulativa': 2 };
  return out.sort((a, b) => TIER[a.tier] - TIER[b.tier] || b.consistency_score - a.consistency_score || b.odd_min - a.odd_min).slice(0, KEEP);
}

// Liquidação no placar final: 'A' (as duas ganharam), 'RED', ou manual quando o empate anula volta e a de gols ganha.
export function settleCombo(id, hg, ag, names) {
  const c = parseCombo(id, names);
  if (!c || hg == null || ag == null) return null;
  const o = comboOutcome(c, hg, ag);
  return { winner: o === 1 ? 'A' : o === -1 ? 'RED' : null, manual: o === 0, value: `${hg}–${ag}`, what: 'placar', threshold: c.goals.line,
    detail: o === 0 ? `${c.result.label}: empate, a perna volta; ${c.goals.label}: ganhou — pela regra da maioria das casas a aposta vale só a perna de gols (marque à mão)` : null };
}

// Ao vivo: os gols do jogo contra a linha (falta quantos) e como a perna de resultado está agora.
export function liveCombo(id, info) {
  const c = parseCombo(id, { home: info.home, away: info.away });
  if (!c || !info.goals) return null;
  const [h, a] = info.goals, tot = h + a, o = comboOutcome(c, h, a), x = c.result.f(h, a), hit = tot > c.goals.line;
  const now = o === 1 ? 'A' : o === 0 ? 'VOID' : 'RED';
  return { value: tot, threshold: c.goals.line, what: 'gols no jogo', now, locked: !!info.finished, need: hit ? 0 : Math.floor(c.goals.line) + 1 - tot,
    leg: `${c.result.label}: ${x === 1 ? 'ganha agora' : x === 0 ? 'devolve agora' : 'perde agora'}` };
}
