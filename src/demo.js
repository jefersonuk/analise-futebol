// Modo demonstração (chave "demo"): uma liga sintética de 20 times, sem gastar requisições.

import { dist, scoreMatrix, settle } from './model.js';

const NAMES = ['Aurora', 'Boreal', 'Cometa', 'Dínamo', 'Estrela', 'Fênix', 'Galáxia', 'Horizonte', 'Íris', 'Júpiter',
  'Kosmos', 'Lunar', 'Meteoro', 'Nebulosa', 'Órion', 'Pulsar', 'Quasar', 'Radiante', 'Solar', 'Titã'];
const TEAMS = NAMES.map((n, i) => ({ id: 9001 + i, name: `${n} FC`, country: 'Demo' }));
const LEAGUE = { id: 1, name: 'Liga Demo', country: 'Demo' };
const DAY = 864e5, WEEK = 7 * DAY;

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function pois(r, mu) { const l = Math.exp(-mu); let k = 0, p = r(); while (p > l) { k++; p *= r(); } return k; }

// forças latentes fixas por time
const LAT = TEAMS.map(t => { const r = rng(t.id * 7919); return { att: 0.7 + r() * 0.7, def: 0.7 + r() * 0.7, cor: 0.8 + r() * 0.5 }; });

// Calendário de pontos corridos: 38 rodadas, uma por semana a partir de abril.
function schedule(season) {
  const n = TEAMS.length, ids = TEAMS.map((_, i) => i), games = [];
  for (let round = 0; round < 2 * (n - 1); round++) {
    const rot = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + round) % (n - 1))])];
    for (let k = 0; k < n / 2; k++) {
      let [h, a] = [rot[k], rot[n - 1 - k]];
      if ((round + k) % 2) [h, a] = [a, h];
      if (round >= n - 1) [h, a] = [a, h];
      games.push({ h, a, t: Date.UTC(season, 3, 5) + round * WEEK, id: season * 1000 + round * 10 + k });
    }
  }
  return games;
}

function play(g) {
  const r = rng(g.id), H = LAT[g.h], A = LAT[g.a];
  const side = (x, y, adv) => {
    const tot = pois(r, 12.5 * x.att * y.def * adv), inside = Math.round(tot * (0.55 + r() * 0.15));
    return { tot, inside, out: tot - inside, sot: Math.round(tot * (0.3 + r() * 0.1)), cor: pois(r, 5 * x.cor * adv),
      goals: pois(r, 0.11 * inside + 0.03 * (tot - inside)) };
  };
  const h = side(H, A, 1.1), a = side(A, H, 0.9);
  return {
    id: g.id, t: g.t, h: TEAMS[g.h].id, a: TEAMS[g.a].id, hn: TEAMS[g.h].name, an: TEAMS[g.a].name,
    hg: h.goals, ag: a.goals,
    s: [h.inside, h.out, h.sot, h.tot, h.cor, a.inside, a.out, a.sot, a.tot, a.cor],
    c1: [Math.round(h.cor * (0.38 + r() * 0.16)), Math.round(a.cor * (0.38 + r() * 0.16))],
  };
}

export function searchTeams(q) {
  const hit = TEAMS.filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
  return hit.length ? hit : TEAMS.slice(0, 5);
}

const SEASON = () => new Date().getUTCFullYear();
const idxOf = teamId => TEAMS.findIndex(t => t.id === teamId);
const out = (g, season) => ({
  id: g.id, t: g.t, league: { ...LEAGUE, season },
  home: { id: TEAMS[g.h].id, name: TEAMS[g.h].name }, away: { id: TEAMS[g.a].id, name: TEAMS[g.a].name },
});

export function upcoming(teamId) {
  const season = SEASON(), idx = idxOf(teamId);
  let next = schedule(season).filter(g => (g.h === idx || g.a === idx) && g.t > Date.now()).slice(0, 5);
  if (!next.length) next = [{ h: idx, a: (idx + 1) % TEAMS.length, t: Date.now() + DAY, id: 0 }];
  return next.map(g => out(g, season));
}

export function lastPlayed(teamId) {
  const idx = idxOf(teamId), past = schedule(SEASON()).filter(g => (g.h === idx || g.a === idx) && g.t < Date.now());
  return past.length ? out(past[past.length - 1], SEASON()) : null;
}

export const leaguesOf = () => [LEAGUE];
export const leagueMatches = (leagueId, season) => schedule(season).filter(g => g.t < Date.now()).map(play);
export const injuries = () => [];
export const attachHalfCorners = (leagueId, season, matches) => matches;

export function standings(leagueId, season) {
  const tab = new Map(TEAMS.map(t => [t.id, { team: t.id, points: 0, played: 0, gd: 0 }]));
  for (const m of leagueMatches(leagueId, season)) {
    const h = tab.get(m.h), a = tab.get(m.a);
    h.played++; a.played++; h.gd += m.hg - m.ag; a.gd += m.ag - m.hg;
    if (m.hg > m.ag) h.points += 3; else if (m.hg < m.ag) a.points += 3; else { h.points++; a.points++; }
  }
  return [...tab.values()].sort((x, y) => y.points - x.points || y.gd - x.gd)
    .map((s, i) => ({ ...s, rank: i + 1, form: null, group: LEAGUE.name, zone: i < 4 ? 'Libertadores' : i >= 16 ? 'Rebaixamento' : null }));
}

// "Pinnacle" da demo: precifica pelas forças verdadeiras (que o modelo não vê), com 2,5% de margem.
export function fixtureOdds(fixtureId) {
  const g = schedule(Math.floor(fixtureId / 1000)).find(x => x.id === fixtureId);
  if (!g) return { updatedAt: null, fetchedAt: Date.now(), bookmakers: [] };
  const H = LAT[g.h], A = LAT[g.a];
  const { diff, tot } = scoreMatrix(1.1 * H.att * A.def, 0.9 * A.att * H.def, 0);
  const odd = p => (1 / (p * 1.025)).toFixed(2);
  const neg = e => e.map(([v, p]) => [-v, p]);
  const eff = s => s.pWin / (s.pWin + s.pLose);
  const pd = t => diff.reduce((s, [d, p]) => (t(d) ? s + p : s), 0);
  const bets = [{ id: 1, values: [['Home', pd(d => d > 0)], ['Draw', pd(d => d === 0)], ['Away', pd(d => d < 0)]].map(([value, p]) => ({ value, odd: odd(p) })) }];
  const ah = [], ou = [], co = [];
  for (let h = -1.5; h <= 1.5; h += 0.25)
    ah.push({ value: `Home ${h}`, odd: odd(eff(settle(diff, h))) }, { value: `Away ${h}`, odd: odd(eff(settle(neg(diff), -h))) });
  for (const L of [1.5, 2.5, 3.5]) ou.push({ value: `Over ${L}`, odd: odd(eff(settle(tot, -L))) }, { value: `Under ${L}`, odd: odd(eff(settle(neg(tot), L))) });
  const muC = 5 * 1.1 * H.cor + 5 * 0.9 * A.cor, pc = dist(muC, 1, 60).map((p, k) => [k, p]);
  for (let L = Math.round(muC) - 1.5; L <= Math.round(muC) + 1.5; L++)
    co.push({ value: `Over ${L}`, odd: odd(eff(settle(pc, -L))) }, { value: `Under ${L}`, odd: odd(eff(settle(neg(pc), L))) });
  const c1 = [], pc1 = dist(0.46 * muC, 1, 40).map((p, k) => [k, p]);
  for (const L of [3.5, 4.5, 5.5]) c1.push({ value: `Over ${L}`, odd: odd(eff(settle(pc1, -L))) }, { value: `Under ${L}`, odd: odd(eff(settle(neg(pc1), L))) });
  bets.push({ id: 4, values: ah }, { id: 5, values: ou }, { id: 45, values: co }, { id: 77, values: c1 });
  return { updatedAt: new Date(Date.now() - 40 * 60e3).toISOString(), fetchedAt: Date.now(), bookmakers: [{ id: 4, name: 'Pinnacle', bets }] };
}
