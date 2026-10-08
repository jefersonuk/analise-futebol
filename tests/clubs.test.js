import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClubs, clubsHtml, clubsText, earlyRisk, loadClubs, marketOf } from '../src/clubs.js';
import { conditionsOf } from '../src/scenario.js';
import { lineVerdict } from '../src/lineupcheck.js';

const NOW = Date.UTC(2026, 9, 8, 12), DAY = 864e5;
const fx = { id: 1, t: NOW, home: { id: 10, name: 'Sporty' }, away: { id: 20, name: 'Khaitan' }, league: { id: 5, name: 'Division 1', season: 2026 } };
const row = (team, rank, extra = {}) => ({ team, name: `T${team}`, rank, points: 30 - rank * 3, played: 14, gd: 10 - rank * 3, group: 'G', zone: null, form: 'WDLWW', ...extra });
const prevD1 = [row(10, 4), ...[11, 12, 13, 14, 15, 16].map((t, i) => row(t, i < 3 ? i + 1 : i + 2))];   // Khaitan não estava
const prevPL = [row(20, 9, { zone: 'Relegation' }), ...[21, 22, 23, 24, 25, 26, 27, 28, 29].map((t, i) => row(t, i < 8 ? i + 1 : 10))];
const tr = (k, type, inId, outId) => ({ player: `P${k}`, date: new Date(NOW - k * 10 * DAY).toISOString().slice(0, 10), type, in: inId, inName: `C${inId}`, out: outId, outName: `C${outId}` });
const transfers = { 10: [tr(1, 'Free', 99, 10), tr(2, 'Free', 98, 10)],
  20: [tr(1, '€ 300K', 20, 31), tr(2, 'Loan', 20, 32), ...[3, 4, 5, 6, 7].map(k => tr(k, 'Free', 20, 30 + k)), tr(30, 'Free', 20, 50)] };   // o último: fora da janela
const zero = [row(10, 5, { played: 0, points: 0, gd: 0 }), row(20, 6, { played: 0, points: 0, gd: 0 }), row(11, 1, { played: 0, points: 0, gd: 0 })];

test('mercado: chegadas, saídas, compras e empréstimos na janela', () => {
  const m = marketOf(transfers[20], 20, NOW);
  assert.equal(m.arrivals, 7); assert.equal(m.departures, 0); assert.equal(m.loans, 1);
  assert.deepEqual(m.paid, ['P1 (€ 300K, do C31)']);
  assert.equal(marketOf(transfers[10], 10, NOW).departures, 2);
  assert.equal(marketOf(null, 10, NOW), null);
});

test('o caso Sporty x Khaitan: começo de temporada, o favorito caiu de divisão e mexeu no elenco', () => {
  const c = buildClubs({ fx, prev: prevD1, other: { 20: { league: 'Premier League', table: prevPL } }, transfers, table: zero, now: NOW });
  assert.equal(c.played, 0); assert.equal(c.table_now, null, 'sem jogo ainda: sem tabela atual');
  assert.equal(c.home.prev.rank, 4); assert.equal(c.away.dir, 'caiu'); assert.ok(c.away.moved);
  const names = { home: 'Sporty', away: 'Khaitan' }, txt = clubsText(c, names).join('\n');
  assert.match(txt, /Temporada passada \(2025\): Sporty 4º de 7 na Division 1 \(18 pts em 14 jogos, saldo -2\) · Khaitan 9º de 10 na Premier League — rebaixado/);
  assert.match(txt, /Mercado \(últimos 5 meses, API\): Sporty 0 chegadas e 2 saídas · Khaitan 7 chegadas \(1 por empréstimo\), compras: P1/);
  assert.match(txt, /Começo de temporada \(nenhum jogo na liga ainda\).*Khaitan caiu de divisão; Khaitan com 7 chegadas/);
  assert.deepEqual(earlyRisk(c, names), ['Khaitan caiu de divisão', 'Khaitan com 7 chegadas e 0 saídas']);
  // vira condição do "entrar se…", e a conferência da escalação não resolve: meia entrada
  const conds = conditionsOf({ fx, clubs: c });
  assert.match(conds[0], /^começo de temporada com mudança grande/);
  const line = { id: 'ahA-1', line: 'Khaitan -1', odd_min: 2, pinnacle_odd: 2.1, diff_pp: 3, entry_brl: 200, conditions: conds };
  const rep = { home: { known: false, name: 'Sporty', games: 0, xi: [] }, away: { known: false, name: 'Khaitan', games: 0, xi: [] } };
  const v = lineVerdict({ line, rep, names, odds: { now: 2.1, updatedAt: null }, kickoff: NOW });
  assert.equal(v.verdict, 'meia'); assert.ok(v.reasons.some(r => /começo de temporada com mudança grande/.test(r.text)));
});

test('liga em andamento: tabela atual inteira; sem mudança grande, sem condição', () => {
  const table = prevD1.map(r => ({ ...r, played: 5 })).concat(row(20, 8, { played: 5 }));
  const c = buildClubs({ fx, prev: prevD1, other: { 20: { league: 'Premier League', table: prevPL } }, transfers: { 10: [], 20: [] }, table, now: NOW });
  assert.equal(c.played, 5); assert.equal(c.table_now.length, 8);
  assert.deepEqual(earlyRisk(c, { home: 'a', away: 'b' }), []);
  assert.equal(conditionsOf({ fx, clubs: c }).length, 0);
  const txt = clubsText(c, { home: 'Sporty', away: 'Khaitan' }).join('\n');
  assert.match(txt, /a API não registra transferências destes times/);
  assert.doesNotMatch(txt, /Começo de temporada/);
  const html = clubsHtml(c, fx, s => s);
  assert.match(html, /Tabela atual \(5 rodadas\)/); assert.match(html, /<tr class="on">\s*<td>8<\/td><td>T20/);
});

test('busca: tabela passada da liga, liga de quem veio de fora e transferências, dentro do orçamento', async () => {
  const calls = [];
  const api = {
    standings: async (lid, s) => { calls.push(`std ${lid} ${s}`); return lid === 5 ? prevD1 : prevPL; },
    leaguesOf: async (team, s) => { calls.push(`lgs ${team} ${s}`); return [{ id: 7, name: 'Premier League' }]; },
    transfers: async team => { calls.push(`tr ${team}`); return transfers[team]; },
  };
  const c = await loadClubs(api, fx, { table: zero });
  assert.deepEqual(calls, ['std 5 2025', 'tr 10', 'lgs 20 2025', 'std 7 2025', 'tr 20']);
  assert.equal(c.away.dir, 'caiu');
  let left = 1;
  const c2 = await loadClubs(api, fx, { table: zero, budget: n => (left -= n) >= 0 });
  assert.ok(c2.home.prev && !c2.home.market && !c2.away.prev, 'sem orçamento, só a tabela passada');
});
