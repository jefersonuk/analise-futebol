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

// Preferência do Jeferson: OVER em gols e escanteios. Under (e "ninguém chega a N", que é um under) só
// quando é muito atrativo: só vira candidata se for âncora, e na ordem conta um nível abaixo e com
// UNDER_PENALTY a menos no score — passa na frente de um over apenas quando é claramente mais consistente.
export const isUnder = id => /^(g|g1|corners|c1|cH|cA)U|^crN/.test(id);
export const UNDER_PENALTY = 0.05;
export const rankTier = l => TIER_ORDER[l.tier] + (isUnder(l.id) ? 1 : 0);
export const rankScore = l => (l.consistency_score ?? 0) - (isUnder(l.id) ? UNDER_PENALTY : 0);
export const underOk = l => !isUnder(l.id) || l.tier === 'âncora';

// ---- valor nas linhas principais (pré-jogo) ----
// Linhas que têm odd para entrar antes do jogo: escanteios do 1º tempo 4 e 4,5, do jogo 8 e 8,5; gols do
// 1º tempo 1,5, do jogo 1,5 e 2,5. As mais baixas (escanteios 1T 3,5, jogo 7) só pagam no ao vivo.
export const MAIN_LINES = { 'Total escanteios 1T': ['c1', [4, 4.5]], 'Total de escanteios': ['corners', [8, 8.5]],
  'Total de gols 1T': ['g1', [1.5]], 'Total de gols': ['g', [1.5, 2.5]] };
const MAIN_IDS = new Set(Object.values(MAIN_LINES).flatMap(([k, ls]) => ls.flatMap(L => [`${k}O${L}`, `${k}U${L}`])));
export const isMain = id => MAIN_IDS.has(id);

// Valor: a nossa probabilidade (mistura Pinnacle × modelo, sem push) contra a da Pinnacle sem margem —
// value = p/q − 1, o EV de quem pega a odd justa da Pinnacle. Conferido pelo pior cenário do modelo e pelo
// histórico dos dois times no papel de hoje (hits: [{ wins, n }], acerto pesado pelo papel):
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
export const VALUE_ORDER = { confirmado: 0, 'sem confirmação': 1, 'sem valor': 2 };

// Aposta de valor: valor confirmado, odd mínima na faixa operada (≥ 1,50 e permitida pela Política E), que
// a casa soft consegue pagar (até 5% acima da Pinnacle) e over — under só com valor de +4% ou mais.
export const isValueBet = l => l.value_level === 'confirmado' && l.odd_min >= ODD_FLOOR && l.politica_e !== 'não entrar'
  && l.odd_min_vs_pinnacle_pct <= 5 && !l.inviable && (!isUnder(l.id) || l.value_pct >= 4);
// Ordem: nível de valor, valor (under com 2 pontos a menos), facilidade do preço.
const valueRank = l => (l.value_pct ?? -99) - (isUnder(l.id) ? 2 : 0);
export const byValue = (a, b) => (VALUE_ORDER[a.value_level] ?? 3) - (VALUE_ORDER[b.value_level] ?? 3) || valueRank(b) - valueRank(a)
  || (a.odd_min_vs_pinnacle_pct ?? 99) - (b.odd_min_vs_pinnacle_pct ?? 99);
