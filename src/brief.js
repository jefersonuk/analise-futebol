// Dossiê enxuto para o especialista no claude.ai: o mesmo dossiê do modelo, só com o que a leitura usa
// (mercados de foco, candidatas e as melhores linhas de cada mercado), para caber numa conversa sem
// gastar o plano à toa. O texto começa com uma marca que a página do especialista reconhece.

import { LIVE_1H, bestLine } from './scanner.js';

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
  const ctx = context && (({ h2h_extra, ...c }) => c)(context);   // os confrontos crus só servem para refazer as checagens
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
  fragile: l.fragile, inviable: l.inviable || undefined, entry_brl: l.entry_brl, politica_e: l.politica_e,
  last10: [l.history?.home, l.history?.away].map(t => (t ? `${t.hits} ${t.rule}` : '—')).join(' · '),
  context: l.context && `${l.context.verdict}: ${l.context.signals.map(x => (full ? `${x.kind} ${x.verdict} (${x.text})` : `${x.kind} ${x.verdict}`)).join('; ')}`,
};
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
const leanCtx = c => c && { text: c.text, h2h_games: c.h2h.n };

// A varredura: os jogos na ordem da tela (horário, por padrão), cada um com a linha da lista, a melhor de cada
// mercado (escanteios 1T, escanteios, gols 1T, gols, handicaps de escanteios e de gols), as outras linhas
// principais, o contexto do jogo e o plano ao vivo dos escanteios do 1º tempo.
export function briefScan(scan, ranked, { market = null, order = 'time' } = {}) {
  return {
    kind: 'varredura',
    date: scan.date, window: scan.window ? { hours: scan.hours, from: new Date(scan.window.from).toISOString(), to: new Date(scan.window.to).toISOString() } : null,
    order: order === 'time' ? 'horário (o mais próximo primeiro)' : 'chance de ganho', filter: market === LIVE_1H ? 'ao vivo 1º tempo' : market || 'melhor do jogo',
    generated_at: scan.generated_at, fixtures: scan.fixtures, with_odds: scan.with_odds, with_1h: scan.with_1h ?? null,
    asked_hours: scan.asked_hours ?? null, corners_report: scan.corners_report ?? null,
    games: ranked.map(({ g, line }, i) => {
      const top = line || bestLine(g.lines);
      return {
        n: i + 1,
        kickoff: new Date(g.fx.t).toISOString(), competition: g.fx.league.name, home: g.fx.home.name, away: g.fx.away.name,
        base: g.team_base ? 'jogos dos dois times em todas as competições' : 'liga do jogo',
        alerts: g.alerts, odds_age_min: g.odds_age_min, favoritism: g.favor_text || null, pinnacle_1h: g.pinnacle_1h, expected_1h: g.expected_1h,
        c1_history_games: g.c1_known, no_history: g.no_history || null, no_corners: g.no_corners || null, no_h2h: g.no_h2h || null,
        context: leanCtx(g.context),
        top_line: lean(top, true),
        best_by_market: Object.fromEntries(Object.entries(g.best || {}).filter(([, l]) => l && l.id !== top?.id).map(([m, l]) => [m, lean(l)])),
        live_1h: leanLive(g.live1h),
      };
    }),
    skipped: scan.skipped.map(s => `${s.fx.home.name} x ${s.fx.away.name} (${s.fx.league.name}): ${s.why}`),
  };
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
