import test from 'node:test';
import assert from 'node:assert/strict';
import { dist, settle } from '../src/model.js';
import { HALF_MIN, LIVE_LINES, LIVE_MINUTES, liveEntry, liveLine, livePlan, remaining } from '../src/live.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('no minuto 0 sem escanteio, a chance ao vivo é a do pré-jogo', () => {
  for (const [mu, phi] of [[4.6, 1], [4.6, 1.3], [5.2, 1.5]]) {
    const pre = settle(dist(mu, phi, 60).map((p, k) => [k, p]), -3.5);
    near(liveLine({ mu, phi, minute: 0, corners: 0, line: 3.5 }).p, pre.pWin, 1e-9, `μ ${mu} φ ${phi}`);
  }
});

test('Poisson (φ = 1): o que já aconteceu não muda o ritmo, só o que falta', () => {
  const a = remaining({ mu: 4.7, phi: 1, minute: 10, corners: 0 }), b = remaining({ mu: 4.7, phi: 1, minute: 10, corners: 3 });
  near(a.mean, 4.7 * (HALF_MIN - 10) / HALF_MIN, 1e-12, 'resto proporcional ao tempo');
  assert.equal(a.mean, b.mean);
});

test('binomial negativa: sem escanteio o ritmo esperado cai; com escanteio cedo, sobe', () => {
  const free = 4.7 * (HALF_MIN - 8) / HALF_MIN;
  const zero = remaining({ mu: 4.7, phi: 1.3, minute: 8, corners: 0 }).mean, two = remaining({ mu: 4.7, phi: 1.3, minute: 8, corners: 2 }).mean;
  assert.ok(zero < free && two > free, `${zero} < ${free} < ${two}`);
});

// A conta fechada contra uma simulação do processo: ritmo do jogo gama (forma r, média μ), escanteios Poisson
// no tempo; condicionado a c escanteios até o minuto m, a frequência do over tem de bater com liveLine.
test('atualização gama–Poisson confere com a simulação', () => {
  let x = 12345;
  const u = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pois = l => { const e = Math.exp(-l); let k = 0, p = u(); while (p > e) { k++; p *= u(); } return k; };
  // gama com forma inteira grande o suficiente: soma de exponenciais (r = μ/(φ−1) = 4,7/0,47 = 10)
  const mu = 4.7, phi = 1.47, r = mu / (phi - 1), minute = 8, f = minute / HALF_MIN;
  const R = Math.round(r), gamma = () => { let s = 0; for (let i = 0; i < R; i++) s -= Math.log(u()); return s * mu / R; };
  const hit = { 0: [0, 0], 1: [0, 0] };
  for (let i = 0; i < 400000; i++) {
    const lam = gamma(), early = pois(lam * f);
    if (early > 1) continue;
    const total = early + pois(lam * (1 - f));
    hit[early][0]++; if (total > 3.5) hit[early][1]++;
  }
  for (const c of [0, 1]) {
    const sim = hit[c][1] / hit[c][0], calc = liveLine({ mu, phi, minute, corners: c, line: 3.5 }).p;
    near(calc, sim, 0.006, `${c} escanteio(s) aos ${minute}'`);
  }
});

test('plano: sem escanteio a odd mínima do over sobe a cada minuto; com escanteio, cai', () => {
  const plan = livePlan({ mu: 4.8, phi: 1.25, anchored: true, pinnacle: 4.7 });
  assert.deepEqual(plan.lines, LIVE_LINES);
  const at = (c, m, L) => plan.tables.find(t => t.corners === c).rows.find(r => r.minute === m).cells.find(z => z.line === L);
  for (const L of LIVE_LINES) {
    const odds = LIVE_MINUTES.map(m => at(0, m, L).odd_min);
    assert.deepEqual(odds, [...odds].sort((a, b) => a - b), `mais de ${L}`);
    assert.ok(at(1, 10, L).odd_min < at(0, 10, L).odd_min);
  }
  assert.equal(plan.margin, 1.05);
  assert.equal(livePlan({ mu: 4.8, phi: 1.25, anchored: false }).margin, 1.08);
  // linha inteira (3) devolve com exatamente 3: chance condicional maior que a do 3,5 e menor que a do 2,5
  assert.ok(at(0, 5, 2.5).p > at(0, 5, 3).p && at(0, 5, 3).p > at(0, 5, 3.5).p);
});

test('vale entrar? odd da casa contra a odd mínima do minuto, com entrada pela Política E', () => {
  const base = { mu: 4.6, phi: 1.2, anchored: true, minute: 8, line: 3.5 };
  const z = liveEntry({ ...base, corners: 0 });
  assert.ok(z.odd_min > z.fair && Math.abs(z.odd_min / z.fair - 1.05) < 1e-9);
  const yes = liveEntry({ ...base, corners: 0, odd: z.odd_min + 0.05 }), no = liveEntry({ ...base, corners: 0, odd: z.odd_min - 0.05 });
  assert.ok(yes.value && yes.ev > 0 && yes.entry_brl > 0 && yes.politica_e === 'meia', 'odd acima de 2,10: meia entrada');
  assert.ok(!no.value && no.entry_brl === 0 && no.why);
  assert.equal(liveEntry({ ...base, corners: 0, odd: 3.4 }).why, 'odd acima de 3,00: fora da Política E');
  assert.equal(liveEntry({ ...base, corners: 4 }).settled, 'ganha');
  // o mesmo 2,00 vale muito mais com 1 escanteio no minuto 8
  assert.ok(liveEntry({ ...base, corners: 1, odd: 2 }).ev > liveEntry({ ...base, corners: 0, odd: 2 }).ev + 0.2);
});
