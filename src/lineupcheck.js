// Conferência perto do jogo (o "entrar se…" da nossa análise): a escalação de cada time contra os titulares
// habituais da temporada, as dúvidas da API, o mercado depois da escalação e o veredito da linha — entrada cheia,
// meia entrada, não entrar ou esperar a escalação.
//
// players: api.teamPlayers (jogadores da temporada: titular em quantos jogos, gols, ainda no elenco);
// xi: um time de api.lineups (startIds, benchIds, start).

export const REG_SHARE = 0.5;     // titular habitual: começou em metade ou mais dos jogos do time na temporada
export const MIN_GAMES = 4;       // abaixo disso a temporada não diz quem é titular
export const MOVE = 0.03;         // a Pinnacle mexeu 3% ou mais na linha
export const LINEUP_LEAD = 45 * 60e3;   // a escalação sai 20 a 40 min antes: odds de antes disso não sabem dela

// O time de hoje contra o habitual. level: completo (até 2 titulares fora), desfalcado (3 ou 4), misto (5+).
export function lineupReport(players, xi) {
  if (!xi?.startIds?.length) return null;
  const pool = (players || []).filter(p => p.in_squad !== false && p.starts > 0);
  const games = pool.length ? Math.max(...pool.map(p => p.starts)) : 0;   // jogos do time ≈ quem mais começou (o goleiro)
  if (games < MIN_GAMES) return { name: xi.name, formation: xi.formation, known: false, games, xi: xi.start || [] };
  const inXI = new Set(xi.startIds), bench = new Set(xi.benchIds || []);
  const regulars = pool.filter(p => p.starts >= REG_SHARE * games).sort((a, b) => b.starts - a.starts).slice(0, 11);
  const out = regulars.filter(p => !inXI.has(p.id)).map(p => ({ name: p.name, starts: p.starts, goals: p.goals, pos: p.pos, bench: bench.has(p.id) }));
  const byId = new Map(pool.map(p => [p.id, p]));
  const news = xi.startIds.map(id => byId.get(id) || { id, starts: 0 }).filter(p => p.starts < 0.25 * games).length;
  const scorer = pool.filter(p => p.goals >= 3).sort((a, b) => b.goals - a.goals)[0] || null;
  const scorerOut = scorer && !inXI.has(scorer.id) ? { name: scorer.name, goals: scorer.goals, bench: bench.has(scorer.id) } : null;
  const w = out.length + (scorerOut && !regulars.some(p => p.id === scorer.id) && !scorerOut.bench ? 1 : 0);
  return { name: xi.name, formation: xi.formation, known: true, games, regulars: regulars.length, kept: regulars.length - out.length, out, news,
    scorer: scorer && { name: scorer.name, goals: scorer.goals }, scorer_out: scorerOut, level: w >= 5 ? 'misto' : w >= 3 ? 'desfalcado' : 'completo',
    xi: xi.start || [] };
}

// Frase de um time: "HJK: 10 de 11 titulares habituais (fora: Pukki — titular em 20 de 22, no banco)".
export function reportText(r) {
  if (!r) return '';
  if (!r.known) return `${r.name}: sem histórico da temporada para saber quem é titular (${r.games} jogos)`;
  const out = r.out.map(p => `${p.name} — titular em ${p.starts} de ${r.games}${p.goals ? `, ${p.goals} gols` : ''}${p.bench ? ', no banco' : ', fora do jogo'}`);
  const sc = r.scorer_out ? ` · artilheiro ${r.scorer_out.name} (${r.scorer_out.goals} gols) ${r.scorer_out.bench ? 'no banco' : 'fora'}`
    : r.scorer ? ` · artilheiro ${r.scorer.name} (${r.scorer.goals} gols) joga` : '';
  return `${r.name}: ${r.kept} de ${r.regulars} titulares habituais${out.length ? ` (fora: ${out.join('; ')})` : ''}${r.news >= 3 ? ` · ${r.news} pouco usados entre os 11` : ''}${sc}`
    + ` → ${r.level === 'completo' ? 'time completo' : r.level === 'desfalcado' ? 'time desfalcado' : 'time misto (rodízio)'}`;
}

const sideOf = id => (/^(1|ahH)/.test(id) ? 'home' : /^(2|ahA)/.test(id) ? 'away' : null);
const pct = x => `${Math.round(x * 100)}%`;
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));

// Veredito de uma linha da nossa análise. line: linha de scenarioLines (id, line, odd_min, pinnacle_odd, diff_pp,
// conditions, entry_brl); rep: { home, away } de lineupReport ou null (a escalação não saiu); names: { home, away };
// odds: { now, updatedAt } da Pinnacle agora; kickoff (ms); doubts: [{ player, side, plays }] (dúvidas da API).
// Devolve { verdict: 'cheia' | 'meia' | 'nao' | 'esperar', title, stake, reasons: [{ sign: +1 | 0 | -1, text }] }.
export function lineVerdict({ line, rep, names, odds = null, kickoff, doubts = [] }) {
  const side = sideOf(line.id), other = side === 'home' ? 'away' : side === 'away' ? 'home' : null;
  const reasons = [], add = (sign, text) => reasons.push({ sign, text });
  const conds = line.conditions || [];
  const gap = conds.some(c => /pp (acima|abaixo) da Pinnacle/.test(c));
  const cup = conds.some(c => /^copa/.test(c)), youth = conds.some(c => /base\/B/.test(c)), short = conds.some(c => /amostra curta/.test(c));
  const early = conds.some(c => /^começo de temporada/.test(c));
  let strongNeg = false, explained = false;

  // 1) escalação
  if (!rep) add(0, 'escalação ainda não saiu (a API publica 20 a 40 min antes do jogo)');
  else {
    const us = side && rep[side], op = other && rep[other];
    for (const k of ['home', 'away']) if (rep[k]) add(0, reportText(rep[k]));
    if (side && us?.known) {
      if (us.level === 'misto') { strongNeg = true; add(-1, `${names[side]}, o nosso lado, vem misto: a nossa leitura contava com o time de sempre`); }
      else if (us.level === 'desfalcado') { strongNeg = true; add(-1, `${names[side]}, o nosso lado, vem desfalcado (${us.out.length} titulares fora)`); }
      else add(+1, `${names[side]}, o nosso lado, vem completo`);
    }
    if (side && op?.known && op.level !== 'completo') {
      add(+1, `${names[other]}, o adversário, vem ${op.level === 'misto' ? 'misto (rodízio)' : `desfalcado (${op.out.length} titulares fora)`}: a favor da linha`);
      if (!us?.known || us.level === 'completo') explained = true;
    }
    if (!side && ['home', 'away'].some(k => rep[k]?.known && rep[k].level === 'misto')) add(-1, 'time misto em campo: jogo menos previsível para gols');
    if (!side && ['home', 'away'].some(k => rep[k]?.scorer_out && !rep[k].scorer_out.bench)) add(-1, 'artilheiro fora do jogo: menos gol esperado');
    if ((cup || youth) && side && !us?.known) add(0, `${cup ? 'copa' : 'time de base/B'}: sem histórico para saber se ${names[side]} poupou alguém`);
  }
  // 2) dúvidas da API
  for (const d of doubts) {
    if (d.plays == null) continue;
    const ours = side && d.side === side;
    if (!side) add(0, `dúvida: ${d.player} ${d.plays ? 'escalado' : 'fora'}`);
    else if (ours && !d.plays) add(-1, `dúvida: ${d.player} (${names[d.side]}) ficou fora — contra a linha`);
    else if (!ours && !d.plays) { add(+1, `dúvida: ${d.player} (${names[d.side]}) ficou fora — a favor da linha`); if (gap) explained = true; }
    else add(0, `dúvida: ${d.player} (${names[d.side]}) escalado`);
  }
  // 3) mercado: só diz algo se a API atualizou as odds depois da escalação (ela atualiza a cada ~3 h)
  const now = odds?.now ?? null, upd = odds?.updatedAt ? Date.parse(odds.updatedAt) : null;
  const hhmm = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  if (now == null || !line.pinnacle_odd) add(0, 'sem odd da Pinnacle nesta linha agora');
  else {
    const mv = now / line.pinnacle_odd - 1, fresh = upd != null && upd >= kickoff - LINEUP_LEAD;
    const when = upd != null ? `atualizada pela API às ${hhmm(upd)}` : 'sem horário de atualização';
    if (Math.abs(mv) < MOVE) add(0, `Pinnacle ${n2(line.pinnacle_odd)} → ${n2(now)} (${when}): ${fresh ? 'parada depois da escalação — o mercado não viu novidade' : 'a API ainda não atualizou depois da escalação (atualiza a cada ~3 h): não dá para ler o mercado'}`);
    else if (mv < 0) { add(+1, `Pinnacle ${n2(line.pinnacle_odd)} → ${n2(now)} (caiu ${pct(-mv)}, ${when}): o mercado veio para o nosso lado`); if (gap) explained = true; }
    else { add(-1, `Pinnacle ${n2(line.pinnacle_odd)} → ${n2(now)} (subiu ${pct(mv)}, ${when}): o mercado foi contra`); if (gap) strongNeg = true; }
    if (now < line.odd_min) add(0, `a Pinnacle agora paga menos que a nossa mínima ${n2(line.odd_min)}: só entre se a casa pagar ≥ ${n2(line.odd_min)}`);
  }
  // 4) as condições do "entrar se…" que a conferência não resolve
  const open = [];
  if (gap && !explained) open.push(`a diferença de ${Math.round(Math.abs(line.diff_pp ?? 0))} pp para a Pinnacle não tem explicação na escalação nem no mercado: é só a nossa leitura (o perfil que mais perdeu no histórico)`);
  if (short) open.push('o cenário tem amostra curta');
  if (early) open.push('começo de temporada com mudança grande: a escalação não mostra a força nova do time');
  if ((cup || youth) && side && !rep?.[side]?.known) open.push('não deu para conferir o rodízio');
  for (const t of open) add(0, t);

  const full = line.entry_brl ?? null;
  if (!rep) return { verdict: 'esperar', title: '⏳ Esperar a escalação', stake: null, reasons };
  if (strongNeg || reasons.filter(r => r.sign < 0).length >= 2) return { verdict: 'nao', title: '❌ Não entrar', stake: 0, reasons };
  if (open.length || reasons.some(r => r.sign < 0)) return { verdict: 'meia', title: `⚠️ Meia entrada a ≥ ${n2(line.odd_min)}`, stake: full != null ? Math.round(full / 2) : null, reasons };
  return { verdict: 'cheia', title: `✅ Entrada cheia a ≥ ${n2(line.odd_min)}`, stake: full, reasons };
}
