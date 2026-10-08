// Formulário "➕ Entrar": escolhe a casa e manda a aposta para o app de apostas de valor. A stake é
// digitada na moeda da casa (R$, US$ ou €, como está no app de apostas) e enviada também em R$, que é
// como o app de apostas guarda. Sugestão de stake: a do Modelo F (em R$) convertida pela cotação dele.
//
// Entrada manual (✍️, ou "Minha análise" marcado no formulário): a sua análise, registrada sem as regras do
// app (piso de 60%, odd mínima, jogo difícil). Serve para um jogo da busca ou digitado e para qualquer linha
// escrita como no surebet.com ou no app. Quando o jogo é da API e o app reconhece a linha, o app de apostas
// confere o resultado sozinho (e acompanha ao vivo); senão o resultado é marcado à mão lá.

import { BETS_URL, SYMBOL, betsApp, buildEntry, retryCloud, sendEntry, sentRecently } from './entry.js';
import { HIT_IDEAL, HIT_MIN } from './consistency.js';
import { marketOfId, parseLine } from './myline.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const hour = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const cash = (v, cur = 'BRL') => `${SYMBOL[cur] || cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localInput = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const SEND = 'Registrar no app de apostas';

// Regra do Jeferson: acerto ≥ 60%, ideal 70%. Abaixo do piso a aposta não sai daqui; linha especulativa
// (pior cenário ou histórico abaixo do piso) ou odd abaixo da mínima pedem um segundo toque. Nas apostas da
// análise de 02–05/10/2026, as que passavam nessa regra acertaram 64%; as outras, 41%. A entrada manual
// não passa por essas regras.
// aposta de cenário (odd perto de 2) segue a regra de valor do cenário, não o piso de 60%
const belowFloor = line => !line.scenario && !(line.p_blend >= HIT_MIN);
const offRule = (line, odd) => [line.blocked && 'jogo difícil de analisar (só over de gols com a odd da Pinnacle)',
  line.scenario && line.conditional && `entrar se… (${line.conditions.join('; ')}) — confirmou?`,
  line.scenario && line.status === 'sem aposta' && `sem aposta pela nossa análise (${line.why_not?.[0] || 'não passa na regra'})`,
  line.tier === 'especulativa' && 'linha especulativa (pior cenário ou histórico dos times abaixo do piso)',
  odd < line.odd_min && `odd abaixo da mínima ${num(line.odd_min)}`].filter(Boolean);

// Linha digitada na entrada manual: vira id e mercado do app quando ele a reconhece; senão vai como texto.
export function manualLine(text, fx = null) {
  const t = String(text || '').trim(), p = t ? parseLine(t, { names: fx ? { home: fx.home.name, away: fx.away.name } : null }) : {};
  const id = p.id || null;
  return { id, market: (id && marketOfId(id)) || 'Entrada manual', line: t, tier: 'manual', p_blend: null, p_model: null,
    fair_odd_blend: null, odd_min: null, pinnacle_odd: null, priced_by: 'manual', fragile: false, manual: true, recognized: !!id };
}

// getLine(id): linha da análise aberta; getFixture(): jogo da análise aberta.
export function initEntry({ getLine, getFixture }) {
  // { line, fx, houses, rates, stakeBRL, btn, confirmDup, confirmOff, typedLine, typedGame }
  let entry = null;

  const house = () => {
    const v = $('#enHouse').value;
    if (v === 'other') return { name: $('#enHouseOther').value.trim(), currency: $('#enCur').value, value: null };
    return entry.houses[Number(v)];
  };
  const rateOf = cur => entry.rates[cur] ?? null;
  const manual = () => $('#enManual').checked;
  // jogo e linha que vão para o app de apostas (digitados na entrada manual, ou os da análise)
  const curFx = () => (entry.typedGame ? { id: null, t: Date.parse($('#enWhen').value) || Date.now(),
    home: { name: $('#enHome').value.trim() }, away: { name: $('#enAway').value.trim() }, league: { name: $('#enComp').value.trim() || 'Entrada manual' } } : entry.fx);
  const curLine = () => (entry.typedLine ? manualLine($('#enLine').value, curFx()) : manual() ? { ...entry.line, manual: true } : entry.line);
  const autoCheck = (fx, line) => !!(fx?.id && line?.id);

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

  // Botão de envio: só a regra do piso o desliga, e a entrada manual não tem regra.
  function syncSend() {
    const blocked = !manual() && belowFloor(entry.line);
    $('#enSend').disabled = blocked;
    $('#enSend').textContent = blocked ? 'Abaixo de 60% de acerto' : entry.confirmDup ? 'Registrar outra aposta igual' : SEND;
  }

  function check() {
    const line = curLine(), fx = curFx(), odd = parseFloat($('#enOdd').value), stake = parseFloat($('#enStake').value), h = house();
    const cur = h?.currency || 'BRL', r = rateOf(cur), out = [];
    if (entry.typedLine) {
      $('#enLineMsg').innerHTML = !line.line ? 'Escreva a linha como no surebet.com ou no app.'
        : line.recognized ? `Reconhecida: <b>${esc(line.market)}</b>.` : 'O app não reconheceu esta linha: ela vai como texto.';
    }
    if (manual()) {
      out.push('<span class="muted"><b>Entrada manual</b>: vai para o app de apostas sem as regras do app (piso de 60%, odd mínima, jogo difícil). '
        + (autoCheck(fx, line) ? 'O app de apostas acompanha o jogo ao vivo e confere o resultado sozinho.'
          : 'Sem jogo da API ou sem linha reconhecida: o resultado é marcado à mão no app de apostas.') + '</span>');
    } else if (belowFloor(line)) out.push(`<span class="neg"><b>Acerta ${pct(line.p_blend)}: abaixo do piso de 60%.</b> Esta linha não entra (marque "Minha análise" para registrar mesmo assim).</span>`);
    else if (line.blocked) out.push('<span class="neg">Jogo difícil de analisar (base/reservas ou ligas diferentes): aqui só over de gols com a odd da Pinnacle.</span>');
    else if (line.scenario) out.push(`<span class="muted"><b>Nossa análise</b>: nossa ${pct(line.p_nossa)}${line.p_pinnacle != null ? ` · Pinnacle ${pct(line.p_pinnacle)} (${line.diff_pp >= 0 ? '+' : ''}${Math.round(line.diff_pp)} pp: ${esc(line.why)})` : ''}`
      + `${line.contra ? ' · <b>contra a Pinnacle</b>' : ''}${line.conditional ? ` — <span class="neg">entrar se: ${esc(line.conditions.join('; '))}</span>`
        : line.status === 'sem aposta' ? ` — <span class="neg">sem aposta: ${esc(line.why_not.join('; '))}</span>` : ''}.</span>`);
    else if (line.tier === 'especulativa') out.push('<span class="neg">Linha especulativa: o pior cenário ou o histórico dos times fica abaixo do piso de 60%.</span>');
    else if (line.p_blend < HIT_IDEAL) out.push('<span class="muted">Acerto acima do piso (60%) e abaixo do ideal (70%).</span>');
    if (odd > 1 && line.p_blend != null) {
      const evv = line.p_blend * odd - 1;
      out.push(`EV nessa odd ${line.scenario ? 'pela nossa análise' : 'pelo modelo'}: <b class="${evv > 0 ? 'pos' : 'neg'}">${(evv * 100).toFixed(1).replace('.', ',')}%</b> (acerto ${pct(line.p_blend)})`);
      if (!manual() && odd < line.odd_min) out.push(`<span class="neg">Abaixo da odd mínima ${num(line.odd_min)}: a margem de segurança some.</span>`);
      if (!manual() && odd < 1.5) out.push('<span class="neg">Fora do seu núcleo (odd abaixo de 1,50).</span>');
    }
    if (stake > 0 && cur !== 'BRL') out.push(r ? `<span class="muted">= ${cash(stake * r)} na cotação do app de apostas (${cash(r)} por ${SYMBOL[cur]})</span>`
      : `<span class="neg">Sem cotação de ${cur} no app de apostas: abra o app de apostas uma vez para ele buscar.</span>`);
    out.push(`<span class="muted">Stake do Modelo F: ${cash(entry.stakeBRL)}${cur !== 'BRL' && r ? ` = ${cash(entry.stakeBRL / r, cur)}` : ''}.</span>`);
    if (h?.value != null && stake > h.value) out.push(`<span class="neg">Stake maior que o saldo da casa (${cash(h.value, cur)}).</span>`);
    if (h?.limited) out.push('<span class="neg">Casa marcada como limitada no app de apostas.</span>');
    if (h?.name && autoCheck(fx, line) && sentRecently(fx.id, line.id, h.name)) out.push('<span class="neg">Você já enviou esta linha nesta casa há pouco. Enviar de novo registra outra aposta.</span>');
    $('#enCheck').innerHTML = out.join('<br>');
  }

  // Aviso no rodapé da página (a caixa já fechou), some sozinho.
  let toastTimer = null;
  function toast(html, err = false) {
    const el = $('#toast');
    el.innerHTML = html;
    el.classList.toggle('err', err);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, err ? 12000 : 7000);
  }

  function say(text, err = false) {
    const el = $('#enMsg');
    el.hidden = false;
    el.innerHTML = text;
    el.classList.toggle('err', err);
  }

  // Parte comum da abertura: casas, odd, avisos e a caixa na tela.
  function show(app, odd) {
    $('#enHouse').innerHTML = app.houses.map((h, i) => `<option value="${i}">${esc(h.name)} — ${cash(h.value, h.currency)}${h.limited ? ' · ⊘ limitada' : ''}</option>`).join('')
      + '<option value="other">Outra casa…</option>';
    $('#enHouseOther').hidden = app.houses.length > 0;
    if (!app.houses.length) $('#enHouse').value = 'other';
    $('#enOdd').value = odd > 1 ? odd.toFixed(2) : '';
    $('#enMsg').hidden = true;
    syncSend();
    if (!app.found || app.houses.length < 3) say('Este navegador ainda não tem as suas casas do app de apostas. '
      + `<a href="${BETS_URL}" target="apostas">Abra o app de apostas aqui</a> e espere ele sincronizar com a nuvem; depois reabra este formulário. `
      + 'Se registrar agora, a aposta fica aguardando no app de apostas até a casa existir lá.', true);
    syncCurrency(true);
    $('#entryDlg').showModal();
  }

  // ctx: { line, fx, btn } quando a linha vem de fora da análise aberta (varredura do dia).
  function open(id, odd = null, ctx = null) {
    const line = ctx?.line || getLine(id), app = betsApp(), fx = ctx?.fx || getFixture();
    if (!line || !fx) return;
    entry = { line, fx, houses: app.houses, rates: app.rates, stakeBRL: app.stake ?? line.entry_brl, btn: ctx?.btn, confirmDup: false, confirmOff: false,
      typedLine: false, typedGame: false };
    $('#enTitle').textContent = `${line.market}: ${line.line}`;
    $('#enGame').textContent = `${fx.home.name} x ${fx.away.name} · ${fx.league.name} · ${hour(fx.t)}`;
    $('#enFacts').hidden = false;
    $('#enFacts').innerHTML = [
      line.scenario ? ['Nossa análise', `${line.status === 'entrar se' ? 'entrar se…' : line.status} · nossa ${pct(line.p_nossa)} <span class="muted">(Pinnacle ${line.p_pinnacle != null ? pct(line.p_pinnacle) : '—'}; ${esc(line.why)})</span>${line.contra ? ' · <b>contra a Pinnacle</b>' : ''}`]
        : ['Consistência', `${line.tier} · acerta ${pct(line.p_blend)} <span class="muted">(piso 60%, ideal 70%)</span>`],
      ['Preço justo', num(line.fair_odd_blend)],
      ['Odd mínima', `<b>${num(line.odd_min)}</b>`],
      line.combo ? ['Pernas separadas', `${num(line.odd_indep)} <span class="muted">(produto das justas; a Pinnacle não cota combos — a chance sai da matriz de placares dela)</span>`]
        : ['Pinnacle', line.pinnacle_odd ? num(line.pinnacle_odd) : line.derived ? 'não cota esta linha (derivada do total dela)' : 'sem odd (modelo ancorado)'],
    ].map(([k, v]) => `<span class="muted">${k}</span><span>${v}</span>`).join('');
    $('#enManual').checked = false;
    $('#enManual').disabled = false;
    $('#enFree').hidden = true;
    $('#enLineWrap').hidden = true;
    show(app, odd || line.odd_min);
  }

  // Entrada manual: fx = jogo da busca (ou null: o jogo é digitado); a linha é sempre digitada.
  function openManual({ fx = null } = {}) {
    const app = betsApp();
    entry = { line: null, fx, houses: app.houses, rates: app.rates, stakeBRL: app.stake ?? 300, btn: null, confirmDup: false, confirmOff: false,
      typedLine: true, typedGame: !fx };
    $('#enTitle').textContent = '✍️ Entrada manual';
    $('#enGame').textContent = fx ? `${fx.home.name} x ${fx.away.name} · ${fx.league.name} · ${hour(fx.t)}` : 'Jogo fora da busca: digite os times, a competição e o horário.';
    $('#enFacts').hidden = true;
    $('#enManual').checked = true;
    $('#enManual').disabled = true;
    $('#enFree').hidden = !!fx;
    if (!fx) { for (const k of ['#enHome', '#enAway', '#enComp']) $(k).value = ''; $('#enWhen').value = localInput(Date.now()); }
    $('#enLineWrap').hidden = false;
    $('#enLine').value = '';
    show(app, null);
    $(fx ? '#enLine' : '#enHome').focus();
  }

  $('#enHouse').onchange = () => { $('#enHouseOther').hidden = $('#enHouse').value !== 'other'; entry.confirmDup = false; syncCurrency(true); };
  $('#enCur').onchange = () => syncCurrency(true);
  for (const id of ['#enOdd', '#enStake', '#enHouseOther', '#enLine', '#enHome', '#enAway', '#enComp', '#enWhen']) $(id).oninput = check;
  // outra odd: a confirmação de "fora da regra" vale só para a odd que foi mostrada
  $('#enOdd').oninput = () => {
    if (entry.confirmOff) { entry.confirmOff = false; syncSend(); }
    check();
  };
  $('#enManual').onchange = () => { entry.confirmOff = false; syncSend(); check(); };
  $('#enCancel').onclick = () => $('#entryDlg').close();

  $('#entryForm').onsubmit = async e => {
    e.preventDefault();
    if (e.submitter && e.submitter.id !== 'enSend') return;   // só o botão Registrar envia
    const h = house(), odd = parseFloat($('#enOdd').value), stakeNat = parseFloat($('#enStake').value);
    const cur = h?.currency || 'BRL', r = rateOf(cur), fx = curFx(), line = curLine();
    if (entry.typedGame && (!fx.home.name || !fx.away.name)) return say('Digite o mandante e o visitante.', true);
    if (entry.typedLine && !line.line) return say('Escreva a linha (ex.: Mais de 9,5 escanteios).', true);
    if (!h?.name) return say('Escolha ou digite a casa.', true);
    if (!(odd > 1) || !(stakeNat > 0)) return say('Informe a odd e a stake.', true);
    if (!r) return say(`Sem cotação de ${cur}: abra o app de apostas uma vez (ele busca a cotação) e tente de novo.`, true);
    if (!manual()) {
      if (belowFloor(line)) return say(`Acerta ${pct(line.p_blend)}: abaixo do piso de 60%. Esta linha não entra (marque "Minha análise" para registrar mesmo assim).`, true);
      const off = offRule(line, odd);
      if (off.length && !entry.confirmOff) {
        entry.confirmOff = true;
        $('#enSend').textContent = 'Registrar fora da regra';
        return say(`Fora da regra: ${off.join(' e ')}. Se é isso mesmo, toque de novo.`, true);
      }
    }
    if (autoCheck(fx, line) && sentRecently(fx.id, line.id, h.name) && !entry.confirmDup) {
      entry.confirmDup = true;
      $('#enSend').textContent = 'Registrar outra aposta igual';
      return say('Esta linha já foi enviada nesta casa há pouco. Se é mesmo uma segunda aposta, toque de novo.', true);
    }
    $('#enSend').disabled = true;
    const stake = Math.round(stakeNat * r * 100) / 100;
    const cloud = await sendEntry(buildEntry({ line, fx, casa: h.name, currency: cur, odd, stake, stakeNat }));
    $('#entryDlg').close();
    toast(`Enviada ✓ ${line.manual ? '✍️ ' : ''}${esc(line.market)}: ${esc(line.line)} · ${esc(h.name)} @ ${num(odd)}, ${cash(stakeNat, cur)}${cur !== 'BRL' ? ` (${cash(stake)})` : ''}. `
      + (cloud ? 'O app de apostas de qualquer aparelho sincronizado registra (aba ⚽ Análise). '
        : 'Ficou só neste navegador (☁️ nuvem não conectada aqui): registre abrindo o app de apostas NESTE navegador. ')
      + `<a href="${BETS_URL}" target="apostas">Abrir app de apostas ↗</a>`, !cloud);
    window.open(BETS_URL, 'apostas');
    const btn = entry.btn || (line.id && document.querySelector(`[data-enter="${CSS.escape(line.id)}"]`));
    if (btn) { btn.textContent = '✓ Enviada'; btn.disabled = true; }
  };

  retryCloud();
  open.manual = openManual;
  return open;
}
