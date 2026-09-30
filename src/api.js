// Cliente da API-Football (v3). A chave fica só no localStorage deste navegador.

import * as demo from './demo.js';

const BASE = 'https://v3.football.api-sports.io';
const KEY_STORE = 'af:key';
const HOUR = 3600e3;
const FINISHED = new Set(['FT', 'AET', 'PEN']);

export const getKey = () => localStorage.getItem(KEY_STORE) || '';
export const setKey = k => localStorage.setItem(KEY_STORE, k.trim());
const isDemo = () => getKey() === 'demo';
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

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, d) {
  try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* cota cheia: segue sem cache */ }
}
async function cached(key, ttl, fn) {
  const hit = load(key);
  if (hit && Date.now() - hit.t < ttl) return hit.d;
  const d = await fn();
  save(key, { t: Date.now(), d });
  return d;
}

export function searchTeams(q) {
  if (isDemo()) return Promise.resolve(demo.searchTeams(q));
  return cached(`af:teams:${q.toLowerCase()}`, 30 * 24 * HOUR, async () =>
    (await call('/teams', { search: q })).map(r => ({ id: r.team.id, name: r.team.name, country: r.team.country })));
}

// Próximos jogos do time, com liga e temporada.
export async function upcoming(teamId) {
  if (isDemo()) return demo.upcoming(teamId);
  return (await call('/fixtures', { team: teamId, next: 10 })).map(f => ({
    id: f.fixture.id, t: f.fixture.timestamp * 1000,
    league: { id: f.league.id, name: f.league.name, season: f.league.season, country: f.league.country },
    home: { id: f.teams.home.id, name: f.teams.home.name },
    away: { id: f.teams.away.id, name: f.teams.away.name },
  }));
}

// Ligas (pontos corridos) que o time disputa na temporada.
export function leaguesOf(teamId, season) {
  if (isDemo()) return Promise.resolve(demo.leaguesOf());
  return cached(`af:lgs:${teamId}:${season}`, 7 * 24 * HOUR, async () =>
    (await call('/leagues', { team: teamId, season, type: 'league' }))
      .map(r => ({ id: r.league.id, name: r.league.name, country: r.country?.name })));
}

function compact(f) {
  const ft = f.score?.fulltime || {};
  return {
    id: f.fixture.id, t: f.fixture.timestamp * 1000,
    h: f.teams.home.id, a: f.teams.away.id, hn: f.teams.home.name, an: f.teams.away.name,
    hg: ft.home ?? f.goals.home, ag: ft.away ?? f.goals.away,
  };
}

// [dentro, fora, noGol, total, escanteios] do mandante e depois do visitante; null se não houver.
function statsOf(f) {
  const by = {};
  for (const s of f.statistics || []) by[s.team.id] = Object.fromEntries(s.statistics.map(x => [x.type, x.value]));
  const H = by[f.teams.home.id], A = by[f.teams.away.id];
  if (!H || !A || (H['Total Shots'] == null && A['Total Shots'] == null)) return null;
  const v = (o, k) => Number(o[k]) || 0;
  return [H, A].flatMap(o => [v(o, 'Shots insidebox'), v(o, 'Shots outsidebox'), v(o, 'Shots on Goal'), v(o, 'Total Shots'), v(o, 'Corner Kicks')]);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Todos os jogos encerrados de uma liga/temporada, com estatísticas.
// Jogo encerrado não muda: fica em cache e só os novos são baixados.
export async function leagueMatches(leagueId, season, onProgress) {
  if (isDemo()) return demo.leagueMatches(season);
  const key = `af:lg:${leagueId}:${season}`;
  const store = load(key) || { t: 0, m: {} };
  if (Date.now() - store.t > 3 * HOUR) {
    for (const f of await call('/fixtures', { league: leagueId, season }))
      if (FINISHED.has(f.fixture.status.short) && !store.m[f.fixture.id]) store.m[f.fixture.id] = compact(f);
    store.t = Date.now();
  }
  const pending = Object.values(store.m).filter(m => m.s === undefined).map(m => m.id);
  const batches = chunk(chunk(pending, 20), 4);   // 20 jogos por requisição, 4 requisições em paralelo
  let done = 0;
  for (const group of batches) {
    await Promise.all(group.map(async ids => {
      const full = await call('/fixtures', { ids: ids.join('-') });
      for (const f of full) if (store.m[f.fixture.id]) store.m[f.fixture.id].s = statsOf(f);
      for (const id of ids) {
        const m = store.m[id];
        // sem estatística: marca como ausente, exceto jogo recente (a API pode publicar depois)
        if (m.s === undefined && Date.now() - m.t > 2 * 24 * HOUR) m.s = null;
      }
      done += ids.length;
      onProgress?.(done, pending.length);
    }));
    save(key, store);
  }
  save(key, store);
  return Object.values(store.m).map(m => ({ ...m, s: m.s ?? null }));
}
