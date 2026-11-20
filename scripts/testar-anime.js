// node scripts/testar-anime.js: confere as regras de animes (NANDRoll) sem
// precisar de internet: a AniList é simulada com uma resposta de exemplo.
const assert = require('assert');
const test = require('node:test');

const { comEpisodiosDoDia, novoFilme, mesmoFilme, progressoSerie, statusSerie, comDia, vistoSerie, ehSerie, passoSerie, totalTemporadas, definirSerie, alternarEpisodio, marcadosDe } = require('../lib/filmes');
const anilist = require('../lib/anilist');

const serie = (dados = {}) => novoFilme({ tipo: 'serie', anime: true, anilistId: 1, episodios: 12, episodiosVistos: 0, status: 'planejo', ...dados });

test('progresso: o primeiro episódio começa a série', () => {
  assert.deepStrictEqual(progressoSerie(serie(), 1), { episodiosVistos: 1, status: 'assistindo', visto: false });
});
test('progresso: o último episódio completa e marca como visto', () => {
  assert.deepStrictEqual(progressoSerie(serie({ episodiosVistos: 11, status: 'assistindo' }), 12), { episodiosVistos: 12, status: 'completo', visto: true });
});
test('progresso: não passa do total nem fica negativo', () => {
  assert.strictEqual(progressoSerie(serie(), 99).episodiosVistos, 12);
  assert.strictEqual(progressoSerie(serie(), -3).episodiosVistos, 0);
});
test('progresso: voltar um episódio de uma série completa a reabre', () => {
  assert.deepStrictEqual(progressoSerie(serie({ episodiosVistos: 12, status: 'completo', visto: true }), 11), { episodiosVistos: 11, status: 'assistindo', visto: false });
});
test('progresso: pausado continua pausado até completar', () => {
  assert.strictEqual(progressoSerie(serie({ episodiosVistos: 3, status: 'pausado' }), 4).status, 'pausado');
  assert.strictEqual(progressoSerie(serie({ episodiosVistos: 11, status: 'pausado' }), 12).status, 'completo');
});
test('progresso: sem total conhecido (em exibição), conta sem limite e não completa', () => {
  assert.deepStrictEqual(progressoSerie(serie({ episodios: 0, episodiosVistos: 30, status: 'assistindo' }), 31), { episodiosVistos: 31, status: 'assistindo', visto: false });
});
test('status: completar marca todos os episódios; planejar zera', () => {
  assert.deepStrictEqual(statusSerie(serie({ episodiosVistos: 4 }), 'completo'), { status: 'completo', visto: true, episodiosVistos: 12 });
  assert.deepStrictEqual(statusSerie(serie({ episodiosVistos: 4 }), 'planejo'), { status: 'planejo', visto: false, episodiosVistos: 0 });
  assert.deepStrictEqual(statusSerie(serie(), 'inventado'), {});
});
test('o dia: completar grava a data, reabrir no mesmo dia desfaz', () => {
  const f = serie({ episodiosVistos: 11, status: 'assistindo' });
  const m = comDia(f, progressoSerie(f, 12), '2026-11-11');
  assert.deepStrictEqual(m.vistoEm, ['2026-11-11']);
  const g = { ...f, ...m };
  assert.deepStrictEqual(comDia(g, progressoSerie(g, 11), '2026-11-11').vistoEm, []);
  // sem mudar de visto, as datas não são tocadas
  assert.ok(!('vistoEm' in comDia(f, progressoSerie(f, 5), '2026-11-11')));
});
test('episódios por dia: +1 grava no dia, desfazer tira do dia, em bloco não inventa datas', () => {
  const f = serie({ episodiosVistos: 2, epDias: { '2026-11-10': 2 }, status: 'assistindo' });
  const m = comEpisodiosDoDia(f, progressoSerie(f, 3), '2026-11-11');
  assert.deepStrictEqual(m.epDias, { '2026-11-10': 2, '2026-11-11': 1 });
  const g = { ...f, ...m };
  assert.deepStrictEqual(comEpisodiosDoDia(g, progressoSerie(g, 2), '2026-11-11').epDias, { '2026-11-10': 2 });
  // desfazer sem nada hoje tira do dia mais recente
  assert.deepStrictEqual(comEpisodiosDoDia(f, progressoSerie(f, 1), '2026-11-11').epDias, { '2026-11-10': 1 });
  // vários de uma vez (digitar o número): sem datas novas
  assert.ok(!('epDias' in comEpisodiosDoDia(f, progressoSerie(f, 9), '2026-11-11', { registrar: false })));
  // zerar limpa
  assert.deepStrictEqual(comEpisodiosDoDia(f, statusSerie(f, 'planejo'), '2026-11-11', { registrar: false }).epDias, {});
});
test('o ✓ numa série acompanha o status', () => {
  assert.deepStrictEqual(vistoSerie(serie({ episodiosVistos: 2, status: 'assistindo' }), true), { status: 'completo', visto: true, episodiosVistos: 12 });
  assert.deepStrictEqual(vistoSerie(serie({ episodiosVistos: 12, status: 'completo', visto: true }), false), { status: 'assistindo', visto: false });
});
test('repetidos: mesmo id da AniList é o mesmo; filme e série de mesmo nome são dois', () => {
  assert.ok(mesmoFilme({ anilistId: 5, titulo: 'A' }, { anilistId: '5', titulo: 'B' }));
  assert.ok(!mesmoFilme({ titulo: 'Chainsaw Man', ano: '2022', tipo: 'serie' }, { titulo: 'Chainsaw Man', ano: '2022' }));
  assert.ok(mesmoFilme({ titulo: 'Your Name.', ano: '2016' }, { titulo: 'your name.', ano: '2016' }));
  assert.ok(!ehSerie({ titulo: 'filme antigo, sem tipo' }));
});

// ---- AniList simulada ----

const MIDIA = {
  id: 127230, idMal: 44511, format: 'TV', status: 'RELEASING', episodes: 12, seasonYear: 2022, startDate: { year: 2022 },
  title: { romaji: 'Chainsaw Man', english: 'Chainsaw Man' },
  coverImage: { large: 'https://img/m.jpg', extraLarge: 'https://img/g.jpg' },
  duration: 24, season: 'FALL', averageScore: 85, countryOfOrigin: 'JP',
  description: 'Denji é um jovem&hellip;<br><br><i>Caçador</i> de demônios.\n\n(Source: MANGA Plus)',
  genres: ['Action', 'Drama'], bannerImage: null,
  trailer: { id: 'q15CRdE5Bv0', site: 'youtube' },
  studios: { nodes: [{ name: 'MAPPA' }] },
  nextAiringEpisode: { episode: 5, airingAt: 1668528000 },
  externalLinks: [
    { site: 'Crunchyroll', url: 'https://www.crunchyroll.com/chainsaw-man', type: 'STREAMING', language: 'English' },
    { site: 'Crunchyroll', url: 'https://www.crunchyroll.com/pt-br/chainsaw-man', type: 'STREAMING', language: 'Portuguese' },
    { site: 'Twitter', url: 'https://twitter.com/x', type: 'SOCIAL' },
    { site: 'Ruim', url: 'javascript:alert(1)', type: 'STREAMING' },
  ],
};
function simular(resposta, status = 200) {
  const pedidos = [];
  global.fetch = async (url, opcoes) => {
    pedidos.push({ url, corpo: JSON.parse(opcoes.body) });
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => resposta };
  };
  return pedidos;
}

test('anilist.detalhes: lê os campos de uma série', async () => {
  const pedidos = simular({ data: { Media: MIDIA } });
  const d = await anilist.detalhes('127230');
  assert.strictEqual(pedidos[0].url, 'https://graphql.anilist.co');
  assert.deepStrictEqual(pedidos[0].corpo.variables, { id: 127230 });
  assert.strictEqual(d.filme, false);
  assert.strictEqual(d.episodios, 12);
  assert.strictEqual(d.estudio, 'MAPPA');
  assert.strictEqual(d.exibicao, 'em exibição');
  assert.strictEqual(d.trailerId, 'q15CRdE5Bv0');
  assert.strictEqual(d.poster, 'https://img/g.jpg');
  assert.deepStrictEqual(d.proximoEpisodio, { numero: 5, em: '2022-11-15T16:00:00.000Z' });
  // um link por site, só streaming e só http(s)
  assert.deepStrictEqual(d.ondeAssistir, [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/pt-br/chainsaw-man' }], 'o link em português tem preferência');
  assert.ok(!/<|Source/.test(d.info.sinopse), d.info.sinopse);
  assert.strictEqual(d.info.genero, 'Ação, Drama');
});
test('anilist.campos: série vem inteira da AniList e não vai para a fila do TMDB', async () => {
  simular({ data: { Media: MIDIA } });
  const d = await anilist.detalhes(127230);
  const f = serie({ titulo: 'Chainsaw Man', ano: '2022', tmdbEm: 'x' });
  const m = anilist.campos(d, f);
  assert.strictEqual(m.tipo, 'serie');
  assert.strictEqual(m.diretor, 'MAPPA');
  assert.strictEqual(m.episodios, 12);
  assert.ok(m.tmdbEm);
  assert.ok(!('episodiosVistos' in m) && !('status' in m), 'atualizar pela AniList não mexe no progresso');
  assert.ok(!('titulo' in m), 'o título que a pessoa já tem fica');
  // capa escolhida pela pessoa não é trocada
  assert.ok(!('poster' in anilist.campos(d, { ...f, capaPersonalizada: true })));
});
test('anilist.campos: filme de anime continua filme, só ganha onde assistir', async () => {
  simular({ data: { Media: { ...MIDIA, format: 'MOVIE', episodes: 1 } } });
  const d = await anilist.detalhes(1);
  const m = anilist.campos(d, novoFilme({ titulo: 'Filme' }));
  assert.ok(d.filme);
  assert.ok(!('tipo' in m) && !('poster' in m) && !('info' in m) && !('tmdbEm' in m));
  assert.strictEqual(m.anime, true);
  assert.strictEqual(m.ondeAssistir.length, 1);
});
test('anilist.pesquisar: resultados no formato da busca', async () => {
  simular({ data: { Page: { media: [MIDIA, { ...MIDIA, id: 2, format: 'MOVIE', episodes: 1 }, { ...MIDIA, id: 3, format: 'MUSIC' }] } } });
  const r = await anilist.pesquisar('  chainsaw ');
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[0], { anilistId: 127230, titulo: 'Chainsaw Man', ano: '2022', poster: 'https://img/m.jpg', formato: 'TV', filme: false, detalhe: 'TV · 12 eps' });
  assert.strictEqual(r[1].detalhe, 'Filme');
  assert.ok(r[1].filme);
});
test('anilist: sem internet ou erro do servidor vira ErroAnilist', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(() => anilist.pesquisar('x'), anilist.ErroAnilist);
  simular({}, 500);
  await assert.rejects(() => anilist.detalhes(1), /erro 500/);
  simular({ data: { Media: null } });
  assert.strictEqual(await anilist.detalhes(1), null);
});

// ---- Capa das séries pelo TMDB ----
const tmdb = require('../lib/tmdb');

function simularTmdb(rotas) {
  const pedidos = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    pedidos.push(u.pathname.replace('/3', '') + (u.searchParams.get('query') ? `?${u.searchParams.get('query')}` : ''));
    const chave = Object.keys(rotas).find((k) => pedidos[pedidos.length - 1].startsWith(k));
    const corpo = chave ? rotas[chave] : null;
    return { status: corpo ? 200 : 404, ok: Boolean(corpo), json: async () => corpo };
  };
  return pedidos;
}

test('separarTemporada: tira "Season 2", "2nd Season" e "Temporada 3" do título', () => {
  assert.deepStrictEqual(tmdb.separarTemporada('SPY x FAMILY Season 2'), { base: 'SPY x FAMILY', temporada: 2 });
  assert.deepStrictEqual(tmdb.separarTemporada('Mob Psycho 100: 3rd Season'), { base: 'Mob Psycho 100', temporada: 3 });
  assert.deepStrictEqual(tmdb.separarTemporada('Chainsaw Man'), { base: 'Chainsaw Man', temporada: 0 });
  assert.deepStrictEqual(tmdb.separarTemporada('Season 2'), { base: 'Season 2', temporada: 0 });
  assert.deepStrictEqual(tmdb.separarTemporada('SPY x FAMILY Cour 2'), { base: 'SPY x FAMILY', temporada: 0 });
  assert.deepStrictEqual(tmdb.separarTemporada('SPY×FAMILY Part 2'), { base: 'SPY×FAMILY', temporada: 0 });
});
test('capaSerie: acha a animação pelo título e usa a capa do idioma original', async () => {
  const pedidos = simularTmdb({
    '/search/tv?Chainsaw Man': { results: [
      { id: 1, name: 'Chainsaw Man', genre_ids: [18], poster_path: '/errada.jpg' }, // série de mesmo nome que não é animação
      { id: 114410, name: 'Chainsaw Man', original_name: 'チェンソーマン', original_language: 'ja', genre_ids: [16, 10759], poster_path: '/padrao.jpg' },
    ] },
    '/tv/114410/images': { posters: [{ file_path: '/en.jpg', iso_639_1: 'en', vote_average: 9 }, { file_path: '/ja.jpg', iso_639_1: 'ja', vote_average: 5 }], logos: [{ file_path: '/logo-en.png', iso_639_1: 'en', vote_average: 1 }] },
    '/tv/114410/external_ids': { imdb_id: 'tt13616990' },
    '/tv/114410': { overview: 'Denji é um caçador.' },
    '/tv/114410/imagesX': { posters: [{ file_path: '/en.jpg', iso_639_1: 'en', vote_average: 9 }, { file_path: '/ja.jpg', iso_639_1: 'ja', vote_average: 5 }], logos: [{ file_path: '/logo-en.png', iso_639_1: 'en', vote_average: 1 }] },
  });
  const c = await tmdb.capaSerie('chave', { titulo: 'Chainsaw Man', tituloRomaji: 'Chainsaw Man' });
  assert.deepStrictEqual(c, { tmdbTvId: 114410, temporada: 0, poster: 'https://image.tmdb.org/t/p/w780/ja.jpg', logo: 'https://image.tmdb.org/t/p/w500/logo-en.png', sinopse: 'Denji é um caçador.', imdbID: 'tt13616990' });
  assert.deepStrictEqual(pedidos.sort(), ['/search/tv?Chainsaw Man', '/tv/114410', '/tv/114410/external_ids', '/tv/114410/images'].sort());
});
test('capaSerie: com temporada no título, busca a série sem ela e usa a capa da temporada', async () => {
  const pedidos = simularTmdb({
    '/search/tv?SPY x FAMILY Season 2': { results: [] },
    '/search/tv?SPY x FAMILY': { results: [{ id: 120089, name: 'SPY x FAMILY', original_language: 'ja', genre_ids: [16], poster_path: '/serie.jpg' }] },
    '/tv/120089/season/2/images': { posters: [{ file_path: '/t2.jpg', iso_639_1: 'ja', vote_average: 5 }] },
    '/tv/120089/images': { posters: [{ file_path: '/serie-ja.jpg', iso_639_1: 'ja', vote_average: 5 }], logos: [] },
  });
  const c = await tmdb.capaSerie('chave', { titulo: 'SPY x FAMILY Season 2' });
  assert.strictEqual(c.poster, 'https://image.tmdb.org/t/p/w780/t2.jpg');
  assert.strictEqual(c.logo, '');
  assert.ok(pedidos.includes('/tv/120089/season/2/images'));
});
test('capaSerie: sem animação com esse nome, devolve null (fica a capa da AniList)', async () => {
  simularTmdb({ '/search/tv': { results: [{ id: 9, name: 'Monster', genre_ids: [18] }] } });
  assert.strictEqual(await tmdb.capaSerie('chave', { titulo: 'Monster' }), null);
});
test('anilist.campos: com a capa do TMDB, a da AniList não volta', async () => {
  simular({ data: { Media: MIDIA } });
  const d = await anilist.detalhes(127230);
  assert.ok(!('poster' in anilist.campos(d, serie({ poster: 'https://image.tmdb.org/t/p/w780/ja.jpg', capaTmdb: true }))));
  assert.strictEqual(anilist.campos(d, serie()).poster, 'https://img/g.jpg');
});
test('anilist.campos: a sinopse em português do TMDB não é trocada pela em inglês', async () => {
  simular({ data: { Media: MIDIA } });
  const d = await anilist.detalhes(127230);
  const m = anilist.campos(d, serie({ info: { sinopse: 'Em português.', sinopsePt: true } }));
  assert.strictEqual(m.info.sinopse, 'Em português.');
  assert.strictEqual(m.info.genero, 'Ação, Drama');
});

// ---- Temporadas ----

const T = (dados) => ({ anilistId: 1, titulo: 'T', episodios: 12, exibicao: 'finalizado', vistos: 0, ...dados });
const comTemporadas = (ts, dados = {}) => serie({ temporadas: ts, episodios: totalTemporadas(ts), episodiosVistos: ts.reduce((s, t) => s + t.vistos, 0), ...dados });

test('total: temporada anunciada e não lançada não conta; em exibição sem total deixa o total em aberto', () => {
  assert.strictEqual(totalTemporadas([T(), T({ episodios: 13 }), T({ episodios: 0, exibicao: 'não lançado' })]), 25);
  assert.strictEqual(totalTemporadas([T(), T({ episodios: 0, exibicao: 'em exibição' })]), 0);
});
test('passo: sem escolher temporada, segue a ordem e passa para a seguinte', () => {
  let f = comTemporadas([T({ anilistId: 1, episodios: 2 }), T({ anilistId: 2, episodios: 2 }), T({ anilistId: 3, episodios: 0, exibicao: 'não lançado' })]);
  for (let i = 0; i < 3; i++) f = { ...f, ...passoSerie(f, 1) };
  assert.deepStrictEqual(f.temporadas.map((t) => t.vistos), [2, 1, 0]);
  assert.strictEqual(f.episodiosVistos, 3);
  assert.strictEqual(f.status, 'assistindo');
  f = { ...f, ...passoSerie(f, 1) };
  assert.strictEqual(f.status, 'completo', 'a não lançada não impede de completar');
  assert.ok(f.visto);
  assert.deepStrictEqual(passoSerie(f, 1), {}, 'nada mais a ver');
  f = { ...f, ...passoSerie(f, -1) };
  assert.deepStrictEqual(f.temporadas.map((t) => t.vistos), [2, 1, 0], 'voltar tira da última com episódios');
  assert.strictEqual(f.status, 'assistindo');
});
test('passo: numa temporada escolhida, mexe só nela e não passa do total dela', () => {
  let f = comTemporadas([T({ episodios: 2 }), T({ anilistId: 2, episodios: 2 })]);
  for (let i = 0; i < 5; i++) f = { ...f, ...passoSerie(f, 1, 1) };
  assert.deepStrictEqual(f.temporadas.map((t) => t.vistos), [0, 2]);
  assert.strictEqual(f.status, 'assistindo');
});
test('status com temporadas: completar enche as lançadas, planejar zera', () => {
  const f = comTemporadas([T({ vistos: 3 }), T({ anilistId: 2, episodios: 0, exibicao: 'não lançado' })]);
  const c = statusSerie(f, 'completo');
  assert.deepStrictEqual(c.temporadas.map((t) => t.vistos), [12, 0]);
  assert.strictEqual(c.episodiosVistos, 12);
  assert.deepStrictEqual(statusSerie(f, 'planejo').temporadas.map((t) => t.vistos), [0, 0]);
});
test('repetidos: qualquer temporada da série já na lista conta como a mesma', () => {
  const naLista = { anilistId: 140960, titulo: 'SPY x FAMILY', tipo: 'serie', temporadas: [{ anilistId: 140960 }, { anilistId: 158927 }] };
  assert.ok(mesmoFilme(naLista, { anilistId: 158927, titulo: 'SPY x FAMILY Season 2', tipo: 'serie' }));
  assert.ok(!mesmoFilme(naLista, { anilistId: 999, titulo: 'Outro', tipo: 'serie' }));
});

// A corrente: S2 ←→ S1, com um filme no meio e um curta ligado como "anterior" da S1.
const REDE = {
  10: { ...MIDIA, id: 10, format: 'ONA', episodes: 1, title: { english: 'Curta', romaji: 'Curta' }, relations: { edges: [{ relationType: 'SEQUEL', node: { id: 11, type: 'ANIME', format: 'TV' } }] } },
  11: { ...MIDIA, id: 11, status: 'FINISHED', nextAiringEpisode: null, title: { english: 'Série', romaji: 'Shirizu' }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 10, type: 'ANIME', format: 'ONA' } }, { relationType: 'ADAPTATION', node: { id: 1, type: 'MANGA', format: 'MANGA' } }, { relationType: 'SEQUEL', node: { id: 12, type: 'ANIME', format: 'MOVIE' } }] } },
  12: { ...MIDIA, id: 12, format: 'MOVIE', episodes: 1, title: { english: 'Série: O Filme' }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 11, type: 'ANIME', format: 'TV' } }, { relationType: 'SEQUEL', node: { id: 13, type: 'ANIME', format: 'TV' } }] } },
  13: { ...MIDIA, id: 13, episodes: 10, title: { english: 'Série Season 2' }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 12, type: 'ANIME', format: 'MOVIE' } }, { relationType: 'SEQUEL', node: { id: 14, type: 'ANIME', format: 'TV' } }] } },
  14: { ...MIDIA, id: 14, status: 'NOT_YET_RELEASED', episodes: null, nextAiringEpisode: null, title: { english: null, romaji: 'Shirizu 3rd Season' }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 13, type: 'ANIME', format: 'TV' } }] } },
};
function simularRede() {
  const pedidos = [];
  global.fetch = async (_url, opcoes) => {
    const id = JSON.parse(opcoes.body).variables.id;
    pedidos.push(id);
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Media: REDE[id] || null } }) };
  };
  return pedidos;
}

test('anilist.temporadas: de qualquer temporada, acha todas em ordem, com o filme no meio (sem o curta anterior)', async () => {
  const pedidos = simularRede();
  const ts = await anilist.temporadas(13);
  assert.deepStrictEqual(ts.map((t) => t.anilistId), [11, 12, 13, 14]);
  assert.strictEqual(new Set(pedidos).size, pedidos.length, 'cada entrada é pedida uma vez');
});
test('anilist.camposSerie: um item só, com a soma e o progresso preservado', async () => {
  simularRede();
  const ts = await anilist.temporadas(13);
  const m = anilist.camposSerie(ts, serie({ titulo: 'Série Season 2', ano: '2023', anilistId: 13 }), { novo: true });
  assert.strictEqual(m.titulo, 'Série');
  assert.strictEqual(m.anilistId, 11);
  assert.strictEqual(m.episodios, 23, '12 + o filme + 10');
  assert.strictEqual(m.exibicao, 'em exibição');
  assert.deepStrictEqual(m.temporadas.map((t) => [t.titulo, t.episodios, t.vistos]), [['Série', 12, 0], ['Série: O Filme', 1, 0], ['Série Season 2', 10, 0], ['Shirizu 3rd Season', 0, 0]]);
  // atualizar depois não perde o que a pessoa já viu
  const visto = { ...serie(), ...m, temporadas: m.temporadas.map((t, i) => ({ ...t, vistos: [12, 1, 4, 0][i] })) };
  const de_novo = anilist.camposSerie(ts, visto);
  assert.deepStrictEqual(de_novo.temporadas.map((t) => t.vistos), [12, 1, 4, 0]);
  assert.strictEqual(de_novo.episodiosVistos, 17);
  assert.ok(!('titulo' in de_novo));
});

// ---- Digitar episódios, em alta e importar a lista ----

test('definir: o total digitado é distribuído pelas temporadas lançadas, em ordem', () => {
  const f = comTemporadas([T({ episodios: 12 }), T({ anilistId: 2, episodios: 13 }), T({ anilistId: 3, episodios: 0, exibicao: 'não lançado' })]);
  const m = definirSerie(f, 20);
  assert.deepStrictEqual(m.temporadas.map((t) => t.vistos), [12, 8, 0]);
  assert.strictEqual(m.status, 'assistindo');
  assert.strictEqual(definirSerie(f, 999).status, 'completo');
  assert.deepStrictEqual(definirSerie(f, 999).temporadas.map((t) => t.vistos), [12, 13, 0]);
  assert.deepStrictEqual(definirSerie({ ...f, ...m }, 0).temporadas.map((t) => t.vistos), [0, 0, 0]);
});
test('definir: numa temporada, vale só para ela; sem temporadas, é o número direto', () => {
  const f = comTemporadas([T({ episodios: 12, vistos: 12 }), T({ anilistId: 2, episodios: 13 })]);
  assert.deepStrictEqual(definirSerie(f, 50, 1).temporadas.map((t) => t.vistos), [12, 13]);
  assert.deepStrictEqual(definirSerie(f, 5, 1).temporadas.map((t) => t.vistos), [12, 5]);
  assert.strictEqual(definirSerie(serie({ episodios: 0, status: 'assistindo' }), 1100).episodiosVistos, 1100);
});
test('busca vazia: não consulta a AniList e devolve lista vazia (sem "em alta")', async () => {
  const pedidos = simular({ data: { Page: { media: [MIDIA] } } });
  const r = await anilist.pesquisar('   ');
  assert.deepStrictEqual(r, []);
  assert.strictEqual(pedidos.length, 0);
});

const entrada = (id, extra = {}, midia = {}) => ({ status: 'planejo', vistos: 0, nota: 0, completoEm: '', ...extra,
  midia: { id, format: 'TV', status: 'FINISHED', episodes: 12, seasonYear: 2020, title: { english: `Anime ${id}`, romaji: `Anime ${id}` }, coverImage: { large: 'https://img/c.jpg' }, relations: { edges: [] }, ...midia } });
const liga = (tipo, id, format = 'TV') => ({ relationType: tipo, node: { id, type: 'ANIME', format } });

test('importar: temporadas da mesma série viram um item, com progresso, status e nota', () => {
  const { series, filmes } = anilist.agruparLista([
    entrada(2, { status: 'assistindo', vistos: 5, nota: 9 }, { seasonYear: 2022, title: { english: 'Série Season 2' }, relations: { edges: [liga('PREQUEL', 1)] } }),
    entrada(1, { status: 'completo', vistos: 12, nota: 8, completoEm: '2021-03-04' }, { seasonYear: 2020, title: { english: 'Série' }, relations: { edges: [liga('SEQUEL', 2)] } }),
    entrada(7, { status: 'completo', vistos: 1, nota: 10, completoEm: '2019-01-02' }, { format: 'MOVIE', episodes: 1, title: { english: 'Um Filme' } }),
    entrada(9, { status: 'largado', vistos: 3 }, { title: { english: 'Outra' } }),
  ]);
  assert.strictEqual(series.length, 2);
  const s = series.find((x) => x.titulo === 'Série');
  assert.deepStrictEqual(s.temporadas.map((t) => [t.anilistId, t.vistos]), [[1, 12], [2, 5]]);
  assert.strictEqual(s.anilistId, 1);
  assert.strictEqual(s.status, 'assistindo');
  assert.strictEqual(s.episodiosVistos, 17);
  assert.strictEqual(s.minhaNota, 4.5, 'média 8,5 de 10 → 4,5 estrelas');
  assert.ok(s.anilistPendente && !s.visto);
  assert.strictEqual(series.find((x) => x.titulo === 'Outra').status, 'largado');
  assert.deepStrictEqual(filmes, [{ anime: true, anilistId: 7, titulo: 'Um Filme', ano: '2020', poster: 'https://img/c.jpg', visto: true, vistoEm: ['2019-01-02'], minhaNota: 5 }]);
});
test('importar: temporadas ligadas por um filme no meio continuam sendo a mesma série', () => {
  const { series } = anilist.agruparLista([
    entrada(1, { status: 'completo', vistos: 12 }, { relations: { edges: [liga('SEQUEL', 50, 'MOVIE')] } }),
    entrada(3, { status: 'completo', vistos: 12 }, { seasonYear: 2023, relations: { edges: [liga('PREQUEL', 50, 'MOVIE')] } }),
  ]);
  assert.strictEqual(series.length, 1);
  assert.strictEqual(series[0].status, 'completo');
  assert.ok(series[0].visto);
});
test('importar: ao completar pela AniList, "completa" só vale com todas as temporadas lançadas vistas', async () => {
  simularRede();
  const ts = await anilist.temporadas(11);
  // a pessoa listou só a primeira temporada, como completa
  const { series } = anilist.agruparLista([entrada(11, { status: 'completo', vistos: 12, completoEm: '2022-01-01' }, { title: { english: 'Série' } })]);
  const m = anilist.camposSerie(ts, { ...serie(), ...series[0] });
  assert.strictEqual(m.anilistPendente, false);
  assert.deepStrictEqual(m.temporadas.map((t) => t.vistos), [12, 0, 0, 0]);
  assert.strictEqual(m.status, 'assistindo');
  assert.strictEqual(m.visto, false);
});

// ---- Episódios avulsos e filmes na ordem ----

test('avulso: marcar o 7 sem ter visto o 5 guarda a lista; +1 preenche o primeiro que falta', () => {
  let f = comTemporadas([T({ episodios: 12, vistos: 4 })]);
  f = { ...f, ...alternarEpisodio(f, 0, 7) };
  assert.deepStrictEqual(f.temporadas[0].lista, [1, 2, 3, 4, 7]);
  assert.strictEqual(f.temporadas[0].vistos, 5);
  assert.strictEqual(f.episodiosVistos, 5);
  f = { ...f, ...passoSerie(f, 1, 0) };
  assert.deepStrictEqual(marcadosDe(f.temporadas[0]), [1, 2, 3, 4, 5, 7]);
  f = { ...f, ...passoSerie(f, 1, 0) };
  assert.ok(!('lista' in f.temporadas[0]), 'em sequência de novo, a lista some');
  assert.strictEqual(f.temporadas[0].vistos, 7);
  f = { ...f, ...passoSerie(f, -1, 0) };
  assert.strictEqual(f.temporadas[0].vistos, 6);
  f = { ...f, ...alternarEpisodio(f, 0, 3) };
  assert.deepStrictEqual(f.temporadas[0].lista, [1, 2, 4, 5, 6]);
  assert.deepStrictEqual(alternarEpisodio(f, 0, 13), {}, 'não passa do total');
});
test('avulso: digitar um número ou completar volta para a sequência', () => {
  const f = comTemporadas([T({ episodios: 12, vistos: 2, lista: [3, 9] })]);
  assert.ok(!('lista' in definirSerie(f, 5).temporadas[0]));
  assert.ok(!('lista' in statusSerie(f, 'completo').temporadas[0]));
});
test('filme na ordem: o +1 da série passa pelo filme entre as temporadas', () => {
  let f = comTemporadas([T({ episodios: 2 }), T({ anilistId: 2, formato: 'MOVIE', episodios: 1 }), T({ anilistId: 3, episodios: 2 })]);
  for (let i = 0; i < 3; i++) f = { ...f, ...passoSerie(f, 1) };
  assert.deepStrictEqual(f.temporadas.map((t) => t.vistos), [2, 1, 0]);
});
test('repetidos: o filme de uma série na lista ainda pode entrar como filme sozinho', () => {
  const naLista = { anilistId: 1, tipo: 'serie', temporadas: [{ anilistId: 1 }, { anilistId: 50, formato: 'MOVIE' }] };
  assert.ok(!mesmoFilme(naLista, { anilistId: 50, titulo: 'O Filme' }));
});
test('temporada anunciada sem formato na AniList entra na série', async () => {
  const rede = {
    1: { ...MIDIA, id: 1, status: 'FINISHED', nextAiringEpisode: null, relations: { edges: [{ relationType: 'SEQUEL', node: { id: 2, type: 'ANIME', format: 'MOVIE' } }] } },
    2: { ...MIDIA, id: 2, format: 'MOVIE', episodes: 1, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 1, type: 'ANIME', format: 'TV' } }, { relationType: 'SEQUEL', node: { id: 3, type: 'ANIME', format: null } }] } },
    3: { ...MIDIA, id: 3, format: null, status: 'NOT_YET_RELEASED', episodes: null, nextAiringEpisode: null, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 2, type: 'ANIME', format: 'MOVIE' } }] } },
  };
  global.fetch = async (_u, o) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Media: rede[JSON.parse(o.body).variables.id] || null } }) });
  const de3 = await anilist.temporadas(3);
  assert.deepStrictEqual(de3.map((t) => t.anilistId), [1, 2, 3]);
});
test('importar: o filme ligado à série entra na série, na ordem', () => {
  const { series, filmes } = anilist.agruparLista([
    entrada(1, { status: 'completo', vistos: 12 }, { relations: { edges: [liga('SEQUEL', 50, 'MOVIE')] } }),
    entrada(50, { status: 'completo', vistos: 1 }, { format: 'MOVIE', episodes: 1, seasonYear: 2021, relations: { edges: [liga('PREQUEL', 1)] } }),
  ]);
  assert.strictEqual(filmes.length, 0);
  assert.deepStrictEqual(series[0].temporadas.map((t) => [t.anilistId, t.vistos]), [[1, 12], [50, 1]]);
});

// ---- Episódios: mapa entre as temporadas da AniList e as do TMDB ----
const tmdbLib = require('../lib/tmdb');
const { Episodios } = require('../lib/episodios');

test('mapa de temporadas: uma a uma quando as contagens batem', () => {
  const tmdb = [{ numero: 1, episodios: 12 }, { numero: 2, episodios: 12 }];
  assert.deepStrictEqual(tmdbLib.mapearTemporadas(tmdb, [12, 12]), [{ de: 1, ate: 12 }, { de: 13, ate: 24 }]);
});
test('mapa de temporadas: duas partes da AniList dentro de uma temporada do TMDB', () => {
  const tmdb = [{ numero: 1, episodios: 25 }, { numero: 2, episodios: 12 }, { numero: 3, episodios: 22 }];
  const m = tmdbLib.mapearTemporadas(tmdb, [25, 12, 12, 10]);
  assert.deepStrictEqual(m[2], { de: 38, ate: 49 });
  assert.deepStrictEqual(m[3], { de: 50, ate: 59 });
});
test('mapa de temporadas: encosta no começo da temporada do TMDB (resumo contado de um lado só)', () => {
  const tmdb = [{ numero: 1, episodios: 13 }, { numero: 2, episodios: 12 }];
  assert.deepStrictEqual(tmdbLib.mapearTemporadas(tmdb, [12, 12])[1], { de: 14, ate: 25 });
});
test('mapa de temporadas: última sem total pega o resto; além do TMDB vira null', () => {
  const tmdb = [{ numero: 1, episodios: 12 }, { numero: 2, episodios: 10 }];
  assert.deepStrictEqual(tmdbLib.mapearTemporadas(tmdb, [12, 0])[1], { de: 13, ate: 22 });
  assert.strictEqual(tmdbLib.mapearTemporadas(tmdb, [12, 10, 8])[2], null);
});
test('localizar episódio corrido na temporada do TMDB', () => {
  const tmdb = [{ numero: 1, episodios: 25 }, { numero: 2, episodios: 12 }];
  assert.deepStrictEqual(tmdbLib.localizarEpisodio(tmdb, 26), { temporada: 2, episodio: 1 });
  assert.strictEqual(tmdbLib.localizarEpisodio(tmdb, 38), null);
});
test('episódios: sem chave, sem série no TMDB ou filme, degrada com o motivo', async () => {
  const sem = (chave) => new Episodios({ chave: () => chave, lerCache: () => null, gravarCache: () => {} });
  const f = { tmdbTvId: 5, temporadas: [{ formato: 'TV', episodios: 12 }, { formato: 'MOVIE', episodios: 1 }] };
  assert.strictEqual((await sem('').daTemporada(f, 0)).motivo, 'chave');
  assert.strictEqual((await sem('x').daTemporada({ ...f, tmdbTvId: '' }, 0)).motivo, 'serie');
  assert.strictEqual((await sem('x').daTemporada(f, 1)).motivo, 'filme');
});
test('episódios: usa o cache em disco sem internet', async () => {
  const eps = [{ n: 1, titulo: 'A', sinopse: 's', imagem: '', duracao: 24, data: '2020-01-01' }, { n: 2, titulo: 'B', sinopse: '', imagem: '', duracao: 24, data: '2020-01-08' }];
  const cache = { 7: { estrutura: { em: Date.now(), dados: [{ numero: 1, episodios: 2 }] }, 1: { em: Date.now(), dados: eps } } };
  const e = new Episodios({ chave: () => 'x', lerCache: () => cache, gravarCache: () => {} });
  const r = await e.daTemporada({ tmdbTvId: 7, temporadas: [{ formato: 'TV', episodios: 2 }] }, 0);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.episodios.map((x) => [x.n, x.titulo]), [[1, 'A'], [2, 'B']]);
});

// ---- Busca: palavras grudadas ("dragonball") ----

test('busca: quando não acha nada, separa a palavra grudada e tenta de novo', async () => {
  const pedidos = [];
  global.fetch = async (_u, o) => {
    const termo = JSON.parse(o.body).variables.termo;
    pedidos.push(termo);
    const achou = termo === 'dragon ball super beerus';
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Page: { media: achou ? [{ ...MIDIA, id: 206814, title: { english: 'Dragon Ball Super: Beerus' } }] : [] } } }) };
  };
  const r = await anilist.pesquisar('dragonball super beerus');
  assert.deepStrictEqual(r.map((x) => x.anilistId), [206814]);
  assert.strictEqual(pedidos[0], 'dragonball super beerus');
  assert.strictEqual(pedidos[pedidos.length - 1], 'dragon ball super beerus');
});
test('busca: as variações não se repetem e têm limite', () => {
  assert.ok(anilist.variacoesDaBusca('onepiece').includes('one piece'));
  assert.ok(anilist.variacoesDaBusca('dragonball super beerus').includes('super beerus'), 'tirar uma palavra');
  assert.deepStrictEqual(anilist.variacoesDaBusca('naruto'), ['nar uto'], 'palavra curta: só uma divisão');
  assert.ok(anilist.variacoesDaBusca('abcdefghijklmnop qrstuvwxyzabcdef').length <= 10);
  assert.deepStrictEqual(anilist.variacoesDaBusca('   '), []);
});
test('busca: quando a busca original acha, não faz tentativas extras', async () => {
  const pedidos = [];
  global.fetch = async (_u, o) => { pedidos.push(1); return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Page: { media: [MIDIA] } } }) }; };
  await anilist.pesquisar('chainsaw man');
  assert.strictEqual(pedidos.length, 1);
});

// Dragon Ball: Z continua em GT, Super e Beerus; Beerus vem do Z e do Kai.
const LIGA = (tipo, id, format = 'TV') => ({ relationType: tipo, node: { id, type: 'ANIME', format } });
const FRANQUIA = {
  1: { relations: { edges: [LIGA('SEQUEL', 2), LIGA('SEQUEL', 6)] } }, // Dragon Ball → Z e Kai
  2: { relations: { edges: [LIGA('PREQUEL', 1), LIGA('SEQUEL', 3), LIGA('SEQUEL', 4), LIGA('SEQUEL', 5)] } }, // Z
  3: { relations: { edges: [LIGA('PREQUEL', 2)] } }, // GT
  4: { relations: { edges: [LIGA('PREQUEL', 2), LIGA('PREQUEL', 6)] } }, // Super
  5: { relations: { edges: [LIGA('PREQUEL', 2), LIGA('PREQUEL', 6)] } }, // Beerus
  6: { relations: { edges: [LIGA('PREQUEL', 1), LIGA('SEQUEL', 4), LIGA('SEQUEL', 5)] } }, // Kai
};
test('franquia que se ramifica: cada série fica separada (Beerus não vira temporada do Dragon Ball)', async () => {
  global.fetch = async (_u, o) => {
    const id = JSON.parse(o.body).variables.id;
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Media: FRANQUIA[id] ? { ...MIDIA, id, status: 'FINISHED', nextAiringEpisode: null, ...FRANQUIA[id] } : null } }) };
  };
  assert.deepStrictEqual((await anilist.temporadas(5)).map((t) => t.anilistId), [5]);
  assert.deepStrictEqual((await anilist.temporadas(2)).map((t) => t.anilistId), [2]);
  assert.deepStrictEqual((await anilist.temporadas(1)).map((t) => t.anilistId), [1]);
});
test('importar: numa franquia que se ramifica, cada série vira um item com o seu progresso', () => {
  const { series } = anilist.agruparLista([1, 2, 4, 5].map((id) => entrada(id, { status: 'completo', vistos: 12 }, FRANQUIA[id])));
  assert.deepStrictEqual(series.map((s) => s.temporadas.map((t) => t.anilistId)).sort(), [[1], [2], [4], [5]]);
});

const { animesParaAtualizar } = require('../lib/filmes');
test('atualizar: séries terminadas são conferidas de novo toda semana (temporada ou filme anunciado depois)', () => {
  const agora = Date.parse('2027-01-10T12:00:00Z');
  const dia = 24 * 3600 * 1000;
  const s = (id, dias, extra = {}) => ({ id, tipo: 'serie', anime: true, anilistId: id, exibicao: 'finalizado', anilistEm: new Date(agora - dias * dia).toISOString(), tmdbTvEm: 'x', ...extra });
  const lista = [s(1, 2), s(2, 8), s(3, 30), s(4, 1, { temporadas: [{ exibicao: 'finalizado' }, { exibicao: 'não lançado' }] }), s(5, 0.1, { exibicao: 'em exibição' })];
  assert.deepStrictEqual(animesParaAtualizar(lista, { agora }).map((f) => f.id), [4, 3, 2]);
  assert.deepStrictEqual(animesParaAtualizar(lista, { agora, maxSemanais: 1 }).map((f) => f.id), [4, 3]);
});
test('atualizar: uma série conferida antes da regra nova das temporadas é conferida de novo', () => {
  const agora = Date.parse('2026-11-17T12:00:00Z');
  const f = { id: 1, tipo: 'serie', anilistId: 1, exibicao: 'finalizado', anilistEm: '2026-11-15T12:00:00Z', tmdbTvEm: 'x' };
  assert.deepStrictEqual(animesParaAtualizar([f], { agora }).map((x) => x.id), [1]);
  assert.deepStrictEqual(animesParaAtualizar([{ ...f, anilistEm: '2026-11-17T00:00:00Z' }], { agora }), []);
});
test('temporadas: a primeira temporada em ONA entra na série (Witch Hat Atelier)', async () => {
  const rede = {
    1: { ...MIDIA, id: 1, format: 'ONA', seasonYear: 2026, status: 'FINISHED', nextAiringEpisode: null, relations: { edges: [LIGA('SEQUEL', 2)] } },
    2: { ...MIDIA, id: 2, format: 'TV', seasonYear: null, startDate: { year: null }, episodes: null, status: 'NOT_YET_RELEASED', nextAiringEpisode: null, relations: { edges: [LIGA('PREQUEL', 1, 'ONA')] } },
  };
  global.fetch = async (_u, o) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ data: { Media: rede[JSON.parse(o.body).variables.id] || null } }) });
  assert.deepStrictEqual((await anilist.temporadas(1)).map((t) => t.anilistId), [1, 2]);
  assert.deepStrictEqual((await anilist.temporadas(2)).map((t) => t.anilistId), [1, 2]);
});

// ---- Importar da Crunchyroll (leitura das respostas do site) ----
const cr = require('../lib/streaming/crunchyroll');

test('crunchyroll: a watchlist (próximo episódio de cada série) vira as séries, com favoritos', () => {
  const resposta = { total: 3, data: [
    { panel: { id: 'E1', type: 'episode', title: 'Ep 5', episode_metadata: { series_id: 'GRDV0019R', series_title: 'Jujutsu Kaisen' } }, is_favorite: true, fully_watched: false },
    { panel: { id: 'G4PH0WXVJ', type: 'series', title: 'SPY x FAMILY' }, is_favorite: false },
    { panel: { id: 'E2', type: 'episode', title: 'Ep 6', episode_metadata: { series_id: 'GRDV0019R', series_title: 'Jujutsu Kaisen' } } },
    { panel: { id: 'M1', type: 'movie', title: 'Suzume', movie_metadata: { movie_listing_id: 'GY8VEQ95Y', movie_listing_title: 'Suzume' } } },
  ] };
  assert.deepStrictEqual(cr.titulos(resposta), [
    { id: 'GRDV0019R', titulo: 'Jujutsu Kaisen', filme: false, favorito: true },
    { id: 'G4PH0WXVJ', titulo: 'SPY x FAMILY', filme: false, favorito: false },
    { id: 'GY8VEQ95Y', titulo: 'Suzume', filme: true, favorito: false },
  ]);
});
test('crunchyroll: Crunchylists e os itens delas, mesmo com o formato mudado', () => {
  assert.deepStrictEqual(cr.crunchylists({ data: [{ list_id: 'abc', title: 'Ver com a namorada', total: 2 }, { list_id: '', title: 'x' }] }), [{ id: 'abc', nome: 'Ver com a namorada' }]);
  // os itens podem vir em data[].panel ou mais fundo: a leitura procura em qualquer lugar
  const itens = { data: [{ list_id: 'abc', id: 'x1', panel: { id: 'S1', type: 'series', title: 'Frieren' } }], meta: { outra: { coisa: [{ type: 'movie_listing', id: 'F1', title: 'Your Name.' }] } } };
  assert.deepStrictEqual(cr.titulos(itens).map((x) => [x.titulo, x.filme]), [['Frieren', false], ['Your Name.', true]]);
  assert.deepStrictEqual(cr.titulos(null), []);
  assert.strictEqual(cr.idDaConta({ account_id: 'u-1' }), 'u-1');
  assert.ok(cr.consultas.watchlist('u 1').includes('/discover/u%201/watchlist') && cr.consultas.watchlist('x').includes('locale=en-US'));
});

// ---- Importar dos serviços de streaming: do título ao anime ----
const idt = require('../lib/streaming/identificar');
const resAnilist = (id, titulo, ano, filme, nomes) => ({ anilistId: id, titulo, ano, filme, formato: filme ? 'MOVIE' : 'TV', nomes });
test('streaming: o anime certo é o que tem o mesmo nome (do mesmo tipo e da mesma época)', () => {
  const r = [resAnilist(2, 'Attack on Titan Final Season', '2021', false, ['Shingeki no Kyojin: The Final Season']), resAnilist(1, 'Attack on Titan', '2013', false, ['Attack on Titan', 'Shingeki no Kyojin', '進撃の巨人'])];
  assert.strictEqual(idt.escolherAnime(r, { nomes: ['進撃の巨人'], filme: false, ano: '2013' }).anilistId, 1);
  assert.strictEqual(idt.escolherAnime(r, { nomes: ['Breaking Bad'] }), null, 'sem o TMDB confirmar, nome diferente não serve');
  assert.strictEqual(idt.escolherAnime(r, { nomes: ['Outro Nome'], filme: false, ano: '2021', confirmado: true }).anilistId, 2, 'com o TMDB confirmando, serve o mais relevante da mesma época');
});
test('streaming: o que o TMDB diz que não é anime nem vai para a AniList', async () => {
  const pedidos = [];
  const anilistFalsa = { pesquisar: async (t, o) => { pedidos.push([t, o]); return t === '進撃の巨人' ? [resAnilist(1, 'Attack on Titan', '2013', false, ['進撃の巨人'])] : []; } };
  const tmdbFalso = { animeJapones: async (_k, t) => (t === 'Breaking Bad' ? { anime: false, filme: false, original: 'Breaking Bad', ano: '2008' } : { anime: true, filme: false, original: '進撃の巨人', ano: '2013' }) };
  const itens = [{ titulo: 'Breaking Bad', filme: null }, { titulo: 'Ataque dos Titãs', filme: null }, { titulo: 'Ataque dos Titãs', filme: null }];
  const progresso = [];
  const r = await idt.identificarTodos(itens, { anilist: anilistFalsa, tmdb: tmdbFalso, chaveTmdb: 'k' }, (f, t) => progresso.push(`${f}/${t}`));
  assert.deepStrictEqual(r.map((x) => [x.naoAnime, x.anime && x.anime.anilistId]), [[true, null], [false, 1], [false, 1]]);
  assert.deepStrictEqual(pedidos, [['進撃の巨人', { exata: true }]], 'só o anime foi procurado, pelo nome em japonês, uma vez');
  assert.deepStrictEqual(progresso, ['1/2', '2/2']);
});
test('streaming: a Crunchyroll (tudo é anime) procura direto, com as tentativas extras da busca', async () => {
  const anilistFalsa = { pesquisar: async (t, o) => (o ? [] : [resAnilist(5, 'Frieren', '2023', false)]) };
  const r = await idt.identificarTodos([{ titulo: 'Frieren', filme: false, tudoAnime: true }], { anilist: anilistFalsa, tmdb: null });
  assert.strictEqual(r[0].anime.anilistId, 5);
});
test('streaming: os serviços têm o que a janela precisa', () => {
  const { SERVICOS, scriptLer, SCRIPT_BOTAO } = require('../lib/streaming/servicos');
  for (const s of SERVICOS) {
    assert.ok(s.ID && s.NOME && s.LISTA && /^https:\/\//.test(s.URL), s.ID);
    assert.doesNotThrow(() => new Function(`return ${scriptLer(s)}`), s.ID);
  }
  assert.doesNotThrow(() => new Function(`return ${SCRIPT_BOTAO}`));
});
test('streaming: animação de fora do Japão entra se a AniList tiver, da mesma época (Scott Pilgrim sim; Devil May Cry de 2025 não vira o de 2007)', async () => {
  const anilistFalsa = { pesquisar: async (t) => ({
    'Scott Pilgrim Takes Off': [resAnilist(7, 'Scott Pilgrim Takes Off', '2023', false, ['Scott Pilgrim Takes Off'])],
    'Devil May Cry': [resAnilist(8, 'Devil May Cry', '2007', false, ['Devil May Cry', 'デビル メイ クライ'])],
  }[t] || []) };
  const tmdbFalso = { animeJapones: async (_k, t) => (t === 'Devil May Cry'
    ? { anime: false, animacao: true, filme: false, original: 'Devil May Cry', ano: '2025' }
    : { anime: false, animacao: true, filme: false, original: 'Scott Pilgrim Takes Off', ano: '2023' }) };
  const r = await idt.identificarTodos([{ titulo: 'Scott Pilgrim: A Série', filme: null }, { titulo: 'Devil May Cry', filme: null }], { anilist: anilistFalsa, tmdb: tmdbFalso, chaveTmdb: 'k' });
  assert.deepStrictEqual(r.map((x) => [x.anime && x.anime.anilistId, x.naoAnime]), [[7, false], [null, false]], 'o que não está na AniList fica para a busca à mão, não como "não é anime"');
});
