// Formulário "➕ Entrar": escolhe a casa e manda a aposta para o app de apostas de valor. A stake é
// digitada na moeda da casa (R$, US$ ou €, como está no app de apostas) e enviada também em R$, que é
// como o app de apostas guarda. Stake sugerida: a entrada da aposta (stake.js: 20 € a favor da Pinnacle e 10 € contra,
// Jeferson, 14/10/2026) convertida para a moeda da casa pela cotação do app de apostas; a casa principal (Sportmarket)
// vem primeiro e escolhida.
//
// "Minha análise" marcado no formulário: a linha da análise registrada sem as regras do app (piso de 60%, odd mínima,
// jogo difícil). ✍️ Aposta manual (ticket.js): o bilhete feito fora da análise, em pernas — cada uma um jogo (da lista do
// dia da API ou digitado) e uma linha escrita como na casa —: simples, múltipla de vários jogos ou no mesmo jogo. Perna
// com jogo da API e linha reconhecida, o app de apostas confere sozinho (e acompanha ao vivo); as outras, à mão lá.

import { BETS_URL, SYMBOL, betsApp, buildEntry, retryCloud, sendEntry, sentRecently } from './entry.js';
import { HIT_IDEAL, HIT_MIN, floorOf } from './consistency.js';
import { CONTRA_SHARE, STAKE, isContra, money, stakeOf } from './stake.js';
import { marketOfId, parseLine } from './myline.js';
import { buildTicket, gameKey, legOf, legsOdd, pickMatches, quickLines, splitLegs, ticketKind } from './ticket.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));
const hour = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const cash = (v, cur = 'BRL') => `${SYMBOL[cur] || cur} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localInput = t => { const d = new Date(t); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const SEND = 'Registrar no app de apostas';

// Regra do Jeferson: acerto ≥ 60%, ideal 70%. Abaixo do piso a aposta não sai daqui; linha especulativa
// (pior cenário ou histórico abaixo do piso) ou odd abaixo da mínima pedem um segundo toque. Nas apostas da
// análise de 02–05/10/2026, as que passavam nessa regra acertaram 64%; as outras, 41%. A entrada manual
// não passa por essas regras.
// aposta de cenário (odd perto de 2) segue a regra de valor do cenário, não o piso de 60%; as do favorito no plano (a
// vitória dele + gols e a vitória no 1º tempo, perto de 2) seguem a regra delas (plan.js); a da simulação sem a análise
// guardada (from_sim), a do plano em que entrou
const belowFloor = line => !line.scenario && !line.multi && !line.fav && !line.from_sim && !(line.p_blend >= HIT_MIN);
const offRule = (line, odd) => [line.blocked && 'jogo difícil de analisar (só over de gols com a odd da Pinnacle)',
  line.scenario && line.conditional && `entrar se… (${line.conditions.join('; ')}) — confirmou?`,
  line.scenario && line.status === 'sem aposta' && `sem aposta pela nossa análise (${line.why_not?.[0] || 'não passa na regra'})`,
  line.tier === 'especulativa' && 'linha especulativa (pior cenário ou histórico dos times abaixo do piso)',
  odd < line.odd_min && `odd abaixo da mínima ${num(line.odd_min)}`].filter(Boolean);

// Uma linha digitada (sem a lista de pernas): vira id e mercado do app quando ele a reconhece; senão vai como texto.
export function manualLine(text, fx = null) {
  const t = String(text || '').trim(), p = t ? parseLine(t, { names: fx ? { home: fx.home.name, away: fx.away.name } : null, settle: true }) : {};
  const id = p.id || null;
  return { id, market: (id && marketOfId(id)) || 'Entrada manual', line: t, tier: 'manual', p_blend: null, p_model: null,
    fair_odd_blend: null, odd_min: null, pinnacle_odd: null, priced_by: 'manual', fragile: false, manual: true, recognized: !!id };
}

const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dayStr = off => new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE');   // AAAA-MM-DD no fuso local
const STATUS = { '1H': '🔴 1º tempo', HT: '⏸ intervalo', '2H': '🔴 2º tempo', ET: '🔴 prorrogação', P: '🔴 pênaltis', FT: 'encerrado', AET: 'encerrado',
  PEN: 'encerrado', PST: 'adiado', CANC: 'cancelado', SUSP: 'suspenso', INT: 'interrompido' };
const KIND = { simples: 'simples', 'mesmo jogo': 'no mesmo jogo', 'múltipla': 'múltipla' };

// getLine(id): linha da análise aberta; getFixture(): jogo da análise aberta; dayAll(data): os jogos de uma data (api.js),
// para a ✍️ aposta manual achar o jogo de cada perna (1 requisição por data, guardada 10 min).
export function initEntry({ getLine, getFixture, dayAll = null }) {
  // { line, fx, houses, rates, stakeBRL, btn, confirmDup, confirmOff, ticket, legs, game }
  let entry = null;

  const house = () => {
    const v = $('#enHouse').value;
    if (v === 'other') return { name: $('#enHouseOther').value.trim(), currency: $('#enCur').value, value: null };
    return entry.houses[Number(v)];
  };
  const rateOf = cur => entry.rates[cur] ?? null;
  const manual = () => entry.ticket || $('#enManual').checked;
  // a linha que vai para o app de apostas (a da análise; "Minha análise" marcada, como manual); no bilhete manual, nenhuma
  const curLine = () => (entry.ticket ? null : manual() ? { ...entry.line, manual: true } : entry.line);
  const autoCheck = (fx, line) => !!(fx?.id && line?.id);

  // A entrada da aposta (20 € a favor da Pinnacle, 10 € contra) na moeda da casa: pela cotação do app de apostas (R$ por € e
  // por US$); sem a cotação do euro, numa casa que não é em euro, a stake do Modelo F convertida (como antes; metade contra).
  const stakeIn = cur => {
    const line = curLine(), v0 = stakeOf(line);
    if (cur === STAKE.cur) return v0;
    const rs = rateOf(STAKE.cur), r = rateOf(cur);
    if (rs && r) { const v = v0 * rs / r; return cur === 'BRL' ? Math.round(v) : Math.round(v * 100) / 100; }
    return r ? Math.round(entry.stakeBRL * (isContra(line) ? CONTRA_SHARE : 1) / r) : '';
  };
  // Moeda do formulário segue a casa; a stake sugerida é a entrada da aposta convertida para ela.
  function syncCurrency(resetStake) {
    const h = house(), cur = h?.currency || 'BRL';
    $('#enCurWrap').hidden = $('#enHouse').value !== 'other';
    $('#enStakeLabel').textContent = `Stake (${SYMBOL[cur] || cur})`;
    if (resetStake) $('#enStake').value = stakeIn(cur);
    check();
  }

  // Botão de envio: só a regra do piso o desliga, e a entrada manual não tem regra.
  function syncSend() {
    const blocked = !manual() && belowFloor(entry.line);
    $('#enSend').disabled = blocked;
    $('#enSend').textContent = blocked ? 'Abaixo de 60% de acerto' : entry.confirmDup ? 'Registrar outra aposta igual' : SEND;
  }

  // a stake na moeda da casa, em R$, o saldo e a casa limitada (os dois formulários)
  function moneyChecks(out, { stake, cur, r, h }) {
    if (stake > 0 && cur !== 'BRL') out.push(r ? `<span class="muted">= ${cash(stake * r)} na cotação do app de apostas (${cash(r)} por ${SYMBOL[cur]})</span>`
      : `<span class="neg">Sem cotação de ${cur} no app de apostas: abra o app de apostas uma vez para ele buscar.</span>`);
    if (h?.value != null && stake > h.value) out.push(`<span class="neg">Stake maior que o saldo da casa (${cash(h.value, cur)}).</span>`);
    if (h?.limited) out.push('<span class="neg">Casa marcada como limitada no app de apostas.</span>');
  }

  function check() {
    const odd = parseFloat($('#enOdd').value), stake = parseFloat($('#enStake').value), h = house();
    const cur = h?.currency || 'BRL', r = rateOf(cur), out = [];
    if (entry.ticket) {
      lineMsg();
      const legs = entry.legs, auto = legs.filter(l => l.auto).length, kind = ticketKind(legs), prod = legsOdd(legs);
      if (!legs.length) out.push('<span class="muted">Escolha o jogo, escreva a linha (ou toque nos atalhos) e toque em <b>Pôr no bilhete</b>; repita para cada perna.</span>');
      else out.push(`<span class="muted"><b>${kind === 'simples' ? 'Simples' : kind === 'mesmo jogo' ? `No mesmo jogo: ${legs.length} linhas` : `Múltipla: ${legs.length} pernas em ${new Set(legs.map(gameKey)).size} jogos`}</b> · `
        + (auto === legs.length ? 'o app de apostas confere o resultado sozinho e acompanha ao vivo.'
          : `${legs.length - auto} perna${legs.length - auto > 1 ? 's' : ''} sem conferência automática (jogo fora da lista ou linha não reconhecida): o resultado ${auto ? 'dessas pernas ' : ''}é marcado à mão no app de apostas.`) + '</span>');
      // a odd total pelas pernas (o produto) e o retorno
      if (prod && legs.length > 1) out.push(`<span class="muted">Odd das pernas: ${legs.map(l => num(l.odd_casa)).join(' × ')} = <b>${num(prod)}</b>${odd > 1 && Math.abs(odd - prod) > 0.011 ? ` <span class="neg">(a odd total digitada é ${num(odd)})</span>` : ''}</span>`);
      if (odd > 1 && stake > 0) out.push(`<span class="muted">Se der green: <b class="pos">${cash(stake * odd, cur)}</b> (lucro ${cash(stake * (odd - 1), cur)})</span>`);
      moneyChecks(out, { stake, cur, r, h });
      $('#enCheck').innerHTML = out.join('<br>');
      return;
    }
    const line = curLine(), fx = entry.fx;
    if (manual()) {
      out.push('<span class="muted"><b>Minha análise</b>: vai para o app de apostas sem as regras do app (piso de 60%, odd mínima, jogo difícil). '
        + (autoCheck(fx, line) ? 'O app de apostas acompanha o jogo ao vivo e confere o resultado sozinho.'
          : 'Sem jogo da API ou sem linha reconhecida: o resultado é marcado à mão no app de apostas.') + '</span>');
    } else if (belowFloor(line)) out.push(`<span class="neg"><b>Acerta ${pct(line.p_blend)}: abaixo do piso de 60%.</b> Esta linha não entra (marque "Minha análise" para registrar mesmo assim).</span>`);
    else if (line.blocked) out.push('<span class="neg">Jogo difícil de analisar (base/reservas ou ligas diferentes): aqui só over de gols com a odd da Pinnacle.</span>');
    else if (line.multi) out.push(`<span class="muted"><b>Múltipla de ${line.legs.length} perna${line.legs.length > 1 ? 's' : ''}</b>: ${line.asian ? 'não perde nenhuma' : 'acerta todas'} em ${pct(line.p_blend)} (Pinnacle ${pct(line.p_pinnacle)})${line.asian ? '; perna asiática com 2 gols devolve ou paga meia' : ''}. Uma perna perdida perde tudo; entrada pequena (até 0,5% da banca).</span>`);
    else if (line.scenario) out.push(`<span class="muted"><b>Nossa análise</b>: nossa ${pct(line.p_nossa)}${line.p_pinnacle != null ? ` · Pinnacle ${pct(line.p_pinnacle)} (${line.diff_pp >= 0 ? '+' : ''}${Math.round(line.diff_pp)} pp: ${esc(line.why)})` : ''}`
      + `${line.contra ? ' · <b>contra a Pinnacle</b>' : ''}${line.conditional ? ` — <span class="neg">entrar se: ${esc(line.conditions.join('; '))}</span>`
        : line.status === 'sem aposta' ? ` — <span class="neg">sem aposta: ${esc(line.why_not.join('; '))}</span>` : ''}.</span>`);
    else if (line.from_sim) out.push('<span class="muted"><b>Da simulação</b>: a análise deste jogo não está mais guardada neste aparelho — a chance é a da hora do plano; o app de apostas confere o resultado.</span>');
    else if (line.tier === 'especulativa') out.push('<span class="neg">Linha especulativa: o pior cenário ou o histórico dos times fica abaixo do piso de 60%.</span>');
    else if (line.p_blend < HIT_IDEAL) out.push('<span class="muted">Acerto acima do piso (60%) e abaixo do ideal (70%).</span>');
    if (odd > 1 && line.p_blend != null) {
      const evv = line.p_blend * odd - 1;
      out.push(`EV nessa odd ${line.multi ? 'pela chance do bilhete' : line.scenario ? 'pela nossa análise' : 'pelo modelo'}: <b class="${evv > 0 ? 'pos' : 'neg'}">${(evv * 100).toFixed(1).replace('.', ',')}%</b> (acerto ${pct(line.p_blend)})`);
      if (!manual() && odd < line.odd_min) out.push(`<span class="neg">Abaixo da odd mínima ${num(line.odd_min)}: a margem de segurança some.</span>`);
      if (!manual() && !line.multi && odd < floorOf(line.market)) out.push(`<span class="neg">Fora do seu núcleo (odd abaixo de ${num(floorOf(line.market))}).</span>`);
    }
    moneyChecks(out, { stake, cur, r, h });
    const v0 = stakeOf(line);
    out.push(`<span class="muted">${isContra(line) ? `Entrada: ${money(v0)} — metade, a aposta é contra a Pinnacle` : `Entrada cheia: ${money(v0)} (contra a Pinnacle seria a metade)`}${cur !== STAKE.cur && rateOf(STAKE.cur) && r ? ` = ${cash(v0 * rateOf(STAKE.cur) / r, cur)}` : ''}${cur !== STAKE.cur && !rateOf(STAKE.cur) ? ' (sem a cotação do euro no app de apostas: a sugestão é a stake do Modelo F)' : ''}.</span>`);
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
    $('#enHouse').innerHTML = app.houses.map((h, i) => `<option value="${i}">${esc(h.name)} — ${h.missing ? `${SYMBOL[h.currency] || h.currency}, ainda sem saldo no app de apostas` : cash(h.value, h.currency)}${h.limited ? ' · ⊘ limitada' : ''}</option>`).join('')
      + '<option value="other">Outra casa…</option>';
    $('#enHouseOther').hidden = app.houses.length > 0;
    $('#enHouse').value = app.houses.length ? '0' : 'other';   // a casa principal (stake.js), primeira da lista
    $('#enOdd').value = odd > 1 ? odd.toFixed(2) : '';
    $('#enMsg').hidden = true;
    syncSend();
    if (!app.found || app.houses.filter(h => !h.missing).length < 3) say('Este navegador ainda não tem as suas casas do app de apostas. '
      + `<a href="${BETS_URL}" target="apostas">Abra o app de apostas aqui</a> e espere ele sincronizar com a nuvem; depois reabra este formulário. `
      + 'Se registrar agora, a aposta fica aguardando no app de apostas até a casa existir lá.', true);
    syncCurrency(true);
    $('#entryDlg').showModal();
  }

  // ctx: { line, fx, btn } quando a linha vem de fora da análise aberta (varredura do dia, plano, simulação).
  function open(id, odd = null, ctx = null) {
    const line = ctx?.line || getLine(id), app = betsApp(), fx = ctx?.fx || getFixture();
    if (!line || !fx) return;
    // múltipla: a entrada é a dela (pequena), não a stake do Modelo F
    entry = { line, fx, houses: app.houses, rates: app.rates, stakeBRL: line.multi ? line.entry_brl || 50 : app.stake ?? line.entry_brl, btn: ctx?.btn, confirmDup: false, confirmOff: false,
      ticket: false, legs: [], game: null };
    $('#enTitle').textContent = `${line.market}: ${line.line}`;
    $('#enGame').textContent = `${fx.home.name} x ${fx.away.name} · ${fx.league.name} · ${hour(fx.t)}`;
    $('#enFacts').hidden = false;
    $('#enFacts').innerHTML = [
      line.multi ? ['Múltipla', `${line.legs.length} perna${line.legs.length > 1 ? 's' : ''} · ${line.asian ? 'não perde nenhuma' : 'acerta todas'} em ${pct(line.p_blend)} <span class="muted">(Pinnacle ${pct(line.p_pinnacle)})</span>`]
        : line.scenario ? ['Nossa análise', `${line.status === 'entrar se' ? 'entrar se…' : line.status} · nossa ${pct(line.p_nossa)} <span class="muted">(Pinnacle ${line.p_pinnacle != null ? pct(line.p_pinnacle) : '—'}; ${esc(line.why)})</span>${line.contra ? ' · <b>contra a Pinnacle</b>' : ''}`]
        : line.from_sim ? ['Da simulação', `chance ${line.p_blend != null ? pct(line.p_blend) : '—'} <span class="muted">(Pinnacle ${line.p_pinnacle != null ? pct(line.p_pinnacle) : '—'}; a análise do jogo não está mais guardada)</span>`]
        : ['Consistência', `${line.tier} · acerta ${pct(line.p_blend)} <span class="muted">(piso 60%, ideal 70%)</span>`],
      ['Preço justo', num(line.fair_odd_blend)],
      ['Odd mínima', `<b>${num(line.odd_min)}</b>`],
      line.multi ? ['Pernas', line.legs.map(l => `${esc(l.home)} x ${esc(l.away)} ${esc(l.linha)} <span class="muted">(${pct(l.p)}, mínima ${num(l.odd_min)})</span>`).join('<br>')]
        : line.combo ? ['Pernas separadas', `${num(line.odd_indep)} <span class="muted">(produto das justas; a Pinnacle não cota combos — a chance sai da matriz de placares dela)</span>`]
        : ['Pinnacle', line.pinnacle_odd ? num(line.pinnacle_odd) : line.derived ? 'não cota esta linha (derivada do total dela)' : 'sem odd (modelo ancorado)'],
    ].map(([k, v]) => `<span class="muted">${k}</span><span>${v}</span>`).join('');
    $('#enManual').checked = false;
    $('#enManualWrap').hidden = false;
    $('#enTicket').hidden = true;
    $('#enOddLabel').textContent = 'Odd que você pegou';
    show(app, odd || line.odd_min);
  }

  // ---- ✍️ aposta manual: o bilhete em pernas (ticket.js) ----
  function renderLegs() {
    const legs = entry.legs;
    $('#enLegs').innerHTML = legs.length ? `<div class="leghead">Bilhete · ${legs.length} perna${legs.length > 1 ? 's' : ''}</div>${legs.map((l, i) => `<div class="legrow">
      <span class="legn">${i + 1}</span>
      <span class="legtxt"><b>${esc(l.linha)}</b>${l.odd_casa ? ` <span class="legodd">@ ${num(l.odd_casa)}</span>` : ''} <span class="muted small">${esc(l.mercado)}</span><br><span class="muted small">${hour(Date.parse(l.kickoff))} · ${esc(l.home)} x ${esc(l.away)}</span></span>
      <span class="small ${l.auto ? 'pos' : 'neg'}" title="${l.auto ? 'o app de apostas confere o resultado sozinho e acompanha ao vivo' : esc(l.error || 'jogo fora da lista da API: o resultado é marcado à mão')}">${l.auto ? '✓ automática' : '✍️ à mão'}</span>
      <button type="button" class="ghost mini" data-legx="${i}" title="Tirar a perna">✕</button></div>`).join('')}` : '';
    $('#enTitle').textContent = `✍️ Aposta manual${legs.length ? ` · ${KIND[ticketKind(legs)]}` : ''}`;
    $('#enOddLabel').textContent = legs.length > 1 ? 'Odd total do bilhete' : 'Odd que você pegou';
  }
  // o jogo da perna: o da lista do dia (com id) ou digitado (sem id); a escolha fica para as próximas pernas
  function setGame(fx) {
    entry.game = fx;
    $('#enGameNow').textContent = fx ? `${fx.home.name} x ${fx.away.name} · ${hour(fx.t)}${fx.league?.name ? ` · ${fx.league.name}` : ''}${fx.id ? '' : ' (digitado)'}` : 'escolha o jogo';
    $('#enChips').innerHTML = fx ? quickLines({ home: fx.home.name, away: fx.away.name }).map(([t, v]) => `<button type="button" class="chip" data-chip="${esc(v)}">${esc(t)}</button>`).join('') : '';
    $('#enPick').hidden = !!fx;
    $('#enPickToggle').hidden = !fx;
    lineMsg();
  }
  function openPicker() {
    $('#enPick').hidden = false;
    $('#enFree').hidden = true;
    $('#enPickQ').value = '';
    $('#enPickList').innerHTML = '';
    $('#enPickQ').focus();
  }
  // os jogos da data com o time digitado (3 letras), da lista do dia (dayAll)
  let pickSeq = 0, pickTimer = null, picked = new Map();
  async function searchPick() {
    const q = $('#enPickQ').value, date = $('#enPickDate').value, seq = ++pickSeq, list = $('#enPickList');
    if (q.trim().length < 3) { list.innerHTML = '<p class="muted small">Digite 3 letras do mandante ou do visitante.</p>'; return; }
    if (!dayAll) { list.innerHTML = '<p class="neg small">Sem a lista de jogos: digite o jogo.</p>'; return; }
    list.innerHTML = '<p class="muted small">Buscando os jogos da data…</p>';
    let all;
    try { all = await dayAll(date); } catch (e) { if (seq === pickSeq) list.innerHTML = `<p class="neg small">${esc(e.message)}</p>`; return; }
    if (seq !== pickSeq) return;
    const hits = pickMatches(all, q);
    picked = new Map(hits.map(f => [String(f.id), f]));
    list.innerHTML = hits.length ? hits.map(f => `<button type="button" class="pickfx" data-pickfx="${f.id}"><b>${hour(f.t).slice(-5)}</b> ${esc(f.home.name)} x ${esc(f.away.name)}
      <span class="muted small">· ${esc(f.league.name)}${STATUS[f.status] ? ` · ${STATUS[f.status]}` : ''}</span></button>`).join('')
      : `<p class="muted small">Nenhum jogo com "${esc(q.trim())}" nesta data: troque a data ou digite o jogo.</p>`;
  }
  // o que a linha escrita vira, perna a perna
  function lineMsg() {
    const parts = splitLegs($('#enLine').value), g = entry?.game;
    if (!parts.length) { $('#enLineMsg').innerHTML = g ? 'Escreva como na casa ou toque nos atalhos; várias linhas do mesmo jogo com " + ".' : ''; return; }
    if (!g) { $('#enLineMsg').innerHTML = '<span class="neg">Escolha o jogo da perna.</span>'; return; }
    $('#enLineMsg').innerHTML = parts.map(t => { const l = legOf(g, t); return l.lineId ? `✓ <b>${esc(l.mercado)}</b>: ${esc(l.linha)}${l.odd_casa ? ` @ ${num(l.odd_casa)}` : ''}`
      : `<span class="neg">⚠ "${esc(t)}": ${esc(l.error || 'não reconhecida')} — vai como texto e o resultado é marcado à mão</span>`; }).join('<br>');
  }
  // a odd total segue o produto das odds das pernas (quando todas têm), até você digitar outra
  function syncTotal() {
    const o = legsOdd(entry.legs);
    if (o && !entry.oddTouched) $('#enOdd').value = o.toFixed(2);
  }
  function addLegs() {
    const parts = splitLegs($('#enLine').value), odd = parseFloat($('#enLegOdd').value);
    if (!entry.game) { say('Escolha o jogo da perna.', true); return false; }
    if (!parts.length) { say('Escreva a linha da perna.', true); return false; }
    // a odd da perna vale para uma linha só (várias do mesmo jogo: a casa dá a odd do combo, que vai na odd total)
    entry.legs.push(...parts.map(t => legOf(entry.game, t, parts.length === 1 && odd > 1 ? odd : null)));
    $('#enLine').value = ''; $('#enLegOdd').value = '';
    $('#enMsg').hidden = true;
    renderLegs(); syncTotal(); check();
    $('#enLine').focus();
    return true;
  }
  // ✍️ Aposta manual: fx = o jogo da busca ou da análise aberta (o da primeira perna); legs = pernas já prontas.
  function openManual({ fx = null, legs = [] } = {}) {
    const app = betsApp();
    entry = { line: null, fx: null, houses: app.houses, rates: app.rates, stakeBRL: app.stake ?? 300, btn: null, confirmDup: false, confirmOff: false,
      ticket: true, legs: [...legs], game: null, oddTouched: false };
    $('#enGame').textContent = 'Simples, múltipla de vários jogos ou várias linhas no mesmo jogo: escolha o jogo, escreva a linha e ponha no bilhete.';
    $('#enFacts').hidden = true;
    $('#enManualWrap').hidden = true;
    $('#enTicket').hidden = false;
    $('#enPickDate').innerHTML = [[-1, 'Ontem'], [0, 'Hoje'], [1, 'Amanhã'], [2, 'Depois de amanhã']].map(([o, t]) => {
      const d = dayStr(o);
      return `<option value="${d}"${o === 0 ? ' selected' : ''}>${t} (${WEEK[new Date(`${d}T12:00:00`).getDay()]}, ${d.slice(8)}/${d.slice(5, 7)})</option>`;
    }).join('');
    for (const k of ['#enHome', '#enAway', '#enComp']) $(k).value = '';
    $('#enWhen').value = localInput(Date.now());
    $('#enLine').value = ''; $('#enLegOdd').value = '';
    renderLegs();
    setGame(fx);
    show(app, legsOdd(entry.legs));
    if (fx) $('#enLine').focus(); else openPicker();
  }

  $('#enHouse').onchange = () => { $('#enHouseOther').hidden = $('#enHouse').value !== 'other'; entry.confirmDup = false; syncCurrency(true); };
  $('#enCur').onchange = () => syncCurrency(true);
  for (const id of ['#enStake', '#enHouseOther']) $(id).oninput = check;
  // outra odd: a confirmação de "fora da regra" vale só para a odd que foi mostrada
  $('#enOdd').oninput = () => {
    if (entry.confirmOff) { entry.confirmOff = false; syncSend(); }
    if (entry.ticket) entry.oddTouched = !!$('#enOdd').value;   // apagou: volta a seguir as pernas
    check();
  };
  $('#enManual').onchange = () => { entry.confirmOff = false; syncSend(); check(); };
  $('#enCancel').onclick = () => $('#entryDlg').close();
  // o bilhete manual: jogo (lista do dia ou digitado), linha (escrita ou atalho), pôr e tirar pernas
  $('#enPickToggle').onclick = () => { if ($('#enPick').hidden) openPicker(); else $('#enPick').hidden = true; };
  $('#enPickQ').oninput = () => { clearTimeout(pickTimer); pickTimer = setTimeout(searchPick, 250); };
  $('#enPickDate').onchange = searchPick;
  $('#enPickList').onclick = e => { const b = e.target.closest('[data-pickfx]'), f = b && picked.get(b.dataset.pickfx); if (f) { setGame(f); $('#enLine').focus(); } };
  $('#enTypeGame').onclick = () => { $('#enFree').hidden = false; $('#enWhen').value = `${$('#enPickDate').value}T${$('#enWhen').value.slice(11) || '12:00'}`; $('#enHome').focus(); };
  $('#enFreeOk').onclick = () => {
    const home = $('#enHome').value.trim(), away = $('#enAway').value.trim();
    if (!home || !away) { say('Digite o mandante e o visitante.', true); return; }
    $('#enMsg').hidden = true;
    setGame({ id: null, t: Date.parse($('#enWhen').value) || Date.now(), home: { name: home }, away: { name: away }, league: { name: $('#enComp').value.trim() || 'Entrada manual' } });
    $('#enLine').focus();
  };
  $('#enLine').oninput = lineMsg;
  $('#enLine').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addLegs(); } };
  $('#enLegOdd').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addLegs(); } };
  $('#enChips').onclick = e => {
    const c = e.target.closest('[data-chip]');
    if (!c) return;
    const v = $('#enLine').value.trim();
    $('#enLine').value = v ? `${v} + ${c.dataset.chip}` : c.dataset.chip;
    lineMsg();
  };
  $('#enAddLeg').onclick = addLegs;
  $('#enLegs').onclick = e => { const x = e.target.closest('[data-legx]'); if (x) { entry.legs.splice(Number(x.dataset.legx), 1); renderLegs(); syncTotal(); check(); } };

  // o bilhete manual: a linha escrita e não posta no bilhete entra junto
  async function sendTicket() {
    if (splitLegs($('#enLine').value).length && !addLegs()) return;
    const legs = entry.legs, h = house(), odd = parseFloat($('#enOdd').value), stakeNat = parseFloat($('#enStake').value);
    const cur = h?.currency || 'BRL', r = rateOf(cur);
    if (!legs.length) return say('Monte o bilhete: escolha o jogo, escreva a linha e toque em Pôr no bilhete.', true);
    if (!h?.name) return say('Escolha ou digite a casa.', true);
    if (!(odd > 1) || !(stakeNat > 0)) return say(`Informe a odd${legs.length > 1 ? ' total do bilhete' : ''} e a stake.`, true);
    if (!r) return say(`Sem cotação de ${cur}: abra o app de apostas uma vez (ele busca a cotação) e tente de novo.`, true);
    $('#enSend').disabled = true;
    const stake = Math.round(stakeNat * r * 100) / 100, kind = ticketKind(legs), auto = legs.every(l => l.auto);
    const cloud = await sendEntry(buildTicket({ legs, casa: h.name, currency: cur, odd, stake, stakeNat }));
    $('#entryDlg').close();
    toast(`Enviada ✓ ✍️ ${kind === 'simples' ? `${esc(legs[0].mercado)}: ${esc(legs[0].linha)}` : kind === 'mesmo jogo' ? `No mesmo jogo, ${legs.length} linhas` : `Múltipla de ${legs.length} pernas`}`
      + ` · ${esc(h.name)} @ ${num(odd)}, ${cash(stakeNat, cur)}${cur !== 'BRL' ? ` (${cash(stake)})` : ''}. ${auto ? 'O app de apostas confere o resultado sozinho. ' : 'Há perna sem conferência automática: marque o resultado à mão lá. '}`
      + (cloud ? 'O app de apostas de qualquer aparelho sincronizado registra (aba ⚽ Análise). '
        : 'Ficou só neste navegador (☁️ nuvem não conectada aqui): registre abrindo o app de apostas NESTE navegador. ')
      + `<a href="${BETS_URL}" target="apostas">Abrir app de apostas ↗</a>`, !cloud);
    window.open(BETS_URL, 'apostas');
  }

  $('#entryForm').onsubmit = async e => {
    e.preventDefault();
    if (e.submitter && e.submitter.id !== 'enSend') return;   // só o botão Registrar envia
    if (entry.ticket) return sendTicket();
    const h = house(), odd = parseFloat($('#enOdd').value), stakeNat = parseFloat($('#enStake').value);
    const cur = h?.currency || 'BRL', r = rateOf(cur), fx = entry.fx, line = curLine();
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
