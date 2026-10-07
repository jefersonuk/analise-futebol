import test from 'node:test';
import assert from 'node:assert/strict';
import * as demo from '../src/demo.js';
import { BEST_MARKETS, FILTER_KEYS, GOAL_HANDICAP, LIVE_1H, MAIN_MARKETS, SHOTS, bestLine, brDate, pickGames, rankGames, scanDay } from '../src/scanner.js';
import { isMain, isMainLine, isQuarter, isUnder, rankTier } from '../src/consistency.js';
import { isBet } from '../src/dossier.js';

// Demo sem os escanteios do 1º tempo da liga (como na varredura real): só os dos times, sob demanda.
function demoApi({ noHalf = true } = {}) {
  let n = 0;
  const strip = ms => ms.map(m => (noHalf ? { ...m, c1: undefined } : m));
  const halfAsked = [];
  return {
    ...demo,
    stats: () => ({ api: n, cache: 0 }),
    leagueMatches: (id, s) => { n += 1; return strip(demo.leagueMatches(id, s)); },
    attachHalfCorners: (scope, season, ms, _p, opts = {}) => {
      if (opts.onlyCached) return ms;
      halfAsked.push(scope); n += ms.length;
      const full = new Map(demo.leagueMatches(1, season).concat(demo.leagueMatches(1, season - 1)).map(m => [m.id, m]));
      return ms.map(m => ({ ...m, c1: full.get(m.id)?.c1 ?? null }));
    },
    halfAsked,
  };
}

test('varredura: maior chance de ganho nas linhas principais, só com preço da Pinnacle', async () => {
  const api = demoApi();
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.v, 8);
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 10);
  // guardados: os 5 melhores de cada filtro da tela (inclui o ao vivo do 1º tempo)
  const filters = [null, ...FILTER_KEYS, LIVE_1H];
  assert.ok(scan.games.length > 0 && scan.games.every(g => filters.some(market => rankGames(scan.games, { market }).slice(0, 5).some(x => x.g === g))));
  const lines = scan.games.flatMap(g => g.lines);
  // só as linhas principais, só over: escanteios 1T 4–5,5 e do jogo 8–11, gols 1T 1,5 e do jogo 1,5/2,5, chutes, handicap de
  // gols e 1X2; nenhum under, nenhum handicap de escanteios
  assert.ok(lines.every(l => isMainLine(l)));
  assert.ok(!lines.some(l => isUnder(l.id)), 'nenhum under');
  assert.ok(!lines.some(l => /escanteios/i.test(l.market) && !/^(c1|corners)O/.test(l.id)), 'escanteios só no over do total');
  // linha principal que a Pinnacle não cota, num total que ela cota: chance tirada do total dela, frágil (× 1,05)
  const derived = lines.filter(l => l.derived);
  assert.ok(derived.length > 0 && derived.every(l => l.fragile && l.pinnacle_odd == null && l.p_pinnacle > 0
    && Math.abs(l.odd_min - l.fair_odd_blend * 1.05) < 0.02 && /^derivada do total da Pinnacle/.test(l.priced_by)));
  assert.ok(lines.some(l => /^cornersO(9\.5|10|10\.5|11)$/.test(l.id)), 'escanteios acima de 9 para os jogos de muitos escanteios');
  assert.ok(Object.keys(scan.corners_report).length > 0);
  assert.ok(!lines.some(l => /^(c1[OU]3\.5|corners[OU]7|gU|g1U)/.test(l.id) || l.market === 'Handicap escanteios 1T'));
  for (const id of ['c1O5', 'c1O4.5', 'cornersO9', 'cornersO8.5', 'g1O1.5', 'gO2.5', '1', '2']) assert.ok(lines.some(l => l.id === id), id);
  for (const m of MAIN_MARKETS.concat(GOAL_HANDICAP, SHOTS, '1X2')) assert.ok(lines.some(l => l.market === m), m);
  // chutes: a Pinnacle não cota — preço só do modelo (× 1,08), over em qualquer linha
  assert.ok(lines.filter(l => SHOTS.includes(l.market)).every(l => l.model_only && /^(shots|sot)O/.test(l.id) && Math.abs(l.odd_min - l.fair_odd_blend * 1.08) < 0.02));
  // Melhor do jogo: só handicap de gols, gols, chutes e 1X2 — escanteios ficam nas abas deles
  assert.ok(rankGames(scan.games).every(x => BEST_MARKETS.includes(x.line.market)));
  assert.ok(rankGames(scan.games, { market: 'Total de escanteios' }).length > 0);
  assert.ok(rankGames(scan.games, { market: 'Chutes' }).every(x => SHOTS.includes(x.line.market)));
  assert.ok(lines.filter(l => l.market === GOAL_HANDICAP).every(l => /^ah[HA]/.test(l.id)), 'handicap de gols = asiático da Pinnacle');
  assert.ok(!lines.some(l => isQuarter(l.id)), 'sem linhas asiáticas fracionadas, mesmo com a Pinnacle cotando ,25 e ,75');
  // gols do 1º tempo vêm da Pinnacle (mercado 6) e do placar do 1º tempo dos jogos passados
  const g1 = lines.find(l => l.id === 'g1O1.5');
  assert.ok(g1 && g1.history.home.n > 0 && g1.history.home.what === 'gols no 1º tempo');
  // ordem: apostas primeiro; entre elas o nível nunca melhora ao descer
  const ranked = rankGames(scan.games), cands = ranked.map(x => isBet(x.line));
  assert.deepEqual(cands, [...cands].sort((a, b) => b - a));
  const tiers = ranked.filter(x => isBet(x.line)).map(x => rankTier(x.line));
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
  assert.ok(ranked.every(x => x.line.odd_min >= 1.5 && x.line.odd_min <= 3));
  assert.ok(ranked.every(x => x.line.p_blend >= 0.6), 'piso de 60% de acerto na linha do jogo');
  assert.ok(!ranked.some(x => x.line.odd_min <= 1.5 && x.line.odd_min_vs_pinnacle_pct > 5), 'piso de 1,50 fora do alcance não entra');
  assert.ok(api.halfAsked.length > 0 && api.halfAsked.every(s => /^tm\d+$/.test(s)));
});

test('sem escanteios do 1º tempo na Pinnacle: o 1º tempo sai do modelo, e seguem escanteios do jogo e gols', async () => {
  const base = demoApi();
  const no77 = () => demo.dayOdds().map(o => ({ ...o, bookmakers: o.bookmakers.map(b => ({ ...b, bets: b.bets.filter(x => x.id !== 77) })) }));
  const scan = await scanDay({ ...base, dayOdds: no77 }, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.equal(scan.with_odds, 10);
  assert.equal(scan.with_1h, 0);
  assert.ok(scan.games.length > 0);
  for (const g of scan.games) {
    assert.equal(g.pinnacle_1h, null);
    // sem a Pinnacle no 1º tempo: as linhas do 1º tempo saem só do modelo (× 1,08) e só viram aposta se forem âncora
    const c1 = g.lines.filter(l => l.market === 'Total escanteios 1T');
    assert.ok(c1.every(l => l.model_only && l.fragile && Math.abs(l.odd_min - l.fair_odd_blend * 1.08) < 0.02));
    assert.ok(c1.filter(isBet).every(l => l.tier === 'âncora'));
  }
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total escanteios 1T')), 'escanteios do 1º tempo pelo modelo');
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols 1T')), 'gols do 1º tempo continuam');
  assert.ok(base.halfAsked.every(x => /^tm\d+$/.test(x)), 'histórico do 1º tempo só dos times (as linhas do 1T do modelo usam)');
});

test('liga sem estatística de escanteios na API: o jogo entra só com os mercados de gols (totais e handicap)', async () => {
  const base = demoApi();
  const api = { ...base, leagueMatches: (id, s) => base.leagueMatches(id, s).map(m => ({ ...m, s: null })) };
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.ok(scan.games.length > 0, 'gols seguem analisados');
  assert.equal(scan.skipped.length, 0);
  for (const g of scan.games) {
    assert.match(g.no_corners, /não tem estatística de escanteios/);
    assert.ok(g.lines.length && g.lines.every(l => ['Total de gols', 'Total de gols 1T', GOAL_HANDICAP, '1X2'].includes(l.market)));
    assert.equal(g.live1h, null, 'sem escanteios, sem plano ao vivo do 1º tempo');
    assert.equal(g.pinnacle_1h, null);
    assert.equal(g.alerts.length, 0, 'a falta de escanteios não deixa as linhas de gols frágeis');
  }
  assert.ok(scan.games.some(g => g.lines.some(l => l.market === 'Total de gols' && !l.fragile)));
  assert.equal(base.halfAsked.length, 0);
});

test('varredura respeita o orçamento: liga nova que não cabe fica de fora', async () => {
  const api = { ...demoApi(), hasLeague: () => false };
  const scan = await scanDay(api, { date: '2026-10-01', budget: 10 });
  assert.equal(scan.games.length, 0);
  assert.ok(scan.skipped.length > 0 && scan.skipped.every(s => /orçamento/.test(s.why)));
});

test('seleções e copas: sem histórico na liga, a base vira os jogos dos times em todas as competições', async () => {
  const base = demoApi();
  const asked = [];
  const api = {
    ...base,
    leagueMatches: () => [],   // torneio sem jogos anteriores dos times (Nations League, copa)
    teamMatches: (id, s) => { asked.push(id); return demo.teamMatches(id, s).map(m => ({ ...m, c1: undefined })); },
  };
  const scan = await scanDay(api, { date: '2026-10-01', top: 5, budget: 5000 });
  assert.ok(scan.games.length > 0, 'jogos analisados pela base dos times');
  assert.ok(scan.games.every(g => g.team_base && g.alerts.some(a => /todas as competições/.test(a))));
  assert.ok(scan.games.every(g => g.lines.every(l => l.fragile)));
  assert.equal(new Set(asked).size, 20, 'todos os times dos jogos do torneio, juntos numa base');
});

test('linha do jogo: candidata primeiro, depois a mais consistente; Melhor do jogo sem escanteios e sem under', () => {
  const L = (id, market, tier, score, extra = {}) => ({ id, market, tier, consistency_score: score, odd_min: 1.7, politica_e: 'cheia',
    fragile: false, odd_min_vs_pinnacle_pct: 2, p_blend: 0.65, ...extra });
  const o25 = L('gO2.5', 'Total de gols', 'sólida', 0.58), c85 = L('cornersO8.5', 'Total de escanteios', 'âncora', 0.8);
  const ah = L('ahA0.5', 'Handicap asiático', 'sólida', 0.62), sh = L('shotsO22.5', 'Total de chutes', 'sólida', 0.6), x1 = L('1', '1X2', 'sólida', 0.59);
  assert.equal(bestLine([o25, c85]).id, 'gO2.5', 'o over de escanteios, mesmo mais consistente, fica na aba de escanteios');
  assert.equal(bestLine([o25, c85], { market: 'Total de escanteios' }).id, 'cornersO8.5');
  assert.equal(bestLine([o25, ah, sh, x1]).id, 'ahA0.5', 'handicap de gols, gols, chutes e 1X2 disputam o Melhor do jogo');
  assert.equal(bestLine([o25, { ...ah, odd_min_vs_pinnacle_pct: 7 }]).id, 'gO2.5', 'preço difícil perde a vez para a candidata');
  assert.equal(bestLine([sh, L('sotO8.5', 'Total de chutes no gol', 'sólida', 0.7)], { market: 'Chutes' }).id, 'sotO8.5');
  assert.equal(bestLine([L('gU2.5', 'Total de gols', 'âncora', 0.9), o25]).id, 'gO2.5', 'under nunca');
  assert.equal(bestLine([L('chA1.5', 'Handicap de escanteios', 'âncora', 0.9)]), null, 'handicap de escanteios fora');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'âncora', 0.7, { odd_min: 1.4 })]), null, 'odd mínima abaixo de 1,50 fica de fora');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'âncora', 0.7, { odd_min: 3.4, politica_e: 'não entrar' })]), null, 'acima de 3,00 também');
  assert.equal(bestLine([L('gO2.5', 'Total de gols', 'especulativa', 0.5, { p_blend: 0.58 })]), null, 'abaixo de 60% de acerto nem aparece');
});

test('próximas 4 horas: jogos da janela (virando o dia em Brasília), em ordem de horário, com contexto e plano ao vivo', async () => {
  const base = demoApi(), asked = [], h2h = [];
  // jogos da rodada espalhados de 15 em 15 minutos, do último para o primeiro
  const round = demo.dayFixtures().map((f, i) => ({ ...f, t: f.t + (9 - i) * 15 * 60e3 }));
  const first = Math.min(...round.map(f => f.t)), last = Math.max(...round.map(f => f.t));
  const api = { ...base, dayFixtures: d => { asked.push(d); return round; },
    headToHead: (a, b) => { h2h.push([a, b]); return demo.headToHead(a, b); } };
  const now = first - 60 * 60e3;   // 1 h antes do primeiro: a janela de 4 h cobre a rodada
  const scan = await scanDay(api, { hours: 4, now, top: 5, budget: 5000 });
  assert.equal(scan.mode, 'janela');
  assert.equal(scan.hours, 4, 'jogos suficientes nas 4 horas: a janela não cresce');
  assert.deepEqual(scan.window, { from: now + 10 * 60e3, to: now + 4 * 3600e3 });
  assert.deepEqual(asked, [...new Set([brDate(now), brDate(now + 4 * 3600e3)])], 'as datas de Brasília que a janela cobre');
  assert.equal(scan.fixtures, round.length);
  assert.ok(last <= scan.window.to);
  // os de maior chance, mostrados do mais próximo para o mais distante; pela chance, a ordem do ranking
  const byTime = pickGames(scan.games, { top: 20 }).map(x => x.g.fx.t);
  assert.deepEqual(byTime, [...byTime].sort((a, b) => a - b));
  assert.deepEqual(pickGames(scan.games, { top: 3, order: 'chance' }).map(x => x.g), rankGames(scan.games).slice(0, 3).map(x => x.g));
  for (const g of scan.games) {
    assert.ok(g.context.text.some(t => t.startsWith('Tabela:')) && g.context.text.some(t => t.startsWith('Esperado:')));
    assert.ok(g.h2h_api && g.context.h2h.n > 0, 'confronto direto da API nos jogos guardados');
    assert.ok(g.live1h && g.live1h.anchored && g.live1h.tables.length === 3);
    assert.ok(g.lines.every(l => l.context && ['a favor', 'misto', 'neutro', 'contra'].includes(l.context.verdict)));
  }
  assert.equal(new Set(h2h.map(String)).size, scan.games.length, 'um confronto direto por jogo guardado');
  // ao vivo do 1º tempo: com o total da Pinnacle primeiro, depois os que mais devem ter escanteios no 1º tempo
  const live = rankGames(scan.games, { market: LIVE_1H }).map(x => x.g.live1h.mu);
  assert.deepEqual(live, [...live].sort((a, b) => b - a));
});

test('poucas opções nas 4 horas: a janela cresce de 4 em 4 horas até 12', async () => {
  const round = demo.dayFixtures(), first = Math.min(...round.map(f => f.t));
  // rodada daqui a 5 h: as 4 horas estão vazias, 8 horas pegam a rodada inteira
  const later = await scanDay(demoApi(), { hours: 4, now: first - 5 * 3600e3, top: 5, budget: 5000 });
  assert.equal(later.asked_hours, 4);
  assert.equal(later.hours, 8);
  assert.equal(later.window.to, first - 5 * 3600e3 + 8 * 3600e3);
  assert.equal(later.fixtures, round.length);
  // pedindo 20 jogos, os 10 da rodada são poucos: vai até 12 horas
  assert.equal((await scanDay(demoApi(), { hours: 4, now: first - 3600e3, top: 20, budget: 5000 })).hours, 12);
  // nada em 12 horas: fica vazio
  const none = await scanDay(demoApi(), { hours: 4, now: first - 13 * 3600e3, budget: 5000 });
  assert.equal(none.hours, 12);
  assert.equal(none.fixtures, 0);
  assert.equal(none.games.length, 0);
});

test('Pinnacle sem escanteios no jogo: as linhas de escanteios saem do modelo (aposta só se for âncora)', async () => {
  const noCorners = () => demo.dayOdds().map(o => ({ ...o, bookmakers: o.bookmakers.map(b => ({ ...b, bets: b.bets.filter(x => ![45, 56, 57, 58, 77].includes(x.id)) })) }));
  const scan = await scanDay({ ...demoApi(), dayOdds: noCorners }, { date: '2026-10-01', top: 10, budget: 5000 });
  const corners = scan.games.flatMap(g => g.lines).filter(l => /escanteios/i.test(l.market));
  assert.ok(corners.length > 0, 'escanteios continuam como opção');
  assert.ok(corners.every(l => l.model_only && l.fragile && Math.abs(l.odd_min - l.fair_odd_blend * 1.08) < 0.02));
  assert.ok(corners.filter(isBet).every(l => l.tier === 'âncora'));
  assert.ok(scan.corners_report['preço modelo'] > 0);
  assert.ok(rankGames(scan.games, { market: 'Total de escanteios' }).length > 0);
});
