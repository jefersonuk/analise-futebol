// Entrada ao vivo nos escanteios do 1º tempo, nos primeiros minutos do jogo.
//
// Antes do jogo, o total de escanteios do 1º tempo é uma binomial negativa: média μ (o modelo, com o total
// puxado para o total 1T da Pinnacle) e dispersão φ (variância/média medida na liga). A binomial negativa é
// uma mistura gama–Poisson: cada jogo tem o seu ritmo de escanteios, e esse ritmo varia de jogo para jogo.
// Ao vivo, o que já aconteceu ensina sobre o ritmo DESTE jogo: c escanteios na fração f do 1º tempo
// atualizam a gama (forma r + c, taxa r/μ + f, com r = μ/(φ − 1)), e o que falta (fração 1 − f) segue uma
// binomial negativa com
//     média  (r + c)/(r/μ + f) · (1 − f)        forma  r + c
// Sem escanteio nos primeiros minutos, o ritmo esperado do jogo cai — é por isso que a odd do over sobe —
// e a pergunta é se ela sobe mais do que deveria. Com escanteio cedo, o ritmo esperado sobe.
//
// Tempo: 45 min + ~2 de acréscimo, ritmo uniforme dentro do tempo. Os estudos de distribuição dos escanteios
// mostram um pouco menos no começo e mais no fim do tempo; o ritmo uniforme subestima o que falta depois dos
// primeiros minutos, o que deixa a conta conservadora para o over (o lado da entrada).
//
// O que a conta NÃO vê: placar (gol antes da entrada muda o ritmo — quem sai perdendo pressiona e gera
// escanteio; o favorito que abre o placar tende a recuar), expulsão e o ritmo real do jogo (pressão, chutes
// bloqueados). Nesses casos o plano não vale e a entrada fica a critério de quem está vendo o jogo.

import { dist, politicaE, settle, stakeFor } from './model.js';

export const HALF_MIN = 47;                    // 45 + acréscimo médio do 1º tempo
export const LIVE_LINES = [2.5, 3, 3.5, 4, 4.5];
export const LIVE_MINUTES = [0, 3, 5, 8, 10];
export const LIVE_CORNERS = [0, 1, 2];
// Margem sobre a odd justa: o total 1T vem da Pinnacle pré-jogo, mas a atualização ao vivo é só do modelo.
export const MARGIN = { anchored: 1.05, model: 1.08 };
export const LIVE_CAVEAT = 'Vale com o jogo 0 a 0 e 11 contra 11. Gol ou expulsão antes da entrada mudam o ritmo de escanteios '
  + '(quem sai perdendo pressiona; o favorito que abre o placar tende a recuar): aí o plano não vale.';

const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// O que falta no 1º tempo, dado o minuto e os escanteios já cobrados: média e dispersão da binomial negativa.
export function remaining({ mu, phi, minute, corners }) {
  const f = Math.min(Math.max(minute, 0), HALF_MIN - 1) / HALF_MIN;
  if (!(phi > 1.02)) return { mean: mu * (1 - f), phi: 1 };
  const r = mu / (phi - 1), shape = r + corners, mean = shape / (r / mu + f) * (1 - f);
  return { mean, phi: 1 + mean / shape };
}

// Chance de uma linha do total do 1º tempo ao vivo (liquidação asiática: linha inteira devolve no empate).
// side: 'O' (mais de) ou 'U' (menos de).
export function liveLine({ mu, phi, minute, corners, line, side = 'O' }) {
  const rem = remaining({ mu, phi, minute, corners });
  const pmf = dist(rem.mean, rem.phi, Math.ceil(rem.mean * 3 + 25));
  const entries = pmf.map((p, k) => [corners + k, p]);
  const s = side === 'O' ? settle(entries, -line) : settle(entries.map(([v, p]) => [-v, p]), line);
  const p = s.pWin + s.pLose > 0 ? s.pWin / (s.pWin + s.pLose) : 0;
  return { pWin: s.pWin, pLose: s.pLose, p, fair: s.pWin > 0 ? 1 + s.pLose / s.pWin : Infinity,
    expected_remaining: rem.mean, expected_total: corners + rem.mean };
}

// Plano de entrada de um jogo: para cada número de escanteios já cobrados e cada minuto até os 10', a chance
// e a odd mínima do over de cada linha. Pronto antes do jogo: ao vivo, basta olhar minuto, escanteios e a odd.
// mu: escanteios esperados no 1º tempo; anchored: o total veio da Pinnacle (margem 5%) ou só do modelo (8%).
export function livePlan({ mu, phi, anchored, pinnacle = null }) {
  if (!(mu > 0)) return null;
  const margin = anchored ? MARGIN.anchored : MARGIN.model;
  const tables = LIVE_CORNERS.map(c => ({
    corners: c,
    rows: LIVE_MINUTES.map(m => ({
      minute: m,
      cells: LIVE_LINES.map(L => {
        const x = liveLine({ mu, phi, minute: m, corners: c, line: L });
        return { line: L, p: r3(x.p), fair: r2(x.fair), odd_min: r2(x.fair * margin) };
      }),
    })),
  }));
  return { mu: r2(mu), phi: r2(phi), anchored: !!anchored, pinnacle_total: r2(pinnacle), margin, half_minutes: HALF_MIN,
    lines: LIVE_LINES, minutes: LIVE_MINUTES, tables };
}

// Plano a partir do resultado do modelo (analyzeMatch): o total do 1º tempo já ancorado na Pinnacle quando
// ela cota o 1º tempo; sem ela, o do modelo (escanteios do jogo × fração do 1º tempo).
export function livePlanOf(res) {
  const p = res?.pred?.corners1h;
  if (!p) return null;
  const a = res.anchors?.corners1h;
  return livePlan({ mu: p.h + p.a, phi: res.phi.corners1h || 1, anchored: !!a, pinnacle: a?.pinnacle_total ?? null });
}

// Vale entrar agora? Minuto, escanteios já cobrados, linha (over) e a odd que a casa paga: chance, odd justa,
// odd mínima (com a margem), EV na odd e a entrada pela fórmula do app (¼ Kelly, teto, Política E).
export function liveEntry({ mu, phi, anchored, minute, corners, line, odd = null, banca = 44000 }) {
  const x = liveLine({ mu, phi, minute, corners, line });
  const margin = anchored ? MARGIN.anchored : MARGIN.model, oddMin = x.fair * margin;
  const out = { p: x.p, fair: x.fair, odd_min: oddMin, margin, expected_remaining: x.expected_remaining,
    expected_total: x.expected_total, settled: x.pLose === 0 ? 'ganha' : x.pWin === 0 ? 'perdida' : null };
  if (!(odd > 1)) return out;
  const ev = x.pWin * (odd - 1) - x.pLose, pe = politicaE(odd);
  const value = odd >= oddMin && pe.factor > 0;
  const stake = value ? stakeFor(x.p, odd, banca) : null;
  return { ...out, odd, ev, value, politica_e: pe.label, entry_brl: stake ? stake.entry_brl : 0,
    why: value ? null : pe.factor === 0 ? 'odd acima de 3,00: fora da Política E'
      : ev > 0 ? 'EV positivo, mas abaixo da margem de segurança' : 'EV negativo nessa odd' };
}
