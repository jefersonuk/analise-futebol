// Dossiê de um jogo para o especialista: o mesmo modelo do app + Pinnacle sem margem, desfalques,
// classificação, descanso, histórico e consistência de cada linha. Usado pelo app (navegador) e pelo
// script do agente (scripts/analisar.mjs), para que os dois vejam exatamente os mesmos números.
//
// api: searchTeams, upcoming, leaguesOf, leagueMatches, fixtureOdds, injuries, standings, lastPlayed, quota

import { METRICS, analyzeMatch, ev, fairOdd, impliedTotal, politicaE } from './model.js';
import { rank } from './ratings.js';
import { buildInsights, recentGames } from './insights.js';
import { collect } from './odds.js';
import { history } from './dashboard.js';
import { ODD_FLOOR, TIER_ORDER, consistency } from './consistency.js';
import { HALF_FROM } from './client.js';

const DAY = 864e5;
// Mercados em que o Jeferson concentra o trabalho (painel e candidatas de foco).
export const FOCUS = ['Total de gols', 'Handicap escanteios 1T'];
export const ODDS_STALE_MIN = 90;   // acima disso a odd da API provavelmente já andou
// Peso do modelo na mistura log-linear com a Pinnacle (o resto é da Pinnacle). Valores iniciais
// do relatório (0,05–0,15 em mercados líquidos; mais onde a Pinnacle é fraca); calibrar por CLV.
const W_MODEL = { '1X2': 0.1, 'Handicap asiático': 0.1, 'Total de gols': 0.1, 'Ambas marcam': 0.1,
  'Total de escanteios': 0.2, 'Escanteios por time': 0.2, 'Total de chutes': 0.2, 'Total de chutes no gol': 0.2 };

// Lado de uma linha: Mais de 8,5 e Mais de 9,5 escanteios, ou Fora +0,5 e Fora +0,75, são o mesmo lado
// do mesmo mercado em preços diferentes.
export const side = id => (/^[12X]$/.test(id) ? '1X2' : id.replace(/-?[\d.]+$/, ''));
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

// fx: jogo (de upcoming). team: time buscado. fixtures: próximos jogos dele (evita chamada repetida).
// matches/lg: jogos da liga já baixados pelo app (opcional). banca em R$.
// oddsPayload: resultado de api.fixtureOdds já buscado pelo app (para a tabela e o dossiê usarem as mesmas odds).
export async function buildDossier(api, { fx, team = fx.home, teams = [], fixtures = [], banca = 44000, matches = null, lg = null, oddsPayload = null, national = false, onProgress }) {
  const S = fx.league.season;
  if (!lg) lg = await resolveBase(api, fx, national);
  if (!lg) throw new Error('os dois times não disputam a mesma liga nesta temporada; confronto entre ligas não é suportado');

  if (!matches) ({ matches } = await loadLeague(api, lg, S, onProgress));
  const seasons = seasonsFor(S);
  onProgress?.('Montando o dossiê (Pinnacle, desfalques, tabela, descanso)…');

  const other = team.id === fx.home.id ? fx.away : fx.home;   // o time que não foi buscado
  const SOURCES = ['odds_pinnacle', 'desfalques', 'classificacao', 'ultimo_jogo_mandante', 'ultimo_jogo_visitante', 'proximos_do_outro_time'];
  const settled = await Promise.allSettled([
    oddsPayload ?? api.fixtureOdds(fx.id), api.injuries(fx.id), lg.national ? [] : api.standings(lg.cross ? fx.league.id : lg.id, S),
    api.lastPlayed(fx.home.id), api.lastPlayed(fx.away.id), api.upcoming(other.id),
  ]);
  const val = (i, d) => (settled[i].status === 'fulfilled' ? settled[i].value : d);
  const sources = Object.fromEntries(SOURCES.map((n, i) =>
    [n, settled[i].status === 'fulfilled' ? 'ok' : `falhou: ${settled[i].reason?.message}`]));
  const oddsP = val(0, { updatedAt: null, fetchedAt: Date.now(), bookmakers: [] });
  const { odds, fair } = collect(oddsP.bookmakers);
  const oddsAgeMin = oddsP.updatedAt ? Math.round((oddsP.fetchedAt - Date.parse(oddsP.updatedAt)) / 60e3) : null;
  const injuries = val(1, []), table = val(2, []);
  const res = analyzeMatch(matches, fx.home.id, fx.away.id, fx.t, { fair });
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
  const hist = l => {
    const one = (role, t) => {
      const h = history(l.id, role, t.name, recent[t.id]);
      return h && { what: h.what, threshold: h.threshold, hits: `${h.wins}/${h.bars.length}`, wins: h.wins, n: h.bars.length,
        values_newest_first: h.bars.map(b => b.v).reverse() };
    };
    return { home: one('home', fx.home), away: one('away', fx.away) };
  };
  const g1x2 = ['1', 'X', '2'];
  const x12 = g1x2.every(id => fair.has(id)) ? (() => {
    const lines = g1x2.map(id => res.lines.find(l => l.id === id));
    const raw = lines.map((l, i) => fair.get(g1x2[i]) ** 0.9 * cond(l) ** 0.1), z = raw.reduce((s, x) => s + x, 0);
    return Object.fromEntries(g1x2.map((id, i) => [id, raw[i] / z]));
  })() : {};

  // Entrada pela fórmula do app, na odd mínima: ¼ Kelly, teto 300·min(1, p/0,70), fator da Política E.
  const stake = (p, odd) => {
    const evv = p * odd - 1, kelly = evv / (odd - 1), cap = 300 * Math.min(1, p / 0.7), pe = politicaE(odd);
    const raw = Math.max(0, banca * kelly * 0.25);
    return { ev_at_min: r(evv), kelly_quarter_brl: Math.round(raw), cap_brl: Math.round(cap), politica_e: pe.label,
      entry_brl: Math.round(Math.min(raw, cap) * pe.factor) };
  };

  const priced = [], anchored = [], modelOnly = [];
  for (const l of res.lines) {
    const pm = cond(l), range = l.sc.map(cond), odd = odds.get(l.id), pp = fair.get(l.id);
    const soft = /escanteios|chutes/i.test(l.market);
    const base = { id: l.id, market: l.market, line: l.label, p_model: r(pm), p_model_range: [r(Math.min(...range)), r(Math.max(...range))],
      fair_odd_model: r(fairOdd(l), 2), push_prob: r(1 - l.pWin - l.pLose) || 0 };
    const hi = hist(l), cons = p => consistency({ p, pLow: Math.min(...range), hits: [hi.home, hi.away].filter(Boolean) });
    if (odd && pp != null) {
      const pb = x12[l.id] ?? blend(pp, pm, W_MODEL[l.market] ?? 0.1), e = ev(l, odd), diff = (pm - pp) * 100;
      const fragile = alerts.length > 0 || Math.abs(diff) >= (soft ? 10 : 5);
      const oddMin = (1 / pb) * (fragile ? 1.05 : 1.03), c = cons(pb);
      priced.push({ ...base, priced_by: 'pinnacle', pinnacle_odd: odd, p_pinnacle: r(pp), diff_pp: r(diff, 1), p_blend: r(pb),
        tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(c.hit_rate, 2),
        fair_odd_blend: r(1 / pb, 2), fragile, odd_min: r(oddMin, 2),
        odd_min_vs_pinnacle_pct: r((oddMin / odd - 1) * 100, 1), ...stake(pb, oddMin),
        ev_model_at_pinnacle: r(e.mid), ev_model_worst: r(e.low), history: hi });
    } else if (l.market === 'Handicap escanteios 1T' && res.anchors.corners1h) {
      // Sem preço na API: modelo com o total ancorado na Pinnacle (total de escanteios 1T); sempre frágil.
      const oddMin = (1 / pm) * 1.05, c = cons(pm);
      anchored.push({ ...base, priced_by: 'modelo ancorado no total 1T da Pinnacle', pinnacle_odd: null, p_pinnacle: null, diff_pp: null,
        p_blend: r(pm), tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(c.hit_rate, 2),
        fair_odd_blend: r(1 / pm, 2), fragile: true, odd_min: r(oddMin, 2), odd_min_vs_pinnacle_pct: null,
        ...stake(pm, oddMin), history: hi });
    } else if (pm >= 0.35 && soft) {
      const c = cons(pm);
      if (c.tier !== 'especulativa' || pm <= 0.65)
        modelOnly.push({ ...base, tier: c.tier, consistency_score: r(c.score), hit_rate_last10: r(c.hit_rate, 2),
          odd_min_model_only: r(fairOdd(l) * 1.08, 2), history: hi });
    }
  }
  priced.sort((a, b) => Math.abs(b.diff_pp) - Math.abs(a.diff_pp));
  // Candidatas — consistência primeiro, preço depois: só linhas âncora/sólida, com odd mínima dentro da
  // faixa operada (≥ 1,50 e permitida pela Política E) e que uma casa soft consegue pagar (até ~5% acima da Pinnacle).
  // Ordem: nível de consistência, não frágil antes de frágil, score de consistência, facilidade do preço.
  const ranked = l => l.tier !== 'especulativa' && l.odd_min >= ODD_FLOOR && l.politica_e !== 'não entrar'
    && (l.odd_min_vs_pinnacle_pct == null || l.odd_min_vs_pinnacle_pct <= 5);
  const order = (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.fragile - b.fragile
    || b.consistency_score - a.consistency_score || (a.odd_min_vs_pinnacle_pct ?? 99) - (b.odd_min_vs_pinnacle_pct ?? 99);
  const candidatesFocus = priced.concat(anchored).filter(l => FOCUS.includes(l.market) && ranked(l))
    .sort(order).filter(distinct()).slice(0, 8).map(l => l.id);
  const candidates = priced.concat(anchored)
    .filter(ranked)
    .sort(order)
    .filter(distinct()).slice(0, 8).map(l => l.id);

  const imp = (prefix, phi) => {
    const x = impliedTotal(fair, prefix, phi);
    return x && { from_line: x.from_line, p_over_no_vig: r(x.p_over_no_vig), implied_total: r(x.implied_total, 2) };
  };
  const impliedTotals = { goals: imp('g', 1), corners: imp('corners', res.phi.corners || 1), corners1h: imp('c1', res.phi.corners1h || 1) };

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
      odd_min: 'fair_odd_blend × 1,03 (× 1,05 se frágil); linhas só do modelo: fair_odd_model × 1,08',
      entry: `¼ Kelly sobre banca de R$ ${banca} com p_blend na odd mínima, teto 300·min(1, p/0,70), × fator da Política E dessa odd`,
      odds_cache: 'odds da Pinnacle com até 10 minutos de cache',
      consistency: 'score = 0,5·p + 0,25·p_pior_cenário + 0,25·acerto_10_jogos_encolhido (10 jogos de peso para p); '
        + 'âncora: p ≥ 0,60, pior cenário ≥ 0,50 e cada time ≥ 6/10; sólida: p ≥ 0,52, pior cenário ≥ 0,42 e acerto somado ≥ 50%; resto especulativa',
      candidates: 'âncora/sólida, odd mínima ≥ 1,50 e permitida pela Política E, até 5% acima da Pinnacle; ordem: nível, não frágil, score, preço; candidates_focus: o mesmo só nos mercados de foco',
      corners_1h_handicap: 'a API não traz odd de handicap de escanteios do 1º tempo: média de cada time pelo modelo, total puxado 80% para o total 1T implícito na Pinnacle, diferença com binomial negativa na dispersão da diferença medida na liga; odd mínima = justa × 1,05, sempre frágil' },
  };
  return out;
}
