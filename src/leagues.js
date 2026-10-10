// Ligas grandes (ids da API-Football): onde a API tem a estatística completa dos jogos (escanteios e chutes) e as casas
// oferecem as linhas — os chutes sobretudo. Recorte do Jeferson (10/10/2026): "isso tudo a gente só vai conseguir em
// ligas grandes, principalmente chutes". O Plano do dia (marcado "só ligas grandes", o padrão) analisa só os jogos
// delas — também poupa as requisições do histórico das ligas menores —, e chutes entram no plano só delas.
export const BIG_LEAGUES = new Map([
  // competições de clubes da UEFA
  [2, 'Champions League'], [3, 'Europa League'], [848, 'Conference League'],
  // as cinco grandes e as segundas divisões delas
  [39, 'Premier League'], [40, 'Championship'], [140, 'La Liga'], [141, 'Segunda División'], [135, 'Serie A'], [136, 'Serie B'],
  [78, 'Bundesliga'], [79, '2. Bundesliga'], [61, 'Ligue 1'], [62, 'Ligue 2'],
  // outras ligas europeias de primeira divisão com cobertura completa
  [94, 'Primeira Liga'], [88, 'Eredivisie'], [144, 'Jupiler Pro League'], [203, 'Süper Lig'], [179, 'Premiership (Escócia)'],
  [207, 'Super League (Suíça)'], [218, 'Bundesliga (Áustria)'], [119, 'Superliga (Dinamarca)'], [113, 'Allsvenskan'],
  [103, 'Eliteserien'], [197, 'Super League (Grécia)'],
  // Américas, Ásia
  [71, 'Brasileirão Série A'], [72, 'Brasileirão Série B'], [128, 'Liga Profesional (Argentina)'], [253, 'MLS'], [262, 'Liga MX'],
  [307, 'Saudi Pro League'], [98, 'J1 League'],
  // seleções: Copa do Mundo, Eurocopa, Nations League e Copa América
  [1, 'Copa do Mundo'], [4, 'Eurocopa'], [5, 'Nations League'], [9, 'Copa América'],
]);
export const isBig = league => BIG_LEAGUES.has(league?.id);
