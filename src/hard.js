// Jogo difícil de analisar: o modelo usa uma média, um mando e uma dispersão só para a base inteira e põe os
// times na mesma escala pelos jogos entre eles. Isso falha em dois casos, e aí o app não recomenda aposta —
// no máximo over de gols com a odd da Pinnacle (o preço é 90% dela), com metade da entrada:
//   1. time de base, reservas ou B (sub-21, sub-23, II, Jong…), ou competição de base: elenco muda toda semana,
//      jogadores sobem e descem, e a API quase não tem estatística desses jogos
//   2. times de ligas diferentes com poucos jogos entre as duas ligas na base: a diferença de nível entre elas
//      não está medida (com 30 jogos, o erro do nível relativo ainda é de ~0,3 gol por jogo)

// "Juniors" fica de fora: Boca Juniors e Argentinos Juniors são times principais.
const YOUTH_WORDS = /\b(U-?\d{2}|Sub-?\d{2}|Reserves?|Res\.|Jong|Next Gen|Youth|Primavera|Academy|Juvenil|Juniores)\b/i;
const YOUTH_SUFFIX = /\s(II|III|B)$/;   // "Real Madrid II", "Benfica B": sem o i, para não pegar nomes comuns
const YOUTH_LEAGUE = /\b(U-?\d{2}|Sub-?\d{2})\b|Youth|Reserv|Primavera|Premier League 2|Juvenil|Junior|Next Pro/i;
export const MIN_LINKS = 30;

export const isYouth = name => YOUTH_WORDS.test(name || '') || YOUTH_SUFFIX.test((name || '').trim());

// Liga de cada time na base: a competição em que ele mais jogou, fora a do jogo de hoje (copa entre ligas).
function primaryLeagues(rows, skip) {
  const count = new Map(), names = new Map();
  for (const m of rows) {
    if (m.lg == null || m.lg === skip) continue;
    names.set(m.lg, m.ln);
    for (const t of [m.h, m.a]) {
      if (!count.has(t)) count.set(t, new Map());
      const c = count.get(t);
      c.set(m.lg, (c.get(m.lg) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [t, c] of count) {
    const [lg] = [...c].sort((a, b) => b[1] - a[1])[0];
    out.set(t, { id: lg, name: names.get(lg) || `liga ${lg}` });
  }
  return out;
}

// fx: o jogo; rows: os jogos da base antes dele (prep.rows). Devolve { reasons } ou null.
export function hardGame({ fx, rows }) {
  const reasons = [];
  const youth = [fx.home, fx.away].filter(t => isYouth(t.name));
  if (youth.length) reasons.push(`${youth.map(t => t.name).join(' e ')}: time de base, reservas ou B`);
  else if (YOUTH_LEAGUE.test(fx.league?.name || '')) reasons.push(`${fx.league.name}: competição de base ou reservas`);
  const lg = primaryLeagues(rows, fx.league?.id), lh = lg.get(fx.home.id), la = lg.get(fx.away.id);
  if (lh && la && lh.id !== la.id) {
    const links = rows.filter(m => {
      const a = lg.get(m.h)?.id, b = lg.get(m.a)?.id;
      return (a === lh.id && b === la.id) || (a === la.id && b === lh.id);
    }).length;
    if (links < MIN_LINKS) reasons.push(`${lh.name} x ${la.name}: só ${links} jogo${links === 1 ? '' : 's'} entre times das duas ligas na base — a diferença de nível entre elas não está medida`);
  }
  return reasons.length ? { reasons } : null;
}

export const HARD_RULE = 'só over de gols com a odd da Pinnacle, com metade da entrada';
// O que sobra num jogo difícil: over de gols (jogo ou 1º tempo) com a odd da Pinnacle na própria linha.
export const hardAllowed = l => l.priced_by === 'pinnacle' && /^g1?O/.test(l.id);
// Aplica a regra a uma linha precificada: bloqueia o resto; a que sobra entra com metade da entrada.
export function applyHard(l, hard) {
  if (!hard) return l;
  if (hardAllowed(l)) return { ...l, entry_brl: Math.round((l.entry_brl || 0) / 2), reduced: 'metade da entrada: jogo difícil de analisar' };
  return { ...l, blocked: `jogo difícil de analisar: ${HARD_RULE}` };
}
