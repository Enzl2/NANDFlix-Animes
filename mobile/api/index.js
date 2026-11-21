// A ponte `api` do celular: o mesmo contrato que o preload.js dá no PC, mas
// com os dados guardados no próprio aparelho (disco.js) e sincronizados pelo
// Supabase (lib/nuvem.js). O que só existe no PC (planilha, pasta de dados,
// backup em arquivo, importar do Letterboxd) responde com um aviso.
//
// Reaproveita do app de PC: lib/marcas.js, lib/nuvem.js, lib/filmes.js,
// lib/tmdb.js, lib/omdb.js e lib/trailer.js.

import { carregarDisco, descarregar, fs } from './disco.js';
import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Marcas } from '../../lib/marcas.js';
import { Nuvem } from '../../lib/nuvem.js';
import { novoFilme, novoJogo, ehJogo, acharRepetido, ehSerie, passoSerie, definirSerie, alternarEpisodio, statusSerie, comDia, comEpisodiosDoDia, vistoSerie, animesParaAtualizar } from '../../lib/filmes.js';
import tmdb from '../../lib/tmdb.js';
import anilist from '../../lib/anilist.js';
import { Igdb } from '../../lib/igdb.js';
import steam from '../../lib/steam.js';
import hltb from '../../lib/hltb.js';
import { camposDoJogo } from '../../lib/jogo-usuario.js';
import omdb from '../../lib/omdb.js';
import trailer from '../../lib/trailer.js';
import { Episodios } from '../../lib/episodios.js';
import letterboxd from '../../lib/letterboxd.js';
import { Extras } from '../../lib/extras.js';
import { Acervo, listaPremios } from '../../lib/premios.js';
import { escolherArquivos } from './letterboxd-zip.mjs';
import importar from '../../lib/importar.js';
import stremio from '../../lib/stremio.js';
import { InAppBrowser } from '@capgo/capacitor-inappbrowser';
import crunchyroll from '../../lib/streaming/crunchyroll.js';
import { identificarTodos } from '../../lib/streaming/identificar.js';
import { lerCrunchyrollNoCelular } from '../../lib/streaming/celular.js';
// URL e chave do Supabase, de lib/nuvem.config.json (o montar.js põe aqui na hora
// de montar). Sem esse arquivo (a versão pública do GitHub), o app funciona só
// com os dados do aparelho: sem conta, sem sincronia e sem atualização sozinha.
// eslint-disable-next-line no-undef
const nuvemConfig = NUVEM_CONFIG;

// A busca do trailer lê a página de resultados do YouTube e a nota do Letterboxd
// vem da página do filme, que o WebView não deixa ler (CORS): no aparelho, esses
// pedidos vão pela rede nativa do Android. O mesmo para o nandplay: o IGDB (e o
// token da Twitch) e a Steam (loja e Web API) não aceitam pedidos do WebView.
const PELA_REDE_NATIVA = ['https://www.youtube.com/results', 'https://letterboxd.com/', 'https://id.twitch.tv/oauth2/', 'https://api.igdb.com/', 'https://store.steampowered.com/api/', 'https://api.steampowered.com/'];
if (Capacitor.isNativePlatform()) {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (url, opcoes = {}) => {
    const u = String((url && url.url) || url);
    if (!PELA_REDE_NATIVA.some((inicio) => u.startsWith(inicio))) return fetchOriginal(url, opcoes);
    const metodo = String(opcoes.method || 'GET').toUpperCase();
    const r = metodo === 'GET'
      ? await CapacitorHttp.get({ url: u, headers: opcoes.headers || {}, responseType: 'text' })
      : await CapacitorHttp.request({ url: u, method: metodo, headers: opcoes.headers || {}, data: opcoes.body, responseType: 'text' });
    return new Response(typeof r.data === 'string' ? r.data : JSON.stringify(r.data), { status: r.status });
  };
}

const PASTA = '/dados';
const C = {
  filmes: `${PASTA}/filmes.json`,
  config: `${PASTA}/config.json`,
  sincronia: `${PASTA}/sincronia.json`,
  imagens: `${PASTA}/imagens`,
  capas: `${PASTA}/capas`,
  premios: `${PASTA}/premios.json`,
  episodios: `${PASTA}/episodios.json`,
  igdbToken: `${PASTA}/igdb-token.json`,
  steamBiblioteca: `${PASTA}/steam-biblioteca.json`,
  hltb: `${PASTA}/hltb-cache.json`,
};
// A versão do app (mobile/package.json), posta pelo montar.js.
// eslint-disable-next-line no-undef
const VERSAO = APP_VERSAO;

const CONFIG_PADRAO = { tmdbKey: '', omdbKey: '', stremio: 'app', visualizacao: 'grade', ordenacao: 'ordem' };

let filmes = [];
let config = { ...CONFIG_PADRAO };
let marcas = null;
let nuvem = null;

// ---------- Avisos para a interface (o ipcRenderer.on do PC) ----------

const ouvintes = new Map();
const ouvir = (canal) => (fn) => {
  if (!ouvintes.has(canal)) ouvintes.set(canal, []);
  ouvintes.get(canal).push(fn);
};
function avisar(canal, dados) {
  for (const fn of ouvintes.get(canal) || []) {
    try { fn(dados); } catch (e) { console.error(canal, e); }
  }
}

// ---------- Gravação ----------

const lerJSON = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravarJSON = (arq, dados) => fs.writeFileSync(arq, JSON.stringify(dados));

let timerGravar = null;
function gravarDepois() {
  clearTimeout(timerGravar);
  timerGravar = setTimeout(gravarAgora, 300);
}
function gravarAgora() {
  clearTimeout(timerGravar);
  timerGravar = null;
  gravarJSON(C.filmes, { versao: 1, salvoEm: new Date().toISOString(), filmes });
  if (marcas && marcas.registrarFilmes(filmes) && nuvem) nuvem.agendar();
}
function gravarConfig() {
  gravarJSON(C.config, config);
  if (marcas && marcas.registrarConfig(config) && nuvem) nuvem.agendar();
}
const configPublica = () => ({ ...config });

function atualizarFilme(id, mudancas) {
  const f = filmes.find((x) => x.id === id);
  if (!f) return null;
  Object.assign(f, mudancas);
  gravarDepois();
  return f;
}

// ---------- TMDB (como no main.js, mas sem baixar as imagens: o celular usa os links) ----------

const NOTAS_OMDB = ['imdb', 'metascore', 'rotten'];

function aplicarTmdb(f, d, { trocarFilme = false } = {}) {
  const outroFilme = trocarFilme || Boolean(d.imdbID && f.imdbID && d.imdbID !== f.imdbID);
  const info = { ...(outroFilme ? {} : f.info || {}), ...d.info, atualizadoEm: new Date().toISOString() };
  if (outroFilme) for (const k of NOTAS_OMDB) delete info[k];
  const m = {
    ...(outroFilme ? { extras: null } : {}),
    tmdbId: d.tmdbId,
    tmdbEm: new Date().toISOString(),
    idiomaOriginal: d.idiomaOriginal,
    imdbID: d.imdbID || f.imdbID,
    info,
    duracao: d.duracao || (outroFilme ? 0 : f.duracao),
    duracaoDe: d.imdbID || f.imdbID,
    diretor: outroFilme || !f.diretor ? d.diretor || f.diretor : f.diretor,
    logo: d.logo,
  };
  if (d.trailerId && !f.trailerManual) m.trailerId = d.trailerId;
  if (d.poster && !f.capaPersonalizada && (d.poster !== f.poster || outroFilme)) Object.assign(m, { poster: d.poster, capaNaoEncontrada: false });
  atualizarFilme(f.id, m);
  return true;
}

async function processarTmdb(f, { tmdbId = null, trocarFilme = false } = {}) {
  if (ehSerie(f)) return false; // séries vêm da AniList (processarAnilist)
  let id = tmdbId || (!trocarFilme && f.tmdbId) || null;
  const busca = (f.buscaCapa || '').trim();
  const buscaImdb = /^tt\d+$/.test(busca);
  if (!id && buscaImdb) id = await tmdb.idPorImdb(config.tmdbKey, busca);
  if (!id && f.imdbID && !busca) id = await tmdb.idPorImdb(config.tmdbKey, f.imdbID);
  if (!id) id = await tmdb.idPorTitulo(config.tmdbKey, ((busca && !buscaImdb) ? busca : f.titulo).replace(/[’‘]/g, "'"), f.ano);
  const d = id ? await tmdb.detalhes(config.tmdbKey, id) : null;
  if (!d) {
    atualizarFilme(f.id, { tmdbEm: new Date().toISOString(), capaNaoEncontrada: !f.poster });
    return false;
  }
  return aplicarTmdb(f, d, { trocarFilme });
}

// ---------- AniList: os animes (como no main.js, sem baixar a capa) ----------

async function processarAnilist(f, anilistId = null, { novo = false } = {}) {
  const id = anilistId || f.anilistId;
  if (!id) return false;
  // Série: todas as temporadas juntas no mesmo item. Filme de anime: só o id e onde assistir.
  const lista = ehSerie(f) ? await anilist.temporadas(id) : [await anilist.detalhes(id)].filter(Boolean);
  if (!lista.length) return false;
  const d = lista[0];
  atualizarFilme(f.id, ehSerie(f) ? anilist.camposSerie(lista, f, { novo }) : anilist.campos(d, f));
  if (ehSerie(f)) await capaTmdbDaSerie(f, d);
  return true;
}

// A capa e a logo das séries vêm do TMDB quando há chave (são maiores e a logo
// vira o título, como nos filmes); sem chave, ou se o TMDB não achar, fica a
// capa da AniList. Procura uma vez por série (`tmdbTvEm`).
async function capaTmdbDaSerie(f, d) {
  if (!config.tmdbKey || f.tmdbTvEm) return;
  let c;
  try { c = await tmdb.capaSerie(config.tmdbKey, { titulo: d.titulo, tituloRomaji: d.tituloRomaji }); } catch { return; } // sem internet: tenta na próxima
  const m = { tmdbTvEm: new Date().toISOString(), tmdbTvId: c ? c.tmdbTvId : '' };
  if (c && c.poster && !f.capaPersonalizada) Object.assign(m, { poster: c.poster, capaTmdb: true, capaNaoEncontrada: false });
  if (c && c.logo) m.logo = c.logo;
  if (c && c.imdbID && !f.imdbID) m.imdbID = c.imdbID; // Stremio direto na série e notas do IMDb
  if (c && c.sinopse) m.info = { ...(f.info || {}), sinopse: c.sinopse, sinopsePt: true };
  atualizarFilme(f.id, m);
}

let atualizandoSeries = false;
async function atualizarSeriesEmExibicao() {
  if (atualizandoSeries || !config.nandroll) return; // NANDRoll é opcional (Configurações)
  atualizandoSeries = true;
  const fila = animesParaAtualizar(filmes, { temTmdb: Boolean(config.tmdbKey) });
  try {
    for (const f of fila) {
      await processarAnilist(f);
      avisar('filme:mudou', f);
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch { /* sem internet: fica para a próxima vez */ }
  if (fila.length) gravarAgora();
  atualizandoSeries = false;
}


// As capas para escolher numa série: as do TMDB (se a série foi achada lá) e a de cada temporada (AniList).
async function capasDaSerie(f) {
  const doTmdb = f.tmdbTvId && config.tmdbKey ? await tmdb.capas(config.tmdbKey, f.tmdbTvId, 'ja', 'tv').catch(() => []) : [];
  const dasTemporadas = (f.temporadas || []).filter((t) => t.poster).map((t) => ({ poster: t.poster, miniatura: t.poster, idioma: '', rotulo: t.titulo }));
  return [...doTmdb, ...dasTemporadas];
}

// Importa a lista de animes de um usuário da AniList (pública). O que já está
// na lista não entra de novo. As séries chegam com o progresso e a nota; as
// temporadas, a capa e o resto são completados em seguida, em segundo plano.
async function importarAnilist(nome) {
  const entradas = await anilist.listaDoUsuario(nome);
  if (!entradas) return { naoEncontrado: true };
  const grupos = anilist.agruparLista(entradas);
  let ordem = filmes.reduce((m, f) => Math.max(m, f.ordem || 0), 0);
  const agora = new Date().toISOString();
  const r = { series: 0, filmes: 0, repetidos: 0 };
  for (const d of [...grupos.series, ...grupos.filmes]) {
    if (acharRepetido(filmes, d)) { r.repetidos++; continue; }
    const serie = d.tipo === 'serie';
    filmes.push(novoFilme({ ...d, ordem: ++ordem, ...(serie ? { tmdbEm: agora } : {}) }));
    if (serie) r.series++; else r.filmes++;
  }
  if (r.series || r.filmes) {
    gravarAgora();
    atualizarSeriesEmExibicao();
    buscarCapasQueFaltam();
  }
  return { ...r, lista: filmes };
}

// ---------- nandchan: importar da Crunchyroll (como no main.js) ----------
//
// No celular só a Crunchyroll: o app abre o site num navegador dentro dele (o
// plugin InAppBrowser), a pessoa entra com a conta dela e toca em "Ler minhas
// listas", um botão que o script da página põe lá (lib/streaming/crunchyroll.js,
// scriptCelular). O script lê as listas com a sessão do próprio site e as manda
// para cá. Os cookies ficam guardados: na próxima vez não pede login de novo.
// O plugin é nativo: só existe a partir do APK que o traz. Sem ele (APK antigo
// atualizado pela nuvem), a opção nem aparece nas Configurações.
const temNavegadorEmbutido = () => Capacitor.isNativePlatform() && (Capacitor.isPluginAvailable('CapgoInAppBrowser') || Capacitor.isPluginAvailable('InAppBrowser'));
const STREAMING_NO_CELULAR = ['crunchyroll'];
let lendoStreaming = false;

async function lerStreamingNoCelular(id) {
  if (!STREAMING_NO_CELULAR.includes(id)) throw new Error('No celular, só dá para importar da Crunchyroll.');
  if (!temNavegadorEmbutido()) throw new Error('Instale o APK novo do app para importar da Crunchyroll pelo celular.');
  if (lendoStreaming) throw Object.assign(new Error('A Crunchyroll já está aberta.'), { tipo: 'aberta' });
  lendoStreaming = true;
  try {
    return await lerCrunchyrollNoCelular(InAppBrowser);
  } finally {
    lendoStreaming = false;
  }
}

// Lê e procura cada título na AniList, como no main.js ('streaming:ler').
async function lerStreaming(id) {
  const listas = await lerStreamingNoCelular(id);
  const todos = listas.flatMap((l) => l.itens.map((x) => ({ ...x, servico: id, tudoAnime: true })));
  const achados = await identificarTodos(todos, { anilist, tmdb, chaveTmdb: config.tmdbKey || '' },
    (feitos, total) => avisar('streaming:progresso', { servico: crunchyroll.NOME, feitos, total }));
  let k = 0;
  return { servico: crunchyroll.NOME, listas: listas.map((l) => ({ ...l, itens: l.itens.map(() => { const { servico: _s, tudoAnime: _t, ...x } = achados[k++]; return x; }) })) };
}

// Põe na lista os animes escolhidos na conferência, como no main.js.
function importarDoStreaming(itens, lista) {
  const nome = String(lista || '').trim().slice(0, 60);
  let ordem = filmes.reduce((m, f) => Math.max(m, f.ordem || 0), 0);
  const agora = new Date().toISOString();
  const r = { novos: 0, jaEstavam: 0 };
  const novos = [];
  for (const d of itens || []) {
    const anilistId = Number(d.anilistId);
    if (!anilistId) continue;
    const serie = !d.filme;
    const dados = { titulo: String(d.titulo || '').trim(), ano: String(d.ano || '').trim(), anilistId, tipo: serie ? 'serie' : undefined };
    const ja = acharRepetido(filmes, dados);
    if (ja) {
      const mudancas = {};
      if (nome && !(ja.listas || []).includes(nome)) mudancas.listas = [...(ja.listas || []), nome];
      if (d.favorito && !ja.favorito) mudancas.favorito = true;
      if (Object.keys(mudancas).length) atualizarFilme(ja.id, mudancas);
      r.jaEstavam++;
      continue;
    }
    const f = novoFilme({
      ordem: ++ordem, titulo: dados.titulo, ano: dados.ano, poster: d.poster || '', anime: true, anilistId,
      listas: nome ? [nome] : [], favorito: Boolean(d.favorito),
      ...(serie ? { tipo: 'serie', episodios: 0, episodiosVistos: 0, status: 'planejo', tmdbEm: agora } : {}),
    });
    filmes.push(f);
    novos.push(f);
    r.novos++;
  }
  if (nome && !(config.listas || []).includes(nome)) { config.listas = [...(config.listas || []), nome]; gravarConfig(); }
  gravarAgora();
  // Temporadas, capas e o resto chegam aos poucos (a AniList tem limite por minuto).
  (async () => {
    for (const f of novos) {
      try { await processarAnilist(f, null, { novo: true }); } catch { /* fica para a próxima vez que o app abrir */ }
      avisar('filme:mudou', f);
    }
    gravarAgora();
    buscarCapasQueFaltam();
  })();
  return { ...r, lista: filmes, config: configPublica() };
}

let buscaEmAndamento = null;
function buscarCapasQueFaltam({ incluirNaoEncontradas = false } = {}) {
  if (buscaEmAndamento) return buscaEmAndamento;
  if (!config.tmdbKey) return Promise.resolve({ pulada: 'chave' });
  const fila = filmes.filter((f) => !ehJogo(f) && (!f.tmdbEm || (incluirNaoEncontradas && !f.tmdbId))); // jogo não tem nada no TMDB
  if (!fila.length) { extras.atualizar(); return Promise.resolve({ total: 0, encontradas: 0 }); }
  buscaEmAndamento = (async () => {
    const total = fila.length;
    let feitos = 0; let encontradas = 0; let erro = null;
    avisar('capas:progresso', { feitos, total });
    const trabalhar = async () => {
      while (fila.length && !erro) {
        const f = fila.shift();
        try { if (await processarTmdb(f)) encontradas++; avisar('filme:mudou', f); } catch (e) { if (e instanceof tmdb.ErroTmdb) erro = e; }
        feitos++;
        avisar('capas:progresso', { feitos, total });
      }
    };
    await Promise.all([trabalhar(), trabalhar(), trabalhar(), trabalhar()]);
    gravarAgora();
    const r = { total: feitos, encontradas, erro: erro ? { tipo: erro.tipo, mensagem: erro.message } : null };
    avisar('capas:fim', r);
    extras.atualizar();
    return r;
  })().finally(() => { buscaEmAndamento = null; });
  return buscaEmAndamento;
}

async function chamar(fn) {
  try { return { ok: true, dados: await fn() }; } catch (e) { return { ok: false, erro: { tipo: e.tipo || 'rede', mensagem: e.message } }; }
}

// ---------- Imagens ----------
//
// Capas escolhidas por você e imagens das páginas ficam no armazenamento da
// nuvem; o celular mostra pelo link assinado (o navegador guarda em cache).
// Uma imagem colada aqui fica no disco do app até subir.

const links = new Map(); // 'fotos/x.png' | 'capas/y.jpg' → URL assinada
const locais = new Map(); // nome → URL de blob (imagem que ainda está só aqui)

function urlFoto(nome) {
  if (locais.has(nome)) return locais.get(nome);
  const arq = `${C.imagens}/${nome}`;
  if (fs.existsSync(arq)) {
    const url = URL.createObjectURL(new Blob([fs.readFileSync(arq)], { type: tipoImagem(nome) }));
    locais.set(nome, url);
    return url;
  }
  return links.get(`fotos/${nome}`) || '';
}
const urlCapa = (nome) => links.get(`capas/${nome}`) || '';

function tipoImagem(nome) {
  const ext = (nome.match(/\.\w+$/) || [''])[0].toLowerCase();
  return { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
}

// Pede de uma vez os links de tudo o que está na nuvem (valem 7 dias).
async function atualizarLinks() {
  if (!nuvem || !nuvem.usuario) return;
  const uid = nuvem.usuario.id;
  const caminhos = new Set();
  for (const f of filmes) {
    for (const nome of nuvem.fotosDe(f)) if (!fs.existsSync(`${C.imagens}/${nome}`)) caminhos.add(`fotos/${nome}`);
    if (f.capaPersonalizada && f.capaNuvem) caminhos.add(`capas/${f.capaNuvem}`);
  }
  const faltam = [...caminhos].filter((c) => !links.has(c));
  for (let i = 0; i < faltam.length; i += 200) {
    const lote = faltam.slice(i, i + 200);
    const { data } = await nuvem.cliente.storage.from('imagens').createSignedUrls(lote.map((c) => `${uid}/${c}`), 7 * 24 * 3600);
    for (const [j, r] of (data || []).entries()) if (r && r.signedUrl) links.set(lote[j], r.signedUrl);
  }
  if (faltam.length) avisar('imagens:links', null);
}

async function dadosImagem(src) {
  try {
    let url = String(src || '');
    const m = url.match(/^capa:\/\/foto\/([\w.-]+)$/);
    if (m) url = urlFoto(m[1]);
    if (!url) return null;
    // O TMDB não deixa o WebView ler os bytes das imagens (CORS), e o story e a
    // retrospectiva desenham num canvas: no aparelho, a imagem vem pela rede nativa.
    if (Capacitor.isNativePlatform() && url.startsWith('https://')) {
      const n = await CapacitorHttp.get({ url, responseType: 'blob' });
      if (n.status < 200 || n.status >= 300 || !n.data) return null;
      const tipo = (n.headers && (n.headers['Content-Type'] || n.headers['content-type'])) || 'image/jpeg';
      return `data:${tipo.split(';')[0]};base64,${n.data}`;
    }
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((ok) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = () => ok(null); l.readAsDataURL(blob); });
  } catch { return null; }
}

async function guardarImagem(bytes, tipo) {
  if (!bytes) {
    // Botão "Colar a imagem copiada": lê da área de transferência do Android.
    try {
      const itens = await navigator.clipboard.read();
      for (const it of itens) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) { const b = await it.getType(t); return guardarImagem(new Uint8Array(await b.arrayBuffer()), t); }
      }
    } catch { /* sem permissão ou sem imagem */ }
    return { erro: 'Não há imagem copiada.' };
  }
  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[tipo] || 'jpg';
  const nome = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
  fs.writeFileSync(`${C.imagens}/${nome}`, bytes);
  return { src: `capa://foto/${nome}` };
}

// ---------- Links para fora ----------

function abrirFora(url) {
  window.open(url, '_system');
}

// O Stremio do Android (com.stremio.one) ou qualquer app que abra stremio://.
// Precisa do <queries> no AndroidManifest.xml: sem ele, o Android 11 em diante
// esconde os outros apps e a resposta é sempre "não".
async function stremioInstalado() {
  if (!Capacitor.isNativePlatform()) return true;
  for (const url of ['com.stremio.one', 'stremio:///']) {
    try {
      if ((await AppLauncher.canOpenUrl({ url })).value) return true;
    } catch { /* tenta o próximo */ }
  }
  return false;
}

function linksStremio(f) {
  const tipo = ehSerie(f) ? 'series' : 'movie'; // NANDRoll: séries de anime
  if (f.imdbID) return { app: `stremio:///detail/${tipo}/${f.imdbID}`, web: `https://web.stremio.com/#/detail/${tipo}/${f.imdbID}` };
  const q = encodeURIComponent(f.titulo);
  return { app: `stremio:///search?search=${q}`, web: `https://web.stremio.com/#/search?search=${q}` };
}

function linkLetterboxd(f) {
  if (f.linkLetterboxd) return f.linkLetterboxd;
  if (f.imdbID) return `https://letterboxd.com/imdb/${f.imdbID}/`;
  return `https://letterboxd.com/search/films/${encodeURIComponent(f.titulo)}/`;
}

// ---------- Compartilhar imagens (stories e retrospectiva) ----------
//
// No celular, salvar e copiar viram o menu de compartilhar do Android: dali
// vai direto para o Instagram, o WhatsApp ou "Salvar no dispositivo".

const nomeArquivo = (t) => String(t || 'nandflix').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'nandflix';

async function compartilharImagens(dataUrls, nome) {
  if (!Capacitor.isNativePlatform()) return { erro: 'Compartilhar só funciona no celular.' };
  const arquivos = [];
  for (const [i, url] of dataUrls.entries()) {
    const caminho = `${nomeArquivo(nome)}${dataUrls.length > 1 ? `-${i + 1}` : ''}.png`;
    await Filesystem.writeFile({ path: caminho, data: String(url).split(',')[1], directory: Directory.Cache });
    arquivos.push((await Filesystem.getUri({ path: caminho, directory: Directory.Cache })).uri);
  }
  try {
    await Share.share({ title: nome, files: arquivos, dialogTitle: 'Compartilhar ou salvar' });
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) return { erro: String((e && e.message) || e) };
  }
  return { ok: true };
}

// ---------- Atualização sem reinstalar ----------
//
// A interface do app (HTML, CSS e JavaScript) vem num .zip que o app do PC
// publica na pasta pública "app" do Supabase. Ao abrir (e ao voltar para o
// app), o celular confere a versão; se houver uma nova, baixa em segundo plano
// e ela entra na próxima vez que o app for aberto (ou na hora, por "Reiniciar").
// Só uma mudança no Android em si (plugins, permissões) precisa de APK novo.

const URL_VERSAO = nuvemConfig ? `${nuvemConfig.url}/storage/v1/object/public/app/versao.json` : null;
let versaoAtual = null;
let baixando = null;

async function lerVersaoAtual() {
  if (versaoAtual) return versaoAtual;
  try { versaoAtual = (await (await fetch('versao.json', { cache: 'no-store' })).json()).versao; } catch { versaoAtual = '0'; }
  return versaoAtual;
}

async function procurarAtualizacao() {
  if (!Capacitor.isNativePlatform() || !URL_VERSAO || baixando) return;
  baixando = (async () => {
    try {
      const r = await fetch(`${URL_VERSAO}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const nova = await r.json();
      if (!nova.versao || !nova.arquivo || nova.versao <= await lerVersaoAtual()) return;
      const { bundle } = await CapacitorUpdater.current();
      if (bundle && bundle.version === nova.versao) return;
      const b = await CapacitorUpdater.download({ url: `${nuvemConfig.url}/storage/v1/object/public/app/${nova.arquivo}`, version: nova.versao });
      await CapacitorUpdater.next({ id: b.id });
      avisar('celular:atualizacao', { versao: nova.versao, id: b.id });
    } catch (e) {
      console.error('atualizacao', e);
    }
  })().finally(() => { baixando = null; });
}

// O Voltar do Android vai para quem a interface registrar (celular.js).
let aoVoltar = null;
App.addListener('backButton', () => { if (aoVoltar) aoVoltar(); else App.minimizeApp(); });

// ---------- Início ----------

const lixeira = new Map();
const trailersEmBusca = new Map();
const relacionadosCache = new Map();
const soNoPc = async () => ({ erro: 'Isso só funciona no app do computador.' });

// ---------- nandplay: jogos (IGDB) e Steam (como no main.js) ----------
//
// No celular não há pastas da Steam (nada está "instalado") e os links da Steam
// viram a página da loja (https), que o app da Steam abre se estiver instalado.

const igdb = new Igdb({
  credenciais: () => ({ clientId: config.igdbClientId, clientSecret: config.igdbClientSecret }),
  lerToken: () => lerJSON(C.igdbToken, null),
  gravarToken: (d) => gravarJSON(C.igdbToken, d),
});

let atualizandoBiblioteca = null;
function atualizarBibliotecaSteam() {
  if (atualizandoBiblioteca) return atualizandoBiblioteca;
  atualizandoBiblioteca = (async () => {
    const { steamid, jogos } = await steam.jogosDaConta(config.steamKey, config.steamId);
    const dados = { perfil: String(config.steamId || '').trim(), steamid, em: new Date().toISOString(), jogos };
    gravarJSON(C.steamBiblioteca, dados);
    avisar('steam:biblioteca', dados);
    return dados;
  })().finally(() => { atualizandoBiblioteca = null; });
  return atualizandoBiblioteca;
}
async function bibliotecaSteam(opcoes) {
  if (!config.steamKey || !config.steamId) return null;
  const cache = lerJSON(C.steamBiblioteca, null);
  const doPerfil = Boolean(cache) && cache.perfil === String(config.steamId).trim();
  if ((opcoes && opcoes.forcar) || !doPerfil) return atualizarBibliotecaSteam();
  if (Date.now() - Date.parse(cache.em) > 6 * 3600 * 1000) atualizarBibliotecaSteam().catch(() => {});
  return cache;
}
async function testarJogos() {
  const r = { igdb: null, steam: null };
  if (config.igdbClientId || config.igdbClientSecret) {
    try { const t = await igdb.testar(); r.igdb = { ok: true, exemplo: t.exemplo }; } catch (e) { r.igdb = { ok: false, tipo: e.tipo || 'rede', mensagem: e.message }; }
  }
  if (config.steamKey || config.steamId) {
    try { const d = await atualizarBibliotecaSteam(); r.steam = { ok: true, jogos: d.jogos.length }; } catch (e) { r.steam = { ok: false, tipo: e.tipo || 'rede', mensagem: e.message }; }
  }
  return r;
}

let pronto = null;
// Importar de outros apps (lib/importar.js): procura no TMDB o que não está na lista
// e aplica tudo de uma vez na lista atual.
async function aplicarImportacao(fonte, itens) {
  const chave = config.tmdbKey;
  const res = await importar.aplicar(itens, () => filmes, {
    idPorTitulo: chave ? (titulo, ano) => tmdb.idPorTitulo(chave, titulo, ano) : null,
    idPorImdb: chave ? (imdbID) => tmdb.idPorImdb(chave, imdbID) : null,
  });
  gravarAgora();
  buscarCapasQueFaltam();
  return { ...res, fonte, filmes };
}

// Notas do TMDB e do Letterboxd, onde assistir e Stremio (lib/extras.js).
const extras = new Extras({ filmes: () => filmes, config: () => config, atualizarFilme, avisar, gravarAgora });

let episodiosDaSerie = null;
const pegarEpisodios = () => episodiosDaSerie || (episodiosDaSerie = new Episodios({ chave: () => config.tmdbKey, lerCache: () => lerJSON(C.episodios, null), gravarCache: (d) => gravarJSON(C.episodios, d) }));

// Prêmios (lib/premios.js): o histórico vem no app; as cerimônias recentes, da Wikipédia.
let acervo = null;
const pegarAcervo = () => {
  // O histórico de cada prêmio vem num arquivo à parte (www/premios/<id>.json, posto pelo montar.js).
  if (!acervo) acervo = new Acervo({ historico: (id) => fetch(`premios/${id}.json`).then((r) => (r.ok ? r.json() : null)), lerCache: () => lerJSON(C.premios, null), gravarCache: (d) => gravarJSON(C.premios, d) });
  return acervo;
};

function iniciar() {
  if (pronto) return pronto;
  pronto = (async () => {
    await carregarDisco();
    const d = lerJSON(C.filmes, null);
    filmes = (d && (Array.isArray(d) ? d : d.filmes)) || [];
    config = { ...CONFIG_PADRAO, ...lerJSON(C.config, {}) };
    marcas = new Marcas(C.sincronia);
    marcas.iniciar(filmes, config);
    if (nuvemConfig) nuvem = new Nuvem({
      url: nuvemConfig.url,
      chave: nuvemConfig.chave,
      pasta: PASTA,
      marcas,
      filmes: () => filmes,
      definirFilmes: (l) => { filmes = l; },
      config: () => config,
      gravarFilmes: gravarAgora,
      gravarConfig,
      avisar,
      configPublica,
      aoReceberFilmes: (l) => { if (l.some((f) => !f.tmdbEm)) buscarCapasQueFaltam(); },
      // O IndexedDB do app já é só dele (o Android não deixa outros apps lerem).
      cofre: { cifrar: (t) => t, decifrar: (b) => (typeof b === 'string' ? b : new TextDecoder().decode(b)) },
      pastas: { capas: C.capas, imagens: C.imagens },
    });
    if (nuvem) {
      // O celular não baixa as imagens da nuvem: mostra pelos links.
      nuvem.baixarImagens = atualizarLinks;
      nuvem.pronto = nuvem.iniciar().catch((e) => console.error('nuvem', e));
    }
    // Voltar para o app: busca o que mudou no PC enquanto estava fechado.
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) { if (nuvem) nuvem.sincronizar(); procurarAtualizacao(); } else descarregar(); });
    // Avisa o plugin que esta versão abriu bem (senão ele volta para a anterior).
    if (Capacitor.isNativePlatform()) CapacitorUpdater.notifyAppReady().catch(() => {});
    setTimeout(procurarAtualizacao, 4000);
  })();
  return pronto;
}

window.api = {
  plataforma: 'android',
  celular: {
    urlFoto,
    urlCapa,
    versao: lerVersaoAtual,
    aoVoltar: (fn) => { aoVoltar = fn; },
    minimizar: () => App.minimizeApp(),
    reiniciarComAtualizacao: (id) => CapacitorUpdater.set({ id }),
    procurarAtualizacao,
    aoAtualizacao: ouvir('celular:atualizacao'),
  },
  carregar: async () => {
    await iniciar();
    setTimeout(atualizarSeriesEmExibicao, 5000);
    if (config.steamKey && config.steamId) setTimeout(() => atualizarBibliotecaSteam().catch(() => {}), 8000);
    return { filmes, config: configPublica(), pastaDados: '', versao: VERSAO };
  },
  salvarConfig: async (mudancas) => {
    const permitidas = ['tmdbKey', 'omdbKey', 'stremio', 'visualizacao', 'ordenacao', 'watchlists', 'watchlistHoje', 'filmesDoMes', 'tierlist', 'tierlists', 'tierlistAtiva', 'filtrosSorteio', 'listas', 'nandroll', 'nandrollTodasPlataformas', 'nandrollPlataforma', 'streamingMarcados', 'pais', 'meusServicos', 'notaNaCapa', 'premios', 'plataformas', 'plataformaInicial', 'animesDoMes', 'jogosDoMes', 'igdbClientId', 'igdbClientSecret', 'steamKey', 'steamId'];
    for (const k of permitidas) if (k in mudancas) config[k] = mudancas[k];
    if ('nandroll' in mudancas) { config.nandroll = Boolean(mudancas.nandroll); if (config.nandroll) atualizarSeriesEmExibicao(); }
    gravarConfig();
    if ('tmdbKey' in mudancas && config.tmdbKey) buscarCapasQueFaltam();
    if ('pais' in mudancas) extras.atualizar();
    if (('steamKey' in mudancas || 'steamId' in mudancas) && config.steamKey && config.steamId) atualizarBibliotecaSteam().catch(() => {});
    return configPublica();
  },
  atualizarFilme: async (id, mudancas) => {
    const permitidas = ['titulo', 'ano', 'diretor', 'visto', 'vistoEm', 'favorito', 'notas', 'minhaNota', 'linkLetterboxd', 'buscaCapa', 'pagina', 'paginaEm', 'story', 'listas', 'shots', 'paginaOutra', 'epDias', 'status', 'tags', 'zeradoEm'];
    const limpo = {};
    for (const k of permitidas) if (k in mudancas) limpo[k] = mudancas[k];
    const atual = filmes.find((f) => f.id === id);
    if (atual && atual.tipo === 'jogo') Object.assign(limpo, camposDoJogo(mudancas)); // nandplay (como no main.js)
    // Jogo: zerar (ou 100%) é o "visto" dele (filtros, sorteio e contagens leem f.visto).
    if (ehJogo(atual) && 'status' in limpo) limpo.visto = limpo.status === 'zerado' || limpo.status === 'cem';
    if (ehSerie(atual)) {
      delete limpo.buscaCapa;
      if ('visto' in limpo) Object.assign(limpo, vistoSerie(atual, Boolean(limpo.visto)), 'vistoEm' in limpo ? { vistoEm: limpo.vistoEm } : {});
    } else if ('buscaCapa' in limpo) Object.assign(limpo, { capaNaoEncontrada: false, tmdbEm: '', tmdbId: '' });
    return atualizarFilme(id, limpo);
  },
  progressoSerie: async (id, delta, dia, temporada) => {
    const f = filmes.find((x) => x.id === id);
    if (!ehSerie(f)) return null;
    return atualizarFilme(id, comEpisodiosDoDia(f, comDia(f, passoSerie(f, Number(delta) < 0 ? -1 : 1, Number.isInteger(temporada) ? temporada : null), dia), dia));
  },
  definirSerie: async (id, n, dia, temporada) => {
    const f = filmes.find((x) => x.id === id);
    if (!ehSerie(f)) return null;
    return atualizarFilme(id, comEpisodiosDoDia(f, comDia(f, definirSerie(f, n, Number.isInteger(temporada) ? temporada : null), dia), dia, { registrar: false }));
  },
  episodioSerie: async (id, temporada, n, dia) => {
    const f = filmes.find((x) => x.id === id);
    if (!ehSerie(f)) return null;
    return atualizarFilme(id, comEpisodiosDoDia(f, comDia(f, alternarEpisodio(f, Number(temporada), n), dia), dia));
  },
  importarAnilist: (nome) => chamar(() => importarAnilist(nome)),
  // Importar dos serviços de streaming: no celular, só a Crunchyroll (e só
  // com o APK que traz o navegador embutido).
  streamingNoCelular: temNavegadorEmbutido() ? STREAMING_NO_CELULAR : [],
  lerStreaming: (id) => chamar(() => lerStreaming(id)),
  desconectarStreaming: async (id) => {
    if (!STREAMING_NO_CELULAR.includes(id) || !temNavegadorEmbutido()) return false;
    await InAppBrowser.clearCookies({ url: crunchyroll.SITE }).catch(() => {});
    return true;
  },
  procurarAnime: (termo) => chamar(() => anilist.pesquisar(termo)),
  importarDoStreaming: async (itens, lista) => importarDoStreaming(itens, lista),
  aoProgressoStreaming: ouvir('streaming:progresso'),
  statusSerie: async (id, status, dia) => {
    const f = filmes.find((x) => x.id === id);
    if (!ehSerie(f)) return null;
    return atualizarFilme(id, comEpisodiosDoDia(f, comDia(f, statusSerie(f, status), dia), dia, { registrar: false }));
  },
  pesquisarAnilist: (termo) => chamar(() => anilist.pesquisar(termo)),
  atualizarAnilist: (id) => chamar(async () => {
    const f = filmes.find((x) => x.id === id);
    if (!f || !f.anilistId) return null;
    await processarAnilist(f);
    gravarAgora();
    return f;
  }),
  abrirPlataforma: async (id, indice, temporada) => {
    const f = filmes.find((x) => x.id === id);
    const t = f && Number.isInteger(temporada) ? (f.temporadas || [])[temporada] : null;
  const l = f && ((t ? t.ondeAssistir : f.ondeAssistir) || [])[Number(indice)];
    if (!l || !/^https?:\/\//i.test(l.url)) return { ok: false };
    abrirFora(l.url);
    return { ok: true, url: l.url };
  },
  abrirAnilist: async (id, temporada) => {
    const f = filmes.find((x) => x.id === id);
    if (!f || !f.anilistId) return { ok: false };
    const t = Number.isInteger(temporada) ? (f.temporadas || [])[temporada] : null;
  const url = `https://anilist.co/anime/${Number((t && t.anilistId) || f.anilistId)}`;
    abrirFora(url);
    return { ok: true, url };
  },
  acharRepetido: async (dados, ignorarId) => acharRepetido(filmes, dados, ignorarId),
  adicionarFilme: async (dados) => {
    const ordem = filmes.reduce((m, f) => Math.max(m, f.ordem || 0), 0) + 1;
    // nandplay: o item de jogo já vem completo da IGDB/Steam (adicionarJogo, na interface).
    if (dados.tipo === 'jogo') {
      const jogo = novoJogo(dados, ordem);
      filmes.push(jogo);
      gravarDepois();
      return jogo;
    }
    const anilistId = Number(dados.anilistId) || '';
    const serie = Boolean(anilistId) && !dados.filme;
    const f = novoFilme({
      ordem,
      titulo: String(dados.titulo || '').trim(),
      ano: String(dados.ano || '').trim(),
      diretor: String(dados.diretor || '').trim(),
      imdbID: dados.imdbID || '',
      poster: dados.poster || '',
      ...(anilistId ? { anime: true, anilistId } : {}),
      ...(serie ? { tipo: 'serie', episodios: 0, episodiosVistos: 0, status: 'planejo', tmdbEm: new Date().toISOString() } : {}),
    });
    filmes.push(f);
    gravarDepois();
    if (anilistId) {
      processarAnilist(f, null, { novo: true }).catch(() => {}).then(() => { gravarAgora(); avisar('filme:mudou', f); });
      if (serie) return f;
    }
    if (config.tmdbKey) {
      processarTmdb(f, { tmdbId: dados.tmdbId || null }).catch(() => {}).then(() => { gravarAgora(); avisar('filme:mudou', f); extras.agora(f.id); });
    }
    return f;
  },
  excluirFilme: async (id) => {
    const i = filmes.findIndex((f) => f.id === id);
    if (i < 0) return false;
    lixeira.set(id, { filme: filmes[i], indice: i });
    filmes = filmes.filter((f) => f.id !== id);
    gravarDepois();
    return true;
  },
  restaurarFilme: async (id) => {
    const g = lixeira.get(id);
    if (!g) return null;
    lixeira.delete(id);
    filmes.splice(Math.min(g.indice, filmes.length), 0, g.filme);
    gravarDepois();
    return g.filme;
  },
  trocarCapa: async (id, escolha) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return null;
    try {
      if (ehSerie(f)) {
        if (!/^https:\/\//.test(escolha.poster || '')) return null;
        atualizarFilme(id, { poster: escolha.poster, capaTmdb: true, capaPersonalizada: false, capaNaoEncontrada: false });
      } else if (escolha.poster && String(escolha.tmdbId) === String(f.tmdbId)) atualizarFilme(id, { poster: escolha.poster, capaPersonalizada: false, capaNaoEncontrada: false });
      else { atualizarFilme(id, { capaPersonalizada: false }); await processarTmdb(f, { tmdbId: escolha.tmdbId, trocarFilme: true }); }
    } catch (e) { return { erro: e.message }; }
    gravarAgora();
    avisar('filme:mudou', f);
    return f;
  },
  baixarCapa: soNoPc,
  baixarTodasCapas: soNoPc,
  usarArquivoCapa: soNoPc,
  caminhoDoArquivo: () => '',
  // Título, sinopse e imagem de cada episódio (TMDB), num cache à parte (lib/episodios.js).
  episodiosSerie: async (id, indice) => {
    const f = filmes.find((x) => x.id === id);
    if (!ehSerie(f)) return { ok: false, motivo: 'serie' };
    try { return await pegarEpisodios().daTemporada(f, indice); } catch { return { ok: false, motivo: 'rede' }; }
  },
  // As aberturas no YouTube (como os trailers); a pessoa toca no player embutido.
  aberturasAnime: async (id, indice) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return { ok: false, motivo: 'serie' };
    try { return { ok: true, videos: await trailer.aberturasDe(f, Number.isInteger(indice) ? indice : null) }; } catch { return { ok: false, motivo: 'rede' }; }
  },
  obterTrailer: async (id) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return null;
    if (ehJogo(f)) return f.trailerId && f.trailerId !== 'nenhum' ? f.trailerId : null; // o trailer do jogo vem da IGDB
    if (f.trailerId) return f.trailerId === 'nenhum' ? null : f.trailerId;
    if (!trailersEmBusca.has(id)) {
      trailersEmBusca.set(id, trailer.buscarTrailer(f)
        .then((v) => { atualizarFilme(id, { trailerId: v || 'nenhum' }); return v; })
        .catch(() => null)
        .finally(() => trailersEmBusca.delete(id)));
    }
    return trailersEmBusca.get(id);
  },
  definirTrailer: async (id, texto) => {
    const t = String(texto || '').trim();
    if (!t) return { filme: atualizarFilme(id, { trailerId: '', trailerManual: false }) };
    const v = trailer.idDoLink(t);
    if (!v) return { erro: 'Não reconheci esse link do YouTube.' };
    return { filme: atualizarFilme(id, { trailerId: v, trailerManual: true }) };
  },
  infoFilme: async (id) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return { ok: false };
    if (f.info || f.tmdbEm || !config.tmdbKey) return { ok: true, info: f.info || null };
    try { await processarTmdb(f); gravarAgora(); avisar('filme:mudou', f); return { ok: true, info: f.info || null }; } catch (e) { return { ok: false, erro: { tipo: e.tipo || 'rede', mensagem: e.message } }; }
  },
  pesquisarTmdb: (termo) => chamar(async () => {
    const t = String(termo || '').trim();
    if (/^tt\d+$/i.test(t)) {
      const id = await tmdb.idPorImdb(config.tmdbKey, t.toLowerCase());
      const d = id && await tmdb.detalhes(config.tmdbKey, id);
      return d ? [{ tmdbId: d.tmdbId, imdbID: d.imdbID, titulo: d.titulo, ano: d.ano, poster: d.poster }] : [];
    }
    return tmdb.pesquisar(config.tmdbKey, t);
  }),
  detalhesTmdb: (tmdbId) => chamar(() => tmdb.detalhes(config.tmdbKey, tmdbId)),
  capasTmdb: (id) => chamar(() => {
    const f = filmes.find((x) => x.id === id);
    if (ehSerie(f)) return capasDaSerie(f);
    return f && f.tmdbId ? tmdb.capas(config.tmdbKey, f.tmdbId, f.idiomaOriginal) : [];
  }),
  relacionadosTmdb: (id) => chamar(async () => {
    const f = filmes.find((x) => x.id === id);
    const tmdbId = f ? f.tmdbId : (String(id).match(/^tmdb-(\d+)$/) || [])[1];
    if (!tmdbId || !config.tmdbKey) return null;
    if (!relacionadosCache.has(tmdbId)) relacionadosCache.set(tmdbId, tmdb.relacionados(config.tmdbKey, tmdbId).catch((e) => { relacionadosCache.delete(tmdbId); throw e; }));
    return relacionadosCache.get(tmdbId);
  }),
  testarChaveTmdb: (chave) => chamar(() => tmdb.idPorImdb(String(chave || '').trim(), 'tt0111161')),
  testarChave: (chave) => chamar(() => omdb.detalhes(String(chave || '').trim(), 'tt0111161')),
  buscarCapas: (opcoes) => buscarCapasQueFaltam(opcoes || {}),
  // As notas do OMDb são buscadas pelo PC e chegam pela nuvem.
  buscarInfos: async () => ({ pulada: 'celular' }),
  aoProgressoInfos: ouvir('infos:progresso'),
  aoFimInfos: ouvir('infos:fim'),
  abrirStremio: async (id, forcarWeb) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return { ok: false };
    // Série de anime sem o código do IMDb: pede ao TMDB, para o Stremio abrir direto nela.
    if (ehSerie(f) && !f.imdbID && f.tmdbTvId && config.tmdbKey) {
      const imdb = await tmdb.imdbDaSerie(config.tmdbKey, f.tmdbTvId).catch(() => '');
      if (imdb) atualizarFilme(id, { imdbID: imdb });
    }
    const l = linksStremio(f);
    if (forcarWeb || config.stremio === 'web') {
      abrirFora(l.web);
      return { ok: true, url: l.web };
    }
    // Sem o app do Stremio, o link stremio:// não vai a lugar nenhum: a interface
    // pergunta se abre o Stremio Web (como no PC).
    if (!(await stremioInstalado())) return { ok: false, semApp: true };
    try {
      const { completed } = await AppLauncher.openUrl({ url: l.app });
      if (!completed) return { ok: false, semApp: true };
    } catch {
      return { ok: false, semApp: true };
    }
    return { ok: true, url: l.app };
  },
  abrirLink: async (url) => { if (String(url).startsWith('https://')) abrirFora(String(url)); },
  // nandplay
  buscarJogos: (termo) => chamar(() => igdb.buscarJogos(termo)),
  detalhesJogo: (id) => chamar(() => igdb.detalhesJogo(id)),
  igdbDaSteam: (appid) => chamar(() => igdb.igdbDaSteam(appid)),
  capasJogos: (pedido) => chamar(() => igdb.capasDeJogos(pedido || {})),
  buscarJogosSteam: (termo) => chamar(async () => (await steam.buscarLoja(termo)).filter(steam.ehJogoDaLoja).map(steam.resultadoDaLoja)),
  detalhesJogoSteam: (appid) => chamar(async () => {
    const det = await steam.detalhesLoja(appid);
    if (!det) throw Object.assign(new Error('A Steam não tem esse jogo à venda.'), { tipo: 'rede' });
    let imagens = null;
    try { imagens = (await steam.imagensLoja([appid]))[det.appid] || null; } catch { /* fica o caminho simples */ }
    return steam.itemDeLoja(det, imagens);
  }),
  jogosDoDesenvolvedor: (empresaId, opcoes) => chamar(() => igdb.jogosDoDesenvolvedor(empresaId, opcoes || {})),
  testarJogos,
  steamLocal: async () => ({ steamNoPc: false, instalados: [] }),
  steamBiblioteca: (opcoes) => chamar(() => bibliotecaSteam(opcoes)),
  // Qualquer ação vira a página da loja (o celular não abre steam://).
  abrirSteam: async (appid) => {
    const url = steam.linkSteam('web', appid);
    if (!url) return { ok: false };
    abrirFora(url);
    return { ok: true, url };
  },
  aoBibliotecaSteam: ouvir('steam:biblioteca'),
  imagensSteam: (appids) => chamar(async () => {
    const ids = [...new Set([].concat(appids || []).map(steam.appidValido).filter(Boolean))];
    const r = ids.length ? await steam.imagensLoja(ids) : {};
    return Object.fromEntries(ids.map((id) => [id, r[id] || steam.imagensSteam(id)]));
  }),
  // O id do HowLongToBeat pelo Wikidata (aceita pedidos do WebView), com cache como no PC.
  hltbJogo: (jogo) => chamar(async () => {
    const j = { igdbSlug: jogo && jogo.igdbSlug, steam: jogo && jogo.steam };
    const cache = lerJSON(C.hltb, {}) || {};
    const guardado = hltb.doCacheHltb(cache, j);
    if (guardado !== undefined) return guardado;
    const id = await hltb.acharHltb(j);
    const chave = hltb.chaveCacheHltb(j);
    if (chave !== '|') gravarJSON(C.hltb, { ...cache, [chave]: { id, em: new Date().toISOString() } });
    return id;
  }),
  extrasAgora: (id, opcoes) => extras.agora(id, opcoes || {}),
  listaPremios: async () => listaPremios(),
  premios: async (id) => { await iniciar(); return pegarAcervo().dados(id); },
  atualizarPremios: async (id, opcoes) => { await iniciar(); return chamar(() => pegarAcervo().atualizar(id, opcoes || {})); },
  provedoresTmdb: () => chamar(() => tmdb.provedores(config.tmdbKey, config.pais || 'BR')),
  abrirLetterboxd: async (id) => {
    const f = filmes.find((x) => x.id === id);
    if (!f) return { ok: false };
    const url = linkLetterboxd(f);
    abrirFora(url);
    return { ok: true, url };
  },
  abrirPastaDados: async () => {},
  lerPlanilha: soNoPc,
  aplicarPlanilha: soNoPc,
  exportarPlanilha: soNoPc,
  exportarBackup: soNoPc,
  importarBackup: soNoPc,
  statusBackup: async () => ({ ultimo: {}, diarios: [], pastaExtra: null }),
  escolherPastaBackup: soNoPc,
  tirarPastaBackup: soNoPc,
  backupAgora: soNoPc,
  restaurarBackup: soNoPc,
  // O .zip do export do Letterboxd (ou os .csv), escolhido no celular.
  // Os arquivos exportados de outro app (.zip ou .csv: Letterboxd, IMDb, Rotten Tomatoes…).
  importarArquivos: async () => {
    const escolhidos = await escolherArquivos();
    if (!escolhidos.length) return { cancelado: true };
    let lido;
    try {
      const arquivos = await Promise.all(escolhidos.map(async (a) => ({ nome: a.name || '', bytes: new Uint8Array(await a.arrayBuffer()) })));
      lido = importar.lerArquivos(importar.textosDosArquivos(arquivos));
    } catch (e) {
      return { erro: e.message };
    }
    return aplicarImportacao(lido.fonte, lido.itens);
  },
  // A biblioteca do Stremio, pela conta (a senha não é guardada).
  importarStremio: async (email, senha) => {
    let itens;
    try {
      itens = stremio.converter(await stremio.biblioteca(email, senha));
    } catch (e) {
      return { erro: e.message };
    }
    if (!itens.length) return { erro: 'Não achei filmes na sua biblioteca do Stremio.' };
    return aplicarImportacao('stremio', itens);
  },
  importarLetterboxd: (...args) => window.api.importarArquivos(...args),
  dadosImagem,
  guardarImagem,
  salvarStory: (dataUrl, nome) => compartilharImagens([dataUrl], nome),
  copiarStory: (dataUrl) => compartilharImagens([dataUrl], 'story'),
  salvarVariosStories: (dataUrls, nome) => compartilharImagens(dataUrls, nome),
  mostrarArquivo: async () => {},
  aoMudarFilme: ouvir('filme:mudou'),
  aoProgressoCapas: ouvir('capas:progresso'),
  aoFimCapas: ouvir('capas:fim'),
  aoAtualizacaoDisponivel: ouvir('atualizacao:disponivel'),
  aoAtualizacaoPronta: ouvir('atualizacao:pronta'),
  instalarAtualizacao: async () => {},
  statusNuvem: async () => {
    await iniciar();
    if (!nuvem) return { indisponivel: true };
    await nuvem.pronto;
    return nuvem.infos();
  },
  entrarNuvem: async (email, senha) => { const r = await nuvem.entrar(String(email || '').trim(), String(senha || '')); return r; },
  criarContaNuvem: (email, senha) => nuvem.criarConta(String(email || '').trim(), String(senha || '')),
  reenviarConfirmacao: (email) => nuvem.reenviar(String(email || '').trim()),
  sairNuvem: () => nuvem.sair(),
  sincronizarNuvem: async () => { await nuvem.sincronizar(); return nuvem.infos(); },
  aoStatusNuvem: ouvir('nuvem:status'),
  aoMudarNuvem: ouvir('nuvem:mudou'),
  aoLinksImagens: ouvir('imagens:links'),
};
