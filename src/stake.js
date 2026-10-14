// Entrada padrão e casa principal (Jeferson, 13/10/2026: "Sportmarket como casa principal, a primeira da lista"). O plano,
// a simulação e o formulário ➕ Entrar partem daqui; no formulário, a stake é convertida para a moeda da casa escolhida
// pela cotação do app de apostas.
//
// A entrada segue o acordo com a Pinnacle (Jeferson, 14/10/2026: "50% contra a Pinnacle e 100% quando for a favor;
// 100% = 20 €"). Nas apostas reais e nas simulações até 13/10, as da nossa leitura 5 pp ou mais acima da Pinnacle acertaram
// 44% — o que ela dizia, não o que nós dizíamos —, e as que concordavam com ela, de 62% a 67%. Contra = a marcação
// "contra a Pinnacle" do app (scenario.js: a nossa leitura 5 pp ou mais acima dela): metade, 10 €. O resto entra cheio,
// 20 €: o 🤝, o mesmo jogo, o 1º tempo e as múltiplas, com o preço da Pinnacle, e os chutes, que ela não cota (não há o
// que contrariar; 74% de acerto no teste das ligas grandes).
export const STAKE = { value: 20, cur: 'EUR' };
export const CONTRA_SHARE = 0.5;
export const MAIN_HOUSE = 'Sportmarket';
export const CUR_SYMBOL = { BRL: 'R$', USD: 'US$', EUR: '€' };
export const isContra = l => l?.contra === true;
// a entrada de uma aposta (linha, combo ou bilhete), na moeda de STAKE
export const stakeOf = l => (isContra(l) ? STAKE.value * CONTRA_SHARE : STAKE.value);
// 10 € · R$ 150 · US$ 20 (o euro e o dólar depois do número, como se escreve em português; o real antes)
export function money(v, cur = STAKE.cur, d = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }), s = v < 0 ? '−' : '';
  return cur === 'BRL' ? `${s}R$ ${n}` : `${s}${n} ${CUR_SYMBOL[cur] || cur}`;
}
