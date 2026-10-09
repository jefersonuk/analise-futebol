// O porquê de cada entrada do Plano do dia. Pedido do Jeferson (09/10/2026): "as informações que levam a colocar essa
// entrada como interessante para esse dia — gráfico e informação escrita". Não é o cartão inteiro da varredura, só o
// que sustenta a entrada:
//   🎯 nossa leitura    a nossa chance contra a da Pinnacle e de onde vem a diferença (o modelo corrigido e o cenário
//                       dos dois times contra adversários do mesmo nível), e as checagens da linha;
//   🤝 acordo           a Pinnacle, o modelo e o histórico juntos, e as checagens da linha (mando, médias, confronto
//                       direto, tabela, cenário);
//   mesmo jogo          as pernas, o quanto pagam a mais que a melhor perna sozinha e o combo nos últimos jogos;
//   perna de múltipla   a chance, o esperado de gols e a linha nos últimos jogos dos dois times.
// Os motivos vêm com sinal: ＋ a favor, － contra, · fato do jogo. Gráficos: a chance por fonte contra a que a odd
// exige, e os últimos jogos de cada time na linha (os gráficos da varredura; no combo e na perna, a faixa compacta).

import { chipStrip, lineStrip, teamCharts, tipHtml } from './dashboard.js';
import { comboOutcome, parseCombo } from './combos.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nb = x => String(x).replace('.', ',');
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const n1 = x => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const sg1 = x => `${x >= 0 ? '+' : '−'}${n1(Math.abs(x))}`;
const pc1 = x => `${(Math.abs(x) * 100).toFixed(1).replace('.', ',')}%`;
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const hour = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const R = (sign, text) => ({ sign, text });

// ---- os motivos ----
const SIGN = { 'a favor': 1, contra: -1 };
// as checagens da linha (context.js lineContext): mando, médias, confronto direto, tabela e cenário
const checks = l => (l?.context?.signals || []).map(s => R(SIGN[s.verdict] || 0, `${cap(s.kind)} ${s.verdict}: ${s.text}.`));
const textOf = (g, re) => (g.context?.text || []).find(t => re.test(t)) || null;
// o esperado do jogo no mercado da linha (gols, escanteios ou escanteios do 1º tempo)
export function expectedOf(g, market = 'Total de gols') {
  const e = g.context?.expected, H = g.fx.home.name, A = g.fx.away.name;
  if (!e) return null;
  const one = (x, what) => (x?.total != null ? `${n1(x.total)} ${what} (${H} ${n1(x.home)} x ${n1(x.away)} ${A}${x.pinnacle ? `; Pinnacle ${n1(x.pinnacle)}` : ''})` : null);
  if (/escanteios 1T/i.test(market)) return one(e.corners_1h, 'escanteios no 1º tempo');
  if (/escanteios/i.test(market)) return one(e.corners, 'escanteios');
  const goals = one(e.goals, 'gols'), s = e.supremacy;
  if (!goals) return null;
  return `${goals}${s == null ? '' : Math.abs(s) < 0.35 ? '; jogo equilibrado' : `; ${s > 0 ? H : A} favorito por ${n1(Math.abs(s))} gol${e.supremacy_source === 'pinnacle_1x2' ? ' (Pinnacle)' : ''}`}`;
}
// fatos do jogo que pesam na entrada: a tabela, o esperado, a motivação, o clássico e os desfalques confirmados
function facts(g, market) {
  const out = [], add = t => t && out.push(R(0, t));
  add(textOf(g, /^Tabela:/));
  const e = expectedOf(g, market);
  if (e) add(`Esperado: ${e}.`);
  add(textOf(g, /^Motivação:/));
  add(textOf(g, /^Clássico:/));
  const team = i => (i.team === g.fx.home.id ? g.fx.home.name : g.fx.away.name);
  const outs = (g.injuries || []).filter(i => !/question|doubt|dúvida/i.test(`${i.type} ${i.reason}`));
  if (outs.length) add(`Desfalques: ${outs.slice(0, 6).map(i => `${i.player} (${team(i)}${i.reason ? `, ${i.reason}` : ''})`).join(' · ')}${outs.length > 6 ? ` e mais ${outs.length - 6}` : ''}.`);
  return out;
}
// o cenário de cada time: os jogos contra adversários do mesmo nível do de hoje, no mesmo mando (scenario.js)
function scenarioFacts(g, l) {
  const sc = g.context?.scenario;
  if (!sc?.home || !sc?.away) return [];
  const goals = /^gO/.test(l.id);
  const one = (p, n) => {
    if (!p.n) return `${n}: sem jogos no cenário de hoje`;
    const base = `${n} ${p.how} (${p.n} jogo${p.n > 1 ? 's' : ''}${p.relaxed ? `, ${p.relaxed}` : ''})`;
    return goals
      ? `${base}: ${n1(p.gf)}–${n1(p.ga)} por jogo, mais de 2,5 gols em ${Math.round(p.over25 * p.n)} de ${p.n}${p.tot_resid != null ? `, ${sg1(p.tot_resid)} gol por jogo além do esperado no total` : ''}`
      : `${base}: ${p.w}V ${p.d}E ${p.l}D, ${n1(p.gf)}–${n1(p.ga)} por jogo, ${Math.abs(p.resid) < 0.05 ? 'saldo no esperado' : `${sg1(p.resid)} gol de saldo ${p.resid > 0 ? 'acima' : 'abaixo'} do esperado`}`;
  };
  return [R(0, `Cenário: ${one(sc.home, g.fx.home.name)}.`), R(0, `Cenário: ${one(sc.away, g.fx.away.name)}.`)];
}
const reading = g => { const t = textOf(g, /^Nossa leitura/); return t ? [R(0, t)] : []; };

// 🎯 a simples da nossa leitura: a nossa chance acima da Pinnacle, e de onde vem a diferença
export function oursWhy(g, x) {
  const l = x.line, cons = (g.lines || []).find(c => c.id === l.id) || null;
  const be = l.pinnacle_odd > 1 ? 1 / l.pinnacle_odd : null, half = l.p_pinnacle != null ? (l.p_nossa + l.p_pinnacle) / 2 : null, d = l.diff_pp;
  const summary = `Nossa chance ${pct(l.p_nossa)}, a da Pinnacle ${pct(l.p_pinnacle)}${d != null ? ` (${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d))} pp — ${l.why})` : ''}. `
    + `A odd ${n2(l.pinnacle_odd)} da Pinnacle exige ${pct(be)}; mesmo andando metade do caminho até a chance dela (${pct(half)}), sobra ${pc1(x.value)} de valor.`;
  return { summary,
    bars: [['Pinnacle', l.p_pinnacle, false, 'a chance da Pinnacle, sem a margem dela'], ['Modelo corrigido', l.p_model_cal, false, 'o nosso modelo de forças, corrigido da compressão'],
      ['Nossa chance', l.p_nossa, true, 'o modelo corrigido mais o cenário dos dois times']],
    mark: be && [be, `a odd ${n2(l.pinnacle_odd)} exige`],
    reasons: [...reading(g), ...scenarioFacts(g, l), ...checks(cons), ...facts(g, l.market),
      ...(l.contra ? [R(0, 'Contra a Pinnacle: a nossa chance 5 pp ou mais acima da dela — fica marcada no app de apostas para medirmos à parte.')] : [])],
    chartLine: l };
}
// 🤝 a simples em acordo com a Pinnacle: as fontes juntas e as checagens da linha
export function agreeWhy(g, x) {
  const l = x.line, hit = l.hit_rate_last10 ?? null, need = x.value;
  const summary = `${cap(l.tier)}: acerta ${pct(l.p_blend)} — Pinnacle ${pct(l.p_pinnacle)}, modelo ${pct(l.p_model)}${hit != null ? `, últimos 10 dos dois times ${pct(hit)}` : ''}; `
    + `o modelo ${l.p_model >= l.p_pinnacle ? 'concorda com' : 'fica perto de'} a Pinnacle${l.context ? ` e o contexto está ${l.context.verdict}` : ''}. `
    + `A mínima ${n2(l.odd_min)} exige ${pct(1 / l.odd_min)}; ${need > 0 ? `a casa precisa pagar ${pc1(need)} acima da Pinnacle (${n2(l.pinnacle_odd)})` : `a própria Pinnacle já paga ${n2(l.pinnacle_odd)}`}.`;
  return { summary,
    bars: [['Pinnacle', l.p_pinnacle, false, 'a chance da Pinnacle, sem a margem dela'], ['Modelo', l.p_model, false, 'o nosso modelo de forças'],
      ['Últimos 10 jogos', hit, false, 'quanto a linha teria acertado nos últimos 10 jogos dos dois times'], ['Chance da linha', l.p_blend, true, 'a Pinnacle sem margem com o modelo']],
    mark: [1 / l.odd_min, `a mínima ${n2(l.odd_min)} exige`],
    reasons: [...checks(l), ...reading(g), ...facts(g, l.market)],
    chartLine: l };
}
// mesmo jogo: o combo, as pernas e o quanto ele paga a mais que a melhor perna sozinha
export function comboWhy(g, c) {
  const hit = c.hit_rate_last10 ?? null, d = Math.round((c.corr - 1) * 100), best = Math.max(...c.legs.map(x => x.fair_odd));
  const summary = `${c.fav ? 'Vitória do favorito + gols' : `Combo ${c.tier}`}: acerta ${pct(c.p_blend)} — Pinnacle ${pct(c.p_pinnacle)}, modelo ${pct(c.p_model)}${hit != null ? `, últimos 10 dos dois times ${pct(hit)}` : ''}. `
    + `Justo, paga ${n2(c.fair_odd_blend)}: ${Math.round((c.fair_odd_blend / best - 1) * 100)}% mais que a melhor perna sozinha (${n2(best)}). `
    + `${d >= 3 ? `As pernas andam juntas (+${d}%): a casa costuma pagar menos que o produto delas (${n2(c.odd_indep)}). ` : d <= -3 ? `Uma perna atrapalha a outra (${d}%). ` : ''}`
    + `Entre se a casa pagar ≥ ${n2(c.odd_min)}.`;
  const legs = c.legs.map(x => R(0, `Perna: ${x.line} — ${pct(x.p)}${x.push > 0.005 ? ` (devolve ${pct(x.push)})` : ''}, justa ${n2(x.fair_odd)}.`));
  if (c.push_prob > 0.005) legs.push(R(0, `Empate anula: com empate e a perna de gols certa, vale só ela (${pct(c.push_prob)} das vezes) — regra da maioria das casas, confira.`));
  return { summary,
    bars: [['Pinnacle', c.p_pinnacle, false, 'pelos placares da Pinnacle (1X2 e total de gols)'], ['Modelo', c.p_model, false, 'pelos placares do nosso modelo'],
      ['Últimos 10 jogos', hit, false, 'o combo nos últimos 10 jogos dos dois times, com o placar visto como o de hoje'], ['Chance do combo', c.p_blend, true, 'a Pinnacle com 10% do modelo']],
    mark: [1 / c.odd_min, `a mínima ${n2(c.odd_min)} exige`],
    reasons: [...legs, ...reading(g), ...facts(g, 'Total de gols')] };
}
// o combo nos últimos jogos de um time, com o placar visto como o de hoje (o time no lado em que joga hoje)
export function comboStrip(c, t, names) {
  const k = parseCombo(c.id, names);
  if (!k || !t?.games?.length) return null;
  const h = { what: 'placar visto como o de hoje', rule: 'com as duas pernas certas no placar final', calc: null };
  const bars = [...t.games].reverse().filter(x => x.gf != null && x.ga != null).map(x => {
    const [hg, ag] = t.role === 'home' ? [x.gf, x.ga] : [x.ga, x.gf], o = comboOutcome(k, hg, ag);
    return { v: `${hg}–${ag}`, res: o === 1 ? 'win' : o === 0 ? 'push' : 'lose', note: o === 0 ? 'valeria só a perna de gols' : null, g: x };
  });
  if (!bars.length) return null;
  return { wins: bars.reduce((s, b) => s + (b.res === 'win' ? 1 : b.res === 'push' ? 0.5 : 0), 0), n: bars.length,
    html: chipStrip(bars.map(b => ({ res: b.res, label: b.v, home: b.g.home, tip: tipHtml(b, h, t.name, t.roleNow) })), `${t.name}: o combo nos últimos jogos`) };
}
// perna de múltipla: a chance, o esperado de gols, o contexto e a linha nos últimos jogos dos dois times
export function legWhy(g, leg) {
  const e = g?.context?.expected?.goals;
  const text = `${leg.asian ? `não perde ${pct(leg.p)} · paga inteira ${pct(leg.p_win)}` : `acerta ${pct(leg.p)}`} (Pinnacle ${pct(leg.p_pinnacle)}${leg.p_nossa != null ? `, nossa ${pct(leg.p_nossa)}` : ''})`
    + `${e?.total != null ? ` · esperado ${n1(e.total)} gols${e.pinnacle ? ` (Pinnacle ${n1(e.pinnacle)})` : ''}` : ''}${leg.context ? ` · contexto ${leg.context}` : ''}`;
  const strips = (g?.teams || []).map(t => ({ name: t.name, role: t.role, s: lineStrip(leg.lineId, t) })).filter(x => x.s);
  return { text, strips };
}

// ---- na tela ----
// A chance por fonte (barras finas; a que manda em destaque) contra a chance que a odd exige (a linha vertical).
// rows: [[rótulo, chance, destaque, explicação]]; mark: [chance, rótulo] ou null.
export function chanceChart(rows, mark = null) {
  const rs = rows.filter(r => r[1] != null);
  if (!rs.length) return '';
  const W = 340, L = 104, Rt = 36, top = 24, rowH = 22, barH = 10, y1 = top + rs.length * rowH, H = y1 + 16;
  const x = p => L + Math.max(0, Math.min(1, p)) * (W - L - Rt);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 2}" y2="${y1}" class="grid"/><text x="${x(t)}" y="${y1 + 12}" class="tick">${t * 100}%</text>`).join('');
  const bars = rs.map(([label, p, on, tip], i) => {
    const y = top + i * rowH + (rowH - barH) / 2, x1 = x(p), r = Math.min(4, (x1 - L) / 2);
    return `<g><title>${esc(`${label}: ${pct(p)}${tip ? ` — ${tip}` : ''}`)}</title><text x="${L - 6}" y="${y + barH - 1}" class="lbl${on ? ' on' : ''}">${esc(label)}</text>
      <path d="M${L},${y}H${x1 - r}q${r},0 ${r},${r}V${y + barH - r}q0,${r} ${-r},${r}H${L}z" class="${on ? 'em' : 'de'}"/>
      <text x="${x1 + 4}" y="${y + barH - 1}" class="v${on ? ' on' : ''}">${pct(p)}</text></g>`;
  }).join('');
  let ref = '';
  if (mark?.[0] != null) {
    const mx = x(mark[0]), t = `${mark[1]} ${pct(mark[0])}`, hw = t.length * 2.9;
    ref = `<line x1="${mx}" x2="${mx}" y1="${top - 8}" y2="${y1}" class="ref"/><text x="${Math.max(hw, Math.min(W - hw, mx))}" y="${top - 12}" class="reflabel">${esc(t)}</text>`;
  }
  const aria = `${rs.map(r => `${r[0]} ${pct(r[1])}`).join(', ')}${mark?.[0] != null ? `; ${mark[1]} ${pct(mark[0])}` : ''}`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chance" role="img" aria-label="${esc(aria)}">${grid}${bars}${ref}</svg>`;
}
const SG = { 1: ['pos', '＋'], [-1]: ['neg', '－'], 0: ['muted', '·'] };
export const reasonsHtml = rs => (rs.length ? `<ul class="why">${rs.map(r => { const [c, s] = SG[r.sign] || SG[0]; return `<li><b class="${c}">${s}</b>${esc(r.text)}</li>`; }).join('')}</ul>` : '');
const stripBox = x => `<div class="stripbox"><small><b>${esc(x.name)}</b> (${x.role === 'home' ? 'mandante' : 'visitante'} hoje) · ${nb(x.s.wins)}/${x.s.n} ${x.s.n > 1 ? 'venceriam' : 'venceria'}</small>${x.s.html}</div>`;

// o corpo do cartão de uma simples: o resumo, o gráfico da chance, os motivos e os gráficos dos últimos jogos
export function singleBody(g, x) {
  const w = x.lens === 'agree' ? agreeWhy(g, x) : oursWhy(g, x);
  return `<p class="whysum">${esc(w.summary)}</p><div class="whygrid">${chanceChart(w.bars, w.mark)}${reasonsHtml(w.reasons)}</div>
    ${g.teams?.length ? `<div class="teams">${teamCharts(w.chartLine, g.teams)}</div>` : ''}`;
}
// o corpo do cartão de um combo: o resumo, a chance, os motivos e o combo nos últimos jogos dos dois times
export function comboBody(g, c) {
  const w = comboWhy(g, c), names = { home: g.fx.home.name, away: g.fx.away.name };
  const strips = (g.teams || []).map(t => ({ name: t.name, role: t.role, s: comboStrip(c, t, names) })).filter(x => x.s);
  return `<p class="whysum">${esc(w.summary)}</p><div class="whygrid">${chanceChart(w.bars, w.mark)}${reasonsHtml(w.reasons)}</div>
    ${strips.length ? `<p class="muted small">O combo nos últimos jogos de cada time, com o placar visto como o de hoje (o time no lado em que joga hoje):</p><div class="strips">${strips.map(stripBox).join('')}</div>` : ''}`;
}
// o corpo do cartão de uma múltipla: cada perna com o porquê e a linha nos últimos jogos dos dois times
export function legsBody(games, t) {
  const byId = new Map(games.map(g => [g.fx.id, g]));
  return t.legs.map(l => {
    const w = legWhy(byId.get(l.fixtureId), l);
    return `<div class="legwhy"><div><b>${hour(l.kickoff)} ${esc(l.home)} x ${esc(l.away)}</b> <span class="muted">${esc(l.competition)}</span> — ${esc(l.line)}: ${esc(w.text)}</div>
      ${w.strips.length ? `<div class="strips">${w.strips.map(stripBox).join('')}</div>` : '<p class="muted small">sem os últimos jogos dos times nesta análise</p>'}</div>`;
  }).join('');
}
