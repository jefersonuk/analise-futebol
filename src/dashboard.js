// Painel: as 5 linhas de maior EV e como cada time se saiu nelas nos últimos 10 jogos.

import { settle } from './model.js';
import { isUnder, rankScore, rankTier } from './consistency.js';

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
  // A conta da barra, com nome de time, para o quadro do jogo: total na ordem do placar (mandante + visitante);
  // saldo do ponto de vista do time do gráfico (time − adversário). Os pares guardados são a favor–contra.
  const pairOf = key => g => (key === 'goals' ? [g.gf, g.ga] : g[key]);
  const sumCalc = key => g => {
    const p = pairOf(key)(g);
    if (!p) return '';
    const [a, b] = g.home ? p : [p[1], p[0]], [na, nb] = g.home ? [teamName, g.opp] : [g.opp, teamName];
    return `${na} ${a} + ${b} ${nb}`;
  };
  const diffCalc = key => g => { const p = pairOf(key)(g); return p ? `${teamName} ${p[0]} − ${p[1]} ${g.opp}` : ''; };
  if ((m = id.match(/^g([OU])(.+)$/))) return { what: 'gols no jogo', value: g => g.gf + g.ga, calc: sumCalc('goals'), ...ou(m[1], +m[2]) };
  if ((m = id.match(/^(corners|shots|sot)([OU])(.+)$/))) {
    const what = { corners: 'escanteios no jogo', shots: 'chutes no jogo', sot: 'chutes no gol no jogo' }[m[1]];
    return { what, value: total(m[1]), calc: sumCalc(m[1]), ...ou(m[2], +m[3]) };
  }
  if ((m = id.match(/^c1h([HA])(.+)$/))) {
    const same = (m[1] === 'H') === (role === 'home'), h = +m[2];
    return { what: `saldo de escanteios no 1º tempo do ${teamName}`, value: g => (g.c1 ? g.c1[0] - g.c1[1] : null), calc: diffCalc('c1'),
      x: v => (same ? v : -v), off: h, threshold: same ? -h : h };
  }
  if ((m = id.match(/^c1([OU])(.+)$/))) return { what: 'escanteios no 1º tempo', value: total('c1'), calc: sumCalc('c1'), ...ou(m[1], +m[2]) };
  // handicap / quem tem mais escanteios (jogo: ch, cx; 1º tempo: c1x), pelo saldo do time
  const saldo = (key, what) => g => (g[key] ? g[key][0] - g[key][1] : null);
  const hcp = (key, what, s, h) => {
    const same = (s === 'H') === (role === 'home');
    return { what: `saldo de ${what} do ${teamName}`, value: saldo(key), calc: diffCalc(key), x: v => (same ? v : -v), off: h, threshold: same ? -h : h };
  };
  if ((m = id.match(/^ch([HA])(.+)$/))) return hcp('corners', 'escanteios', m[1], +m[2]);
  if ((m = id.match(/^(cx|c1x)([12X])$/))) {
    const [key, what] = m[1] === 'cx' ? ['corners', 'escanteios'] : ['c1', 'escanteios no 1º tempo'];
    if (m[2] === 'X') return { what: `saldo de ${what} do ${teamName}`, value: saldo(key), calc: diffCalc(key), x: v => -Math.abs(v), off: 0.5, threshold: 0, rule: 'só com saldo 0 (empate)' };
    return hcp(key, what, m[2] === '1' ? 'H' : 'A', -0.5);
  }
  // corrida a N escanteios: "ninguém" pelo time que mais teve; "chega primeiro" só nos jogos em que
  // um time só chegou a N (quando os dois chegaram, a ordem não está nos dados e o jogo fica de fora)
  if ((m = id.match(/^cr([HAN])(\d+)$/))) {
    const N = +m[2];
    if (m[1] === 'N') return { what: 'escanteios do time que mais teve', value: g => (g.corners ? Math.max(...g.corners) : null),
      x: v => -v, off: N - 0.5, threshold: N };
    const own = (m[1] === 'H') === (role === 'home');
    return { what: own ? `escanteios do ${teamName}` : `escanteios cedidos pelo ${teamName}`, threshold: N, x: v => v, off: -(N - 0.5),
      value: g => {
        if (!g.corners) return null;
        const [mine, other] = own ? g.corners : [g.corners[1], g.corners[0]];
        return mine >= N && other >= N ? null : mine;
      } };
  }
  if ((m = id.match(/^c([HA])([OU])(.+)$/))) {
    const own = (m[1] === 'H') === (role === 'home');   // a linha é dos escanteios deste time?
    return { what: own ? `escanteios do ${teamName}` : `escanteios cedidos pelo ${teamName}`,
      value: g => (g.corners ? g.corners[own ? 0 : 1] : null), ...ou(m[2], +m[3]) };
  }
  const gd = g => g.gf - g.ga;
  const ah = (side, h) => {
    const same = (side === 'H') === (role === 'home');   // aposta a favor deste time?
    return { what: `saldo de gols do ${teamName}`, value: gd, calc: diffCalc('goals'), x: v => (same ? v : -v), off: h, threshold: same ? -h : h };
  };
  if ((m = id.match(/^ah([HA])(.+)$/))) return ah(m[1], +m[2]);
  if (id === '1') return ah('H', -0.5);
  if (id === '2') return ah('A', -0.5);
  if (id === 'X') return { what: `saldo de gols do ${teamName}`, value: gd, calc: diffCalc('goals'), x: v => -Math.abs(v), off: 0.5, threshold: 0, rule: 'só com saldo 0 (empate)' };
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
  // Direção da aposta para ESTE time: a barra precisa ficar acima ou abaixo do limite (a aposta pode ser
  // contra o time do gráfico: "CRB −2,5" no gráfico do São Bernardo vence com saldo abaixo de −2,5).
  const up = s.x(1) > s.x(0), lim = up ? -s.off : s.off;
  const rule = s.rule || `${up ? 'acima' : 'abaixo'} de ${numBR(lim)}`;
  return { what: s.what, threshold: s.threshold, bars, wins, calc: s.calc || null, rule };
}

const n1 = x => x.toFixed(1).replace('.', ',');
const pair = p => (p ? `${p[0]}–${p[1]}` : '—');

// Conteúdo do quadro que aparece ao passar o mouse numa barra: o jogo inteiro, com destaque para
// a métrica do gráfico e o resultado que a aposta teria.
function tipHtml(b, h, teamName) {
  const g = b.g, d = new Date(g.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  // tudo na ordem do placar (mandante, visitante); os pares guardados são a favor–contra do time do gráfico
  const [home, away] = g.home ? [teamName, g.opp] : [g.opp, teamName];
  const ord = p => (p ? (g.home ? p : [p[1], p[0]]) : null);
  const [hg, ag] = ord([g.gf, g.ga]);
  const row = (k, p, f = x => x) => `<tr><td>${k}</td>${p ? `<td>${f(p[0])}</td><td>${f(p[1])}</td>` : '<td colspan="2">—</td>'}</tr>`;
  const calc = h.calc ? h.calc(g) : '';
  return `<div class="tip-head">${d}${g.league ? ` · ${esc(g.league)}` : ''} · ${esc(teamName)} ${g.home ? 'em casa' : 'fora'}</div>
    <div class="tip-score">${esc(home)} <b>${hg}–${ag}</b> ${esc(away)}</div>
    <div class="tip-metric ${RES[b.res].cls}"><span>${esc(h.what)}: ${calc ? `${esc(calc)} = ` : ''}<b>${b.v}</b> · a aposta vence ${esc(h.rule)}</span>
      <span>→ ${RES[b.res].label}</span></div>
    <table><tr><th></th><th>${esc(home)}</th><th>${esc(away)}</th></tr>
      ${row('Escanteios', ord(g.corners))}${row('1º tempo', ord(g.c1))}${row('Chutes', ord(g.shots))}${row('No gol', ord(g.sot))}
      ${row('xG-proxy', g.xf != null ? ord([g.xf, g.xa]) : null, n1)}</table>
    <div class="tip-note">mandante · visitante, na ordem do placar</div>`;
}

// Colunas com baseline no zero (saldo pode ser negativo), grade leve, linha da aposta e média.
function chart(h, teamName) {
  const W = 340, H = 170, top = 16, bottom = 34, left = 24, right = 36;   // esquerda: eixo; direita: rótulo da linha
  const vals = h.bars.map(b => b.v).concat([h.threshold, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals) + 0.5;
  const span = hi - lo || 1;
  const y = v => top + (hi - v) / span * (H - top - bottom);
  const slot = (W - left - right) / Math.max(h.bars.length, 1), bw = Math.min(24, slot - 6);
  const r = 4, y0 = y(0);
  const step = span > 12 ? 5 : span > 6 ? 2 : 1, ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const mean = h.bars.reduce((t, b) => t + b.v, 0) / (h.bars.length || 1);
  const bar = (b, i) => {
    const x = left + i * slot + (slot - bw) / 2, yv = y(b.v), up = b.v >= 0;
    const hgt = Math.abs(y0 - yv);
    const rr = Math.min(r, hgt / 2);
    const d = hgt < 3 ? `M${x},${y0 - 3}h${bw}v3h${-bw}z`   // valor zero: toco visível sobre a base
      : up ? `M${x},${y0}V${yv + rr}q0,${-rr} ${rr},${-rr}h${bw - 2 * rr}q${rr},0 ${rr},${rr}V${y0}z`
        : `M${x},${y0}V${yv - rr}q0,${rr} ${rr},${rr}h${bw - 2 * rr}q${rr},0 ${rr},${-rr}V${y0}z`;
    const cx = x + bw / 2;
    return `<g class="bar" tabindex="0" data-tip="${esc(tipHtml(b, h, teamName))}">
      <rect x="${left + i * slot}" y="0" width="${slot}" height="${H}" class="hit"/>
      <path d="${d}" class="${RES[b.res].cls}"/>
      <text x="${cx}" y="${up ? yv - 4 : yv + 12}" class="val">${b.v}</text>
      <text x="${cx}" y="${H - 18}" class="ax">${esc(b.g.opp.slice(0, 3).toUpperCase())}</text>
      <text x="${cx}" y="${H - 6}" class="ax small">${b.g.home ? 'C' : 'F'}</text></g>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="hist" role="img" aria-label="${esc(h.what)} nos últimos jogos">
    ${ticks.map(v => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${left - 5}" y="${y(v) + 3.5}" class="tick">${v}</text>`).join('')}
    <line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" class="base"/>
    <line x1="${left}" x2="${W - right}" y1="${y(mean)}" y2="${y(mean)}" class="mean"/>
    ${h.bars.map(bar).join('')}
    <line x1="${left}" x2="${W - right + 2}" y1="${y(h.threshold)}" y2="${y(h.threshold)}" class="ref"/>
    <text x="${W - right + 5}" y="${y(h.threshold) + 3.5}" class="reflabel">${numBR(h.threshold)}</text>
  </svg>`;
}

// Quadro flutuante único para todos os gráficos (mouse, toque e teclado).
export function bindTooltips(root) {
  let tip = document.getElementById('chartTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'chartTip'; tip.hidden = true; document.body.appendChild(tip); }
  const show = (bar, x, yy) => {
    tip.innerHTML = bar.dataset.tip;
    tip.hidden = false;
    root.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on'));
    bar.classList.add('on');
    bar.closest('svg').classList.add('focus');
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
    const top = yy + hgt + 16 > window.innerHeight ? yy - hgt - 12 : yy + 14;
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    root.querySelectorAll('.bar.on').forEach(b => b.classList.remove('on'));
    root.querySelectorAll('svg.focus').forEach(s => s.classList.remove('focus'));
  };
  root.onpointermove = e => { const b = e.target.closest('.bar'); if (b) show(b, e.clientX, e.clientY); else hide(); };
  root.onpointerleave = hide;
  root.onfocusin = e => { const b = e.target.closest('.bar'); if (b) { const r = b.getBoundingClientRect(); show(b, r.right, r.top); } };
  root.onfocusout = hide;
}

const pct = x => `${Math.round(x * 100)}%`;
const odd2 = x => x.toFixed(2).replace('.', ',');

// Por que uma linha que entrou só para completar o painel não passou no filtro de candidatas.
function outsideReason(l, ok = []) {
  if (ok.includes(l.id)) return null;
  if (isUnder(l.id) && l.tier === 'sólida') return 'under só se for âncora';
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
  const better = (a, b) => rankTier(a) - rankTier(b) || rankScore(b) - rankScore(a);
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
  if (!lines.length) return '<p class="muted">Nenhuma linha passou nos filtros para este jogo.</p>';
  const legend = `<div class="legend"><span><i class="good"></i>venceria</span><span><i class="push"></i>devolveria</span>
    <span><i class="critical"></i>perderia</span><span><i class="mean"></i>média dos 10 jogos</span>
    <span class="muted">C/F embaixo da barra = onde o time jogou naquele jogo passado (não é o lado da aposta) · passe o mouse (ou toque) numa barra para ver o jogo</span></div>`;
  return legend + lines.map(l => {
    const charts = teams.map(t => {
      const h = history(l.id, t.role, t.name, t.games);
      if (!h || !h.bars.length) return `<div class="histbox"><b>${esc(t.name)}</b><p class="muted">sem dados para esta linha</p></div>`;
      return `<div class="histbox"><div class="histhead"><b>${esc(t.name)}</b>
        <span>${numBR(h.wins)}/${h.bars.length} ${h.bars.length > 1 ? 'venceriam' : 'venceria'}</span></div>
        <small class="muted">${esc(h.what)} · <b class="rule">a aposta vence ${esc(h.rule)}</b> · média ${n1(h.bars.reduce((t, b) => t + b.v, 0) / h.bars.length)}</small>${chart(h, t.name)}</div>`;
    }).join('');
    const tierCls = l.tier === 'âncora' ? 'ok' : l.tier === 'sólida' ? 'mid' : 'no';
    return `<article class="dash">
      <header><div><small class="muted">${esc(l.market)}</small><h3>${esc(l.line)}</h3></div>
        <div class="kpis">
          <span class="tag ${tierCls}">${l.tier} · acerta ${pct(l.p_blend)}${l.hit_rate_last10 != null ? ` · últimos 10: ${pct(l.hit_rate_last10)}` : ''}</span>
          <span>justa ${odd2(l.fair_odd_blend)}</span>
          <span><b>mínima ${odd2(l.odd_min)}</b> <span class="muted">${l.pinnacle_odd ? `(Pinnacle ${odd2(l.pinnacle_odd)})` : `(${esc(l.priced_by || 'só o modelo')})`}</span></span>
          <span>${l.entry_brl ? `entrada R$ ${l.entry_brl} · ${l.politica_e}` : `sem entrada · ${l.politica_e}`}</span>
          ${l.fragile ? '<span class="tag">frágil</span>' : ''}
          ${l.outside ? `<span class="tag no">${esc(l.outside)}</span>` : ''}
          <button class="enter" data-enter="${esc(l.id)}">➕ Entrar</button>
        </div></header>
      <div class="teams">${charts}</div></article>`;
  }).join('');
}
