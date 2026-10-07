// Consistência primeiro, preço depois: uma linha só interessa se acerta com frequência e de forma
// estável; o EV entra como filtro (odd mínima), não como critério de ordenação.
// Piso de acerto (regra do Jeferson, out/2026): nas odds baixas do núcleo (1,50–2,09) só fica de pé quem
// acerta 60%+ — nada abaixo disso vira aposta; o ideal é 70%. Nas 34 apostas da análise (02–05/10/2026)
// acerto de 50% a odd média 1,79 (empate em 57%): as que tinham chance ≥ 60%, odd ≥ mínima e preço da
// Pinnacle acertaram 64%; o resto, 41%.
//   âncora (ideal):   chance ≥ 70%, pior cenário ≥ 60%, histórico encolhido ≥ 70% e cada time com 6/10+
//   sólida (piso):    chance ≥ 60%, pior cenário ≥ 50%, histórico encolhido ≥ 60%
//   especulativa:     o resto — nunca aposta
//
//   p        probabilidade de ganhar (sem push): p_blend quando há Pinnacle, senão a do modelo
//   pLow     pior cenário do modelo (−1 erro-padrão)
//   hits     histórico dos dois times na linha: [{ wins, n }] (meia vitória conta 0,5)

const PRIOR = 10;   // o histórico de 10 jogos é encolhido para p com peso de 10 jogos
export const HIT_MIN = 0.6, HIT_IDEAL = 0.7;

export function consistency({ p, pLow, hits = [] }) {
  const wins = hits.reduce((s, h) => s + h.wins, 0), n = hits.reduce((s, h) => s + h.n, 0);
  const hitShrunk = (wins + PRIOR * p) / (n + PRIOR);
  const score = 0.5 * p + 0.25 * pLow + 0.25 * hitShrunk;
  // âncora exige histórico de verdade: os dois times com 5+ jogos na linha e 60%+ de acerto
  const eachTeamOk = hits.length > 0 && hits.every(h => h.n >= 5 && h.wins / h.n >= HIT_MIN);
  const tier = p >= HIT_IDEAL && pLow >= HIT_IDEAL - 0.1 && hitShrunk >= HIT_IDEAL && eachTeamOk ? 'âncora'
    : p >= HIT_MIN && pLow >= HIT_MIN - 0.1 && hitShrunk >= HIT_MIN ? 'sólida'
      : 'especulativa';
  return { score, tier, hit_rate: n ? wins / n : null };
}

export const TIER_ORDER = { 'âncora': 0, 'sólida': 1, 'especulativa': 2 };
// Abaixo disso fica fora do núcleo (filtros do surebet.com começam em 1,50). Nas linhas com odd da Pinnacle é o
// piso da odd a tomar, não um corte da linha: numa linha de 70%+ a odd justa fica abaixo de 1,43, e a mínima passa a
// ser o próprio 1,50 (candidata se isso ficar até 5% acima da Pinnacle). Sem a odd dela, a linha ainda é cortada.
export const ODD_FLOOR = 1.5;
// A mínima só está no núcleo por causa do piso e o piso fica mais de 5% acima da Pinnacle: nenhuma casa soft paga
// (ex.: Menos de 3,5 gols a 80%, Pinnacle 1,24). Não é jogável — nem como alternativa.
export const floorOutOfReach = l => l.odd_min <= ODD_FLOOR + 1e-9 && l.odd_min_vs_pinnacle_pct > 5;

// ---- linhas principais do pré-jogo ----
// Regra do Jeferson (out/2026): só over — nenhum under — e, nos escanteios, só o over do total (do jogo e do
// 1º tempo): é onde ele acha valor; handicap de escanteios fica de fora. As que têm odd para entrar antes do
// jogo (as mais baixas — escanteios 1T 3,5, jogo 7 — só pagam no ao vivo, e o plano ao vivo do 1º tempo está
// em live.js): escanteios do 1º tempo 4 a 5,5 e do jogo 8 a 11 (de 0,5 em 0,5: nos jogos de muitos
// escanteios, 8–9 saem abaixo de 1,50 e as opções estão em 9,5–11); gols do 1º tempo 1,5 e do jogo 1,5 e 2,5;
// chutes (total e no gol) em qualquer linha que o modelo calcula — a Pinnacle não cota chutes, o preço é só
// do modelo —; o 1X2 e o handicap de gols (asiático) nas linhas que a Pinnacle cota. Linha que a Pinnacle não
// cota num total que ela cota sai do total dela (dossier.js); sem a Pinnacle nos escanteios, só do modelo.
export const MAIN_LINES = { 'Total escanteios 1T': ['c1', [4, 4.5, 5, 5.5], 'O'], 'Total de escanteios': ['corners', [8, 8.5, 9, 9.5, 10, 10.5, 11], 'O'],
  'Total de gols 1T': ['g1', [1.5], 'O'], 'Total de gols': ['g', [1.5, 2.5], 'O'] };
export const SHOTS = ['Total de chutes', 'Total de chutes no gol'];
const MAIN_IDS = new Set(Object.values(MAIN_LINES).flatMap(([k, ls, sides]) => ls.flatMap(L => [...sides].map(s => `${k}${s}${L}`))));
const MAIN_RE = /^(shots|sot)O[\d.]+$|^[12X]$/;   // over de chutes em qualquer linha, e o 1X2
export const isMain = id => MAIN_IDS.has(id) || MAIN_RE.test(id);
// Linha asiática fracionada (,25 ou ,75), que o app não oferece.
export const isQuarter = id => { const m = String(id).match(/-?\d+(?:\.\d+)?$/); return !!m && Math.round(Math.abs(+m[0]) * 4) % 2 === 1; };
export const HANDICAP = 'Handicap de escanteios';
export const GOAL_HANDICAP = 'Handicap asiático';
// Linha principal: com preço da Pinnacle (um total da lista, o 1X2 ou o handicap de gols que ela cota), derivada
// do total que ela cota, ou só do modelo (chutes, e escanteios quando ela não cota o mercado no jogo).
export const isMainLine = l => (l.priced_by === 'pinnacle' && (isMain(l.id) || l.market === GOAL_HANDICAP))
  || ((l.derived || l.model_only) && isMain(l.id));

// Só over (regra do Jeferson, out/2026): under (e "ninguém chega a N", que é um under) nunca é candidata, jogável
// nem sugestão — em gols, escanteios ou chutes. A penalidade na ordem fica para as linhas que ainda aparecem
// nas tabelas completas.
export const isUnder = id => /^(g|g1|corners|c1|cH|cA|shots|sot)U|^crN/.test(id);
export const UNDER_PENALTY = 0.05;
const penalized = id => isUnder(id) && !isMain(id);
export const rankTier = l => TIER_ORDER[l.tier] + (penalized(l.id) ? 1 : 0);
export const rankScore = l => (l.consistency_score ?? 0) - (penalized(l.id) ? UNDER_PENALTY : 0);
// Nos escanteios, só o over: handicap, "quem tem mais" e corrida a N escanteios (jogo e 1º tempo) também ficam fora.
export const isCornerSide = id => /^(c1?h[HA]|c1?x|cr[HAN])/.test(id);
export const underOk = l => !isUnder(l.id) && !isCornerSide(l.id);

// Valor (informativo): a nossa probabilidade (mistura Pinnacle × modelo, sem push) contra a da Pinnacle sem
// margem — value = p/q − 1, o EV de quem pega a odd justa da Pinnacle. Conferido pelo pior cenário do modelo
// e pelo histórico dos dois times no papel de hoje (hits: [{ wins, n }], acerto pesado pelo papel):
//   confirmado:      valor ≥ +2%, pior cenário do modelo ≥ mercado, histórico somado (8+ jogos) 5 pp acima
//                    do mercado e nenhum time 10 pp abaixo dele
//   sem confirmação: valor ≥ +1% e histórico que não contradiz (somado ≥ mercado − 5 pp, ou curto)
//   sem valor:       o resto
export const VALUE_MIN = 0.02, VALUE_WEAK = 0.01;
export function valueOf({ p, q, pLow, hits = [] }) {
  if (!(q > 0) || !(p > 0)) return { value: null, level: null };
  const value = p / q - 1;
  const W = hits.reduce((s, h) => s + h.wins, 0), N = hits.reduce((s, h) => s + h.n, 0), rate = N ? W / N : null;
  const noTeamAgainst = hits.every(h => h.n < 4 || h.wins / h.n >= q - 0.1);
  const level = value >= VALUE_MIN && pLow >= q && N >= 8 && rate >= q + 0.05 && noTeamAgainst ? 'confirmado'
    : value >= VALUE_WEAK && (N < 8 || rate >= q - 0.05) ? 'sem confirmação' : 'sem valor';
  return { value, level };
}
