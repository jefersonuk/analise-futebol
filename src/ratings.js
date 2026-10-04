// Forças de ataque e defesa ajustadas pelo adversário (ponto fixo de Maher/Dixon-Coles),
// com decaimento temporal, mando por liga e shrinkage por pseudo-jogos.
//
// Jogo compacto: { id, t, h, a, hg, ag, hh, ha, s, c1 }
//   hh, ha = placar do 1º tempo (null/ausente quando a API não tem)
//   s  = null (sem estatística) ou [dentroH, foraH, noGolH, totalH, escH, dentroA, foraA, noGolA, totalA, escA]
//   c1 = escanteios do 1º tempo [mandante, visitante], ou null/ausente (a API só tem a partir de 2024)

export const XI = 0.0018;                  // decaimento por dia (meia-vida ≈ 385 dias)
const DAY = 864e5;
export const XG_IN = 0.13, XG_OUT = 0.03;  // gols por chute dentro / fora da área (recalibrado por liga)
export const BLEND = 0.7;                  // ataque = 70% xG-proxy + 30% gols

export const METRICS = {
  goals:   { name: 'Gols',          K: 10 },
  shots:   { name: 'Chutes',        K: 6, idx: 3 },
  sot:     { name: 'Chutes no gol', K: 6, idx: 2 },
  corners: { name: 'Escanteios',    K: 6, idx: 4 },
  corners1h: { name: 'Escanteios 1º tempo', K: 6 },
  goals1h: { name: 'Gols 1º tempo', K: 10 },
};

const stat = (s, home, i) => s[(home ? 0 : 5) + i];
export const xgRaw = (s, home) => XG_IN * stat(s, home, 0) + XG_OUT * stat(s, home, 1);

// Jogos anteriores à data de referência, com peso temporal e xG-proxy calibrado para a liga.
export function prepare(matches, refTime) {
  const past = matches.filter(m => m.t < refTime && m.hg != null);
  let g = 0, x = 0;
  for (const m of past) if (m.s) { g += m.hg + m.ag; x += xgRaw(m.s, true) + xgRaw(m.s, false); }
  const scale = x > 0 ? g / x : 1;
  // wm: peso extra do jogo (amistoso de seleção pesa menos)
  const rows = past.map(m => ({ ...m, w: Math.exp(-XI * (refTime - m.t) / DAY) * (m.wm ?? 1) }));
  const xg = (m, home) => (m.s ? scale * xgRaw(m.s, home) : null);
  const share = f => (past.length ? past.filter(f).length / past.length : 0);
  return { rows, scale, xg, coverage: share(m => m.s), coverage1h: share(m => m.c1) };
}

// Valor observado [casa, fora] de uma métrica num jogo, ou null se não houver dado.
export function observe(key, m, xg) {
  if (key === 'corners1h') return m.c1 || null;
  if (key === 'goals1h') return m.hh != null && m.ha != null ? [m.hh, m.ha] : null;   // placar real (sem xG por tempo)
  if (key === 'goals') {
    if (!m.s) return [m.hg, m.ag];
    return [BLEND * xg(m, true) + (1 - BLEND) * m.hg, BLEND * xg(m, false) + (1 - BLEND) * m.ag];
  }
  return m.s ? [m.s[METRICS[key].idx], m.s[5 + METRICS[key].idx]] : null;
}

export function fit(key, prep, iters = 40) {
  const K = METRICS[key].K;
  const obs = [];
  for (const m of prep.rows) {
    const o = observe(key, m, prep.xg);
    if (o) obs.push({ h: m.h, a: m.a, oh: o[0], oa: o[1], w: m.w });
  }
  if (obs.length < 20) return null;

  const teams = new Set(obs.flatMap(o => [o.h, o.a]));
  const att = new Map(), def = new Map(), games = new Map();
  for (const t of teams) { att.set(t, 1); def.set(t, 1); games.set(t, 0); }
  let sw = 0, sh = 0, sa = 0;
  for (const o of obs) {
    sw += o.w; sh += o.w * o.oh; sa += o.w * o.oa;
    games.set(o.h, games.get(o.h) + o.w); games.set(o.a, games.get(o.a) + o.w);
  }
  let bH = sh / sw, bA = sa / sw;
  const avgH = bH, avgA = bA;

  // gap[t]: mando próprio do time além do mando da liga (altitude, viagem, estádio).
  // Em casa ele produz ×gap e cede ÷gap; fora, o inverso. att/def ficam neutros de mando.
  const gap = new Map([...teams].map(t => [t, 1]));
  const g = t => gap.get(t);
  const eH = o => bH * att.get(o.h) * def.get(o.a) * g(o.h) * g(o.a);
  const eA = o => bA * att.get(o.a) * def.get(o.h) / (g(o.h) * g(o.a));
  const acc = () => new Map([...teams].map(t => [t, [0, 0]]));

  let fA, fD, fG;
  for (let it = 0; it < iters; it++) {
    const b = (bH + bA) / 2;
    fA = acc();
    for (const o of obs) {
      const x = fA.get(o.h), y = fA.get(o.a);
      x[0] += o.w * o.oh; x[1] += o.w * eH(o) / att.get(o.h);
      y[0] += o.w * o.oa; y[1] += o.w * eA(o) / att.get(o.a);
    }
    for (const [t, [n, d]] of fA) att.set(t, (n + K * b) / (d + K * b));

    fD = acc();
    for (const o of obs) {
      const x = fD.get(o.h), y = fD.get(o.a);
      x[0] += o.w * o.oa; x[1] += o.w * eA(o) / def.get(o.h);
      y[0] += o.w * o.oh; y[1] += o.w * eH(o) / def.get(o.a);
    }
    for (const [t, [n, d]] of fD) def.set(t, (n + K * b) / (d + K * b));

    // termos em que gap[t] multiplica (+) ou divide (−) a expectativa: [N+, E+, N−, E−]
    fG = new Map([...teams].map(t => [t, [0, 0, 0, 0]]));
    for (const o of obs) {
      const h = eH(o), a = eA(o);
      for (const t of [o.h, o.a]) {
        const s = fG.get(t);
        s[0] += o.w * o.oh; s[1] += o.w * h;   // gols do mandante: ×gap de ambos
        s[2] += o.w * o.oa; s[3] += o.w * a;   // gols do visitante: ÷gap de ambos
      }
    }
    const kg = K_GAP * b;
    for (const [t, [np, ep, nm, em]] of fG) {
      const cur = g(t);
      gap.set(t, Math.sqrt(((np + kg) / (ep / cur + kg)) * ((em * cur + kg) / (nm + kg))));
    }

    let nh = 0, dh = 0, na = 0, da = 0;
    for (const o of obs) {
      nh += o.w * o.oh; dh += o.w * eH(o) / bH;
      na += o.w * o.oa; da += o.w * eA(o) / bA;
    }
    bH = nh / dh; bA = na / da;

    // normaliza (att, def: média 1; gap: média geométrica 1) e devolve a escala às bases
    const ma = mean(att), md = mean(def);
    const mg = Math.exp([...gap.values()].reduce((s, v) => s + Math.log(v), 0) / gap.size);
    for (const t of teams) { att.set(t, att.get(t) / ma); def.set(t, def.get(t) / md); gap.set(t, gap.get(t) / mg); }
    bH *= ma * md * mg * mg; bA *= ma * md / (mg * mg);   // cada expectativa leva o gap dos dois times
  }
  const b = (bH + bA) / 2;
  // erro-padrão aproximado do log da força: 1/√(volume observado + pseudo-jogos)
  const seAtt = new Map([...fA].map(([t, [n]]) => [t, 1 / Math.sqrt(n + K * b)]));
  const seDef = new Map([...fD].map(([t, [n]]) => [t, 1 / Math.sqrt(n + K * b)]));
  const seGap = new Map([...fG].map(([t, [np, , nm]]) => [t, 1 / Math.sqrt((np + nm) / 2 + K_GAP * b)]));
  return { key, att, def, gap, bH, bA, home: bH / bA, avgH, avgA, games, seAtt, seDef, seGap, teams };
}

const K_GAP = 20;   // encolhimento forte: mando próprio só aparece com muitos jogos consistentes
const mean = m => [...m.values()].reduce((s, v) => s + v, 0) / m.size;

// Expectativa do confronto. Time sem jogos na liga entra como médio, com incerteza alta.
export function predict(f, home, away) {
  const a = (map, t, dflt) => (map.has(t) ? map.get(t) : dflt);
  const gg = a(f.gap, home, 1) * a(f.gap, away, 1);
  const seG = Math.hypot(a(f.seGap, home, 0.3), a(f.seGap, away, 0.3));
  return {
    h: f.bH * a(f.att, home, 1) * a(f.def, away, 1) * gg,
    a: f.bA * a(f.att, away, 1) * a(f.def, home, 1) / gg,
    seH: Math.hypot(a(f.seAtt, home, 0.5), a(f.seDef, away, 0.5), seG),
    seA: Math.hypot(a(f.seAtt, away, 0.5), a(f.seDef, home, 0.5), seG),
    known: f.teams.has(home) && f.teams.has(away),
  };
}

// Posição de um time no ranking da liga (1 = melhor). Defesa: menor é melhor.
export function rank(f, team, which) {
  const map = which === 'att' ? f.att : f.def;
  if (!map.has(team)) return null;
  const v = map.get(team);
  const better = [...map.values()].filter(x => (which === 'att' ? x > v : x < v)).length;
  return { pos: better + 1, of: map.size, value: v };
}
