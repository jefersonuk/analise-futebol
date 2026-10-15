// As varreduras guardadas neste aparelho (af:scan:*: as do Plano do dia e as da aba Varredura), para a simulação achar o
// jogo de uma entrada — com as linhas da análise — sem gastar requisição. prefer: a hora da varredura da simulação (vem
// primeiro); depois as outras, da mais nova à mais velha.

import { keys, load } from './store.js';
import { multiGames } from './multiple.js';

async function scans(prefer = null) {
  const ks = (await keys()).filter(k => String(k).startsWith('af:scan:'));
  const list = (await Promise.all(ks.map(k => load(k)))).filter(s => s?.games?.length);
  return list.sort((a, b) => (b.generated_at === prefer) - (a.generated_at === prefer) || Date.parse(b.generated_at) - Date.parse(a.generated_at));
}

// o jogo (scanner.js: fx, lines, scenario, combos, fav_combos, fav_half…) ou null
export async function findGame(fixtureId, prefer = null) {
  for (const s of await scans(prefer)) { const g = s.games.find(x => x.fx.id === fixtureId); if (g) return g; }
  return null;
}

// as pernas de um bilhete da simulação ([{ fixtureId, lineId }]) como a aba Múltipla as monta (multiple.js), ou null se
// faltar alguma
export async function findLegs(legs, prefer = null) {
  const opts = new Map();
  for (const s of (await scans(prefer)).reverse()) for (const m of multiGames(s.games, { now: 0 })) for (const o of m.options) opts.set(`${o.fixtureId}:${o.lineId}`, o);
  const out = legs.map(l => opts.get(`${l.fixtureId}:${l.lineId}`));
  return out.every(Boolean) ? out : null;
}
