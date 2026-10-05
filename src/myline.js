// Minha linha: análise focada na linha que o Jeferson quer apostar (com a odd da casa dele) e as
// alternativas — a mesma linha em outros preços, o outro lado, mercados que expressam a mesma leitura e
// as melhores linhas do jogo. Tudo sai do modelo e do dossiê já calculados (nenhuma requisição).

import { politicaE } from './model.js';
import { renderDashboard } from './dashboard.js';
import { isUnder, rankScore, rankTier } from './consistency.js';
import { lineHistory, modelEntry, side, teamNames } from './dossier.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const odd2 = x => x.toFixed(2).replace('.', ',');

// ---- texto -> id da linha ----
// Aceita o jeito do surebet.com ("Abaixo 4.5 1º período - escanteios", "H1(-1.5) - escanteios",
// "Ninguém vai conseguir 9 escanteios", "2 primeiro a vai conseguir 5 escanteios", "Acima 2.5",
// "escanteios 2º o time") e o do app ("Mais de 2,5", "Casa −0,5"). Devolve { id } ou { error }.
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[º°ª]/g, 'o')
  .replace(/[−–]/g, '-').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim()
  // linha asiática escrita em duas metades ("4.0, 4.5", "-0.5/-1") vira o quarto (4.25, -0.75)
  .replace(/([-+]?\d+(?:\.\d+)?)\s*[,/]\s*([-+]?\d+(?:\.\d+)?)/g, (m, a, b) => (Math.abs(a - b) === 0.5 ? String((+a + +b) / 2) : m));
const NUM = '([-+]?\\d+(?:\\.\\d+)?)';

// Palavras que dizem ao leitor o mercado de uma linha do app (o rótulo sozinho, "Mais de 4,5", serve a
// vários mercados). Vão no fim do texto: as regras de resultado olham o começo.
const MARKET_HINT = {
  '1X2': '', 'Handicap asiático': 'handicap', 'Total de gols': 'gols', 'Total de gols 1T': 'gols 1o tempo', 'Ambas marcam': 'ambas marcam',
  'Total de escanteios': 'escanteios', 'Escanteios por time': 'escanteios', 'Handicap de escanteios': 'handicap escanteios',
  'Resultado escanteios': 'escanteios', 'Corrida de escanteios': 'escanteios', 'Total de chutes': 'chutes',
  'Total de chutes no gol': 'chutes no gol', 'Total escanteios 1T': 'escanteios 1o tempo',
  'Handicap escanteios 1T': 'handicap escanteios 1o tempo', 'Resultado escanteios 1T': 'escanteios 1o tempo',
};
const SIDE = '(casa|fora|mandante|visitante)';
const sideOf = w => (['casa', 'mandante', '1'].includes(w) ? 'H' : 'A');

// names: { home, away } do jogo — "CRB −2,5" vira "fora −2,5" quando o CRB é o visitante.
// market: o mercado da linha, quando se sabe (linha vinda do app: rótulo + mercado).
export function parseLine(text, { names = null, market = null } = {}) {
  let s = norm(text);
  if (names?.home && names?.away) {
    const [h, a] = [norm(names.home), norm(names.away)];
    for (const [n, w] of [[h, 'casa'], [a, 'fora']].sort((x, y) => y[0].length - x[0].length)) if (n) s = s.split(n).join(w);
  }
  if (market && MARKET_HINT[market] != null) s = `${s} ${MARKET_HINT[market]}`.trim();
  if (!s) return { error: 'Digite a linha.' };
  if (/\b2o? ?(periodo|tempo)\b|segundo tempo|\b2t\b|2nd half/.test(s)) return { error: 'O modelo não calcula linhas do 2º tempo.' };
  const half = /\b1o? ?(periodo|tempo)\b|primeiro tempo|\b1t\b|1st half|first half|\bht\b/.test(s);
  const metric = /escanteio|corner|canto/.test(s) ? 'corners' : /chutes? (no gol|no alvo|a gol)|on target/.test(s) ? 'sot'
    : /chute|finaliza|shots/.test(s) ? 'shots' : 'goals';
  const teamM = s.match(/\b([12])o? (?:o )?time\b|\btime ([12])\b|\bteam ([12])\b/) || s.match(new RegExp(`^${SIDE}\\s*:`));
  const team = teamM && sideOf(teamM[1] || teamM[2] || teamM[3]);
  const fmt = x => String(+x);
  let m;

  if (/ambas|both teams|btts/.test(s)) return { id: /\bnao\b|\bno\b/.test(s) ? 'bttsN' : 'bttsY' };
  if ((m = s.match(/ninguem\D*(\d+)/))) {
    if (metric !== 'corners' || half) return { error: 'Corrida só existe para escanteios do jogo inteiro.' };
    return { id: `crN${m[1]}` };
  }
  if ((m = s.match(/\b([12])o? (?:o time )?primeiro\D*(\d+)/)) || (m = s.match(new RegExp(`^${SIDE} chega a (\\d+)`)))) {
    if (metric !== 'corners' || half) return { error: 'Corrida só existe para escanteios do jogo inteiro.' };
    return { id: `cr${sideOf(m[1])}${m[2]}` };
  }
  if ((m = s.match(/empate anula|draw no bet|\bdnb\b/)) && (m = s.match(/\b([12])\b/)) && metric === 'goals')
    return { id: `ah${m[1] === '1' ? 'H' : 'A'}0` };

  const hcp = s.match(new RegExp(`\\b(?:a?h|handicap|hcp)\\s*([12])\\s*\\(?\\s*${NUM}`))
    || s.match(new RegExp(`\\b${SIDE}\\s*\\(?\\s*([-+]\\d+(?:\\.\\d+)?|0)(?![\\d.])`));
  if (hcp) {
    const S = sideOf(hcp[1]), h = fmt(hcp[2]);
    if (metric === 'corners') return { id: half ? `c1h${S}${h}` : `ch${S}${h}` };
    if (metric === 'goals' && !half) return { id: `ah${S}${h}` };
    return { error: 'Handicap só para gols (jogo inteiro) e escanteios (jogo e 1º tempo).' };
  }

  const over = s.match(new RegExp(`(?:acima|mais de|mais|over|\\bto)\\s*\\(?\\s*${NUM}`));
  const under = s.match(new RegExp(`(?:abaixo|menos de|menos|under|\\btu)\\s*\\(?\\s*${NUM}`));
  if (over || under) {
    const OU = over ? 'O' : 'U', L = fmt((over || under)[1]);
    if (metric === 'corners') {
      if (half) return team ? { error: 'Escanteios por time no 1º tempo: o modelo não calcula.' } : { id: `c1${OU}${L}` };
      return { id: team ? `c${team}${OU}${L}` : `corners${OU}${L}` };
    }
    if (metric === 'goals' && half && !team) return { id: `g1${OU}${L}` };
    if (half || team) return { error: 'Chutes do 1º tempo e gols ou chutes por time: o modelo não calcula.' };
    return { id: `${metric === 'goals' ? 'g' : metric}${OU}${L}` };
  }

  const res = s.match(/^([12x])(?:\s|$|-)/) || s.match(/\b(?:vitoria|vence)\s*(?:do )?([12])\b/)
    || (/^empate\b/.test(s) && [null, 'x'])
    || ((m = s.match(new RegExp(`^${SIDE} (?:vence|com mais)\\b`))) && [null, sideOf(m[1]) === 'H' ? '1' : '2']);
  if (res) {
    const R = res[1].toUpperCase();
    if (metric === 'corners') return { id: half ? `c1x${R}` : `cx${R}` };
    if (metric === 'goals' && !half) return { id: R };
    return { error: 'Resultado só para o jogo (gols) e para escanteios (jogo e 1º tempo).' };
  }
  return { error: 'Não reconheci a linha. Use o mercado e a linha nas listas abaixo.' };
}

// ---- preço de qualquer linha ----
// O dossiê traz as linhas com Pinnacle e as ancoradas; as demais saem do modelo (margem de 8%).
// teams: [{ role, name, games }] (últimos jogos, como no painel).
export function makePricer({ dossier, result, teams, banca }) {
  const known = new Map(dossier.lines_with_pinnacle.concat(dossier.lines_anchored || []).map(l => [l.id, l]));
  const all = new Map((result.all || result.lines).map(l => [l.id, l]));
  const cache = new Map();
  const price = id => {
    if (known.has(id)) return known.get(id);
    if (!cache.has(id)) {
      const l = all.get(id);
      cache.set(id, l ? modelEntry(l, { res: result, hi: lineHistory(id, teams), banca, names: teamNames(teams) }) : null);
    }
    return cache.get(id);
  };
  price.ids = [...all.keys()];
  return price;
}

// Linha mais próxima do mesmo lado, quando a pedida está fora das que o modelo calcula.
const thr = id => parseFloat(id.match(/-?[\d.]+$/)?.[0]);
export function nearest(price, id) {
  const s = side(id), t = thr(id);
  return price.ids.filter(x => side(x) === s && !Number.isNaN(thr(x)))
    .sort((a, b) => Math.abs(thr(a) - t) - Math.abs(thr(b) - t))[0] || null;
}

// ---- veredito na odd da casa ----
export function verdict(line, odd) {
  const p = line.p_blend, notes = [];
  const push = line.push_prob > 0.01 ? `; devolve a aposta em ${pct(line.push_prob)} dos jogos` : '';
  notes.push(`Acerta ${pct(p)} sem contar a devolução${push}. Odd justa ${odd2(line.fair_odd_blend)}, mínima ${odd2(line.odd_min)} `
    + `(${line.priced_by === 'pinnacle' ? `Pinnacle ${odd2(line.pinnacle_odd)} sem margem, misturada com o modelo` : line.priced_by}).`);
  if (line.value_pct != null) notes.push(`Valor ${line.value_pct > 0 ? '+' : ''}${String(line.value_pct).replace('.', ',')}% contra a Pinnacle sem margem (${line.value_level}).`);
  const hs = [line.history?.home, line.history?.away].filter(h => h && h.n);
  const roleTxt = h => (h.role_now ? (h.by_role?.[h.role_now] ? `; como ${h.role_now}, como hoje: ${String(h.by_role[h.role_now].wins).replace('.', ',')}/${h.by_role[h.role_now].n}` : `; nenhum jogo como ${h.role_now}, como hoje`) : '');
  if (hs.length) notes.push(`Últimos jogos: ${hs.map(h => `${h.hits} (${h.what}${roleTxt(h)})`).join(' · ')}.`);
  if (line.diff_pp != null && Math.abs(line.diff_pp) >= 5)
    notes.push(`O modelo ${line.diff_pp > 0 ? 'gosta mais' : 'gosta menos'} desta linha que a Pinnacle (${line.diff_pp > 0 ? '+' : ''}${String(line.diff_pp).replace('.', ',')} pp). O preço segue a Pinnacle.`);
  if (line.derived) notes.push('A Pinnacle não cota esta linha: a chance sai do total que ela precifica em outra linha, misturada com o modelo; por isso a odd mínima tem margem de 5%.');
  else if (line.priced_by !== 'pinnacle') notes.push('Sem odd da Pinnacle nesta linha: o preço é do modelo, por isso a odd mínima tem margem maior.');
  if (line.inviable) return { level: 'no', title: `Inviável: ${line.inviable}`, ev: null, notes };
  if (!(odd > 1)) return { level: 'info', title: `Procure odd ≥ ${odd2(line.odd_min)} (${line.tier})`, ev: null, notes };

  const ev = p * odd - 1, pe = politicaE(odd);
  if (line.pinnacle_odd && odd > line.pinnacle_odd) notes.push(`Sua odd é maior que a da própria Pinnacle (${odd2(line.pinnacle_odd)}).`);
  let level, title;
  if (line.inviable) { level = 'no'; title = `Inviável: ${line.inviable}`; }
  else if (pe.factor === 0) { level = 'no'; title = 'Não entrar: odd acima de 3,00 (Política E)'; }
  else if (odd < line.fair_odd_blend) { level = 'no'; title = `Sem valor: a odd justa é ${odd2(line.fair_odd_blend)}`; }
  else if (odd < line.odd_min) { level = 'mid'; title = `Preço curto: o valor fica dentro da margem de erro (mínima ${odd2(line.odd_min)})`; }
  else if (line.tier === 'especulativa') { level = 'mid'; title = 'Tem preço, mas acerta pouco ou de forma instável (especulativa)'; }
  else if (isUnder(line.id) && line.tier !== 'âncora') { level = 'mid'; title = 'Under sólida: pela sua regra, under só entra se for âncora; veja o over nas alternativas'; }
  else if (odd < 1.5) { level = 'mid'; title = `Tem valor (${line.tier}), mas a odd está abaixo de 1,50, fora do seu núcleo`; }
  else { level = 'ok'; title = `Entrar: linha ${line.tier}, odd acima da mínima · entrada ${pe.label} (Política E)`; }
  return { level, title, ev, notes };
}

// ---- alternativas ----
function opposite(id) {
  let m;
  if ((m = id.match(/^(g|g1|corners|shots|sot|c1|cH|cA)([OU])(.+)$/))) return `${m[1]}${m[2] === 'O' ? 'U' : 'O'}${m[3]}`;
  if ((m = id.match(/^(ah|c1h|ch)([HA])(.+)$/))) return `${m[1]}${m[2] === 'H' ? 'A' : 'H'}${-m[3]}`;
  return { bttsY: 'bttsN', bttsN: 'bttsY' }[id] || null;
}

// Lados (ou linhas) que expressam a mesma leitura do jogo em outro mercado.
const RELATED = [
  [/^gO/, ['bttsY', 'g1O']], [/^gU/, ['bttsN', 'g1U']], [/^g1O/, ['gO']], [/^g1U/, ['gU']], [/^bttsY$/, ['gO']], [/^bttsN$/, ['gU']],
  [/^1$/, ['ahH']], [/^2$/, ['ahA']], [/^ahH/, ['1']], [/^ahA/, ['2']],
  [/^c1hH/, ['chH', 'c1x1', 'cHO']], [/^c1hA/, ['chA', 'c1x2', 'cAO']],
  [/^chH/, ['c1hH', 'cx1', 'crH']], [/^chA/, ['c1hA', 'cx2', 'crA']],
  [/^cx1$/, ['chH', 'c1x1', 'crH']], [/^cx2$/, ['chA', 'c1x2', 'crA']], [/^c1x1$/, ['c1hH', 'cx1']], [/^c1x2$/, ['c1hA', 'cx2']],
  [/^crH/, ['cx1', 'chH', 'cHO']], [/^crA/, ['cx2', 'chA', 'cAO']], [/^crN/, ['cornersU']],
  [/^c1O/, ['cornersO']], [/^c1U/, ['cornersU', 'crN']], [/^cornersO/, ['c1O']], [/^cornersU/, ['c1U', 'crN']],
  [/^cHO/, ['chH', 'crH']], [/^cAO/, ['chA', 'crA']], [/^cHU/, ['cornersU', 'chA']], [/^cAU/, ['cornersU', 'chH']],
];

const playable = l => l && !l.inviable && l.odd_min >= 1.5 && l.odd_min <= 3;
const better = (a, b) => rankTier(a) - rankTier(b) || a.fragile - b.fragile || rankScore(b) - rankScore(a);

export function alternatives(price, chosen, dossier) {
  const out = [], used = new Set([chosen.id]);
  const add = (l, kind, why) => { if (l && !used.has(l.id)) { used.add(l.id); out.push({ l, kind, why }); } };
  const diff = l => {
    const d = Math.round((l.p_blend - chosen.p_blend) * 1000) / 10;
    return `${d >= 0 ? '+' : ''}${String(d).replace('.', ',')} pp de acerto`;
  };

  // 1. a mesma linha em outros preços (até 1 gol / 1,5 escanteio de distância)
  const s = side(chosen.id), t = thr(chosen.id);
  if (!Number.isNaN(t) && s !== '1X2' && !/^c1?x$/.test(s)) {
    price.ids.filter(id => side(id) === s && Math.abs(thr(id) - t) <= 1.5).map(price).filter(playable)
      .sort((a, b) => Math.abs(thr(a.id) - t) - Math.abs(thr(b.id) - t)).slice(0, 6)
      .sort((a, b) => thr(a.id) - thr(b.id))
      .forEach(l => add(l, 'escada', l.p_blend > chosen.p_blend ? `mais segura: ${diff(l)}, odd menor` : `paga mais: ${diff(l)}`));
  }
  // 2. o outro lado, quando ele é o favorito
  const o = opposite(chosen.id) && price(opposite(chosen.id));
  if (o && isUnder(chosen.id) && playable(o)) add(o, 'outro lado', `over, a sua preferência (${o.tier}, acerta ${pct(o.p_blend)})`);
  else if (o && o.p_blend > chosen.p_blend + 0.02) add(o, 'outro lado', `o outro lado acerta mais (${pct(o.p_blend)})`);
  // 3. a mesma leitura em outro mercado: a linha mais consistente de cada lado relacionado
  for (const [re, keys] of RELATED) {
    if (!re.test(chosen.id)) continue;
    for (const k of keys) {
      const best = price.ids.filter(id => id === k || side(id) === k).map(price).filter(playable).sort(better)[0];
      if (best) add(best, 'mesma leitura', `${best.market} (${best.tier})`);
    }
  }
  // 4. as melhores do jogo (candidatas do dossiê) em outros mercados
  dossier.candidates_focus.concat(dossier.candidates).map(price).filter(l => l && l.market !== chosen.market)
    .slice(0, 3).forEach(l => add(l, 'melhor do jogo', `candidata do jogo (${l.tier})`));

  // a sugestão fica dentro da mesma leitura; as melhores do jogo são só referência
  const pool = out.filter(a => a.kind !== 'melhor do jogo').map(a => a.l).concat(chosen).filter(playable);
  const best = pool.sort(better)[0] || null;
  return { alts: out, best: best && best.id !== chosen.id ? best : null };
}

// ---- tela ----
export function renderMyLine({ line, v, alts, best, teams, odd }) {
  const ev = v.ev != null ? ` <span class="${v.ev > 0 ? 'pos' : 'neg'}">EV ${v.ev >= 0 ? '+' : ''}${pct(v.ev)} @ ${odd2(odd)}</span>` : '';
  const sug = best ? `<p class="sug">⭐ Mais consistente entre as opções: <b>${esc(best.market)} — ${esc(best.line)}</b>
    (${best.tier}, acerta ${pct(best.p_blend)}, mínima ${odd2(best.odd_min)}) <button class="ghost" data-analyze="${esc(best.id)}">Analisar</button></p>`
    : '<p class="sug">⭐ Entre as alternativas jogáveis (odd 1,50–3,00), a sua linha já é a mais consistente.</p>';
  const rows = alts.map(({ l, kind, why }) => `<tr>
    <td class="muted">${kind}</td><td>${esc(l.market)}</td><td>${esc(l.line)}</td>
    <td><span class="tag ${l.tier === 'âncora' ? 'ok' : l.tier === 'sólida' ? 'mid' : 'no'}">${l.tier}</span></td>
    <td>${pct(l.p_blend)}</td><td>${odd2(l.fair_odd_blend)}</td><td><b>${odd2(l.odd_min)}</b></td>
    <td class="muted">${l.pinnacle_odd ? odd2(l.pinnacle_odd) : '—'}</td><td class="muted why">${esc(why)}</td>
    <td><button class="ghost" data-analyze="${esc(l.id)}">Analisar</button> <button class="enter" data-enter="${esc(l.id)}">➕</button></td></tr>`).join('');
  return `<div class="verdict ${v.level}"><b>${esc(v.title)}</b>${ev}<ul>${v.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
    ${renderDashboard([line], teams)}
    <h3 class="alt-h">Alternativas</h3>${sug}
    ${rows ? `<div class="scroll"><table class="alts"><tr><th>Tipo</th><th>Mercado</th><th>Linha</th><th>Nível</th><th>Acerta</th>
      <th>Justa</th><th>Mínima</th><th>Pinnacle</th><th>Por quê</th><th></th></tr>${rows}</table></div>`
    : '<p class="muted">Nenhuma alternativa jogável (odd mínima entre 1,50 e 3,00) para esta linha.</p>'}`;
}
