// Varredura: maior chance de ganho nas linhas principais do pré-jogo (consistency.js), só over: escanteios 1T
// 4 a 5,5 e do jogo 8 a 11; gols 1T 1,5 e do jogo 1,5 e 2,5; chutes (total e no gol); handicap de gols e 1X2 —
// dos jogos por começar com odds da Pinnacle, pelo mesmo modelo do app. "Melhor do jogo" olha só handicap de
// gols, gols e 1X2; escanteios e chutes ficam nas abas deles (chutes: as casas quase não oferecem a linha). Liga sem estatística na API (USL Championship,
// Liga de Expansión, Primera B…) entra só com gols, handicap de gols e 1X2.
// Combos: duas pernas no mesmo jogo (resultado + over de gols), com a chance da matriz de placares (combos.js).
// Cenário (a aba padrão): cada time comparado com os jogos de mesmas características (mando e papel), a motivação
// da tabela e o clássico; aposta quando a Pinnacle paga odd perto de 2 acima do que o cenário diz ser justo (scenario.js).
//
// Janela: as próximas N horas (padrão da tela: 4 h, até 20 jogos, em ordem de horário) ou um dia inteiro.
// Cada jogo leva o contexto (context.js: tabela, médias de gols e escanteios no mando, esperado, confronto
// direto), as checagens de contexto de cada linha e o plano de entrada ao vivo nos escanteios do 1º tempo
// (live.js).
//
// Custo (o que manda no desenho):
//   1. jogos do dia: 1 requisição; odds da Pinnacle de todos os mercados lidos: 1 por 10 jogos (nenhuma
//      busca jogo a jogo)
//   2. cada liga: ~60 requisições na primeira vez (3 temporadas com estatística), depois só o que é novo.
//      Os escanteios do 1º tempo da liga inteira (1 requisição por jogo) NÃO são baixados: a média do
//      1º tempo de cada time sai dos escanteios do jogo × fração do 1º tempo, e o total é ancorado na Pinnacle
//   3. os 1,5×N melhores jogos nos escanteios do 1º tempo: escanteios do 1º tempo dos últimos 10 jogos de cada
//      time (até 20 requisições por jogo na primeira vez; ficam guardados), que entram no histórico e na consistência
//   4. contexto: a tabela de cada liga (1 requisição, guardada 6 h) e o confronto direto dos jogos guardados
//      (1 requisição por jogo, guardada 3 dias); as médias e o confronto da base não custam nada
// O orçamento de requisições é respeitado: ligas e históricos que não cabem ficam de fora e são listados.

import { analyzeMatch, politicaE } from './model.js';
import { collect } from './odds.js';
import { recentGames } from './insights.js';
import { FRIENDLIES, byConsistency, contraAlert, favorSummary, isBet, priceLines, rolesNow, seasonsFor } from './dossier.js';
import { favorFor } from './favoritism.js';
import { GOAL_HANDICAP, HIT_MIN, MAIN_LINES, SHOTS, floorOutOfReach, isMain, isMainLine, underOk } from './consistency.js';
import { buildContext } from './context.js';
import { livePlanOf } from './live.js';
import { hardGame } from './hard.js';
import { comboLines, favWinCombos } from './combos.js';
import { conditionsOf, derbyOf, scenarioLines } from './scenario.js';
import { loadClubs } from './clubs.js';
import { multiLegs } from './multiple.js';

export { GOAL_HANDICAP, SHOTS };
export const MAIN_MARKETS = Object.keys(MAIN_LINES);   // escanteios 1T, escanteios do jogo, gols 1T, gols do jogo
export const SCAN_MARKETS = MAIN_MARKETS.concat(GOAL_HANDICAP, SHOTS, '1X2');
// "Melhor do jogo": a melhor linha entre handicap de gols, gols e 1X2 — escanteios e chutes só nas abas deles
// (chutes: difícil achar a linha nas casas)
export const BEST_MARKETS = [GOAL_HANDICAP, 'Total de gols', 'Total de gols 1T', '1X2'];
// Filtros da tela (abas): cada mercado, e "Chutes" juntando total e no gol
export const SHOTS_FILTER = 'Chutes';
const GROUPS = { [SHOTS_FILTER]: SHOTS };
export const LIVE_1H = 'live1h';   // filtro da tela: jogos para a entrada ao vivo nos escanteios do 1º tempo
export const COMBOS = 'combos';    // filtro da tela: combos de duas pernas no mesmo jogo (combos.js)
export const CENARIO = 'cenario';  // filtro da tela: apostas de cenário com odd perto de 2 (scenario.js)
export const FILTER_KEYS = [...MAIN_MARKETS, GOAL_HANDICAP, SHOTS_FILTER, '1X2', COMBOS];
const GOALS_ONLY = ['Total de gols 1T', 'Total de gols', GOAL_HANDICAP, '1X2'];
const TZ = 'America/Sao_Paulo';
export const brDate = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ });   // AAAA-MM-DD em Brasília
// MIN_GAMES: jogos-equivalentes (com o decaimento) de cada time na base para analisar o jogo (gols);
// MIN_CORNERS: com estatística de escanteios, para os mercados de escanteios (jogo e 1º tempo) — menor, porque
// as forças encolhem para a média da liga e o total vem ancorado na Pinnacle quando ela cota (time promovido
// com 6–7 jogos na liga já tem escanteios).
const LEAGUE_COST = 70, TEAM_COST = 10, MIN_GAMES = 8, MIN_CORNERS = 6;
// Janela de horas: com menos de 1,5 × N jogos com odds nas horas pedidas, a janela cresce de 4 em 4 horas até
// MAX_HOURS, para a lista ter opções (de manhã e em dia de semana, 4 horas têm poucos jogos).
const MAX_HOURS = 12, STEP_HOURS = 4;
const DAY = 864e5;
// Liga sem histórico suficiente dos times (seleções, copas, base, feminino, 2ª fase): a base passa a ser
// os jogos dos times em todas as competições (3 temporadas, até 4 anos), juntando todos os times do mesmo
// torneio no dia — os confrontos entre eles (eliminatórias, Nations League) ligam as forças. Amistoso pesa metade.
async function teamPool(api, fixtures, S, onProgress) {
  const teams = new Map(fixtures.flatMap(f => [[f.home.id, f.home.name], [f.away.id, f.away.name]]));
  const cutoff = Date.now() - 4 * 365 * DAY, byId = new Map();
  let i = 0;
  for (const [id, name] of teams) {
    i++;
    for (const s of [S, S - 1, S - 2]) {
      try {
        for (const m of await api.teamMatches(id, s, (d, n) => onProgress(`${name} ${s}: estatísticas ${d}/${n}…`)))
          if (m.t >= cutoff) byId.set(m.id, m);
      } catch { /* temporada sem jogos */ }
    }
    onProgress(`Histórico dos times (${i}/${teams.size}): ${name}…`);
  }
  return [...byId.values()].map(m => (m.lg === FRIENDLIES ? { ...m, wm: 0.5 } : m));
}
const r2 = x => Math.round(x * 100) / 100;

// jogável: acerto ≥ 60% (piso do Jeferson: abaixo disso a linha nem aparece), odd mínima na faixa operada
// (1,50–3,00) e que uma casa soft alcance quando é o próprio piso, linha que o mercado oferece (não "favorito +x")
// e nenhum under (só over, regra do Jeferson)
const playable = l => l.p_blend >= HIT_MIN && l.odd_min >= 1.5 && !floorOutOfReach(l) && politicaE(l.odd_min).factor > 0 && !l.inviable && underOk(l);
// Melhor linha de um jogo: maior chance de ganho — aposta (candidata âncora/sólida, preço que a casa paga, sem
// contexto contra) primeiro; senão a mais consistente jogável. market: um mercado ou null (todos os da varredura).
export function bestLine(lines, { market = null } = {}) {
  const ms = market == null ? BEST_MARKETS : GROUPS[market] || [market];
  const pool = lines.filter(l => ms.includes(l.market) && playable(l)).sort(byConsistency);
  return pool.find(isBet) || pool[0] || null;
}

// favor: calibração da base (favoritism.js): escanteios por gol de superioridade na liga.
// extra: { table (tabela da liga), h2h (confrontos da API) } para o contexto.
// Sem gols suficientes na base o jogo fica de fora (thin: tenta de novo pela base dos times); sem escanteios
// suficientes, segue só com os mercados de gols.
function analyze(fx, matches, oddsP, banca, teamBase = false, favor = null, extra = {}) {
  const { odds, fair } = collect(oddsP.bookmakers);
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair, share1hBelow: 0.5, favor });
  const thin = (k, min = MIN_GAMES) => [fx.home, fx.away].filter(t => (res.fits[k]?.games.get(t.id) || 0) < min).map(t => t.name).join(' e ');
  if (!res.lines.length || thin('goals')) return { skip: `${thin('goals') || 'os times'} com menos de ${MIN_GAMES} jogos na base`, thin: true };
  const cornersThin = thin('corners', MIN_CORNERS);
  const noCorners = !cornersThin ? null : res.prep.coverage === 0
    ? 'só gols: a API não tem estatística de escanteios dos jogos desta base'
    : `só gols: ${cornersThin} com menos de ${MIN_CORNERS} jogos com estatística de escanteios na base`;
  const markets = noCorners ? GOALS_ONLY : SCAN_MARKETS;
  const now = rolesNow(res.favor);
  const teams = [['home', fx.home], ['away', fx.away]].map(([role, t]) => ({ role, name: t.name, games: recentGames(res.prep, t.id), roleNow: now[role] }));
  const ageMin = oddsP.updatedAt ? Math.round((Date.now() - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const alerts = ageMin > 90 ? [`odds da Pinnacle com ${ageMin} min`] : [];
  if (teamBase) alerts.push('base: jogos dos dois times em todas as competições (amostra menor que a de uma liga)');
  const names = { home: fx.home.name, away: fx.away.name }, contra = !noCorners && contraAlert(res.favor, names);
  if (contra) alerts.push(contra);
  // jogo difícil de analisar (base/reservas, ou ligas diferentes sem jogos entre elas): só over de gols da Pinnacle
  const hard = hardGame({ fx, rows: res.prep.rows });
  if (hard) alerts.push(`jogo difícil de analisar: ${hard.reasons.join('; ')}`);
  const context = buildContext({ rows: res.prep.rows, fx, table: extra.table || [], extra: extra.h2h || [], res, fair, derby: extra.derby || null,
    clubs: extra.clubs || null });
  // as linhas principais: com preço da Pinnacle (direto ou derivado do total que ela cota) e, nos escanteios
  // que ela não cota neste jogo, só do modelo (margem de 8%; só vira aposta se for âncora)
  const { priced, anchored } = priceLines(res, { odds, fair, alerts, teams, banca, only: l => markets.includes(l.market), context, hard });
  const lines = priced.filter(isMainLine).concat(anchored.filter(l => isMain(l.id)));
  const best = Object.fromEntries(SCAN_MARKETS.map(m => [m, bestLine(lines, { market: m })]));
  // combos de duas pernas (resultado + over de gols), pela matriz de placares da Pinnacle + modelo
  const combos = comboLines({ res, fair, teams, names, banca, hard });
  // e a vitória do favorito + gols, para o "mesmo jogo" do Plano do dia
  const favCombos = favWinCombos({ res, fair, teams, names, banca, hard });
  // nossa análise: as linhas de gols da Pinnacle (1X2, handicap, over) pela nossa leitura, com as condições do jogo
  // (entrar se…: escalação de time de base, copa, dúvida); a Pinnacle como segunda opinião
  const conditions = conditionsOf({ fx, hard, injuries: extra.injuries || [], clubs: extra.clubs || null });
  const scenario = scenarioLines(context.ctx.scenario, priced.filter(l => ['1X2', GOAL_HANDICAP, 'Total de gols'].includes(l.market)),
    { banca, hard, conditions }).slice(0, 6);
  const a = res.anchors, h1 = !noCorners;
  return {
    fx, teams, lines, best, combos, fav_combos: favCombos, scenario, conditions, injuries: extra.injuries || null, alerts, odds_age_min: ageMin, team_base: teamBase, no_corners: noCorners,
    favor: res.favor && Object.fromEntries(Object.entries(res.favor).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
    favor_text: favorSummary(res.favor, names),
    c1_known: teams.map(t => t.games.filter(g => g.c1).length),
    pinnacle_1h: h1 && a.corners1h ? { line: a.corners1h.from_line, total: r2(a.corners1h.pinnacle_total), model: r2(a.corners1h.model_total) } : null,
    share_1h: h1 && a.corners1hShare ? r2(a.corners1hShare.share) : null,
    expected_1h: h1 && res.pred.corners1h ? { home: r2(res.pred.corners1h.h), away: r2(res.pred.corners1h.a) } : null,
    context: context.ctx, h2h_api: !!extra.h2h,
    hard, live1h: h1 && !hard ? livePlanOf(res) : null,
    corners: cornersStatus(lines, noCorners),
  };
}

// Escanteios no jogo, para o resumo da varredura: de onde vem o preço das linhas e se alguma é jogável/aposta.
const CORNER_MARKETS = ['Total escanteios 1T', 'Total de escanteios'];
function cornersStatus(lines, noCorners) {
  if (noCorners) return { status: 'sem estatística' };
  const ls = lines.filter(l => CORNER_MARKETS.includes(l.market));
  const src = l => (l.priced_by === 'pinnacle' ? 'pinnacle' : l.derived ? 'derivada' : 'modelo');
  const by = ls.reduce((o, l) => ({ ...o, [src(l)]: (o[src(l)] || 0) + 1 }), {});
  const playableLs = ls.filter(playable);
  return { status: !ls.length ? 'sem linha' : !playableLs.length ? 'fora da faixa' : playableLs.some(isBet) ? 'aposta' : 'jogável',
    source: by.pinnacle ? 'pinnacle' : by.derivada ? 'derivada' : by.modelo ? 'modelo' : null };
}

// Ordem dos jogos pela chance de ganho: a melhor linha de cada um (no filtro pedido), apostas primeiro, depois
// consistência. market LIVE_1H: os jogos com plano ao vivo do 1º tempo, pelos escanteios esperados no 1º tempo.
export function rankGames(games, opts = {}) {
  // só jogos com aposta de cenário: linha "sem aposta" na lista vira sugestão (07/10: 23 apostas em linhas sem aposta)
  // nossa análise: jogos com aposta ou "entrar se…" (condicional), aposta primeiro e maior valor primeiro
  if (opts.market === CENARIO) return games.filter(g => g.scenario?.some(l => l.bet || l.conditional))
    .map(g => ({ g, line: g.scenario.find(l => l.bet) || g.scenario.find(l => l.conditional) }))
    .sort((a, b) => b.line.bet - a.line.bet || (b.line.ev_pinnacle ?? 0) - (a.line.ev_pinnacle ?? 0));
  if (opts.market === COMBOS) return games.filter(g => g.combos?.length).map(g => ({ g, line: g.combos.find(isBet) || g.combos[0] }))
    .sort((a, b) => isBet(b.line) - isBet(a.line) || byConsistency(a.line, b.line));
  if (opts.market === LIVE_1H) return games.filter(g => g.live1h).map(g => ({ g, line: null }))
    .sort((a, b) => b.g.live1h.anchored - a.g.live1h.anchored || b.g.live1h.mu - a.g.live1h.mu);
  return games.map(g => ({ g, line: bestLine(g.lines, opts) })).filter(x => x.line)
    .sort((a, b) => isBet(b.line) - isBet(a.line) || byConsistency(a.line, b.line));
}

// Os N jogos de um filtro: os de maior chance de ganho, mostrados em ordem de horário (o mais próximo
// primeiro; no mesmo horário, a chance desempata) ou pela chance.
export function pickGames(games, { market = null, top = 20, order = 'time' } = {}) {
  const best = rankGames(games, { market }).slice(0, top);
  return order === 'time' ? best.sort((a, b) => a.g.fx.t - b.g.fx.t) : best;
}

// api: o mesmo conjunto do dossiê (dayFixtures, dayOdds, hasLeague, leagueMatches, attachHalfCorners, standings,
// headToHead, stats). Janela: hours (as próximas N horas a partir de now) ou date (o dia inteiro, AAAA-MM-DD).
// half: false pula a 2ª passada (histórico dos escanteios do 1º tempo) — o Plano do dia não usa escanteio do 1º tempo.
// expand: false mantém a janela de horas pedida, mesmo com poucos jogos (o Plano do dia: a janela é a do operador).
export async function scanDay(api, { date = null, hours = null, now = Date.now(), top = 20, budget = 1500, banca = 44000, half = true, expand = true, onProgress = () => {} }) {
  const used = (() => { const s0 = api.stats().api; return () => api.stats().api - s0; })();
  const skipped = [];
  const from = now + 10 * 60e3;
  // Jogos e odds da Pinnacle (todos os mercados que o app lê, 1 requisição por 10 jogos) de cada data em
  // Brasília que a janela cobre: ela pode virar o dia.
  const byDate = new Map(), odds = new Map();
  const loadDate = async d => {
    if (byDate.has(d)) return;
    onProgress(`Buscando os jogos e as odds da Pinnacle de ${d.split('-').reverse().slice(0, 2).join('/')}…`);
    byDate.set(d, await api.dayFixtures(d));
    for (const o of await api.dayOdds(d)) if (o.bookmakers.some(b => b.bets?.length)) odds.set(o.fixture, o);
  };
  const inWindow = to => {
    const seen = new Set();
    return [...byDate.values()].flat().filter(f => f.t > from && f.t <= to && !seen.has(f.id) && seen.add(f.id));
  };
  let span = hours, to = Infinity, fixtures;
  if (hours) {
    // poucas opções nas horas pedidas: a janela cresce até MAX_HOURS
    for (;;) {
      to = now + span * 3600e3;
      for (const d of new Set([brDate(now), brDate(to)])) await loadDate(d);
      fixtures = inWindow(to);
      if (!expand || fixtures.filter(f => odds.has(f.id)).length >= Math.ceil(top * 1.5) || span >= Math.max(hours, MAX_HOURS)) break;
      span = Math.min(span + STEP_HOURS, Math.max(hours, MAX_HOURS));
    }
  } else { await loadDate(date); fixtures = inWindow(to); }
  const dates = [...byDate.keys()];
  onProgress(`${fixtures.length} jogos ainda por começar${span > hours ? ` (janela ampliada para ${span} horas)` : ''}. Montando as ligas…`);
  const pool = fixtures.filter(f => odds.has(f.id));
  const has1h = f => odds.get(f.id).bookmakers.some(b => b.bets.some(x => x.id === 77));
  const oddsOf = fx => odds.get(fx.id);
  const leagues = new Map();
  for (const f of pool) {
    const k = f.league.id;
    if (!leagues.has(k)) leagues.set(k, { lg: f.league, fixtures: [], cached: await api.hasLeague(k, f.league.season) });
    leagues.get(k).fixtures.push(f);
  }
  // ligas já guardadas primeiro (custo ~0), depois as com mais jogos
  const order = [...leagues.values()].sort((a, b) => b.cached - a.cached || b.fixtures.length - a.fixtures.length);

  // 1ª passada: modelo com a média do 1º tempo vinda dos escanteios do jogo
  const base = new Map(), favorBy = new Map(), tableBy = new Map(), games = [];
  let li = 0;
  for (const L of order) {
    li++;
    if (!L.cached && used() + LEAGUE_COST > budget) { skipped.push(...L.fixtures.map(f => ({ fx: f, why: 'liga fora do orçamento de requisições' }))); continue; }
    onProgress(`Liga ${li}/${order.length}: ${L.lg.name}${L.cached ? '' : ' (primeira vez: baixando o histórico)'}… · ${used()} requisições`);
    let matches = [];
    try {
      const S = L.lg.season;
      for (const s of seasonsFor(S)) {
        try {
          let ms = await api.leagueMatches(L.lg.id, s, (d, n) => onProgress(`${L.lg.name} ${s}: estatísticas ${d}/${n}… · ${used()} requisições`));
          if (s >= S - 1) ms = await api.attachHalfCorners(L.lg.id, s, ms, null, { onlyCached: true });
          matches = matches.concat(ms);
        } catch (e) { if (s === S) throw e; }
      }
    } catch (e) { skipped.push(...L.fixtures.map(f => ({ fx: f, why: `liga não carregou: ${e.message}` }))); continue; }
    onProgress(`${L.lg.name}: medindo favoritismo × escanteios na liga… · ${used()} requisições`);
    const fv = favorFor(matches);
    matches = fv.matches;
    favorBy.set(L.lg.id, fv.cal);
    base.set(L.lg.id, matches);
    tableBy.set(L.lg.id, await leagueTable(api, L.lg, used, budget));
    for (const fx of L.fixtures) {
      const a = analyze(fx, matches, oddsOf(fx), banca, false, fv.cal, { table: tableBy.get(L.lg.id) });
      if (a.skip) skipped.push({ fx, why: a.skip, thin: a.thin }); else games.push(a);
    }
  }

  // Jogos cuja liga não tem histórico dos times: base pelos jogos dos times, um conjunto por torneio
  const byLeague = new Map();
  for (const s of skipped.filter(x => x.thin)) {
    if (!byLeague.has(s.fx.league.id)) byLeague.set(s.fx.league.id, []);
    byLeague.get(s.fx.league.id).push(s);
  }
  for (const group of [...byLeague.values()].sort((a, b) => b.length - a.length)) {
    const fxs = group.map(s => s.fx), lg = fxs[0].league;
    const cost = fxs.length * 2 * TEAM_COST;
    if (used() + cost > budget) { group.forEach(s => { s.why = 'times sem histórico na liga; base pelos times fora do orçamento'; }); continue; }
    onProgress(`${lg.name}: montando a base pelos jogos dos times… · ${used()} requisições`);
    let matches;
    try { matches = await teamPool(api, fxs, lg.season, t => onProgress(`${lg.name}: ${t} · ${used()} requisições`)); }
    catch (e) { group.forEach(s => { s.why = `base pelos times falhou: ${e.message}`; }); continue; }
    const fvp = favorFor(matches);
    matches = fvp.matches;
    favorBy.set(`tp${lg.id}`, fvp.cal);   // à parte da base da liga: os outros jogos da liga seguem nela
    base.set(`tp${lg.id}`, matches);
    if (!tableBy.has(lg.id)) tableBy.set(lg.id, await leagueTable(api, lg, used, budget));
    for (const s of group) {
      const a = analyze(s.fx, matches, oddsOf(s.fx), banca, true, fvp.cal, { table: tableBy.get(lg.id) });
      if (a.skip) s.why = `${a.skip}, mesmo somando todas as competições`;
      else { games.push(a); skipped.splice(skipped.indexOf(s), 1); }
    }
  }

  // 2ª passada: histórico do 1º tempo dos dois times nos jogos mais promissores nos escanteios do 1º tempo
  const short = half ? rankGames(games, { market: 'Total escanteios 1T' }).slice(0, Math.ceil(top * 1.5)) : [];
  let gi = 0;
  for (const { g } of short) {
    gi++;
    const missing = g.teams.reduce((n, t) => n + t.games.filter(x => !x.c1).length, 0);
    if (missing && used() + Math.min(missing, 2 * TEAM_COST) > budget) { g.no_history = 'sem histórico do 1º tempo (orçamento)'; continue; }
    if (!missing) continue;
    onProgress(`Histórico do 1º tempo ${gi}/${short.length}: ${g.fx.home.name} x ${g.fx.away.name} · ${used()} requisições`);
    const key = g.team_base ? `tp${g.fx.league.id}` : g.fx.league.id;
    const matches = base.get(key), byId = new Map(matches.map(m => [m.id, m]));
    try {
      for (const t of [g.fx.home, g.fx.away]) {
        const last = matches.filter(m => (m.h === t.id || m.a === t.id) && m.t < g.fx.t).sort((x, y) => y.t - x.t).slice(0, 10);
        const withC1 = await api.attachHalfCorners(`tm${t.id}`, g.fx.league.season, last);
        for (const m of withC1) if (m.c1 && byId.has(m.id)) byId.get(m.id).c1 = m.c1;
      }
      const a = analyze(g.fx, matches, oddsOf(g.fx), banca, g.team_base, favorBy.get(key), { table: tableBy.get(g.fx.league.id) });
      if (!a.skip) Object.assign(g, a);
    } catch (e) { g.no_history = `histórico do 1º tempo falhou: ${e.message}`; }
  }

  // Guardados: os N melhores de cada filtro da tela (todos os mercados, cada um e o ao vivo do 1º tempo).
  const keepOf = () => {
    const keep = new Set();
    for (const market of [CENARIO, null, ...FILTER_KEYS, LIVE_1H]) for (const { g } of rankGames(games, { market }).slice(0, top)) keep.add(g);
    // e os jogos com as melhores pernas de múltipla (over de gols cotado) e com a vitória do favorito + gols mais provável
    const ids = new Set(multiLegs(games, { now }).filter(l => l.quoted).slice(0, top).map(l => l.fixtureId));
    for (const g of games) if (ids.has(g.fx.id)) keep.add(g);
    const fp = g => Math.max(0, ...(g.fav_combos || []).map(c => c.p_blend));
    for (const g of games.filter(g => g.fav_combos?.length).sort((a, b) => fp(b) - fp(a)).slice(0, top)) keep.add(g);
    return keep;
  };
  // 3ª passada: confronto direto em todas as competições (API) dos jogos guardados e clássico (cidade dos dois times,
  // guardada 180 dias), e o contexto refeito com eles
  let gk = 0;
  const kept = [...keepOf()];
  for (const g of kept) {
    gk++;
    if (!api.headToHead && !api.teamInfo) continue;
    if (used() + 1 > budget) { g.no_h2h = 'confronto direto só da base da liga (orçamento de requisições)'; continue; }
    onProgress(`Confronto direto ${gk}/${kept.length}: ${g.fx.home.name} x ${g.fx.away.name} · ${used()} requisições`);
    let h2h = null, derby = null, injuries = null;
    if (api.headToHead) try { h2h = await api.headToHead(g.fx.home.id, g.fx.away.id); } catch (e) { g.no_h2h = `confronto direto da API falhou: ${e.message}`; }
    if (api.teamInfo && used() + 2 <= budget) try { derby = derbyOf(await api.teamInfo(g.fx.home.id), await api.teamInfo(g.fx.away.id)); } catch { /* sem cadastro */ }
    // desfalques e dúvidas (guardados 3 h): entram nas condições do jogo (entrar se…)
    if (api.injuries && used() + 1 <= budget) try { injuries = await api.injuries(g.fx.id); } catch { /* sem desfalques */ }
    // momento dos times (clubs.js): temporada passada, mercado, começo de temporada e a tabela atual inteira
    let clubs = null;
    if (api.transfers) try { clubs = await loadClubs(api, g.fx, { table: tableBy.get(g.fx.league.id) || [], budget: n => used() + n <= budget }); } catch { /* sem */ }
    if (!h2h && !derby && !injuries && !clubs) continue;
    const key = g.team_base ? `tp${g.fx.league.id}` : g.fx.league.id;
    const a = analyze(g.fx, base.get(key), oddsOf(g.fx), banca, g.team_base, favorBy.get(key), { table: tableBy.get(g.fx.league.id), h2h, derby, injuries, clubs });
    if (!a.skip) Object.assign(g, a);
  }
  const keep = keepOf();
  const pos = new Map(rankGames([...keep]).map((x, i) => [x.g, i]));
  const ranked = [...keep].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
  // resumo dos escanteios: por que um jogo tem ou não tem linha de escanteios na lista
  const cornersReport = games.reduce((o, g) => { const k = g.corners?.status || 'sem linha'; o[k] = (o[k] || 0) + 1; return o; }, {});
  for (const g of games) if (g.corners?.source && g.corners.status !== 'sem linha') cornersReport[`preço ${g.corners.source}`] = (cornersReport[`preço ${g.corners.source}`] || 0) + 1;
  // v 11: combos sem o piso de 1,50 na odd mínima e a vitória do favorito + gols (fav_combos); v 10: nossa análise primeiro (modelo corrigido + cenário por nível do adversário; Pinnacle como segunda opinião) e
  // condições do jogo; v 9: leitura de cenário (aba padrão), motivação e clássico; v 8: combos de duas pernas; v 7: só over, chutes e 1X2, "Melhor do jogo" sem escanteios; v 6: jogo difícil de analisar (base/reservas,
  // ligas diferentes); v 5: piso de 60% de acerto e odd mínima com
  // piso de 1,50; v 4: janela de horas, contexto e plano ao vivo do 1º tempo. A tela avisa quando a varredura
  // guardada é de antes
  return { v: 11, mode: hours ? 'janela' : 'dia', date: dates[0], hours: span, asked_hours: hours, window: hours ? { from, to } : null, corners_report: cornersReport,
    generated_at: new Date(now).toISOString(), requests: used(), budget, top, fixtures: fixtures.length,
    with_odds: pool.length, with_1h: pool.filter(has1h).length, analyzed: games.length, games: ranked, skipped };
}

// Tabela da liga (contexto): 1 requisição, guardada 6 h. Sem tabela (copa, falha, orçamento) o jogo segue sem ela.
async function leagueTable(api, lg, used, budget) {
  if (!api.standings || used() + 1 > budget) return [];
  try { return await api.standings(lg.id, lg.season); } catch { return []; }
}
