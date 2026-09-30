// Modelo estatístico: médias ponderadas por mando -> expectativa do confronto -> probabilidade de cada linha.

export const MARKETS = { goals: 'Gols', corners: 'Escanteios', shots: 'Chutes', sot: 'Chutes no gol' };
const KEYS = Object.keys(MARKETS);
const VENUE_WEIGHT = 2;   // jogo no mesmo mando do confronto pesa o dobro
const MIN_GAMES = 3;

function wstats(vals) {
  const sw = vals.reduce((s, x) => s + x.w, 0);
  if (vals.length < MIN_GAMES) return null;
  const mean = vals.reduce((s, x) => s + x.v * x.w, 0) / sw;
  const varr = vals.reduce((s, x) => s + x.w * (x.v - mean) ** 2, 0) / sw;
  const nEff = sw * sw / vals.reduce((s, x) => s + x.w * x.w, 0);
  return { mean, se: Math.sqrt(varr / Math.max(nEff - 1, 1)), n: vals.length };
}

// Médias a favor (f) e contra (a) de um time, por métrica.
export function teamRates(games, atHome) {
  const out = {};
  for (const k of KEYS) {
    const rows = games.filter(g => g[k]);
    const w = g => (g.home === atHome ? VENUE_WEIGHT : 1);
    out[k] = {
      f: wstats(rows.map(g => ({ v: g[k].f, w: w(g) }))),
      a: wstats(rows.map(g => ({ v: g[k].a, w: w(g) }))),
    };
  }
  return out;
}

// Expectativa do confronto: média entre o que um produz e o que o outro cede.
function expectation(H, A, k) {
  if (!H[k].f || !H[k].a || !A[k].f || !A[k].a) return null;
  return {
    h: (H[k].f.mean + A[k].a.mean) / 2,
    a: (A[k].f.mean + H[k].a.mean) / 2,
    seH: Math.hypot(H[k].f.se, A[k].a.se) / 2,
    seA: Math.hypot(A[k].f.se, H[k].a.se) / 2,
    n: Math.min(H[k].f.n, A[k].f.n),
  };
}

// Razão variância/média do total por jogo (1 = Poisson), limitada a [1, 2.5].
export function dispersion(games, k) {
  const t = games.filter(g => g[k]).map(g => g[k].f + g[k].a);
  if (t.length < MIN_GAMES) return 1;
  const m = t.reduce((s, v) => s + v, 0) / t.length;
  const v = t.reduce((s, x) => s + (x - m) ** 2, 0) / (t.length - 1);
  return m > 0 ? Math.min(2.5, Math.max(1, v / m)) : 1;
}

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

const sum = (arr, test) => arr.reduce((s, p, k) => (test(k) ? s + p : s), 0);
const sign = h => (h > 0 ? '+' : '') + h;

function goalLines(lh, la) {
  const ph = dist(lh, 1, 12), pa = dist(la, 1, 12);
  const diff = new Map(), tot = new Array(25).fill(0);
  let btts = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
    const p = ph[i] * pa[j];
    diff.set(i - j, (diff.get(i - j) || 0) + p);
    tot[i + j] += p;
    if (i && j) btts += p;
  }
  const pd = test => [...diff].reduce((s, [d, p]) => (test(d) ? s + p : s), 0);
  const L = [];
  const add = (id, market, label, pWin, pLose) => L.push({ id, market, label, pWin, pLose });
  const home = pd(d => d > 0), draw = pd(d => d === 0), away = pd(d => d < 0);
  add('1', '1X2', 'Casa vence', home, 1 - home);
  add('X', '1X2', 'Empate', draw, 1 - draw);
  add('2', '1X2', 'Fora vence', away, 1 - away);
  for (let h = -2.5; h <= 2.5; h += 0.5) {
    const w = pd(d => d + h > 0), l = pd(d => d + h < 0);
    add(`ahH${h}`, 'Handicap', `Casa ${sign(h)}`, w, l);
    add(`ahA${h}`, 'Handicap', `Fora ${sign(-h)}`, l, w);
  }
  for (let ln = 0.5; ln <= 5.5; ln++) {
    const o = sum(tot, k => k > ln);
    add(`gO${ln}`, 'Gols', `Mais de ${ln}`, o, 1 - o);
    add(`gU${ln}`, 'Gols', `Menos de ${ln}`, 1 - o, o);
  }
  add('bttsY', 'Ambas marcam', 'Sim', btts, 1 - btts);
  add('bttsN', 'Ambas marcam', 'Não', 1 - btts, btts);
  return L;
}

function totalLines(k, mu, phi, center, span) {
  const pmf = dist(mu, phi, Math.ceil(mu * 3 + 20));
  const L = [];
  for (let d = -span; d < span; d++) {
    const ln = center + d + 0.5;
    if (ln < 0.5) continue;
    const u = sum(pmf, x => x < ln);
    L.push({ id: `${k}O${ln}`, market: MARKETS[k], label: `Mais de ${ln}`, pWin: 1 - u, pLose: u });
    L.push({ id: `${k}U${ln}`, market: MARKETS[k], label: `Menos de ${ln}`, pWin: u, pLose: 1 - u });
  }
  return L;
}

function buildLines(exp, phi, centers, shift = [0, 0]) {
  const v = k => ({
    h: Math.max(0.05, exp[k].h + shift[0] * exp[k].seH),
    a: Math.max(0.05, exp[k].a + shift[1] * exp[k].seA),
  });
  let L = [];
  if (exp.goals) { const g = v('goals'); L = goalLines(g.h, g.a); }
  for (const k of ['corners', 'shots', 'sot']) {
    if (!exp[k]) continue;
    const x = v(k);
    L = L.concat(totalLines(k, x.h + x.a, phi[k], centers[k], k === 'shots' ? 5 : 4));
  }
  return L;
}

const SCENARIOS = [[1, -1], [-1, 1], [1, 1], [-1, -1]];   // ±1 erro-padrão em cada lado

export function analyze(homeGames, awayGames) {
  const H = teamRates(homeGames, true), A = teamRates(awayGames, false);
  const all = homeGames.concat(awayGames);
  const exp = {}, phi = {}, centers = {};
  for (const k of KEYS) {
    exp[k] = expectation(H, A, k);
    phi[k] = k === 'goals' ? 1 : dispersion(all, k);
    if (exp[k]) centers[k] = Math.round(exp[k].h + exp[k].a);
  }
  const base = buildLines(exp, phi, centers);
  const alt = SCENARIOS.map(s => new Map(buildLines(exp, phi, centers, s).map(l => [l.id, l])));
  const lines = base
    .map(l => ({ ...l, sc: alt.map(m => m.get(l.id)) }))
    .filter(l => l.pWin >= 0.2 && l.pWin <= 0.8);
  return { exp, phi, lines };
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
