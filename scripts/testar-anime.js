// node scripts/testar-anime.js: confere as regras de animes (NANDRoll) sem
// precisar de internet: a AniList é simulada com uma resposta de exemplo.
const assert = require('assert');
const test = require('node:test');
const { novoFilme, mesmoFilme, progressoSerie, statusSerie, comDia, vistoSerie, ehSerie, passoSerie, totalTemporadas } = require('../lib/filmes');
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
    '/tv/114410': { overview: 'Denji é um caçador.' },
    '/tv/114410/imagesX': { posters: [{ file_path: '/en.jpg', iso_639_1: 'en', vote_average: 9 }, { file_path: '/ja.jpg', iso_639_1: 'ja', vote_average: 5 }], logos: [{ file_path: '/logo-en.png', iso_639_1: 'en', vote_average: 1 }] },
  });
  const c = await tmdb.capaSerie('chave', { titulo: 'Chainsaw Man', tituloRomaji: 'Chainsaw Man' });
  assert.deepStrictEqual(c, { tmdbTvId: 114410, temporada: 0, poster: 'https://image.tmdb.org/t/p/w780/ja.jpg', logo: 'https://image.tmdb.org/t/p/w500/logo-en.png', sinopse: 'Denji é um caçador.' });
  assert.deepStrictEqual(pedidos.sort(), ['/search/tv?Chainsaw Man', '/tv/114410', '/tv/114410/images'].sort());
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

test('anilist.temporadas: de qualquer temporada, acha todas em ordem (sem o filme nem o curta anterior)', async () => {
  const pedidos = simularRede();
  const ts = await anilist.temporadas(13);
  assert.deepStrictEqual(ts.map((t) => t.anilistId), [11, 13, 14]);
  assert.strictEqual(new Set(pedidos).size, pedidos.length, 'cada entrada é pedida uma vez');
});
test('anilist.camposSerie: um item só, com a soma e o progresso preservado', async () => {
  simularRede();
  const ts = await anilist.temporadas(13);
  const m = anilist.camposSerie(ts, serie({ titulo: 'Série Season 2', ano: '2023', anilistId: 13 }), { novo: true });
  assert.strictEqual(m.titulo, 'Série');
  assert.strictEqual(m.anilistId, 11);
  assert.strictEqual(m.episodios, 22);
  assert.strictEqual(m.exibicao, 'em exibição');
  assert.deepStrictEqual(m.temporadas.map((t) => [t.titulo, t.episodios, t.vistos]), [['Série', 12, 0], ['Série Season 2', 10, 0], ['Shirizu 3rd Season', 0, 0]]);
  // atualizar depois não perde o que a pessoa já viu
  const visto = { ...serie(), ...m, temporadas: m.temporadas.map((t, i) => ({ ...t, vistos: [12, 4, 0][i] })) };
  const de_novo = anilist.camposSerie(ts, visto);
  assert.deepStrictEqual(de_novo.temporadas.map((t) => t.vistos), [12, 4, 0]);
  assert.strictEqual(de_novo.episodiosVistos, 16);
  assert.ok(!('titulo' in de_novo));
});
