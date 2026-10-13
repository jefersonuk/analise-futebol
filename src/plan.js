// Plano do dia: a análise do dia inteiro reduzida a poucas entradas, para apostar na noite anterior. Proposta do
// Jeferson (08/10/2026): "as melhores oportunidades, poucas entradas — 5 a 10 simples, 2 múltiplas e 5 múltiplas no
// mesmo jogo"; a varredura de horas em horas tomava tempo demais.
//
// Regras:
// - um jogo entra uma vez só no plano (nunca duas entradas no mesmo jogo), e jogo que já tem entrada fica fora;
// - à noite a escalação ainda não saiu: fica fora tudo o que depende dela ("entrar se…": copa, time de base/B, dúvida,
//   leitura longe da Pinnacle, amostra curta, começo de temporada com mudança grande) e o jogo difícil de analisar;
// - simples, em três frentes — todas valem, o plano não escolhe uma (pedido do Jeferson, 09/10/2026: "pode ter valor
//   discordando da Pinnacle, mas também concordando com ela; absorva tudo de melhor"):
//     🤝 acordo com a Pinnacle: as linhas cotadas por ela e consistentes (âncora ou sólida: 60%+, pior cenário e histórico
//        dos times; contexto que não é contra) em que o modelo não discorda dela (no máximo 3 pp abaixo). O alvo é a odd
//        justa da linha + 2% (nunca abaixo de 1,50; no total de gols, 1,30) e a linha entra quando o alvo fica até 8% acima
//        da odd da Pinnacle;
//        ordem: contexto a favor, o alvo mais perto da Pinnacle (o mais fácil de achar na casa), consistência;
//     📊 chutes: a Pinnacle não cota, o preço é só do modelo — sólida ou âncora com os dois times batendo a linha em 60%+
//        dos últimos jogos, odd mínima de 1,50 a 3,00, só em liga grande;
//     🎯 nossa leitura: as apostas da nossa análise (odd da Pinnacle de 1,70 no 1X2 e no handicap, de 1,30 no total de
//        gols, até 2,70 — Jeferson, 13/10/2026 —, pagando a nossa mínima), pelo valor conservador — a nossa chance
//        encolhida pela metade na direção da Pinnacle, na odd dela;
//   em rodízio, as de mais acerto primeiro (🤝, 📊, 🎯), até 10 (de 5 a 10 quando o dia tem; não força), no máximo 5 por
//   liga (eram 3; Jeferson, 12/10/2026: rodada cheia da Championship rende mais de 3);
// - revisão das réguas (Jeferson, 13/10/2026: "pouquíssimas oportunidades… a régua alta só se justificaria com alto
//   índice de acerto, o que não é o caso"). No teste do modelo em 3.002 jogos das ligas grandes (out/2025–out/2026, só com
//   os jogos de antes de cada um) e nas simulações de 08 a 12/10:
//     📊 a regra antiga (só âncora — 70%+ — com a mínima do modelo, justa × 1,08, de 1,50 para cima) deixava uma janela de
//        70% a 72% e achava chute em 15 dos 3.002 jogos; o que acrescenta acerto nos chutes é o histórico dos dois times
//        na linha (+4 a +8 pp além da chance do modelo): com ele, 64% dos jogos têm candidata e ela acertou 73,8% (o
//        modelo dizia 70%);
//     🤝 a régua antiga pedia a mínima do app (justa × 1,03, ou × 1,05 com a odd da Pinnacle de mais de 90 min — o normal:
//        a API atualiza a cada ~3 h) até 5% acima da Pinnacle; somada à margem da própria Pinnacle nas ligas grandes
//        (~3,5% no handicap e nos gols, ~6,5% nos escanteios), quase nenhuma linha passava;
//     🎯 a mais fraca no acerto (nas simulações, 44% na odd média de 2,2, sem vantagem sobre a Pinnacle) e o modelo
//        subestima o favorito no handicap e no 1X2 — parte do "valor" no azarão vem disso: fica, mas por último no rodízio;
// - dúvida de desfalque (jogador "Questionable" na API — basta um, até reserva) barra só a 🎯: no 🤝 e no mesmo jogo o
//   preço é o da Pinnacle, que já embute a notícia (Jeferson, 12/10/2026), e nos 📊 chute é volume do time inteiro;
//   copa, base/B e começo de temporada continuam barrando todas as frentes;
// - mesmo jogo: a vitória do favorito + mais de 1,5 gols — ou de 2,5, quando a de 1,5 paga menos de 1,60 — com chance de
//   50%+ e odd mínima até 2,70, os de maior chance, nos jogos que sobraram (pedido do Jeferson, 09/10/2026: a dupla chance
//   + gols acerta muito, mas a casa paga bem abaixo de 1,50; a vitória do favorito + gols sai perto de 2);
// - múltiplas: as pernas de over de gols com linha cotada (multiple.js), nos jogos que sobraram; 2 bilhetes de odd justa
//   6 ou mais ("são bingo", Jeferson, 10/10/2026), as melhores pernas no primeiro: até 6 pernas de mais de 1,5 e, se não
//   chegar a 6, a de 2,5 nos jogos em que ela é mais provável; bilhete que não chega a 6 não entra.
// A escolha dos jogos segue essa ordem: simples, mesmo jogo, múltiplas.
//
// Mercados e ligas (pedido do Jeferson, 10/10/2026): o operador marca os mercados do plano, como na varredura — o
// recorte dele: handicap de gols, escanteios e chutes nas simples, o mesmo jogo e as múltiplas — e, marcado "só ligas
// grandes" (leagues.js), o plano olha só os jogos delas: é onde há dados completos e as casas oferecem as linhas. Chutes
// formam uma terceira frente nas simples (📊: a Pinnacle não cota, o preço é só do modelo) e só em liga grande.

import { HIT_MIN, ODD_FLOOR, SHOTS, floorOf, underOk } from './consistency.js';
import { politicaE, stakeFor } from './model.js';
import { isBig } from './leagues.js';
import { MAX_LEGS, MULTI, TARGET, legOrder, multiGames, ticketOf } from './multiple.js';
import { alvoOf, isDoubt } from './scenario.js';
import { STAKE, money } from './stake.js';

export const SINGLES = [5, 10], SAME_GAME = 5, MULTIS = 2, PER_LEAGUE = 5;
export const COMBO_P = 0.5, COMBO_ODDS = [1.6, 2.7];   // mesmo jogo: chance mínima e faixa da odd mínima
// ⏱️ favorito no 1º tempo (favhalf.js): até 3, com a odd da Pinnacle de 1,70 a 2,70 (a faixa do 1X2)
export const HALF_KEY = 'fav1t', HALF_MAX = 3, HALF_ODDS = [1.7, 2.7];
export const LENS = { ours: '🎯 nossa leitura', agree: '🤝 acordo com a Pinnacle', shots: '📊 chutes (só o modelo)' };
// Os mercados do plano (a marcação na tela): [chave, rótulo]. Padrão: o recorte do Jeferson (10/10/2026).
export const COMBO_KEY = 'combos', SHOTS_KEY = 'Chutes';
export const PLAN_OPTIONS = [['Handicap asiático', 'Handicap de gols'], ['Total de gols', 'Gols'], ['1X2', '1X2'], ['Total de escanteios', 'Escanteios'],
  ['Total escanteios 1T', 'Escanteios 1T'], [SHOTS_KEY, 'Chutes'], [COMBO_KEY, 'Mesmo jogo'], [HALF_KEY, 'Favorito no 1º tempo'], [MULTI, 'Múltiplas (odd 6+)']];
// padrão: o recorte do Jeferson (10/10/2026) aberto em 13/10 ("expanda o leque"): gols, 1X2 e o favorito no 1º tempo
export const PLAN_DEFAULT = ['Handicap asiático', 'Total de gols', '1X2', 'Total de escanteios', 'Total escanteios 1T', SHOTS_KEY, COMBO_KEY, HALF_KEY, MULTI];
// as opções que existiam antes de 13/10: numa marcação guardada antes, as novas entram pelo padrão (planview.js)
export const PLAN_OPTIONS_V1 = ['Handicap asiático', 'Total de escanteios', 'Total escanteios 1T', SHOTS_KEY, COMBO_KEY, MULTI, 'Total de gols', '1X2'];
// a linha está nos mercados marcados (null = todos)? Chutes cobre o total e o no gol
const inMarkets = (markets, l) => !markets || markets.includes(l.market) || (SHOTS.includes(l.market) && markets.includes(SHOTS_KEY));
const AGREE_MARKETS = ['Total de gols', 'Handicap asiático', '1X2', 'Total de escanteios', 'Total escanteios 1T'];
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;

// Valor conservador de uma simples: a nossa chance encolhida pela metade na direção da Pinnacle, na odd dela.
export const valueOf = l => r3(((l.p_nossa + l.p_pinnacle) / 2) * l.pinnacle_odd - 1);
// O jogo tem condição que barra a frente? doubt: false ignora a dúvida de desfalque (🤝 e mesmo jogo: preço da Pinnacle).
const barred = (g, { doubt = true } = {}) => (g.conditions || []).some(c => doubt || !isDoubt(c));
// Nas funções de cada frente, loose: como seria sem a regra da escalação (o "entrar se…" e as condições do jogo) — só
// para o funil dizer quantos jogos ela tirou.
// A simples de um jogo (a de maior valor) e o combo (o de maior chance).
const singleOf = (g, markets, loose = false) => (g.hard ? null : (g.scenario || [])
  .filter(l => (l.bet || (loose && l.conditional)) && l.p_pinnacle != null && l.pinnacle_odd >= alvoOf(l.market)[0] && l.pinnacle_odd <= alvoOf(l.market)[1] && inMarkets(markets, l))
  .map(l => ({ l, v: valueOf(l) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v || b.l.p_nossa - a.l.p_nossa)[0] || null);
// 🤝 o alvo (a odd que a casa precisa pagar): a justa da linha (a Pinnacle sem margem com o modelo) + AGREE_EDGE, nunca
// abaixo do piso do núcleo (1,50); a linha entra quando ele fica até REACH acima da odd da Pinnacle. Não usa a mínima do
// app (odd_min): ela já leva 3% (5% com a odd da Pinnacle de mais de 90 min) e, somada à margem da Pinnacle, passava de 5%.
export const AGREE_EDGE = 1.02, REACH = 0.08;
export const agreeMin = l => r2(Math.max(floorOf(l.market), AGREE_EDGE / l.p_blend));
export const needOf = l => r3(l.odd_min / l.pinnacle_odd - 1);
// a linha do 🤝 no plano: o alvo no lugar da mínima, e a entrada por ele (¼ Kelly, Política E)
export const agreeLine = (l, banca = 44000) => { const m = agreeMin(l); return { ...l, odd_min: m, odd_min_vs_pinnacle_pct: r2((m / l.pinnacle_odd - 1) * 100), ...stakeFor(l.p_blend, m, banca) }; };
// consistente (âncora/sólida), só over, viável, sem bloqueio nem contexto contra, e o alvo ao alcance de uma casa
const agreeOk = l => l.tier !== 'especulativa' && underOk(l) && !l.inviable && !l.blocked && l.context?.verdict !== 'contra'
  && agreeMin(l) / l.pinnacle_odd - 1 <= REACH && politicaE(agreeMin(l)).factor > 0;
// contexto a favor, o alvo mais perto da Pinnacle (o mais fácil de achar), âncora, consistência
const agreeOrder = (a, b) => (b.context?.verdict === 'a favor') - (a.context?.verdict === 'a favor') || needOf(a) - needOf(b)
  || (b.tier === 'âncora') - (a.tier === 'âncora') || b.consistency_score - a.consistency_score || b.p_blend - a.p_blend;
// 🤝 a linha consistente do jogo que concorda com a Pinnacle, já com o alvo (agreeLine). Como na 🎯, fica fora o jogo
// que depende da escalação (copa, base/B, começo de temporada com mudança grande) — menos a dúvida de desfalque, que a odd
// da Pinnacle já embute.
const agreeOf = (g, markets, loose = false, banca = 44000) => (g.hard || (!loose && barred(g, { doubt: false })) ? null : (g.lines || [])
  .filter(l => AGREE_MARKETS.includes(l.market) && inMarkets(markets, l) && !l.model_only && !l.derived && l.pinnacle_odd > 1 && l.p_pinnacle != null
    && l.p_blend > 0 && l.p_model != null && l.p_model >= l.p_pinnacle - 0.03 && agreeOk(l))
  .map(l => agreeLine(l, banca)).sort(agreeOrder)[0] || null);
// os dois times batendo a linha em 60%+ dos últimos jogos (o acerto pesado pelo papel de hoje, 5+ jogos cada): nos
// chutes é o que mais acrescenta acerto além da chance do modelo (teste de 13/10/2026, no topo)
export const bothTeams = l => [l.history?.home, l.history?.away].every(h => h && h.n >= 5 && h.wins / h.n >= HIT_MIN);
// 📊 chutes: a Pinnacle não cota, o preço é só do modelo (margem de 8%) — sólida ou âncora com os dois times batendo a
// linha (bothTeams), odd mínima 1,50–3,00, em liga grande (as casas só têm a linha nelas); a dúvida de desfalque não tira
// o jogo (chute é volume do time inteiro), o resto do que depende da escalação, sim. O total de chutes antes do no gol:
// no teste, com o histórico dos dois times, acertou 73,8% (o no gol, 70,9%).
const shotsOf = (g, loose = false) => (g.hard || (!loose && barred(g, { doubt: false })) || !isBig(g.fx.league) ? null : (g.lines || [])
  .filter(l => SHOTS.includes(l.market) && l.tier !== 'especulativa' && bothTeams(l) && underOk(l) && !l.inviable && !l.blocked
    && l.context?.verdict !== 'contra' && l.odd_min >= ODD_FLOOR && l.odd_min <= 3)
  .sort((a, b) => SHOTS.indexOf(a.market) - SHOTS.indexOf(b.market) || b.consistency_score - a.consistency_score || b.p_blend - a.p_blend)[0] || null);
// mesmo jogo: a vitória do favorito + 1,5 gols; se ela pagar pouco, + 2,5 (fav_combos vem nessa ordem). Como no 🤝,
// fica fora o jogo que depende da escalação, menos a dúvida de desfalque (o preço sai da matriz da Pinnacle).
export const comboOk = c => c.p_blend >= COMBO_P && c.odd_min >= COMBO_ODDS[0] && c.odd_min <= COMBO_ODDS[1];
const comboOf = (g, loose = false) => (g.hard || (!loose && barred(g, { doubt: false })) ? null : (g.fav_combos || []).find(comboOk) || null);
// ⏱️ o favorito no 1º tempo: cotado pela Pinnacle de 1,70 a 2,70, o nosso modelo do 1º tempo não mais que 3 pp abaixo dela,
// e o alvo (a justa + 2%, nunca abaixo de 1,70) até 8% acima da odd dela. Como no 🤝, a dúvida de desfalque não barra (o
// preço é o da Pinnacle).
export const halfMin = c => r2(Math.max(HALF_ODDS[0], AGREE_EDGE / c.p_blend));
export const halfLine = (c, banca = 44000) => { const m = halfMin(c); return { ...c, odd_min: m, odd_min_vs_pinnacle_pct: r2((m / c.pinnacle_odd - 1) * 100), ...stakeFor(c.p_blend, m, banca) }; };
const halfOk = c => c?.pinnacle_odd >= HALF_ODDS[0] && c.pinnacle_odd <= HALF_ODDS[1] && c.p_pinnacle != null && c.p_blend > 0
  && (c.p_model == null || c.p_model >= c.p_pinnacle - 0.03) && halfMin(c) / c.pinnacle_odd - 1 <= REACH;
const halfOf = (g, loose = false) => (g.hard || (!loose && barred(g, { doubt: false })) || !halfOk(g.fav_half) ? null : g.fav_half);
const leagueKey = g => g.fx.league.id ?? g.fx.league.name;
// o bilhete na odd da Pinnacle quando ela cota todas as pernas (perna asiática: sem a odd dela)
export const multiOf = (legs, banca) => ticketOf(legs, { houseTotal: legs.every(l => l.pinnacle_odd > 1) ? legs.reduce((t, l) => t * l.pinnacle_odd, 1) : null, banca });
// Um bilhete de odd justa ≥ target com as pernas cotadas: as melhores (legOrder) de mais de 1,5, até maxLegs; não chegou,
// troca a perna de 1,5 pela de 2,5 do jogo em que ela é mais provável, até chegar. ms: multiGames (um por jogo).
export function ticketTo(ms, { target = TARGET, maxLegs = MAX_LEGS } = {}) {
  const opts = m => m.options.filter(o => o.quoted).sort((a, b) => b.p - a.p);
  const pick = [], fair = () => pick.reduce((t, x) => t * x.o.fair, 1);
  for (const m of [...ms].filter(m => opts(m).length).sort((a, b) => legOrder(opts(a)[0], opts(b)[0]))) {
    if (pick.length >= maxLegs || fair() >= target) break;
    pick.push({ os: opts(m), o: opts(m)[0] });
  }
  while (fair() < target) {
    const up = pick.filter(x => x.os.length > 1 && x.o === x.os[0]).sort((a, b) => b.os[1].p - a.os[1].p)[0];
    if (!up) break;
    up.o = up.os[1];
  }
  const byTime = (a, b) => a.kickoff - b.kickoff;
  if (pick.length >= 2 && fair() >= target) return pick.map(x => x.o).sort(byTime);
  // as mais prováveis não chegam: as de odd mais alta (a linha cotada de maior odd de cada jogo), com o menor número de
  // pernas — com odds justas a chance de acertar tudo é ~1 ÷ odd total de qualquer jeito, e menos pernas, menos margem
  const hi = ms.map(m => opts(m).sort((a, b) => b.fair - a.fair)[0]).filter(Boolean).sort((a, b) => b.fair - a.fair || legOrder(a, b));
  const legs = [];
  let f = 1;
  for (const o of hi) { if (f >= target || legs.length >= maxLegs) break; legs.push(o); f *= o.fair; }
  return legs.length >= 2 && f >= target ? legs.sort(byTime) : null;
}

// O plano de uma varredura. exposed: entry.js exposedGames() (jogos que já têm entrada) ou null; markets: os mercados
// marcados (PLAN_OPTIONS; null = todos); big: só os jogos de liga grande (leagues.js).
export function buildPlan(scan, { exposed = null, now = Date.now(), banca = 44000, target = TARGET, markets = null, big = false } = {}) {
  const want = k => !markets || markets.includes(k);
  const future = scan.games.filter(g => g.fx.t > now + 10 * 60e3), scope = future.filter(g => !big || isBig(g.fx.league));
  const games = scope.filter(g => !exposed?.has(g.fx.id, g.fx.home.name, g.fx.away.name));
  const used = new Set(), perLeague = new Map();
  // simples: as frentes em rodízio, as de mais acerto primeiro (🤝, 📊, 🎯), a que tem menos entradas primeiro; acabou
  // uma, as outras completam
  const A = games.map(g => ({ g, s: singleOf(g, markets) })).filter(x => x.s).sort((a, b) => b.s.v - a.s.v).map(x => ({ g: x.g, line: x.s.l, value: x.s.v, lens: 'ours' }));
  const B = games.map(g => ({ g, line: agreeOf(g, markets, false, banca) })).filter(x => x.line).sort((a, b) => agreeOrder(a.line, b.line))
    .map(x => ({ ...x, value: needOf(x.line), lens: 'agree' }));
  const C = want(SHOTS_KEY) ? games.map(g => ({ g, line: shotsOf(g) })).filter(x => x.line)
    .sort((a, b) => b.line.consistency_score - a.line.consistency_score).map(x => ({ ...x, value: null, lens: 'shots' })) : [];
  const singles = [], take = x => {
    const lg = leagueKey(x.g), n = perLeague.get(lg) || 0;
    if (used.has(x.g.fx.id) || n >= PER_LEAGUE) return false;
    perLeague.set(lg, n + 1); used.add(x.g.fx.id); singles.push(x);
    return true;
  };
  const fronts = [B, C, A], at = [0, 0, 0], got = [0, 0, 0];
  while (singles.length < SINGLES[1]) {
    const open = [0, 1, 2].filter(j => at[j] < fronts[j].length);
    if (!open.length) break;
    const j = open.reduce((a, b) => (got[b] < got[a] ? b : a));
    if (take(fronts[j][at[j]++])) got[j]++;
  }
  // mesmo jogo
  const sameGame = want(COMBO_KEY) ? games.filter(g => !used.has(g.fx.id)).map(g => ({ g, combo: comboOf(g) })).filter(x => x.combo)
    .sort((a, b) => b.combo.p_blend - a.combo.p_blend).slice(0, SAME_GAME) : [];
  sameGame.forEach(x => used.add(x.g.fx.id));
  // ⏱️ favorito no 1º tempo: nos jogos que sobraram, os mais prováveis
  const halves = want(HALF_KEY) ? games.filter(g => !used.has(g.fx.id)).map(g => ({ g, c: halfOf(g) })).filter(x => x.c)
    .sort((a, b) => b.c.p_blend - a.c.p_blend).slice(0, HALF_MAX).map(x => ({ g: x.g, line: halfLine(x.c, banca) })) : [];
  halves.forEach(x => used.add(x.g.fx.id));
  // múltiplas: 2 bilhetes de odd justa 6+ (sem faixa de horário: à noite tudo é apostado de uma vez), as melhores pernas
  // no primeiro; cada jogo num bilhete só
  const multis = [];
  if (want(MULTI)) {
    let ms = multiGames(games.filter(g => !used.has(g.fx.id)), { now });
    for (let k = 0; k < MULTIS; k++) {
      const legs = ticketTo(ms, { target });
      if (!legs) break;
      multis.push(multiOf(legs, banca));
      const ids = new Set(legs.map(l => l.fixtureId));
      ms = ms.filter(m => !ids.has(m.fixtureId));
    }
  }
  const byTime = (a, b) => a.g.fx.t - b.g.fx.t;
  return { date: scan.date || null, scan_at: scan.generated_at, made_at: now, target, markets: markets || null, big: !!big, singles: singles.sort(byTime), sameGame: sameGame.sort(byTime), halves: halves.sort(byTime), multis,
    stats: { games: scan.games.length, future: future.length, small: future.length - scope.length, exposed: scope.length - games.length } };
}

// O funil do plano (pedido do Jeferson, 12/10/2026: "não é possível que o dia inteiro só encontre 2"): dos jogos da
// janela às entradas, onde cada jogo caiu — cada um conta uma vez só, na primeira etapa que o tirou, e as contas fecham:
// analisados = não guardados + soma dos destinos. plan: o de buildPlan ou de planFromKeys (com as edições da tela);
// now: a hora em que o plano foi montado; exposed: entry.js exposedGames().
const SKIP_WHY = [[/orçamento/, 'limite de requisições'], [/menos de \d+ jogos/, 'histórico curto dos times'], [/não carregou|falhou/, 'falha ao carregar a liga']];
export function planFunnel(scan, plan, { exposed = null, markets = plan.markets, big = plan.big, now = plan.made_at ?? Date.parse(plan.scan_at) } = {}) {
  const want = k => !markets || markets.includes(k);
  const skipped = {};
  for (const s of scan.skipped || []) { const k = SKIP_WHY.find(([re]) => re.test(s.why || ''))?.[1] || 'outros motivos'; skipped[k] = (skipped[k] || 0) + 1; }
  const ids = [plan.singles.map(x => x.g.fx.id), plan.sameGame.map(x => x.g.fx.id), plan.multis.flatMap(t => t.legs.map(l => l.fixtureId)), (plan.halves || []).map(x => x.g.fx.id)].map(xs => new Set(xs));
  const perLeague = new Map();
  for (const { g } of plan.singles) perLeague.set(leagueKey(g), (perLeague.get(leagueKey(g)) || 0) + 1);
  const single = (g, loose) => singleOf(g, markets, loose) || agreeOf(g, markets, loose) || (want(SHOTS_KEY) && shotsOf(g, loose));
  const combo = (g, loose) => (want(COMBO_KEY) && comboOf(g, loose)) || (want(HALF_KEY) && halfOf(g, loose));
  // tinha simples e ficou fora: o teto da liga ou o plano cheio (10 simples); tinha combo: o plano cheio (5 no mesmo jogo)
  const fate = g => (ids[0].has(g.fx.id) ? 'singles' : ids[1].has(g.fx.id) ? 'same' : ids[3].has(g.fx.id) ? 'half' : ids[2].has(g.fx.id) ? 'multi'
    : g.fx.t <= now + 10 * 60e3 ? 'started' : big && !isBig(g.fx.league) ? 'small' : exposed?.has(g.fx.id, g.fx.home.name, g.fx.away.name) ? 'exposed'
    : single(g) ? ((perLeague.get(leagueKey(g)) || 0) >= PER_LEAGUE ? 'cap' : 'full') : combo(g) ? 'full'
    : g.hard ? 'hard' : single(g, true) || combo(g, true) ? 'lineup' : 'none');
  const analyzed = scan.analyzed ?? scan.games.length;
  const out = { fixtures: scan.fixtures ?? null, quoted: scan.with_odds != null ? scan.with_odds + (scan.outside || 0) : null, outside: scan.outside || 0,
    skipped, analyzed, unkept: Math.max(0, analyzed - scan.games.length),
    singles: 0, same: 0, half: 0, multi: 0, started: 0, small: 0, exposed: 0, cap: 0, full: 0, hard: 0, lineup: 0, none: 0 };
  for (const g of scan.games) out[fate(g)]++;
  return out;
}

// O plano guardado pelas chaves (fica igual ao registrar entradas: a exposição muda, o plano não).
export const planKeys = plan => ({ scan_at: plan.scan_at, made_at: plan.made_at ?? null, date: plan.date, target: plan.target, markets: plan.markets ?? null, big: !!plan.big,
  singles: plan.singles.map(x => [x.g.fx.id, x.line.id, x.lens]), sameGame: plan.sameGame.map(x => [x.g.fx.id, x.combo.id]),
  halves: (plan.halves || []).map(x => [x.g.fx.id, x.line.id]), multis: plan.multis.map(t => t.legs.map(l => [l.fixtureId, l.lineId])) });
export function planFromKeys(scan, keys, { banca = 44000 } = {}) {
  const g = id => scan.games.find(x => x.fx.id === id);
  const opts = new Map(multiGames(scan.games, { now: 0 }).flatMap(m => m.options.map(o => [`${o.fixtureId}:${o.lineId}`, o])));
  const singles = keys.singles.map(([f, id, lens = 'ours']) => {
    const x = g(f), found = (lens === 'ours' ? x?.scenario : x?.lines)?.find(s => s.id === id), l = found && lens === 'agree' ? agreeLine(found, banca) : found;
    return l && { g: x, line: l, value: lens === 'agree' ? needOf(l) : lens === 'shots' ? null : valueOf(l), lens };
  });
  const sameGame = keys.sameGame.map(([f, id]) => { const x = g(f), c = [...(x?.fav_combos || []), ...(x?.combos || [])].find(s => s.id === id); return c && { g: x, combo: c }; });
  const halves = (keys.halves || []).map(([f, id]) => { const x = g(f), c = x?.fav_half?.id === id ? x.fav_half : null; return c && { g: x, line: halfLine(c, banca) }; });
  const multis = keys.multis.map(ls => ls.map(([f, id]) => opts.get(`${f}:${id}`))).filter(ls => ls.every(Boolean)).map(ls => multiOf(ls, banca));
  if (singles.some(x => !x) || sameGame.some(x => !x) || halves.some(x => !x)) return null;   // a varredura mudou: monta de novo
  return { date: keys.date, scan_at: keys.scan_at, made_at: keys.made_at ?? null, target: keys.target, markets: keys.markets ?? null, big: !!keys.big, singles, sameGame, halves, multis, stats: null };
}

// Texto do plano para copiar (bloco de notas, WhatsApp) e apostar nas casas.
export function planText(plan, { dateLabel = plan.date } = {}) {
  const nb = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
  const hh = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const out = [`PLANO ${dateLabel} · entrada ${money(STAKE.value, STAKE.cur)} em cada`];
  if (plan.singles.length) {
    out.push('', `SIMPLES (${plan.singles.length})`);
    plan.singles.forEach(({ g, line, lens }, i) => out.push(`${i + 1}. ${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name} — ${line.line} · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)}) · ${LENS[lens || 'ours']}`));
  }
  if (plan.halves?.length) {
    out.push('', `FAVORITO NO 1º TEMPO (${plan.halves.length})`);
    plan.halves.forEach(({ g, line }, i) => out.push(`${i + 1}. ${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name} — ${line.line} · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)})`));
  }
  if (plan.sameGame.length) {
    out.push('', `MESMO JOGO (${plan.sameGame.length})`);
    plan.sameGame.forEach(({ g, combo }, i) => out.push(`${i + 1}. ${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name} — ${combo.line} · odd ≥ ${nb(combo.odd_min)}`));
  }
  plan.multis.forEach((t, i) => {
    out.push('', `MÚLTIPLA ${i + 1} (${t.n} pernas) · odd total ≥ ${nb(t.min)} · ${t.asian ? 'não perde' : 'acerta tudo'} ${Math.round(t.p_all * 100)}%`);
    t.legs.forEach(l => out.push(`   ${hh(l.kickoff)} ${l.home} x ${l.away} — ${l.line} (≥ ${nb(l.min)})`));
  });
  return out.join('\n');
}
