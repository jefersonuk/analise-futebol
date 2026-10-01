// Chamadas à API-Football independentes do ambiente. O navegador (api.js) e o script do
// especialista (scripts/analisar.mjs) entregam o próprio transporte e o próprio armazenamento:
//   get(path, params) -> json.response       load(key) -> objeto | null       save(key, objeto)

const HOUR = 3600e3;
const FINISHED = new Set(['FT', 'AET', 'PEN']);

function compact(f) {
  const ft = f.score?.fulltime || {};
  return {
    id: f.fixture.id, t: f.fixture.timestamp * 1000,
    h: f.teams.home.id, a: f.teams.away.id, hn: f.teams.home.name, an: f.teams.away.name,
    hg: ft.home ?? f.goals.home, ag: ft.away ?? f.goals.away,
  };
}

// [dentro, fora, noGol, total, escanteios] do mandante e depois do visitante; null se não houver.
function statsOf(f) {
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

export const HALF_FROM = 2024;   // a API só tem estatística por tempo a partir da temporada 2024
const HALF_RATE = 3;             // requisições por segundo (~180/min, abaixo do limite por minuto do plano)
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function makeClient({ get, load, save }) {
  async function cached(key, ttl, fn) {
    const hit = load(key);
    if (hit && Date.now() - hit.t < ttl) return hit.d;
    const d = await fn();
    save(key, { t: Date.now(), d });
    return d;
  }

  return {
    searchTeams: q => cached(`af:teams:${q.toLowerCase()}`, 30 * 24 * HOUR, async () =>
      (await get('/teams', { search: q })).map(r => ({ id: r.team.id, name: r.team.name, country: r.team.country }))),

    // Próximos jogos do time, com liga e temporada.
    upcoming: async teamId => (await get('/fixtures', { team: teamId, next: 10 })).map(fixtureOut),

    // Último jogo disputado em qualquer competição (descanso antes do confronto).
    lastPlayed: async teamId => (await get('/fixtures', { team: teamId, last: 1 })).map(fixtureOut)[0] || null,

    // Ligas (pontos corridos) que o time disputa na temporada.
    leaguesOf: (teamId, season) => cached(`af:lgs:${teamId}:${season}`, 7 * 24 * HOUR, async () =>
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
    // estatística por tempo). Fica em cache por jogo; só os novos são baixados. Devolve os jogos com c1.
    async attachHalfCorners(leagueId, season, matches, onProgress) {
      if (season < HALF_FROM) return matches;
      const key = `af:h1:${leagueId}:${season}`;
      const store = load(key) || { m: {} };
      const pending = matches.filter(m => store.m[m.id] === undefined).map(m => m.id);
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
          else if (Date.now() - m.t > 2 * 24 * HOUR) store.m[id] = null;   // sem dado (recente: tenta de novo depois)
        }));
        done += ids.length;
        onProgress?.(done, pending.length);
        if (done % 30 === 0 || done === pending.length) save(key, store);
        await sleep(Math.max(0, 1000 - (Date.now() - started)));
      }
      save(key, store);
      return matches.map(m => ({ ...m, c1: store.m[m.id] ?? null }));
    },

    // Todos os jogos encerrados de uma liga/temporada, com estatísticas.
    // Jogo encerrado não muda: fica em cache e só os novos são baixados.
    async leagueMatches(leagueId, season, onProgress) {
      const key = `af:lg:${leagueId}:${season}`;
      const store = load(key) || { t: 0, m: {} };
      if (Date.now() - store.t > 3 * HOUR) {
        for (const f of await get('/fixtures', { league: leagueId, season }))
          if (FINISHED.has(f.fixture.status.short) && !store.m[f.fixture.id]) store.m[f.fixture.id] = compact(f);
        store.t = Date.now();
      }
      const pending = Object.values(store.m).filter(m => m.s === undefined).map(m => m.id);
      let done = 0;
      for (const group of chunk(chunk(pending, 20), 4)) {   // 20 jogos por requisição, 4 em paralelo
        await Promise.all(group.map(async ids => {
          const full = await get('/fixtures', { ids: ids.join('-') });
          for (const f of full) if (store.m[f.fixture.id]) store.m[f.fixture.id].s = statsOf(f);
          for (const id of ids) {
            const m = store.m[id];
            // sem estatística: marca como ausente, exceto jogo recente (a API pode publicar depois)
            if (m.s === undefined && Date.now() - m.t > 2 * 24 * HOUR) m.s = null;
          }
          done += ids.length;
          onProgress?.(done, pending.length);
        }));
        save(key, store);
      }
      save(key, store);
      return Object.values(store.m).map(m => ({ ...m, s: m.s ?? null }));
    },
  };
}
