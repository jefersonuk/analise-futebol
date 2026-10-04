// Dossiê enxuto para o especialista no claude.ai: o mesmo dossiê do modelo, só com o que a leitura usa
// (mercados de foco, candidatas e as melhores linhas de cada mercado), para caber numa conversa sem
// gastar o plano à toa. O texto começa com uma marca que a página do especialista reconhece.

import { isMain } from './consistency.js';

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
  const { lines_with_pinnacle, lines_anchored, model_only_lines, ...rest } = d;
  return {
    kind: 'jogo',
    dossier: {
      ...rest,
      lines_with_pinnacle: lines_with_pinnacle.filter(l => keep.has(l.id)).map(slim),
      lines_anchored: (lines_anchored || []).filter(l => keep.has(l.id)).map(slim),
      model_only_lines: (model_only_lines || []).sort(byScore).slice(0, 6).map(slim),
    },
  };
}

// A varredura do dia: cada jogo com a linha do ranking (a de mais valor nas linhas principais), as outras
// linhas principais do jogo e a melhor de cada mercado (inclui o handicap de escanteios do jogo).
export function briefScan(scan, ranked) {
  return {
    kind: 'varredura',
    date: scan.date, generated_at: scan.generated_at, fixtures: scan.fixtures, with_odds: scan.with_odds, with_1h: scan.with_1h ?? null,
    games: ranked.map(({ g, line }, i) => ({
      rank: i + 1,
      kickoff: new Date(g.fx.t).toISOString(), competition: g.fx.league.name, home: g.fx.home.name, away: g.fx.away.name,
      base: g.team_base ? 'jogos dos dois times em todas as competições' : 'liga do jogo',
      alerts: g.alerts, odds_age_min: g.odds_age_min, pinnacle_1h: g.pinnacle_1h, expected_1h: g.expected_1h,
      share_1h: g.share_1h, c1_history_games: g.c1_known, no_history: g.no_history || null, no_corners: g.no_corners || null,
      top_line: slim(line),
      other_lines: g.lines.filter(l => l.id !== line.id && isMain(l.id)).map(slim),
      best_by_market: Object.fromEntries(Object.entries(g.best || {}).filter(([, l]) => l && l.id !== line.id).map(([m, l]) => [m, slim(l)])),
    })),
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
