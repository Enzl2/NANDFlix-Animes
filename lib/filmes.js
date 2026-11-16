// Regras sobre a lista de filmes, usadas pelo app e pelo script de importação.
const crypto = require('crypto');

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .trim();
}

function novoFilme(dados = {}) {
  return {
    id: crypto.randomUUID(),
    ordem: 0,
    titulo: '',
    ano: '',
    diretor: '',
    visto: false,
    favorito: false,
    notas: '',
    linkLetterboxd: '',
    buscaCapa: '',
    imdbID: '',
    tmdbId: '', // id do filme no TMDB (de onde vêm capa, logo, trailer e informações)
    poster: '',
    capaLocal: '',
    capaNaoEncontrada: false,
    capaPersonalizada: false, // imagem escolhida pelo usuário: a busca automática não mexe
    trailerId: '', // código do vídeo no YouTube; 'nenhum' se a busca não achou
    info: null, // notas, duração, gênero e sinopse do OMDb (guardados para não gastar consultas)
    duracao: 0, // minutos, pelo Wikidata (0 se não achou)
    duracaoDe: '', // imdbID para o qual a duração foi buscada
    minhaNota: 0, // nota da pessoa, de 0,5 a 5 estrelas (0 = sem nota)
    vistoEm: [], // dias em que foi visto ('AAAA-MM-DD'), um por vez que foi visto; o dia vira às 5h
    listas: [], // nomes das listas da pessoa em que o filme está ("Ciclo Kurosawa", "Rever"…)
    adicionadoEm: new Date().toISOString(),
    ...dados,
  };
}

// Filme ou série: itens antigos (sem `tipo`) são filmes.
const ehSerie = (f) => Boolean(f) && f.tipo === 'serie';

// Jogo (nandplay): um item com tipo 'jogo' (contrato em lib/igdb.js, lerDetalhes).
const ehJogo = (f) => Boolean(f) && f.tipo === 'jogo';
const STATUS_JOGO = ['quero', 'jogando', 'pausado', 'zerado', 'cem', 'larguei'];

// Os campos do jogo que vêm da IGDB/Steam (o contrato). O resto do item é do usuário.
const CAMPOS_JOGO = ['igdb', 'igdbSlug', 'steam', 'titulo', 'ano', 'lancamento', 'capa', 'fundo', 'logo', 'cabecalho', 'artes', 'capturas', 'sinopse', 'generos', 'modos', 'plataformasJogo', 'desenvolvedores', 'publicadoras', 'lojas', 'site', 'trailer', 'nota', 'tempoZerar', 'tempoZerarRapido', 'tempoZerarCompleto'];
// Um item de jogo novo a partir dos dados da IGDB/Steam: só os campos do contrato, status 'quero' e sem tags.
// `poster` repete a capa (é o que a lista, o calendário e as tierlists já leem) e `trailerId`, o trailer.
function novoJogo(dados = {}, ordem = 0) {
  const j = {};
  for (const k of CAMPOS_JOGO) if (dados[k] !== undefined && dados[k] !== null) j[k] = dados[k];
  const status = STATUS_JOGO.includes(dados.status) ? dados.status : 'quero';
  return novoFilme({
    ordem, ...j, tipo: 'jogo',
    titulo: String(dados.titulo || '').trim(), ano: String(dados.ano || '').trim(),
    poster: j.capa || '', trailerId: j.trailer || '',
    status, tags: Array.isArray(dados.tags) ? dados.tags.map(String).filter(Boolean) : [],
  });
}

// Dois itens são o mesmo se tiverem o mesmo id da AniList, do TMDB, o mesmo
// imdbID ou o mesmo título e ano (um filme e uma série de mesmo nome são dois).
function mesmoFilme(a, b) {
  // Jogo só se repete com jogo: mesmo id da IGDB, mesmo appid da Steam ou mesmo título e ano.
  if (ehJogo(a) || ehJogo(b)) {
    if (!ehJogo(a) || !ehJogo(b)) return false;
    if (a.igdb && b.igdb && String(a.igdb) === String(b.igdb)) return true;
    if (a.steam && b.steam && String(a.steam) === String(b.steam)) return true;
    return normalizar(a.titulo) === normalizar(b.titulo) && String(a.ano).trim() === String(b.ano).trim();
  }
  // Qualquer temporada em comum: "Season 2" é a mesma série que já está na lista.
  const ids = (f) => [f.anilistId, ...(f.temporadas || []).filter((t) => t.formato !== 'MOVIE').map((t) => t.anilistId)].filter(Boolean).map(String);
  const idsA = ids(a);
  if (idsA.length && ids(b).some((x) => idsA.includes(x))) return true;
  if (a.tmdbId && b.tmdbId && String(a.tmdbId) === String(b.tmdbId)) return true;
  if (a.imdbID && b.imdbID && a.imdbID === b.imdbID) return true;
  if (ehSerie(a) !== ehSerie(b)) return false;
  return normalizar(a.titulo) === normalizar(b.titulo) && String(a.ano).trim() === String(b.ano).trim();
}

// ---------- Séries: episódios e status ----------

// Em que pé a pessoa está com a série.
const STATUS_SERIE = ['planejo', 'assistindo', 'pausado', 'completo', 'largado'];

// As mudanças para a série ficar com `n` episódios vistos. O status acompanha:
// o primeiro episódio começa a série, o último a completa (e ela conta como
// vista), e voltar atrás desfaz. Pausado e largado só mudam ao completar.
// `visto` aqui não mexe nas datas (vistoEm): quem chama grava o dia.
function progressoSerie(f, n) {
  const total = Number(f.episodios) || 0;
  let vistos = Math.max(0, Math.round(Number(n) || 0));
  if (total) vistos = Math.min(vistos, total);
  const m = { episodiosVistos: vistos };
  const atual = STATUS_SERIE.includes(f.status) ? f.status : 'planejo';
  const completa = total > 0 && vistos >= total;
  if (completa) m.status = 'completo';
  else if (atual === 'completo') m.status = vistos ? 'assistindo' : 'planejo';
  else if (atual === 'planejo' && vistos > 0) m.status = 'assistindo';
  else if (atual === 'assistindo' && vistos === 0) m.status = 'planejo';
  else m.status = atual;
  m.visto = m.status === 'completo';
  return m;
}

// Digitar um número ou completar zera a escolha avulsa (fica do 1 ao número).
function semLista(t) {
  const { lista, ...resto } = t;
  return resto;
}

// As mudanças para trocar o status à mão. Completar marca todos os episódios
// (de todas as temporadas); voltar a "planejo ver" zera.
function statusSerie(f, status) {
  if (!STATUS_SERIE.includes(status)) return {};
  const total = Number(f.episodios) || 0;
  const m = { status, visto: status === 'completo' };
  const ts = Array.isArray(f.temporadas) ? f.temporadas : null;
  if (status === 'completo') {
    if (ts) { m.temporadas = ts.map((t) => semLista({ ...t, vistos: t.episodios || t.vistos || 0 })); m.episodiosVistos = m.temporadas.reduce((s, t) => s + t.vistos, 0); }
    else if (total) m.episodiosVistos = total;
  }
  if (status === 'planejo') {
    m.episodiosVistos = 0;
    if (ts) m.temporadas = ts.map((t) => semLista({ ...t, vistos: 0 }));
  }
  return m;
}

// Temporadas anunciadas mas ainda não lançadas não contam no total (senão a
// série nunca ficaria completa). Total 0: ainda não se sabe quantos episódios são.
const temporadaConta = (t) => t.exibicao !== 'não lançado';
function totalTemporadas(ts) {
  const contam = ts.filter(temporadaConta);
  return contam.length && contam.every((t) => t.episodios) ? contam.reduce((s, t) => s + t.episodios, 0) : 0;
}

// ---- Episódios marcados um a um ----
//
// Cada temporada guarda quantos episódios a pessoa viu (`vistos`). Quando ela
// vê fora de ordem (um episódio avulso), a temporada guarda também quais
// (`lista`, os números em ordem). Sem `lista`, os vistos são do 1 ao `vistos`.

function marcadosDe(t) {
  if (Array.isArray(t.lista)) return t.lista.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const n = Number(t.vistos) || 0;
  return Array.from({ length: n }, (_, i) => i + 1);
}

// A temporada com estes episódios marcados. Se forem do 1 em diante sem
// buracos, a lista some e fica só a contagem (o caso comum).
function comMarcados(t, numeros) {
  const total = Number(t.episodios) || 0;
  const ns = [...new Set(numeros.map(Number))].filter((n) => Number.isInteger(n) && n > 0 && (!total || n <= total)).sort((a, b) => a - b);
  const seguidos = ns.every((n, i) => n === i + 1);
  const novo = { ...t, vistos: ns.length };
  if (seguidos) delete novo.lista; else novo.lista = ns;
  return novo;
}

// O próximo episódio a ver numa temporada: o primeiro que falta.
function proximoEpisodio(t) {
  const ns = new Set(marcadosDe(t));
  let n = 1;
  while (ns.has(n)) n++;
  return n;
}

// Um episódio a mais (+1) ou a menos (-1). Com temporadas, `indice` diz em qual;
// sem ele, segue a ordem: o próximo episódio é o da primeira temporada ainda
// não terminada, e o último visto é o da última temporada com algum episódio.
function passoSerie(f, delta, indice = null) {
  const ts = Array.isArray(f.temporadas) && f.temporadas.length ? f.temporadas : null;
  if (!ts) return progressoSerie(f, (Number(f.episodiosVistos) || 0) + delta);
  const vistos = (t) => Number(t.vistos) || 0;
  let i = Number.isInteger(indice) && ts[indice] ? indice : -1;
  if (i < 0) {
    i = delta > 0 ? ts.findIndex((t) => temporadaConta(t) && (!t.episodios || vistos(t) < t.episodios)) : ts.map((t) => vistos(t) > 0).lastIndexOf(true);
    if (i < 0) return {};
  }
  const t = ts[i];
  const ns = marcadosDe(t);
  if (delta > 0) {
    const prox = proximoEpisodio(t);
    if (t.episodios && prox > t.episodios) return comTemporadas(f, ts);
    ns.push(prox); // o primeiro que falta (assim um avulso não pula os de antes)
  } else ns.splice(ns.indexOf(Math.max(...ns)), ns.length ? 1 : 0); // tira o último
  return comTemporadas(f, ts.map((x, j) => (j === i ? comMarcados(x, ns) : x)));
}

// Marcar ou desmarcar um episódio (ou o filme) de uma temporada.
function alternarEpisodio(f, indice, numero) {
  const ts = Array.isArray(f.temporadas) ? f.temporadas : [];
  const t = ts[indice];
  const n = Math.round(Number(numero));
  if (!t || !Number.isInteger(n) || n < 1 || (t.episodios && n > t.episodios)) return {};
  const ns = marcadosDe(t);
  const novos = ns.includes(n) ? ns.filter((x) => x !== n) : [...ns, n];
  return comTemporadas(f, ts.map((x, j) => (j === indice ? comMarcados(x, novos) : x)));
}

// As mudanças para a série ficar com estas temporadas (soma, status e visto acompanham).
function comTemporadas(f, novas) {
  const total = totalTemporadas(novas);
  const soma = novas.reduce((s, x) => s + (Number(x.vistos) || 0), 0);
  return { ...progressoSerie({ ...f, episodios: total }, soma), temporadas: novas, episodios: total };
}

// Digitar o número de episódios vistos (para não clicar "+1" mil vezes em One
// Piece). Com `indice`, vale para aquela temporada; sem ele, é o total da série,
// distribuído pelas temporadas lançadas em ordem.
function definirSerie(f, n, indice = null) {
  let resto = Math.max(0, Math.round(Number(n) || 0));
  const ts = Array.isArray(f.temporadas) && f.temporadas.length ? f.temporadas : null;
  if (!ts) return progressoSerie(f, resto);
  if (Number.isInteger(indice) && ts[indice]) {
    const t = ts[indice];
    const v = t.episodios ? Math.min(resto, t.episodios) : resto;
    return comTemporadas(f, ts.map((x, j) => (j === indice ? semLista({ ...x, vistos: v }) : x)));
  }
  return comTemporadas(f, ts.map((t) => {
    if (!temporadaConta(t)) return semLista({ ...t, vistos: 0 });
    const v = t.episodios ? Math.min(resto, t.episodios) : resto;
    resto -= v;
    return semLista({ ...t, vistos: v });
  }));
}

// ---- Episódios por dia (calendário e estatísticas dos animes) ----
//
// `epDias` guarda quantos episódios foram vistos em cada dia: { 'AAAA-MM-DD': n }.
// É um mapa pequeno e inteiro de um campo só, que sincroniza como qualquer outro
// campo do item. Só os episódios marcados um a um (+1, a grade) ganham dia; marcar
// vários de uma vez (digitar o número, "Completo") não inventa datas. Desmarcar
// tira do dia de hoje e, se não houver, dos dias mais recentes; e a soma nunca
// passa dos episódios vistos.
function comEpisodiosDoDia(f, m, dia, { registrar = true } = {}) {
  const antes = Number(f.episodiosVistos) || 0;
  const depois = 'episodiosVistos' in m ? Number(m.episodiosVistos) || 0 : antes;
  const atual = f.epDias && typeof f.epDias === 'object' ? f.epDias : {};
  const mapa = { ...atual };
  const delta = depois - antes;
  if (delta > 0 && registrar && dia) mapa[dia] = (Number(mapa[dia]) || 0) + delta;
  // Sobrou mais do que há de vistos (desmarcou, ou um status zerou): tira do dia dado, depois dos mais recentes.
  let excesso = Object.values(mapa).reduce((t, n) => t + (Number(n) || 0), 0) - depois;
  const ordem = [...(dia ? [dia] : []), ...Object.keys(mapa).sort().reverse().filter((d) => d !== dia)];
  for (const d of ordem) {
    if (excesso <= 0) break;
    if (!(d in mapa)) continue;
    const tira = Math.min(excesso, Number(mapa[d]) || 0);
    mapa[d] -= tira;
    excesso -= tira;
  }
  for (const d of Object.keys(mapa)) if (!(mapa[d] > 0)) delete mapa[d];
  if (JSON.stringify(mapa) === JSON.stringify(atual)) return m;
  return { ...m, epDias: mapa };
}

function acharRepetido(lista, filme, ignorarId) {
  return lista.find((f) => f.id !== ignorarId && mesmoFilme(f, filme)) || null;
}

// Junta os filmes importados aos existentes; os dados do app têm prioridade.
function juntar(existentes, importados) {
  const resultado = existentes.slice();
  let proximaOrdem = existentes.reduce((m, f) => Math.max(m, f.ordem || 0), 0) + 1;
  let adicionados = 0;
  let repetidos = 0;
  for (const filme of importados) {
    if (acharRepetido(resultado, filme)) { repetidos++; continue; }
    resultado.push({ ...filme, ordem: proximaOrdem++ });
    adicionados++;
  }
  return { filmes: resultado, adicionados, repetidos };
}

function resumo(filmes) {
  return {
    total: filmes.length,
    vistos: filmes.filter((f) => f.visto).length,
    favoritos: filmes.filter((f) => f.favorito).length,
    comCapa: filmes.filter((f) => f.poster || f.capaLocal).length,
  };
}

// Junta às mudanças de progresso/status a data: completar grava o dia (um por
// vez que foi vista), e deixar de estar completa desfaz o de hoje.
function comDia(f, m, dia) {
  if (!dia || !('visto' in m) || Boolean(m.visto) === Boolean(f.visto)) return m;
  const dias = [...(f.vistoEm || [])];
  if (m.visto) { if (!dias.includes(dia)) dias.push(dia); } else { const i = dias.lastIndexOf(dia); if (i >= 0) dias.splice(i, 1); }
  return { ...m, vistoEm: dias.sort() };
}

// Marcar/desmarcar "visto" numa série (pelo botão ✓) acompanha o status.
function vistoSerie(f, visto) {
  if (visto) return statusSerie(f, 'completo');
  return f.status === 'completo' ? { status: 'assistindo', visto: false } : { visto: false };
}

// Os animes a conferir de novo na AniList ao abrir o app:
// - os que ainda não foram conferidos (ou sem a capa do TMDB, se há chave);
// - as séries com alguma temporada no ar ou por vir: a cada 6 horas;
// - as outras séries: uma vez por semana, para pegar temporadas e filmes
//   anunciados depois (Chainsaw Man: Filme da Reze e Shikaku-hen). Destas,
//   no máximo `maxSemanais` por vez, as conferidas há mais tempo primeiro.
const EM_ANDAMENTO = ['em exibição', 'não lançado', 'em hiato'];
// Séries conferidas antes de mudar a regra das temporadas (franquias que se
// ramificam, primeira temporada em ONA) são conferidas de novo uma vez.
const REGRA_DAS_TEMPORADAS = Date.parse('2026-11-16T18:00:00Z');
function animesParaAtualizar(lista, { agora = Date.now(), temTmdb = false, maxSemanais = 15 } = {}) {
  const desde = (f) => Date.parse(f.anilistEm) || 0;
  const animes = lista.filter((f) => f.anilistId && (ehSerie(f) || !f.anilistEm));
  const andando = (f) => [f.exibicao, ...(f.temporadas || []).map((t) => t.exibicao)].some((e) => EM_ANDAMENTO.includes(e));
  const ja = (f) => !f.anilistEm || (temTmdb && ehSerie(f) && !f.tmdbTvEm) || (andando(f) && desde(f) < agora - 6 * 3600 * 1000);
  const urgentes = animes.filter(ja);
  const semanais = animes.filter((f) => !ja(f) && ehSerie(f) && (desde(f) < agora - 7 * 24 * 3600 * 1000 || desde(f) < REGRA_DAS_TEMPORADAS))
    .sort((a, b) => desde(a) - desde(b)).slice(0, maxSemanais);
  return [...urgentes, ...semanais];
}

module.exports = { animesParaAtualizar, comDia, comEpisodiosDoDia, vistoSerie, passoSerie, alternarEpisodio, marcadosDe, proximoEpisodio, comMarcados, definirSerie, comTemporadas, totalTemporadas, temporadaConta, normalizar, novoFilme, ehJogo, novoJogo, STATUS_JOGO, mesmoFilme, acharRepetido, juntar, resumo, ehSerie, STATUS_SERIE, progressoSerie, statusSerie };
