// Chamadas à API-Football independentes do ambiente. O navegador (api.js) e o script do
// especialista (scripts/analisar.mjs) entregam o próprio transporte e o próprio armazenamento:
//   get(path, params) -> json.response       load(key) -> objeto | null (pode ser async)       save(key, objeto)
//
// Regra de economia: o que não muda não é buscado de novo. Jogo encerrado, estatística e escanteios
// do 1º tempo ficam guardados para sempre; a lista de jogos de uma liga só é rebaixada quando algum
// jogo agendado já deveria ter terminado; buscas de time, ligas e calendário têm validade longa.

const HOUR = 3600e3, DAY = 24 * HOUR;
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const DEAD = new Set(['CANC', 'ABD', 'AWD', 'WO']);   // não vão acontecer: não seguram o próximo refresh

function compact(f) {
  const ft = f.score?.fulltime || {};
  return {
    id: f.fixture.id, t: f.fixture.timestamp * 1000, lg: f.league.id, ln: f.league.name,
    h: f.teams.home.id, a: f.teams.away.id, hn: f.teams.home.name, an: f.teams.away.name,
    hg: ft.home ?? f.goals.home, ag: ft.away ?? f.goals.away,
  };
}

// [dentro, fora, noGol, total, escanteios] do mandante e depois do visitante; null se não houver.
export function statsOf(f) {
  const by = {};
  for (const s of f.statistics || []) by[s.team.id] = Object.fromEntries(s.statistics.map(x => [x.type, x.value]));
  const H = by[f.teams.home.id], A = by[f.teams.away.id];
  if (!H || !A || (H['Total Shots'] == null && A['Total Shots'] == null)) return null;
  const v = (o, k) => Number(o[k]) || 0;
  return [H, A].flatMap(o => [v(o, 'Shots insidebox'), v(o, 'Shots outsidebox'), v(o, 'Shots on Goal'), v(o, 'Total Shots'), v(o, 'Corner Kicks')]);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const fixtureOut = f => ({
  id: f.fixture.id, t: f.fixture.timestamp * 1000,
  league: { id: f.league.id, name: f.league.name, season: f.league.season, country: f.league.country },
  home: { id: f.teams.home.id, name: f.teams.home.name },
  away: { id: f.teams.away.id, name: f.teams.away.name },
});

const TZ = 'America/Sao_Paulo';
export const HALF_FROM = 2024;   // a API só tem estatística por tempo a partir da temporada 2024
const HALF_RATE = 3;             // requisições por segundo (~180/min, abaixo do limite por minuto do plano)
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function makeClient({ get: rawGet, load, save }) {
  const stats = { api: 0, cache: 0 };
  const get = (path, params) => { stats.api++; return rawGet(path, params); };

  async function cached(key, ttl, fn) {
    const hit = await load(key);
    if (hit && Date.now() - hit.t < ttl) { stats.cache++; return hit.d; }
    const d = await fn();
    await save(key, { t: Date.now(), d });
    return d;
  }

  // Jogos encerrados de uma lista da API (liga/temporada ou time/temporada), com estatísticas.
  async function collection(key, params, onProgress) {
    const store = (await load(key)) || { t: 0, next: null, m: {} };
    const now = Date.now();
    const due = !store.t
      || (store.next ? now > store.next + 2.5 * HOUR || now - store.t > DAY : now - store.t > 7 * DAY);
    if (due) {
      let next = null;
      for (const f of await get('/fixtures', params)) {
        const st = f.fixture.status.short, t = f.fixture.timestamp * 1000;
        if (FINISHED.has(st)) { if (!store.m[f.fixture.id]) store.m[f.fixture.id] = compact(f); }
        else if (!DEAD.has(st)) next = next == null ? t : Math.min(next, t);
      }
      Object.assign(store, { t: now, next });
    } else stats.cache++;
    const pending = Object.values(store.m).filter(m => m.s === undefined).map(m => m.id);
    let done = 0;
    for (const group of chunk(chunk(pending, 20), 4)) {   // 20 jogos por requisição, 4 em paralelo
      await Promise.all(group.map(async ids => {
        const full = await get('/fixtures', { ids: ids.join('-') });
        for (const f of full) if (store.m[f.fixture.id]) store.m[f.fixture.id].s = statsOf(f);
        for (const id of ids) {
          const m = store.m[id];
          // sem estatística: marca como ausente, exceto jogo recente (a API pode publicar depois)
          if (m.s === undefined && now - m.t > 2 * DAY) m.s = null;
        }
        done += ids.length;
        onProgress?.(done, pending.length);
      }));
      await save(key, store);
    }
    if (due || pending.length) await save(key, store);
    return Object.values(store.m).map(m => ({ ...m, s: m.s ?? null }));
  }

  return {
    stats: () => ({ ...stats }),

    searchTeams: q => cached(`af:teams:${q.toLowerCase()}`, 90 * DAY, async () =>
      (await get('/teams', { search: q })).map(r => ({
        id: r.team.id, name: r.team.name, country: r.team.country, national: !!r.team.national,
      }))),

    // Ficha do time (seleção ou clube). Não muda: 1 requisição por time, guardada 180 dias.
    teamInfo: teamId => cached(`af:team:${teamId}`, 180 * DAY, async () => {
      const r = (await get('/teams', { id: teamId }))[0]?.team;
      return r ? { id: r.id, name: r.name, country: r.country, national: !!r.national } : null;
    }),

    // Próximos jogos do time, com liga e temporada (calendário muda pouco: 2 h).
    upcoming: teamId => cached(`af:next:${teamId}`, 2 * HOUR, async () =>
      (await get('/fixtures', { team: teamId, next: 10 })).map(fixtureOut)),

    // Último jogo disputado em qualquer competição (descanso antes do confronto).
    lastPlayed: teamId => cached(`af:last:${teamId}`, 6 * HOUR, async () =>
      (await get('/fixtures', { team: teamId, last: 1 })).map(fixtureOut)[0] || null),

    // Ligas (pontos corridos) que o time disputa na temporada.
    leaguesOf: (teamId, season) => cached(`af:lgs:${teamId}:${season}`, 14 * DAY, async () =>
      (await get('/leagues', { team: teamId, season, type: 'league' }))
        .map(r => ({ id: r.league.id, name: r.league.name, country: r.country?.name }))),

    // Odds pré-jogo da Pinnacle (bookmaker 4). Sem cache: a API já só atualiza a cada ~3 h, e o app
    // precisa mostrar o horário real da última atualização (updatedAt) para o usuário julgar a idade.
    fixtureOdds: async fixtureId => {
      const r = (await get('/odds', { fixture: fixtureId, bookmaker: 4 }))[0];
      return { updatedAt: r?.update || null, fetchedAt: Date.now(), bookmakers: r?.bookmakers || [] };
    },

    injuries: fixtureId => cached(`af:inj:${fixtureId}`, 3 * HOUR, async () =>
      (await get('/injuries', { fixture: fixtureId })).map(r => ({
        team: r.team.id, player: r.player.name, type: r.player.type, reason: r.player.reason,
      }))),

    standings: (leagueId, season) => cached(`af:std:${leagueId}:${season}`, 6 * HOUR, async () =>
      ((await get('/standings', { league: leagueId, season }))[0]?.league.standings || []).flat().map(s => ({
        team: s.team.id, rank: s.rank, points: s.points, played: s.all.played, gd: s.goalsDiff,
        form: s.form, group: s.group, zone: s.description,
      }))),

    // Escanteios do 1º tempo de cada jogo encerrado (1 requisição por jogo: o lote ?ids= não traz
    // estatística por tempo). Fica guardado por jogo; só os novos são baixados. Devolve os jogos com c1.
    // onlyCached: só o que já está guardado, sem nenhuma requisição (varredura do dia).
    async attachHalfCorners(scope, season, matches, onProgress, { onlyCached = false } = {}) {
      if (season < HALF_FROM) return matches;
      const key = `af:h1:${scope}:${season}`;
      const store = (await load(key)) || { m: {} };
      const pending = onlyCached ? [] : matches.filter(m => store.m[m.id] === undefined).map(m => m.id);
      if (!pending.length) stats.cache++;
      let done = 0;
      for (const ids of chunk(pending, HALF_RATE)) {
        const started = Date.now();
        await Promise.all(ids.map(async id => {
          let res;
          for (let tries = 0; ; tries++) {
            try { res = await get('/fixtures/statistics', { fixture: id, half: 'true' }); break; }
            catch (e) {
              if (tries < 2 && /many|limit|rate/i.test(e.message)) { await sleep(20e3); continue; }
              throw e;
            }
          }
          const by = Object.fromEntries(res.map(t => [t.team.id, t.statistics_1h || []]));
          const m = matches.find(x => x.id === id);
          const c = t => by[t]?.find(x => x.type === 'Corner Kicks');
          const h = c(m.h), a = c(m.a);
          if (h || a) store.m[id] = [Number(h?.value) || 0, Number(a?.value) || 0];
          else if (Date.now() - m.t > 2 * DAY) store.m[id] = null;   // sem dado (recente: tenta de novo depois)
        }));
        done += ids.length;
        onProgress?.(done, pending.length);
        if (done % 30 === 0 || done === pending.length) await save(key, store);
        await sleep(Math.max(0, 1000 - (Date.now() - started)));
      }
      if (pending.length) await save(key, store);
      return matches.map(m => ({ ...m, c1: store.m[m.id] ?? null }));
    },

    // Jogos de uma data (fuso de Brasília) que ainda não começaram. Validade de 30 min.
    dayFixtures: date => cached(`af:day:${date}`, 30 * 60e3, async () =>
      (await get('/fixtures', { date, timezone: TZ })).filter(f => f.fixture.status.short === 'NS').map(fixtureOut)),

    // Odds da Pinnacle de um mercado para todos os jogos de uma data (paginado, 10 jogos por página).
    // Validade de 20 min: a API só atualiza odds a cada ~3 h. Devolve [{ fixture, league, updatedAt, bookmakers }].
    dayOdds: (date, bet) => cached(`af:dayodds:${date}:${bet}`, 20 * 60e3, async () => {
      const out = [];
      let tz = { timezone: TZ };
      for (let page = 1, total = 1; page <= total && page <= 60; page++) {
        let res;
        try { res = await get('/odds', { date, bookmaker: 4, bet, page, ...tz }); }
        catch (e) { if (tz.timezone && /timezone/i.test(e.message)) { tz = {}; page--; continue; } throw e; }
        total = res.paging?.total || total;
        for (const r of res) out.push({ fixture: r.fixture.id, league: { id: r.league.id, name: r.league.name, season: r.league.season,
          country: r.league.country }, updatedAt: r.update || null, bookmakers: r.bookmakers || [] });
      }
      return out;
    }),

    // A liga/temporada já está guardada neste dispositivo (ou na nuvem)? Sem requisição à API-Football.
    hasLeague: async (leagueId, season) => !!(await load(`af:lg:${leagueId}:${season}`)),

    // Jogos encerrados de uma liga/temporada, com estatísticas.
    leagueMatches: (leagueId, season, onProgress) =>
      collection(`af:lg:${leagueId}:${season}`, { league: leagueId, season }, onProgress),

    // Jogos encerrados de um time numa temporada, em todas as competições (base das seleções).
    teamMatches: (teamId, season, onProgress) =>
      collection(`af:tm:${teamId}:${season}`, { team: teamId, season }, onProgress),
  };
}
