// Vitória do favorito no 1º tempo (Jeferson, 13/10/2026: "jogos com favoritismo alto, vitória do favorito no 1º tempo
// costuma pagar um pouco melhor"). Favorito: o da Pinnacle no 1X2 do jogo, com 60%+ de vencer (FAV_P) — aí a vitória no
// jogo paga pouco e a do 1º tempo sai perto de 2. A chance: a Pinnacle sem margem no resultado do 1º tempo (mercado 13;
// sem ele, o handicap asiático do 1º tempo −0,5, mercado 19, que é a mesma aposta) misturada com 10% do nosso modelo de
// gols do 1º tempo (o placar do intervalo pelos gols esperados de cada time no 1º tempo); o histórico: os últimos jogos
// dos dois times no 1º tempo, pesados pelo papel de hoje. Liquida pelo placar do intervalo (dashboard.js, id 1T1/1T2).

import { scoreMatrix, settle, stakeFor } from './model.js';
import { blend, lineHistory } from './dossier.js';
import { consistency } from './consistency.js';

export const HALF = 'Resultado 1º tempo', FAV_P = 0.6;
const r = (x, d = 3) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const cond = x => x.pWin / (x.pWin + x.pLose);

// res: analyzeMatch; fair/odds: a Pinnacle (collect); teams: [{ role, name, games, roleNow }]; names: { home, away }.
export function favHalfWin({ res, fair, odds, teams = [], names, banca = 44000, hard = null }) {
  if (hard || !fair?.has('1') || !fair.has('2')) return null;
  const side = fair.get('1') >= fair.get('2') ? '1' : '2', pFt = fair.get(side);
  if (pFt < FAV_P) return null;
  const id = `1T${side}`, alt = side === '1' ? 'a1H-0.5' : 'a1A-0.5';
  const src = fair.has(id) ? id : fair.has(alt) ? alt : null;
  const pp = src ? fair.get(src) : null, odd = src ? odds?.get(src) ?? null : null;
  const g1 = res?.pred?.goals1h;
  const pm = g1 ? cond(settle(scoreMatrix(side === '1' ? g1.h : g1.a, side === '1' ? g1.a : g1.h).diff, -0.5)) : null;
  if (pp == null && pm == null) return null;
  const pb = pp != null && pm != null ? blend(pp, pm, 0.1) : pp ?? pm;
  const hi = lineHistory(id, teams), hits = [hi.home, hi.away].filter(Boolean);
  const c = consistency({ p: pb, pLow: Math.min(pb, pm ?? pb), hits });
  const raw = hits.reduce((a, h) => ({ w: a.w + h.raw.wins, n: a.n + h.raw.n }), { w: 0, n: 0 });
  const fav = side === '1' ? names.home : names.away;
  return { id, market: HALF, line: `${fav} vence o 1º tempo`, fav: true, half: true, side, p_fav_ft: r(pFt),
    p_model: r(pm), p_pinnacle: r(pp), pinnacle_odd: odd, p_blend: r(pb), fair_odd_blend: r(1 / pb, 2), odd_min: r(1.03 / pb, 2),
    priced_by: src === id ? 'pinnacle' : src ? 'pinnacle (handicap asiático do 1º tempo −0,5)' : 'só o modelo (a Pinnacle não cota o 1º tempo neste jogo)',
    tier: c.tier, consistency_score: r(c.score), hit_rate_last10: raw.n ? r(raw.w / raw.n, 2) : null, hit_rate_role: r(c.hit_rate, 2), history: hi,
    ...stakeFor(pb, 1.03 / pb, banca) };
}
