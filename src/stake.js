// Entrada padrão e casa principal (Jeferson, 13/10/2026: "valor de entrada padrão 10 € e Sportmarket como casa principal,
// a primeira da lista"). O plano, a simulação e o formulário ➕ Entrar partem daqui; no formulário, a stake é convertida
// para a moeda da casa escolhida pela cotação do app de apostas.
export const STAKE = { value: 10, cur: 'EUR' };
export const MAIN_HOUSE = 'Sportmarket';
export const CUR_SYMBOL = { BRL: 'R$', USD: 'US$', EUR: '€' };
// 10 € · R$ 150 · US$ 20 (o euro e o dólar depois do número, como se escreve em português; o real antes)
export function money(v, cur = STAKE.cur, d = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }), s = v < 0 ? '−' : '';
  return cur === 'BRL' ? `${s}R$ ${n}` : `${s}${n} ${CUR_SYMBOL[cur] || cur}`;
}
