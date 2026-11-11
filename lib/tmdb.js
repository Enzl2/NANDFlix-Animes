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

module.exports = { ErroTmdb, capaSerie, separarTemporada, pesquisar, idPorImdb, idPorTitulo, detalhes, capas, relacionados };
