// ✍️ Aposta manual (Jeferson, 15/10/2026: "entrada manual com acompanhamento de jogos que eu fiz sem passar pela sua
// análise — na maioria múltiplas de mais de um jogo, às vezes de um jogo só e múltipla dentro do mesmo jogo; eu insiro e
// você adiciona no app de apostas para acompanhar o resultado"). O bilhete em pernas: cada uma um jogo (da lista do dia
// da API ou digitado) e uma linha escrita como na casa ("Flamengo vence", "Mais de 2,5", "Ambas marcam", "1X"); várias
// linhas do mesmo jogo numa vez só com " + " ("Flamengo vence + Mais de 2,5"). Uma perna vira a simples de antes; duas ou
// mais, a múltipla (de vários jogos ou no mesmo jogo), com as pernas em analise.legs. Perna com jogo da API e linha
// reconhecida é conferida sozinha pelo app de apostas e acompanhada ao vivo (settlement.js checkMulti/liveMulti); as
// outras ficam para marcar à mão lá.

import { buildEntry } from './entry.js';
import { marketOfId, parseLine } from './myline.js';

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const localStr = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };

// "Flamengo vence + Mais de 2,5 gols" -> duas linhas (o "+" com espaço dos dois lados: "+1,5" é handicap)
export const splitLegs = text => String(text || '').split(/\s\+\s/).map(s => s.trim()).filter(Boolean);

// Uma perna: fx = o jogo (da API, com id; digitado, id null) e a linha escrita. auto: o app de apostas confere sozinho.
export function legOf(fx, text) {
  const linha = String(text || '').trim(), p = parseLine(linha, { names: { home: fx.home.name, away: fx.away.name }, settle: true });
  const lineId = p.id || null;
  return { fixtureId: fx.id || null, kickoff: new Date(fx.t).toISOString(), home: fx.home.name, away: fx.away.name,
    competition: fx.league?.name || 'Entrada manual', lineId, linha, mercado: (lineId && marketOfId(lineId)) || 'Entrada manual',
    auto: !!(fx.id && lineId), error: lineId ? null : p.error && !/^Não reconheci/.test(p.error) ? p.error : 'linha não reconhecida' };
}

// O jogo de uma perna (o mesmo jogo: o mesmo id da API; digitado, os times e o dia)
export const gameKey = l => (l.fixtureId ? `id${l.fixtureId}` : `${norm(l.home)}|${norm(l.away)}|${String(l.kickoff).slice(0, 10)}`);
// simples (1 perna), mesmo jogo (todas no mesmo jogo) ou múltipla
export function ticketKind(legs) {
  if (legs.length < 2) return 'simples';
  return new Set(legs.map(gameKey)).size === 1 ? 'mesmo jogo' : 'múltipla';
}

// Os atalhos de linha do jogo: [rótulo, texto] (o texto vai para o campo; dois atalhos seguidos fazem o mesmo jogo)
export function quickLines(names) {
  const h = names.home, a = names.away;
  return [[`${h} vence`, `${h} vence`], ['Empate', 'Empate'], [`${a} vence`, `${a} vence`], [`${h} ou empate`, `${h} ou empate`],
    [`${a} ou empate`, `${a} ou empate`], ['Mais de 1,5', 'Mais de 1,5 gols'], ['Mais de 2,5', 'Mais de 2,5 gols'], ['Ambas marcam', 'Ambas marcam']];
}

// Os jogos da lista do dia que batem com o que foi digitado (parte do nome do mandante ou do visitante), por horário
export function pickMatches(list, q, max = 12) {
  const n = norm(q);
  if (n.length < 3) return [];
  return (list || []).filter(f => norm(f.home.name).includes(n) || norm(f.away.name).includes(n)).sort((a, b) => a.t - b.t).slice(0, max);
}

// A perna como linha do formulário de entrada (entryview.js), para a simples
const lineOfLeg = l => ({ id: l.lineId, market: l.mercado, line: l.linha, tier: 'manual', p_blend: null, p_model: null, fair_odd_blend: null,
  odd_min: null, pinnacle_odd: null, priced_by: 'manual', fragile: false, manual: true, recognized: !!l.lineId });
const fxOfLeg = l => ({ id: l.fixtureId, t: Date.parse(l.kickoff), home: { name: l.home }, away: { name: l.away }, league: { name: l.competition } });

// O registro para a caixa do app de apostas (o formato de entry.js). Simples: como a entrada manual de uma linha.
// Múltipla e mesmo jogo: as pernas em analise.legs; fixtureId/kickoff são os da última perna (a da API, para o ao vivo),
// first_kickoff o da primeira.
export function buildTicket({ legs, casa, currency, odd, stake, stakeNat = null }) {
  if (!legs?.length) throw new Error('bilhete sem perna');
  if (legs.length === 1) return buildEntry({ line: lineOfLeg(legs[0]), fx: fxOfLeg(legs[0]), casa, currency, odd, stake, stakeNat });
  const t = l => Date.parse(l.kickoff), kind = ticketKind(legs), same = kind === 'mesmo jogo', g = legs[0];
  const latest = xs => xs.reduce((a, b) => (t(b) > t(a) ? b : a));
  const last = latest(legs), api = legs.filter(l => l.fixtureId), lastApi = api.length ? latest(api) : null, first = Math.min(...legs.map(t));
  const lines = legs.map(l => l.linha).join(' + ');
  return {
    id: `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString(), v: 2,
    casa, cur: currency || 'BRL', odd, stake, stakeNat: stakeNat ?? stake, sport: 'Futebol', market: same ? 'Combo (criar aposta)' : 'Múltipla',
    event: same ? `${g.home} x ${g.away} — Mesmo jogo: ${lines}` : `Múltipla (${legs.length}) — ${legs.map(l => `${l.home} x ${l.away} ${l.linha}`).join(' · ')}`,
    date: localStr(first), oddMkt: null, prob: null,
    analise: {
      manual: true, multi: true, ...(same ? { same_game: true, home: g.home, away: g.away } : {}),
      legs: legs.map(({ auto, error, ...l }) => ({ ...l, odd_casa: null })),
      fixtureId: lastApi?.fixtureId ?? null, lineId: 'multi', kickoff: last.kickoff, first_kickoff: new Date(first).toISOString(),
      competition: [...new Set(legs.map(l => l.competition))].join(', '), mercado: same ? 'Mesmo jogo' : 'Múltipla',
      linha: same ? lines : `${legs.length} pernas`, tier: 'manual',
      p_blend: null, p_pinnacle: null, fair_odd: null, odd_min: null, pinnacle_odd: null, priced_by: 'manual',
    },
  };
}
