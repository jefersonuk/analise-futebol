// Entrada numa linha da análise. Os dois apps estão no mesmo endereço (jefersonuk.github.io), então
// dividem o localStorage: daqui lemos as casas e a stake do app de apostas, e mandamos a aposta para a
// caixa de entrada dele. Quem grava a aposta é o próprio app de apostas (dono do estado e do sync),
// ao abrir ou ao voltar para a aba — assim nada daqui sobrescreve o que ele tem em memória.

export const BETS_KEY = 'apostasValor_v1';
export const INBOX_KEY = 'apostasInbox_v1';
export const BETS_URL = '../apostas-dados/#analise';

const BANKS = new Set(['binance', 'pipay', 'metamask', 'nubank', 'inter', 'itaú', 'bradesco', 'banestes', 'c6', 'picpay',
  'mercado pago', 'coinbase', 'bybit', 'trust wallet', 'casa b', 'cassino']);
// contas internas do app de apostas ("Em arbitragem", "Em apostas de valor", "Em middles"): não são casas
const notHouse = name => BANKS.has(name.trim().toLowerCase()) || /^em\s/i.test(name.trim());

export const SYMBOL = { BRL: 'R$', USD: 'US$', EUR: '€' };
const key = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Casas (sem bancos, carteiras e contas internas), saldo na moeda da casa, cotações (R$ por US$ e por €)
// e stake do Modelo F (em R$) do app de apostas.
export function betsApp() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(BETS_KEY)); } catch { /* sem dados */ }
  if (!st) return { found: false, houses: [], stake: null, rates: { BRL: 1, USD: null, EUR: null } };
  const lim = (st.cfg?.casasLimitadas || []).map(key).filter(Boolean);
  const houses = (st.balances || [])
    .filter(b => b.name && !notHouse(b.name))
    .map(b => ({ name: b.name.trim(), value: Number(b.value) || 0, currency: b.currency || 'BRL',
      limited: lim.some(l => key(b.name) === l || key(b.name).startsWith(l)) }))
    .sort((a, b) => a.limited - b.limited || b.value - a.value);
  return { found: true, houses, stake: st.cfg?.modelo?.stake > 0 ? st.cfg.modelo.stake : 300,
    rates: { BRL: 1, USD: st.usdRate > 0 ? st.usdRate : null, EUR: st.eurRate > 0 ? st.eurRate : null } };
}

const MARKET = {
  'Total de gols': 'Total de Gols', 'Total de gols 1T': 'Total de Gols', 'Handicap asiático': 'Handicap Asiático', '1X2': '1X2 / Resultado',
  'Ambas marcam': 'Ambas Marcam', 'Total de escanteios': 'Escanteios', 'Escanteios por time': 'Escanteios',
  'Total escanteios 1T': 'Escanteios', 'Handicap escanteios 1T': 'Escanteios', 'Handicap de escanteios': 'Escanteios',
  'Resultado escanteios': 'Escanteios', 'Resultado escanteios 1T': 'Escanteios', 'Corrida de escanteios': 'Escanteios', 'Total de chutes': 'Total de Chutes',
  'Total de chutes no gol': 'Total de Chutes', Combo: 'Combo (criar aposta)',
};

const localStr = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };

// line: linha do dossiê; fx: jogo. Formato que o app de apostas grava como aposta de valor: a stake vai
// em R$ (é como o app de apostas guarda) e stakeNat na moeda da casa, só para conferência.
export function buildEntry({ line, fx, casa, currency, odd, stake, stakeNat = null }) {
  return {
    id: `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString(), v: 2,
    casa, cur: currency || 'BRL', odd, stake, stakeNat: stakeNat ?? stake, sport: 'Futebol', market: MARKET[line.market] || line.market,
    event: `${fx.home.name} x ${fx.away.name} — ${line.market}: ${line.line}`, date: localStr(fx.t),
    oddMkt: line.fair_odd_blend, prob: line.p_blend,
    analise: {
      fixtureId: fx.id, kickoff: new Date(fx.t).toISOString(), home: fx.home.name, away: fx.away.name,
      competition: fx.league.name, lineId: line.id, mercado: line.market, linha: line.line, tier: line.tier,
      p_model: line.p_model, p_blend: line.p_blend, p_pinnacle: line.p_pinnacle ?? null,
      fair_odd: line.fair_odd_blend, odd_min: line.odd_min, pinnacle_odd: line.pinnacle_odd ?? null,
      priced_by: line.priced_by, fragile: !!line.fragile,
      // entrada manual: sua análise, registrada sem as regras do app (piso de 60%, odd mínima, jogo difícil)
      ...(line.manual ? { manual: true } : {}),
    },
  };
}

export const readInbox = () => { try { return JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { return []; } };

// Grava na caixa deste navegador e, se a ☁️ nuvem estiver conectada, na caixa da nuvem (qualquer aparelho
// com o app de apostas sincronizado registra). Devolve se a nuvem recebeu (false: ficou só aqui).
export async function sendEntry(item) {
  const box = readInbox();
  box.push(item);
  localStorage.setItem(INBOX_KEY, JSON.stringify(box));
  return toCloud([item]);
}

// Manda à nuvem e marca no item local que chegou lá (cloud: true), para não reenviar depois.
async function toCloud(items) {
  let ok = false;
  try { ok = await (await import('./inbox.js')).pushItems(items); } catch { ok = false; }
  if (ok) {
    const ids = new Set(items.map(i => i.id));
    localStorage.setItem(INBOX_KEY, JSON.stringify(readInbox().map(i => (ids.has(i.id) ? { ...i, cloud: true } : i))));
  }
  return ok;
}

// Envios deste navegador que não chegaram à nuvem (sem conexão na hora): tenta de novo. Só os do
// formato novo (v 2); itens antigos da caixa ficam como estão.
export const retryCloud = () => {
  const pend = readInbox().filter(i => i.v === 2 && !i.cloud);
  return pend.length ? toCloud(pend) : Promise.resolve(true);
};

// Mesma linha, mesma casa, enviada há menos de 30 min: provável clique duplo.
export const sentRecently = (fxId, lineId, casa) => readInbox().some(i => i.analise?.fixtureId === fxId && i.analise?.lineId === lineId
  && key(i.casa) === key(casa) && Date.now() - Date.parse(i.createdAt) < 30 * 60e3);
