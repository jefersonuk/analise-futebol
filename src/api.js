// Cliente da API-Football no navegador. A chave fica só no localStorage deste navegador; o cache de
// dados fica no IndexedDB (store.js), que guarda as ligas baixadas sem o limite de ~5 MB.

import * as demo from './demo.js';
import { makeClient } from './client.js';
import * as store from './store.js';
import { withCloud } from './cloud.js';

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
  const out = json.response;
  if (json.paging && Array.isArray(out)) Object.defineProperty(out, 'paging', { value: json.paging });
  return out;
}

// ---- cache compartilhado no GitHub (repositório privado) ----
// Configuração só neste navegador. Chave fora do prefixo "af:" para não ir para o IndexedDB.
const CLOUD_STORE = 'afGithub';
let cloud = null;
export const getCloud = () => { try { return JSON.parse(localStorage.getItem(CLOUD_STORE)) || null; } catch { return null; } };
export function setCloud(cfg) {
  if (cfg?.repo && cfg?.token) localStorage.setItem(CLOUD_STORE, JSON.stringify({ repo: cfg.repo.trim(), token: cfg.token.trim() }));
  else localStorage.removeItem(CLOUD_STORE);
  const c = getCloud();
  cloud = c ? withCloud(store, c) : null;
  return cloud;
}
setCloud(getCloud());
export const cloudStatus = () => cloud?.status() || null;
export const checkCloud = () => (cloud ? cloud.check() : Promise.reject(new Error('nuvem não configurada')));
export const pushAllToCloud = async onProgress => (cloud ? cloud.pushAll(await store.keys(), onProgress) : 0);
const load = k => (cloud ? cloud.load(k) : store.load(k));
const save = (k, v) => (cloud ? cloud.save(k, v) : store.save(k, v));

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

// Nomes de países em português -> nome da seleção na API (que usa inglês).
const COUNTRIES = {
  brasil: 'Brazil', alemanha: 'Germany', espanha: 'Spain', franca: 'France', inglaterra: 'England', holanda: 'Netherlands',
  'paises baixos': 'Netherlands', italia: 'Italy', japao: 'Japan', coreia: 'South Korea', 'coreia do sul': 'South Korea',
  'estados unidos': 'USA', eua: 'USA', mexico: 'Mexico', uruguai: 'Uruguay', colombia: 'Colombia', equador: 'Ecuador',
  paraguai: 'Paraguay', bolivia: 'Bolivia', belgica: 'Belgium', croacia: 'Croatia', suica: 'Switzerland', marrocos: 'Morocco',
  nigeria: 'Nigeria', egito: 'Egypt', 'arabia saudita': 'Saudi Arabia', australia: 'Australia', india: 'India', catar: 'Qatar',
  qatar: 'Qatar', ira: 'Iran', escocia: 'Scotland', 'pais de gales': 'Wales', gales: 'Wales', irlanda: 'Ireland',
  dinamarca: 'Denmark', suecia: 'Sweden', noruega: 'Norway', polonia: 'Poland', turquia: 'Turkey', grecia: 'Greece',
  servia: 'Serbia', canada: 'Canada', panama: 'Panama', camaroes: 'Cameroon', gana: 'Ghana', 'costa do marfim': 'Ivory Coast',
  argelia: 'Algeria', tunisia: 'Tunisia', 'africa do sul': 'South Africa', 'nova zelandia': 'New Zealand', russia: 'Russia',
  ucrania: 'Ukraine', austria: 'Austria', hungria: 'Hungary', 'republica tcheca': 'Czech Republic', tchequia: 'Czech Republic',
  eslovaquia: 'Slovakia', eslovenia: 'Slovenia', romenia: 'Romania', islandia: 'Iceland', finlandia: 'Finland',
  albania: 'Albania', georgia: 'Georgia', singapura: 'Singapore', jamaica: 'Jamaica', 'costa rica': 'Costa Rica',
  argentina: 'Argentina', chile: 'Chile', peru: 'Peru', venezuela: 'Venezuela', portugal: 'Portugal', senegal: 'Senegal',
  china: 'China', honduras: 'Honduras', 'el salvador': 'El Salvador', guatemala: 'Guatemala', haiti: 'Haiti',
};
const countryOf = q => COUNTRIES[norm(q).trim()] || null;

// Busca de time: primeiro o índice local (0 requisição); a API quando o índice não acha, quando o
// usuário pede (fromApi) ou quando o nome é de um país e a seleção ainda não está no índice.
// Seleções masculinas vêm primeiro quando a busca é um país.
export async function searchTeams(q, { fromApi = false } = {}) {
  if (isDemo()) return demo.searchTeams(q);
  const country = countryOf(q), terms = [country || q];
  let list = fromApi ? [] : await searchLocal(q);
  if (country && !fromApi) list = list.concat(await searchLocal(country));
  const hasNational = list.some(t => t.national && norm(t.name) === norm(country || ''));
  if (fromApi || !list.length || (country && !hasNational)) {
    for (const term of fromApi && country ? [country, q] : terms) {
      const found = await client.searchTeams(term);
      await indexTeams(found);
      list = list.concat(found);
    }
  }
  const seen = new Set(), n = norm(country || q);
  return list.filter(t => !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => score(b, n) - score(a, n) || a.name.length - b.name.length);
}
// seleção principal com o nome exato > seleção > nome que começa com o termo > resto; feminino/base no fim
function score(t, n) {
  const name = norm(t.name), minor = / w$|u\d\d| women/.test(name);
  return (t.national && name === n ? 8 : 0) + (t.national && !minor ? 4 : 0) + (name.startsWith(n) ? 2 : 0) - (minor ? 3 : 0);
}

export const upcoming = teamId => pick('upcoming', teamId);
export const leaguesOf = (teamId, season) => pick('leaguesOf', teamId, season);
export const fixtureOdds = fixtureId => pick('fixtureOdds', fixtureId);
export const leagueMatches = (leagueId, season, onProgress) => pick('leagueMatches', leagueId, season, onProgress);
export const teamMatches = (teamId, season, onProgress) => pick('teamMatches', teamId, season, onProgress);
export const injuries = fixtureId => pick('injuries', fixtureId);
export const standings = (leagueId, season) => pick('standings', leagueId, season);
export const lastPlayed = teamId => pick('lastPlayed', teamId);
export const attachHalfCorners = (scope, season, matches, onProgress, opts) =>
  pick('attachHalfCorners', scope, season, matches, onProgress, opts);
export const dayFixtures = date => pick('dayFixtures', date);
export const dayOdds = (date, bet) => pick('dayOdds', date, bet);
export const hasLeague = (leagueId, season) => pick('hasLeague', leagueId, season);
export const stats = () => (isDemo() ? { api: 0, cache: 0 } : client.stats());

// O conjunto que o dossiê do especialista usa (mesma interface do script do Claude Code).
export const dossierApi = { searchTeams, upcoming, leaguesOf, leagueMatches, teamMatches, attachHalfCorners, fixtureOdds,
  injuries, standings, lastPlayed, indexMatches, dayFixtures, dayOdds, hasLeague, stats, quota: () => remaining };
