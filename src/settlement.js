// Conferência de uma aposta registrada a partir da análise: busca o jogo na API-Football, liquida a
// linha (mesma regra asiática do modelo e dos gráficos) e mede o CLV contra a última odd da Pinnacle.
// Também acompanha os jogos ao vivo (placar, minuto, escanteios e como a linha está agora).
// Usado pela aba "⚽ Análise" do app de apostas (mesmo endereço: lê a chave da API do localStorage).

import { history } from './dashboard.js';
import { collect } from './odds.js';
import { statsOf } from './client.js';
import { isCombo, liveCombo, settleCombo } from './combos.js';
import { settleMulti } from './multiple.js';

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
  const ft = f.score?.fulltime || {}, ht = f.score?.halftime || {};
  const hg = ft.home ?? f.goals.home, ag = ft.away ?? f.goals.away, s = statsOf(f);
  const side = i => (s ? [s[i], s[5 + i]] : null);
  return { t: f.fixture.timestamp * 1000, home: true, opp: f.teams.away.name, gf: hg, ga: ag,
    g1: ht.home != null && ht.away != null ? [ht.home, ht.away] : null,
    corners: side(4), shots: side(3), sot: side(2), c1 };
}

// Liquida uma linha num jogo encerrado: 'A' | 'HW' | 'VOID' | 'HL' | 'RED', ou null se faltar dado.
export function settleLine(lineId, game, homeName = 'Mandante') {
  if (isCombo(lineId)) return settleCombo(lineId, game.gf, game.ga, { home: homeName, away: game.opp || 'Visitante' });
  const h = history(lineId, 'home', homeName, [game]);
  const bar = h?.bars[0];
  return bar ? { winner: WINNER[bar.res], value: bar.v, what: h.what, threshold: h.threshold } : null;
}

// Múltipla (multiple.js): os jogos das pernas numa requisição; uma perna perdida perde o bilhete (mesmo com jogos
// por terminar); todas ganhas ganha. CLV: a odd tomada contra o produto das justas de fechamento da Pinnacle.
async function checkMulti(meta, oddTaken) {
  const legs = meta.legs || [], fs = new Map();
  for (let i = 0; i < legs.length; i += 20) for (const f of await get('/fixtures', { ids: legs.slice(i, i + 20).map(l => l.fixtureId).join('-') })) fs.set(f.fixture.id, f);
  const res = legs.map(l => {
    const f = fs.get(l.fixtureId);
    if (!f) return { l, r: null, txt: `${l.home} x ${l.away}: não encontrado` };
    const st = f.fixture.status.short;
    if (NO_MATCH.has(st)) return { l, r: 'VOID', txt: `${l.home} x ${l.away}: não disputado` };
    if (!FINISHED.has(st)) return { l, r: null, txt: `${l.home} x ${l.away}: ${f.fixture.status.long}` };
    const g = gameOf(f), x = settleLine(l.lineId, g, f.teams.home.name);
    return { l, r: x?.winner ?? null, txt: `${f.teams.home.name} ${g.gf}–${g.ga} ${f.teams.away.name} ${x?.winner === 'A' ? '✅' : x?.winner === 'RED' ? '❌' : '↩'}` };
  });
  const s = settleMulti(res.map(x => x.r)), detail = `múltipla ${res.filter(x => x.r === 'A').length}/${legs.length}: ${res.map(x => x.txt).join(' · ')}`;
  if (!s.done) return { status: 'pendente', detail };
  if (s.manual) return { status: 'manual', detail: `${detail} — perna anulada: a casa recalcula a odd (marque à mão)` };
  let clv = null, closingFair = null;
  if (s.winner === 'A' || legs.every(l => fs.get(l.fixtureId) && FINISHED.has(fs.get(l.fixtureId).fixture.status.short))) {
    try {
      let prod = 1;
      for (const l of legs) {
        const p = collect((await get('/odds', { fixture: l.fixtureId, bookmaker: 4 }))[0]?.bookmakers || []).fair.get(l.lineId);
        if (!p) { prod = null; break; }
        prod /= p;
      }
      if (prod) { closingFair = prod; clv = oddTaken / prod - 1; }
    } catch { /* odds já expiraram na API */ }
  }
  return { status: 'encerrado', winner: s.winner, detail, clv, closingFair };
}

// meta: o que a análise gravou na aposta (fixtureId, lineId, home, away, odd tomada, priced_by…).
export async function checkBet(meta, oddTaken) {
  if (!apiKey()) throw new Error('sem a chave da API-Football: abra o app de análise e salve a chave em ⚙️ Chave');
  if (meta.multi) return checkMulti(meta, oddTaken);
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
  // combo com o empate anula devolvido e a perna de gols ganha: vale só ela, na odd da casa (marcar à mão)
  if (r.manual) return { status: 'manual', detail: `${score} · ${r.detail}` };
  if (isCombo(meta.lineId)) return { status: 'encerrado', winner: r.winner, detail: `${score} · combo: ${r.winner === 'A' ? 'as duas pernas ganharam' : 'uma perna perdeu'}`, clv: null, closingFair: null };

  // CLV: odd tomada contra a odd justa (sem margem) da última cotação da Pinnacle antes do jogo.
  let clv = null, closingFair = null;
  if (meta.priced_by === 'pinnacle' || meta.scenario) {
    try {
      const o = (await get('/odds', { fixture: meta.fixtureId, bookmaker: 4 }))[0];
      const p = collect(o?.bookmakers || []).fair.get(meta.lineId);
      if (p) { closingFair = 1 / p; clv = oddTaken / closingFair - 1; }
    } catch { /* odds do jogo já expiraram na API (guarda só 7 dias) */ }
  }
  return { status: 'encerrado', winner: r.winner, detail: `${score} · ${r.what}: ${r.value} (linha ${r.threshold})`,
    clv, closingFair };
}

// Para a simulação (sim.js): os jogos de uma vez (/fixtures?ids=, 20 por requisição, com a estatística), a liquidação
// de uma linha, os escanteios do 1º tempo (1 requisição por jogo, só para linha do 1º tempo) e as justas de fechamento
// da Pinnacle (1 por jogo).
export const simIO = {
  async fixtures(ids) {
    if (!apiKey()) throw new Error('sem a chave da API-Football: salve em ⚙️ Chave');
    const out = new Map();
    for (let i = 0; i < ids.length; i += 20) {
      for (const f of await get('/fixtures', { ids: ids.slice(i, i + 20).join('-') })) {
        const st = f.fixture.status.short, g = gameOf(f);
        out.set(f.fixture.id, { finished: FINISHED.has(st), cancelled: NO_MATCH.has(st), long: f.fixture.status.long, home: f.teams.home.name,
          homeId: f.teams.home.id, awayId: f.teams.away.id, game: g, score: `${f.teams.home.name} ${g.gf ?? '?'}–${g.ga ?? '?'} ${f.teams.away.name}` });
      }
    }
    return out;
  },
  settle: (lineId, f, c1 = null) => settleLine(lineId, c1 ? { ...f.game, c1 } : f.game, f.home),
  async halfCorners(id, f) {
    const s = await get('/fixtures/statistics', { fixture: id, half: 'true' });
    if (!s.some(t => t.statistics_1h?.length)) return null;
    const by = Object.fromEntries(s.map(t => [t.team.id, t.statistics_1h || []]));
    const c = t => Number(by[t]?.find(x => x.type === 'Corner Kicks')?.value) || 0;
    return [c(f.homeId), c(f.awayId)];
  },
  async closing(id) { return collect((await get('/odds', { fixture: id, bookmaker: 4 }))[0]?.bookmakers || []).fair; },
};

// ---- ao vivo ----
const FIRST_HALF = new Set(['1H']);
const PAST_HT = new Set(['2H', 'ET', 'BT', 'P', 'FT', 'AET', 'PEN']);
export const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

// Escanteios [mandante, visitante] da estatística do jogo (ao vivo, mesmo sem chutes), ou null.
function cornersOf(f) {
  const by = Object.fromEntries((f.statistics || []).map(t => [t.team.id, t.statistics || []]));
  const c = id => by[id]?.find(x => x.type === 'Corner Kicks');
  const h = c(f.teams.home.id), a = c(f.teams.away.id);
  return h || a ? [Number(h?.value) || 0, Number(a?.value) || 0] : null;
}

// Jogo como está agora, no formato de gameOf (placar atual; 1º tempo quando já se sabe).
function liveGame(f, c1) {
  const ht = f.score?.halftime || {}, st = f.fixture.status.short, corners = cornersOf(f), s = statsOf(f);
  const side = i => (s ? [s[i], s[5 + i]] : null);
  const firstHalfNow = FIRST_HALF.has(st) || st === 'HT';
  return { t: f.fixture.timestamp * 1000, home: true, opp: f.teams.away.name, gf: f.goals.home ?? 0, ga: f.goals.away ?? 0,
    g1: firstHalfNow ? [f.goals.home ?? 0, f.goals.away ?? 0] : ht.home != null && ht.away != null ? [ht.home, ht.away] : null,
    corners, shots: side(3), sot: side(2), c1 };
}

// Os jogos das apostas, ao vivo ou recém-terminados: 1 requisição para até 20 jogos (/fixtures?ids= traz placar,
// minuto e estatística). c1: escanteios do 1º tempo já conhecidos por jogo (não mudam depois do intervalo);
// needC1: jogos com aposta no 1º tempo — passado o intervalo, busca uma vez a estatística por tempo.
// Devolve Map(fixtureId -> { status, long, elapsed, extra, goals, ht, corners, c1, finished, cancelled, home, away, game }).
export async function liveFixtures(ids, { needC1 = new Set(), c1 = new Map() } = {}) {
  if (!apiKey()) throw new Error('sem a chave da API-Football: abra o app de análise e salve a chave em ⚙️ Chave');
  const uniq = [...new Set(ids.filter(Boolean))], out = new Map();
  for (let i = 0; i < uniq.length; i += 20) {
    for (const f of await get('/fixtures', { ids: uniq.slice(i, i + 20).join('-') })) {
      const id = f.fixture.id, st = f.fixture.status.short;
      let k1 = c1.get(id) ?? null;
      if (FIRST_HALF.has(st) || st === 'HT') k1 = cornersOf(f);   // até o intervalo, todo escanteio é do 1º tempo
      else if (!k1 && needC1.has(id) && PAST_HT.has(st)) {
        try {
          const s = await get('/fixtures/statistics', { fixture: id, half: 'true' });
          const by = Object.fromEntries(s.map(t => [t.team.id, t.statistics_1h || []]));
          const c = t => Number(by[t]?.find(x => x.type === 'Corner Kicks')?.value) || 0;
          if (s.some(t => t.statistics_1h?.length)) k1 = [c(f.teams.home.id), c(f.teams.away.id)];
        } catch { /* sem estatística por tempo: a linha do 1º tempo espera a conferência */ }
      }
      out.set(id, { status: st, long: f.fixture.status.long, elapsed: f.fixture.status.elapsed, extra: f.fixture.status.extra ?? null,
        goals: [f.goals.home ?? 0, f.goals.away ?? 0], ht: [f.score?.halftime?.home ?? null, f.score?.halftime?.away ?? null],
        corners: cornersOf(f), c1: k1, finished: FINISHED.has(st), cancelled: NO_MATCH.has(st), live: LIVE.has(st),
        home: f.teams.home.name, away: f.teams.away.name, game: liveGame(f, k1) });
    }
  }
  return out;
}

// Múltipla ao vivo: cada perna como está agora (liveLine) e o placar do bilhete. info: Map(fixtureId -> liveFixtures).
export function liveMulti(legs, info) {
  const each = (legs || []).map(l => { const v = info.get(l.fixtureId);
    return { home: l.home, away: l.away, linha: l.linha, status: v?.status || null, live: !!v?.live, finished: !!v?.finished, elapsed: v?.elapsed ?? null,
      goals: v?.goals || null, line: v && !['NS', 'TBD'].includes(v.status) ? liveLine(l.lineId, v) : null }; });
  const won = each.filter(x => x.line?.locked && x.line.now === 'A').length, lost = each.filter(x => x.line?.locked && x.line.now === 'RED').length;
  return { multi: true, legs: each, won, lost, n: each.length };
}

// A linha com o jogo como está agora: o valor, o resultado se o jogo acabasse agora, se já está decidida
// (over que já bateu, under que já estourou, linha do 1º tempo depois do intervalo, jogo encerrado) e,
// no over que ainda não bateu, quantos faltam.
export function liveLine(lineId, info) {
  if (!lineId || !info) return null;
  if (isCombo(lineId)) return liveCombo(lineId, info);
  const h = history(lineId, 'home', info.home, [info.game]), bar = h?.bars[0];
  if (!bar) return null;
  const now = WINNER[bar.res], firstHalf = /^(g1|c1)/.test(lineId);
  const over = /^(g|g1|corners|c1|c[HA]|shots|sot)O/.test(lineId), under = /^(g|g1|corners|c1|c[HA]|shots|sot)U/.test(lineId);
  const decided = info.finished || (firstHalf && (info.status === 'HT' || PAST_HT.has(info.status)));
  const locked = decided || (over && now === 'A') || (under && now === 'RED');
  const need = over && !locked ? Math.floor(h.threshold) + 1 - bar.v : null;
  return { value: bar.v, threshold: h.threshold, what: h.what, now, locked, need };
}
