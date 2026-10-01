// Odds pré-jogo da Pinnacle (a casa que regula o mercado) -> linhas do modelo,
// com a probabilidade sem margem (método power).

export const PINNACLE = 4;

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
    case 5: case 50: case 45: case 77: {   // 77 = total de escanteios do 1º tempo
      if (!(m = v.match(/^(Over|Under)\s*([\d.]+)$/))) return null;
      const pre = { 45: 'corners', 77: 'c1' }[betId] || 'g';
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

// odds: id da linha -> odd da Pinnacle; fair: id -> probabilidade sem margem.
export function collect(bookmakers) {
  const odds = new Map(), fair = new Map(), groups = new Map();
  const pin = bookmakers.find(b => b.id === PINNACLE);
  for (const bet of pin?.bets || []) for (const val of bet.values) {
    const map = mapValue(bet.id, val.value), odd = parseFloat(val.odd);
    if (!map || !(odd > 1)) continue;
    odds.set(map.id, odd);
    const key = `${bet.id}|${map.group}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: map.id, odd });
  }
  for (const legs of groups.values()) {
    if (legs.length < 2) continue;
    devig(legs.map(l => l.odd)).forEach((p, i) => fair.set(legs[i].id, p));
  }
  return { odds, fair };
}
