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

// Dois itens são o mesmo se tiverem o mesmo id da AniList, do TMDB, o mesmo
// imdbID ou o mesmo título e ano (um filme e uma série de mesmo nome são dois).
function mesmoFilme(a, b) {
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

module.exports = { comDia, vistoSerie, passoSerie, alternarEpisodio, marcadosDe, proximoEpisodio, comMarcados, definirSerie, comTemporadas, totalTemporadas, temporadaConta, normalizar, novoFilme, mesmoFilme, acharRepetido, juntar, resumo, ehSerie, STATUS_SERIE, progressoSerie, statusSerie };
