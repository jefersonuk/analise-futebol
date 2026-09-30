// Cliente da API-Football (v3). A chave fica só no localStorage deste navegador.

const BASE = 'https://v3.football.api-sports.io';
const KEY_STORE = 'af:key';
const HOUR = 3600e3;

export const getKey = () => localStorage.getItem(KEY_STORE) || '';
export const setKey = k => localStorage.setItem(KEY_STORE, k.trim());
export let remaining = null;   // requisições restantes no dia, conforme o último cabeçalho

async function call(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { 'x-apisports-key': getKey() },
  });
  if (!res.ok) throw new Error(`API respondeu HTTP ${res.status}`);
  remaining = res.headers.get('x-ratelimit-requests-remaining') ?? remaining;
  const json = await res.json();
  const errs = json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : json.errors || [];
  if (errs.length) throw new Error(errs.join(' · '));
  return json.response;
}

async function cached(key, ttl, fn) {
  try {
    const hit = JSON.parse(localStorage.getItem(key));
    if (hit && Date.now() - hit.t < ttl) return hit.d;
  } catch {}
  const d = await fn();
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch {}
  return d;
}

function normalize(fx, teamId) {
  const home = fx.teams.home.id === teamId;
  const opp = home ? fx.teams.away : fx.teams.home;
  const ft = fx.score?.fulltime || {};
  const gh = ft.home ?? fx.goals.home, ga = ft.away ?? fx.goals.away;
  const st = {};
  for (const s of fx.statistics || []) st[s.team.id] = Object.fromEntries(s.statistics.map(x => [x.type, x.value]));
  const mine = st[teamId], theirs = st[opp.id];
  const pair = type => (mine && theirs && Object.keys(mine).length
    ? { f: Number(mine[type]) || 0, a: Number(theirs[type]) || 0 } : null);
  return {
    id: fx.fixture.id, date: fx.fixture.date.slice(0, 10), league: fx.league.name, home, opp: opp.name,
    goals: { f: home ? gh : ga, a: home ? ga : gh },
    corners: pair('Corner Kicks'), shots: pair('Total Shots'), sot: pair('Shots on Goal'),
  };
}

export function searchTeams(q) {
  if (getKey() === 'demo') return Promise.resolve(demoTeams(q));
  return cached(`af:teams:${q.toLowerCase()}`, 30 * 24 * HOUR, async () =>
    (await call('/teams', { search: q })).map(r => ({ id: r.team.id, name: r.team.name, country: r.team.country })));
}

// Últimos n jogos encerrados do time, já com estatísticas (2 requisições).
export function lastGames(teamId, n) {
  if (getKey() === 'demo') return Promise.resolve(demoGames(teamId, n));
  return cached(`af:games:${teamId}:${n}`, 3 * HOUR, async () => {
    const list = await call('/fixtures', { team: teamId, last: n, status: 'FT-AET-PEN' });
    if (!list.length) return [];
    const full = await call('/fixtures', { ids: list.map(f => f.fixture.id).join('-') });
    return full.map(f => normalize(f, teamId)).sort((a, b) => b.date.localeCompare(a.date));
  });
}

// ---- modo demonstração (chave "demo"): dados sintéticos para ver o app sem gastar requisições ----
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function rng(seed) { let x = seed || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function pois(r, mu) { let l = Math.exp(-mu), k = 0, p = r(); while (p > l) { k++; p *= r(); } return k; }

function demoTeams(q) { return [{ id: hash(q.toLowerCase()), name: q, country: 'Demo' }]; }
function demoGames(teamId, n) {
  const r = rng(teamId), atk = 0.8 + r() * 0.8, def = 0.8 + r() * 0.8;
  return Array.from({ length: n }, (_, i) => {
    const home = r() < 0.5, adv = home ? 1.15 : 0.87;
    const mk = (f, a) => ({ f: pois(r, f * atk * adv), a: pois(r, a * def / adv) });
    return {
      id: teamId + i, date: new Date(Date.now() - (i + 1) * 5 * 864e5).toISOString().slice(0, 10),
      league: 'Demo', home, opp: `Adversário ${i + 1}`,
      goals: mk(1.35, 1.2), corners: mk(5.1, 4.8), shots: mk(12.5, 11.5), sot: mk(4.4, 4),
    };
  });
}
