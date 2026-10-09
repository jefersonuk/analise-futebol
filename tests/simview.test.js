import test from 'node:test';
import assert from 'node:assert/strict';

// o painel roda no navegador: aqui, o mínimo de window e de elemento
globalThis.window ??= new EventTarget();
globalThis.confirm = () => true;
const { simPanel } = await import('../src/simview.js');

const store = () => { const m = new Map(); return { m, loadDoc: async k => (m.has(k) ? structuredClone(m.get(k)) : null), saveDoc: async (k, v) => { m.set(k, structuredClone(v)); }, removeDoc: async k => { m.delete(k); } }; };
const el = () => ({ innerHTML: '', addEventListener() {} });
const tick = () => new Promise(r => setTimeout(r, 20));
const bet = (cat, extra = {}) => ({ key: `${cat}|1|gO2.5`, cat, fixtureId: 1, kickoff: Date.now() + 3600e3, home: 'A', away: 'B', line: 'Mais de 2,5', odd: 2, odd_src: 'pinnacle',
  p: 0.55, stake_brl: 100, status: 'aberta', winner: null, profit_u: null, profit_brl: null, clv: null, detail: null, ...extra });
const scanSim = id => ({ id, scan_at: new Date().toISOString(), bets: [bet('Gols')] });
const planSim = (id, win, extra = {}) => ({ id, plan: true, win, label: `plano ${id}`, date: '2026-10-09', scan_at: new Date().toISOString(), bets: [bet('Plano: simples (nossa leitura)', extra)] });

test('dois painéis no mesmo índice: cada tela mostra as suas, e gravar ou apagar numa não some com as da outra', async () => {
  const api = store(), eScan = el(), ePlan = el();
  const scan = simPanel({ api, el: eScan, mine: id => !String(id).startsWith('plano-'), title: 'Varreduras', intro: '' });
  const plan = simPanel({ api, el: ePlan, mine: id => String(id).startsWith('plano-'), title: 'Planos', intro: '', cat: c => c.replace(/^Plano: /, '') });
  await tick();
  await scan.add(scanSim('100'));
  await plan.add(planSim('plano-1', 'h4'));
  await scan.add(scanSim('200'));
  await tick();
  assert.deepEqual(api.m.get('af:simidx'), ['200', 'plano-1', '100']);
  assert.ok(plan.has('plano-1') && !plan.has('100') && scan.has('100') && !scan.has('plano-1'));
  await scan.remove('100');
  assert.deepEqual(api.m.get('af:simidx'), ['200', 'plano-1'], 'apagar uma da varredura mantém a do plano');
  assert.match(ePlan.innerHTML, /📋 Plano plano plano-1/);
  assert.match(ePlan.innerHTML, /simples \(nossa leitura\)/);
  assert.doesNotMatch(ePlan.innerHTML, /Plano: simples|sem repetir a mesma linha|entrar se…/, 'no plano: lente sem o prefixo, só "Total"');
  assert.doesNotMatch(ePlan.innerHTML, /Varredura de/);
});

test('plano montado de novo na mesma janela antes de começar substitui o anterior; com jogo começado, os dois ficam', async () => {
  const api = store(), plan = simPanel({ api, el: el(), mine: id => String(id).startsWith('plano-'), title: 'Planos', intro: '' });
  await tick();
  const drop = sim => old => old.win === sim.win && old.bets.every(b => b.status === 'aberta' && b.kickoff > Date.now());
  const a = planSim('plano-1', 'h4'), b = planSim('plano-2', 'h4'), c = planSim('plano-3', 'd1');
  await plan.add(a); await plan.add(b, drop(b)); await plan.add(c, drop(c));
  assert.deepEqual(api.m.get('af:simidx'), ['plano-3', 'plano-2'], 'o plano-1 (mesma janela, nada começou) saiu; o da outra janela fica');
  assert.ok(!api.m.has('af:sim:plano-1'));
  const d = planSim('plano-4', 'h4', { kickoff: Date.now() - 3600e3 }), e = planSim('plano-5', 'h4');
  await plan.add(d, drop(d)); await plan.add(e, drop(e));
  assert.deepEqual(api.m.get('af:simidx'), ['plano-5', 'plano-4', 'plano-3'], 'com jogo já começado, o plano anterior fica para medir');
});
