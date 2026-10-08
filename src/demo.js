// Modo demonstração (chave "demo"): uma liga sintética de 20 times, sem gastar requisições.

import { diffDist, dist, scoreMatrix, settle } from './model.js';

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
  const c1 = [Math.round(h.cor * (0.38 + r() * 0.16)), Math.round(a.cor * (0.38 + r() * 0.16))];
  const firstHalf = n => Array.from({ length: n }, () => r() < 0.45).filter(Boolean).length;   // cada gol no 1º tempo com 45%
  return {
    id: g.id, t: g.t, h: TEAMS[g.h].id, a: TEAMS[g.a].id, hn: TEAMS[g.h].name, an: TEAMS[g.a].name,
    hg: h.goals, ag: a.goals, hh: firstHalf(h.goals), ha: firstHalf(a.goals),
    s: [h.inside, h.out, h.sot, h.tot, h.cor, a.inside, a.out, a.sot, a.tot, a.cor], c1,
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
export const attachHalfCorners = (scope, season, matches) => matches;
export const hasLeague = () => true;
// Jogos do dia na demo: a próxima rodada inteira que ainda não está para começar (a varredura ignora jogo
// que começa em menos de 10 minutos; sem a folga, a demo ficaria vazia nesses minutos da semana).
const nextRound = () => { const f = schedule(SEASON()).filter(g => g.t > Date.now() + 15 * 60e3); return f.filter(g => g.t === f[0]?.t); };
export const dayFixtures = () => nextRound().map(g => out(g, SEASON()));
export const dayOdds = () => nextRound().map(g => { const o = fixtureOdds(g.id);
  return { fixture: g.id, league: { ...LEAGUE, season: SEASON() }, updatedAt: o.updatedAt, bookmakers: o.bookmakers }; });
export const teamMatches = (teamId, season) => leagueMatches(1, season).filter(m => m.h === teamId || m.a === teamId);
// Confrontos diretos: os jogos entre os dois nas duas últimas temporadas, sem estatística (como a API).
export const headToHead = (a, b) => [SEASON(), SEASON() - 1].flatMap(s => leagueMatches(1, s))
  .filter(m => (m.h === a && m.a === b) || (m.h === b && m.a === a)).sort((x, y) => y.t - x.t).slice(0, 10)
  .map(({ s, c1, ...m }) => ({ ...m, lg: LEAGUE.id, ln: LEAGUE.name }));

export function standings(leagueId, season) {
  const split = () => ({ played: 0, gf: 0, ga: 0 });
  const tab = new Map(TEAMS.map(t => [t.id, { team: t.id, name: t.name, points: 0, played: 0, gd: 0, gf: 0, ga: 0, home: split(), away: split() }]));
  for (const m of leagueMatches(leagueId, season)) {
    const h = tab.get(m.h), a = tab.get(m.a);
    h.played++; a.played++; h.gd += m.hg - m.ag; a.gd += m.ag - m.hg;
    h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
    h.home.played++; h.home.gf += m.hg; h.home.ga += m.ag; a.away.played++; a.away.gf += m.ag; a.away.ga += m.hg;
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
  const ouOf = (pmf, lines) => lines.flatMap(L => [{ value: `Over ${L}`, odd: odd(eff(settle(pmf, -L))) }, { value: `Under ${L}`, odd: odd(eff(settle(neg(pmf), L))) }]);
  const rc = Math.round(muC);
  co.push(...ouOf(pc, [...new Set([8, 8.5, 9, rc - 1.5, rc - 0.5, rc + 0.5, rc + 1.5])]));
  const c1 = ouOf(dist(0.46 * muC, 1, 40).map((p, k) => [k, p]), [3.5, 4, 4.5, 5, 5.5]);
  const { tot: tot1 } = scoreMatrix(0.45 * 1.1 * H.att * A.def, 0.45 * 0.9 * A.att * H.def, 0);   // gols do 1º tempo: 45% dos do jogo
  const de = diffDist(5 * 1.1 * H.cor, 5 * 0.9 * A.cor, 1);   // handicap de escanteios (rótulo da API: número do mandante nas duas pernas)
  const ch = [-2, -1.5, -1, -0.5, 0, 0.5, 1].flatMap(h => [{ value: `Home ${h}`, odd: odd(eff(settle(de, h))) }, { value: `Away ${h}`, odd: odd(eff(settle(neg(de), -h))) }]);
  bets.push({ id: 4, values: ah }, { id: 5, values: ou }, { id: 6, values: ouOf(tot1, [0.5, 1.5, 2.5]) }, { id: 45, values: co }, { id: 56, values: ch },
    { id: 77, values: c1 });
  return { updatedAt: new Date(Date.now() - 40 * 60e3).toISOString(), fetchedAt: Date.now(), bookmakers: [{ id: 4, name: 'Pinnacle', bets }] };
}

// Elenco da temporada e escalação (demo): 18 jogadores por time (11 titulares fixos, o camisa 9 artilheiro);
// o visitante entra sem três titulares, para a conferência mostrar o desfalque.
export function teamPlayers(teamId) {
  return Array.from({ length: 18 }, (_, k) => ({ id: teamId * 100 + k + 1, name: `${TEAMS[idxOf(teamId)]?.name.split(' ')[0] || 'Time'} ${k + 1}`,
    pos: k === 0 ? 'Goalkeeper' : k < 5 ? 'Defender' : k < 8 ? 'Midfielder' : 'Attacker',
    starts: k < 11 ? 14 - (k % 3) : 2, apps: k < 11 ? 14 : 6, goals: k === 8 ? 7 : k > 8 && k < 11 ? 3 : 0, in_squad: true }));
}
export function lineups(fixtureId) {
  const g = schedule(Math.floor(fixtureId / 1000)).find(x => x.id === fixtureId);
  if (!g) return [];
  const xi = (idx, starters, bench) => { const t = TEAMS[idx], ps = teamPlayers(t.id), by = k => ps[k - 1];
    return { team: t.id, name: t.name, formation: '4-3-3', coach: null, start: starters.map(k => by(k).name), bench: bench.map(k => by(k).name),
      startIds: starters.map(k => by(k).id), benchIds: bench.map(k => by(k).id) }; };
  return [xi(g.h, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [12, 13, 14]), xi(g.a, [1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 11], [8, 9])];
}

// Mercado da demo: o mandante de cada rodada com chegadas (uma paga), o visitante com saídas.
export function transfers(teamId) {
  const i = idxOf(teamId), d = k => new Date(Date.now() - k * DAY).toISOString().slice(0, 10), other = k => TEAMS[(i + k) % TEAMS.length];
  if (i < 0) return [];
  return i % 2 === 0
    ? [1, 2, 3, 4, 5, 6].map(k => ({ player: `Reforço ${k}`, date: d(10 * k), type: k === 1 ? '€ 450K' : k === 2 ? 'Loan' : 'Free', in: teamId, inName: TEAMS[i].name, out: other(k).id, outName: other(k).name }))
    : [1, 2].map(k => ({ player: `Saída ${k}`, date: d(15 * k), type: 'Free', in: other(k).id, inName: other(k).name, out: teamId, outName: TEAMS[i].name }));
}
