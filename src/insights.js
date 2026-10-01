// Leituras em texto sobre o confronto, a partir das forças da liga e dos jogos recentes.

import { rank } from './ratings.js';

const pct = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`;
const n2 = x => x.toFixed(2).replace('.', ',');

// Últimos n jogos do time na liga, do mais recente para o mais antigo, com xG-proxy.
export function recentGames(prep, team, n = 10) {
  return prep.rows.filter(m => m.h === team || m.a === team)
    .sort((a, b) => b.t - a.t).slice(0, n)
    .map(m => {
      const home = m.h === team, s = m.s;
      const pick = i => (s ? [s[(home ? 0 : 5) + i], s[(home ? 5 : 0) + i]] : null);
      return {
        t: m.t, home, opp: home ? m.an : m.hn, league: m.ln || '',
        gf: home ? m.hg : m.ag, ga: home ? m.ag : m.hg,
        xf: s ? prep.xg(m, home) : null, xa: s ? prep.xg(m, !home) : null,
        corners: pick(4), shots: pick(3), sot: pick(2),
        c1: m.c1 ? (home ? [m.c1[0], m.c1[1]] : [m.c1[1], m.c1[0]]) : null,
      };
    });
}

function finishing(games, name) {
  const g = games.filter(x => x.xf != null);
  if (g.length < 5) return [];
  const out = [];
  const dFor = g.reduce((s, x) => s + x.gf - x.xf, 0) / g.length;
  const dAg = g.reduce((s, x) => s + x.ga - x.xa, 0) / g.length;
  if (Math.abs(dFor) >= 0.25) out.push({
    tone: dFor > 0 ? 'down' : 'up',
    text: `${name} marcou ${n2(Math.abs(dFor))} gol/jogo ${dFor > 0 ? 'acima' : 'abaixo'} do xG-proxy nos últimos ${g.length} jogos. `
      + `Conversão é mais sorte que habilidade (43% repetível): espere ${dFor > 0 ? 'queda' : 'melhora'} — o modelo já usa 70% xG-proxy.`,
  });
  if (Math.abs(dAg) >= 0.25) out.push({
    tone: dAg > 0 ? 'up' : 'down',
    text: `${name} sofreu ${n2(Math.abs(dAg))} gol/jogo ${dAg > 0 ? 'acima' : 'abaixo'} do xG-proxy cedido. `
      + `${dAg > 0 ? 'Defesa melhor do que o placar mostra.' : 'Goleiro/sorte seguraram: a defesa é pior do que o placar mostra.'}`,
  });
  return out;
}

function profile(fits, team, name) {
  const parts = [];
  const g = fits.goals;
  const ra = rank(g, team, 'att'), rd = rank(g, team, 'def');
  if (ra) parts.push(`ataque ${ra.pos}º de ${ra.of} (${pct(ra.value - 1)})`);
  if (rd) parts.push(`defesa ${rd.pos}º (${pct(rd.value - 1)} cedido)`);
  if (fits.corners) {
    const ca = rank(fits.corners, team, 'att'), cd = rank(fits.corners, team, 'def');
    if (ca && cd) parts.push(`escanteios a favor ${ca.pos}º (${pct(ca.value - 1)}), cedidos ${cd.pos}º (${pct(cd.value - 1)})`);
  }
  return parts.length ? { tone: 'info', text: `${name}: ${parts.join(' · ')}. Forças já ajustadas pelo nível dos adversários.` } : null;
}

// Mando próprio do time além do mando da liga (altitude, viagem, estádio).
function venue(fits, team, name, atHome) {
  const g = fits.goals.gap?.get(team);
  if (!g || Math.abs(g - 1) < 0.06) return null;
  const strong = g > 1, eff = atHome ? g : 1 / g;
  return {
    tone: (atHome ? strong : !strong) ? 'up' : 'down',
    text: `${name} tem mando próprio ${strong ? 'forte' : 'fraco'}: em casa produz ${pct(g - 1)} e cede ${pct(1 / g - 1)} além do mando da liga; `
      + `fora, o inverso. Neste jogo ${atHome ? 'em casa' : 'fora'}: gols a favor ${pct(eff - 1)}.`
      + (strong ? ' Padrão típico de altitude ou viagem longa.' : ''),
  };
}

export function buildInsights(res, home, away, names) {
  const { fits, pred, prep } = res;
  const out = [];
  if (!fits.goals) return [{ tone: 'warn', text: 'Jogos insuficientes na liga para ajustar as forças.' }];

  if (!pred.goals.known) out.push({ tone: 'warn', text: 'Um dos times não tem jogos nessa liga no período: ele entra como time médio, com incerteza alta.' });
  for (const [t, name] of [[home, names.home], [away, names.away]]) {
    const w = fits.goals.games.get(t) || 0;
    if (w && w < 8) out.push({ tone: 'warn', text: `${name}: pouco histórico recente na liga (${w.toFixed(1)} jogos-equivalentes). A estimativa está puxada para a média da liga.` });
  }
  if (prep.coverage < 0.6) out.push({ tone: 'warn', text: `Só ${(prep.coverage * 100).toFixed(0)}% dos jogos da liga têm estatística de chutes: gols pesam mais e escanteios/chutes ficam menos confiáveis.` });

  out.push({ tone: 'info', text: `Mando na liga: o mandante produz ${pct(fits.goals.home - 1)} em gols (xG-proxy + gols)`
    + (fits.corners ? ` e ${pct(fits.corners.home - 1)} em escanteios.` : '.') });

  for (const [t, name, atHome] of [[home, names.home, true], [away, names.away, false]]) {
    const p = profile(fits, t, name), v = venue(fits, t, name, atHome);
    if (p) out.push(p);
    if (v) out.push(v);
    out.push(...finishing(recentGames(prep, t), name));
  }

  const g = pred.goals, lg = fits.goals.avgH + fits.goals.avgA, tg = g.h + g.a;
  out.push({ tone: Math.abs(tg / lg - 1) > 0.12 ? (tg > lg ? 'up' : 'down') : 'info',
    text: `Gols projetados: ${n2(tg)} (casa ${n2(g.h)} × fora ${n2(g.a)}), ${pct(tg / lg - 1)} contra a média da liga (${n2(lg)}).` });
  if (pred.corners) {
    const c = pred.corners, lc = fits.corners.avgH + fits.corners.avgA, tc = c.h + c.a;
    out.push({ tone: Math.abs(tc / lc - 1) > 0.1 ? (tc > lc ? 'up' : 'down') : 'info',
      text: `Escanteios projetados: ${n2(tc)} (${n2(c.h)} × ${n2(c.a)}), ${pct(tc / lc - 1)} contra a liga (${n2(lc)}). `
        + `Dispersão da liga ${n2(res.phi.corners)}. Lembre: o mercado de escanteios costuma pôr a margem no over.` });
  }
  return out;
}
