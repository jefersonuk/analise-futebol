// Formulário "➕ Entrar": escolhe a casa e manda a aposta para o app de apostas de valor. A stake é
// digitada na moeda da casa (R$, US$ ou €, como está no app de apostas) e enviada também em R$, que é
// como o app de apostas guarda. Sugestão de stake: a do Modelo F (em R$) convertida pela cotação dele.

import { BETS_URL, SYMBOL, betsApp, buildEntry, retryCloud, sendEntry, sentRecently } from './entry.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const hour = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const cash = (v, cur = 'BRL') => `${SYMBOL[cur] || cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// getLine(id): linha da análise aberta; getFixture(): jogo da análise aberta.
export function initEntry({ getLine, getFixture }) {
  let entry = null;   // { line, fx, houses, rates, stakeBRL, btn, confirmDup }

  const house = () => {
    const v = $('#enHouse').value;
    if (v === 'other') return { name: $('#enHouseOther').value.trim(), currency: $('#enCur').value, value: null };
    return entry.houses[Number(v)];
  };
  const rateOf = cur => entry.rates[cur] ?? null;

  // Moeda do formulário segue a casa; a stake sugerida (Modelo F, em R$) é convertida para ela.
  function syncCurrency(resetStake) {
    const h = house(), cur = h?.currency || 'BRL';
    $('#enCurWrap').hidden = $('#enHouse').value !== 'other';
    $('#enStakeLabel').textContent = `Stake (${SYMBOL[cur] || cur})`;
    if (resetStake) {
      const r = rateOf(cur);
      $('#enStake').value = r ? Math.round(entry.stakeBRL / r) : '';
    }
    check();
  }

  function check() {
    const { line } = entry, odd = parseFloat($('#enOdd').value), stake = parseFloat($('#enStake').value), h = house();
    const cur = h?.currency || 'BRL', r = rateOf(cur), out = [];
    if (odd > 1) {
      const evv = line.p_blend * odd - 1;
      out.push(`EV nessa odd: <b class="${evv > 0 ? 'pos' : 'neg'}">${(evv * 100).toFixed(1).replace('.', ',')}%</b> (acerto ${pct(line.p_blend)})`);
      if (odd < line.odd_min) out.push(`<span class="neg">Abaixo da odd mínima ${num(line.odd_min)}: a margem de segurança some.</span>`);
      if (odd < 1.5) out.push('<span class="neg">Fora do seu núcleo (odd abaixo de 1,50).</span>');
    }
    if (stake > 0 && cur !== 'BRL') out.push(r ? `<span class="muted">= ${cash(stake * r)} na cotação do app de apostas (${cash(r)} por ${SYMBOL[cur]})</span>`
      : `<span class="neg">Sem cotação de ${cur} no app de apostas: abra o app de apostas uma vez para ele buscar.</span>`);
    out.push(`<span class="muted">Stake do Modelo F: ${cash(entry.stakeBRL)}${cur !== 'BRL' && r ? ` = ${cash(entry.stakeBRL / r, cur)}` : ''}.</span>`);
    if (h?.value != null && stake > h.value) out.push(`<span class="neg">Stake maior que o saldo da casa (${cash(h.value, cur)}).</span>`);
    if (h?.limited) out.push('<span class="neg">Casa marcada como limitada no app de apostas.</span>');
    if (h?.name && sentRecently(entry.fx.id, line.id, h.name)) out.push('<span class="neg">Você já enviou esta linha nesta casa há pouco. Enviar de novo registra outra aposta.</span>');
    $('#enCheck').innerHTML = out.join('<br>');
  }

  function say(text, err = false) {
    const el = $('#enMsg');
    el.hidden = false;
    el.innerHTML = text;
    el.classList.toggle('err', err);
  }

  // ctx: { line, fx, btn } quando a linha vem de fora da análise aberta (varredura do dia).
  function open(id, odd = null, ctx = null) {
    const line = ctx?.line || getLine(id), app = betsApp(), fx = ctx?.fx || getFixture();
    if (!line || !fx) return;
    entry = { line, fx, houses: app.houses, rates: app.rates, stakeBRL: app.stake ?? line.entry_brl, btn: ctx?.btn, confirmDup: false };
    $('#enTitle').textContent = `${line.market}: ${line.line}`;
    $('#enGame').textContent = `${fx.home.name} x ${fx.away.name} · ${fx.league.name} · ${hour(fx.t)}`;
    $('#enFacts').innerHTML = [
      ['Consistência', `${line.tier} · acerta ${pct(line.p_blend)}`],
      ['Preço justo', num(line.fair_odd_blend)],
      ['Odd mínima', `<b>${num(line.odd_min)}</b>`],
      ['Pinnacle', line.pinnacle_odd ? num(line.pinnacle_odd) : 'sem odd (modelo ancorado)'],
    ].map(([k, v]) => `<span class="muted">${k}</span><span>${v}</span>`).join('');
    $('#enHouse').innerHTML = app.houses.map((h, i) => `<option value="${i}">${esc(h.name)} — ${cash(h.value, h.currency)}${h.limited ? ' · ⊘ limitada' : ''}</option>`).join('')
      + '<option value="other">Outra casa…</option>';
    $('#enHouseOther').hidden = app.houses.length > 0;
    if (!app.houses.length) $('#enHouse').value = 'other';
    $('#enOdd').value = (odd || line.odd_min).toFixed(2);
    $('#enMsg').hidden = true;
    $('#enSend').disabled = false;
    $('#enSend').textContent = 'Registrar no app de apostas';
    if (!app.found || app.houses.length < 3) say('Este navegador ainda não tem as suas casas do app de apostas. '
      + `<a href="${BETS_URL}" target="apostas">Abra o app de apostas aqui</a> e espere ele sincronizar com a nuvem; depois reabra este formulário. `
      + 'Se registrar agora, a aposta fica aguardando no app de apostas até a casa existir lá.', true);
    syncCurrency(true);
    $('#entryDlg').showModal();
  }

  $('#enHouse').onchange = () => { $('#enHouseOther').hidden = $('#enHouse').value !== 'other'; entry.confirmDup = false; syncCurrency(true); };
  $('#enCur').onchange = () => syncCurrency(true);
  for (const id of ['#enOdd', '#enStake', '#enHouseOther']) $(id).oninput = check;
  $('#enCancel').onclick = () => $('#entryDlg').close();

  $('#entryForm').onsubmit = async e => {
    e.preventDefault();
    const h = house(), odd = parseFloat($('#enOdd').value), stakeNat = parseFloat($('#enStake').value);
    const cur = h?.currency || 'BRL', r = rateOf(cur);
    if (!h?.name) return say('Escolha ou digite a casa.', true);
    if (!(odd > 1) || !(stakeNat > 0)) return say('Informe a odd e a stake.', true);
    if (!r) return say(`Sem cotação de ${cur}: abra o app de apostas uma vez (ele busca a cotação) e tente de novo.`, true);
    if (sentRecently(entry.fx.id, entry.line.id, h.name) && !entry.confirmDup) {
      entry.confirmDup = true;
      $('#enSend').textContent = 'Registrar outra aposta igual';
      return say('Esta linha já foi enviada nesta casa há pouco. Se é mesmo uma segunda aposta, toque de novo.', true);
    }
    $('#enSend').disabled = true;
    const stake = Math.round(stakeNat * r * 100) / 100;
    const cloud = await sendEntry(buildEntry({ line: entry.line, fx: entry.fx, casa: h.name, currency: cur, odd, stake, stakeNat }));
    say(`Enviada ✓ ${esc(h.name)} @ ${num(odd)}, ${cash(stakeNat, cur)}${cur !== 'BRL' ? ` (${cash(stake)})` : ''}. `
      + (cloud ? 'Está na caixa da nuvem: o app de apostas de qualquer aparelho sincronizado registra ao abrir (aba ⚽ Análise). '
        : 'Ficou só na caixa deste navegador (a ☁️ nuvem não está conectada aqui): registre abrindo o app de apostas NESTE navegador. ')
      + `<a href="${BETS_URL}" target="apostas">Abrir app de apostas ↗</a>`, !cloud);
    window.open(BETS_URL, 'apostas');
    const btn = entry.btn || document.querySelector(`[data-enter="${CSS.escape(entry.line.id)}"]`);
    if (btn) { btn.textContent = '✓ Enviada'; btn.disabled = true; }
  };

  retryCloud();
  return open;
}
