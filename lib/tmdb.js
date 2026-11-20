// Consultas ao TMDB (themoviedb.org): capas, logos, trailers, sinopse, gêneros,
// elenco, direção, duração, países e classificação indicativa. Sem limite diário
// (só um limite por segundo, folgado). Aceita a chave da API (v3, 32 caracteres)
// ou o token de leitura (v4, bem mais longo).
const BASE = 'https://api.themoviedb.org/3';
const IMAGEM = 'https://image.tmdb.org/t/p/';

class ErroTmdb extends Error {
  constructor(tipo, mensagem) {
    super(mensagem);
    this.tipo = tipo; // 'chave' | 'rede'
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(chave, caminho, params = {}, tentativa = 0) {
  chave = String(chave || '').trim();
  if (!chave) throw new ErroTmdb('chave', 'Coloque a chave do TMDB em Configurações.');
  const token = chave.length > 40;
  const qs = new URLSearchParams(token ? params : { api_key: chave, ...params });
  let resposta;
  try {
    resposta = await fetch(`${BASE}${caminho}?${qs}`, {
      headers: token ? { Authorization: `Bearer ${chave}`, Accept: 'application/json' } : { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErroTmdb('rede', 'Sem conexão com o TMDB.');
  }
  if (resposta.status === 401) throw new ErroTmdb('chave', 'A chave do TMDB está errada. Confira em Configurações.');
  if (resposta.status === 404) return null;
  // Muitas consultas no mesmo segundo: espera um pouco e tenta de novo.
  if (resposta.status === 429 && tentativa < 4) {
    await espera(1000 * (tentativa + 1));
    return consultar(chave, caminho, params, tentativa + 1);
  }
  if (!resposta.ok) throw new ErroTmdb('rede', `O TMDB respondeu com erro ${resposta.status}.`);
  return resposta.json();
}

// Logos em SVG (sem tamanho próprio, somem na tela) são pedidas em PNG: o TMDB converte pela extensão.
const imagem = (caminho, tamanho) => (caminho ? `${IMAGEM}${tamanho}${String(caminho).replace(/\.svg$/i, '.png')}` : '');
const anoDe = (data) => (data ? String(data).slice(0, 4) : '');

// Resultado de busca, no mesmo formato da busca antiga do OMDb (mais o tmdbId).
function resultado(m) {
  return { tmdbId: m.id, imdbID: '', titulo: m.title || m.original_title, ano: anoDe(m.release_date), poster: imagem(m.poster_path, 'w342') };
}

async function pesquisar(chave, termo, ano) {
  const params = { query: termo, include_adult: 'false', language: 'en-US' };
  if (ano) params.primary_release_year = ano;
  const json = await consultar(chave, '/search/movie', params);
  return json ? json.results.map(resultado) : [];
}

// Código do IMDb (tt…) → id do TMDB, ou null.
async function idPorImdb(chave, imdbID) {
  const json = await consultar(chave, `/find/${imdbID}`, { external_source: 'imdb_id' });
  const m = json && json.movie_results && json.movie_results[0];
  return m ? m.id : null;
}

const comparavel = (t) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, 'and').replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();

// Acha o filme pelo título e ano (ano ±1, como no OMDb), preferindo o título
// idêntico (o traduzido ou o original). Devolve o id do TMDB ou null.
async function idPorTitulo(chave, titulo, ano) {
  const alvo = comparavel(titulo);
  const tentativas = /^\d{4}$/.test(String(ano).trim()) ? [Number(ano), Number(ano) + 1, Number(ano) - 1, null] : [null];
  for (const a of tentativas) {
    const params = { query: titulo, include_adult: 'false' };
    if (a) params.primary_release_year = a;
    const json = await consultar(chave, '/search/movie', params);
    const lista = (json && json.results) || [];
    const exato = lista.find((m) => comparavel(m.title) === alvo || comparavel(m.original_title) === alvo);
    if (exato) return exato.id;
    if (a === null && lista[0]) return lista[0].id;
  }
  return null;
}

// Imagem preferida: na ordem dos idiomas pedidos; dentro de um idioma, a mais votada.
function escolherImagem(lista, idiomas) {
  for (const idioma of idiomas) {
    const daqui = lista.filter((i) => (i.iso_639_1 || null) === idioma);
    if (daqui.length) return daqui.sort((a, b) => (b.vote_average - a.vote_average) || (b.vote_count - a.vote_count))[0];
  }
  return lista[0] || null;
}

// Trailer oficial no YouTube: inglês primeiro (a versão original costuma estar
// nele), depois português, depois qualquer um; "Trailer" antes de "Teaser".
function escolherTrailer(videos) {
  const doYoutube = (videos || []).filter((v) => v.site === 'YouTube' && /^(Trailer|Teaser)$/.test(v.type));
  const nota = (v) => (v.type === 'Trailer' ? 2 : 0) + (v.official ? 1 : 0) + (v.iso_639_1 === 'en' ? 4 : v.iso_639_1 === 'pt' ? 3 : 0);
  const melhor = doYoutube.sort((a, b) => nota(b) - nota(a))[0];
  return melhor ? melhor.key : '';
}

// Classificação indicativa do Brasil ("L", "10", "12", "14", "16", "18"); se não houver, a dos EUA.
function classificacao(releaseDates) {
  const de = (pais) => {
    const r = ((releaseDates && releaseDates.results) || []).find((x) => x.iso_3166_1 === pais);
    const c = r && r.release_dates.map((d) => d.certification).find(Boolean);
    return c || '';
  };
  return de('BR') || de('US');
}

// Tudo o que o app guarda de um filme. `id` é o do TMDB.
async function detalhes(chave, id) {
  const [d, imagens, en] = await Promise.all([
    consultar(chave, `/movie/${id}`, {
      language: 'pt-BR',
      append_to_response: 'videos,release_dates,credits,external_ids',
      include_video_language: 'en,pt,null',
    }),
    consultar(chave, `/movie/${id}/images`),
    // Em inglês: o título usado na lista (como no Letterboxd) e a sinopse reserva.
    consultar(chave, `/movie/${id}`, { language: 'en-US' }).catch(() => null),
  ]);
  if (!d) return null;
  // Sem sinopse em português: usa a em inglês.
  const sinopse = d.overview || (en && en.overview) || '';
  const original = d.original_language || 'en';
  // Capa: sempre a do idioma original do filme (a capa "de lançamento").
  const poster = escolherImagem((imagens && imagens.posters) || [], [original, 'en', null]);
  // Logo: inglês primeiro (legível para qualquer filme), depois o idioma original.
  const logo = escolherImagem(((imagens && imagens.logos) || []).filter((l) => l.file_path), ['en', original, 'pt', null]);
  const crew = (d.credits && d.credits.crew) || [];
  const diretores = crew.filter((c) => c.job === 'Director').map((c) => c.name);
  return {
    tmdbId: d.id,
    idiomaOriginal: original,
    imdbID: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || '',
    titulo: (en && en.title) || d.original_title || d.title,
    ano: anoDe(d.release_date),
    diretor: diretores.join(', '),
    poster: imagem((poster && poster.file_path) || d.poster_path, 'w780'),
    logo: imagem(logo && logo.file_path, 'w500'),
    fundo: imagem(d.backdrop_path, 'w1280'),
    trailerId: escolherTrailer(d.videos && d.videos.results),
    duracao: d.runtime || 0,
    info: {
      duracao: d.runtime ? `${d.runtime} min` : '',
      genero: (d.genres || []).map((g) => g.name).join(', '),
      classificacao: classificacao(d.release_dates),
      sinopse,
      elenco: ((d.credits && d.credits.cast) || []).slice(0, 6).map((c) => c.name).join(', '),
      // Em inglês, como o OMDb dava: o app traduz os nomes dos países.
      pais: (d.production_countries || []).map((p) => p.name).join(', '),
      // A nota do TMDB (de 0 a 10), com pelo menos 10 votos.
      tmdb: d.vote_count >= 10 && d.vote_average ? Number(d.vote_average).toFixed(1) : '',
    },
  };
}

// Todas as capas do filme, para escolher outra: idioma original primeiro.
async function capas(chave, id, original, tipo = 'movie') {
  const imagens = await consultar(chave, `/${tipo === 'tv' ? 'tv' : 'movie'}/${id}/images`);
  const lista = ((imagens && imagens.posters) || []).slice();
  const peso = (p) => (p.iso_639_1 === original ? 3 : p.iso_639_1 === 'en' ? 2 : p.iso_639_1 === 'pt' ? 1 : 0);
  lista.sort((a, b) => (peso(b) - peso(a)) || (b.vote_average - a.vote_average));
  return lista.map((p) => ({ poster: imagem(p.file_path, 'w780'), miniatura: imagem(p.file_path, 'w342'), idioma: p.iso_639_1 || '' }));
}

// Para os detalhes: os outros filmes dirigidos por quem dirigiu este (até dois
// diretores, do mais novo para o mais antigo) e as recomendações do TMDB.
async function relacionados(chave, id) {
  const [creditos, recs] = await Promise.all([
    consultar(chave, `/movie/${id}/credits`),
    consultar(chave, `/movie/${id}/recommendations`, { language: 'en-US' }),
  ]);
  const diretores = ((creditos && creditos.crew) || []).filter((c) => c.job === 'Director').slice(0, 2);
  const filmografias = await Promise.all(diretores.map(async (d) => {
    const mc = await consultar(chave, `/person/${d.id}/movie_credits`, { language: 'en-US' });
    const ja = new Set([Number(id)]);
    const filmes = ((mc && mc.crew) || [])
      .filter((c) => c.job === 'Director' && c.release_date && !ja.has(c.id) && ja.add(c.id))
      .sort((a, b) => (b.release_date || '0').localeCompare(a.release_date || '0'))
      .map(resultado);
    return { nome: d.name, filmes };
  }));
  return {
    diretores: filmografias.filter((d) => d.filmes.length),
    recomendacoes: ((recs && recs.results) || []).slice(0, 18).map(resultado),
  };
}

// ---------- Séries de anime (NANDRoll): capa e logo ----------

// A AniList tem uma entrada por temporada ("Spy x Family Season 2"); o TMDB tem
// a série inteira, com as temporadas dentro. Separa o nome da série e o número.
function separarTemporada(titulo) {
  const t = String(titulo || '').trim();
  const m = t.match(/^(.*?)[\s:,-]*\b(?:(?:season|temporada)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season)\b.*$/i);
  if (m && m[1].trim()) return { base: m[1].trim(), temporada: Number(m[2] || m[3]) };
  // "Cour 2" e "Part 2" são pedaços de uma temporada: sai do nome, sem número de temporada.
  const p = t.match(/^(.*?)[\s:,-]*\b(?:cour|part)\s*\d+\b.*$/i);
  return { base: p && p[1].trim() ? p[1].trim() : t, temporada: 0 };
}

const ANIMACAO = 16; // gênero "Animation" do TMDB

// Capa e logo de uma série de anime no TMDB (bem maiores que as da AniList).
// Procura pelo título em inglês e em romaji, com e sem a temporada, e só aceita
// animações (para não pegar uma série de mesmo nome). Com temporada no título,
// usa a capa daquela temporada, se houver. Devolve null se não achar.
async function capaSerie(chave, { titulo, tituloRomaji } = {}) {
  const nomes = [];
  let temporada = 0;
  for (const t of [titulo, tituloRomaji]) {
    if (!t) continue;
    const s = separarTemporada(t);
    if (s.temporada) temporada = temporada || s.temporada;
    for (const n of [t, s.base]) if (n && !nomes.includes(n)) nomes.push(n);
  }
  let achada = null;
  for (const nome of nomes) {
    const json = await consultar(chave, '/search/tv', { query: nome, include_adult: 'false' });
    const lista = ((json && json.results) || []).filter((r) => (r.genre_ids || []).includes(ANIMACAO));
    const alvo = comparavel(nome);
    achada = lista.find((r) => comparavel(r.name) === alvo || comparavel(r.original_name) === alvo) || lista[0] || null;
    if (achada) break;
  }
  if (!achada) return null;
  const original = achada.original_language || 'ja';
  const [imagens, daTemporada, pt, externos] = await Promise.all([
    consultar(chave, `/tv/${achada.id}/images`),
    temporada > 1 ? consultar(chave, `/tv/${achada.id}/season/${temporada}/images`).catch(() => null) : null,
    // A sinopse em português (a AniList só tem em inglês): a da temporada, se for uma continuação.
    consultar(chave, temporada > 1 ? `/tv/${achada.id}/season/${temporada}` : `/tv/${achada.id}`, { language: 'pt-BR' }).catch(() => null),
    // O código do IMDb: com ele o Stremio abre direto na série e o OMDb dá as notas.
    consultar(chave, `/tv/${achada.id}/external_ids`).catch(() => null),
  ]);
  const posters = (daTemporada && daTemporada.posters && daTemporada.posters.length ? daTemporada.posters : (imagens && imagens.posters)) || [];
  const poster = escolherImagem(posters, [original, 'en', null]);
  const logo = escolherImagem(((imagens && imagens.logos) || []).filter((l) => l.file_path), ['en', original, 'pt', null]);
  return {
    tmdbTvId: achada.id,
    temporada,
    poster: imagem((poster && poster.file_path) || achada.poster_path, 'w780'),
    logo: imagem(logo && logo.file_path, 'w500'),
    sinopse: (pt && pt.overview) || '',
    imdbID: (externos && /^tt\d+$/.test(externos.imdb_id || '') && externos.imdb_id) || '',
  };
}

// ---------- Episódios das séries (NANDRoll) ----------

// A estrutura da série no TMDB: as temporadas (sem a 0, de especiais) e quantos
// episódios cada uma tem.
async function temporadasDaSerie(chave, tvId) {
  const d = await consultar(chave, `/tv/${tvId}`, { language: 'pt-BR' });
  if (!d) return null;
  return (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => ({ numero: s.season_number, episodios: s.episode_count }))
    .sort((a, b) => a.numero - b.numero);
}

// Os episódios de uma temporada: número, nome, sinopse, imagem, duração e data.
// Em português; o que vier vazio ou sem nome de verdade é completado em inglês.
async function episodiosTemporada(chave, tvId, n) {
  const pt = await consultar(chave, `/tv/${tvId}/season/${n}`, { language: 'pt-BR' });
  if (!pt) return null;
  const lista = pt.episodes || [];
  const generico = (e) => !e.name || /^(epis[oó]dio|episode)\s*\d+$/i.test(e.name.trim());
  let en = null;
  if (lista.some((e) => generico(e) || !e.overview)) en = await consultar(chave, `/tv/${tvId}/season/${n}`, { language: 'en-US' }).catch(() => null);
  const emIngles = new Map(((en && en.episodes) || []).map((e) => [e.episode_number, e]));
  return lista.map((e) => {
    const b = emIngles.get(e.episode_number) || {};
    return {
      n: e.episode_number,
      titulo: (!generico(e) ? e.name : b.name && !generico(b) ? b.name : e.name) || '',
      sinopse: e.overview || b.overview || '',
      imagem: imagem(e.still_path || b.still_path, 'w300'),
      duracao: e.runtime || b.runtime || 0,
      data: e.air_date || b.air_date || '',
    };
  });
}

// O código do IMDb de uma série (para o Stremio abrir direto nela).
async function imdbDaSerie(chave, tvId) {
  const x = await consultar(chave, `/tv/${tvId}/external_ids`);
  return (x && /^tt\d+$/.test(x.imdb_id || '') && x.imdb_id) || '';
}

// A AniList divide a série em entradas (temporadas, partes) e o TMDB em
// temporadas, e nem sempre coincidem (Attack on Titan: a 3ª do TMDB tem 22
// episódios, a AniList tem duas de 12 e 10). Por isso o mapa é por episódio
// corrido: a soma dos episódios das entradas anteriores diz onde começa cada uma.
// Se esse ponto cai a até 2 episódios do começo de uma temporada do TMDB (um
// especial ou resumo contado de um lado só), encosta nele.
// `tmdb`: [{ numero, episodios }]; `anilist`: episódios de cada entrada (0 = sem total ainda).
// Devolve, para cada entrada, { de, ate } em episódios corridos do TMDB (de 1), ou null.
function mapearTemporadas(tmdb, anilist) {
  const total = tmdb.reduce((s, t) => s + t.episodios, 0);
  const inicios = [];
  let acc = 0;
  for (const t of tmdb) { inicios.push(acc); acc += t.episodios; }
  let desloc = 0;
  return anilist.map((qtd, i) => {
    let ini = desloc;
    const perto = inicios.find((b) => b !== ini && Math.abs(b - ini) <= 2);
    if (perto !== undefined && ini > 0) ini = perto;
    const fim = qtd > 0 ? ini + qtd : (i === anilist.length - 1 ? total : ini);
    desloc = fim;
    if (ini >= total || fim <= ini) return null;
    return { de: ini + 1, ate: Math.min(fim, total) };
  });
}

// O episódio corrido `k` (de 1) → { temporada, episodio } do TMDB, ou null.
function localizarEpisodio(tmdb, k) {
  let resto = k;
  for (const t of tmdb) {
    if (resto <= t.episodios) return { temporada: t.numero, episodio: resto };
    resto -= t.episodios;
  }
  return null;
}

// ---------- Onde assistir e nota do TMDB ----------
//
// Os serviços de streaming vêm do JustWatch, pelo TMDB (o TMDB pede o crédito
// ao JustWatch onde eles aparecem). `pais`: código de duas letras (BR, US…).

const provedor = (p) => ({ id: p.provider_id, nome: p.provider_name, logo: imagem(p.logo_path, 'w92') });
const DIA = 24 * 60 * 60 * 1000;

// Está nos cinemas do país? Estreou (lançamento 2 = limitado, 3 = cinema) há até
// 75 dias e ainda não saiu em digital (4). Estreia nos próximos 30 dias = em breve.
function situacaoCinema(releaseDates, pais, agora = Date.now()) {
  const r = ((releaseDates && releaseDates.results) || []).find((x) => x.iso_3166_1 === pais);
  const datas = (r && r.release_dates) || [];
  const quando = (tipos) => datas.filter((d) => tipos.includes(d.type) && d.release_date).map((d) => Date.parse(d.release_date)).sort((a, b) => a - b);
  const cinema = quando([2, 3]);
  const digital = quando([4]);
  if (!cinema.length) return { cinema: false };
  if (digital.length && digital[0] <= agora) return { cinema: false };
  const estreou = cinema.filter((t) => t <= agora).pop();
  if (estreou && agora - estreou <= 75 * DIA) return { cinema: 'agora', cinemaData: new Date(estreou).toISOString().slice(0, 10) };
  const proxima = cinema.find((t) => t > agora);
  if (proxima && proxima - agora <= 30 * DIA) return { cinema: 'em-breve', cinemaData: new Date(proxima).toISOString().slice(0, 10) };
  return { cinema: false };
}

async function ondeAssistir(chave, id, pais = 'BR') {
  const d = await consultar(chave, `/movie/${id}`, { append_to_response: 'watch/providers,release_dates' });
  if (!d) return null;
  const w = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[pais]) || {};
  const lista = (x) => (x || []).sort((a, b) => (a.display_priority || 0) - (b.display_priority || 0)).map(provedor);
  return {
    nota: d.vote_count >= 10 && d.vote_average ? Number(d.vote_average).toFixed(1) : '',
    onde: {
      link: w.link || '',
      assinatura: lista(w.flatrate),
      gratis: lista([...(w.free || []), ...(w.ads || [])]),
      aluguel: lista(w.rent),
      compra: lista(w.buy),
    },
    ...situacaoCinema(d.release_dates, pais),
  };
}

// O fundo (a arte em paisagem) de um filme ou série, para o destaque da tela inicial.
async function fundo(chave, id, tipo = 'movie') {
  const d = await consultar(chave, `/${tipo === 'tv' ? 'tv' : 'movie'}/${id}`);
  return imagem(d && d.backdrop_path, 'w1280');
}

// Os ids do TMDB dos filmes em cartaz no país (as 3 primeiras páginas).
async function emCartaz(chave, pais = 'BR') {
  const ids = new Set();
  for (let pagina = 1; pagina <= 3; pagina++) {
    const json = await consultar(chave, '/movie/now_playing', { region: pais, page: pagina });
    for (const m of (json && json.results) || []) ids.add(m.id);
    if (!json || pagina >= (json.total_pages || 1)) break;
  }
  return ids;
}

// A arte da página de detalhes (PC): o fundo do alto (uma imagem sem texto, a
// mais votada), os fotogramas (as seguintes) e o título original, quando é
// outro (Oldboy → 올드보이). `tipo`: 'movie' (filme) ou 'tv' (série de anime).
async function arte(chave, id, tipo = 'movie') {
  const t = tipo === 'tv' ? 'tv' : 'movie';
  const [d, imagens] = await Promise.all([
    consultar(chave, `/${t}/${id}`, { language: 'pt-BR' }),
    consultar(chave, `/${t}/${id}/images`),
  ]);
  if (!d) return null;
  const fundos = ((imagens && imagens.backdrops) || []).filter((b) => b.file_path);
  // Sem texto (iso nulo) primeiro: são as cenas; as com idioma costumam ter o título escrito.
  const ordem = (b) => (b.iso_639_1 ? 0 : 1);
  fundos.sort((a, b) => (ordem(b) - ordem(a)) || (b.vote_average - a.vote_average) || (b.vote_count - a.vote_count));
  const semTexto = fundos.filter((b) => !b.iso_639_1);
  const principal = semTexto[0] || fundos[0] || null;
  const original = t === 'tv' ? d.original_name : d.original_title;
  return {
    fundo: principal ? imagem(principal.file_path, 'w1280') : imagem(d.backdrop_path, 'w1280'),
    fotogramas: semTexto.filter((b) => b !== principal).slice(0, 8).map((b) => imagem(b.file_path, 'w780')),
    tituloOriginal: original || '',
  };
}

// Os serviços de streaming do país, para escolher os seus em Configurações.
async function provedores(chave, pais = 'BR') {
  const json = await consultar(chave, '/watch/providers/movie', { watch_region: pais, language: 'pt-BR' });
  return ((json && json.results) || [])
    .sort((a, b) => ((a.display_priorities && a.display_priorities[pais]) || a.display_priority || 99) - ((b.display_priorities && b.display_priorities[pais]) || b.display_priority || 99))
    .map(provedor);
}

// Um título visto num serviço de streaming (em português, como o serviço
// mostra) é anime? Procura no TMDB entre séries e filmes: é anime se for
// animação (gênero 16) de origem japonesa. Devolve null se o TMDB não achar
// nada; senão { anime, animacao, filme, original, ano }, com o título original
// (japonês), que acha o anime certo na AniList mesmo quando o nome traduzido
// não ajuda ("Ataque dos Titãs" → 進撃の巨人).
const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function animeJapones(chave, titulo) {
  const json = await consultar(chave, '/search/multi', { query: titulo, include_adult: 'false', language: 'pt-BR' });
  const obras = ((json && json.results) || []).filter((m) => m.media_type === 'tv' || m.media_type === 'movie');
  if (!obras.length) return null;
  const alvo = normal(titulo);
  const nomeDe = (m) => m.name || m.title || '';
  const animacao = (m) => (m.genre_ids || []).includes(16);
  const ehAnime = (m) => animacao(m) && (m.original_language === 'ja' || (m.origin_country || []).includes('JP'));
  // O mesmo nome primeiro e, entre eles, a animação mais relevante (o "Devil
  // May Cry" da Netflix é o de 2025, não o anime de 2007); senão, o mais
  // relevante. Com o mesmo nome há às vezes um live-action ("Ataque dos
  // Titãs", o filme): se um anime está entre os mais relevantes, a lista era dele.
  const mesmos = obras.filter((m) => normal(nomeDe(m)) === alvo || normal(m.original_name || m.original_title) === alvo);
  const m = mesmos.find(animacao) || obras.slice(0, 3).find(ehAnime) || mesmos[0] || obras[0];
  return {
    anime: ehAnime(m),
    // Animação de fora do Japão (Castlevania, Devil May Cry de 2025, Scott
    // Pilgrim): pode ou não estar na AniList; quem decide é ela.
    animacao: animacao(m),
    filme: m.media_type === 'movie',
    original: m.original_name || m.original_title || nomeDe(m),
    ano: anoDe(m.first_air_date || m.release_date),
  };
}

module.exports = { animeJapones, ErroTmdb, capaSerie, temporadasDaSerie, episodiosTemporada, imdbDaSerie, mapearTemporadas, localizarEpisodio, separarTemporada, pesquisar, idPorImdb, idPorTitulo, detalhes, capas, relacionados, ondeAssistir, fundo, emCartaz, provedores, situacaoCinema, arte };
