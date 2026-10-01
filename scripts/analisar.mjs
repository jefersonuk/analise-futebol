#!/usr/bin/env node
// Dossiê de um jogo para o agente especialista: roda o mesmo modelo do app, junta Pinnacle,
// desfalques, classificação, descanso e histórico, e imprime JSON no stdout.
//
// Uso:  node scripts/analisar.mjs "<time>" [--listar] [--jogo N] [--fixture ID] [--time-id ID] [--banca R$] [--demo]
// Chave: variável API_FOOTBALL_KEY ou arquivo .env na raiz do projeto (API_FOOTBALL_KEY=...).
// Cache na nuvem (opcional, o mesmo do app): ANALISE_CACHE_REPO=dono/repo-privado e ANALISE_CACHE_TOKEN=...

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClient } from '../src/client.js';
import * as demo from '../src/demo.js';
import { buildDossier } from '../src/dossier.js';
import { withCloud } from '../src/cloud.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const fail = m => { process.stderr.write(`erro: ${m}\n`); process.exit(1); };
const log = m => process.stderr.write(`${m}\n`);

function args(argv) {
  const o = { q: null, jogo: 0, banca: 44000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') o.demo = true;
    else if (a === '--jogo') o.jogo = Number(argv[++i]);
    else if (a === '--fixture') o.fixture = Number(argv[++i]);
    else if (a === '--time-id') o.teamId = Number(argv[++i]);
    else if (a === '--listar') o.list = true;
    else if (a === '--banca') o.banca = Number(argv[++i]);
    else o.q = a;
  }
  return o;
}

function env(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').find(l => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch { return ''; }
}
const apiKey = () => env('API_FOOTBALL_KEY');
let cloud = null;

function nodeClient(key) {
  let remaining = null;
  const file = k => path.join(CACHE, `${k.replace(/[^\w.-]/g, '_')}.json`);
  const get = async (p, params) => {
    const res = await fetch(`https://v3.football.api-sports.io${p}?${new URLSearchParams(params)}`, { headers: { 'x-apisports-key': key } });
    if (!res.ok) throw new Error(`API respondeu HTTP ${res.status}`);
    remaining = res.headers.get('x-ratelimit-requests-remaining') ?? remaining;
    const json = await res.json();
    const errs = json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : json.errors || [];
    if (errs.length) throw new Error(errs.join(' · '));
    return json.response;
  };
  const local = {
    load: k => { try { return JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch { return null; } },
    save: (k, d) => { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file(k), JSON.stringify(d)); },
  };
  const repo = env('ANALISE_CACHE_REPO'), token = env('ANALISE_CACHE_TOKEN');
  if (repo && token) cloud = withCloud(local, { repo, token });
  const { load, save } = cloud || local;
  return { ...makeClient({ get, load, save }), quota: () => remaining };
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.q) fail('informe o nome de um time. Ex.: node scripts/analisar.mjs "Cienciano"');
  const key = o.demo ? 'demo' : apiKey();
  if (!key) fail(`sem chave: crie ${path.join(ROOT, '.env')} com a linha API_FOOTBALL_KEY=<sua chave> (ou use --demo)`);
  const api = key === 'demo' ? { ...demo, quota: () => null } : nodeClient(key);

  const teams = await api.searchTeams(o.q);
  if (!teams.length) fail(`nenhum time encontrado para "${o.q}"`);
  const team = o.teamId ? teams.find(t => t.id === o.teamId) : teams[0];
  if (!team) fail(`--time-id ${o.teamId} não está entre: ${teams.map(t => `${t.id} ${t.name}`).join('; ')}`);
  const fixtures = await api.upcoming(team.id);
  const listing = () => fixtures.map((f, i) => `[${i}] fixture ${f.id} · ${new Date(f.t - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} BRT · ${f.home.name} x ${f.away.name} (${f.league.name})`).join('\n');
  if (o.list) {
    process.stdout.write(`Times: ${teams.slice(0, 5).map(t => `${t.id} ${t.name} (${t.country})`).join('; ')}\nPróximos jogos de ${team.name}:\n${listing()}\n`);
    return;
  }
  const fx = o.fixture ? fixtures.find(f => f.id === o.fixture) : fixtures[o.jogo];
  if (!fx) fail(`jogo não encontrado. Próximos de ${team.name}:\n${listing()}`);

  const out = await buildDossier(api, { fx, team, teams, fixtures, banca: o.banca, national: !!team.national, onProgress: log });
  process.stdout.write(JSON.stringify(out) + '\n');
  if (cloud) {
    await cloud.flush();
    const st = cloud.status();
    log(`nuvem ${st.repo}: ${st.down} baixados, ${st.up} enviados${st.error ? ` · erro: ${st.error}` : ''}`);
  }
}

main().catch(e => fail(e.message));
