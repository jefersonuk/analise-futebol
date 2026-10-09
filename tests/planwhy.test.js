import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { scanDay } from '../src/scanner.js';
import { buildPlan } from '../src/plan.js';
import { multiGames, ticketOf } from '../src/multiple.js';
import { agreeWhy, chanceChart, comboBody, comboStrip, comboWhy, legWhy, legsBody, oursWhy, singleBody } from '../src/planwhy.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 10, 18);
// últimos 10 jogos de um time (o mais recente primeiro), com o placar pró–contra
const games = (scores, home0 = true) => scores.map(([gf, ga], i) => ({ t: T0 - (i + 1) * 7 * DAY, home: i % 2 === 0 ? home0 : !home0, opp: `Rival ${i + 1}`, league: 'Liga',
  gf, ga, g1: null, xf: null, xa: null, corners: null, shots: null, sot: null, c1: null, sup: 0.2 }));
const G = () => ({
  fx: { id: 7, t: T0, home: { id: 70, name: 'Alfa' }, away: { id: 71, name: 'Beta' }, league: { id: 1, name: 'Liga' } },
  teams: [{ role: 'home', name: 'Alfa', roleNow: 'favorito', games: games([[2, 1], [3, 0], [1, 1], [2, 2], [0, 1], [4, 1], [2, 0], [1, 2], [3, 1], [2, 1]]) },
    { role: 'away', name: 'Beta', roleNow: 'zebra', games: games([[1, 2], [0, 0], [2, 3], [1, 1], [0, 2], [1, 3], [2, 2], [0, 1], [1, 4], [3, 3]], false) }],
  context: {
    text: ['Tabela: Alfa 3º/20 (30 pts em 15 jogos) · Beta 15º/20 (14 pts em 15 jogos).',
      'Nossa leitura: Alfa 0,70 gol melhor, 3,1 gols (modelo corrigido +0,50, cenário +0,20); a Pinnacle diz Alfa 0,45 gol melhor, total 2,8 — discordamos em 0,25 gol.',
      'Motivação: Alfa na briga pelas vagas do topo · Beta 2 pts acima do rebaixamento: pressionado.', 'Confronto direto: nenhum jogo entre os dois nos últimos 3 anos.'],
    expected: { goals: { home: 1.8, away: 1.2, total: 3, pinnacle: 2.8 }, supremacy: 0.6, supremacy_source: 'pinnacle_1x2', corners: { home: 5.5, away: 4, total: 9.5, pinnacle: 9.2 } },
    scenario: { home: { how: 'em casa contra times fracos', n: 8, w: 6, d: 1, l: 1, gf: 2.4, ga: 0.9, resid: 0.4, tot_resid: 0.3, over25: 0.625 },
      away: { how: 'fora contra times fortes', n: 7, w: 1, d: 2, l: 4, gf: 0.9, ga: 2.1, resid: -0.2, tot_resid: 0.2, over25: 0.57 } },
  },
  injuries: [{ team: 71, player: 'Zagueiro', type: 'Missing Fixture', reason: 'Suspended' }, { team: 70, player: 'Meia', type: 'Questionable', reason: 'Knock' }],
  lines: [{ id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', tier: 'sólida', p_blend: 0.62, p_pinnacle: 0.6, p_model: 0.64, pinnacle_odd: 1.62, odd_min: 1.69,
    hit_rate_last10: 0.65, context: { verdict: 'a favor', signals: [
      { kind: 'mando', verdict: 'a favor', text: 'Alfa em casa 4/5 · Beta fora 3/5' }, { kind: 'médias', verdict: 'neutro', text: 'médias dos dois times: 2,9 gols por jogo contra a linha 2,5' },
      { kind: 'confronto direto', verdict: 'contra', text: '0/2 nos confrontos diretos' }] } }],
});

test('🎯 nossa leitura: a nossa chance contra a da Pinnacle, de onde vem, o cenário dos dois times e as checagens da linha', () => {
  const g = G(), line = { id: 'gO2.5', market: 'Total de gols', line: 'Mais de 2,5', p_nossa: 0.66, p_model_cal: 0.63, p_pinnacle: 0.58, pinnacle_odd: 1.95,
    diff_pp: 8, why: 'modelo +5 pp · cenário +3 pp', odd_min: 1.59, contra: true };
  const w = oursWhy(g, { g, line, lens: 'ours', value: 0.209 });
  assert.match(w.summary, /^Nossa chance 66%, a da Pinnacle 58% \(\+8 pp — modelo \+5 pp · cenário \+3 pp\)\. A odd 1,95 da Pinnacle exige 51%; .* \(62%\), sobra 20,9% de valor\.$/);
  const txt = w.reasons.map(r => `${r.sign}|${r.text}`);
  assert.match(txt[0], /^0\|Nossa leitura: Alfa 0,70 gol melhor/);
  assert.ok(txt.some(t => /^0\|Cenário: Alfa em casa contra times fracos \(8 jogos\): 2,4–0,9 por jogo, mais de 2,5 gols em 5 de 8, \+0,3 gol/.test(t)), 'linha de gols: o cenário fala de gols');
  assert.ok(txt.includes('1|Mando a favor: Alfa em casa 4/5 · Beta fora 3/5.') && txt.includes('-1|Confronto direto contra: 0/2 nos confrontos diretos.'), 'as checagens da linha com sinal');
  assert.ok(txt.some(t => /^0\|Esperado: 3,0 gols \(Alfa 1,8 x 1,2 Beta; Pinnacle 2,8\); Alfa favorito por 0,6 gol \(Pinnacle\)\.$/.test(t)));
  assert.ok(txt.some(t => /^0\|Desfalques: Zagueiro \(Beta, Suspended\)\.$/.test(t)), 'só os confirmados: a dúvida não entra');
  assert.ok(txt.some(t => /^0\|Contra a Pinnacle/.test(t)));
  assert.deepEqual(w.bars.map(b => [b[0], b[1], b[2]]), [['Pinnacle', 0.58, false], ['Modelo corrigido', 0.63, false], ['Nossa chance', 0.66, true]]);
  assert.equal(w.mark[0], 1 / 1.95);
  // resultado (1X2/handicap): o cenário fala de saldo
  const res = oursWhy(g, { g, line: { ...line, id: '1', market: '1X2', line: 'Alfa vence', contra: false }, lens: 'ours', value: 0.05 });
  assert.ok(res.reasons.some(r => /^Cenário: Alfa em casa contra times fracos \(8 jogos\): 6V 1E 1D, 2,4–0,9 por jogo, \+0,4 gol de saldo acima do esperado\.$/.test(r.text)));
  // o cartão: resumo, gráfico da chance, motivos e os gráficos dos últimos jogos dos dois times na linha
  const html = singleBody(g, { g, line, lens: 'ours', value: 0.209 });
  assert.match(html, /class="chance"/);
  assert.equal((html.match(/class="histbox"/g) || []).length, 2);
  assert.match(html, /a odd 1,95 exige 51%/);
});

test('🤝 acordo com a Pinnacle: as fontes juntas, a mínima e as checagens primeiro', () => {
  const g = G(), line = g.lines[0];
  const w = agreeWhy(g, { g, line, lens: 'agree', value: 0.043 });
  assert.match(w.summary, /^Sólida: acerta 62% — Pinnacle 60%, modelo 64%, últimos 10 dos dois times 65%; o modelo concorda com a Pinnacle e o contexto está a favor\. A mínima 1,69 exige 59%; a casa precisa pagar 4,3% acima da Pinnacle \(1,62\)\.$/);
  assert.equal(w.reasons[0].text, 'Mando a favor: Alfa em casa 4/5 · Beta fora 3/5.');
  assert.deepEqual(w.bars.map(b => b[0]), ['Pinnacle', 'Modelo', 'Últimos 10 jogos', 'Chance da linha']);
  assert.match(agreeWhy(g, { g, line: { ...line, odd_min: 1.6 }, lens: 'agree', value: -0.012 }).summary, /a própria Pinnacle já paga 1,62\.$/);
  // escanteios: o esperado é o de escanteios
  const c = agreeWhy(g, { g, line: { ...line, id: 'cornersO8.5', market: 'Total de escanteios', line: 'Mais de 8,5' }, lens: 'agree', value: 0 });
  assert.ok(c.reasons.some(r => r.text === 'Esperado: 9,5 escanteios (Alfa 5,5 x 4,0 Beta; Pinnacle 9,2).'));
});

test('mesmo jogo: o combo paga mais que a melhor perna, as pernas e o combo nos últimos jogos com o placar visto como o de hoje', () => {
  const g = G(), combo = { id: 'cb:1X+gO1.5', line: 'Alfa ou empate + Mais de 1,5 gols', tier: 'sólida', p_blend: 0.66, p_pinnacle: 0.65, p_model: 0.68, hit_rate_last10: 0.6,
    corr: 1.08, odd_indep: 1.69, fair_odd_blend: 1.52, odd_min: 1.6, push_prob: 0,
    legs: [{ id: '1X', line: 'Alfa ou empate', p: 0.78, push: 0, fair_odd: 1.28 }, { id: 'gO1.5', line: 'Mais de 1,5 gols', p: 0.76, fair_odd: 1.32 }] };
  const w = comboWhy(g, combo);
  assert.match(w.summary, /Justo, paga 1,52: 15% mais que a melhor perna sozinha \(1,32\)\. As pernas andam juntas \(\+8%\): a casa costuma pagar menos que o produto delas \(1,69\)\. Entre se a casa pagar ≥ 1,60\.$/);
  assert.deepEqual(w.reasons.slice(0, 2).map(r => r.text), ['Perna: Alfa ou empate — 78%, justa 1,28.', 'Perna: Mais de 1,5 gols — 76%, justa 1,32.']);
  // Beta joga fora hoje: os gols dele ficam à direita. 1–2 (Beta 1, rival 2) vira 2–1 → Alfa ou empate + 2+ gols: ganharia
  const names = { home: 'Alfa', away: 'Beta' }, s = comboStrip(combo, g.teams[1], names);
  assert.equal(s.n, 10);
  assert.match(s.html, />2–1</);
  const sa = comboStrip(combo, g.teams[0], names);
  assert.equal(sa.wins, 8, 'Alfa: perde só o 0–1 e o 1–2 (o 1X falha); nos outros 8, 1X e 2+ gols');
  assert.match(comboBody(g, combo), /class="strips"/);
});

test('perna de múltipla: a chance, o esperado de gols e a linha nos últimos jogos de cada time; asiática com devolução', () => {
  const g = G();
  const leg = { fixtureId: 7, lineId: 'gO1.5', line: 'Mais de 1,5', p: 0.8, p_pinnacle: 0.79, p_nossa: 0.83, context: 'a favor', kickoff: T0, home: 'Alfa', away: 'Beta', competition: 'Liga' };
  const w = legWhy(g, leg);
  assert.equal(w.text, 'acerta 80% (Pinnacle 79%, nossa 83%) · esperado 3,0 gols (Pinnacle 2,8) · contexto a favor');
  assert.deepEqual(w.strips.map(x => [x.name, x.s.wins, x.s.n]), [['Alfa', 9, 10], ['Beta', 8, 10]]);
  const a = legWhy(g, { ...leg, lineId: 'gO2', line: 'Mais de 2', asian: true, p_win: 0.55, p_nossa: null });
  assert.match(a.text, /^não perde 80% · paga inteira 55% \(Pinnacle 79%\)/);
  assert.match(a.strips[0].s.html, /class="push"/, 'com 2 gols o mais de 2 devolve');
  const html = legsBody([g], { legs: [leg] });
  assert.match(html, /Alfa x Beta/);
  assert.equal((html.match(/class="hist strip"/g) || []).length, 2);
});

test('gráfico da chance: barra por fonte, a que manda em destaque, a linha da chance que a odd exige', () => {
  const svg = chanceChart([['Pinnacle', 0.5], ['Modelo', null], ['Nossa chance', 0.6, true]], [0.48, 'a odd 2,05 exige']);
  assert.equal((svg.match(/<path /g) || []).length, 2, 'sem dado, sem barra');
  assert.equal((svg.match(/class="em"/g) || []).length, 1);
  assert.match(svg, /a odd 2,05 exige 48%/);
  assert.equal(chanceChart([['Pinnacle', null]]), '');
});

test('o porquê de todas as entradas do plano da demo sai sem erro, com gráfico', async () => {
  const sc = await scanDay({ ...demo, stats: () => ({ api: 0, cache: 0 }) }, { date: '2026-10-01', top: 30, half: false });
  const plan = buildPlan(sc, { now: 0 });
  for (const x of plan.singles) assert.match(singleBody(x.g, x), /class="chance"/);
  for (const { g, combo } of plan.sameGame) assert.match(comboBody(g, combo), /class="chance"/);
  const legs = multiGames(sc.games, { now: 0 }).map(m => m.best).slice(0, 3);
  if (legs.length >= 2) assert.match(legsBody(sc.games, ticketOf(legs, {})), /class="legwhy"/);
  assert.ok(plan.singles.length + plan.sameGame.length > 0, 'a demo rende alguma entrada');
});
