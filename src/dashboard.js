// Painel: as 5 linhas de maior EV e como cada time se saiu nelas nos últimos 10 jogos.

import { settle } from './model.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const numBR = x => String(x).replace('.', ',');
const RES = {
  win: { cls: 'good', label: 'venceria' }, hw: { cls: 'good half', label: 'meia vitória' },
  push: { cls: 'push', label: 'devolveria' }, hl: { cls: 'critical half', label: 'meia derrota' },
  lose: { cls: 'critical', label: 'perderia' },
};

// Como ler um jogo passado para a linha: valor exibido (v), variável da aposta (x) e deslocamento (off):
// a aposta ganha quando x + off > 0 (mesma liquidação asiática do modelo).
function spec(id, role, teamName) {
  let m;
  const total = key => g => (g[key] ? g[key][0] + g[key][1] : null);
  const ou = (side, L) => ({ threshold: L, x: v => (side === 'O' ? v : -v), off: side === 'O' ? -L : L });
  if ((m = id.match(/^g([OU])(.+)$/))) return { what: 'gols no jogo', value: g => g.gf + g.ga, ...ou(m[1], +m[2]) };
  if ((m = id.match(/^(corners|shots|sot)([OU])(.+)$/))) {
    const what = { corners: 'escanteios no jogo', shots: 'chutes no jogo', sot: 'chutes no gol no jogo' }[m[1]];
    return { what, value: total(m[1]), ...ou(m[2], +m[3]) };
  }
  if ((m = id.match(/^c1h([HA])(.+)$/))) {
    const same = (m[1] === 'H') === (role === 'home'), h = +m[2];
    return { what: `saldo de escanteios no 1º tempo do ${teamName}`, value: g => (g.c1 ? g.c1[0] - g.c1[1] : null),
      x: v => (same ? v : -v), off: h, threshold: same ? -h : h };
  }
  if ((m = id.match(/^c1([OU])(.+)$/))) return { what: 'escanteios no 1º tempo', value: total('c1'), ...ou(m[1], +m[2]) };
  if ((m = id.match(/^c([HA])([OU])(.+)$/))) {
    const own = (m[1] === 'H') === (role === 'home');   // a linha é dos escanteios deste time?
    return { what: own ? `escanteios do ${teamName}` : `escanteios cedidos pelo ${teamName}`,
      value: g => (g.corners ? g.corners[own ? 0 : 1] : null), ...ou(m[2], +m[3]) };
  }
  const gd = g => g.gf - g.ga;
  const ah = (side, h) => {
    const same = (side === 'H') === (role === 'home');   // aposta a favor deste time?
    return { what: `saldo de gols do ${teamName}`, value: gd, x: v => (same ? v : -v), off: h, threshold: same ? -h : h };
  };
  if ((m = id.match(/^ah([HA])(.+)$/))) return ah(m[1], +m[2]);
  if (id === '1') return ah('H', -0.5);
  if (id === '2') return ah('A', -0.5);
  if (id === 'X') return { what: `saldo de gols do ${teamName}`, value: gd, x: v => -Math.abs(v), off: 0.5, threshold: 0 };
  if (id === 'bttsY' || id === 'bttsN') {
    const yes = id === 'bttsY';
    return { what: 'gols do lado que menos marcou', value: g => Math.min(g.gf, g.ga), x: v => (yes ? v : -v), off: yes ? -0.5 : 0.5, threshold: 0.5 };
  }
  return null;
}

export function history(id, role, teamName, games) {
  const s = spec(id, role, teamName);
  if (!s) return null;
  const bars = [...games].reverse().map(g => {
    const v = s.value(g);
    if (v == null) return null;
    const r = settle([[s.x(v), 1]], s.off);
    const res = r.pWin === 1 ? 'win' : r.pLose === 1 ? 'lose' : r.pWin === 0.5 ? 'hw' : r.pLose === 0.5 ? 'hl' : 'push';
    return { v, res, g };
  }).filter(Boolean);
  const wins = bars.reduce((n, b) => n + (b.res === 'win' ? 1 : b.res === 'hw' ? 0.5 : 0), 0);
  return { what: s.what, threshold: s.threshold, bars, wins };
}

// Colunas com baseline no zero (saldo pode ser negativo), linha de referência e rótulo no topo.
function chart(h) {
  const W = 320, H = 156, top = 16, bottom = 32, left = 6, right = 34;   // margem direita guarda o rótulo da linha
  const vals = h.bars.map(b => b.v).concat([h.threshold, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const y = v => top + (hi - v) / span * (H - top - bottom);
  const slot = (W - left - right) / Math.max(h.bars.length, 1), bw = Math.min(24, slot - 6);
  const r = 4, y0 = y(0);
  const bar = (b, i) => {
    const x = left + i * slot + (slot - bw) / 2, yv = y(b.v), up = b.v >= 0;
    const hgt = Math.abs(y0 - yv);
    const rr = Math.min(r, hgt / 2);
    const d = hgt < 3 ? `M${x},${y0 - 3}h${bw}v3h${-bw}z`   // valor zero: toco visível sobre a base
      : up ? `M${x},${y0}V${yv + rr}q0,${-rr} ${rr},${-rr}h${bw - 2 * rr}q${rr},0 ${rr},${rr}V${y0}z`
        : `M${x},${y0}V${yv - rr}q0,${rr} ${rr},${rr}h${bw - 2 * rr}q${rr},0 ${rr},${-rr}V${y0}z`;
    const g = b.g, date = new Date(g.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const tip = `${date} ${g.home ? 'casa' : 'fora'} vs ${g.opp} ${g.gf}–${g.ga} · ${h.what}: ${b.v} → ${RES[b.res].label}`;
    const cx = x + bw / 2;
    return `<g class="bar"><title>${esc(tip)}</title>
      <rect x="${left + i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>
      <path d="${d}" class="${RES[b.res].cls}"/>
      <text x="${cx}" y="${up ? yv - 4 : yv + 12}" class="val">${b.v}</text>
      <text x="${cx}" y="${H - 4}" class="ax">${esc(g.opp.slice(0, 3).toUpperCase())}${g.home ? '' : '*'}</text></g>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="hist" role="img" aria-label="${esc(h.what)} nos últimos jogos">
    <line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" class="base"/>
    ${h.bars.map(bar).join('')}
    <line x1="${left}" x2="${W - right + 2}" y1="${y(h.threshold)}" y2="${y(h.threshold)}" class="ref"/>
    <text x="${W - right + 5}" y="${y(h.threshold) + 3.5}" class="reflabel">${numBR(h.threshold)}</text>
  </svg>`;
}

const pct = x => `${Math.round(x * 100)}%`;
const odd2 = x => x.toFixed(2).replace('.', ',');
const TIERS = { 'âncora': 0, 'sólida': 1, 'especulativa': 2 };

// Por que uma linha que entrou só para completar o painel não passou no filtro de candidatas.
function outsideReason(l, ok = []) {
  if (ok.includes(l.id)) return null;
  if (l.tier === 'especulativa') {
    if (l.hit_rate_last10 != null && l.hit_rate_last10 < 0.5) return 'histórico contra';
    if (l.p_model_range[0] < 0.42) return 'pior cenário do modelo fraco';
    return 'acerto baixo';
  }
  if (l.odd_min < 1.5) return 'odd abaixo de 1,50';
  if (l.politica_e === 'não entrar') return 'odd acima de 3,00';
  if (l.odd_min_vs_pinnacle_pct > 5) return 'preço difícil de achar';
  return 'alternativa de linha';
}

// As n linhas do painel. Modo foco: as candidatas dos mercados de foco e, em seguida, a escada do
// mesmo lado (outras linhas do mesmo mercado e lado, para comparar acerto × odd). Modo todos: uma
// candidata por mercado. Se faltar, completa com as mais consistentes restantes, marcando o motivo.
export function pickDashboard(dossier, n = 5, { focus = true, side = id => id } = {}) {
  const all = dossier.lines_with_pinnacle.concat(dossier.lines_anchored || []);
  const byId = new Map(all.map(l => [l.id, l]));
  const pool = focus ? all.filter(l => dossier.focus_markets.includes(l.market)) : all;
  const first = (focus ? dossier.candidates_focus : dossier.candidates).map(id => byId.get(id)).filter(Boolean).slice(0, n);
  const out = [...first], used = new Set(out.map(l => l.id));
  const better = (a, b) => TIERS[a.tier] - TIERS[b.tier] || b.consistency_score - a.consistency_score;
  const add = (l, outside) => { if (out.length < n && !used.has(l.id)) { used.add(l.id); out.push(outside ? { ...l, outside } : l); } };
  if (focus) {
    const sides = new Set(first.map(l => side(l.id)));
    pool.filter(l => sides.has(side(l.id)) && l.odd_min >= 1.5 && l.politica_e !== 'não entrar').sort(better)
      .forEach(l => add(l, outsideReason(l, dossier.candidates_focus)));
  }
  const markets = new Set(out.map(l => l.market));
  pool.filter(l => l.odd_min >= 1.2 && (focus || !markets.has(l.market)))
    .sort((a, b) => (a.odd_min < 1.5) - (b.odd_min < 1.5) || better(a, b))
    .forEach(l => { if (focus || !markets.has(l.market)) { markets.add(l.market); add(l, outsideReason(l, [])); } });
  return out;
}

// lines: linhas do dossiê (pickDashboard); teams: [{ name, role, games }]
export function renderDashboard(lines, teams) {
  if (!lines.length) return '<p class="muted">Sem odds da Pinnacle para este jogo: o painel precisa da régua de preço.</p>';
  const legend = `<div class="legend"><span><i class="good"></i>venceria</span><span><i class="push"></i>devolveria</span>
    <span><i class="critical"></i>perderia</span><span class="muted">* = jogo fora de casa · passe o mouse nas barras</span></div>`;
  return legend + lines.map(l => {
    const charts = teams.map(t => {
      const h = history(l.id, t.role, t.name, t.games);
      if (!h || !h.bars.length) return `<div class="histbox"><b>${esc(t.name)}</b><p class="muted">sem dados para esta linha</p></div>`;
      return `<div class="histbox"><div class="histhead"><b>${esc(t.name)}</b>
        <span>${numBR(h.wins)}/${h.bars.length} ${h.bars.length > 1 ? 'venceriam' : 'venceria'}</span></div>
        <small class="muted">${esc(h.what)}</small>${chart(h)}</div>`;
    }).join('');
    const tierCls = l.tier === 'âncora' ? 'ok' : l.tier === 'sólida' ? 'mid' : 'no';
    return `<article class="dash">
      <header><div><small class="muted">${esc(l.market)}</small><h3>${esc(l.line)}</h3></div>
        <div class="kpis">
          <span class="tag ${tierCls}">${l.tier} · acerta ${pct(l.p_blend)}${l.hit_rate_last10 != null ? ` · últimos 10: ${pct(l.hit_rate_last10)}` : ''}</span>
          <span>justa ${odd2(l.fair_odd_blend)}</span>
          <span><b>mínima ${odd2(l.odd_min)}</b> <span class="muted">${l.pinnacle_odd ? `(Pinnacle ${odd2(l.pinnacle_odd)})` : '(sem odd na API: modelo ancorado)'}</span></span>
          <span>${l.entry_brl ? `entrada R$ ${l.entry_brl} · ${l.politica_e}` : `sem entrada · ${l.politica_e}`}</span>
          ${l.fragile ? '<span class="tag">frágil</span>' : ''}
          ${l.outside ? `<span class="tag no">${esc(l.outside)}</span>` : ''}
        </div></header>
      <div class="teams">${charts}</div></article>`;
  }).join('');
}
