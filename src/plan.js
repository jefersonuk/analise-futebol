// Plano do dia: a análise do dia (ou das próximas horas) reduzida às entradas, para apostar de uma vez. Começou em
// 08/10/2026 ("as melhores oportunidades, poucas entradas"; a varredura de horas em horas tomava tempo demais).
//
// O foco (Jeferson, 16/10/2026: "o que vale a pena é só total de gols e vitória do favorito — e as do mesmo jogo; a
// vitória no 1º tempo num jogo muito favorito também; me dá uns 20 jogos no dia"): quatro blocos, até 20 entradas, cada
// jogo uma vez só. Nas simulações até 15/10 (cada aposta uma vez, na odd da Pinnacle) e nas apostas reais da análise:
//   mesmo jogo, a vitória + gols: 34/48 (+15%) · reais 9/16 (+11%);
//   total de gols (over): 18/29 (+14%) · reais 22/37 (+8%) — a nossa leitura nos gols 13/21 (+25%) · reais 5/5;
//   vitória do favorito (a Pinnacle com 50%+): 3/4 · reais 3/4; o jogo equilibrado (40–50%) acertou 1 de 14;
//   e o que saiu: handicap (−15% · reais −24%), escanteios, chutes, múltiplas (4/28, −58%), 1X2 do azarão (3/19, −62%)
//   e a dupla chance + gols (−24%).
//
// Os blocos (rodízio: o bloco com menos entradas primeiro; no empate, nesta ordem — a de mais acerto primeiro):
//   🔗 mesmo jogo: a vitória do favorito + mais de 1,5 gols — ou de 2,5 (ou 3,5) quando a mais provável paga menos de
//      1,65 —, chance de 45%+ e odd mínima de 1,65 a 2,70 (Jeferson, 14/10/2026), a de maior chance primeiro;
//   ⚽ total de gols: o over da nossa leitura (🎯: a aposta da análise, a Pinnacle pagando de 1,30 a 2,70 e a nossa
//      mínima, pelo valor conservador — a nossa chance encolhida pela metade na direção da dela); sem ela, o over
//      consistente que concorda com a Pinnacle (🤝: âncora ou sólida, o modelo no máximo 3 pp abaixo dela, o alvo — a
//      justa + 2%, nunca abaixo de 1,30 — até 8% acima da odd dela);
//   🏆 vitória do favorito: o lado que a Pinnacle põe com 50%+ de vencer, cotado de 1,50 a 2,70 (com 50%+, na prática
//      até ~2,05); alvo = a justa dela + 2%. O modelo não entra no filtro: ele comprime o favorito (vê a zebra mais perto
//      do que é);
//   ⏱️ favorito no 1º tempo (favhalf.js): nos jogos em que o favorito vence o jogo em 60%+, a vitória dele no 1º tempo,
//      cotada de 1,70 a 2,70; como na vitória do favorito, o preço é o da Pinnacle (alvo = a justa dela + 2%, até 8% acima
//      da odd dela) e o modelo não filtra — o nosso modelo do 1º tempo comprime o favorito (nas análises guardadas, de 5 a
//      30 pp abaixo da Pinnacle, e o filtro de 3 pp barrava todos); até 5.
// Regras de todos:
// - um jogo entra uma vez só no plano, e jogo que já tem entrada fica fora; no máximo 5 por liga;
// - fica fora o que depende da escalação — copa (rodízio), time de base/B, começo de temporada com mudança grande — e o
//   jogo difícil de analisar; a dúvida de desfalque só tira a 🎯 (no resto o preço é o da Pinnacle, que já embute a
//   notícia; Jeferson, 12/10/2026);
// - stake (stake.js): 20 € a favor da Pinnacle, 10 € contra (a 🎯 5 pp ou mais acima dela).
//
// Os blocos e as ligas (o operador marca, como antes): os quatro blocos (PLAN_OPTIONS) e "só as grandes" (leagues.js).

import { underOk } from './consistency.js';
import { politicaE, stakeFor } from './model.js';
import { isBig } from './leagues.js';
import { ticketOf } from './multiple.js';
import { isDoubt } from './scenario.js';
import { CONTRA_SHARE, STAKE, isContra, money, stakeOf } from './stake.js';

export const PLAN_MAX = 20, PER_LEAGUE = 5, HALF_MAX = 5;
export const GOALS_KEY = 'gols', FAV_KEY = 'favorito', COMBO_KEY = 'combos', HALF_KEY = 'fav1t';
// a ordem do rodízio (as de mais acerto primeiro) e os rótulos
export const BLOCKS = [COMBO_KEY, GOALS_KEY, FAV_KEY, HALF_KEY];
export const PLAN_OPTIONS = [[COMBO_KEY, 'Mesmo jogo'], [GOALS_KEY, 'Total de gols'], [FAV_KEY, 'Vitória do favorito'], [HALF_KEY, 'Favorito no 1º tempo']];
export const PLAN_DEFAULT = PLAN_OPTIONS.map(([k]) => k);
export const COMBO_P = 0.45, COMBO_ODDS = [1.65, 2.7];   // mesmo jogo: chance mínima e faixa da odd mínima
export const GOALS_ODDS = [1.3, 2.7];                     // total de gols: a odd da Pinnacle
export const FAV_P = 0.5, FAV_ODDS = [1.5, 2.7];          // vitória do favorito: a chance da Pinnacle e a odd dela
export const HALF_ODDS = [1.7, 2.7];                      // favorito no 1º tempo: a odd da Pinnacle
export const LENS = { ours: '🎯 nossa leitura', agree: '🤝 acordo com a Pinnacle' };
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const inRange = (x, [lo, hi]) => x >= lo && x <= hi;

// Valor conservador da 🎯: a nossa chance encolhida pela metade na direção da Pinnacle, na odd dela.
export const valueOf = l => r3(((l.p_nossa + l.p_pinnacle) / 2) * l.pinnacle_odd - 1);
// O jogo tem condição que barra o bloco? doubt: false ignora a dúvida de desfalque (o preço é o da Pinnacle).
const barred = (g, { doubt = true } = {}) => (g.conditions || []).some(c => doubt || !isDoubt(c));
// Nas funções de cada bloco, loose: como seria sem a regra da escalação (o "entrar se…" e as condições do jogo) — só
// para o funil dizer quantos jogos ela tirou.

// 🤝 o alvo (a odd que a casa precisa pagar): a justa da linha + AGREE_EDGE, nunca abaixo do piso; a linha entra quando ele
// fica até REACH acima da odd da Pinnacle.
export const AGREE_EDGE = 1.02, REACH = 0.08;
export const agreeMin = l => r2(Math.max(GOALS_ODDS[0], AGREE_EDGE / l.p_blend));
export const needOf = l => r3(l.odd_min / l.pinnacle_odd - 1);
export const agreeLine = (l, banca = 44000) => { const m = agreeMin(l); return { ...l, odd_min: m, odd_min_vs_pinnacle_pct: r2((m / l.pinnacle_odd - 1) * 100), ...stakeFor(l.p_blend, m, banca) }; };
// consistente (âncora/sólida), só over, viável, sem bloqueio nem contexto contra, cotada pela Pinnacle, o modelo no máximo 3 pp
// abaixo dela e o alvo ao alcance de uma casa
const agreeOk = l => l.tier !== 'especulativa' && underOk(l) && !l.inviable && !l.blocked && l.context?.verdict !== 'contra'
  && !l.model_only && !l.derived && l.pinnacle_odd > 1 && l.p_pinnacle != null && l.p_blend > 0 && l.p_model != null && l.p_model >= l.p_pinnacle - 0.03
  && agreeMin(l) / l.pinnacle_odd - 1 <= REACH && politicaE(agreeMin(l)).factor > 0;
// contexto a favor, o alvo mais perto da Pinnacle (o mais fácil de achar), âncora, consistência
const agreeOrder = (a, b) => (b.context?.verdict === 'a favor') - (a.context?.verdict === 'a favor') || needOf(a) - needOf(b)
  || (b.tier === 'âncora') - (a.tier === 'âncora') || b.consistency_score - a.consistency_score || b.p_blend - a.p_blend;

// ⚽ total de gols: o over da nossa leitura (a de maior valor) ou, sem ela, o consistente que concorda com a Pinnacle.
const isOver = l => l.market === 'Total de gols' && /^gO/.test(l.id);
function goalsOf(g, loose = false, banca = 44000) {
  if (g.hard) return null;
  const ours = (g.scenario || []).filter(l => isOver(l) && (l.bet || (loose && l.conditional)) && l.p_pinnacle != null && inRange(l.pinnacle_odd, GOALS_ODDS))
    .map(l => ({ line: l, value: valueOf(l) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value || b.line.p_nossa - a.line.p_nossa)[0];
  if (ours) return { ...ours, lens: 'ours' };
  if (!loose && barred(g, { doubt: false })) return null;
  const l = (g.lines || []).filter(l => isOver(l) && agreeOk(l) && inRange(l.pinnacle_odd, GOALS_ODDS)).map(l => agreeLine(l, banca)).sort(agreeOrder)[0];
  return l ? { line: l, value: needOf(l), lens: 'agree' } : null;
}
// 🏆 a vitória do favorito: o alvo pela chance da Pinnacle (a justa dela + 2%, nunca abaixo de 1,50); fav: o formulário de
// entrada não pede o piso de 60% (como o mesmo jogo e o 1º tempo)
export const favMin = l => r2(Math.max(FAV_ODDS[0], AGREE_EDGE / l.p_pinnacle));
export const favLine = (l, banca = 44000) => { const m = favMin(l); return { ...l, fav: true, odd_min: m, odd_min_vs_pinnacle_pct: r2((m / l.pinnacle_odd - 1) * 100), ...stakeFor(l.p_pinnacle, m, banca) }; };
function favOf(g, loose = false, banca = 44000) {
  if (g.hard || (!loose && barred(g, { doubt: false }))) return null;
  const l = (g.lines || []).filter(l => l.market === '1X2' && (l.id === '1' || l.id === '2') && l.pinnacle_odd > 1 && l.p_pinnacle >= FAV_P
    && inRange(l.pinnacle_odd, FAV_ODDS) && favMin(l) / l.pinnacle_odd - 1 <= REACH).sort((a, b) => b.p_pinnacle - a.p_pinnacle)[0];
  return l ? { line: favLine(l, banca), value: null } : null;
}
// 🔗 mesmo jogo: a vitória do favorito + 1,5 gols; se ela pagar pouco, + 2,5, depois + 3,5 (fav_combos vem nessa ordem)
export const comboOk = c => c.p_blend >= COMBO_P && c.odd_min >= COMBO_ODDS[0] && c.odd_min <= COMBO_ODDS[1];
const comboOf = (g, loose = false) => (g.hard || (!loose && barred(g, { doubt: false })) ? null : (g.fav_combos || []).find(comboOk) || null);
// ⏱️ o favorito no 1º tempo: o alvo pela chance da Pinnacle (a justa dela + 2%, nunca abaixo de 1,70)
const halfP = c => c.p_pinnacle ?? c.p_blend;
export const halfMin = c => r2(Math.max(HALF_ODDS[0], AGREE_EDGE / halfP(c)));
export const halfLine = (c, banca = 44000) => { const m = halfMin(c); return { ...c, odd_min: m, odd_min_vs_pinnacle_pct: r2((m / c.pinnacle_odd - 1) * 100), ...stakeFor(halfP(c), m, banca) }; };
const halfOk = c => c?.pinnacle_odd >= HALF_ODDS[0] && c.pinnacle_odd <= HALF_ODDS[1] && c.p_pinnacle > 0 && halfMin(c) / c.pinnacle_odd - 1 <= REACH;
const halfOf = (g, loose = false) => (g.hard || (!loose && barred(g, { doubt: false })) || !halfOk(g.fav_half) ? null : g.fav_half);
const leagueKey = g => g.fx.league.id ?? g.fx.league.name;

// O candidato de cada bloco num jogo ({ line, value, lens } ou { combo }), ou null; e a ordem dentro do bloco.
function candidate(k, g, loose = false, banca = 44000) {
  if (k === COMBO_KEY) { const c = comboOf(g, loose); return c && { combo: c }; }
  if (k === GOALS_KEY) return goalsOf(g, loose, banca);
  if (k === FAV_KEY) return favOf(g, loose, banca);
  const c = halfOf(g, loose);
  return c && { line: halfLine(c, banca) };
}
const ORDER = {
  [COMBO_KEY]: (a, b) => b.combo.p_blend - a.combo.p_blend,
  [GOALS_KEY]: (a, b) => (b.lens === 'ours') - (a.lens === 'ours') || (a.lens === 'ours' ? b.value - a.value : agreeOrder(a.line, b.line)),
  [FAV_KEY]: (a, b) => b.line.p_pinnacle - a.line.p_pinnacle,
  [HALF_KEY]: (a, b) => b.line.p_pinnacle - a.line.p_pinnacle || b.line.p_blend - a.line.p_blend,
};
// a chance de um candidato (a varredura guarda os jogos pelos melhores)
const chanceOf = x => (x.combo ? x.combo.p_blend : x.line.p_nossa ?? x.line.p_pinnacle ?? x.line.p_blend);
// O jogo tem candidato em algum bloco marcado? A varredura do plano (scanner.js) guarda os jogos por isto, o de maior
// chance primeiro, para a 3ª passada (contexto da API) ir só para eles. loose: antes do contexto as condições ainda não
// vieram.
export function planChance(g, { markets = null } = {}) {
  const xs = BLOCKS.filter(k => !markets || markets.includes(k)).map(k => candidate(k, g, true)).filter(Boolean);
  return xs.length ? Math.max(...xs.map(chanceOf)) : 0;
}

// O plano de uma varredura. exposed: entry.js exposedGames() (jogos que já têm entrada) ou null; markets: os blocos
// marcados (PLAN_OPTIONS; null = todos); big: só os jogos de liga grande (leagues.js).
export function buildPlan(scan, { exposed = null, now = Date.now(), banca = 44000, markets = null, big = false } = {}) {
  const want = k => !markets || markets.includes(k);
  const future = scan.games.filter(g => g.fx.t > now + 10 * 60e3), scope = future.filter(g => !big || isBig(g.fx.league));
  const games = scope.filter(g => !exposed?.has(g.fx.id, g.fx.home.name, g.fx.away.name));
  const pools = BLOCKS.filter(want).map(k => ({ k, xs: games.map(g => ({ g, ...candidate(k, g, false, banca) })).filter(x => x.combo || x.line).sort(ORDER[k]) }));
  const out = Object.fromEntries(BLOCKS.map(k => [k, []])), used = new Set(), perLeague = new Map(), at = pools.map(() => 0);
  let total = 0;
  while (total < PLAN_MAX) {
    const open = pools.map((_, j) => j).filter(j => at[j] < pools[j].xs.length && !(pools[j].k === HALF_KEY && out[HALF_KEY].length >= HALF_MAX));
    if (!open.length) break;
    const j = open.reduce((a, b) => (out[pools[b].k].length < out[pools[a].k].length ? b : a)), x = pools[j].xs[at[j]++];
    const lg = leagueKey(x.g), n = perLeague.get(lg) || 0;
    if (used.has(x.g.fx.id) || n >= PER_LEAGUE) continue;
    used.add(x.g.fx.id); perLeague.set(lg, n + 1); out[pools[j].k].push(x); total++;
  }
  const byTime = (a, b) => a.g.fx.t - b.g.fx.t;
  return { v: 3, date: scan.date || null, scan_at: scan.generated_at, made_at: now, markets: markets || null, big: !!big,
    sameGame: out[COMBO_KEY].sort(byTime), goals: out[GOALS_KEY].sort(byTime), fav: out[FAV_KEY].sort(byTime), halves: out[HALF_KEY].sort(byTime),
    stats: { games: scan.games.length, future: future.length, small: future.length - scope.length, exposed: scope.length - games.length } };
}
// as entradas do plano, na ordem dos blocos
export const planEntries = plan => [...plan.sameGame.map(x => ({ ...x, block: COMBO_KEY, line: x.combo })), ...plan.goals.map(x => ({ ...x, block: GOALS_KEY })),
  ...plan.fav.map(x => ({ ...x, block: FAV_KEY })), ...plan.halves.map(x => ({ ...x, block: HALF_KEY }))];

// O funil do plano (pedido do Jeferson, 12/10/2026: "não é possível que o dia inteiro só encontre 2"): dos jogos da
// janela às entradas, onde cada jogo caiu — cada um conta uma vez só, na primeira etapa que o tirou, e as contas fecham:
// analisados = não guardados + soma dos destinos. plan: o de buildPlan ou de planFromKeys; now: a hora em que o plano foi
// montado; exposed: entry.js exposedGames().
const SKIP_WHY = [[/orçamento/, 'limite de requisições'], [/menos de \d+ jogos/, 'histórico curto dos times'], [/não carregou|falhou/, 'falha ao carregar a liga']];
export function planFunnel(scan, plan, { exposed = null, markets = plan.markets, big = plan.big, now = plan.made_at ?? Date.parse(plan.scan_at) } = {}) {
  const want = k => !markets || markets.includes(k);
  const skipped = {};
  for (const s of scan.skipped || []) { const k = SKIP_WHY.find(([re]) => re.test(s.why || ''))?.[1] || 'outros motivos'; skipped[k] = (skipped[k] || 0) + 1; }
  const where = new Map(planEntries(plan).map(x => [x.g.fx.id, x.block])), perLeague = new Map();
  for (const x of planEntries(plan)) perLeague.set(leagueKey(x.g), (perLeague.get(leagueKey(x.g)) || 0) + 1);
  const any = (g, loose) => BLOCKS.filter(want).some(k => candidate(k, g, loose));
  const NAME = { [COMBO_KEY]: 'same', [GOALS_KEY]: 'goals', [FAV_KEY]: 'fav', [HALF_KEY]: 'half' };
  // tinha candidato e ficou fora: o teto da liga ou o plano cheio (20)
  const fate = g => (where.has(g.fx.id) ? NAME[where.get(g.fx.id)]
    : g.fx.t <= now + 10 * 60e3 ? 'started' : big && !isBig(g.fx.league) ? 'small' : exposed?.has(g.fx.id, g.fx.home.name, g.fx.away.name) ? 'exposed'
    : any(g) ? ((perLeague.get(leagueKey(g)) || 0) >= PER_LEAGUE ? 'cap' : 'full')
    : g.hard ? 'hard' : any(g, true) ? 'lineup' : 'none');
  const analyzed = scan.analyzed ?? scan.games.length;
  const out = { fixtures: scan.fixtures ?? null, quoted: scan.with_odds != null ? scan.with_odds + (scan.outside || 0) : null, outside: scan.outside || 0,
    skipped, analyzed, unkept: Math.max(0, analyzed - scan.games.length),
    same: 0, goals: 0, fav: 0, half: 0, started: 0, small: 0, exposed: 0, cap: 0, full: 0, hard: 0, lineup: 0, none: 0 };
  for (const g of scan.games) out[fate(g)]++;
  return out;
}

// O plano guardado pelas chaves (fica igual ao registrar entradas: a exposição muda, o plano não). v 3: o foco de 16/10
// (os quatro blocos); a guarda de antes é montada de novo.
export const planKeys = plan => ({ v: 3, scan_at: plan.scan_at, made_at: plan.made_at ?? null, date: plan.date, markets: plan.markets ?? null, big: !!plan.big,
  sameGame: plan.sameGame.map(x => [x.g.fx.id, x.combo.id]), goals: plan.goals.map(x => [x.g.fx.id, x.line.id, x.lens]),
  fav: plan.fav.map(x => [x.g.fx.id, x.line.id]), halves: plan.halves.map(x => [x.g.fx.id, x.line.id]) });
export function planFromKeys(scan, keys, { banca = 44000 } = {}) {
  if (keys?.v !== 3) return null;
  const g = id => scan.games.find(x => x.fx.id === id), find = (xs, id) => (xs || []).find(s => s.id === id);
  const sameGame = keys.sameGame.map(([f, id]) => { const x = g(f), c = find([...(x?.fav_combos || []), ...(x?.combos || [])], id); return c && { g: x, combo: c }; });
  const goals = keys.goals.map(([f, id, lens]) => {
    const x = g(f), l = lens === 'ours' ? find(x?.scenario, id) : find(x?.lines, id), line = l && (lens === 'ours' ? l : agreeLine(l, banca));
    return line && { g: x, line, value: lens === 'ours' ? valueOf(line) : needOf(line), lens };
  });
  const fav = keys.fav.map(([f, id]) => { const x = g(f), l = find(x?.lines, id); return l && { g: x, line: favLine(l, banca), value: null }; });
  const halves = keys.halves.map(([f, id]) => { const x = g(f), c = x?.fav_half?.id === id ? x.fav_half : null; return c && { g: x, line: halfLine(c, banca) }; });
  if ([sameGame, goals, fav, halves].some(xs => xs.some(x => !x))) return null;   // a varredura mudou: monta de novo
  return { v: 3, date: keys.date, scan_at: keys.scan_at, made_at: keys.made_at ?? null, markets: keys.markets ?? null, big: !!keys.big, sameGame, goals, fav, halves, stats: null };
}

// A categoria de cada bloco na simulação (sim.js)
export const SIM_CAT = { [COMBO_KEY]: 'Plano: mesmo jogo', ours: 'Plano: total de gols (nossa leitura)', agree: 'Plano: total de gols (acordo com a Pinnacle)',
  [FAV_KEY]: 'Plano: vitória do favorito', [HALF_KEY]: 'Plano: favorito 1º tempo' };
// A linha de uma entrada da simulação no jogo da varredura guardada, como o plano a montou (o alvo do 🤝 e do favorito, a
// mínima do 1º tempo), para o ➕ da simulação; null quando a análise do jogo não tem mais a linha.
export function lineOfBet(g, b, banca = 44000) {
  const id = b.lineId, inList = xs => (xs || []).find(l => l.id === id) || null;
  if (b.cat === SIM_CAT.agree) { const l = inList(g.lines); return l && agreeLine(l, banca); }
  if (b.cat === SIM_CAT[FAV_KEY]) { const l = inList(g.lines); return l && favLine(l, banca); }
  if (b.cat === SIM_CAT[HALF_KEY]) return g.fav_half?.id === id ? halfLine(g.fav_half, banca) : null;
  if (/nossa leitura|nossa análise/.test(b.cat)) return inList(g.scenario);
  return inList(g.lines) || inList(g.scenario) || inList(g.fav_combos) || inList(g.combos) || (g.fav_half?.id === id ? g.fav_half : null);
}
// Sem a análise guardada: a linha com o que a simulação tem (a chance da hora do plano) — o formulário a registra sem a
// regra do piso (entryview.js from_sim) e o app de apostas confere o resultado pelo id.
export const simLine = b => ({ id: b.lineId, market: b.market, line: b.line, p_blend: b.p ?? null, p_model: null, p_pinnacle: b.p_pinnacle ?? null,
  pinnacle_odd: b.odd_src === 'pinnacle' ? b.odd : null, fair_odd_blend: b.p > 0 ? r2(1 / b.p) : null, odd_min: null, tier: 'da simulação',
  priced_by: b.odd_src === 'pinnacle' ? 'pinnacle' : 'simulação', fragile: false, from_sim: true, ...(/^cb:/.test(b.lineId || '') ? { combo: true } : {}) });
// o bilhete de uma múltipla (das simulações das varreduras) na odd da Pinnacle quando ela cota todas as pernas
export const multiOf = (legs, banca) => ticketOf(legs, { houseTotal: legs.every(l => l.pinnacle_odd > 1) ? legs.reduce((t, l) => t * l.pinnacle_odd, 1) : null, banca });

// A entrada de cada aposta do plano, na ordem dos blocos: 20 € a favor da Pinnacle, 10 € contra (stake.js).
export const planStakes = plan => planEntries(plan).map(x => stakeOf(x.line));

// Texto do plano para copiar (bloco de notas, WhatsApp) e apostar nas casas, com a entrada de cada aposta (stake.js).
export function planText(plan, { dateLabel = plan.date } = {}) {
  const nb = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
  const hh = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const st = x => money(stakeOf(x)), all = planStakes(plan), game = g => `${hh(g.fx.t)} ${g.fx.home.name} x ${g.fx.away.name}`;
  const out = [`PLANO ${dateLabel} · entrada ${money(STAKE.value)} a favor da Pinnacle, ${money(STAKE.value * CONTRA_SHARE)} contra`];
  const section = (title, xs, row) => { if (xs.length) { out.push('', `${title} (${xs.length})`); xs.forEach((x, i) => out.push(`${i + 1}. ${row(x)}`)); } };
  section('MESMO JOGO', plan.sameGame, ({ g, combo }) => `${game(g)} — ${combo.line} · odd ≥ ${nb(combo.odd_min)} · ${st(combo)}`);
  section('TOTAL DE GOLS', plan.goals, ({ g, line, lens }) => `${game(g)} — ${line.line} · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)}) · ${LENS[lens]}${isContra(line) ? ' · contra a Pinnacle' : ''} · ${st(line)}`);
  section('VITÓRIA DO FAVORITO', plan.fav, ({ g, line }) => `${game(g)} — ${line.id === '2' ? g.fx.away.name : g.fx.home.name} vence · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)}) · ${st(line)}`);
  section('FAVORITO NO 1º TEMPO', plan.halves, ({ g, line }) => `${game(g)} — ${line.line} · odd ≥ ${nb(line.odd_min)} (Pinnacle ${nb(line.pinnacle_odd)}) · ${st(line)}`);
  if (all.length) out.push('', `TOTAL: ${all.length} entrada${all.length > 1 ? 's' : ''} · ${money(all.reduce((t, x) => t + x, 0))}`);
  return out.join('\n');
}
