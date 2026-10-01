// Cliente da API-Football no navegador. A chave fica só no localStorage deste navegador; o cache de
// dados fica no IndexedDB (store.js), que guarda as ligas baixadas sem o limite de ~5 MB.

import * as demo from './demo.js';
import { makeClient } from './client.js';
import { load, save } from './store.js';

const BASE = 'https://v3.football.api-sports.io';
const KEY_STORE = 'af:key';
const INDEX = 'af:teamIndex';

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

const client = makeClient({ get: call, load, save });
const pick = (name, ...args) => (isDemo() ? Promise.resolve(demo[name](...args)) : client[name](...args));

// ---- índice local de times: busca sem gastar requisição ----
// Todo time visto (em buscas e nos jogos baixados) entra no índice; a busca olha aqui primeiro.
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function indexTeams(list) {
  const idx = (await load(INDEX)) || {};
  let changed = false;
  for (const t of list) {
    const cur = idx[t.id];
    const next = [t.name, t.country ?? cur?.[1] ?? '', t.national ?? cur?.[2] ?? null];
    if (!cur || cur.some((v, i) => v !== next[i])) { idx[t.id] = next; changed = true; }
  }
  if (changed) await save(INDEX, idx);
}

// Times dos jogos baixados (sem país; a seleção é marcada por quem chama).
export const indexMatches = (matches, national = false) => indexTeams(matches.flatMap(m =>
  [{ id: m.h, name: m.hn, national }, { id: m.a, name: m.an, national }]));

async function searchLocal(q) {
  const idx = (await load(INDEX)) || {}, n = norm(q);
  return Object.entries(idx)
    .filter(([, [name]]) => norm(name).includes(n))
    .map(([id, [name, country, national]]) => ({ id: Number(id), name, country, national: !!national, local: true }))
    .sort((a, b) => norm(b.name).startsWith(n) - norm(a.name).startsWith(n) || a.name.length - b.name.length)
    .slice(0, 25);
}

// Busca de time: primeiro o índice local (0 requisição); a API só quando o índice não acha
// ou quando o usuário pede (fromApi).
export async function searchTeams(q, { fromApi = false } = {}) {
  if (isDemo()) return demo.searchTeams(q);
  if (!fromApi) {
    const local = await searchLocal(q);
    if (local.length) return local;
  }
  const list = await client.searchTeams(q);
  await indexTeams(list);
  return list;
}

export const upcoming = teamId => pick('upcoming', teamId);
export const leaguesOf = (teamId, season) => pick('leaguesOf', teamId, season);
export const fixtureOdds = fixtureId => pick('fixtureOdds', fixtureId);
export const leagueMatches = (leagueId, season, onProgress) => pick('leagueMatches', leagueId, season, onProgress);
export const teamMatches = (teamId, season, onProgress) => pick('teamMatches', teamId, season, onProgress);
export const injuries = fixtureId => pick('injuries', fixtureId);
export const standings = (leagueId, season) => pick('standings', leagueId, season);
export const lastPlayed = teamId => pick('lastPlayed', teamId);
export const attachHalfCorners = (scope, season, matches, onProgress) =>
  pick('attachHalfCorners', scope, season, matches, onProgress);
export const stats = () => (isDemo() ? { api: 0, cache: 0 } : client.stats());

// O conjunto que o dossiê do especialista usa (mesma interface do script do Claude Code).
export const dossierApi = { searchTeams, upcoming, leaguesOf, leagueMatches, teamMatches, attachHalfCorners, fixtureOdds,
  injuries, standings, lastPlayed, indexMatches, quota: () => remaining };
