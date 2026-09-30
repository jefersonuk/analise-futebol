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

// top: [{ line, odd, e, pinn, pol }]; teams: [{ id, name, role, games }]
export function renderDashboard(top, teams) {
  if (!top.length) return '<p class="muted">Nenhuma linha com EV positivo. Puxe as odds da Pinnacle ou digite odds na tabela.</p>';
  const legend = `<div class="legend"><span><i class="good"></i>venceria</span><span><i class="push"></i>devolveria</span>
    <span><i class="critical"></i>perderia</span><span class="muted">* = jogo fora de casa · passe o mouse nas barras</span></div>`;
  return legend + top.map(({ line, odd, e, pinn, pol }) => {
    const charts = teams.map(t => {
      const h = history(line.id, t.role, t.name, t.games);
      if (!h || !h.bars.length) return `<div class="histbox"><b>${esc(t.name)}</b><p class="muted">sem dados para esta linha</p></div>`;
      return `<div class="histbox"><div class="histhead"><b>${esc(t.name)}</b>
        <span>${numBR(h.wins)}/${h.bars.length} ${h.bars.length > 1 ? 'venceriam' : 'venceria'}</span></div>
        <small class="muted">${esc(h.what)}</small>${chart(h)}</div>`;
    }).join('');
    return `<article class="dash">
      <header><div><small class="muted">${esc(line.market)}</small><h3>${esc(line.label)}</h3></div>
        <div class="kpis"><span>@ ${odd.toFixed(2).replace('.', ',')}</span>
        <span class="pos">EV ${(e.mid * 100).toFixed(1)}%</span>
        <span class="muted">modelo ${(line.pWin * 100).toFixed(1)}%${pinn != null ? ` · Pinnacle ${(pinn * 100).toFixed(1)}%` : ''}</span>
        <span class="tag ${e.low > 0 ? 'ok' : ''}">${e.low > 0 ? 'robusto' : 'frágil'} · ${pol.label}</span></div></header>
      <div class="teams">${charts}</div></article>`;
  }).join('');
}
