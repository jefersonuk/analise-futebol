// Consistência primeiro, preço depois: uma linha só interessa se acerta com frequência e de forma
// estável; o EV entra como filtro (odd mínima), não como critério de ordenação.
// Níveis calibrados para a faixa de odd que o Jeferson opera (1,50–2,09 no núcleo): âncora ≈ odd justa
// até ~1,67; sólida até ~1,92.
//
//   p        probabilidade de ganhar (sem push): p_blend quando há Pinnacle, senão a do modelo
//   pLow     pior cenário do modelo (−1 erro-padrão)
//   hits     histórico dos dois times na linha: [{ wins, n }] (meia vitória conta 0,5)

const PRIOR = 10;   // o histórico de 10 jogos é encolhido para p com peso de 10 jogos

export function consistency({ p, pLow, hits = [] }) {
  const wins = hits.reduce((s, h) => s + h.wins, 0), n = hits.reduce((s, h) => s + h.n, 0);
  const hitShrunk = (wins + PRIOR * p) / (n + PRIOR);
  const score = 0.5 * p + 0.25 * pLow + 0.25 * hitShrunk;
  // âncora exige histórico de verdade: os dois times com 5+ jogos na linha e 60%+ de acerto
  const eachTeamOk = hits.length > 0 && hits.every(h => h.n >= 5 && h.wins / h.n >= 0.6);
  const bothOk = n < 10 || wins / n >= 0.5;   // o histórico somado não pode contradizer a linha
  const tier = p >= 0.6 && pLow >= 0.5 && eachTeamOk ? 'âncora'
    : p >= 0.52 && pLow >= 0.42 && bothOk ? 'sólida'
      : 'especulativa';
  return { score, tier, hit_rate: n ? wins / n : null };
}

export const TIER_ORDER = { 'âncora': 0, 'sólida': 1, 'especulativa': 2 };
export const ODD_FLOOR = 1.5;   // abaixo disso fica fora do núcleo (filtros do surebet.com começam em 1,50)

// ---- linhas principais do pré-jogo ----
// As que têm odd para entrar antes do jogo (as mais baixas — escanteios 1T 3,5, jogo 7 — só pagam no ao
// vivo, e o plano ao vivo do 1º tempo está em live.js): escanteios do 1º tempo 4 a 5,5 e do jogo 8 a 11 (de
// 0,5 em 0,5: nos jogos de muitos escanteios, 8–9 saem abaixo de 1,50 e as opções estão em 9,5–11), over ou
// under; gols do 1º tempo 1,5 e do jogo 1,5 e 2,5, só over. Os handicaps do jogo inteiro nas linhas que a
// Pinnacle cota — de escanteios e de gols (asiático) — completam a lista. Linha que a Pinnacle não cota num
// total que ela cota sai do total dela (dossier.js); sem a Pinnacle nos escanteios, só do modelo.
export const MAIN_LINES = { 'Total escanteios 1T': ['c1', [4, 4.5, 5, 5.5], 'OU'], 'Total de escanteios': ['corners', [8, 8.5, 9, 9.5, 10, 10.5, 11], 'OU'],
  'Total de gols 1T': ['g1', [1.5], 'O'], 'Total de gols': ['g', [1.5, 2.5], 'O'] };
const MAIN_IDS = new Set(Object.values(MAIN_LINES).flatMap(([k, ls, sides]) => ls.flatMap(L => [...sides].map(s => `${k}${s}${L}`))));
export const isMain = id => MAIN_IDS.has(id);
// Linha asiática fracionada (,25 ou ,75), que o app não oferece.
export const isQuarter = id => { const m = String(id).match(/-?\d+(?:\.\d+)?$/); return !!m && Math.round(Math.abs(+m[0]) * 4) % 2 === 1; };
export const HANDICAP = 'Handicap de escanteios';
export const GOAL_HANDICAP = 'Handicap asiático';
// Linha principal com preço da Pinnacle (direto, ou derivado do total que ela cota): um total da lista ou um
// handicap do jogo (escanteios ou gols) que ela cota.
export const isMainLine = l => (l.priced_by === 'pinnacle' && (isMain(l.id) || l.market === HANDICAP || l.market === GOAL_HANDICAP))
  || (l.derived && isMain(l.id));

// Preferência do Jeferson: OVER em gols e escanteios. Under (e "ninguém chega a N", que é um under) só
// quando é muito atrativo: só vira candidata se for âncora, e na ordem conta um nível abaixo e com
// UNDER_PENALTY a menos no score — passa na frente de um over apenas quando é claramente mais consistente.
// Exceção pedida por ele: nos totais de escanteios das linhas principais, over e under valem igual.
export const isUnder = id => /^(g|g1|corners|c1|cH|cA)U|^crN/.test(id);
export const UNDER_PENALTY = 0.05;
const penalized = id => isUnder(id) && !isMain(id);
export const rankTier = l => TIER_ORDER[l.tier] + (penalized(l.id) ? 1 : 0);
export const rankScore = l => (l.consistency_score ?? 0) - (penalized(l.id) ? UNDER_PENALTY : 0);
export const underOk = l => !penalized(l.id) || l.tier === 'âncora';

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
