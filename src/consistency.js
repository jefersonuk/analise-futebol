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
  const eachTeamOk = hits.length > 0 && hits.every(h => !h.n || h.wins / h.n >= 0.6);
  const bothOk = n < 10 || wins / n >= 0.5;   // o histórico somado não pode contradizer a linha
  const tier = p >= 0.6 && pLow >= 0.5 && eachTeamOk ? 'âncora'
    : p >= 0.52 && pLow >= 0.42 && bothOk ? 'sólida'
      : 'especulativa';
  return { score, tier, hit_rate: n ? wins / n : null };
}

export const TIER_ORDER = { 'âncora': 0, 'sólida': 1, 'especulativa': 2 };
export const ODD_FLOOR = 1.5;   // abaixo disso fica fora do núcleo (filtros do surebet.com começam em 1,50)
