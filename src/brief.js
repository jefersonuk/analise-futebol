// Dossiê enxuto para o especialista no claude.ai: o mesmo dossiê do modelo, só com o que a leitura usa
// (mercados de foco, candidatas e as melhores linhas de cada mercado), para caber numa conversa sem
// gastar o plano à toa. O texto começa com uma marca que a página do especialista reconhece.

import { CENARIO, COMBOS, LIVE_1H, SHOTS, SHOTS_FILTER, bestLine } from './scanner.js';

export const SPECIALIST_URL = 'https://claude.ai/artifact/T2QWDJ4U4zzFJSnQumKSBr';
export const MARK = '#ESPECIALISTA-FUTEBOL v1';

const byScore = (a, b) => (b.consistency_score ?? 0) - (a.consistency_score ?? 0);
const slim = l => {
  const { history, ...rest } = l;
  const h = t => t && { what: t.what, rule: t.rule, hits: t.hits, role_now: t.role_now, by_role: t.by_role, hits_weighted_by_role: t.n ? `${t.wins}/${t.n}` : null,
    values_newest_first: t.values_newest_first };
  return { ...rest, history: history && { home: h(history.home), away: h(history.away) } };
};

// Um jogo: foco + candidatas + até 4 linhas por mercado (as mais consistentes jogáveis).
export function briefGame(d) {
  const all = d.lines_with_pinnacle.concat(d.lines_anchored || []);
  const keep = new Set([...d.candidates_focus, ...d.candidates]);
  const byMarket = new Map();
  for (const l of all.filter(x => x.odd_min >= 1.3 && x.odd_min <= 3.2).sort(byScore)) {
    const n = byMarket.get(l.market) || 0;
    if (n < (d.focus_markets.includes(l.market) ? 8 : 4)) { keep.add(l.id); byMarket.set(l.market, n + 1); }
  }
  const { lines_with_pinnacle, lines_anchored, model_only_lines, context, live_1h, ...rest } = d;
  // os confrontos crus só servem para refazer as checagens; o momento dos times vai enxuto (o resumo já está no texto)
  const ctx = context && (({ h2h_extra, clubs, ...c }) => ({ ...c, clubs: leanClubs(clubs) }))(context);
  return {
    kind: 'jogo',
    dossier: {
      ...rest,
      context: ctx || null,
      live_1h: leanLive(live_1h),
      lines_with_pinnacle: lines_with_pinnacle.filter(l => keep.has(l.id)).map(slim),
      lines_anchored: (lines_anchored || []).filter(l => keep.has(l.id)).map(slim),
      model_only_lines: (model_only_lines || []).sort(byScore).slice(0, 6).map(slim),
    },
  };
}

// Linha da varredura, enxuta para caber 20 jogos numa conversa: preço, consistência, acerto nos últimos 10
// jogos de cada time e as checagens de contexto (com o texto só na linha da lista).
const lean = (l, full = false) => l && {
  id: l.id, market: l.market, line: l.line, price_source: l.priced_by === 'pinnacle' ? 'pinnacle' : l.derived ? 'derivada do total da Pinnacle' : 'só o modelo',
  tier: l.tier, p_blend: l.p_blend, p_pinnacle: l.p_pinnacle, fair_odd: l.fair_odd_blend,
  odd_min: l.odd_min, pinnacle_odd: l.pinnacle_odd, odd_min_vs_pinnacle_pct: l.odd_min_vs_pinnacle_pct, value_pct: l.value_pct,
  fragile: l.fragile || undefined, inviable: l.inviable || undefined, blocked: l.blocked || undefined, reduced: l.reduced || undefined,
  entry_brl: l.entry_brl, politica_e: l.politica_e,
  // nas melhores de cada mercado, só a contagem e o veredito (o detalhe vai na linha da lista)
  last10: [l.history?.home, l.history?.away].map(t => (t ? (full ? `${t.hits} ${t.rule}` : t.hits) : '—')).join(' · '),
  context: l.context && (full ? `${l.context.verdict}: ${l.context.signals.map(x => `${x.kind} ${x.verdict} (${x.text})`).join('; ')}` : l.context.verdict),
};
// Combo de duas pernas (combos.js), enxuto: as pernas com a chance de cada uma, a chance do combo (com a parte
// em que o empate anula volta e vale só a de gols), a justa, a mínima, o produto das pernas e a correlação.
const leanCombo = c => c && {
  id: c.id, combo: c.line, legs: c.legs.map(x => `${x.line}: ${Math.round(x.p * 100)}%${x.push ? ` (devolve ${Math.round(x.push * 100)}%)` : ''}, justa ${x.fair_odd}`),
  tier: c.tier, p_blend: c.p_blend, p_both_legs: c.p_full, p_only_goals_leg: c.push_prob || undefined, p_pinnacle_grid: c.p_pinnacle, p_model_range: c.p_model_range,
  fair_odd: c.fair_odd_blend, odd_min: c.odd_min, odd_legs_product: c.odd_indep, correlation: c.corr, entry_brl: c.entry_brl, politica_e: c.politica_e,
  last10: [c.history?.home, c.history?.away].map(t => (t ? t.hits : '—')).join(' · '),
};
// Leitura de cenário enxuta: o papel de cada time hoje, como ele se saiu nos jogos de mesmas características, a
// correção sobre a Pinnacle, motivação e clássico; e as linhas da Pinnacle pelo cenário.
// (o texto do cenário já vai em context.text; aqui só os números, e os jogos só na aba Cenário)
const leanSide = (p, games) => p && { how: p.how, relaxed: p.relaxed || undefined, n: p.n, wdl: `${p.w}-${p.d}-${p.l}`, gf: p.gf, ga: p.ga, resid: p.resid,
  tot_resid: p.tot_resid ?? undefined, win2: p.win2, lose2: p.lose2, games: games ? p.games.slice(0, 4) : undefined };
// nossa leitura: o modelo corrigido (base), o cenário (correção), o resultado e a Pinnacle ao lado
const leanScenario = (c, games) => c && { ours: { sup: c.sup, total: c.total }, model: c.base, scenario_adj: { sup: c.adj_sup, total: c.adj_total },
  pinnacle: c.market || undefined, level: c.level, band: c.band, agree: c.agree, enough: c.enough,
  motivation: c.motivation || undefined, derby: c.derby || undefined, home: leanSide(c.home, games), away: leanSide(c.away, games) };
const leanScenLine = l => l && { line: `${l.market}: ${l.line}`, status: l.status, p_ours: l.p_nossa, p_model: l.p_model_cal, p_pinnacle: l.p_pinnacle,
  diff_pp: l.diff_pp, why: l.why, contra_pinnacle: l.contra || undefined, pinnacle_odd: l.pinnacle_odd, odd_min: l.odd_min,
  conditions: l.conditions?.length ? l.conditions : undefined, why_not: l.status === 'sem aposta' ? l.why_not[0] : undefined,
  entry_brl: l.bet || l.conditional ? l.entry_brl : undefined };
// Plano ao vivo enxuto: odd mínima (e chance) do over 3, 3,5 e 4,5 nos minutos 0, 5, 8 e 10, sem escanteio e com 1.
function leanLive(p) {
  if (!p) return null;
  const nb = x => String(x).replace('.', ','), mins = [0, 5, 8, 10];
  const row = (c, L) => p.tables.find(t => t.corners === c).rows.filter(r => mins.includes(r.minute))
    .map(r => { const x = r.cells.find(z => z.line === L); return `${r.minute}' ${nb(x.odd_min)} (${Math.round(x.p * 100)}%)`; }).join(' · ');
  return { expected_1h: p.mu, pinnacle_total_1h: p.pinnacle_total, anchored: p.anchored, margin_pct: Math.round((p.margin - 1) * 100),
    odd_min_over: Object.fromEntries([3, 3.5, 4.5].map(L => [`mais de ${nb(L)}`, { sem_escanteio: row(0, L), com_1_escanteio: row(1, L) }])) };
}
// Contexto enxuto: o texto pronto (tabela, médias, esperado, confronto direto).
// Momento dos times para o especialista: a tabela atual em linhas curtas e quem chegou e saiu (o resumo está no texto).
const tableNow = t => t?.map(x => `${x.rank}. ${x.name || x.team} — ${x.points} pts em ${x.played} j, saldo ${x.gd > 0 ? '+' : ''}${x.gd}${x.form ? `, ${x.form}` : ''}`);
const leanClubs = c => c && { table_now: tableNow(c.table_now) || null,
  market: Object.fromEntries(['home', 'away'].map(k => [k, c[k].market && { chegadas: c[k].market.in, saidas: c[k].market.out }])) };
const leanCtx = c => c && { text: c.text, h2h_games: c.h2h.n, ...(c.clubs?.table_now ? { table_now: tableNow(c.clubs.table_now) } : {}) };

// A varredura: os jogos na ordem da tela (horário, por padrão), cada um com a linha da lista, a melhor de cada
// mercado (escanteios 1T, escanteios, gols 1T, gols, handicaps de escanteios e de gols), as outras linhas
// principais, o contexto do jogo e o plano ao vivo dos escanteios do 1º tempo.
export function briefScan(scan, ranked, { market = null, order = 'time' } = {}) {
  return {
    kind: 'varredura',
    date: scan.date, window: scan.window ? { hours: scan.hours, from: new Date(scan.window.from).toISOString(), to: new Date(scan.window.to).toISOString() } : null,
    order: order === 'time' ? 'horário (o mais próximo primeiro)' : 'chance de ganho',
    filter: market === LIVE_1H ? 'ao vivo 1º tempo' : market === COMBOS ? 'combos de duas pernas' : market === CENARIO ? 'nossa análise (odd perto de 2)' : market || 'melhor do jogo',
    generated_at: scan.generated_at, fixtures: scan.fixtures, with_odds: scan.with_odds, with_1h: scan.with_1h ?? null,
    asked_hours: scan.asked_hours ?? null, corners_report: scan.corners_report ?? null,
    games: ranked.map(({ g, line }, i) => {
      const top = (line && !line.combo && !line.scenario ? line : null) || bestLine(g.lines);
      return {
        n: i + 1,
        kickoff: new Date(g.fx.t).toISOString(), competition: g.fx.league.name, home: g.fx.home.name, away: g.fx.away.name,
        base: g.team_base ? 'jogos dos dois times em todas as competições' : 'liga do jogo',
        hard: g.hard ? g.hard.reasons : null, alerts: g.alerts, odds_age_min: g.odds_age_min, favoritism: g.favor_text || null, pinnacle_1h: g.pinnacle_1h, expected_1h: g.expected_1h,
        c1_history_games: g.c1_known, no_history: g.no_history || null, no_corners: g.no_corners || null, no_h2h: g.no_h2h || null,
        context: leanCtx(g.context),
        top_line: lean(top, true),
        // chutes só no filtro Chutes (difícil achar a linha nas casas)
        best_by_market: Object.fromEntries(Object.entries(g.best || {}).filter(([m, l]) => l && l.id !== top?.id && (market === SHOTS_FILTER || !SHOTS.includes(m)))
          .map(([m, l]) => [m, lean(l)])),
        live_1h: leanLive(g.live1h),
        combos: (g.combos || []).slice(0, market === COMBOS ? 4 : 2).map(leanCombo),
        scenario: leanScenario(g.context?.scenario, market === CENARIO),
        scenario_lines: (g.scenario || []).filter((l, k) => l.bet || l.conditional || k < (market === CENARIO ? 3 : 1)).slice(0, 4).map(leanScenLine),
        injuries: g.injuries?.length ? g.injuries.slice(0, 10).map(i => `${i.player} (${i.team === g.fx.home.id ? 'mandante' : 'visitante'}: ${i.type === 'Questionable' ? 'dúvida' : i.reason})`) : undefined,
      };
    }),
    skipped: scan.skipped.map(s => `${s.fx.home.name} x ${s.fx.away.name} (${s.fx.league.name}): ${s.why}`),
  };
}

// Múltipla (multiple.js): o bilhete montado na aba (pernas, chance de acertar tudo, justa, mínima, odd da casa e EV) e os
// jogos das pernas com o contexto, como na varredura.
export function briefMulti(scan, tickets = []) {
  const ids = new Set(tickets.flatMap(t => t.legs.map(l => l.fixtureId)));
  const base = briefScan(scan, scan.games.filter(g => ids.has(g.fx.id)).sort((a, b) => a.fx.t - b.fx.t).map(g => ({ g, line: null })), { market: 'múltipla' });
  return { ...base, filter: 'múltipla (bilhetes por faixa de horário, uma perna de over de gols por jogo)',
    multiples: tickets.map((ticket, i) => ({ bilhete: i + 1, pernas: ticket.n, p_acertar_todas: ticket.p_all, p_pinnacle_todas: ticket.p_pinnacle_all, odd_justa: ticket.fair, odd_minima: ticket.min,
      odd_casa: ticket.odd, ev: ticket.ev, entrada_brl: ticket.stake, veredito: ticket.verdict, aposte_ate: new Date(ticket.first_kickoff).toISOString(),
      legs: ticket.legs.map(l => ({ jogo: `${l.home} x ${l.away}`, kickoff: new Date(l.kickoff).toISOString(), competicao: l.competition, linha: l.line, p: l.p,
        p_pinnacle: l.p_pinnacle, p_nossa: l.p_nossa, justa: l.fair, minima: l.min, odd_casa: l.house, contexto: l.context })) })) };
}

export const toText = brief => `${MARK} ${brief.kind}\n${JSON.stringify(brief)}`;

// Copia para a área de transferência (no clique) e abre o especialista numa nova aba.
// Devolve false quando o navegador recusa a cópia: quem chama mostra o texto para copiar à mão.
export async function sendToSpecialist(brief) {
  const text = toText(brief);
  let copied = true;
  try { await navigator.clipboard.writeText(text); } catch { copied = false; }
  if (copied) window.open(SPECIALIST_URL, 'especialista');
  return { copied, text };
}

// Botão "🧠 Especialista": copia o dossiê e abre a página. Quando a cópia falha (navegador recusou),
// mostra o texto selecionado para copiar à mão, logo abaixo da linha do botão.
export function bindSpecialist(button, getBrief) {
  button.onclick = async () => {
    const brief = getBrief();
    if (!brief) return;
    const row = button.closest('.row') || button.parentElement;
    row.nextElementSibling?.classList.contains('specnote') && row.nextElementSibling.remove();
    const note = document.createElement('div');
    note.className = 'specnote';
    const { copied, text } = await sendToSpecialist(brief);
    const link = `<a href="${SPECIALIST_URL}" target="especialista" rel="noopener">abrir o especialista ↗</a>`;
    if (copied) note.innerHTML = `Dossiê copiado (${Math.round(text.length / 1024)} KB). Cole na página do especialista e toque em Analisar · ${link}`;
    else {
      note.innerHTML = `Não consegui copiar sozinho: copie o texto abaixo e ${link}.<textarea readonly></textarea>`;
      const ta = note.querySelector('textarea');
      ta.value = text;
      setTimeout(() => { ta.focus(); ta.select(); });
    }
    row.after(note);
  };
}
