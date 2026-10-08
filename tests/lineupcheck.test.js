import test from 'node:test';
import assert from 'node:assert/strict';
import { lineVerdict, lineupReport, reportText } from '../src/lineupcheck.js';

// elenco de 20 jogos: 11 titulares fixos (ids 1–11, o 9 artilheiro), reservas 12–18 pouco usados
const squad = base => Array.from({ length: 18 }, (_, k) => ({ id: base + k + 1, name: `J${base + k + 1}`, pos: k === 0 ? 'Goalkeeper' : 'Midfielder',
  starts: k < 11 ? 20 - (k % 3) : 2, apps: k < 11 ? 20 : 6, goals: k === 8 ? 9 : 1, in_squad: true }));
const xi = (base, starters, bench = []) => ({ team: base, name: base === 100 ? 'HJK' : 'VPS', formation: '4-2-3-1',
  startIds: starters.map(i => base + i), benchIds: bench.map(i => base + i), start: starters.map(i => `J${base + i}`) });
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const names = { home: 'HJK', away: 'VPS' }, KICK = Date.UTC(2026, 9, 8, 15);
const gapLine = { id: 'ahA0.5', line: 'VPS +0,5', market: 'Handicap asiático', odd_min: 1.95, pinnacle_odd: 2.48, diff_pp: 15, entry_brl: 300,
  conditions: ['a nossa leitura está 15 pp acima da Pinnacle — conferir escalação e notícias'] };
const oldOdds = { now: 2.48, updatedAt: new Date(KICK - 3 * 3600e3).toISOString() };

test('titulares habituais × escalação de hoje: completo, desfalcado, misto e artilheiro', () => {
  const full = lineupReport(squad(100), xi(100, ALL));
  assert.equal(full.level, 'completo'); assert.equal(full.kept, 11); assert.equal(full.out.length, 0);
  assert.match(reportText(full), /HJK: 11 de 11 titulares habituais · artilheiro J109 \(9 gols\) joga → time completo/);
  const three = lineupReport(squad(100), xi(100, [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14], [9, 10]));
  assert.equal(three.level, 'desfalcado'); assert.deepEqual(three.out.map(p => p.name).sort(), ['J109', 'J110', 'J111']);
  assert.match(reportText(three), /J109 — titular em 18 de 20, 9 gols, no banco/);
  assert.equal(lineupReport(squad(100), xi(100, [1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17])).level, 'misto');
  // quem saiu do clube não conta como titular fora
  const left = squad(100).map(p => (p.id === 110 ? { ...p, in_squad: false } : p));
  assert.equal(lineupReport(left, xi(100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12])).out.length, 0);
  // início de temporada ou sem dados: não dá para saber quem é titular
  assert.equal(lineupReport([], xi(100, ALL)).known, false);
  assert.equal(lineupReport(squad(100).map(p => ({ ...p, starts: Math.min(p.starts, 2) })), xi(100, ALL)).known, false);
  assert.equal(lineupReport(squad(100), { startIds: [] }), null);
});

test('o caso VPS: escalações completas e odds de antes da escalação — a diferença não se explica: meia entrada', () => {
  const rep = { home: lineupReport(squad(100), xi(100, ALL)), away: lineupReport(squad(200), xi(200, ALL)) };
  const v = lineVerdict({ line: gapLine, rep, names, odds: oldOdds, kickoff: KICK });
  assert.equal(v.verdict, 'meia'); assert.equal(v.stake, 150); assert.match(v.title, /Meia entrada a ≥ 1,95/);
  const txt = v.reasons.map(r => r.text).join('\n');
  assert.match(txt, /VPS, o nosso lado, vem completo/);
  assert.match(txt, /a API ainda não atualizou depois da escalação/);
  assert.match(txt, /diferença de 15 pp para a Pinnacle não tem explicação/);
});

test('veredito: adversário desfalcado ou mercado a favor explicam a diferença; nosso lado desfalcado ou mercado contra, não entrar', () => {
  const fresh = now => ({ now, updatedAt: new Date(KICK - 20 * 60e3).toISOString() });
  const hjkOut = lineupReport(squad(100), xi(100, [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14]));
  const vpsFull = lineupReport(squad(200), xi(200, ALL)), vpsOut = lineupReport(squad(200), xi(200, [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14]));
  assert.equal(lineVerdict({ line: gapLine, rep: { home: hjkOut, away: vpsFull }, names, odds: oldOdds, kickoff: KICK }).verdict, 'cheia');
  assert.equal(lineVerdict({ line: gapLine, rep: { home: hjkOut, away: vpsFull }, names, odds: oldOdds, kickoff: KICK }).stake, 300);
  const both = { home: lineupReport(squad(100), xi(100, ALL)), away: vpsFull };
  assert.equal(lineVerdict({ line: gapLine, rep: both, names, odds: fresh(2.3), kickoff: KICK }).verdict, 'cheia', 'caiu 7%: o mercado veio');
  assert.equal(lineVerdict({ line: gapLine, rep: both, names, odds: fresh(2.48), kickoff: KICK }).verdict, 'meia', 'parada depois da escalação');
  assert.equal(lineVerdict({ line: gapLine, rep: both, names, odds: fresh(2.7), kickoff: KICK }).verdict, 'nao', 'subiu: o mercado foi contra');
  assert.equal(lineVerdict({ line: gapLine, rep: { home: both.home, away: vpsOut }, names, odds: oldOdds, kickoff: KICK }).verdict, 'nao');
  // dúvida do adversário fora explica; do nosso lado fora é contra
  assert.equal(lineVerdict({ line: gapLine, rep: both, names, odds: oldOdds, kickoff: KICK, doubts: [{ player: 'J109', side: 'home', plays: false }] }).verdict, 'cheia');
  assert.equal(lineVerdict({ line: gapLine, rep: both, names, odds: oldOdds, kickoff: KICK, doubts: [{ player: 'J209', side: 'away', plays: false }] }).verdict, 'meia');
  // sem escalação: esperar; copa com o nosso lado completo e sem outra condição: entrada cheia
  assert.equal(lineVerdict({ line: gapLine, rep: null, names, odds: oldOdds, kickoff: KICK }).verdict, 'esperar');
  const cup = { ...gapLine, diff_pp: 8, conditions: ['copa: risco de rodízio — confirmar a escalação'] };
  assert.equal(lineVerdict({ line: cup, rep: both, names, odds: oldOdds, kickoff: KICK }).verdict, 'cheia');
  assert.equal(lineVerdict({ line: cup, rep: { home: both.home, away: lineupReport([], xi(200, ALL)) }, names, odds: oldOdds, kickoff: KICK }).verdict, 'meia');
  // a Pinnacle abaixo da nossa mínima: avisa para procurar a mínima na casa
  assert.ok(lineVerdict({ line: gapLine, rep: both, names, odds: fresh(1.9), kickoff: KICK }).reasons.some(r => /só entre se a casa pagar ≥ 1,95/.test(r.text)));
});
