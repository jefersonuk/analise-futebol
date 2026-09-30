// Modo demonstração (chave "demo"): uma liga sintética de 20 times, sem gastar requisições.

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
  };
}

export function searchTeams(q) {
  const hit = TEAMS.filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
  return hit.length ? hit : TEAMS.slice(0, 5);
}

export function upcoming(teamId) {
  const season = new Date().getUTCFullYear();
  const idx = TEAMS.findIndex(t => t.id === teamId);
  let next = schedule(season).filter(g => (g.h === idx || g.a === idx) && g.t > Date.now()).slice(0, 5);
  if (!next.length) next = [{ h: idx, a: (idx + 1) % TEAMS.length, t: Date.now() + DAY, id: 0 }];
  return next.map(g => ({
    id: g.id, t: g.t, league: { ...LEAGUE, season },
    home: { id: TEAMS[g.h].id, name: TEAMS[g.h].name }, away: { id: TEAMS[g.a].id, name: TEAMS[g.a].name },
  }));
}

export const leaguesOf = () => [LEAGUE];
export const leagueMatches = season => schedule(season).filter(g => g.t < Date.now()).map(play);
