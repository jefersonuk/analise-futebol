// Probabilidades de cada linha a partir das forças da liga (ratings.js).

import { METRICS, fit, observe, predict, prepare } from './ratings.js';

export { METRICS };
export const RHO = -0.13;          // correção Dixon-Coles para placares baixos
const MAXG = 10;
const VMR_CAP = { corners: 1.35, shots: 1.6, sot: 1.6, corners1h: 1.6 };
const ANCHOR_W = 0.8;   // peso da Pinnacle ao ancorar o total de escanteios do 1º tempo
export const SHARE_1H = 0.472;   // fração dos escanteios no 1º tempo (Footiqo, 141 mil jogos) quando a liga não tem dado

// PMF de contagem com média mu e variância phi*mu (Poisson se phi ~ 1, senão binomial negativa).
export function dist(mu, phi, max) {
  const p = new Array(max + 1);
  if (phi <= 1.02) {
    p[0] = Math.exp(-mu);
    for (let k = 1; k <= max; k++) p[k] = p[k - 1] * mu / k;
  } else {
    const r = mu / (phi - 1), q = r / (r + mu);
    p[0] = Math.pow(q, r);
    for (let k = 1; k <= max; k++) p[k] = p[k - 1] * (k - 1 + r) / k * (1 - q);
  }
  return p;
}

// Matriz de placares Dixon-Coles -> distribuições de diferença e de total.
export function scoreMatrix(lh, la, rho = RHO) {
  const ph = dist(lh, 1, MAXG), pa = dist(la, 1, MAXG);
  const tau = (i, j) => (i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho
    : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1);
  const diff = new Map(), tot = new Map();
  let z = 0, btts = 0;
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) {
    const p = Math.max(0, tau(i, j) * ph[i] * pa[j]);
    z += p;
    diff.set(i - j, (diff.get(i - j) || 0) + p);
    tot.set(i + j, (tot.get(i + j) || 0) + p);
    if (i && j) btts += p;
  }
  const norm = m => [...m].map(([v, p]) => [v, p / z]);
  return { diff: norm(diff), tot: norm(tot), btts: btts / z };
}

// Liquidação asiática da aposta "X + line > 0". Linhas de quarto = meia aposta em cada meia-linha.
// Devolve probabilidades efetivas: EV = pWin·(odd−1) − pLose.
export function settle(entries, line) {
  if (Math.round(line * 4) % 2 !== 0) {
    const a = settle(entries, line - 0.25), b = settle(entries, line + 0.25);
    return { pWin: (a.pWin + b.pWin) / 2, pLose: (a.pLose + b.pLose) / 2 };
  }
  let pWin = 0, pLose = 0;
  for (const [v, p] of entries) {
    const r = v + line;
    if (r > 1e-9) pWin += p; else if (r < -1e-9) pLose += p;
  }
  return { pWin, pLose };
}

const fmt = x => (x > 0 ? '+' : x < 0 ? '−' : '') + String(Math.abs(x)).replace('.', ',');
// Rótulo com o nome dos times no lugar de "Casa"/"Fora": o lado da aposta é o mandante/visitante DESTE
// jogo, e a palavra "fora" também aparece nos jogos passados com outro sentido (onde o time jogou).
export const sideLabel = (label, home, away) => (home && away
  ? label.replace(/^Casa\b/, () => home).replace(/^Fora\b/, () => away) : label);
const num = x => String(x).replace('.', ',');
const neg = entries => entries.map(([v, p]) => [-v, p]);
const pmfEntries = pmf => pmf.map((p, k) => [k, p]);

function goalLines(lh, la) {
  const { diff, tot, btts } = scoreMatrix(lh, la);
  const L = [];
  const add = (id, market, label, s) => L.push({ id, market, label, ...s });
  const p = test => diff.reduce((s, [d, q]) => (test(d) ? s + q : s), 0);
  const home = p(d => d > 0), draw = p(d => d === 0), away = p(d => d < 0);
  add('1', '1X2', 'Casa vence', { pWin: home, pLose: 1 - home });
  add('X', '1X2', 'Empate', { pWin: draw, pLose: 1 - draw });
  add('2', '1X2', 'Fora vence', { pWin: away, pLose: 1 - away });
  for (let h = -3; h <= 3; h += 0.25) {
    add(`ahH${h}`, 'Handicap asiático', `Casa ${fmt(h)}`, settle(diff, h));
    add(`ahA${-h}`, 'Handicap asiático', `Fora ${fmt(-h)}`, settle(neg(diff), -h));
  }
  for (let ln = 0.5; ln <= 5.5; ln += 0.25) {
    add(`gO${ln}`, 'Total de gols', `Mais de ${num(ln)}`, settle(tot, -ln));
    add(`gU${ln}`, 'Total de gols', `Menos de ${num(ln)}`, settle(neg(tot), ln));
  }
  add('bttsY', 'Ambas marcam', 'Sim', { pWin: btts, pLose: 1 - btts });
  add('bttsN', 'Ambas marcam', 'Não', { pWin: 1 - btts, pLose: btts });
  return L;
}

// c = centro das linhas, fixo entre cenários para que todas as linhas existam em todos eles.
function countLines(key, market, prefix, mu, phi, span, c) {
  const e = pmfEntries(dist(mu, phi, Math.ceil(mu * 3 + 25)));
  const L = [];
  for (let d = -span; d < span; d += 0.5) {   // de 0,5 em 0,5: meias-linhas e linhas inteiras
    const ln = c + d + 0.5;
    if (ln < 0.5) continue;
    L.push({ id: `${key}O${ln}`, market, label: `${prefix}Mais de ${num(ln)}`, ...settle(e, -ln) });
    L.push({ id: `${key}U${ln}`, market, label: `${prefix}Menos de ${num(ln)}`, ...settle(neg(e), ln) });
  }
  return L;
}

// Diferença casa − fora de duas contagens (binomiais negativas com a dispersão da diferença medida na liga).
function diffDist(muH, muA, phiD) {
  const max = Math.ceil(Math.max(muH, muA) * 3 + 20);
  const ph = dist(muH, phiD, max), pa = dist(muA, phiD, max), diff = new Map();
  for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) diff.set(i - j, (diff.get(i - j) || 0) + ph[i] * pa[j]);
  return [...diff];
}

// Handicap sobre a diferença, de 0,5 em 0,5. id: `${key}H${h}` (mandante com handicap h) e `${key}A${-h}`.
function handicapLines(key, market, e, span) {
  const L = [];
  for (let h = -span; h <= span; h += 0.5) {
    L.push({ id: `${key}H${h}`, market, label: `Casa ${fmt(h)}`, ...settle(e, h) });
    L.push({ id: `${key}A${-h}`, market, label: `Fora ${fmt(-h)}`, ...settle(neg(e), -h) });
  }
  return L;
}

// Quem tem mais (escanteios): ids `${key}1`, `${key}X`, `${key}2`.
function resultLines(key, market, e, what) {
  const p = test => e.reduce((s, [d, q]) => (test(d) ? s + q : s), 0);
  const h = p(d => d > 0), x = p(d => d === 0), a = p(d => d < 0);
  return [
    { id: `${key}1`, market, label: `Casa com mais ${what}`, pWin: h, pLose: 1 - h },
    { id: `${key}X`, market, label: `Empate em ${what}`, pWin: x, pLose: 1 - x },
    { id: `${key}2`, market, label: `Fora com mais ${what}`, pWin: a, pLose: 1 - a },
  ];
}

// Corrida a N escanteios. Escanteios como sequência no tempo: o total segue a binomial negativa do
// jogo e cada escanteio é do visitante com probabilidade q = μA/(μH+μA). O visitante chega a N primeiro
// quando o seu N-ésimo escanteio é o (N+k)-ésimo do jogo, com k < N do mandante antes dele:
//   P = Σ_{k<N} P(total ≥ N+k) · C(N−1+k, k) · q^N · (1−q)^k.
// "Ninguém chega a N" é o resto (os dois terminam com menos de N). ids: crH{N}, crA{N}, crN{N}.
export function raceLines(muH, muA, phi, Ns = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  const max = Math.ceil((muH + muA) * 3 + 25), pN = dist(muH + muA, phi, max), q = muA / (muH + muA);
  const tail = new Array(max + 2).fill(0);
  for (let n = max; n >= 0; n--) tail[n] = tail[n + 1] + pN[n];
  const first = (N, s) => {
    let p = 0, c = 1;   // c = C(N−1+k, k)
    for (let k = 0; k < N; k++) {
      if (k) c = c * (N - 1 + k) / k;
      p += (tail[N + k] || 0) * c * s ** N * (1 - s) ** k;
    }
    return p;
  };
  const L = [], market = 'Corrida de escanteios';
  for (const N of Ns) {
    const h = first(N, 1 - q), a = first(N, q), none = Math.max(0, 1 - h - a);
    L.push({ id: `crH${N}`, market, label: `Casa chega a ${N} primeiro`, pWin: h, pLose: 1 - h });
    L.push({ id: `crA${N}`, market, label: `Fora chega a ${N} primeiro`, pWin: a, pLose: 1 - a });
    L.push({ id: `crN${N}`, market, label: `Ninguém chega a ${N}`, pWin: none, pLose: 1 - none });
  }
  return L;
}

// Mercados de escanteios precificados pelo modelo ancorado num total da Pinnacle: handicap, quem tem mais,
// corrida (total do jogo) e as linhas do 1º tempo que a Pinnacle não cota (handicap e linhas inteiras do
// total 1T), com o total puxado para o dela.
export const DERIVED = { 'Total escanteios 1T': 'corners1h', 'Handicap de escanteios': 'corners', 'Resultado escanteios': 'corners', 'Corrida de escanteios': 'corners',
  'Handicap escanteios 1T': 'corners1h', 'Resultado escanteios 1T': 'corners1h' };

function buildLines(pred, phi, shift = [0, 0], derived = {}) {
  const sh = (p, k) => ({ h: p.h * Math.exp(shift[0] * pred[k].seH), a: p.a * Math.exp(shift[1] * pred[k].seA) });
  const v = k => sh(pred[k], k);
  let L = [];
  if (pred.goals) { const g = v('goals'); L = goalLines(g.h, g.a); }
  for (const k of ['corners', 'shots', 'sot']) {
    if (!pred[k]) continue;
    const x = v(k), name = METRICS[k].name, c = { t: Math.round(pred[k].h + pred[k].a), h: Math.round(pred[k].h), a: Math.round(pred[k].a) };
    L = L.concat(countLines(k, `Total de ${name.toLowerCase()}`, '', x.h + x.a, phi[k], k === 'shots' ? 5 : 4, c.t));
    if (k === 'corners') {
      L = L.concat(countLines('cH', 'Escanteios por time', 'Casa: ', x.h, phi[k], 3, c.h));
      L = L.concat(countLines('cA', 'Escanteios por time', 'Fora: ', x.a, phi[k], 3, c.a));
      const d = sh(derived.corners || pred.corners, k), e = diffDist(d.h, d.a, phi.cornersDiff || phi[k]);
      L = L.concat(handicapLines('ch', 'Handicap de escanteios', e, 5), resultLines('cx', 'Resultado escanteios', e, 'escanteios'),
        raceLines(d.h, d.a, phi[k]));
    }
  }
  if (pred.corners1h) {
    const x = v('corners1h'), p = pred.corners1h, e = diffDist(x.h, x.a, phi.corners1hDiff);
    L = L.concat(countLines('c1', 'Total escanteios 1T', '', x.h + x.a, phi.corners1h, 3, Math.round(p.h + p.a)));
    L = L.concat(handicapLines('c1h', 'Handicap escanteios 1T', e, 3), resultLines('c1x', 'Resultado escanteios 1T', e, 'escanteios no 1º tempo'));
  }
  return L;
}

// Dispersão residual na liga, dado o que o modelo prevê para cada jogo: do total (variância/média)
// e da diferença casa − fora (variância da diferença / soma das médias).
function residualVMR(f, prep, key) {
  let ns = 0, nd = 0, den = 0;
  for (const m of prep.rows) {
    const o = observe(key, m, prep.xg);
    if (!o) continue;
    const p = predict(f, m.h, m.a), dh = o[0] - p.h, da = o[1] - p.a;
    ns += m.w * (dh + da) ** 2; nd += m.w * (dh - da) ** 2; den += m.w * (p.h + p.a);
  }
  const clip = (x, cap) => Math.min(cap, Math.max(1, x));
  return den ? { sum: clip(ns / den, VMR_CAP[key]), diff: clip(nd / den, 2) } : { sum: 1.15, diff: 1.15 };
}

// Total que a Pinnacle está precificando: a média que reproduz a probabilidade sem margem da
// meia-linha mais equilibrada do mercado de totais (ids `${prefix}O${linha}`).
export function impliedTotal(fair, prefix, phi) {
  const c = [...fair].filter(([id]) => id.startsWith(`${prefix}O`)).map(([id, p]) => [parseFloat(id.slice(prefix.length + 1)), p])
    .filter(([L]) => L % 1 === 0.5).sort((a, b) => Math.abs(a[1] - 0.5) - Math.abs(b[1] - 0.5))[0];
  if (!c) return null;
  let lo = 0.05, hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, pmf = dist(mid, phi, Math.ceil(mid * 3 + 25));
    const over = 1 - pmf.slice(0, Math.floor(c[0]) + 1).reduce((t, x) => t + x, 0);
    if (over < c[1]) lo = mid; else hi = mid;
  }
  return { from_line: c[0], p_over_no_vig: c[1], implied_total: (lo + hi) / 2 };
}

const SCENARIOS = [[1, -1], [-1, 1], [1, 1], [-1, -1]];   // ±1 erro-padrão em cada lado
const ALWAYS = new Set(['1X2', 'Ambas marcam', 'Resultado escanteios', 'Resultado escanteios 1T']);          // mercados exibidos inteiros, qualquer probabilidade

// fair: probabilidades sem margem da Pinnacle (odds.js collect). Quando ela precifica o total de
// escanteios do 1º tempo, o total do modelo é puxado para o dela (peso ANCHOR_W) mantendo a divisão
// entre os times — é daí que sai o handicap do 1º tempo, mercado que a API não traz.
// Superioridade de gols que a Pinnacle precifica (mandante − visitante): a que reproduz P(mandante) −
// P(visitante) sem margem, com o total de gols dela.
export function marketSupremacy(fair, total) {
  if (!fair?.has('1') || !fair.has('2') || !(total > 0)) return null;
  const target = fair.get('1') - fair.get('2');
  const edge = s => scoreMatrix((total + s) / 2, (total - s) / 2).diff.reduce((acc, [d, p]) => acc + (d > 0 ? p : d < 0 ? -p : 0), 0);
  let lo = -total + 0.05, hi = total - 0.05;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (edge(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Redivide uma previsão de contagem entre os times para a diferença d (o total não muda).
const resplit = (p, d) => {
  const T = p.h + p.a, x = Math.max(-(T - 0.4), Math.min(T - 0.4, d));
  return { ...p, h: (T + x) / 2, a: (T - x) / 2 };
};

// share1hBelow: abaixo dessa cobertura de escanteios do 1º tempo, o 1º tempo sai dos escanteios do jogo
// × fração do 1º tempo (a varredura do dia usa 0,5; a análise de um jogo, só quando não há ajuste).
// favor: calibração favoritismo → escanteios da base (favoritism.js, { corners, corners1h }).
export function analyzeMatch(matches, home, away, refTime, { fair = null, share1hBelow = 0, favor = null } = {}) {
  const prep = prepare(matches, refTime);
  const fits = {}, pred = {}, phi = { goals: 1 }, anchors = {};
  for (const k of Object.keys(METRICS)) {
    fits[k] = fit(k, prep);
    pred[k] = fits[k] ? predict(fits[k], home, away) : null;
    if (fits[k] && k !== 'goals') {
      const r = residualVMR(fits[k], prep, k);
      phi[k] = r.sum;
      if (k === 'corners1h') phi.corners1hDiff = r.diff;
      if (k === 'corners') phi.cornersDiff = r.diff;
    }
  }
  // Favoritismo: a superioridade de gols da Pinnacle (do modelo, sem odds) redistribui os escanteios entre
  // os times onde a liga mostrou, fora da amostra, que isso melhora a previsão. O total não muda.
  const gT = fair ? impliedTotal(fair, 'g', 1) : null;
  const supMkt = gT ? marketSupremacy(fair, gT.implied_total) : null;
  const sup = supMkt ?? (pred.goals ? pred.goals.h - pred.goals.a : null);
  const fav = { sup, source: supMkt != null ? 'pinnacle' : 'modelo', applied: false, applied1h: false };
  const lin = (r, dc) => (r?.useful ? r.coef[0] + r.coef[1] * dc + r.coef[2] * sup : null);
  if (favor && sup != null && pred.corners) {
    const dc = pred.corners.h - pred.corners.a, d = lin(favor.corners, dc);
    fav.diff_model = dc;
    if (d != null) { pred.corners = resplit(pred.corners, d); fav.diff = pred.corners.h - pred.corners.a; fav.applied = true; }
    fav.diff1h = lin(favor.corners1h, dc);
  }
  if (pred.corners && (!pred.corners1h || prep.coverage1h < share1hBelow)) {
    let c1 = 0, c = 0, n = 0;
    for (const m of prep.rows) if (m.c1 && m.s) { c1 += m.c1[0] + m.c1[1]; c += m.s[4] + m.s[9]; n++; }
    const share = n >= 30 && c ? c1 / c : SHARE_1H;
    pred.corners1h = { ...pred.corners, h: pred.corners.h * share, a: pred.corners.a * share };
    phi.corners1h = phi.corners; phi.corners1hDiff = phi.cornersDiff;
    anchors.corners1hShare = { share, from_games: n };
  }
  if (pred.corners1h && fair) {
    const imp = impliedTotal(fair, 'c1', phi.corners1h), p = pred.corners1h, model = p.h + p.a;
    if (imp) {
      const f = (imp.implied_total / model) ** ANCHOR_W;
      pred.corners1h = { ...p, h: p.h * f, a: p.a * f };
      anchors.corners1h = { model_total: model, pinnacle_total: imp.implied_total, from_line: imp.from_line, factor: f };
    }
  }
  // 1º tempo com relação própria na liga: a diferença dela (o 1º tempo da fração já herdou a do jogo)
  if (fav.diff1h != null && pred.corners1h) {
    fav.diff1h_model = pred.corners1h.h - pred.corners1h.a;
    pred.corners1h = resplit(pred.corners1h, fav.diff1h);
    fav.applied1h = true;
  } else if (fav.applied && anchors.corners1hShare) fav.applied1h = true;
  // Total de escanteios do jogo: as linhas de total seguem com o modelo puro (misturado com a Pinnacle no
  // dossiê); só os mercados derivados (handicap, quem tem mais, corrida) usam o total ancorado.
  const derived = {};
  if (pred.corners && fair) {
    const imp = impliedTotal(fair, 'corners', phi.corners), p = pred.corners, model = p.h + p.a;
    if (imp) {
      const f = (imp.implied_total / model) ** ANCHOR_W;
      derived.corners = { ...p, h: p.h * f, a: p.a * f };
      anchors.corners = { model_total: model, pinnacle_total: imp.implied_total, from_line: imp.from_line, factor: f };
    }
  }
  if (!pred.goals) return { prep, fits, pred, phi, anchors, favor: fav, lines: [], all: [] };
  const base = buildLines(pred, phi, [0, 0], derived);
  const alt = SCENARIOS.map(s => new Map(buildLines(pred, phi, s, derived).map(l => [l.id, l])));
  // all: toda linha calculada (para a análise de uma linha pedida); lines: as exibidas nas tabelas
  const all = base.map(l => ({ ...l, sc: alt.map(m => m.get(l.id)) })).filter(l => l.sc.every(Boolean));
  const lines = all.filter(l => ALWAYS.has(l.market) || (l.pWin >= 0.15 && l.pWin <= 0.85 && l.pWin + l.pLose > 0.3));
  return { prep, fits, pred, phi, anchors, favor: fav, lines, all };
}

export const fairOdd = l => 1 + l.pLose / l.pWin;
const evOf = (l, odd) => l.pWin * (odd - 1) - l.pLose;

// EV central e no pior cenário (−1 erro-padrão contra a aposta).
export function ev(line, odd) {
  return { mid: evOf(line, odd), low: Math.min(...line.sc.map(s => evOf(s, odd))) };
}

// Política E: fração da entrada pela faixa de odd.
export function politicaE(odd) {
  if (odd < 2.1) return { label: 'cheia', factor: 1 };
  if (odd <= 2.5) return { label: 'meia', factor: 0.5 };
  if (odd <= 3) return { label: 'quarto', factor: 0.25 };
  return { label: 'não entrar', factor: 0 };
}
