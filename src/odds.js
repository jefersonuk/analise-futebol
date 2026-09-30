// Odds pré-jogo da API-Football -> linhas do modelo.
// Melhor odd entre as casas permitidas e probabilidade da Pinnacle sem margem (método power).

export const PINNACLE = 4;
const BLOCKED = new Set([PINNACLE, 2]);   // Pinnacle: só referência (casa vetada). Marathonbet: lista "não usar".

const n = s => String(parseFloat(s));   // "2.50" -> "2.5", "-0" -> "0"

// Valor de aposta da API -> { id da linha no modelo, grupo de pernas complementares }.
// No handicap asiático a API rotula a perna do visitante com a linha do mandante ("Away -1" = visitante +1).
function mapValue(betId, value) {
  const v = String(value).trim();
  let m;
  switch (betId) {
    case 1: return { Home: '1', Draw: 'X', Away: '2' }[v] ? { id: { Home: '1', Draw: 'X', Away: '2' }[v], group: '1' } : null;
    case 8: return v === 'Yes' ? { id: 'bttsY', group: '8' } : v === 'No' ? { id: 'bttsN', group: '8' } : null;
    case 4:
      if (!(m = v.match(/^(Home|Away)\s*([+-]?[\d.]+)$/))) return null;
      return m[1] === 'Home' ? { id: `ahH${n(m[2])}`, group: `4:${n(m[2])}` } : { id: `ahA${n(-parseFloat(m[2]))}`, group: `4:${n(m[2])}` };
    case 5: case 50: case 45: {
      if (!(m = v.match(/^(Over|Under)\s*([\d.]+)$/))) return null;
      const pre = betId === 45 ? 'corners' : 'g';
      return { id: `${pre}${m[1] === 'Over' ? 'O' : 'U'}${n(m[2])}`, group: `${betId}:${n(m[2])}` };
    }
    default: return null;
  }
}

// Remove a margem: acha k tal que Σ (1/odd)^k = 1 (método power, mais fiel que dividir por igual).
export function devig(odds) {
  const q = odds.map(o => 1 / o);
  if (q.reduce((s, x) => s + x, 0) <= 1) return q;
  let lo = 1, hi = 3;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (q.reduce((s, x) => s + x ** k, 0) > 1) lo = k; else hi = k;
  }
  return q.map(x => x ** ((lo + hi) / 2));
}

export function collect(bookmakers) {
  const best = new Map(), pinn = new Map(), groups = new Map();
  for (const b of bookmakers) for (const bet of b.bets) for (const val of bet.values) {
    const map = mapValue(bet.id, val.value), odd = parseFloat(val.odd);
    if (!map || !(odd > 1)) continue;
    if (b.id === PINNACLE) {
      const key = `${bet.id}|${map.group}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: map.id, odd });
    }
    if (BLOCKED.has(b.id)) continue;
    const cur = best.get(map.id);
    if (!cur || odd > cur.odd) best.set(map.id, { odd, book: b.name });
  }
  for (const legs of groups.values()) {
    if (legs.length < 2) continue;
    devig(legs.map(l => l.odd)).forEach((p, i) => pinn.set(legs[i].id, p));
  }
  return { best, pinn };
}
