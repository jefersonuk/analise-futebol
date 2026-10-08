// Leitura de cenário: como cada time se comporta em jogos com as MESMAS características do de hoje, e não na
// média da temporada ou nos últimos 10 jogos misturados. Um favorito forte em casa que goleia quando é favorito
// forte em casa, contra uma zebra que leva goleada quando é zebra forte fora, não é o mesmo jogo que a média
// diz (lição de 07/10/2026: handicap positivo na zebra acertou 46% contra 65% previstos, com favoritos vencendo
// por 3 ou 4 gols).
//
//   papel      pela superioridade de gols esperada ANTES de cada jogo, sem olhar o futuro (favoritism.js, m.sup):
//              favorito forte (≥ 1 gol), favorito (0,35–1), equilibrado, zebra, zebra forte (≤ −1)
//   cenário    os jogos do time no mesmo mando e no mesmo papel de hoje; com menos de MIN_N, o mesmo papel em
//              qualquer mando, depois o mando de hoje com o papel vizinho
//   além do    em cada jogo, saldo real − saldo esperado (e total real − total esperado): quem passa do esperado
//   esperado   no cenário (o favorito que goleia, a zebra que desaba) ou fica aquém dele
//   leitura    a superioridade e o total da Pinnacle corrigidos pelos dois cenários, encolhidos pela amostra
//              (K = 20 jogos de peso: em 15 jogos o saldo além do esperado ainda erra ~0,4 gol) e com teto de
//              CAP gol. A chance "pelo cenário" de cada linha é a da Pinnacle sem margem mais o quanto essa
//              correção move a linha na matriz de placares
//   motivação  pela tabela: briga pelo título, vaga, rebaixamento, nada a disputar
//   clássico   os dois times da mesma cidade (cadastro do time na API)
//
// Aposta de cenário (odd perto de 2, regra do Jeferson de 08/10/2026: melhor acertar 50% a odd 2 do que 60% a
// 1,50): linha que a Pinnacle cota com odd de ALVO[0] a ALVO[1], chance pelo cenário ≥ 45%, a Pinnacle pagando
// pelo menos EDGE acima do que o cenário diz ser justo, cenário com amostra nos dois times e os dois apontando
// para o mesmo lado. Só over nos gols.

import { politicaE, scoreMatrix, settle, stakeFor } from './model.js';

export const BANDS = ['favorito forte', 'favorito', 'equilibrado', 'zebra', 'zebra forte'];
export const bandOf = sup => (sup == null ? null : sup >= 1 ? 0 : sup >= 0.35 ? 1 : sup > -0.35 ? 2 : sup > -1 ? 3 : 4);
export const MIN_N = 6, MAX_N = 15, K = 20, CAP = 0.6, ALVO = [1.8, 2.7], EDGE = 0.05, P_MIN = 0.45;
const YEARS = 3, DAY = 864e5;
const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const nb = x => String(x).replace('.', ',');
const n1 = x => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const sgn1 = x => `${x >= 0 ? '+' : '−'}${n1(Math.abs(x))}`;
const clamp = (x, c) => Math.max(-c, Math.min(c, x));
const dateBR = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

// Jogos de um time (do ponto de vista dele) com a superioridade esperada antes de cada um.
function games(rows, team, before) {
  const cut = before - YEARS * 365 * DAY;
  return rows.filter(m => m.t < before && m.t >= cut && m.hg != null && m.sup != null && (m.h === team || m.a === team))
    .sort((a, b) => b.t - a.t)
    .map(m => {
      const home = m.h === team;
      return { t: m.t, home, opp: home ? m.an : m.hn, league: m.ln || '', gf: home ? m.hg : m.ag, ga: home ? m.ag : m.hg,
        sup: home ? m.sup : -m.sup, xt: m.xt ?? null };
    });
}

// Os jogos do cenário de hoje (mando + papel), afrouxando quando a amostra é curta.
export function scenarioGames(rows, team, before, venue, band) {
  const all = games(rows, team, before);
  const pick = (f, how, relaxed) => { const g = all.filter(f).slice(0, MAX_N); return g.length >= MIN_N ? { games: g, how, relaxed } : null; };
  const where = venue === 'home' ? 'em casa' : 'fora';
  return pick(g => g.home === (venue === 'home') && bandOf(g.sup) === band, `${where} como ${BANDS[band]}`, null)
    || pick(g => bandOf(g.sup) === band, `como ${BANDS[band]} (em casa e fora)`, 'qualquer mando')
    || pick(g => g.home === (venue === 'home') && Math.abs(bandOf(g.sup) - band) <= 1, `${where} como ${BANDS[band]} ou papel vizinho`, 'papel vizinho')
    || { games: all.filter(g => g.home === (venue === 'home') && bandOf(g.sup) === band), how: `${where} como ${BANDS[band]}`, relaxed: 'amostra curta' };
}

// Perfil de uma lista de jogos do cenário.
export function scenarioProfile(sel) {
  const g = sel.games, n = g.length, gd = g.map(x => x.gf - x.ga), wx = g.filter(x => x.xt != null);
  return {
    how: sel.how, relaxed: sel.relaxed, n,
    w: g.filter(x => x.gf > x.ga).length, d: g.filter(x => x.gf === x.ga).length, l: g.filter(x => x.gf < x.ga).length,
    gf: r2(avg(g.map(x => x.gf))), ga: r2(avg(g.map(x => x.ga))), gd: r2(avg(gd)), sup: r2(avg(g.map(x => x.sup))),
    resid: n ? r2(avg(g.map(x => x.gf - x.ga - x.sup))) : null,                  // saldo além do esperado, por jogo
    tot_resid: wx.length >= MIN_N ? r2(avg(wx.map(x => x.gf + x.ga - x.xt))) : null, // gols além do esperado, por jogo
    win2: n ? r2(g.filter(x => x.gf - x.ga >= 2).length / n) : null, lose2: n ? r2(g.filter(x => x.ga - x.gf >= 2).length / n) : null,
    over25: n ? r2(g.filter(x => x.gf + x.ga >= 3).length / n) : null, btts: n ? r2(g.filter(x => x.gf && x.ga).length / n) : null,
    games: g.slice(0, 6).map(x => `${dateBR(x.t)} ${x.home ? 'x' : '@'} ${x.opp}: ${x.gf}–${x.ga} (esperado ${sgn1(x.sup)})`),
  };
}

// Motivação pela tabela (context.js tableRow).
export function motivation(t) {
  if (!t) return null;
  if (t.in_relegation) return 'na zona de rebaixamento: precisa pontuar';
  if (t.above_relegation != null && t.above_relegation <= 3) return `${t.above_relegation} pts acima do rebaixamento: pressionado`;
  if (t.leader_gap === 0) return 'líder: briga pelo título';
  if (t.rank <= 3 && t.leader_gap <= 4) return `${t.leader_gap} pts do líder: briga pelo título`;
  if (t.rank <= Math.max(4, Math.round(t.of / 4)) && t.leader_gap <= 9) return 'na briga pelas vagas do topo';
  if (t.played >= t.of && t.leader_gap >= 12 && (t.above_relegation == null || t.above_relegation >= 9)) return 'meio da tabela, sem muito a disputar';
  return null;
}

// Leitura de cenário de um jogo. rows: a base antes do jogo (prep.rows, com m.sup/m.xt); market: { T, s } — total e
// superioridade da Pinnacle (ou do modelo, sem ela); table: { home, away } de context.js; derby: texto ou null.
export function buildScenario({ rows, fx, market, table = null, derby = null }) {
  if (!market || market.s == null || !(market.T > 0)) return null;
  const bH = bandOf(market.s), bA = bandOf(-market.s);
  const H = scenarioProfile(scenarioGames(rows, fx.home.id, fx.t, 'home', bH));
  const A = scenarioProfile(scenarioGames(rows, fx.away.id, fx.t, 'away', bA));
  const sh = (x, n) => (x == null || !n ? 0 : x * n / (n + K));
  const rh = sh(H.resid, H.n), ra = sh(A.resid, A.n);   // ra: do ponto de vista do visitante
  const adjSup = r2(clamp((rh - ra) / 2, CAP));
  const adjTot = r2(clamp((sh(H.tot_resid, H.n) + sh(A.tot_resid, A.n)) / 2, CAP));
  // os dois cenários apontam para o mesmo lado (ou um deles é neutro)?
  const agree = !(Math.abs(rh) >= 0.15 && Math.abs(ra) >= 0.15 && Math.sign(rh) !== Math.sign(-ra));
  const enough = H.n >= MIN_N && A.n >= MIN_N && !H.relaxed?.startsWith('amostra') && !A.relaxed?.startsWith('amostra');
  const sup = market.s + adjSup, T = Math.max(0.6, market.T + adjTot);
  return { band: { home: BANDS[bH], away: BANDS[bA] }, home: H, away: A, adj_sup: adjSup, adj_total: adjTot, agree, enough,
    market: { sup: r2(market.s), total: r2(market.T), source: market.source }, sup: r2(sup), total: r2(T),
    motivation: table ? { home: motivation(table.home), away: motivation(table.away) } : null, derby };
}

// Chance de uma linha de gols numa matriz de placares (total T, superioridade s), sem o push, como a Pinnacle
// precifica; null fora de 1X2/handicap/gols do jogo.
const AH = /^ah([HA])(-?[\d.]+)$/, GO = /^g([OU])([\d.]+)$/;
function probAt(id, T, s0) {
  const s = Math.max(-T + 0.15, Math.min(T - 0.15, s0));
  const { diff, tot } = scoreMatrix((T + s) / 2, (T - s) / 2);
  const neg = e => e.map(([v, p]) => [-v, p]), cond = r => r.pWin / (r.pWin + r.pLose);
  let m;
  if (id === '1') return cond(settle(diff, -0.5));
  if (id === '2') return cond(settle(neg(diff), -0.5));
  if (id === 'X') return diff.find(([d]) => d === 0)?.[1] ?? null;
  if ((m = id.match(AH))) return cond(settle(m[1] === 'H' ? diff : neg(diff), +m[2]));
  if ((m = id.match(GO))) return cond(m[1] === 'O' ? settle(tot, -m[2]) : settle(neg(tot), +m[2]));
  return null;
}
// Quanto o cenário move a chance de uma linha: a matriz corrigida pelo cenário menos a matriz do mercado. Somado à
// chance sem margem da própria Pinnacle, isola o efeito do cenário (a matriz não reproduz cada linha da Pinnacle).
export function scenarioDelta(id, sc) {
  if (!sc) return null;
  const a = probAt(id, sc.total, sc.sup), b = probAt(id, sc.market.total, sc.market.sup);
  return a == null || b == null ? null : a - b;
}
// Chance da linha pelo cenário, a partir da chance de referência p (a da Pinnacle sem margem, ou a da linha).
export const scenarioProb = (id, sc, p) => { const d = scenarioDelta(id, sc); return d == null || p == null ? null : Math.min(0.99, Math.max(0.01, p + d)); };

// As linhas da Pinnacle pela leitura de cenário: chance pelo cenário, EV na odd da Pinnacle e se é aposta de cenário.
// lines: as linhas precificadas (dossier.js priceLines, com pinnacle_odd e p_pinnacle); hard: jogo difícil.
export function scenarioLines(sc, lines, { banca = 44000, hard = null } = {}) {
  if (!sc) return [];
  const out = [];
  for (const l of lines) {
    if (!l.pinnacle_odd || l.p_pinnacle == null || /^(gU|g1)/.test(l.id)) continue;   // só over, e só gols do jogo
    const pc = scenarioProb(l.id, sc, l.p_pinnacle);
    if (pc == null) continue;
    const odd = l.pinnacle_odd, ev = pc * odd - 1, side = /^(1|ahH)/.test(l.id) ? 1 : /^(2|ahA)/.test(l.id) ? -1 : 0;
    const why = [];
    if (odd < ALVO[0] || odd > ALVO[1]) why.push(`odd da Pinnacle ${nb(odd.toFixed(2))} fora do alvo ${nb(ALVO[0].toFixed(2))}–${nb(ALVO[1].toFixed(2))}`);
    if (pc < P_MIN) why.push(`chance pelo cenário ${Math.round(pc * 100)}% (abaixo de ${Math.round(P_MIN * 100)}%)`);
    if (ev < EDGE) why.push(`o cenário não vê valor na odd da Pinnacle (${ev >= 0 ? '+' : ''}${Math.round(ev * 100)}%)`);
    if (!sc.enough) why.push('cenário com amostra curta');
    if (side && !sc.agree) why.push('os dois cenários apontam para lados opostos');
    if (hard) why.push('jogo difícil de analisar');
    if (l.inviable) why.push(l.inviable);
    const oddMin = Math.max(ALVO[0], 1.03 / pc), pe = politicaE(oddMin);
    if (pe.factor === 0) why.push('odd mínima acima de 3,00');
    const { history, context, ...base } = l;   // o histórico de 10 jogos e as checagens são da lente de consistência
    out.push({ ...base, scenario: true, p_scenario: r2(pc), p_blend: r2(pc), ev_pinnacle: r2(ev), fair_odd_blend: r2(1 / pc), odd_min: r2(oddMin),
      odd_min_vs_pinnacle_pct: r2((oddMin / odd - 1) * 100), tier: ev >= 0.1 && sc.home.n >= 8 && sc.away.n >= 8 ? 'cenário forte' : 'cenário',
      priced_by: 'cenário', bet: !why.length, why_not: why, ...stakeFor(pc, oddMin, banca) });
  }
  // handicap −0,5 é a própria vitória: fica só o 1X2
  const ids = new Set(out.map(l => l.id));
  return out.filter(l => !((l.id === 'ahH-0.5' && ids.has('1')) || (l.id === 'ahA-0.5' && ids.has('2'))))
    .sort((a, b) => b.bet - a.bet || b.ev_pinnacle - a.ev_pinnacle);
}

// Clássico local: os dois times da mesma cidade (cadastro do time na API: venue.city).
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const derbyOf = (a, b) => (a?.city && b?.city && norm(a.city) === norm(b.city) ? `clássico local (${a.city})` : null);

// Checagem de contexto "cenário" de uma linha (context.js): a chance pelo cenário contra a da linha.
export function scenarioSignal(id, sc, p) {
  const d = scenarioDelta(id, sc);
  if (d == null || !sc.enough) return null;
  const pc = Math.min(0.99, Math.max(0.01, p + d)), side = /^(1|ahH)/.test(id) ? 'H' : /^(2|ahA)/.test(id) ? 'A' : null;
  const who = side === 'H' ? 'do mandante' : side === 'A' ? 'do visitante' : '';
  return { kind: 'cenário', verdict: d >= 0.04 ? 'a favor' : d <= -0.06 ? 'contra' : 'neutro', strong: d <= -0.09, p_scenario: r2(pc),
    text: `pelo cenário ${Math.round(pc * 100)}% (linha ${Math.round(p * 100)}%, ${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pp)${side ? ` · linha ${who}` : ''}` };
}

// Frases do cenário para o contexto do jogo.
export function scenarioText(sc, names) {
  if (!sc || (!sc.home.n && !sc.away.n)) return [];
  const one = (p, n) => (p.n ? `${n} ${p.how} (${p.n} jogo${p.n > 1 ? 's' : ''}${p.relaxed ? `, ${p.relaxed}` : ''}): ${p.w}V ${p.d}E ${p.l}D, ${n1(p.gf)}–${n1(p.ga)} por jogo, `
    + `venceu por 2+ em ${Math.round(p.win2 * p.n)}, perdeu por 2+ em ${Math.round(p.lose2 * p.n)}, `
    + `${Math.abs(p.resid) < 0.05 ? 'saldo no esperado' : `${sgn1(p.resid)} gol de saldo ${p.resid > 0 ? 'acima' : 'abaixo'} do esperado`}`
    : `${n} ${p.how}: sem jogos`);
  const out = [`Cenário — ${one(sc.home, names.home)} · ${one(sc.away, names.away)}.`];
  const n2 = x => Math.abs(x).toFixed(2).replace('.', ',');
  const lean = Math.abs(sc.adj_sup) >= 0.1 ? `${sc.adj_sup > 0 ? names.home : names.away} ${n2(sc.adj_sup)} gol além do que a Pinnacle precifica` : 'em linha com a Pinnacle no saldo';
  out.push(`Leitura de cenário: ${lean}${Math.abs(sc.adj_total) >= 0.1 ? `; ${sc.adj_total >= 0 ? '+' : '−'}${n2(sc.adj_total)} gol no total` : ''}`
    + `${!sc.agree ? ' (os dois cenários discordam: pouca confiança)' : ''}${!sc.enough ? ' (amostra curta)' : ''}.`);
  const mv = sc.motivation;
  if (mv && (mv.home || mv.away)) out.push(`Motivação: ${[mv.home && `${names.home} ${mv.home}`, mv.away && `${names.away} ${mv.away}`].filter(Boolean).join(' · ')}.`);
  if (sc.derby) out.push(`Clássico: ${sc.derby} — jogo de rivalidade foge do padrão; desconfie de goleada e de handicap alto.`);
  return out;
}
