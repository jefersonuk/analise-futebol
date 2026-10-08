// Contexto do jogo: o que um especialista olha antes de confiar na estatística — posição e situação na tabela,
// média de gols de cada time (temporada e últimos 10 jogos no mando de hoje), o que se espera do confronto
// (modelo e Pinnacle) e o confronto direto. Para cada linha principal, checagens independentes da
// probabilidade dizem se o contexto confirma a linha:
//   mando            acerto da linha nos últimos 10 jogos do mandante em casa e do visitante fora
//   médias           o total (ou o saldo) que as médias dos dois times no mando de hoje apontam, contra a linha
//   confronto direto acerto da linha nos confrontos dos últimos H2H_YEARS anos (3 jogos ou mais)
//   tabela           só nos handicaps: o time apostado está bem acima ou bem abaixo na tabela
//   cenário          a chance da linha pelos jogos de mesmas características dos dois times (scenario.js); contra
//                    por 9 pp ou mais tira a linha das apostas sozinho (a zebra que leva goleada nesse cenário)
// Contexto contra (2 checagens contra e mais contra do que a favor) tira a linha das apostas: a estatística
// sozinha não basta. O confronto direto é amostra pequena (elencos e técnicos mudam): confirma ou levanta
// dúvida, nunca decide sozinho.

import { recentGames } from './insights.js';
import { history } from './dashboard.js';
import { impliedTotal } from './model.js';
import { buildScenario, scenarioSignal, scenarioText, strengthLevels } from './scenario.js';

const DAY = 864e5;
export const H2H_YEARS = 5;   // confronto mais antigo que isso não entra: elencos e técnicos já são outros
const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
const nb = x => String(x).replace('.', ',');
const n1 = x => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const hitTxt = h => `${nb(h.wins)}/${h.bars.length}`;

// Jogos de um time antes do jogo de hoje, do ponto de vista dele (formato de recentGames), mais recentes primeiro.
// venue: 'home' (só em casa), 'away' (só fora) ou null (todos).
export function teamGames(rows, teamId, before, { venue = null, n = 10 } = {}) {
  const ok = m => m.t < before && m.hg != null
    && (venue === 'home' ? m.h === teamId : venue === 'away' ? m.a === teamId : m.h === teamId || m.a === teamId);
  return recentGames({ rows: rows.filter(ok), xg: () => null }, teamId, n);
}

// Confrontos diretos dos últimos H2H_YEARS anos, do ponto de vista do mandante de hoje. rows: a base (com
// estatística); extra: os da API (/fixtures/headtohead, todas as competições, sem estatística).
export function h2hGames(rows, extra, home, away, before, n = 10) {
  const pair = m => (m.h === home && m.a === away) || (m.h === away && m.a === home);
  const byId = new Map();
  for (const m of extra || []) if (pair(m)) byId.set(m.id, m);
  for (const m of rows) if (pair(m)) byId.set(m.id, { ...byId.get(m.id), ...m });   // a base traz os escanteios
  const cut = before - H2H_YEARS * 365 * DAY;
  return recentGames({ rows: [...byId.values()].filter(m => m.t < before && m.t >= cut && m.hg != null), xg: () => null }, home, n);
}

// Os jogos que as checagens usam (recalculáveis de uma análise guardada: base + confrontos da API).
export function contextGames(rows, home, away, before, extra = []) {
  return {
    homeAll: teamGames(rows, home, before), awayAll: teamGames(rows, away, before),
    homeVenue: teamGames(rows, home, before, { venue: 'home' }), awayVenue: teamGames(rows, away, before, { venue: 'away' }),
    h2h: h2hGames(rows, extra, home, away, before),
  };
}

// Médias de uma lista de jogos (do ponto de vista do time): gols, gols do 1º tempo, escanteios e do 1º tempo.
export function profile(games) {
  const g1 = games.filter(g => g.g1), co = games.filter(g => g.corners), c1 = games.filter(g => g.c1);
  return {
    n: games.length,
    gf: r2(avg(games.map(g => g.gf))), ga: r2(avg(games.map(g => g.ga))), goals: r2(avg(games.map(g => g.gf + g.ga))),
    over15: r2(rate(games, g => g.gf + g.ga >= 2)), over25: r2(rate(games, g => g.gf + g.ga >= 3)),
    btts: r2(rate(games, g => g.gf > 0 && g.ga > 0)),
    n_1h: g1.length, goals_1h: r2(avg(g1.map(g => g.g1[0] + g.g1[1]))),
    n_corners: co.length, corners_for: r2(avg(co.map(g => g.corners[0]))), corners_against: r2(avg(co.map(g => g.corners[1]))),
    corners: r2(avg(co.map(g => g.corners[0] + g.corners[1]))),
    n_c1: c1.length, corners_1h: r2(avg(c1.map(g => g.c1[0] + g.c1[1]))),
  };
}

// Linha da tabela de um time (a tabela em que os dois aparecem; senão a de mais jogos), com a situação dele
// e as médias de gols da temporada no total, em casa e fora.
function tableRow(table, teamId, otherId) {
  const mine = table.filter(s => s.team === teamId);
  if (!mine.length) return null;
  const s = mine.find(x => table.some(y => y.team === otherId && y.group === x.group)) || [...mine].sort((a, b) => b.played - a.played)[0];
  const grp = table.filter(x => x.group === s.group);
  const rel = grp.filter(x => /releg|rebaix|descen/i.test(x.zone || '')).map(x => x.rank);
  const relTop = rel.length ? Math.min(...rel) : null, relPts = relTop != null ? grp.find(x => x.rank === relTop)?.points : null;
  const per = (x, n) => (x && n ? { played: n, gf_pg: r2(x.gf / n), ga_pg: r2(x.ga / n) } : null);
  return {
    rank: s.rank, of: grp.length, group: s.group ?? null, points: s.points, played: s.played, gd: s.gd, form: s.form || null, zone: s.zone || null,
    leader_gap: Math.max(...grp.map(x => x.points)) - s.points,
    in_relegation: relTop != null && s.rank >= relTop,
    above_relegation: relPts != null && s.rank < relTop ? s.points - relPts : null,
    season: s.gf != null ? per(s, s.played) : null,
    home: s.home?.gf != null ? per(s.home, s.home.played) : null,
    away: s.away?.gf != null ? per(s.away, s.away.played) : null,
  };
}

// O que o modelo e a Pinnacle esperam do jogo.
function expected(res, fair) {
  const imp = (k, phi) => (fair?.size ? impliedTotal(fair, k, phi)?.implied_total ?? null : null);
  const one = (p, pin) => p && { home: r2(p.h), away: r2(p.a), total: r2(p.h + p.a), pinnacle: r2(pin) };
  return {
    goals: one(res.pred.goals, imp('g', 1)),
    goals_1h: one(res.pred.goals1h, imp('g1', res.phi.goals1h || 1)),
    supremacy: r2(res.favor?.sup), supremacy_source: res.favor?.sup == null ? null : res.favor.source,
    corners: one(res.pred.corners, imp('corners', res.phi.corners || 1)),
    corners_1h: one(res.pred.corners1h, res.anchors?.corners1h?.pinnacle_total),
  };
}

const dateBR = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
function h2hRow(g, home) {
  const score = g.home ? `${home} ${g.gf}–${g.ga} ${g.opp}` : `${g.opp} ${g.ga}–${g.gf} ${home}`;
  const ht = g.g1 ? ` (1T ${g.home ? g.g1[0] : g.g1[1]}–${g.home ? g.g1[1] : g.g1[0]})` : '';
  return `${dateBR(g.t)} ${score}${ht}${g.corners ? ` · ${g.corners[0] + g.corners[1]} esc` : ''}${g.c1 ? ` (${g.c1[0] + g.c1[1]} no 1T)` : ''}${g.league ? ` · ${g.league}` : ''}`;
}

// Contexto do jogo. rows: jogos da base antes do jogo (prep.rows); table: api.standings; extra: api.headToHead;
// res: analyzeMatch; fair: Pinnacle sem margem; derby: clássico (texto) ou null. Devolve { ctx (vai para a tela e o
// especialista), games }.
export function buildContext({ rows, fx, table = [], extra = [], res, fair = null, derby = null }) {
  const H = fx.home, A = fx.away, names = { home: H.name, away: A.name };
  const games = contextGames(rows, H.id, A.id, fx.t, extra);
  const tab = table?.length ? { home: tableRow(table, H.id, A.id), away: tableRow(table, A.id, H.id) } : null;
  const h = games.h2h;
  const ctx = {
    table: tab && (tab.home || tab.away) ? tab : null,
    last10: { home: profile(games.homeAll), away: profile(games.awayAll) },
    venue10: { home: profile(games.homeVenue), away: profile(games.awayVenue) },
    expected: expected(res, fair),
    h2h: { n: h.length, years: H2H_YEARS, home_record: { w: h.filter(g => g.gf > g.ga).length, d: h.filter(g => g.gf === g.ga).length,
      l: h.filter(g => g.gf < g.ga).length }, profile: profile(h), games: h.map(g => h2hRow(g, H.name)) },
  };
  ctx.scenario = scenarioOf({ rows, fx, res, fair, table: ctx.table, derby });
  ctx.text = contextText(ctx, names);
  return { ctx, games, names };
}

// Nossa leitura (scenario.js): o nosso modelo (já corrigido da compressão) + o cenário pelos jogos contra adversários do
// mesmo nível; a Pinnacle (saldo do 1X2 e total dela) só como comparação. Também refaz a leitura de uma análise guardada.
export function scenarioOf({ rows, fx, res, fair = null, table = null, derby = null }) {
  const pin = fair?.size ? impliedTotal(fair, 'g', 1)?.implied_total : null, g = res.pred?.goals;
  const market = pin && res.favor?.source === 'pinnacle_1x2' ? { s: res.favor.sup, T: pin } : null;
  return g ? buildScenario({ rows, fx, base: { s: g.h - g.a, T: g.h + g.a }, market, levels: strengthLevels(res.fits?.goals),
    cal: res.anchors?.goals_cal || null, table, derby }) : null;
}

// ---- checagens por linha ----

// Acerto da linha numa amostra contra a probabilidade da linha: a favor quando o histórico acompanha a
// probabilidade (até 5 pp abaixo), contra quando fica bem abaixo dela (20 pp e no máximo 50%).
function rateSignal(kind, n, wins, p, text, minN) {
  if (n < minN) return { kind, verdict: 'sem dado', text: `${text} (poucos jogos)` };
  const rt = wins / n;
  return { kind, verdict: rt >= p - 0.05 ? 'a favor' : rt <= Math.min(0.5, p - 0.2) ? 'contra' : 'neutro', rate: r2(rt), text };
}

const TOTAL = /^(g|g1|corners|c1)([OU])([\d.]+)$/, HCP = /^(ah|ch)([HA])(-?[\d.]+)$/;
const WHAT = { g: 'gols', g1: 'gols no 1º tempo', corners: 'escanteios', c1: 'escanteios no 1º tempo' };

// O total (ou o saldo do mandante) que as médias dos dois times no mando de hoje apontam: temporada pela
// tabela quando ela tem os gols em casa/fora, senão os últimos 10 jogos no mando.
function averageSignal(id, ctx) {
  const H = ctx.venue10.home, A = ctx.venue10.away, sH = ctx.table?.home?.home, sA = ctx.table?.away?.away;
  const season = sH?.played >= 4 && sA?.played >= 4, last = (k, min = 5) => H[k] != null && A[k] != null && H.n >= min && A.n >= min;
  let m;
  if ((m = id.match(TOTAL))) {
    const [, k, side, Ls] = m, L = +Ls;
    let est = null, src = 'últimos 10 no mando';
    if (k === 'g') {
      if (season) { est = (sH.gf_pg + sA.ga_pg + sA.gf_pg + sH.ga_pg) / 2; src = 'temporada, em casa e fora'; }
      else if (last('goals')) est = (H.goals + A.goals) / 2;
    } else if (k === 'g1') { if (H.n_1h >= 5 && A.n_1h >= 5) est = (H.goals_1h + A.goals_1h) / 2; }
    else if (k === 'corners') { if (H.n_corners >= 5 && A.n_corners >= 5) est = (H.corners + A.corners) / 2; }
    else if (H.n_c1 >= 5 && A.n_c1 >= 5) est = (H.corners_1h + A.corners_1h) / 2;
    if (est == null) return null;
    const margin = { g: 0.3, g1: 0.2, corners: 0.8, c1: 0.4 }[k], d = (side === 'O' ? 1 : -1) * (est - L);
    return { kind: 'médias', verdict: d >= margin ? 'a favor' : d <= -margin ? 'contra' : 'neutro', value: r2(est),
      text: `médias dos dois times: ${n1(est)} ${WHAT[k]} por jogo contra a linha ${nb(L)} (${src})` };
  }
  if ((m = id.match(HCP))) {
    const [, k, side, hs] = m, h = +hs;
    let marg = null, src = 'últimos 10 no mando';
    if (k === 'ah') {
      if (season) { marg = (sH.gf_pg + sA.ga_pg) / 2 - (sA.gf_pg + sH.ga_pg) / 2; src = 'temporada, em casa e fora'; }
      else if (last('gf')) marg = (H.gf + A.ga) / 2 - (A.gf + H.ga) / 2;
    } else if (H.n_corners >= 5 && A.n_corners >= 5) marg = (H.corners_for + A.corners_against) / 2 - (A.corners_for + H.corners_against) / 2;
    if (marg == null) return null;
    const d = (side === 'H' ? marg : -marg) + h, margin = k === 'ah' ? 0.3 : 0.8;   // a aposta ganha com saldo + handicap > 0
    return { kind: 'médias', verdict: d >= margin ? 'a favor' : d <= -margin ? 'contra' : 'neutro', value: r2(marg),
      text: `médias no mando: saldo esperado de ${marg >= 0 ? '+' : '−'}${n1(Math.abs(marg))} ${k === 'ah' ? 'gol' : 'escanteio'} para o mandante (${src})` };
  }
  return null;
}

// Handicaps: dar gols (ou escanteios) para um time bem mais bem colocado é contra; apostar no bem mais bem
// colocado é a favor. Diferença de 4 posições ou mais na mesma tabela.
function tableSignal(id, ctx, names) {
  const m = id.match(HCP), t = ctx.table;
  if (!m || !t?.home || !t?.away || t.home.group !== t.away.group) return null;
  const [back, other, bn, on] = m[2] === 'H' ? [t.home, t.away, names.home, names.away] : [t.away, t.home, names.away, names.home];
  const gap = other.rank - back.rank, h = +m[3];
  return { kind: 'tabela', verdict: gap >= 4 ? 'a favor' : gap <= -4 && h < 0 ? 'contra' : 'neutro',
    text: `tabela: ${bn} ${back.rank}º x ${on} ${other.rank}º` };
}

// Checagens de uma linha. c: { ctx, games, names } (buildContext); p: probabilidade da linha (p_blend).
export function lineContext(id, c, p) {
  const { ctx, games, names } = c, sig = [];
  const hv = history(id, 'home', names.home, games.homeVenue), av = history(id, 'away', names.away, games.awayVenue);
  if (hv && av) sig.push(rateSignal('mando', hv.bars.length + av.bars.length, hv.wins + av.wins, p,
    `${names.home} em casa ${hitTxt(hv)} · ${names.away} fora ${hitTxt(av)}`, 8));
  const a = averageSignal(id, ctx);
  if (a) sig.push(a);
  const hh = history(id, 'home', names.home, games.h2h);
  if (hh && hh.bars.length) sig.push(rateSignal('confronto direto', hh.bars.length, hh.wins, p, `${hitTxt(hh)} nos confrontos diretos`, 3));
  const t = tableSignal(id, ctx, names);
  if (t) sig.push(t);
  const sc = ctx.scenario && scenarioSignal(id, ctx.scenario, p);
  if (sc) sig.push(sc);
  const F = sig.filter(s => s.verdict === 'a favor').length, C = sig.filter(s => s.verdict === 'contra').length;
  const verdict = (C >= 2 && C > F) || sc?.strong ? 'contra' : F >= 2 && C === 0 ? 'a favor' : F && C ? 'misto' : 'neutro';
  return { verdict, favor: F, contra: C, signals: sig };
}

// Uma linha de texto com as checagens (para a tela).
export const contextLine = c => (c ? c.signals.map(s => `${s.kind} ${s.verdict}: ${s.text}`).join(' · ') : '');

// ---- texto ----
const ord = t => `${t.rank}º/${t.of}`;
function situation(t) {
  if (t.in_relegation) return 'na zona de rebaixamento';
  if (t.above_relegation != null && t.above_relegation <= 3) return `${t.above_relegation} pts acima da zona de rebaixamento`;
  if (t.rank <= 4 && t.leader_gap <= 6) return t.leader_gap === 0 ? 'líder' : `${t.leader_gap} pts do líder`;
  return null;
}

// Leitura do contexto em frases curtas, na ordem em que um especialista olha.
export function contextText(ctx, names) {
  const out = [], t = ctx.table, v = ctx.venue10, e = ctx.expected, h = ctx.h2h;
  if (t?.home && t?.away) {
    const one = (x, n) => `${n} ${ord(x)} (${x.points} pts em ${x.played} jogos${situation(x) ? `, ${situation(x)}` : ''})`;
    out.push(`Tabela: ${one(t.home, names.home)} · ${one(t.away, names.away)}.`);
  }
  const sh = t?.home?.home, sa = t?.away?.away;
  if (sh && sa) out.push(`Gols na temporada: ${names.home} em casa marca ${n1(sh.gf_pg)} e sofre ${n1(sh.ga_pg)} por jogo (${sh.played} jogos) · `
    + `${names.away} fora marca ${n1(sa.gf_pg)} e sofre ${n1(sa.ga_pg)} (${sa.played} jogos).`);
  out.push(...scenarioText(ctx.scenario, names));
  const venue = (p, n, where) => (p.n ? `${n} ${where} (${p.n}): ${n1(p.goals)} gols${p.n_1h ? ` (${n1(p.goals_1h)} no 1T)` : ''}`
    + `${p.n_corners ? `, ${n1(p.corners)} escanteios` : ''}${p.n_c1 >= 3 ? ` (${n1(p.corners_1h)} no 1T)` : ''}, over 2,5 em ${Math.round(p.over25 * 100)}%` : null);
  const vs = [venue(v.home, names.home, 'em casa'), venue(v.away, names.away, 'fora')].filter(Boolean);
  if (vs.length) out.push(`Últimos jogos no mando de hoje — ${vs.join(' · ')}.`);
  if (e.goals) {
    const sup = e.supremacy == null ? '' : Math.abs(e.supremacy) < 0.35 ? '; jogo equilibrado'
      : `; ${e.supremacy > 0 ? names.home : names.away} favorito por ${n1(Math.abs(e.supremacy))} gol${e.supremacy_source === 'pinnacle_1x2' ? ' (Pinnacle)' : ''}`;
    const parts = [`${n1(e.goals.total)} gols (${names.home} ${n1(e.goals.home)} x ${n1(e.goals.away)} ${names.away}${e.goals.pinnacle ? `; Pinnacle ${n1(e.goals.pinnacle)}` : ''})${sup}`];
    if (e.corners) parts.push(`${n1(e.corners.total)} escanteios${e.corners.pinnacle ? ` (Pinnacle ${n1(e.corners.pinnacle)})` : ''}`);
    if (e.corners_1h) parts.push(`${n1(e.corners_1h.total)} escanteios no 1º tempo${e.corners_1h.pinnacle ? ` (Pinnacle ${n1(e.corners_1h.pinnacle)})` : ''}`);
    out.push(`Esperado: ${parts.join(' · ')}.`);
  }
  if (h.n) {
    const p = h.profile, rec = h.home_record;
    out.push(`Confronto direto (${h.n} jogo${h.n > 1 ? 's' : ''} em ${h.years} anos): ${n1(p.goals)} gols por jogo, over 2,5 em ${Math.round(p.over25 * h.n)}/${h.n}`
      + `${p.n_1h ? `, ${n1(p.goals_1h)} no 1T` : ''}${p.n_corners ? `, ${n1(p.corners)} escanteios (${p.n_corners} com dado)` : ''}`
      + ` · ${names.home} ${rec.w}V ${rec.d}E ${rec.l}D.${h.n < 3 ? ' Amostra pequena: só ilustra.' : ''}`);
  } else out.push(`Confronto direto: nenhum jogo entre os dois nos últimos ${h.years} anos.`);
  return out;
}
