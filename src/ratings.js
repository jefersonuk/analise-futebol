// Forças de ataque e defesa ajustadas pelo adversário (ponto fixo de Maher/Dixon-Coles),
// com decaimento temporal, mando por liga e shrinkage por pseudo-jogos.
//
// Jogo compacto: { id, t, h, a, hg, ag, s }
//   s = null (sem estatística) ou [dentroH, foraH, noGolH, totalH, escH, dentroA, foraA, noGolA, totalA, escA]

export const XI = 0.0018;                  // decaimento por dia (meia-vida ≈ 385 dias)
const DAY = 864e5;
export const XG_IN = 0.13, XG_OUT = 0.03;  // gols por chute dentro / fora da área (recalibrado por liga)
export const BLEND = 0.7;                  // ataque = 70% xG-proxy + 30% gols

export const METRICS = {
  goals:   { name: 'Gols',          K: 10 },
  shots:   { name: 'Chutes',        K: 6, idx: 3 },
  sot:     { name: 'Chutes no gol', K: 6, idx: 2 },
  corners: { name: 'Escanteios',    K: 6, idx: 4 },
};

const stat = (s, home, i) => s[(home ? 0 : 5) + i];
export const xgRaw = (s, home) => XG_IN * stat(s, home, 0) + XG_OUT * stat(s, home, 1);

// Jogos anteriores à data de referência, com peso temporal e xG-proxy calibrado para a liga.
export function prepare(matches, refTime) {
  const past = matches.filter(m => m.t < refTime && m.hg != null);
  let g = 0, x = 0;
  for (const m of past) if (m.s) { g += m.hg + m.ag; x += xgRaw(m.s, true) + xgRaw(m.s, false); }
  const scale = x > 0 ? g / x : 1;
  const rows = past.map(m => ({ ...m, w: Math.exp(-XI * (refTime - m.t) / DAY) }));
  const xg = (m, home) => (m.s ? scale * xgRaw(m.s, home) : null);
  return { rows, scale, xg, coverage: past.length ? past.filter(m => m.s).length / past.length : 0 };
}

// Valor observado [casa, fora] de uma métrica num jogo, ou null se não houver dado.
function observe(key, m, xg) {
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

  const acc = () => new Map([...teams].map(t => [t, [0, 0]]));
  let fA, fD;
  for (let it = 0; it < iters; it++) {
    const b = (bH + bA) / 2;
    fA = acc();
    for (const o of obs) {
      const eh = fA.get(o.h), ea = fA.get(o.a);
      eh[0] += o.w * o.oh; eh[1] += o.w * bH * def.get(o.a);
      ea[0] += o.w * o.oa; ea[1] += o.w * bA * def.get(o.h);
    }
    for (const [t, [n, d]] of fA) att.set(t, (n + K * b) / (d + K * b));

    fD = acc();
    for (const o of obs) {
      const dh = fD.get(o.h), da = fD.get(o.a);
      dh[0] += o.w * o.oa; dh[1] += o.w * bA * att.get(o.a);
      da[0] += o.w * o.oh; da[1] += o.w * bH * att.get(o.h);
    }
    for (const [t, [n, d]] of fD) def.set(t, (n + K * b) / (d + K * b));

    let nh = 0, dh = 0, na = 0, da = 0;
    for (const o of obs) {
      nh += o.w * o.oh; dh += o.w * att.get(o.h) * def.get(o.a);
      na += o.w * o.oa; da += o.w * att.get(o.a) * def.get(o.h);
    }
    bH = nh / dh; bA = na / da;

    // normaliza médias em 1 e devolve a escala às bases
    const ma = mean(att), md = mean(def);
    for (const t of teams) { att.set(t, att.get(t) / ma); def.set(t, def.get(t) / md); }
    bH *= ma * md; bA *= ma * md;
  }
  const b = (bH + bA) / 2;
  // erro-padrão aproximado do log da força: 1/√(volume observado + pseudo-jogos)
  const seAtt = new Map([...fA].map(([t, [n]]) => [t, 1 / Math.sqrt(n + K * b)]));
  const seDef = new Map([...fD].map(([t, [n]]) => [t, 1 / Math.sqrt(n + K * b)]));
  return { key, att, def, bH, bA, home: bH / bA, avgH, avgA, games, seAtt, seDef, teams };
}

const mean = m => [...m.values()].reduce((s, v) => s + v, 0) / m.size;

// Expectativa do confronto. Time sem jogos na liga entra como médio, com incerteza alta.
export function predict(f, home, away) {
  const a = (map, t, dflt) => (map.has(t) ? map.get(t) : dflt);
  return {
    h: f.bH * a(f.att, home, 1) * a(f.def, away, 1),
    a: f.bA * a(f.att, away, 1) * a(f.def, home, 1),
    seH: Math.hypot(a(f.seAtt, home, 0.5), a(f.seDef, away, 0.5)),
    seA: Math.hypot(a(f.seAtt, away, 0.5), a(f.seDef, home, 0.5)),
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
