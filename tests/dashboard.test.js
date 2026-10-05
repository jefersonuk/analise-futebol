import test from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../src/dashboard.js';
import { consistency } from '../src/consistency.js';

// recentGames devolve do mais recente para o mais antigo; o gráfico inverte (antigo à esquerda).
const g = (gf, ga, cf, ca, home = true) => ({ t: 0, home, opp: 'Rival', gf, ga, corners: [cf, ca], shots: [10, 8], sot: [4, 3] });
const games = [g(3, 1, 7, 2), g(1, 1, 4, 5), g(0, 2, 3, 6), g(2, 0, 6, 3)];
const res = (id, role) => history(id, role, 'Time', games).bars.map(b => b.res).reverse();

test('over/under de gols pelo total de cada jogo', () => {
  assert.deepEqual(res('gO2.5', 'home'), ['win', 'lose', 'lose', 'lose']);
  assert.deepEqual(res('gU2.5', 'away'), ['lose', 'win', 'win', 'win']);
  assert.equal(history('gO2.5', 'home', 'Time', games).wins, 1);
});

test('linha inteira e de quarto: devolve e meio resultado', () => {
  assert.deepEqual(res('gO2', 'home'), ['win', 'push', 'push', 'push']);
  assert.deepEqual(res('gO2.25', 'home'), ['win', 'hl', 'hl', 'hl']);
});

test('handicap: saldo do próprio time, lado certo para mandante e visitante', () => {
  // aposta no mandante −1: para o time mandante, ganha com saldo ≥ 2
  assert.deepEqual(res('ahH-1', 'home'), ['win', 'lose', 'lose', 'win']);
  // mesma aposta vista pelo visitante: ganha quando ELE perde por 2+
  assert.deepEqual(res('ahH-1', 'away'), ['lose', 'lose', 'win', 'lose']);
  assert.deepEqual(res('X', 'home'), ['lose', 'win', 'lose', 'lose']);
  assert.deepEqual(res('1', 'home'), ['win', 'lose', 'lose', 'win']);
});

test('escanteios por time: do próprio time ou cedidos pelo adversário', () => {
  const own = history('cHO4.5', 'home', 'Casa', games), ced = history('cHO4.5', 'away', 'Fora', games);
  assert.match(own.what, /escanteios do Casa/);
  assert.match(ced.what, /cedidos pelo Fora/);
  assert.deepEqual(own.bars.map(b => b.v).reverse(), [7, 4, 3, 6]);
  assert.deepEqual(ced.bars.map(b => b.v).reverse(), [2, 5, 6, 3]);
});


test('consistência: piso de 60% de acerto, âncora só com 70%+; histórico contra derruba para especulativa', () => {
  const t = (p, pLow, a, b) => consistency({ p, pLow, hits: [{ wins: a, n: 10 }, { wins: b, n: 10 }] }).tier;
  assert.equal(t(0.74, 0.65, 8, 7), 'âncora');
  assert.equal(t(0.64, 0.55, 9, 8), 'sólida', 'abaixo de 70% nunca é âncora, por melhor que seja o histórico');
  assert.equal(t(0.74, 0.65, 7, 5), 'sólida', 'um time abaixo de 6/10 tira da âncora');
  assert.equal(t(0.74, 0.58, 8, 8), 'sólida', 'pior cenário abaixo de 60% tira da âncora');
  assert.equal(t(0.58, 0.5, 9, 9), 'especulativa', 'abaixo do piso de 60%, por melhor que seja o histórico');
  assert.equal(t(0.62, 0.55, 5, 5), 'especulativa', 'histórico de 50% puxa o acerto para baixo de 60%');
  assert.equal(t(0.62, 0.48, 7, 7), 'especulativa', 'pior cenário abaixo de 50%');
  assert.equal(t(0.45, 0.35, 9, 9), 'especulativa');
  const a = consistency({ p: 0.62, pLow: 0.52, hits: [{ wins: 8, n: 10 }, { wins: 8, n: 10 }] });
  const b = consistency({ p: 0.62, pLow: 0.52, hits: [{ wins: 5, n: 10 }, { wins: 5, n: 10 }] });
  assert.ok(a.score > b.score);
});

test('handicap de escanteios 1T usa o saldo de escanteios do 1º tempo do time', () => {
  const gs = [{ ...g(1, 0, 6, 2), c1: [3, 1] }, { ...g(0, 0, 4, 4), c1: [1, 2] }, { ...g(2, 2, 5, 5), c1: null }];
  const home = history('c1hH-1', 'home', 'Casa', gs), away = history('c1hH-1', 'away', 'Fora', gs);
  assert.deepEqual(home.bars.map(b => b.v).reverse(), [2, -1]);   // jogo sem dado de 1º tempo fica de fora
  assert.deepEqual(home.bars.map(b => b.res).reverse(), ['win', 'lose']);
  assert.deepEqual(away.bars.map(b => b.res).reverse(), ['lose', 'push']);   // visto pelo visitante: perder o 1T por 1 = devolve
  assert.deepEqual(history('c1O2.5', 'home', 'Casa', gs).bars.map(b => b.res).reverse(), ['win', 'win']);
});

import { pickDashboard } from '../src/dashboard.js';

test('painel em foco: linhas principais com preço da Pinnacle, candidatas primeiro e o motivo das outras', () => {
  const L = (id, market, tier, score, odd, extra = {}) => ({ id, market, tier, consistency_score: score, odd_min: odd, priced_by: 'pinnacle',
    politica_e: odd > 3 ? 'não entrar' : 'cheia', odd_min_vs_pinnacle_pct: 2, p_model_range: [0.5, 0.6], ...extra });
  const dossier = {
    focus_markets: ['Total escanteios 1T', 'Total de escanteios', 'Total de gols 1T', 'Total de gols', 'Handicap de escanteios'],
    candidates_focus: ['cornersU8.5'], candidates: ['1'],
    lines_with_pinnacle: [L('cornersU8.5', 'Total de escanteios', 'sólida', 0.62, 1.7), L('gO2.5', 'Total de gols', 'especulativa', 0.45, 2.1, { p_blend: 0.45 }),
      L('gO1.5', 'Total de gols', 'âncora', 0.8, 1.3), L('gU2.5', 'Total de gols', 'sólida', 0.6, 1.8), L('gO3', 'Total de gols', 'âncora', 0.7, 1.7),
      L('c1O4.5', 'Total escanteios 1T', 'sólida', 0.6, 1.9, { odd_min_vs_pinnacle_pct: 7 }), L('chA1.5', 'Handicap de escanteios', 'sólida', 0.58, 1.8),
      L('1', '1X2', 'sólida', 0.6, 1.9)],
    lines_anchored: [L('c1O4', 'Total escanteios 1T', 'âncora', 0.8, 1.6, { priced_by: 'modelo' }), L('chA3', 'Handicap de escanteios', 'âncora', 0.8, 1.6, { priced_by: 'modelo' })],
  };
  const lines = pickDashboard(dossier, 5, { focus: true });
  // nem linha fora das principais (gO3), nem under de gols, nem linha sem preço da Pinnacle; odd abaixo de 1,50 por último
  assert.deepEqual(lines.map(l => l.id), ['cornersU8.5', 'c1O4.5', 'chA1.5', 'gO2.5', 'gO1.5']);
  assert.deepEqual(lines.map(l => l.outside ?? null), [null, 'preço difícil de achar', 'alternativa de linha', 'acerta 45%: abaixo do piso de 60%', 'odd abaixo de 1,50']);
  assert.ok(pickDashboard(dossier, 5, { focus: false }).some(l => l.id === '1'));
});

import { isUnder } from '../src/consistency.js';
import { byConsistency, isCandidate } from '../src/dossier.js';

test('preferência por over: under só se for âncora e passa na frente só se for claramente melhor', () => {
  const L = (id, tier, score) => ({ id, tier, consistency_score: score, fragile: true, odd_min: 1.6, politica_e: 'cheia', odd_min_vs_pinnacle_pct: null });
  assert.ok(isUnder('gU2.5') && isUnder('c1U4.5') && isUnder('cornersU9.5') && isUnder('cAU4.5') && isUnder('crN9'));
  assert.ok(!isUnder('gO2.5') && !isUnder('c1hH-0.5') && !isUnder('shotsU20.5'));
  assert.equal(isCandidate(L('gU2.5', 'sólida', 0.7)), false, 'under sólida não é candidata');
  assert.equal(isCandidate(L('gU2.5', 'âncora', 0.7)), true);
  // under âncora com score parecido fica atrás do over sólido
  assert.deepEqual([L('gU2.5', 'âncora', 0.64), L('gO2.5', 'sólida', 0.62)].sort(byConsistency).map(l => l.id), ['gO2.5', 'gU2.5']);
  // under âncora muito melhor passa na frente
  assert.deepEqual([L('gO2.5', 'sólida', 0.6), L('gU2.5', 'âncora', 0.72)].sort(byConsistency).map(l => l.id), ['gU2.5', 'gO2.5']);
});

test('caso real: Corinthians 0–1 Santos (30/08/2026), escanteios 8–1, 1º tempo 2–1, visto pelo Santos', () => {
  // recentGames guarda do ponto de vista do time: a favor–contra
  const g = { t: Date.parse('2026-08-30T19:00:00Z'), home: false, opp: 'Corinthians', gf: 1, ga: 0, corners: [1, 8], c1: [1, 2], shots: [8, 18], sot: [4, 2] };
  // São Paulo x Santos, aposta Fora +4,5 escanteios (a favor do Santos, que é o visitante)
  const h = history('chA4.5', 'away', 'Santos', [g]);
  assert.equal(h.bars[0].v, -7);
  assert.equal(h.bars[0].res, 'lose');
  assert.equal(h.calc(g), 'Santos 1 − 8 Corinthians');
  // total de escanteios: soma na ordem do placar (mandante primeiro)
  assert.equal(history('cornersO8.5', 'away', 'Santos', [g]).calc(g), 'Corinthians 8 + 1 Santos');
  // 1º tempo: saldo do Santos 1 − 2
  const h1 = history('c1hA0.5', 'away', 'Santos', [g]);
  assert.equal(h1.bars[0].v, -1);
  assert.equal(h1.calc(g), 'Santos 1 − 2 Corinthians');
  assert.equal(h1.bars[0].res, 'lose');   // Fora +0,5 com saldo −1: −1 + 0,5 = −0,5 → perde
});

test('caso real: São Bernardo x CRB, aposta CRB −2,5 — regra do lado certo em cada gráfico', () => {
  // América-MG 0–2 São Bernardo (14/09/2026), visto pelo São Bernardo (mandante do jogo de hoje)
  const sb = { t: Date.parse('2026-09-14T22:00:00Z'), home: false, opp: 'America Mineiro', gf: 2, ga: 0 };
  const hSB = history('ahA-2.5', 'home', 'São Bernardo', [sb]);
  assert.equal(hSB.rule, 'abaixo de -2,5');   // a aposta no CRB −2,5 só vence se o São Bernardo perder por 3+
  assert.equal(hSB.bars[0].v, 2);
  assert.equal(hSB.bars[0].res, 'lose');
  // CRB 3–0 Cuiabá (27/09/2026), visto pelo CRB (visitante do jogo de hoje)
  const crb = { t: Date.parse('2026-09-27T22:00:00Z'), home: true, opp: 'Cuiaba', gf: 3, ga: 0 };
  const hCRB = history('ahA-2.5', 'away', 'CRB', [crb]);
  assert.equal(hCRB.rule, 'acima de 2,5');
  assert.equal(hCRB.bars[0].res, 'win');
  assert.equal(history('X', 'home', 'São Bernardo', [sb]).rule, 'só com saldo 0 (empate)');
});

import { lineHistory, roleWeight, rolesNow } from '../src/dossier.js';

test('acerto pelo papel: jogos no papel de hoje pesam 1, vizinho 0,6, oposto 0,3', () => {
  assert.equal(roleWeight('zebra', 'zebra'), 1);
  assert.equal(roleWeight('zebra', 'equilibrado'), 0.6);
  assert.equal(roleWeight('zebra', 'favorito'), 0.3);
  assert.equal(roleWeight(null, 'favorito'), 1);
  assert.deepEqual(rolesNow({ sup: -1.4 }), { home: 'zebra', away: 'favorito' });
  assert.deepEqual(rolesNow({ sup: 0.1 }), { home: 'equilibrado', away: 'equilibrado' });
  // Time que venceu o 1º tempo nos escanteios quando era favorito e perdeu quando era zebra
  const g = (sup, c1) => ({ t: 0, home: true, opp: 'X', gf: 1, ga: 0, c1, sup });
  const games = [g(0.8, [4, 1]), g(0.9, [5, 2]), g(0.6, [3, 1]), g(1.1, [4, 0]), g(-0.9, [1, 3]), g(-1.2, [0, 4])];
  const id = 'c1hH-0.5';   // mandante −0,5 no 1º tempo: vence se ganhar o 1T nos escanteios
  const asZebra = lineHistory(id, [{ role: 'home', name: 'T', games, roleNow: 'zebra' }]).home;
  const asFav = lineHistory(id, [{ role: 'home', name: 'T', games, roleNow: 'favorito' }]).home;
  assert.equal(asZebra.hits, '4/6');                         // contagem simples igual nos dois
  assert.deepEqual(asZebra.by_role, { favorito: { wins: 4, n: 4 }, zebra: { wins: 0, n: 2 } });
  assert.ok(Math.abs(asZebra.wins / asZebra.n - 1.2 / 3.2) < 1e-9, 'como zebra: 4×0,3 de 4×0,3+2×1');
  assert.ok(Math.abs(asFav.wins / asFav.n - 4 / 4.6) < 1e-9, 'como favorito: 4 de 4+2×0,3');
  assert.equal(asZebra.role_now, 'zebra');
});

test('gols do 1º tempo: histórico pelo placar do intervalo, na ordem do placar', () => {
  const gs = [{ t: 2, home: true, opp: 'B', gf: 3, ga: 1, g1: [2, 0] }, { t: 1, home: false, opp: 'C', gf: 1, ga: 1, g1: [0, 1] }, { t: 0, home: true, opp: 'D', gf: 0, ga: 0, g1: null }];
  const h = history('g1O1.5', 'home', 'A', gs);
  assert.deepEqual(h.bars.map(b => b.v), [1, 2]);   // jogo sem placar do intervalo fica de fora
  assert.deepEqual(h.bars.map(b => b.res), ['lose', 'win']);
  assert.equal(h.what, 'gols no 1º tempo');
  assert.equal(h.calc(gs[1]), 'C 1 + 0 A');           // A jogou fora: mandante primeiro
});

import { valueOf } from '../src/consistency.js';

test('valor: confirmado só com o modelo (pior cenário) e o histórico acima do mercado', () => {
  const hits = (a, b) => [{ wins: a, n: 10 }, { wins: b, n: 10 }];
  assert.equal(valueOf({ p: 0.56, q: 0.53, pLow: 0.54, hits: hits(7, 6) }).level, 'confirmado');
  assert.equal(valueOf({ p: 0.56, q: 0.53, pLow: 0.5, hits: hits(7, 6) }).level, 'sem confirmação', 'pior cenário abaixo do mercado');
  assert.equal(valueOf({ p: 0.56, q: 0.53, pLow: 0.54, hits: hits(9, 3) }).level, 'sem confirmação', 'um time 10 pp abaixo');
  assert.equal(valueOf({ p: 0.56, q: 0.53, pLow: 0.54, hits: hits(4, 4) }).level, 'sem valor', 'histórico contra');
  assert.equal(valueOf({ p: 0.535, q: 0.53, pLow: 0.6, hits: hits(9, 9) }).level, 'sem valor', 'menos de +1%');
  assert.equal(valueOf({ p: 0.56, q: 0.53, pLow: 0.54, hits: [{ wins: 3, n: 4 }] }).level, 'sem confirmação', 'histórico curto');
  const v = valueOf({ p: 0.36, q: 0.33, pLow: 0.34, hits: hits(5, 4) });   // odd ~3: valor é relativo ao preço, não ao acerto absoluto
  assert.equal(v.level, 'confirmado');
  assert.ok(Math.abs(v.value - 0.0909) < 1e-3);
});
