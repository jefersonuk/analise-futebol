// Cliente da API-Football no navegador. A chave fica só no localStorage deste navegador.

import * as demo from './demo.js';
import { makeClient } from './client.js';

const BASE = 'https://v3.football.api-sports.io';
const KEY_STORE = 'af:key';

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

const client = makeClient({ get: call, load, save });
const pick = (name, ...args) => (isDemo() ? Promise.resolve(demo[name](...args)) : client[name](...args));

export const searchTeams = q => pick('searchTeams', q);
export const upcoming = teamId => pick('upcoming', teamId);
export const leaguesOf = (teamId, season) => pick('leaguesOf', teamId, season);
export const fixtureOdds = fixtureId => pick('fixtureOdds', fixtureId);
export const leagueMatches = (leagueId, season, onProgress) =>
  pick('leagueMatches', leagueId, season, onProgress);
export const injuries = fixtureId => pick('injuries', fixtureId);
export const standings = (leagueId, season) => pick('standings', leagueId, season);
export const lastPlayed = teamId => pick('lastPlayed', teamId);
export const attachHalfCorners = (leagueId, season, matches, onProgress) =>
  pick('attachHalfCorners', leagueId, season, matches, onProgress);

// O conjunto que o dossiê do especialista usa (mesma interface do script do Claude Code).
export const dossierApi = { searchTeams, upcoming, leaguesOf, leagueMatches, attachHalfCorners, fixtureOdds, injuries, standings, lastPlayed,
  quota: () => remaining };
