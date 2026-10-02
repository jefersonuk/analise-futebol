// Favoritismo e escanteios. O favorito tende a ganhar mais escanteios que o azarão, além do que a força
// de cada um em escanteios já mostra (quem domina a bola pressiona mais; quem está atrás no placar
// também). Aqui:
//   - preMatch: a superioridade esperada de gols de cada jogo passado (mandante − visitante) e a diferença
//     de escanteios esperada pela força em escanteios, as duas com forças medidas SÓ com os jogos
//     anteriores (uma janela por mês: nada do próprio jogo nem do futuro entra);
//   - calibrate: por liga, quanto a superioridade explica da diferença real de escanteios (jogo e 1º
//     tempo) além da força em escanteios — medido nos 75% mais antigos, conferido nos 25% mais recentes;
//   - marketSupremacy: a superioridade que a Pinnacle precifica no jogo de hoje (1X2 e total sem margem);
//   - roleOf: favorito / equilibrado / zebra.

import { fit, predict, prepare } from './ratings.js';
import { scoreMatrix } from './model.js';

const MONTH = 30 * 864e5;
export const ROLE_EDGE = 0.35;   // gols de superioridade para ser favorito (≈ 47% × 27% de vitória)

export const roleOf = sup => (sup == null ? null : sup >= ROLE_EDGE ? 'favorito' : sup <= -ROLE_EDGE ? 'zebra' : 'equilibrado');

// id do jogo -> { sup, dc } do ponto de vista do mandante.
export function preMatch(matches, { step = MONTH, minRows = 120 } = {}) {
  const done = matches.filter(m => m.hg != null).sort((a, b) => a.t - b.t);
  const out = new Map();
  if (!done.length) return out;
  for (let from = done[0].t; from <= done[done.length - 1].t; from += step) {
    const batch = done.filter(m => m.t >= from && m.t < from + step);
    if (!batch.length) continue;
    const prep = prepare(matches, from);
    if (prep.rows.length < minRows) continue;
    const fg = fit('goals', prep), fc = fit('corners', prep);
    if (!fg) continue;
    for (const m of batch) {
      const g = predict(fg, m.h, m.a), c = fc ? predict(fc, m.h, m.a) : null;
      out.set(m.id, { sup: g.h - g.a, dc: c ? c.h - c.a : null });
    }
  }
  return out;
}

// Mínimos quadrados com intercepto: y ≈ b0 + b1·x1 + … (eliminação de Gauss nas equações normais).
function ols(X, y) {
  const k = X[0].length + 1, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, i) => {
    const r = [1, ...x];
    for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += r[a] * r[b]; A[a][k] += r[a] * y[i]; }
  });
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}
const mse = (pred, y) => y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0) / y.length;
const r3 = x => Math.round(x * 1000) / 1000;

// Uma diferença (jogo ou 1º tempo): base = a + α·dc; com favoritismo = a + α·dc + β·sup.
function relation(rows, target) {
  const data = rows.filter(r => r[target] != null && r.dc != null).sort((a, b) => a.t - b.t);
  if (data.length < 150) return { n: data.length, enough: false };
  const cut = Math.floor(data.length * 0.75), train = data.slice(0, cut), test = data.slice(cut);
  const base = ols(train.map(r => [r.dc]), train.map(r => r[target]));
  const fav = ols(train.map(r => [r.dc, r.sup]), train.map(r => r[target]));
  if (!base || !fav) return { n: data.length, enough: false };
  const yT = test.map(r => r[target]);
  const mBase = mse(test.map(r => base[0] + base[1] * r.dc), yT);
  const mFav = mse(test.map(r => fav[0] + fav[1] * r.dc + fav[2] * r.sup), yT);
  const all = ols(data.map(r => [r.dc, r.sup]), data.map(r => r[target]));   // coeficientes finais: todos os jogos
  return { n: data.length, nTest: test.length, enough: true, coef: all.map(r3), mseBase: r3(mBase), mseFav: r3(mFav),
    gain: r3(1 - mFav / mBase), useful: mFav < mBase * 0.995 && all[2] > 0 };
}

// Relação favoritismo → escanteios numa base de jogos (liga ou conjunto de times).
export function calibrate(matches, pre = preMatch(matches)) {
  const rows = [];
  for (const m of matches) {
    const p = pre.get(m.id);
    if (!p || !m.s) continue;
    rows.push({ t: m.t, sup: p.sup, dc: p.dc, d: m.s[4] - m.s[9], d1: m.c1 ? m.c1[0] - m.c1[1] : null });
  }
  // médias por faixa de superioridade (mandante): mostra se a relação é linear ou se satura
  const edges = [-Infinity, -0.75, -0.25, 0.25, 0.75, 1.25, Infinity];
  const bins = edges.slice(0, -1).map((lo, i) => {
    const b = rows.filter(r => r.sup > lo && r.sup <= edges[i + 1]);
    const avg = f => (b.length ? r3(b.reduce((s, r) => s + f(r), 0) / b.length) : null);
    return { from: lo, to: edges[i + 1], n: b.length, sup: avg(r => r.sup), d: avg(r => r.d), dc: avg(r => r.dc ?? 0), resid: avg(r => r.d - (r.dc ?? 0)) };
  });
  return { n: rows.length, corners: relation(rows, 'd'), corners1h: relation(rows, 'd1'), bins };
}

// Superioridade de gols que a Pinnacle precifica: a que reproduz P(mandante) − P(visitante) sem margem,
// com o total de gols dela. fair: id da linha -> probabilidade sem margem (odds.js).
export function marketSupremacy(fair, total) {
  if (!fair?.has('1') || !fair.has('2') || !(total > 0)) return null;
  const target = fair.get('1') - fair.get('2');
  const edge = s => { const { diff } = scoreMatrix((total + s) / 2, (total - s) / 2); return diff.reduce((acc, [d, p]) => acc + (d > 0 ? p : d < 0 ? -p : 0), 0); };
  let lo = -total + 0.05, hi = total - 0.05;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (edge(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Diferença de escanteios (mandante − visitante) esperada no jogo de hoje com o favoritismo do mercado.
export const cornerDiff = (rel, dc, sup) => (rel?.useful ? rel.coef[0] + rel.coef[1] * dc + rel.coef[2] * sup : null);
