// Momento dos dois times fora do jogo de hoje — o que o modelo de forças não vê, sobretudo no começo da temporada:
// como terminaram a temporada passada (nesta liga ou em outra: subiu, caiu), o mercado dos últimos meses (chegadas e
// saídas registradas na API) e se o campeonato ainda está no começo. Mais a tabela atual inteira quando a liga já
// começou. Finanças e bastidores não estão na API.
//
// loadClubs busca: a tabela da temporada passada da liga (1 requisição, guardada 6 h); para o time que não estava
// nela, a liga dele na temporada passada e a tabela dessa liga (até 2); as transferências de cada time (1, guardada 3 dias).

const DAY = 864e5;
export const WINDOW = 150 * DAY;   // mercado: a pré-temporada e o começo do campeonato
export const EARLY = 3;            // até 3 jogos na liga: começo de temporada
export const BIG_MARKET = 6;       // 6+ chegadas ou saídas: elenco muito mexido

// A linha de um time numa tabela (no grupo dele), com o tamanho do grupo.
export function rowOf(table, teamId) {
  const s = (table || []).find(x => x.team === teamId);
  if (!s) return null;
  return { rank: s.rank, of: table.filter(x => x.group === s.group).length, points: s.points, played: s.played, gd: s.gd, zone: s.zone || null };
}

// Chegadas e saídas de um time na janela (até `now`). list: api.transfers.
const isLoan = t => /loan|empr/i.test(t.type || ''), isPaid = t => /\d/.test(t.type || '') && !isLoan(t);
export function marketOf(list, teamId, now) {
  if (!Array.isArray(list)) return null;
  const recent = list.filter(t => { const d = Date.parse(t.date); return d >= now - WINDOW && d <= now; });
  const arr = recent.filter(t => t.in === teamId), dep = recent.filter(t => t.out === teamId);
  return { arrivals: arr.length, departures: dep.length, loans: arr.filter(isLoan).length,
    paid: arr.filter(isPaid).slice(0, 4).map(t => `${t.player} (${t.type}${t.outName ? `, do ${t.outName}` : ''})`),
    in: arr.slice(0, 6).map(t => `${t.player}${t.outName ? ` (${t.outName})` : ''}`),
    out: dep.slice(0, 6).map(t => `${t.player}${t.inName ? ` (→ ${t.inName})` : ''}`) };
}

// fx: o jogo; prev: tabela da temporada passada desta liga; other: { [time]: { league, table } } da liga de quem não
// estava nela; transfers: { [time]: lista }; table: a tabela de agora.
export function buildClubs({ fx, prev = [], other = {}, transfers = {}, table = [], now = Date.now() }) {
  const one = t => {
    const p = rowOf(prev, t.id);
    if (p) return { prev: { ...p, league: fx.league?.name || null }, moved: false, dir: null, market: marketOf(transfers[t.id], t.id, now) };
    const o = other[t.id], r = o ? rowOf(o.table, t.id) : null, z = r?.zone || '';
    return { prev: r ? { ...r, league: o.league } : o ? { league: o.league } : null, moved: !!o && prev.length > 0,
      dir: /releg|rebaix|descen/i.test(z) ? 'caiu' : /promot|acesso|ascen/i.test(z) ? 'subiu' : null, market: marketOf(transfers[t.id], t.id, now) };
  };
  const cur = [rowOf(table, fx.home.id), rowOf(table, fx.away.id)];
  const s = (table || []).find(x => x.team === fx.home.id), grp = s ? table.filter(x => x.group === s.group) : [];
  return { season_prev: fx.league?.season ? fx.league.season - 1 : null, home: one(fx.home), away: one(fx.away),
    played: cur.every(Boolean) ? Math.max(cur[0].played, cur[1].played) : null,
    // a tabela de agora inteira (o grupo dos dois), quando o campeonato já começou
    table_now: grp.some(x => x.played > 0) ? grp.map(x => ({ rank: x.rank, team: x.team, name: x.name || null, played: x.played,
      points: x.points, gd: x.gd, form: x.form || null, zone: x.zone || null })) : null };
}

export async function loadClubs(api, fx, { lid = fx.league?.id, table = [], budget = () => true } = {}) {
  const S = fx.league?.season;
  if (!S || !api.standings) return null;
  const safe = async (f, d) => { try { return await f(); } catch { return d; } };
  const prev = budget(1) ? await safe(() => api.standings(lid, S - 1), []) : [];
  const other = {}, transfers = {};
  for (const t of [fx.home, fx.away]) {
    if (!prev.some(x => x.team === t.id) && api.leaguesOf && budget(2)) {
      const lg = (await safe(() => api.leaguesOf(t.id, S - 1), [])).find(l => l.id !== lid);
      if (lg) other[t.id] = { league: lg.name, table: await safe(() => api.standings(lg.id, S - 1), []) };
    }
    if (api.transfers && budget(1)) transfers[t.id] = await safe(() => api.transfers(t.id), null);
  }
  return buildClubs({ fx, prev, other, transfers, table });
}

// Por que o começo de temporada pesa neste jogo: time que mudou de divisão ou com elenco muito mexido.
export function earlyRisk(c, names) {
  if (!c || c.played == null || c.played > EARLY) return [];
  const out = [];
  for (const k of ['home', 'away']) {
    const x = c[k], n = names[k];
    if (x.moved) out.push(`${n} ${x.dir === 'caiu' ? 'caiu de divisão' : x.dir === 'subiu' ? 'subiu de divisão' : 'veio de outra divisão'}`);
    if (x.market && (x.market.arrivals >= BIG_MARKET || x.market.departures >= BIG_MARKET)) out.push(`${n} com ${x.market.arrivals} chegadas e ${x.market.departures} saídas`);
  }
  return out;
}

const sgn = x => (x > 0 ? `+${x}` : `${x}`);
// Frases para o contexto do jogo.
export function clubsText(c, names) {
  if (!c) return [];
  const out = [];
  const prevTxt = (x, n) => {
    if (!x.prev) return `${n}: sem tabela da temporada passada na API`;
    const p = x.prev, tag = x.dir === 'caiu' ? ' — rebaixado' : x.dir === 'subiu' ? ' — subiu' : x.moved ? ' — outra divisão' : '';
    return p.rank ? `${n} ${p.rank}º de ${p.of} na ${p.league}${tag} (${p.points} pts em ${p.played} jogos, saldo ${sgn(p.gd)})` : `${n} estava na ${p.league}${tag}`;
  };
  if (c.home.prev || c.away.prev) out.push(`Temporada passada${c.season_prev ? ` (${c.season_prev})` : ''}: ${prevTxt(c.home, names.home)} · ${prevTxt(c.away, names.away)}.`);
  const mk = (m, n) => (!m ? null : !m.arrivals && !m.departures ? `${n} sem movimento registrado`
    : `${n} ${m.arrivals} chegada${m.arrivals === 1 ? '' : 's'}${m.loans ? ` (${m.loans} por empréstimo)` : ''}${m.paid.length ? `, compras: ${m.paid.join(', ')}` : ''}`
      + ` e ${m.departures} saída${m.departures === 1 ? '' : 's'}`);
  const ms = [mk(c.home.market, names.home), mk(c.away.market, names.away)].filter(Boolean);
  if (ms.length) out.push([c.home.market, c.away.market].every(m => m && !m.arrivals && !m.departures)
    ? 'Mercado (últimos 5 meses): a API não registra transferências destes times — cobertura fraca na liga, não quer dizer elenco parado.'
    : `Mercado (últimos 5 meses, API): ${ms.join(' · ')}.`);
  if (c.played != null && c.played <= EARLY) {
    const big = earlyRisk(c, names);
    out.push(`Começo de temporada (${c.played === 0 ? 'nenhum jogo na liga ainda' : `${c.played} jogo${c.played > 1 ? 's' : ''} na liga`}): as forças do modelo e o cenário vêm da `
      + `temporada passada${big.length ? `, e houve mudança grande — ${big.join('; ')}: a força de hoje ainda não está nos dados` : ''}.`);
  }
  return out;
}

// Na tela: a tabela atual inteira (os dois times destacados) e os nomes de quem chegou e saiu. esc: escape de HTML.
export function clubsHtml(c, fx, esc) {
  if (!c) return '';
  const ids = new Set([fx.home.id, fx.away.id]), t = c.table_now, out = [];
  if (t?.length) {
    const sg = x => (x > 0 ? `+${x}` : `${x}`), round = Math.max(...t.map(x => x.played));
    out.push(`<details class="h2h"><summary>Tabela atual (${round} rodada${round > 1 ? 's' : ''})</summary><div class="scroll"><table class="tablenow">
      <tr><th>#</th><th>Time</th><th>J</th><th>Pts</th><th>Saldo</th><th>Forma</th></tr>${t.map(x => `<tr class="${ids.has(x.team) ? 'on' : ''}">
      <td>${x.rank}</td><td>${esc(x.name || String(x.team))}</td><td>${x.played}</td><td><b>${x.points}</b></td><td>${sg(x.gd)}</td><td class="muted">${esc(x.form || '')}</td></tr>`).join('')}</table></div></details>`);
  }
  const mk = (k, n) => { const m = c[k]?.market; return m && (m.in.length || m.out.length)
    ? `<li><b>${esc(n)}</b> — chegaram: ${m.in.length ? esc(m.in.join(', ')) : 'ninguém registrado'}; saíram: ${m.out.length ? esc(m.out.join(', ')) : 'ninguém registrado'}</li>` : ''; };
  const ms = mk('home', fx.home.name) + mk('away', fx.away.name);
  if (ms) out.push(`<details class="h2h"><summary>Mercado: quem chegou e quem saiu (API)</summary><ul>${ms}</ul></details>`);
  return out.join('');
}
