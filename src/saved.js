// Análises guardadas até o horário do jogo: reabrir o jogo remonta a análise a partir da cópia (jogos da
// base, odds da Pinnacle e dossiê), sem nenhuma requisição à API. Com a ☁️ nuvem conectada, a cópia vale
// em todos os aparelhos. Depois do jogo (+3 h) a cópia é apagada.
//
//   af:an:<jogo>  { v, savedAt, fixture, team, matches, oddsP, dossier }
//   af:anidx      { <jogo>: { id, home, away, league, t, savedAt, oddsAt } }

import { loadDoc, removeDoc, saveDoc } from './api.js';

const IDX = 'af:anidx';
const KEY = id => `af:an:${id}`;
const GRACE = 3 * 3600e3;

async function index() {
  const idx = (await loadDoc(IDX)) || {};
  const gone = Object.values(idx).filter(x => x.t < Date.now() - GRACE);
  if (gone.length) {
    for (const x of gone) { delete idx[x.id]; removeDoc(KEY(x.id)); }
    await saveDoc(IDX, idx);
  }
  return idx;
}

// Jogos com análise guardada que ainda não começaram, do mais próximo ao mais distante.
export async function listSaved() {
  return Object.values(await index()).filter(x => x.t > Date.now()).sort((a, b) => a.t - b.t);
}

export async function saveAnalysis({ fixture, team, matches, oddsP, dossier }) {
  const savedAt = new Date().toISOString();
  await saveDoc(KEY(fixture.id), { v: 1, savedAt, fixture, team, matches, oddsP, dossier });
  const idx = await index();
  idx[fixture.id] = { id: fixture.id, home: fixture.home.name, away: fixture.away.name, league: fixture.league.name,
    t: fixture.t, savedAt, oddsAt: oddsP?.updatedAt || null };
  await saveDoc(IDX, idx);
}

// A cópia do jogo, se ainda vale (jogo não começou).
export async function loadAnalysis(id) {
  const a = await loadDoc(KEY(id));
  return a && a.v === 1 && a.fixture.t > Date.now() ? a : null;
}
