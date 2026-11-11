// Consultas à AniList (anilist.co): a fonte dos animes do NANDRoll. Capa,
// trailer, sinopse, gêneros, estúdio, número de episódios, se está em exibição,
// quando sai o próximo episódio e os links oficiais de onde assistir.
// Não precisa de chave. O limite é por minuto (a resposta 429 diz quanto esperar).
const { totalTemporadas, temporadaConta } = require('./filmes');

const URL_API = 'https://graphql.anilist.co';

class ErroAnilist extends Error {
  constructor(tipo, mensagem) {
    super(mensagem);
    this.tipo = tipo; // 'rede'
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(query, variables = {}, tentativa = 0) {
  let resposta;
  try {
    resposta = await fetch(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ErroAnilist('rede', 'Sem conexão com a AniList.');
  }
  // Muitas consultas no mesmo minuto: espera o que a AniList pedir e tenta de novo.
  if (resposta.status === 429 && tentativa < 3) {
    const pedido = Number(resposta.headers.get('Retry-After')) || 0;
    await espera(Math.min(Math.max(pedido, 1), 60) * 1000);
    return consultar(query, variables, tentativa + 1);
  }
  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new ErroAnilist('rede', `A AniList respondeu com erro ${resposta.status}.`);
  const json = await resposta.json();
  return json && json.data ? json.data : null;
}

// Os campos pedidos de cada anime, na busca e nos detalhes.
const CAMPOS_BUSCA = `
  id idMal format status episodes seasonYear
  startDate { year }
  title { romaji english }
  coverImage { large extraLarge }`;

const CAMPOS_DETALHES = `${CAMPOS_BUSCA}
  duration season averageScore countryOfOrigin
  description(asHtml: false)
  genres
  bannerImage
  trailer { id site }
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
  externalLinks { site url type language }
  relations { edges { relationType node { id type format } } }`;

// Formatos da AniList. Só "MOVIE" é filme: o resto tem episódios.
const FORMATOS = { TV: 'TV', TV_SHORT: 'TV (curto)', MOVIE: 'Filme', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Clipe' };
const EXIBICAO = { FINISHED: 'finalizado', RELEASING: 'em exibição', NOT_YET_RELEASED: 'não lançado', CANCELLED: 'cancelado', HIATUS: 'em hiato' };

// Os gêneros da AniList vêm em inglês; o resto do app (TMDB) está em português.
const GENEROS = {
  Action: 'Ação', Adventure: 'Aventura', Comedy: 'Comédia', Drama: 'Drama', Ecchi: 'Ecchi', Fantasy: 'Fantasia',
  Horror: 'Terror', 'Mahou Shoujo': 'Garota mágica', Mecha: 'Mecha', Music: 'Música', Mystery: 'Mistério',
  Psychological: 'Psicológico', Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Slice of Life': 'Slice of life',
  Sports: 'Esporte', Supernatural: 'Sobrenatural', Thriller: 'Thriller',
};

const ehFilme = (formato) => formato === 'MOVIE';
const tituloDe = (m) => (m.title && (m.title.english || m.title.romaji)) || '';
const anoDe = (m) => String(m.seasonYear || (m.startDate && m.startDate.year) || '');

// A sinopse vem com <br>, <i> e, às vezes, "(Source: …)" no fim.
function limparSinopse(texto) {
  return String(texto || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n\s*\(Source:[^)]*\)\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Links oficiais de streaming, um por site (a AniList lista um por idioma: o em
// português tem preferência).
function ondeAssistir(links) {
  const porSite = new Map();
  for (const l of links || []) {
    if (l.type !== 'STREAMING' || !l.url || !/^https?:\/\//i.test(l.url)) continue;
    const chave = String(l.site || '').toLowerCase();
    const pt = /portugu/i.test(l.language || '');
    if (!porSite.has(chave) || (pt && !porSite.get(chave).pt)) porSite.set(chave, { site: l.site, url: l.url, pt });
  }
  return [...porSite.values()].map(({ site, url }) => ({ site, url }));
}

// Formatos que contam como temporada (filmes e especiais ficam de fora da lista,
// mas a corrente de continuações passa por eles).
const FORMATOS_TEMPORADA = new Set(['TV', 'TV_SHORT', 'ONA']);

// A continuação (ou o anterior) de um anime: de preferência outra temporada.
function vizinho(m, tipo) {
  const nos = ((m.relations && m.relations.edges) || [])
    .filter((e) => e.relationType === tipo && e.node && e.node.type === 'ANIME' && e.node.format !== 'MUSIC')
    .map((e) => e.node);
  return (nos.find((n) => FORMATOS_TEMPORADA.has(n.format)) || nos[0] || {}).id || null;
}

// Resultado de busca, no formato dos resultados do TMDB (mais o que é de anime).
function resultado(m) {
  const eps = m.episodes ? ` · ${m.episodes} ep${m.episodes > 1 ? 's' : ''}` : '';
  return {
    anilistId: m.id,
    titulo: tituloDe(m),
    ano: anoDe(m),
    poster: (m.coverImage && m.coverImage.large) || '',
    formato: m.format || '',
    filme: ehFilme(m.format),
    detalhe: `${FORMATOS[m.format] || 'Anime'}${ehFilme(m.format) ? '' : eps}`,
  };
}

async function pesquisar(termo) {
  const dados = await consultar(
    `query ($termo: String) { Page(perPage: 20) { media(search: $termo, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${CAMPOS_BUSCA} } } }`,
    { termo: String(termo || '').trim() },
  );
  return dados && dados.Page ? dados.Page.media.filter((m) => m.format !== 'MUSIC').map(resultado) : [];
}

// Tudo o que o app guarda de um anime. `id` é o da AniList.
async function detalhes(id) {
  const dados = await consultar(`query ($id: Int) { Media(id: $id, type: ANIME) { ${CAMPOS_DETALHES} } }`, { id: Number(id) });
  const m = dados && dados.Media;
  if (!m) return null;
  const estudio = ((m.studios && m.studios.nodes) || []).map((s) => s.name).join(', ');
  const prox = m.nextAiringEpisode;
  return {
    anterior: vizinho(m, 'PREQUEL'),
    seguinte: vizinho(m, 'SEQUEL'),
    anilistId: m.id,
    malId: m.idMal || '',
    formato: m.format || '',
    filme: ehFilme(m.format),
    titulo: tituloDe(m),
    tituloRomaji: (m.title && m.title.romaji) || '',
    ano: anoDe(m),
    estudio,
    poster: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '',
    fundo: m.bannerImage || '',
    trailerId: m.trailer && String(m.trailer.site).toLowerCase() === 'youtube' ? m.trailer.id : '',
    episodios: m.episodes || 0, // 0: ainda não se sabe quantos serão
    duracao: m.duration || 0, // minutos por episódio
    exibicao: EXIBICAO[m.status] || '',
    proximoEpisodio: prox ? { numero: prox.episode, em: new Date(prox.airingAt * 1000).toISOString() } : null,
    ondeAssistir: ondeAssistir(m.externalLinks),
    info: {
      duracao: m.duration ? `${m.duration} min` : '',
      genero: (m.genres || []).map((g) => GENEROS[g] || g).join(', '),
      classificacao: '',
      sinopse: limparSinopse(m.description),
      elenco: '',
      pais: { JP: 'Japan', CN: 'China', KR: 'South Korea', TW: 'Taiwan' }[m.countryOfOrigin] || '',
      anilist: m.averageScore ? String(m.averageScore) : '', // nota média, de 0 a 100
    },
  };
}

// Todas as temporadas de uma série, da primeira à última. A AniList tem uma
// entrada por temporada, ligadas por "continuação": volta até a primeira e
// segue em frente (passando por filmes e especiais, que não entram na lista).
// `id` pode ser o de qualquer temporada. Devolve os detalhes de cada uma.
const MAX_PASSOS = 30;
async function temporadas(id) {
  const vistos = new Map(); // id → detalhes
  const pegar = async (x) => {
    if (!vistos.has(x)) { if (vistos.size) await espera(250); vistos.set(x, await detalhes(x)); }
    return vistos.get(x);
  };
  let atual = await pegar(Number(id));
  if (!atual) return [];
  if (atual.filme) return [atual];
  // Para trás, até a primeira.
  const corrente = [atual];
  for (let i = 0; i < MAX_PASSOS && atual.anterior && !vistos.has(atual.anterior); i++) {
    const d = await pegar(atual.anterior);
    if (!d) break;
    corrente.unshift(d);
    atual = d;
  }
  // Para a frente, até a última.
  atual = corrente[corrente.length - 1];
  for (let i = 0; i < MAX_PASSOS && atual.seguinte && !vistos.has(atual.seguinte); i++) {
    const d = await pegar(atual.seguinte);
    if (!d) break;
    corrente.push(d);
    atual = d;
  }
  let lista = corrente.filter((d) => FORMATOS_TEMPORADA.has(d.formato));
  // A série começa na primeira temporada de TV: um curta lançado depois, mas que
  // se passa antes (ligado como "anterior"), não vira a primeira temporada.
  const primeiraTv = lista.findIndex((d) => d.formato === 'TV' || d.formato === 'TV_SHORT');
  if (primeiraTv > 0) lista = lista.slice(primeiraTv);
  // Um OVA ou especial sozinho (sem temporada de TV na corrente) é a própria série.
  return lista.length ? lista : [corrente.find((d) => d.anilistId === Number(id)) || corrente[0]];
}

// O que o item guarda de cada temporada. `vistos` é da pessoa: fica o que já havia.
function resumoTemporada(d, antes) {
  const total = d.episodios || 0;
  const vistos = Math.max(0, Number(antes && antes.vistos) || 0);
  return {
    anilistId: d.anilistId,
    titulo: d.titulo,
    tituloRomaji: d.tituloRomaji,
    ano: d.ano,
    formato: d.formato,
    episodios: total,
    duracao: d.duracao,
    exibicao: d.exibicao,
    proximoEpisodio: d.proximoEpisodio,
    poster: d.poster, // a capa da AniList, mostrada ao navegar pelas temporadas
    ondeAssistir: d.ondeAssistir,
    vistos: total ? Math.min(vistos, total) : vistos,
  };
}

// Os campos de uma série com as temporadas juntas num item só: os dados gerais
// são os da primeira temporada; episódios e progresso são a soma.
// `novo`: acabou de ser adicionada (o título e o ano passam a ser os da primeira).
function camposSerie(lista, atual = {}, { novo = false } = {}) {
  const m = campos(lista[0], novo ? { ...atual, titulo: '', ano: '', diretor: '' } : atual);
  const antes = new Map((atual.temporadas || []).map((t) => [Number(t.anilistId), t]));
  const ts = lista.map((d) => resumoTemporada(d, antes.get(d.anilistId)));
  // Progresso de antes de haver temporadas (um número só): distribui em ordem.
  if (!atual.temporadas && atual.episodiosVistos) {
    let resto = Number(atual.episodiosVistos) || 0;
    for (const t of ts) { t.vistos = t.episodios ? Math.min(resto, t.episodios) : resto; resto -= t.vistos; }
  }
  m.temporadas = ts;
  m.episodios = totalTemporadas(ts);
  m.episodiosVistos = ts.reduce((s, t) => s + t.vistos, 0);
  const lancadas = ts.filter(temporadaConta);
  const noAr = ts.find((t) => t.exibicao === 'em exibição');
  m.exibicao = noAr ? noAr.exibicao : (lancadas[lancadas.length - 1] || ts[ts.length - 1]).exibicao;
  m.proximoEpisodio = (ts.find((t) => t.proximoEpisodio) || {}).proximoEpisodio || null;
  return m;
}

// O que entra num item da lista a partir dos detalhes da AniList.
// - Série (TV, OVA, ONA, especial): a AniList é a fonte de tudo.
// - Filme de anime: continua sendo um filme do NANDFlix (o TMDB cuida de capa,
//   logo e trailer); a AniList só acrescenta o id e onde assistir.
function campos(d, atual = {}) {
  const agora = new Date().toISOString();
  if (d.filme) {
    return { anime: true, anilistId: d.anilistId, malId: d.malId, formato: d.formato, ondeAssistir: d.ondeAssistir, anilistEm: agora };
  }
  const m = {
    tipo: 'serie',
    anime: true,
    anilistId: d.anilistId,
    malId: d.malId,
    formato: d.formato,
    anilistEm: agora,
    estudio: d.estudio,
    episodios: d.episodios,
    exibicao: d.exibicao,
    proximoEpisodio: d.proximoEpisodio,
    ondeAssistir: d.ondeAssistir,
    duracao: d.duracao,
    // A sinopse em português que veio do TMDB (sinopsePt) não é trocada pela em inglês.
    info: { ...(atual.info || {}), ...d.info, ...(atual.info && atual.info.sinopsePt ? { sinopse: atual.info.sinopse, sinopsePt: true } : {}), atualizadoEm: agora },
    // Séries não passam pelo TMDB de filmes (acharia um filme com o mesmo nome).
    tmdbEm: atual.tmdbEm || agora,
  };
  // O estúdio fica no lugar do diretor: é por ele que a lista agrupa e filtra.
  if (!atual.diretor) m.diretor = d.estudio;
  if (!atual.titulo) m.titulo = d.titulo;
  if (!atual.ano) m.ano = d.ano;
  if (d.trailerId && !atual.trailerManual) m.trailerId = d.trailerId;
  // A capa da AniList só entra enquanto não houver a do TMDB (maior) nem uma escolhida pela pessoa.
  if (d.poster && !atual.capaPersonalizada && !atual.capaTmdb && d.poster !== atual.poster) Object.assign(m, { poster: d.poster, capaNaoEncontrada: false });
  return m;
}

module.exports = { ErroAnilist, pesquisar, detalhes, temporadas, camposSerie, campos, limparSinopse, ondeAssistir, FORMATOS };
