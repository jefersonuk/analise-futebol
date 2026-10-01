// Entrada numa linha da análise. Os dois apps estão no mesmo endereço (jefersonuk.github.io), então
// dividem o localStorage: daqui lemos as casas e a stake do app de apostas, e mandamos a aposta para a
// caixa de entrada dele. Quem grava a aposta é o próprio app de apostas (dono do estado e do sync),
// ao abrir ou ao voltar para a aba — assim nada daqui sobrescreve o que ele tem em memória.

export const BETS_KEY = 'apostasValor_v1';
export const INBOX_KEY = 'apostasInbox_v1';
export const BETS_URL = '../apostas-dados/#analise';

const BANKS = new Set(['binance', 'pipay', 'metamask', 'nubank', 'inter', 'itaú', 'bradesco', 'banestes', 'c6', 'picpay',
  'mercado pago', 'coinbase', 'bybit', 'trust wallet']);
const key = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Casas (sem bancos e carteiras), saldo e stake do Modelo F do app de apostas.
export function betsApp() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(BETS_KEY)); } catch { /* sem dados */ }
  if (!st) return { found: false, houses: [], stake: null };
  const lim = (st.cfg?.casasLimitadas || []).map(key).filter(Boolean);
  const houses = (st.balances || [])
    .filter(b => b.name && !BANKS.has(b.name.trim().toLowerCase()))
    .map(b => ({ name: b.name.trim(), value: Number(b.value) || 0, currency: b.currency || 'BRL',
      limited: lim.some(l => key(b.name) === l || key(b.name).startsWith(l)) }))
    .sort((a, b) => a.limited - b.limited || b.value - a.value);
  return { found: true, houses, stake: st.cfg?.modelo?.stake > 0 ? st.cfg.modelo.stake : 300 };
}

const MARKET = {
  'Total de gols': 'Total de Gols', 'Handicap asiático': 'Handicap Asiático', '1X2': '1X2 / Resultado',
  'Ambas marcam': 'Ambas Marcam', 'Total de escanteios': 'Escanteios', 'Escanteios por time': 'Escanteios',
  'Total escanteios 1T': 'Escanteios', 'Handicap escanteios 1T': 'Escanteios', 'Handicap de escanteios': 'Escanteios',
  'Resultado escanteios': 'Escanteios', 'Resultado escanteios 1T': 'Escanteios', 'Corrida de escanteios': 'Escanteios', 'Total de chutes': 'Total de Chutes',
  'Total de chutes no gol': 'Total de Chutes',
};

const localStr = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };

// line: linha do dossiê; fx: jogo. Formato que o app de apostas grava como aposta de valor.
export function buildEntry({ line, fx, casa, currency, odd, stake }) {
  return {
    id: `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString(),
    casa, cur: currency || 'BRL', odd, stake, sport: 'Futebol', market: MARKET[line.market] || line.market,
    event: `${fx.home.name} x ${fx.away.name} — ${line.market}: ${line.line}`, date: localStr(fx.t),
    oddMkt: line.fair_odd_blend, prob: line.p_blend,
    analise: {
      fixtureId: fx.id, kickoff: new Date(fx.t).toISOString(), home: fx.home.name, away: fx.away.name,
      competition: fx.league.name, lineId: line.id, mercado: line.market, linha: line.line, tier: line.tier,
      p_model: line.p_model, p_blend: line.p_blend, p_pinnacle: line.p_pinnacle ?? null,
      fair_odd: line.fair_odd_blend, odd_min: line.odd_min, pinnacle_odd: line.pinnacle_odd ?? null,
      priced_by: line.priced_by, fragile: !!line.fragile,
    },
  };
}

export function sendEntry(item) {
  let box = [];
  try { box = JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { /* caixa corrompida: recomeça */ }
  box.push(item);
  localStorage.setItem(INBOX_KEY, JSON.stringify(box));
  return box.length;
}
