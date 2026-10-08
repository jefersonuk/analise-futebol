// Nossa análise primeiro (regra do Jeferson, 08/10/2026): a base é a NOSSA leitura — o modelo de forças da base,
// corrigido da compressão (favoritism.js goalsCalibration), e o cenário do jogo; a Pinnacle vem depois, como
// segunda opinião, para concordar ou discordar. Podemos discordar dela: essas entradas ficam marcadas
// "contra a Pinnacle" e são medidas à parte no app de apostas (acerto e CLV).
//
//   cenário    cada time comparado com os jogos contra adversários do MESMO NÍVEL do de hoje (forte, médio, fraco
//              pela força na base) e no mesmo mando — não a média da temporada, nem os últimos 10 misturados. O
//              Rosenborg que goleia o HamKam em casa e perde do Molde não é o mesmo time contra o líder.
//   além do    em cada jogo, saldo real − saldo esperado antes dele (já corrigido da compressão) e o mesmo nos gols:
//   esperado   quem rende acima ou abaixo do esperado nesse tipo de jogo
//   leitura    nosso saldo e total = modelo corrigido + a correção dos dois cenários, encolhida pela amostra
//              (K = 20 jogos de peso: em 15 jogos o saldo além do esperado ainda erra ~0,4 gol) e com teto CAP
//   motivação  pela tabela: título, vaga, rebaixamento, nada a disputar
//   clássico   os dois times da mesma cidade (cadastro do time na API)
//
// Entrada (odd perto de 2, regra de 08/10: melhor acertar 50% a 2,00 com valor do que 60% a 1,50):
//   aposta      a nossa chance ≥ 45%, odd mínima (nossa justa × 1,05) ≤ 2,70, e a Pinnacle paga a mínima com odd
//               de 1,80 a 2,70 — o mercado paga o que a nossa leitura pede
//   entrar se…  passaria, mas depende de algo que só se confirma perto do jogo (condições: escalação de time de
//               base, rodízio em copa, dúvida, ou a nossa leitura muito longe da Pinnacle) — conferir 30 min antes
//   na mira     a nossa leitura vê valor, mas a Pinnacle paga abaixo da mínima: entra se a casa pagar ≥ a mínima
// Só over nos gols.

import { politicaE, scoreMatrix, settle, stakeFor } from './model.js';
import { earlyRisk } from './clubs.js';

export const BANDS = ['favorito forte', 'favorito', 'equilibrado', 'zebra', 'zebra forte'];
export const bandOf = sup => (sup == null ? null : sup >= 1 ? 0 : sup >= 0.35 ? 1 : sup > -0.35 ? 2 : sup > -1 ? 3 : 4);
export const LEVELS = ['forte', 'médio', 'fraco'];
export const MIN_N = 5, MAX_N = 15, K = 20, CAP = 0.6, ALVO = [1.8, 2.7], P_MIN = 0.45, MARGIN = 1.05;
export const AGREE_PP = 0.04, CONTRA_PP = 0.05, FAR_PP = 0.12;   // concorda / contra a Pinnacle / longe demais (confirmar)
const YEARS = 3, DAY = 864e5;
const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const nb = x => String(x).replace('.', ',');
const n1 = x => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const n2 = x => (x == null ? '—' : Math.abs(x).toFixed(2).replace('.', ','));
const sgn1 = x => `${x >= 0 ? '+' : '−'}${n1(Math.abs(x))}`;
const sgn2 = x => `${x >= 0 ? '+' : '−'}${n2(x)}`;
const clamp = (x, c) => Math.max(-c, Math.min(c, x));
const pct = x => `${Math.round(x * 100)}%`;
const sgnPP = d => `${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pp`;
const dateBR = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

// Nível de cada time na base (terço de cima, do meio ou de baixo pela força de gols: ataque ÷ defesa).
// fit: res.fits.goals (ratings.js). Times com poucos jogos ficam sem nível.
export function strengthLevels(fit, minGames = 4) {
  const out = new Map();
  if (!fit) return out;
  const s = [...fit.teams].filter(t => (fit.games.get(t) || 0) >= minGames)
    .map(t => [t, Math.log(fit.att.get(t)) - Math.log(fit.def.get(t))]).sort((a, b) => b[1] - a[1]);
  s.forEach(([t], i) => out.set(t, LEVELS[Math.min(2, Math.floor(3 * i / s.length))]));
  return out;
}

// Jogos de um time (do ponto de vista dele) com o esperado antes de cada um, corrigido da compressão (cal).
function games(rows, team, before, levels, cal) {
  const cut = before - YEARS * 365 * DAY, b = cal?.slope ?? 1, a = cal?.intercept ?? 0, rt = cal?.ratio ?? 1;
  return rows.filter(m => m.t < before && m.t >= cut && m.hg != null && m.sup != null && (m.h === team || m.a === team))
    .sort((x, y) => y.t - x.t)
    .map(m => {
      const home = m.h === team, sup = home ? m.sup : -m.sup;
      return { t: m.t, home, opp: home ? m.an : m.hn, oppLevel: levels.get(home ? m.a : m.h) || null, league: m.ln || '',
        gf: home ? m.hg : m.ag, ga: home ? m.ag : m.hg, sup, exp: (home ? a : -a) + b * sup, xt: m.xt != null ? m.xt * rt : null };
    });
}

// Os jogos do cenário de hoje: mesmo mando e adversário do mesmo nível; com amostra curta, o mesmo nível em
// qualquer mando, depois o mando com o nível vizinho. Sem nível conhecido, o mando de hoje.
export function scenarioGames(rows, team, before, venue, oppLevel, levels = new Map(), cal = null) {
  const all = games(rows, team, before, levels, cal), home = venue === 'home', where = home ? 'em casa' : 'fora';
  const pick = (f, how, relaxed) => { const g = all.filter(f).slice(0, MAX_N); return g.length >= MIN_N ? { games: g, how, relaxed } : null; };
  if (!oppLevel) return pick(g => g.home === home, `${where} (nível do adversário desconhecido)`, 'sem nível') || { games: all.filter(g => g.home === home), how: where, relaxed: 'amostra curta' };
  const L = LEVELS.indexOf(oppLevel), vs = l => `contra times ${l === 'médio' ? 'médios' : l === 'forte' ? 'fortes' : 'fracos'}`;
  return pick(g => g.home === home && g.oppLevel === oppLevel, `${where} ${vs(oppLevel)}`, null)
    || pick(g => g.oppLevel === oppLevel, `${vs(oppLevel)} (em casa e fora)`, 'qualquer mando')
    || pick(g => g.home === home && g.oppLevel && Math.abs(LEVELS.indexOf(g.oppLevel) - L) <= 1, `${where} ${vs(oppLevel)} ou de nível vizinho`, 'nível vizinho')
    || { games: all.filter(g => g.home === home && g.oppLevel === oppLevel), how: `${where} ${vs(oppLevel)}`, relaxed: 'amostra curta' };
}

// Perfil de uma lista de jogos do cenário.
export function scenarioProfile(sel) {
  const g = sel.games, n = g.length, wx = g.filter(x => x.xt != null);
  return {
    how: sel.how, relaxed: sel.relaxed, n,
    w: g.filter(x => x.gf > x.ga).length, d: g.filter(x => x.gf === x.ga).length, l: g.filter(x => x.gf < x.ga).length,
    gf: r2(avg(g.map(x => x.gf))), ga: r2(avg(g.map(x => x.ga))), gd: r2(avg(g.map(x => x.gf - x.ga))), exp: r2(avg(g.map(x => x.exp))),
    resid: n ? r2(avg(g.map(x => x.gf - x.ga - x.exp))) : null,                     // saldo além do esperado, por jogo
    tot_resid: wx.length >= MIN_N ? r2(avg(wx.map(x => x.gf + x.ga - x.xt))) : null, // gols além do esperado, por jogo
    win2: n ? r2(g.filter(x => x.gf - x.ga >= 2).length / n) : null, lose2: n ? r2(g.filter(x => x.ga - x.gf >= 2).length / n) : null,
    over25: n ? r2(g.filter(x => x.gf + x.ga >= 3).length / n) : null, btts: n ? r2(g.filter(x => x.gf && x.ga).length / n) : null,
    games: g.slice(0, 6).map(x => `${dateBR(x.t)} ${x.home ? 'x' : '@'} ${x.opp}${x.oppLevel ? ` (${x.oppLevel})` : ''}: ${x.gf}–${x.ga} (esperado ${sgn1(x.exp)})`),
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

// Nossa leitura de um jogo. rows: a base antes do jogo (prep.rows, com m.sup/m.xt); base: { s, T } do nosso modelo
// (já corrigido); market: { s, T } da Pinnacle ou null; levels: strengthLevels; cal: a correção (goals_cal);
// table: { home, away } de context.js; derby: texto ou null.
export function buildScenario({ rows, fx, base, market = null, levels = new Map(), cal = null, table = null, derby = null }) {
  if (!base || base.s == null || !(base.T > 0)) return null;
  const lvH = levels.get(fx.away.id) || null, lvA = levels.get(fx.home.id) || null;   // o nível do ADVERSÁRIO de cada um
  const H = scenarioProfile(scenarioGames(rows, fx.home.id, fx.t, 'home', lvH, levels, cal));
  const A = scenarioProfile(scenarioGames(rows, fx.away.id, fx.t, 'away', lvA, levels, cal));
  const sh = (x, n) => (x == null || !n ? 0 : x * n / (n + K));
  const rh = sh(H.resid, H.n), ra = sh(A.resid, A.n);   // ra: do ponto de vista do visitante
  const adjSup = r2(clamp((rh - ra) / 2, CAP));
  const adjTot = r2(clamp((sh(H.tot_resid, H.n) + sh(A.tot_resid, A.n)) / 2, CAP));
  const agree = !(Math.abs(rh) >= 0.15 && Math.abs(ra) >= 0.15 && Math.sign(rh) !== Math.sign(-ra));
  const enough = H.n >= MIN_N && A.n >= MIN_N && H.relaxed !== 'amostra curta' && A.relaxed !== 'amostra curta';
  const sup = base.s + adjSup, T = Math.max(0.6, base.T + adjTot);
  return { band: { home: BANDS[bandOf(sup)], away: BANDS[bandOf(-sup)] }, level: { home: lvA, away: lvH }, home: H, away: A,
    adj_sup: adjSup, adj_total: adjTot, agree, enough,
    base: { sup: r2(base.s), total: r2(base.T), calibrated: !!cal }, market: market ? { sup: r2(market.s), total: r2(market.T) } : null,
    sup: r2(sup), total: r2(T), motivation: table ? { home: motivation(table.home), away: motivation(table.away) } : null, derby };
}

// Chance de uma linha de gols numa matriz de placares (total T, saldo s), sem o push, como a Pinnacle precifica;
// null fora de 1X2/handicap/gols do jogo.
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
// A nossa chance de uma linha (modelo corrigido + cenário) e a do modelo sozinho (sem o cenário).
// Leitura no formato atual (análises guardadas antes da nossa análise não têm o modelo separado do cenário).
export const isScenario = sc => sc?.base?.total != null && sc.total != null;
export const scenarioProb = (id, sc) => (isScenario(sc) ? probAt(id, sc.total, sc.sup) : null);
export const modelProb = (id, sc) => (isScenario(sc) ? probAt(id, sc.base.total, sc.base.sup) : null);
// Quanto o cenário move a linha sobre o nosso modelo.
export function scenarioDelta(id, sc) {
  const a = scenarioProb(id, sc), b = modelProb(id, sc);
  return a == null || b == null ? null : a - b;
}

// Condições do jogo que só se confirmam perto do horário (entrar se…). hard: hard.js; injuries: desfalques da API
// ({ team, player, type, reason }); clubs: clubs.js (começo de temporada com mudança de divisão ou de elenco).
const CUP = /cup|copa|pokal|coupe|coppa|taça|taca|beker|kupa|pucar|trophy|shield|supercopa/i;
export function conditionsOf({ fx, hard = null, injuries = [], clubs = null }) {
  const out = [];
  const early = earlyRisk(clubs, { home: fx.home.name, away: fx.away.name });
  if (early.length) out.push(`começo de temporada com mudança grande (${early.join('; ')}): a força de hoje ainda não está nos dados — conferir escalação e notícias`);
  if (hard?.reasons?.some(r => /base, reservas|competição de base/.test(r))) out.push('time de base/B: o elenco muda toda semana — confirmar a escalação');
  if (CUP.test(fx.league?.name || '') || fx.league?.type === 'Cup') out.push('copa: risco de rodízio — confirmar a escalação');
  const doubt = injuries.filter(i => /question|doubt|dúvida/i.test(`${i.type} ${i.reason}`));
  if (doubt.length) out.push(`dúvida: ${doubt.slice(0, 4).map(i => `${i.player} (${i.team === fx.home.id ? fx.home.name : fx.away.name})`).join(', ')} — confirmar se joga`);
  return out;
}
// O jogo não tem base para a nossa leitura (ligas diferentes sem jogos entre elas): nada de entrada.
const unmeasured = hard => hard?.reasons?.some(r => /entre times das duas ligas/.test(r));

// As linhas da Pinnacle pela nossa leitura. lines: as linhas precificadas (dossier.js priceLines: pinnacle_odd,
// p_pinnacle); conditions: conditionsOf; hard: jogo difícil (hard.js). Cada linha: a nossa chance, a do modelo
// sem o cenário, a da Pinnacle, a diferença, a odd mínima e o status (aposta, entrar se…, na mira, sem aposta).
export function scenarioLines(sc, lines, { banca = 44000, hard = null, conditions = [] } = {}) {
  if (!isScenario(sc)) return [];
  const out = [];
  for (const l of lines) {
    if (/^(gU|g1)/.test(l.id)) continue;   // só over, e só gols do jogo
    const p = scenarioProb(l.id, sc);
    if (p == null) continue;
    const pm = modelProb(l.id, sc), pp = l.p_pinnacle ?? null, odd = l.pinnacle_odd ?? null;
    const diff = pp != null ? p - pp : null, oddMin = MARGIN / p, pe = politicaE(oddMin);
    const why = [];   // o que falta para ser entrada
    if (p < P_MIN) why.push(`a nossa chance é ${pct(p)} (abaixo de ${pct(P_MIN)})`);
    if (pe.factor === 0) why.push(`odd mínima ${nb(oddMin.toFixed(2))} acima de 3,00`);
    else if (oddMin > ALVO[1]) why.push(`odd mínima ${nb(oddMin.toFixed(2))} acima do alvo de ${nb(ALVO[1].toFixed(2))}`);
    if (unmeasured(hard)) why.push('ligas diferentes sem jogos entre elas: a diferença de nível não está medida');
    if (l.inviable) why.push(l.inviable);
    const cond = [...conditions];
    if (diff != null && Math.abs(diff) >= FAR_PP) cond.push(`a nossa leitura está ${Math.round(Math.abs(diff) * 100)} pp ${diff > 0 ? 'acima' : 'abaixo'} da Pinnacle — conferir escalação e notícias`);
    if (!sc.enough) cond.push('cenário com amostra curta — conferir escalação');
    // o mercado paga a nossa mínima? (sem odd da Pinnacle na linha, depende da casa)
    const pays = odd != null && odd >= oddMin && odd >= ALVO[0] && odd <= ALVO[1];
    const status = why.length ? 'sem aposta' : !pays ? 'na mira' : cond.length ? 'entrar se' : 'aposta';
    const contra = diff != null && diff >= CONTRA_PP;
    const { history, context, ...rest } = l;   // o histórico de 10 jogos e as checagens são da lente de consistência
    out.push({ ...rest, scenario: true, ours: true, p_nossa: r2(p), p_scenario: r2(p), p_model_cal: r2(pm), p_blend: r2(p),
      diff_pp: diff == null ? null : r2(diff * 100), agrees: diff == null ? null : Math.abs(diff) < AGREE_PP, contra,
      ev_pinnacle: odd ? r2(p * odd - 1) : null, fair_odd_blend: r2(1 / p), odd_min: r2(oddMin),
      odd_min_vs_pinnacle_pct: odd ? r2((oddMin / odd - 1) * 100) : null,
      // de onde vem a diferença para a Pinnacle: o nosso modelo (corrigido) e o cenário
      why: pp != null ? `modelo ${sgnPP(pm - pp)} · cenário ${sgnPP(p - pm)}` : `modelo ${pct(pm)} · cenário ${sgnPP(p - pm)}`,
      status, bet: status === 'aposta', conditional: status === 'entrar se', conditions: status === 'entrar se' ? cond : [], why_not: why,
      tier: contra ? 'contra a Pinnacle' : 'nossa análise', priced_by: 'nossa análise', ...stakeFor(p, oddMin, banca) });
  }
  // handicap −0,5 é a própria vitória: fica só o 1X2
  const ids = new Set(out.map(l => l.id)), RANK = { aposta: 0, 'entrar se': 1, 'na mira': 2, 'sem aposta': 3 };
  return out.filter(l => !((l.id === 'ahH-0.5' && ids.has('1')) || (l.id === 'ahA-0.5' && ids.has('2'))))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || (b.ev_pinnacle ?? -1) - (a.ev_pinnacle ?? -1) || b.p_nossa - a.p_nossa);
}

// Clássico local: os dois times da mesma cidade (cadastro do time na API: venue.city).
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const derbyOf = (a, b) => (a?.city && b?.city && norm(a.city) === norm(b.city) ? `clássico local (${a.city})` : null);

// Checagem de contexto "cenário" de uma linha (context.js): quanto o cenário move a linha sobre o nosso modelo.
export function scenarioSignal(id, sc, p) {
  const d = scenarioDelta(id, sc);
  if (d == null || !sc.enough) return null;
  const pc = Math.min(0.99, Math.max(0.01, p + d)), side = /^(1|ahH)/.test(id) ? 'H' : /^(2|ahA)/.test(id) ? 'A' : null;
  const who = side === 'H' ? 'do mandante' : side === 'A' ? 'do visitante' : '';
  return { kind: 'cenário', verdict: d >= 0.04 ? 'a favor' : d <= -0.06 ? 'contra' : 'neutro', strong: d <= -0.09, p_scenario: r2(pc),
    text: `pelo cenário ${Math.round(pc * 100)}% (linha ${Math.round(p * 100)}%, ${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pp)${side ? ` · linha ${who}` : ''}` };
}

// Frases da nossa leitura para o contexto do jogo.
export function scenarioText(sc, names) {
  if (!isScenario(sc) || (!sc.home?.n && !sc.away?.n)) return [];
  const one = (p, n) => (p.n ? `${n} ${p.how} (${p.n} jogo${p.n > 1 ? 's' : ''}${p.relaxed ? `, ${p.relaxed}` : ''}): ${p.w}V ${p.d}E ${p.l}D, ${n1(p.gf)}–${n1(p.ga)} por jogo, `
    + `venceu por 2+ em ${Math.round(p.win2 * p.n)}, perdeu por 2+ em ${Math.round(p.lose2 * p.n)}, `
    + `${Math.abs(p.resid) < 0.05 ? 'saldo no esperado' : `${sgn1(p.resid)} gol de saldo ${p.resid > 0 ? 'acima' : 'abaixo'} do esperado`}`
    : `${n} ${p.how}: sem jogos`);
  const lv = sc.level && (sc.level.home || sc.level.away) ? ` (nível na base: ${names.home} ${sc.level.home || '—'}, ${names.away} ${sc.level.away || '—'})` : '';
  const out = [`Cenário${lv} — ${one(sc.home, names.home)} · ${one(sc.away, names.away)}.`];
  const fav = s => (Math.abs(s) < 0.1 ? 'jogo parelho' : `${s > 0 ? names.home : names.away} ${n2(s)} gol melhor`);
  const mk = sc.market ? `; a Pinnacle diz ${fav(sc.market.sup)}, total ${n1(sc.market.total)} — ${Math.abs(sc.sup - sc.market.sup) < 0.15 ? 'concorda' : `discordamos em ${n2(sc.sup - sc.market.sup)} gol`}` : '';
  out.push(`Nossa leitura: ${fav(sc.sup)}, ${n1(sc.total)} gols (modelo${sc.base.calibrated ? ' corrigido' : ''} ${sgn2(sc.base.sup)}, cenário ${sgn2(sc.adj_sup)})${mk}`
    + `${!sc.agree ? ' (os dois cenários discordam entre si: pouca confiança)' : ''}${!sc.enough ? ' (amostra curta)' : ''}.`);
  const mv = sc.motivation;
  if (mv && (mv.home || mv.away)) out.push(`Motivação: ${[mv.home && `${names.home} ${mv.home}`, mv.away && `${names.away} ${mv.away}`].filter(Boolean).join(' · ')}.`);
  if (sc.derby) out.push(`Clássico: ${sc.derby} — jogo de rivalidade foge do padrão; desconfie de goleada e de handicap alto.`);
  return out;
}
