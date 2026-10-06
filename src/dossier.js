// Dossiê de um jogo para o especialista: o mesmo modelo do app + Pinnacle sem margem, desfalques,
// classificação, descanso, histórico e consistência de cada linha. Usado pelo app (navegador) e pelo
// script do agente (scripts/analisar.mjs), para que os dois vejam exatamente os mesmos números.
//
// api: searchTeams, upcoming, leaguesOf, leagueMatches, fixtureOdds, injuries, standings, lastPlayed, quota

import { CORNER_EDGE, DERIVED, FAV_EDGE, METRICS, analyzeMatch, dist, ev, fairOdd, impliedTotal, roleOf, settle, sideLabel, stakeFor } from './model.js';
import { rank } from './ratings.js';
import { buildInsights, recentGames } from './insights.js';
import { collect } from './odds.js';
import { history } from './dashboard.js';
import { GOAL_HANDICAP, HANDICAP, MAIN_LINES, ODD_FLOOR, consistency, isMain, isMainLine, rankScore, rankTier, underOk, valueOf } from './consistency.js';
import { HALF_FROM } from './client.js';
import { favorFor } from './favoritism.js';
import { buildContext, contextGames, lineContext } from './context.js';
import { livePlanOf } from './live.js';
import { applyHard, hardGame } from './hard.js';

export { stakeFor };

const DAY = 864e5;
// Mercados das linhas principais do pré-jogo (painel e candidatas de foco): escanteios 1T, escanteios do
// jogo, gols 1T, gols do jogo — só nas linhas de MAIN_LINES (consistency.js) — e os handicaps do jogo
// (escanteios e gols).
export const FOCUS = Object.keys(MAIN_LINES).concat(HANDICAP, GOAL_HANDICAP);
export const ODDS_STALE_MIN = 90;   // acima disso a odd da API provavelmente já andou
// Peso do modelo na mistura log-linear com a Pinnacle (o resto é da Pinnacle). Valores iniciais
// do relatório (0,05–0,15 em mercados líquidos; mais onde a Pinnacle é fraca); calibrar por CLV.
const W_MODEL = { '1X2': 0.1, 'Handicap asiático': 0.1, 'Total de gols': 0.1, 'Total de gols 1T': 0.1, 'Ambas marcam': 0.1,
  'Total de escanteios': 0.2, 'Escanteios por time': 0.2, 'Total de chutes': 0.2, 'Total de chutes no gol': 0.2 };

// Lado de uma linha: Mais de 8,5 e Mais de 9,5 escanteios, ou Fora +0,5 e Fora +0,75, são o mesmo lado
// do mesmo mercado em preços diferentes.
export const side = id => (/^[12X]$/.test(id) ? '1X2' : /^c1?x[12X]$/.test(id) ? id.slice(0, -1) : id.replace(/-?[\d.]+$/, ''));
// Uma linha por mercado: lados opostos do mesmo mercado (Casa 0 e Fora +1,5) não viram duas apostas.
export function distinct() {
  const seen = new Set();
  return l => !seen.has(l.market) && seen.add(l.market);
}

const r = (x, d = 3) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const cond = s => s.pWin / (s.pWin + s.pLose);   // probabilidade sem o push (como a Pinnacle precifica)

// Mistura log-linear Pinnacle × modelo, normalizada no par de pernas complementares.
function blend(pPin, pMod, w) {
  const a = pPin ** (1 - w) * pMod ** w, b = (1 - pPin) ** (1 - w) * (1 - pMod) ** w;
  return a / (a + b);
}

// Temporadas usadas: atual + 2 anteriores (o decaimento cuida do peso); 2020/21 sem público distorce o mando.
export const seasonsFor = S => [S, S - 1, S - 2].filter(s => s !== 2020);

// Jogos da liga nas temporadas do modelo; escanteios do 1º tempo só na atual e na anterior
// (1 requisição por jogo, e a API só tem estatística por tempo a partir de 2024).
export async function loadLeague(api, lg, S, onProgress) {
  if (lg.national) return loadNational(api, lg, S, onProgress);
  if (lg.cross) return loadCross(api, lg, S, onProgress);
  let matches = [];
  for (const s of seasonsFor(S)) {
    try {
      let ms = await api.leagueMatches(lg.id, s, (d, n) => onProgress?.(`Baixando ${lg.name} ${s}: ${d}/${n} jogos…`));
      if (s >= S - 1) ms = await api.attachHalfCorners(lg.id, s, ms, (d, n) =>
        onProgress?.(`Escanteios do 1º tempo ${lg.name} ${s}: ${d}/${n} jogos (só na primeira vez)…`));
      matches = matches.concat(ms);
    } catch (e) { if (s === S) throw e; }
  }
  await api.indexMatches?.(matches, false);
  return { matches, seasons: seasonsFor(S) };
}

// Seleções não têm liga em comum (eliminatórias, torneios, amistosos intercontinentais). A base é
// o conjunto dos jogos dos dois times e de cada adversário que eles enfrentaram — isso liga as
// confederações e permite ajustar pela força do adversário. Amistosos pesam metade; jogos com mais
// de 4 anos saem. Escanteios do 1º tempo só dos dois times (1 requisição por jogo).
export const FRIENDLIES = 10;
export async function loadNational(api, base, S, onProgress) {
  const seasons = [S, S - 1, S - 2], cutoff = Date.now() - 4 * 365 * DAY, byId = new Map();
  const teamGames = async (id, name) => {
    let out = [];
    for (const s of seasons) {
      try { out = out.concat(await api.teamMatches(id, s, (d, n) => onProgress?.(`${name} ${s}: estatísticas ${d}/${n}…`))); }
      catch { /* temporada sem jogos */ }
    }
    return out.filter(m => m.t >= cutoff);
  };
  const own = [];
  for (const t of base.teams) {
    onProgress?.(`Jogos de ${t.name}…`);
    let ms = await teamGames(t.id, t.name);
    for (const s of seasons.filter(x => x >= HALF_FROM && x >= S - 1)) {
      const part = ms.filter(m => seasonOf(m, S) === s);
      if (part.length) {
        const withC1 = await api.attachHalfCorners(`tm${t.id}`, s, part, (d, n) =>
          onProgress?.(`Escanteios do 1º tempo de ${t.name}: ${d}/${n} jogos (só na primeira vez)…`));
        const c1 = new Map(withC1.map(m => [m.id, m.c1]));
        ms = ms.map(m => (c1.has(m.id) ? { ...m, c1: c1.get(m.id) } : m));
      }
    }
    own.push(...ms);
  }
  for (const m of own) byId.set(m.id, m);
  const opponents = new Map();
  for (const m of own) for (const [id, name] of [[m.h, m.hn], [m.a, m.an]])
    if (!base.teams.some(t => t.id === id)) opponents.set(id, name);
  let i = 0;
  for (const [id, name] of opponents) {
    onProgress?.(`Adversários (${++i}/${opponents.size}): ${name}…`);
    for (const m of await teamGames(id, name)) if (!byId.has(m.id)) byId.set(m.id, m);
  }
  const matches = [...byId.values()].map(m => (m.lg === FRIENDLIES ? { ...m, wm: 0.5 } : m));
  await api.indexMatches?.(matches, true);
  return { matches, seasons };
}

// Temporada aproximada de um jogo de seleção para agrupar o cache de 1º tempo (ano do jogo).
const seasonOf = (m, S) => Math.min(S, new Date(m.t).getUTCFullYear());

// Primeira divisão nacional de um time entre as ligas (pontos corridos) que ele disputa. A API também
// classifica campeonatos estaduais e ligas de reservas como "liga", então: ids conhecidos primeiro,
// depois o primeiro nome que não seja estadual, copa, reservas, base ou feminino.
const TOP = new Set([71, 128, 39, 140, 135, 78, 61, 94, 88, 262, 253, 203, 144, 179, 281, 239, 265, 268, 250, 242, 344, 299]);
const NOT_TOP = /paulista|carioca|mineiro|ga[uú]cho|paranaense|baiano|pernambucano|cearense|catarinense|goiano|capixaba|copa|cup|super|reserv|u\d\d|women|femin|youth|primavera/i;
export function domesticLeague(leagues) {
  return leagues.find(l => TOP.has(l.id)) || leagues.find(l => !NOT_TOP.test(l.name)) || leagues[0] || null;
}

// Base de comparação do jogo:
//   clubes da mesma liga        -> a liga (3 temporadas)
//   clubes de ligas diferentes  -> a liga de cada um + a própria competição (Libertadores, Champions…),
//                                   cujos jogos entre ligas põem as duas na mesma escala
//   seleções                    -> jogos dos dois times e dos adversários deles
export async function resolveBase(api, fx, national) {
  if (national) return { id: 'nt', name: 'seleções', national: true, teams: [fx.home, fx.away] };
  const S = fx.league.season;
  const of = async t => { const l = await api.leaguesOf(t.id, S); return l.length ? l : api.leaguesOf(t.id, S - 1); };
  const [lh, la] = await Promise.all([of(fx.home), of(fx.away)]);
  const common = lh.filter(l => la.some(x => x.id === l.id));
  const same = common.find(l => l.id === fx.league.id) || (common.length && domesticLeague(common));
  if (same) return same;
  const dh = domesticLeague(lh), da = domesticLeague(la);
  const leagues = [dh, da, { id: fx.league.id, name: fx.league.name }].filter(Boolean)
    .filter((l, i, a) => a.findIndex(x => x.id === l.id) === i);
  return { id: `x${leagues.map(l => l.id).join('-')}`, cross: true, leagues, teams: [fx.home, fx.away],
    name: leagues.map(l => l.name).join(' + ') };
}

// Clubes de ligas diferentes: as ligas dos dois e a competição do jogo. Escanteios do 1º tempo só dos
// jogos dos dois times (1 requisição por jogo; as ligas inteiras custariam centenas).
export async function loadCross(api, base, S, onProgress) {
  const byId = new Map();
  for (const lg of base.leagues) {
    for (const s of seasonsFor(S)) {
      try {
        for (const m of await api.leagueMatches(lg.id, s, (d, n) => onProgress?.(`Baixando ${lg.name} ${s}: ${d}/${n} jogos…`)))
          byId.set(m.id, m);
      } catch { /* temporada sem jogos (ex.: liga que o time ainda não disputava) */ }
    }
  }
  let matches = [...byId.values()];
  for (const t of base.teams) {
    for (const s of [S, S - 1].filter(x => x >= HALF_FROM)) {
      const own = matches.filter(m => (m.h === t.id || m.a === t.id) && seasonOf(m, S) === s);
      if (!own.length) continue;
      const withC1 = await api.attachHalfCorners(`tm${t.id}`, s, own, (d, n) =>
        onProgress?.(`Escanteios do 1º tempo de ${t.name}: ${d}/${n} jogos (só na primeira vez)…`));
      const c1 = new Map(withC1.map(m => [m.id, m.c1]));
      matches = matches.map(m => (c1.has(m.id) && m.c1 == null ? { ...m, c1: c1.get(m.id) } : m));
    }
  }
  await api.indexMatches?.(matches, false);
  return { matches, seasons: seasonsFor(S) };
}

// Linha sem odd da Pinnacle, precificada pelo modelo: ancorada no total da Pinnacle quando o mercado
// deriva de um total que ela cota (odd mínima = justa × 1,05), senão modelo puro (× 1,08). Sempre frágil.
// hi: histórico dos dois times na linha ({ home, away }, formato de hist() do dossiê).
export function modelEntry(l, { res, hi, banca, names = {}, context = null }) {
  const inviable = inviableReason(l.id, res.favor, names);
  const pm = cond(l), range = l.sc.map(cond), anchor = res.anchors[DERIVED[l.market]];
  const oddMin = (1 / pm) * (anchor ? 1.05 : 1.08);
  const c = consistency({ p: pm, pLow: Math.min(...range), hits: [hi.home, hi.away].filter(Boolean) });
  return { id: l.id, market: l.market, line: sideLabel(l.label, names.home, names.away), p_model: r(pm), p_model_range: [r(Math.min(...range)), r(Math.max(...range))],
    fair_odd_model: r(fairOdd(l), 2), push_prob: r(1 - l.pWin - l.pLose) || 0, inviable, model_only: !anchor,
    priced_by: anchor ? `modelo ancorado no total ${DERIVED[l.market] === 'corners1h' ? '1T ' : ''}de escanteios da Pinnacle`
      : 'só o modelo (sem odd da Pinnacle nesta linha)',
    pinnacle_odd: null, p_pinnacle: null, diff_pp: null,
    p_blend: r(pm), tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(rawRate(hi), 2), hit_rate_role: r(c.hit_rate, 2),
    fair_odd_blend: r(1 / pm, 2), fragile: true, odd_min: r(oddMin, 2), odd_min_vs_pinnacle_pct: null,
    ...stakeFor(pm, oddMin, banca), ...ctxOf(l, context, pm), history: hi };
}

// Handicap POSITIVO para o favorito não existe a preço jogável: as casas montam a linha principal em volta
// da vantagem esperada do favorito, e "favorito +x" sai abaixo de ~1,30. Linha assim só aparece quando o
// modelo diverge do mercado — é artefato, não oportunidade. Favorito: nos escanteios, pela diferença que o
// mercado espera (handicap de escanteios da Pinnacle ou o 1X2); nos gols, pela superioridade do 1X2.
export function inviableReason(id, favor, names = {}) {
  const m = id.match(/^(ah|ch|c1h)([HA])(-?[\d.]+)$/);
  if (!m || !(+m[3] > 0) || !favor || favor.sup == null) return null;
  const goals = favor.sup >= FAV_EDGE ? 'H' : favor.sup <= -FAV_EDGE ? 'A' : null;
  const corners = favor.diff_market == null ? goals
    : favor.diff_market >= CORNER_EDGE ? 'H' : favor.diff_market <= -CORNER_EDGE ? 'A' : null;
  if ((m[1] === 'ah' ? goals : corners) !== m[2]) return null;
  const who = (m[2] === 'H' ? names.home : names.away) || (m[2] === 'H' ? 'o mandante' : 'o visitante');
  return `${who} é o favorito${m[1] === 'ah' ? '' : ' nos escanteios'}: handicap positivo para o favorito não sai a preço jogável`;
}

// Resumo do favoritismo e da divisão dos escanteios, para a tela e o especialista.
const SRC = { pinnacle_handicap: 'handicap de escanteios da Pinnacle', pinnacle_por_time: 'escanteios por time da Pinnacle',
  '1x2': 'favoritismo do 1X2 × escanteios por gol medidos na liga', modelo: 'modelo de gols (sem odds)' };
export function favorSummary(f, names = {}) {
  if (!f || f.sup == null) return null;
  const n1 = x => Math.abs(x).toFixed(1).replace('.', ','), who = x => (x >= 0 ? names.home : names.away);
  const parts = [Math.abs(f.sup) < FAV_EDGE
    ? `jogo equilibrado (${n1(f.sup)} gol de diferença${f.source === 'pinnacle_1x2' ? ' pela Pinnacle' : ' pelo modelo'})`
    : `favorito: ${who(f.sup)} (${n1(f.sup)} gol de superioridade${f.source === 'pinnacle_1x2' ? ', 1X2 da Pinnacle' : ', pelo modelo'})`];
  if (f.applied) parts.push(`escanteios: o mercado põe ${who(f.diff_market)} com ${n1(f.diff_market)} a mais no jogo`
    + `${f.diff1h_market != null ? ` e ${n1(f.diff1h_market)} no 1º tempo` : ''} (${SRC[f.corners_source]}); o modelo sozinho dizia ${who(f.diff_model)} +${n1(f.diff_model)}`);
  return parts.join(' · ');
}
export const contraAlert = (f, names = {}) => (f?.contra
  ? `modelo contra o mercado nos escanteios: o mercado põe ${f.diff_market >= 0 ? names.home : names.away} com mais escanteios e o modelo dizia o contrário — a divisão segue só o mercado` : null);

// Nome do mandante e do visitante a partir de teams [{ role, name }].
export const teamNames = teams => ({ home: teams.find(t => t.role === 'home')?.name, away: teams.find(t => t.role === 'away')?.name });

// Papel de cada time no jogo de hoje, pela superioridade que o mercado (ou o modelo) dá ao mandante.
export const rolesNow = favor => ({ home: roleOf(favor?.sup), away: roleOf(favor?.sup == null ? null : -favor.sup) });

// Peso de um jogo passado no acerto da linha, pela distância entre o papel do time naquele jogo e o de hoje:
// mesmo papel 1, papel vizinho 0,6, oposto 0,3 (sem papel conhecido: 1). Quem joga hoje como zebra não vira
// "âncora" com acertos de quando era favorito.
const ROLE_ORDER = { zebra: 0, equilibrado: 1, favorito: 2 };
export const roleWeight = (now, then) => (now == null || then == null ? 1 : [1, 0.6, 0.3][Math.abs(ROLE_ORDER[now] - ROLE_ORDER[then])]);

// Histórico dos dois times numa linha (últimos jogos de cada um, do mais recente ao mais antigo).
// wins/n: acerto pesado pelo papel (vai para a consistência); hits/raw: a contagem simples, para exibir;
// by_role: acerto em cada papel. teams: [{ role, name, games, roleNow }].
export function lineHistory(id, teams) {
  const one = t => {
    const h = t && history(id, t.role, t.name, t.games);
    if (!h) return null;
    let wins = 0, n = 0;
    const by = {};
    for (const b of h.bars) {
      const role = roleOf(b.g.sup), w = roleWeight(t.roleNow, role), win = b.res === 'win' ? 1 : b.res === 'hw' ? 0.5 : 0;
      wins += w * win; n += w;
      if (role) { const x = (by[role] ||= { wins: 0, n: 0 }); x.wins += win; x.n++; }
    }
    return { what: h.what, threshold: h.threshold, rule: h.rule, hits: `${h.wins}/${h.bars.length}`, raw: { wins: h.wins, n: h.bars.length },
      wins: r(wins, 2), n: r(n, 2), role_now: t.roleNow ?? null, by_role: by, values_newest_first: h.bars.map(b => b.v).reverse() };
  };
  return { home: one(teams.find(t => t.role === 'home')), away: one(teams.find(t => t.role === 'away')) };
}
// Acerto simples dos últimos jogos dos dois times somados (o que o gráfico mostra).
const rawRate = hi => { const xs = [hi.home, hi.away].filter(Boolean), n = xs.reduce((s, x) => s + x.raw.n, 0); return n ? xs.reduce((s, x) => s + x.raw.wins, 0) / n : null; };

// Totais que a Pinnacle cota em outra linha: a chance de uma linha principal que ela não cota sai do total que
// ela precifica no mercado (binomial negativa com a dispersão da liga; gols, Poisson). A régua continua sendo a
// Pinnacle, só que derivada: a linha fica frágil (odd mínima × 1,05). Ex.: ela cota 10,5 escanteios e não 8,5.
const TOTALS = { 'Total de gols': ['g', 'goals'], 'Total de gols 1T': ['g1', 'goals1h'], 'Total de escanteios': ['corners', 'corners'],
  'Total escanteios 1T': ['c1', 'corners1h'] };
function derivedP(id, T, phi) {
  const m = id.match(/([OU])([\d.]+)$/), L = +m[2];
  const e = dist(T, phi, Math.ceil(T * 3 + 25)).map((p, k) => [k, p]);
  return cond(m[1] === 'O' ? settle(e, -L) : settle(e.map(([v, p]) => [-v, p]), L));
}

// Checagens de contexto (context.js) nas linhas dos mercados de foco, quando há contexto.
const ctxOf = (l, context, p) => (context && FOCUS.includes(l.market) ? { context: lineContext(l.id, context, p) } : {});

// Preço de cada linha do modelo: com Pinnacle (mistura log-linear, odd mínima ×1,03/×1,05), ancorada
// ou só do modelo (modelEntry), e as linhas de mercado soft sem preço (model_only). Usado pelo dossiê
// e pela varredura do dia. teams: [{ role, name, games }]; only: filtro opcional de linhas;
// context: { ctx, games, names } de buildContext (checagens de contexto nas linhas de foco);
// hard: jogo difícil de analisar (hard.js) — só over de gols com a odd da Pinnacle, com metade da entrada.
export function priceLines(res, { odds, fair, alerts = [], teams, banca = 44000, only = null, context = null, hard = null }) {
  const hist = l => lineHistory(l.id, teams);
  const names = teamNames(teams);
  const g1x2 = ['1', 'X', '2'];
  const x12 = g1x2.every(id => fair.has(id)) ? (() => {
    const lines = g1x2.map(id => res.lines.find(l => l.id === id));
    const raw = lines.map((l, i) => fair.get(g1x2[i]) ** 0.9 * cond(l) ** 0.1), z = raw.reduce((s, x) => s + x, 0);
    return Object.fromEntries(g1x2.map((id, i) => [id, raw[i] / z]));
  })() : {};

  const stake = (p, odd) => stakeFor(p, odd, banca);

  const implied = Object.fromEntries(Object.entries(TOTALS).map(([m, [pre, k]]) => {
    const phi = k === 'goals' ? 1 : res.phi[k] || 1, x = fair.size ? impliedTotal(fair, pre, phi) : null;
    return [m, x && { ...x, phi }];
  }));
  const priced = [], anchored = [], modelOnly = [];
  for (const l of res.lines) {
    if (only && !only(l)) continue;
    const pm = cond(l), range = l.sc.map(cond), odd = odds.get(l.id), pp = fair.get(l.id);
    const soft = /escanteios|chutes/i.test(l.market);
    const base = { id: l.id, market: l.market, line: sideLabel(l.label, names.home, names.away), inviable: inviableReason(l.id, res.favor, names), p_model: r(pm), p_model_range: [r(Math.min(...range)), r(Math.max(...range))],
      fair_odd_model: r(fairOdd(l), 2), push_prob: r(1 - l.pWin - l.pLose) || 0 };
    const hi = hist(l), cons = p => consistency({ p, pLow: Math.min(...range), hits: [hi.home, hi.away].filter(Boolean) });
    if (odd && pp != null) {
      const pb = x12[l.id] ?? blend(pp, pm, W_MODEL[l.market] ?? 0.1), e = ev(l, odd), diff = (pm - pp) * 100;
      const fragile = alerts.length > 0 || Math.abs(diff) >= (soft ? 10 : 5);
      // odd mínima: justa + margem de segurança, nunca abaixo do núcleo (1,50). Só aqui, onde a odd da Pinnacle
      // diz se a casa soft paga isso (até 5% acima dela); sem ela, linha de 70%+ com justa abaixo de 1,43 fica de fora.
      const oddMin = Math.max(ODD_FLOOR, (1 / pb) * (fragile ? 1.05 : 1.03)), c = cons(pb);
      const v = valueOf({ p: pb, q: pp, pLow: Math.min(...range), hits: [hi.home, hi.away].filter(Boolean) });
      priced.push({ ...base, priced_by: 'pinnacle', pinnacle_odd: odd, p_pinnacle: r(pp), diff_pp: r(diff, 1), p_blend: r(pb),
        value_pct: r(v.value * 100, 1), value_level: v.level,
        tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(rawRate(hi), 2), hit_rate_role: r(c.hit_rate, 2),
        fair_odd_blend: r(1 / pb, 2), fragile, odd_min: r(oddMin, 2),
        odd_min_vs_pinnacle_pct: r((oddMin / odd - 1) * 100, 1), ...stake(pb, oddMin),
        ev_model_at_pinnacle: r(e.mid), ev_model_worst: r(e.low), ...ctxOf(l, context, pb), history: hi });
    } else if (implied[l.market] && isMain(l.id)) {
      // linha principal que a Pinnacle não cota, num total que ela cota em outra linha
      const x = implied[l.market], pd = derivedP(l.id, x.implied_total, x.phi), pb = blend(pd, pm, W_MODEL[l.market] ?? 0.1);
      const oddMin = (1 / pb) * 1.05, c = cons(pb);
      const v = valueOf({ p: pb, q: pd, pLow: Math.min(...range), hits: [hi.home, hi.away].filter(Boolean) });
      priced.push({ ...base, priced_by: `derivada do total da Pinnacle (ela cota ${String(x.from_line).replace('.', ',')}; total ${x.implied_total.toFixed(2).replace('.', ',')})`,
        derived: true, pinnacle_odd: null, p_pinnacle: r(pd), diff_pp: r((pm - pd) * 100, 1), p_blend: r(pb),
        value_pct: r(v.value * 100, 1), value_level: v.level,
        tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(rawRate(hi), 2), hit_rate_role: r(c.hit_rate, 2),
        fair_odd_blend: r(1 / pb, 2), fragile: true, odd_min: r(oddMin, 2), odd_min_vs_pinnacle_pct: null, ...stake(pb, oddMin),
        ev_model_at_pinnacle: null, ev_model_worst: null, ...ctxOf(l, context, pb), history: hi });
    } else if (res.anchors[DERIVED[l.market]] || !odds.size || (isMain(l.id) && soft)) {
      // Sem preço na API para esta linha: mercado de escanteios derivado (handicap, quem tem mais, corrida)
      // com o total ancorado na Pinnacle (margem 5%), ou o modelo puro (margem 8%) quando a Pinnacle ainda não
      // publicou nada para o jogo ou não cota escanteios nele (linhas principais). Sempre frágil.
      anchored.push(modelEntry(l, { res, hi, banca, names, context }));
    } else if (pm >= 0.35 && soft && odds.size) {
      const c = cons(pm);
      if (c.tier !== 'especulativa' || pm <= 0.65)
        modelOnly.push({ ...base, tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(rawRate(hi), 2), hit_rate_role: r(c.hit_rate, 2),
          odd_min_model_only: r(fairOdd(l) * 1.08, 2), history: hi });
    }
  }
  const h = l => applyHard(l, hard);
  return { priced: priced.map(h), anchored: anchored.map(h), modelOnly };
}

// Candidata (consistência primeiro, preço depois): âncora/sólida (acerto ≥ 60%), odd mínima ≥ 1,50 e permitida
// pela Política E, que uma casa soft consegue pagar (até ~5% acima da Pinnacle), e under só se for âncora.
export const isCandidate = l => l.tier !== 'especulativa' && l.odd_min >= ODD_FLOOR && l.politica_e !== 'não entrar'
  && (l.odd_min_vs_pinnacle_pct == null || l.odd_min_vs_pinnacle_pct <= 5) && underOk(l) && !l.inviable;
// Aposta: candidata cujo contexto do jogo não contradiz a linha (context.js). Com contexto contra, a
// estatística sozinha não basta.
// Linha só do modelo (sem a Pinnacle nem o total dela) só vira aposta se for âncora.
// Jogo difícil de analisar (hard.js): a linha bloqueada não é aposta.
export const isBet = l => isCandidate(l) && l.context?.verdict !== 'contra' && (!l.model_only || l.tier === 'âncora') && !l.blocked;
// Ordem: nível (under um nível abaixo), não frágil antes de frágil, score (under com desconto), preço.
export const byConsistency = (a, b) => rankTier(a) - rankTier(b) || a.fragile - b.fragile
  || rankScore(b) - rankScore(a) || (a.odd_min_vs_pinnacle_pct ?? 99) - (b.odd_min_vs_pinnacle_pct ?? 99);

// Candidatas de todos os mercados — consistência primeiro, preço depois: só linhas âncora/sólida, com odd
// mínima dentro da faixa operada (≥ 1,50 e permitida pela Política E), que uma casa soft consegue pagar (até
// ~5% acima da Pinnacle), que o mercado oferece e sem contexto contra. Ordem: nível, não frágil antes de
// frágil, score, preço.
// Foco: o mesmo filtro só nas linhas principais do pré-jogo com preço da Pinnacle (isMainLine).
function pickCandidates(priced, anchored) {
  priced.sort((a, b) => Math.abs(b.diff_pp) - Math.abs(a.diff_pp));
  const all = priced.concat(anchored);
  const top = list => list.filter(isBet).sort(byConsistency).filter(distinct()).slice(0, 8).map(l => l.id);
  return { candidatesFocus: top(priced.filter(isMainLine)), candidates: top(all) };
}

// Análise guardada aberta de novo: refaz o preço de todas as linhas com o modelo atual e as odds guardadas
// (sem requisição), para o painel nunca misturar números de duas versões do modelo.
export function repriceDossier(dossier, res, oddsP, teams, banca = 44000) {
  const { odds, fair } = collect(oddsP?.bookmakers || []);
  const fx = { home: { name: teamNames(teams).home }, away: { name: teamNames(teams).away } };
  const alerts = (dossier.data_quality?.alerts || []).filter(a => !/^modelo contra o mercado/.test(a));
  const contra = contraAlert(res.favor, { home: fx.home.name, away: fx.away.name });
  if (contra) alerts.push(contra);
  // contexto guardado (tabela, confronto da API) + os jogos da base para as checagens de cada linha
  const c = dossier.context, ids = { home: dossier.teams?.home?.id, away: dossier.teams?.away?.id };
  const context = c && ids.home && ids.away ? { ctx: c, names: { home: fx.home.name, away: fx.away.name },
    games: contextGames(res.prep.rows, ids.home, ids.away, Date.parse(dossier.fixture.kickoff), c.h2h_extra || []) } : null;
  // jogo difícil: o guardado; análise de antes da regra recalcula pela base
  const hard = dossier.hard_game !== undefined ? dossier.hard_game : ids.home && ids.away ? hardGame({ rows: res.prep.rows,
    fx: { home: { id: ids.home, name: fx.home.name }, away: { id: ids.away, name: fx.away.name }, league: { name: dossier.fixture.competition } } }) : null;
  if (hard && !alerts.some(a => a.startsWith('jogo difícil'))) alerts.push(`jogo difícil de analisar (${hard.reasons.join('; ')}): só over de gols com a odd da Pinnacle, com metade da entrada`);
  const { priced, anchored, modelOnly } = priceLines(res, { odds, fair, alerts, teams, banca, context, hard });
  return { ...dossier, data_quality: { ...dossier.data_quality, alerts }, lines_with_pinnacle: priced, lines_anchored: anchored,
    hard_game: hard, live_1h: hard ? null : livePlanOf(res),
    model_only_lines: modelOnly, ...pickCandidates(priced, anchored),
    favoritism: res.favor && { summary: favorSummary(res.favor, { home: fx.home.name, away: fx.away.name }), ...res.favor } };
}

// fx: jogo (de upcoming). team: time buscado. fixtures: próximos jogos dele (evita chamada repetida).
// matches/lg: jogos da liga já baixados pelo app (opcional). banca em R$.
// oddsPayload: resultado de api.fixtureOdds já buscado pelo app (para a tabela e o dossiê usarem as mesmas odds).
export async function buildDossier(api, { fx, team = fx.home, teams = [], fixtures = [], banca = 44000, matches = null, lg = null, oddsPayload = null, national = false, favor = null, onProgress }) {
  const S = fx.league.season;
  if (!lg) lg = await resolveBase(api, fx, national);
  if (!lg) throw new Error('os dois times não disputam a mesma liga nesta temporada; confronto entre ligas não é suportado');

  if (!matches) ({ matches } = await loadLeague(api, lg, S, onProgress));
  const seasons = seasonsFor(S);
  onProgress?.('Montando o dossiê (Pinnacle, desfalques, tabela, descanso)…');

  const other = team.id === fx.home.id ? fx.away : fx.home;   // o time que não foi buscado
  const SOURCES = ['odds_pinnacle', 'desfalques', 'classificacao', 'ultimo_jogo_mandante', 'ultimo_jogo_visitante', 'proximos_do_outro_time',
    'confronto_direto'];
  const settled = await Promise.allSettled([
    oddsPayload ?? api.fixtureOdds(fx.id), api.injuries(fx.id), lg.national ? [] : api.standings(lg.cross ? fx.league.id : lg.id, S),
    api.lastPlayed(fx.home.id), api.lastPlayed(fx.away.id), api.upcoming(other.id),
    api.headToHead ? api.headToHead(fx.home.id, fx.away.id) : [],
  ]);
  const val = (i, d) => (settled[i].status === 'fulfilled' ? settled[i].value : d);
  const sources = Object.fromEntries(SOURCES.map((n, i) =>
    [n, settled[i].status === 'fulfilled' ? 'ok' : `falhou: ${settled[i].reason?.message}`]));
  const oddsP = val(0, { updatedAt: null, fetchedAt: Date.now(), bookmakers: [] });
  const { odds, fair } = collect(oddsP.bookmakers);
  const oddsAgeMin = oddsP.updatedAt ? Math.round((oddsP.fetchedAt - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const injuries = val(1, []), table = val(2, []);
  if (!favor || !matches.some(m => m.sup != null)) { const fv = favorFor(matches); matches = fv.matches; favor = favor ?? fv.cal; }
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair, favor });
  if (!res.lines.length) throw new Error('jogos insuficientes na liga para ajustar o modelo');
  const nextOf = { [team.id]: fixtures, [other.id]: val(5, []) };

  // Alertas de qualidade: qualquer um deixa todas as linhas frágeis.
  const alerts = [];
  if (res.prep.coverage < 0.6) alerts.push(`só ${Math.round(res.prep.coverage * 100)}% dos jogos da liga têm estatística de chutes`);
  if (!res.pred.goals.known) alerts.push('um dos times não tem histórico na liga (promovido ou de outra liga)');
  for (const t of [fx.home, fx.away]) {
    const w = res.fits.goals.games.get(t.id) || 0;
    if (w < 8) alerts.push(`${t.name}: só ${w.toFixed(1)} jogos-equivalentes na liga`);
  }
  if (lg.national) alerts.push(`jogo de seleções (${fx.league.name}): base com ${res.prep.rows.length} jogos dos dois times e dos adversários; amostra bem menor que a de clubes`);
  else if (lg.cross) alerts.push(`jogo entre ligas (${fx.league.name}): ${lg.name} — a comparação entre as ligas vem dos jogos da competição; confira se a diferença de nível faz sentido`);
  else if (lg.id !== fx.league.id) alerts.push(`jogo de ${fx.league.name} medido pela liga ${lg.name} (rotação provável)`);
  if (lg.national && fx.league.id === FRIENDLIES) alerts.push('amistoso: rotação e intensidade imprevisíveis');
  const contra = contraAlert(res.favor, { home: fx.home.name, away: fx.away.name });
  if (contra) alerts.push(contra);
  const hard = hardGame({ fx, rows: res.prep.rows });
  if (hard) alerts.push(`jogo difícil de analisar (${hard.reasons.join('; ')}): só over de gols com a odd da Pinnacle, com metade da entrada`);
  if (!odds.size) alerts.push('sem odds da Pinnacle: não há régua de preço');
  else if (oddsAgeMin > ODDS_STALE_MIN) alerts.push(`odds da Pinnacle com ${oddsAgeMin} min de idade (a API atualiza a cada ~3 h): confira o preço atual antes de entrar`);

  const names = { home: fx.home.name, away: fx.away.name };
  const recent = { [fx.home.id]: recentGames(res.prep, fx.home.id), [fx.away.id]: recentGames(res.prep, fx.away.id) };

  // ---- times ----
  const teamOut = (t, role, last) => {
    const games = recent[t.id], withXg = games.filter(g => g.xf != null);
    const avg = f => (withXg.length ? r(withXg.reduce((s, g) => s + f(g), 0) / withXg.length, 2) : null);
    const ratings = {};
    for (const k of Object.keys(METRICS)) {
      const f = res.fits[k];
      if (!f) continue;
      const ra = rank(f, t.id, 'att'), rd = rank(f, t.id, 'def');
      ratings[k] = { att: r(ra?.value), att_rank: ra && `${ra.pos}/${ra.of}`, def: r(rd?.value), def_rank: rd && `${rd.pos}/${rd.of}`,
        venue_gap: r(f.gap.get(t.id)) };
    }
    const next = (nextOf[t.id] || []).find(f => f.t > fx.t);
    // uma entrada por tabela em que o time aparece (ex.: Apertura, Clausura, Acumulado)
    const st = table.filter(s => s.team === t.id).map(s => {
      const grp = table.filter(x => x.group === s.group);
      const rel = grp.filter(x => /releg|rebaix|descen/i.test(x.zone || '')).map(x => x.rank);
      const relPts = rel.length ? grp.find(x => x.rank === Math.min(...rel))?.points : null;
      return { ...s, teams_in_table: grp.length, leader_points: Math.max(...grp.map(x => x.points)),
        points_above_relegation_zone: relPts != null ? s.points - relPts : null };
    });
    return {
      name: t.name, id: t.id, role, ratings,
      games_weighted: r(res.fits.goals.games.get(t.id) || 0, 1),
      finishing_last10: { n: withXg.length, goals_minus_xg_pg: avg(g => g.gf - g.xf), conceded_minus_xga_pg: avg(g => g.ga - g.xa) },
      standings: st,
      rest_days_before: last ? r((fx.t - last.t) / DAY, 1) : null,
      last_match: last && `${last.league.name}: ${last.home.name} x ${last.away.name}`,
      days_to_next: next ? r((next.t - fx.t) / DAY, 1) : null,
      next_match: next && `${next.league.name}: ${next.home.name} x ${next.away.name}`,
      injuries: injuries.filter(i => i.team === t.id).map(i => `${i.player} (${i.type}: ${i.reason})`),
      recent_league_games: games.map(g => [
        new Date(g.t).toISOString().slice(0, 10), g.home ? 'C' : 'F', g.opp, `${g.gf}-${g.ga}`,
        g.xf != null ? `xG ${g.xf.toFixed(1)}-${g.xa.toFixed(1)}` : 'xG —',
        g.corners ? `esc ${g.corners[0]}-${g.corners[1]}` : 'esc —', g.shots ? `chutes ${g.shots[0]}-${g.shots[1]}` : 'chutes —',
      ].join(' ')),
    };
  };

  // ---- linhas ----
  const now = rolesNow(res.favor);
  const teamsHist = [{ role: 'home', name: fx.home.name, games: recent[fx.home.id], roleNow: now.home },
    { role: 'away', name: fx.away.name, games: recent[fx.away.id], roleNow: now.away }];
  const h2hExtra = val(6, []);
  const context = buildContext({ rows: res.prep.rows, fx, table, extra: h2hExtra, res, fair });
  const { priced, anchored, modelOnly } = priceLines(res, { odds, fair, alerts, teams: teamsHist, banca, context, hard });
  const { candidatesFocus, candidates } = pickCandidates(priced, anchored);

  const imp = (prefix, phi) => {
    const x = impliedTotal(fair, prefix, phi);
    return x && { from_line: x.from_line, p_over_no_vig: r(x.p_over_no_vig), implied_total: r(x.implied_total, 2) };
  };
  const impliedTotals = { goals: imp('g', 1), goals1h: imp('g1', res.phi.goals1h || 1), corners: imp('corners', res.phi.corners || 1),
    corners1h: imp('c1', res.phi.corners1h || 1) };

  const out = {
    generated_at: new Date().toISOString(),
    fixture: { id: fx.id, kickoff: new Date(fx.t).toISOString(), competition: fx.league.name, country: fx.league.country,
      model_league: lg.name, cup_note: lg.id !== fx.league.id ? `jogo de ${fx.league.name}; forças medidas em ${lg.name}` : null,
      home: fx.home.name, away: fx.away.name, team_candidates: teams.slice(0, 5).map(t => `${t.id} ${t.name} (${t.country})`) },
    data_quality: { alerts, sources, odds_updated_at: oddsP.updatedAt, odds_age_min: oddsAgeMin, league_matches_used: res.prep.rows.length, seasons, stats_coverage: r(res.prep.coverage, 2), corners_1h_coverage: r(res.prep.coverage1h, 2),
      corners_1h_anchor: res.anchors.corners1h ? Object.fromEntries(Object.entries(res.anchors.corners1h).map(([k, v]) => [k, r(v, 2)])) : null,
      both_teams_known: res.pred.goals.known, pinnacle_lines: priced.length, api_requests_left: api.quota(),
      dispersion_at_floor: Object.entries(res.phi).filter(([k, v]) => k !== 'goals' && v <= 1.0001).map(([k]) => k) },
    league: { home_factor: Object.fromEntries(Object.entries(res.fits).filter(([, f]) => f).map(([k, f]) => [k, r(f.home)])),
      avg_total: Object.fromEntries(Object.entries(res.fits).filter(([, f]) => f).map(([k, f]) => [k, r(f.avgH + f.avgA, 2)])),
      dispersion_vmr: Object.fromEntries(Object.entries(res.phi).map(([k, v]) => [k, r(v)])), xg_proxy_scale: r(res.prep.scale) },
    projection: Object.fromEntries(Object.entries(res.pred).filter(([, p]) => p).map(([k, p]) =>
      [k, { home: r(p.h, 2), away: r(p.a, 2), total: r(p.h + p.a, 2), log_se_home: r(p.seH), log_se_away: r(p.seA),
        pinnacle_implied: impliedTotals[k] ?? null }])),
    teams: {
      home: teamOut(fx.home, 'mandante', val(3, null)),
      away: teamOut(fx.away, 'visitante', val(4, null)),
    },
    favoritism: res.favor && { summary: favorSummary(res.favor, { home: fx.home.name, away: fx.away.name }),
      ...Object.fromEntries(Object.entries(res.favor).map(([k, v]) => [k, typeof v === 'number' ? r(v, 2) : v])) },
    context: { ...context.ctx, h2h_extra: h2hExtra.map(({ id, t, h, a, hg, ag, hh, ha, ln }) => ({ id, t, h, a, hg, ag, hh, ha, ln })) },
    hard_game: hard,
    live_1h: hard ? null : livePlanOf(res),
    focus_markets: FOCUS,
    candidates_focus: candidatesFocus,
    candidates,
    lines_with_pinnacle: priced,
    lines_anchored: anchored,
    model_only_lines: modelOnly,
    model_notes: buildInsights(res, fx.home.id, fx.away.id, names).map(i => i.text),
    method: { blend_weight_model: W_MODEL, blend: 'log-linear p ∝ p_pinnacle^(1−w)·p_modelo^w, normalizado nas pernas complementares',
      probabilities: 'condicionais ao não-push (como a Pinnacle precifica)',
      fragile: 'algum alerta de qualidade, ou |diff_pp| ≥ 5 (1X2/AH/gols/BTTS) ou ≥ 10 (escanteios/chutes)',
      odd_min: 'fair_odd_blend × 1,03 (× 1,05 se frágil); nas linhas com odd da Pinnacle, nunca abaixo de 1,50 (piso do núcleo: em linha de 70%+ a mínima é o próprio 1,50, e ela só é candidata se isso ficar até 5% acima da Pinnacle); linhas só do modelo: fair_odd_model × 1,08',
      entry: `¼ Kelly sobre banca de R$ ${banca} com p_blend na odd mínima, teto 300·min(1, p/0,70), × fator da Política E dessa odd`,
      odds_cache: 'odds da Pinnacle com até 10 minutos de cache',
      over_first: 'preferência por over em gols e escanteios: under só é candidata se for âncora e, na ordem, conta um nível abaixo e com 0,05 a menos no score',
      consistency: 'piso de acerto 60%, ideal 70%; score = 0,5·p + 0,25·p_pior_cenário + 0,25·acerto_10_jogos_encolhido (10 jogos de peso para p); '
        + 'âncora (ideal): p ≥ 0,70, pior cenário ≥ 0,60, acerto encolhido ≥ 0,70 e cada time ≥ 6/10; sólida (piso): p ≥ 0,60, pior cenário ≥ 0,50 e acerto encolhido ≥ 0,60; resto especulativa (nunca aposta)',
      candidates: 'âncora/sólida (acerto ≥ 60%), odd mínima permitida pela Política E e até 5% acima da Pinnacle, sem contexto contra; ordem: nível, não frágil, score, preço',
      main_lines: 'linhas principais do pré-jogo: escanteios 1T 4, 4,5 e 5 e do jogo 8, 8,5 e 9 (over ou under), gols 1T 1,5 e do jogo 1,5 e 2,5 (só over) e os handicaps do jogo (escanteios e gols) nas linhas da Pinnacle; as mais baixas só pagam no ao vivo (live_1h)',
      context: 'checagens de cada linha de foco: mando (acerto nos últimos 10 do mandante em casa + do visitante fora; a favor se ≥ p − 5 pp, contra se ≤ min(50%, p − 20 pp); 8+ jogos), médias (total ou saldo pelas médias dos dois times no mando de hoje — temporada pela tabela ou últimos 10 — contra a linha: gols ±0,3, gols 1T ±0,2, escanteios ±0,8, escanteios 1T ±0,4), confronto direto (acerto nos confrontos dos últimos 5 anos, 3+ jogos, mesmos cortes do mando) e, nos handicaps, tabela (4+ posições); veredito contra = 2+ contra e mais contra que a favor (tira a linha das candidatas)',
      live_1h: 'escanteios do 1º tempo ao vivo: binomial negativa do total 1T (μ ancorado na Pinnacle, φ da liga) como mistura gama–Poisson; c escanteios até o minuto m atualizam o ritmo do jogo (forma r + c, taxa r/μ + m/47) e o resto do tempo segue binomial negativa; 47 min com ritmo uniforme (conservador para o over); odd mínima = justa × 1,05 (× 1,08 sem o total 1T da Pinnacle); vale com 0 a 0 e 11 contra 11',
      value: 'informativo: value_pct = p_blend / p_pinnacle − 1 (EV na odd justa da Pinnacle); value_level confirmado: valor ≥ +2%, pior cenário do modelo ≥ p_pinnacle, histórico pelo papel (8+ jogos) ≥ p_pinnacle + 5 pp e nenhum time 10 pp abaixo; sem confirmação: valor ≥ +1% e histórico ≥ p_pinnacle − 5 pp (ou curto)',
      candidates_focus: 'o filtro de candidates só nas linhas principais com preço da Pinnacle (over e under valem igual nos totais de escanteios); ordem: chance de ganho (nível, não frágil, score)',
      derived_corners: 'handicap de escanteios, quem tem mais escanteios (jogo e 1º tempo) e corrida a N escanteios: médias de cada time pelo modelo com o total puxado 80% para o total da Pinnacle (do jogo ou do 1º tempo); corrida: total binomial negativo, cada escanteio do visitante com prob. μA/(μH+μA); odd mínima = justa × 1,05 (× 1,08 sem âncora), sempre frágil',
      corners_1h_handicap: 'a API não traz odd de handicap de escanteios do 1º tempo: média de cada time pelo modelo, total puxado 80% para o total 1T implícito na Pinnacle, diferença com binomial negativa na dispersão da diferença medida na liga; odd mínima = justa × 1,05, sempre frágil' },
  };
  return out;
}
