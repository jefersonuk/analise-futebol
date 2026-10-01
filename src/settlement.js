// Conferência de uma aposta registrada a partir da análise: busca o jogo na API-Football, liquida a
// linha (mesma regra asiática do modelo e dos gráficos) e mede o CLV contra a última odd da Pinnacle.
// Usado pela aba "⚽ Análise" do app de apostas (mesmo endereço: lê a chave da API do localStorage).

import { history } from './dashboard.js';
import { collect } from './odds.js';
import { statsOf } from './client.js';

const BASE = 'https://v3.football.api-sports.io';
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const NO_MATCH = new Set(['CANC', 'ABD', 'AWD', 'WO']);
// resultado do gráfico -> código de liquidação do app de apostas
const WINNER = { win: 'A', hw: 'HW', push: 'VOID', hl: 'HL', lose: 'RED' };

export const apiKey = () => localStorage.getItem('af:key') || '';

async function get(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-apisports-key': apiKey() } });
  if (!res.ok) throw new Error(`API respondeu HTTP ${res.status}`);
  const json = await res.json();
  const errs = json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : json.errors || [];
  if (errs.length) throw new Error(errs.join(' · '));
  return json.response;
}

// O jogo do ponto de vista do mandante, no formato que history() entende.
export function gameOf(f, c1 = null) {
  const ft = f.score?.fulltime || {};
  const hg = ft.home ?? f.goals.home, ag = ft.away ?? f.goals.away, s = statsOf(f);
  const side = i => (s ? [s[i], s[5 + i]] : null);
  return { t: f.fixture.timestamp * 1000, home: true, opp: f.teams.away.name, gf: hg, ga: ag,
    corners: side(4), shots: side(3), sot: side(2), c1 };
}

// Liquida uma linha num jogo encerrado: 'A' | 'HW' | 'VOID' | 'HL' | 'RED', ou null se faltar dado.
export function settleLine(lineId, game, homeName = 'Mandante') {
  const h = history(lineId, 'home', homeName, [game]);
  const bar = h?.bars[0];
  return bar ? { winner: WINNER[bar.res], value: bar.v, what: h.what, threshold: h.threshold } : null;
}

// meta: o que a análise gravou na aposta (fixtureId, lineId, home, away, odd tomada, priced_by…).
export async function checkBet(meta, oddTaken) {
  if (!apiKey()) throw new Error('sem a chave da API-Football: abra o app de análise e salve a chave em ⚙️ Chave');
  const f = (await get('/fixtures', { id: meta.fixtureId }))[0];
  if (!f) throw new Error(`jogo ${meta.fixtureId} não encontrado na API`);
  const st = f.fixture.status.short;
  if (NO_MATCH.has(st)) return { status: 'cancelado', winner: 'VOID', detail: `jogo ${st === 'CANC' ? 'cancelado' : 'não disputado'}` };
  if (!FINISHED.has(st)) return { status: 'pendente', detail: `situação na API: ${f.fixture.status.long}` };

  let c1 = null;
  if (/^c1/.test(meta.lineId)) {
    const s = await get('/fixtures/statistics', { fixture: meta.fixtureId, half: 'true' });
    const by = Object.fromEntries(s.map(t => [t.team.id, t.statistics_1h || []]));
    const c = id => Number(by[id]?.find(x => x.type === 'Corner Kicks')?.value) || 0;
    if (s.length && s.some(t => t.statistics_1h?.length)) c1 = [c(f.teams.home.id), c(f.teams.away.id)];
  }
  const game = gameOf(f, c1);
  const r = settleLine(meta.lineId, game, f.teams.home.name);
  const score = `${f.teams.home.name} ${game.gf}–${game.ga} ${f.teams.away.name}`;
  if (!r) return { status: 'sem dado', detail: `${score}: a API ainda não publicou a estatística desta linha` };

  // CLV: odd tomada contra a odd justa (sem margem) da última cotação da Pinnacle antes do jogo.
  let clv = null, closingFair = null;
  if (meta.priced_by === 'pinnacle') {
    try {
      const o = (await get('/odds', { fixture: meta.fixtureId, bookmaker: 4 }))[0];
      const p = collect(o?.bookmakers || []).fair.get(meta.lineId);
      if (p) { closingFair = 1 / p; clv = oddTaken / closingFair - 1; }
    } catch { /* odds do jogo já expiraram na API (guarda só 7 dias) */ }
  }
  return { status: 'encerrado', winner: r.winner, detail: `${score} · ${r.what}: ${r.value} (linha ${r.threshold})`,
    clv, closingFair };
}
