// Plano do dia: a análise do dia inteiro reduzida a poucas entradas, para apostar na noite anterior. Proposta do
// Jeferson (08/10/2026): "as melhores oportunidades, poucas entradas — 5 a 10 simples, 2 múltiplas e 5 múltiplas no
// mesmo jogo"; a varredura de horas em horas tomava tempo demais.
//
// Regras:
// - um jogo entra uma vez só no plano (nunca duas entradas no mesmo jogo), e jogo que já tem entrada fica fora;
// - à noite a escalação ainda não saiu: fica fora tudo o que depende dela ("entrar se…": copa, time de base/B, dúvida,
//   leitura longe da Pinnacle, amostra curta, começo de temporada com mudança grande) e o jogo difícil de analisar;
// - simples, em duas frentes — as duas valem, o plano não escolhe uma (pedido do Jeferson, 09/10/2026: "pode ter valor
//   discordando da Pinnacle, mas também concordando com ela; absorva tudo de melhor"):
//     🎯 nossa leitura: as apostas da nossa análise (odd da Pinnacle de 1,80 a 2,70, pagando a nossa mínima), pelo valor
//        conservador — a nossa chance encolhida pela metade na direção da Pinnacle, na odd dela;
//     🤝 acordo com a Pinnacle: as linhas consistentes (âncora ou sólida, 60%+, histórico dos times e contexto que não é
//        contra, odd da Pinnacle na própria linha) em que o modelo não discorda dela (no máximo 3 pp abaixo); o valor
//        está na casa pagar a mínima (até 5% acima da Pinnacle); ordem: contexto a favor, âncora, consistência;
//   uma de cada, alternando, até 10 (de 5 a 10 quando o dia tem; não força), no máximo 3 por liga;
// - mesmo jogo: a vitória do favorito + mais de 1,5 gols — ou de 2,5, quando a de 1,5 paga menos de 1,60 — com chance de
//   50%+ e odd mínima até 2,70, os de maior chance, nos jogos que sobraram (pedido do Jeferson, 09/10/2026: a dupla chance
//   + gols acerta muito, mas a casa paga bem abaixo de 1,50; a vitória do favorito + gols sai perto de 2);
// - múltiplas: as pernas de over de gols com linha cotada (multiple.js), nos jogos que sobraram; 2 bilhetes até a odd
//   justa do alvo, as melhores pernas no primeiro.
// A escolha dos jogos segue essa ordem: simples, mesmo jogo, múltiplas.

import { isBet } from './dossier.js';
import { MAX_LEGS, TARGET, bandTickets, multiGames, ticketOf } from './multiple.js';

export const SINGLES = [5, 10], SAME_GAME = 5, MULTIS = 2, PER_LEAGUE = 3, ODDS = [1.8, 2.7];
export const COMBO_P = 0.5, COMBO_ODDS = [1.6, 2.7];   // mesmo jogo: chance mínima e faixa da odd mínima
export const LENS = { ours: '🎯 nossa leitura', agree: '🤝 acordo com a Pinnacle' };
const AGREE_MARKETS = ['Total de gols', 'Handicap asiático', '1X2', 'Total de escanteios', 'Total escanteios 1T'];
const r3 = x => Math.round(x * 1000) / 1000;

// Valor conservador de uma simples: a nossa chance encolhida pela metade na direção da Pinnacle, na odd dela.
export const valueOf = l => r3(((l.p_nossa + l.p_pinnacle) / 2) * l.pinnacle_odd - 1);
// A simples de um jogo (a de maior valor) e o combo (o de maior chance).
const singleOf = g => (g.hard ? null : (g.scenario || [])
  .filter(l => l.bet && !l.conditional && l.p_pinnacle != null && l.pinnacle_odd >= ODDS[0] && l.pinnacle_odd <= ODDS[1])
  .map(l => ({ l, v: valueOf(l) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v || b.l.p_nossa - a.l.p_nossa)[0] || null);
// 🤝 a linha consistente do jogo que concorda com a Pinnacle; need: quanto a casa precisa pagar acima da Pinnacle.
// Como na 🎯, fica fora o jogo que depende da escalação (copa, base/B, dúvida, começo de temporada com mudança grande).
const agreeOf = g => (g.hard || g.conditions?.length ? null : (g.lines || [])
  .filter(l => AGREE_MARKETS.includes(l.market) && isBet(l) && !l.model_only && !l.derived && l.pinnacle_odd > 1 && l.p_pinnacle != null
    && l.p_model != null && l.p_model >= l.p_pinnacle - 0.03)
  .sort((a, b) => (b.context?.verdict === 'a favor') - (a.context?.verdict === 'a favor') || (b.tier === 'âncora') - (a.tier === 'âncora')
    || b.consistency_score - a.consistency_score || b.p_blend - a.p_blend)[0] || null);
export const needOf = l => r3(l.odd_min / l.pinnacle_odd - 1);
// mesmo jogo: a vitória do favorito + 1,5 gols; se ela pagar pouco, + 2,5 (fav_combos vem nessa ordem). Como nas simples,
// fica fora o jogo que depende da escalação.
export const comboOk = c => c.p_blend >= COMBO_P && c.odd_min >= COMBO_ODDS[0] && c.odd_min <= COMBO_ODDS[1];
const comboOf = g => (g.hard || g.conditions?.length ? null : (g.fav_combos || []).find(comboOk) || null);
// o bilhete na odd da Pinnacle quando ela cota todas as pernas (perna asiática: sem a odd dela)
export const multiOf = (legs, banca) => ticketOf(legs, { houseTotal: legs.every(l => l.pinnacle_odd > 1) ? legs.reduce((t, l) => t * l.pinnacle_odd, 1) : null, banca });

// O plano de uma varredura. exposed: entry.js exposedGames() (jogos que já têm entrada) ou null.
export function buildPlan(scan, { exposed = null, now = Date.now(), banca = 44000, target = TARGET } = {}) {
  const future = scan.games.filter(g => g.fx.t > now + 10 * 60e3);
  const games = future.filter(g => !exposed?.has(g.fx.id, g.fx.home.name, g.fx.away.name));
  const used = new Set(), perLeague = new Map();
  // simples: as duas frentes alternando (🎯, 🤝, 🎯…); acabou uma, a outra completa
  const A = games.map(g => ({ g, s: singleOf(g) })).filter(x => x.s).sort((a, b) => b.s.v - a.s.v).map(x => ({ g: x.g, line: x.s.l, value: x.s.v, lens: 'ours' }));
  const B = games.map(g => ({ g, line: agreeOf(g) })).filter(x => x.line).map(x => ({ ...x, value: needOf(x.line), lens: 'agree' }));
  const singles = [], take = x => {
    const lg = x.g.fx.league.id ?? x.g.fx.league.name, n = perLeague.get(lg) || 0;
    if (used.has(x.g.fx.id) || n >= PER_LEAGUE) return false;
    perLeague.set(lg, n + 1); used.add(x.g.fx.id); singles.push(x);
    return true;
  };
  for (let ia = 0, ib = 0, na = 0, nb = 0; singles.length < SINGLES[1] && (ia < A.length || ib < B.length);) {
    if (ia < A.length && (na <= nb || ib >= B.length)) { if (take(A[ia++])) na++; } else if (take(B[ib++])) nb++;
  }
  // mesmo jogo
  const sameGame = games.filter(g => !used.has(g.fx.id)).map(g => ({ g, combo: comboOf(g) })).filter(x => x.combo)
    .sort((a, b) => b.combo.p_blend - a.combo.p_blend).slice(0, SAME_GAME);
  sameGame.forEach(x => used.add(x.g.fx.id));
  // múltiplas: as melhores pernas no primeiro bilhete (sem faixa de horário: à noite tudo é apostado de uma vez)
  const legs = multiGames(games.filter(g => !used.has(g.fx.id)), { now }).map(m => m.best).filter(l => l.quoted);
  const multis = bandTickets(legs, { target, band: 72, maxLegs: MAX_LEGS }).slice(0, MULTIS).map(ls => multiOf(ls, banca));
  const byTime = (a, b) => a.g.fx.t - b.g.fx.t;
  return { date: scan.date || null, scan_at: scan.generated_at, target, singles: singles.sort(byTime), sameGame: sameGame.sort(byTime), multis,
    stats: { games: scan.games.length, future: future.length, exposed: future.length - games.length,
      waiting: games.filter(g => !used.has(g.fx.id) && (g.scenario || []).some(l => l.conditional) && !(g.scenario || []).some(l => l.bet)).length } };
}

// O plano guardado pelas chaves (fica igual ao registrar entradas: a exposição muda, o plano não).
export const planKeys = plan => ({ scan_at: plan.scan_at, date: plan.date, target: plan.target,
  singles: plan.singles.map(x => [x.g.fx.id, x.line.id, x.lens]), sameGame: plan.sameGame.map(x => [x.g.fx.id, x.combo.id]),
  multis: plan.multis.map(t => t.legs.map(l => [l.fixtureId, l.lineId])) });
export function planFromKeys(scan, keys, { banca = 44000 } = {}) {
  const g = id => scan.games.find(x => x.fx.id === id);
  const opts = new Map(multiGames(scan.games, { now: 0 }).flatMap(m => m.options.map(o => [`${o.fixtureId}:${o.lineId}`, o])));
  const singles = keys.singles.map(([f, id, lens = 'ours']) => {
    const x = g(f), l = (lens === 'agree' ? x?.lines : x?.scenario)?.find(s => s.id === id);
    return l && { g: x, line: l, value: lens === 'agree' ? needOf(l) : valueOf(l), lens };
  });
  const sameGame = keys.sameGame.map(([f, id]) => { const x = g(f), c = [...(x?.fav_combos || []), ...(x?.combos || [])].find(s => s.id === id); return c && { g: x, combo: c }; });
  const multis = keys.multis.map(ls => ls.map(([f, id]) => opts.get(`${f}:${id}`))).filter(ls => ls.every(Boolean)).map(ls => multiOf(ls, banca));
  if (singles.some(x => !x) || sameGame.some(x => !x)) return null;   // a varredura mudou: monta de novo
  return { date: keys.date, scan_at: keys.scan_at, target: keys.target, singles, sameGame, multis, stats: null };
}

// Texto do plano para copiar (bloco de notas, WhatsApp) e apostar nas casas.
export function planText(plan, { dateLabel = plan.date } = {}) {
  const nb = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
  const hh = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const out = [`PLANO ${dateLabel}`];
  if (plan.singles.length) {
    out.push('', `SIMPLES (${plan.singles.length})`);
    plan.singles.forEach(({ g, line, lens }, i) => out.push(`${i + 1}. ${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name} — ${line.line} · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)})${line.entry_brl ? ` · R$ ${line.entry_brl}` : ''} · ${LENS[lens || 'ours']}`));
  }
  plan.multis.forEach((t, i) => {
    out.push('', `MÚLTIPLA ${i + 1} (${t.n} pernas) · odd total ≥ ${nb(t.min)} · ${t.asian ? 'não perde' : 'acerta tudo'} ${Math.round(t.p_all * 100)}%${t.stake || t.stake_at_min ? ` · R$ ${t.stake || t.stake_at_min}` : ''}`);
    t.legs.forEach(l => out.push(`   ${hh(l.kickoff)} ${l.home} x ${l.away} — ${l.line} (≥ ${nb(l.min)})`));
  });
  if (plan.sameGame.length) {
    out.push('', `MESMO JOGO (${plan.sameGame.length})`);
    plan.sameGame.forEach(({ g, combo }, i) => out.push(`${i + 1}. ${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name} — ${combo.line} · odd ≥ ${nb(combo.odd_min)}${combo.entry_brl ? ` · R$ ${combo.entry_brl}` : ''}`));
  }
  return out.join('\n');
}
