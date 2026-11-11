const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen, session, webFrameMain, clipboard, ClipboardItem, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const armazem = require('./lib/armazem');
const planilha = require('./lib/planilha');
const omdb = require('./lib/omdb');
const trailer = require('./lib/trailer');
const tmdb = require('./lib/tmdb');
const anilist = require('./lib/anilist');
const { novoFilme, juntar, resumo, acharRepetido, mesmoFilme, ehSerie, passoSerie, definirSerie, alternarEpisodio, statusSerie, comDia, vistoSerie } = require('./lib/filmes');
const letterboxd = require('./lib/letterboxd');
const { Marcas } = require('./lib/marcas');
const { Nuvem } = require('./lib/nuvem');

app.setName(armazem.NOME_APP);
// FILMES_LEGAIS_DADOS: outra pasta de dados (para testar sem mexer na lista de verdade).
app.setPath('userData', process.env.FILMES_LEGAIS_DADOS || armazem.migrarPastaAntiga(app.getPath('appData')));
// O trailer pode ser desmutado sem precisar de um clique dentro do vídeo.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Datas no formato brasileiro (dd/mm/aaaa) nos campos de data, como o "Lançar outro dia".
app.commandLine.appendSwitch('lang', 'pt-BR');

const PASTA = app.getPath('userData');
const C = armazem.caminhos(PASTA);

const CONFIG_PADRAO = {
  tmdbKey: '', // cada pessoa usa a própria chave (o app pede ao abrir enquanto não houver)
  omdbKey: '', // opcional: só para as notas do IMDb, Metascore e Rotten Tomatoes
  stremio: 'app', // 'app' | 'web'
  visualizacao: 'grade',
  ordenacao: 'ordem',
  janela: null,
  limiteAtingidoEm: null,
};

let config = { ...CONFIG_PADRAO, ...armazem.lerJSON(C.config, {}) };
let filmes = [];
let janela = null;
let planilhaPendente = null;
// Quando cada campo mudou, para a sincronia com a nuvem (começa ao abrir).
let marcas = null;
// A nuvem (Supabase), se lib/nuvem.config.json existir com a URL e a chave do projeto.
let nuvem = null;

// ---------- Gravação ----------

let timerGravar = null;
function gravarDepois() {
  clearTimeout(timerGravar);
  timerGravar = setTimeout(gravarAgora, 300);
}
function gravarAgora() {
  clearTimeout(timerGravar);
  timerGravar = null;
  armazem.gravarFilmes(PASTA, filmes);
  if (marcas && marcas.registrarFilmes(filmes) && nuvem) nuvem.agendar();
  mudouDesdeBackup = true;
}
function gravarConfig() {
  armazem.gravarJSON(C.config, config);
  if (marcas && marcas.registrarConfig(config) && nuvem) nuvem.agendar();
  mudouDesdeBackup = true;
}

// ---------- Backup diário ----------
//
// Uma cópia por dia (diario-AAAA-MM-DD.json) com os filmes e o que o app guarda
// nas configurações (watchlists, tierlists, listas…), sem as chaves das APIs.
// A cópia do dia é refeita a cada hora em que algo mudou e ao fechar o app;
// ficam os 30 dias mais recentes. Se houver uma pasta extra (a do Google
// Drive, por exemplo), a mesma cópia vai para lá também.
const MAX_DIARIOS = 30;
const CONFIG_NO_BACKUP = ['stremio', 'visualizacao', 'ordenacao', 'watchlists', 'watchlistHoje', 'filmesDoMes', 'tierlist', 'tierlists', 'tierlistAtiva', 'filtrosSorteio', 'listas'];
const RE_DIARIO = /^diario-\d{4}-\d{2}-\d{2}\.json$/;
let mudouDesdeBackup = true;
let ultimoBackup = { em: null, erroExtra: null };

const diaLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function instantaneo() {
  const cfg = {};
  for (const k of CONFIG_NO_BACKUP) if (k in config) cfg[k] = config[k];
  return { versao: 2, app: 'NANDFlix', salvoEm: new Date().toISOString(), filmes, config: cfg };
}

function limparDiarios(pasta) {
  const velhos = fs.readdirSync(pasta).filter((n) => RE_DIARIO.test(n)).sort().reverse().slice(MAX_DIARIOS);
  for (const n of velhos) fs.unlinkSync(path.join(pasta, n));
}

function backupDiario({ forcar = false } = {}) {
  const nome = `diario-${diaLocal()}.json`;
  if (!forcar && !mudouDesdeBackup && fs.existsSync(path.join(C.backups, nome))) return;
  if (!filmes.length) return; // lista vazia (primeira vez): nada a guardar
  const dados = instantaneo();
  armazem.gravarJSON(path.join(C.backups, nome), dados);
  limparDiarios(C.backups);
  ultimoBackup = { em: dados.salvoEm, erroExtra: null };
  if (config.pastaBackup) {
    try {
      armazem.gravarJSON(path.join(config.pastaBackup, nome), dados);
      limparDiarios(config.pastaBackup);
    } catch (e) { ultimoBackup.erroExtra = e.message; }
  }
  mudouDesdeBackup = false;
}

function listaDiarios() {
  if (!fs.existsSync(C.backups)) return [];
  return fs.readdirSync(C.backups).filter((n) => RE_DIARIO.test(n)).sort().reverse().map((n) => {
    const st = fs.statSync(path.join(C.backups, n));
    return { arquivo: n, dia: n.slice(7, 17), salvoEm: st.mtime.toISOString(), tamanho: st.size };
  });
}

// Lê um backup (o diário, ou um arquivo exportado: versão 1 só com filmes, ou 2 com as configurações).
function lerBackup(arquivo) {
  const dados = armazem.lerJSON(arquivo, null);
  const lista = Array.isArray(dados) ? dados : dados && dados.filmes;
  if (!Array.isArray(lista) || lista.some((f) => !f || typeof f.titulo !== 'string')) return null;
  return { filmes: lista, config: (dados && !Array.isArray(dados) && dados.config) || null };
}

function aplicarBackup(b) {
  armazem.fazerBackup(PASTA);
  backupDiario({ forcar: true }); // o estado de agora fica guardado antes de trocar
  filmes = b.filmes.map((f) => novoFilme(f));
  if (b.config) for (const k of CONFIG_NO_BACKUP) if (k in b.config) config[k] = b.config[k];
  gravarAgora();
  gravarConfig();
}

function avisar(canal, dados) {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados);
}

function atualizarFilme(id, mudancas) {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return null;
  Object.assign(filme, mudancas);
  gravarDepois();
  return filme;
}

// ---------- TMDB: capas, logos, trailers e informações ----------

// O TMDB é a fonte principal de cada filme: capa (sempre a do idioma original),
// logo, trailer oficial, sinopse, gêneros, elenco, direção, duração, países e
// classificação. `tmdbEm` marca que o filme já passou pelo TMDB (achado ou não);
// os filmes sem ela, inclusive os que vieram do OMDb, são atualizados em
// segundo plano ao abrir o app. Capas escolhidas pelo usuário (arquivo próprio)
// e trailers colados à mão nunca são trocados.

function nomeArquivoCapa(filme) {
  const base = (filme.imdbID || filme.id).replace(/[^\w-]/g, '');
  return `${base}.jpg`;
}

async function baixarImagem(url, nome) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resposta.ok) return false;
  const dados = Buffer.from(await resposta.arrayBuffer());
  fs.mkdirSync(C.capas, { recursive: true });
  fs.writeFileSync(path.join(C.capas, nome), dados);
  return true;
}

async function baixarCapa(filme) {
  if (!filme.poster) return false;
  const nome = nomeArquivoCapa(filme);
  try {
    if (!(await baixarImagem(filme.poster, nome))) return false;
    // `v` muda a URL da imagem quando a capa é trocada, para não ficar a antiga no cache.
    atualizarFilme(filme.id, { capaLocal: `${nome}?v=${Date.now()}` });
    return true;
  } catch {
    return false;
  }
}

async function baixarLogo(filme) {
  if (!filme.logo) return false;
  const nome = `${(filme.imdbID || filme.id).replace(/[^\w-]/g, '')}-logo.png`;
  try {
    if (!(await baixarImagem(filme.logo, nome))) return false;
    atualizarFilme(filme.id, { logoLocal: `${nome}?v=${Date.now()}` });
    return true;
  } catch {
    return false;
  }
}

function capaLocalExiste(filme) {
  if (!filme.capaLocal) return false;
  return fs.existsSync(path.join(C.capas, filme.capaLocal.split('?')[0]));
}

const NOTAS_OMDB = ['imdb', 'metascore', 'rotten'];

// Guarda no filme o que veio do TMDB. `trocarFilme`: o usuário escolheu outro
// filme em "Trocar capa", então as notas do OMDb (do filme antigo) saem.
async function aplicarTmdb(f, d, { trocarFilme = false } = {}) {
  const outroFilme = trocarFilme || Boolean(d.imdbID && f.imdbID && d.imdbID !== f.imdbID);
  const info = { ...(outroFilme ? {} : f.info || {}), ...d.info, atualizadoEm: new Date().toISOString() };
  if (outroFilme) for (const k of NOTAS_OMDB) delete info[k];
  const mudancas = {
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
  if (!d.logo) mudancas.logoLocal = '';
  if (d.trailerId && !f.trailerManual) mudancas.trailerId = d.trailerId;
  const trocarCapa = Boolean(d.poster) && !f.capaPersonalizada && (d.poster !== f.poster || !capaLocalExiste(f) || outroFilme);
  if (trocarCapa) Object.assign(mudancas, { poster: d.poster, capaNaoEncontrada: false });
  atualizarFilme(f.id, mudancas);
  if (trocarCapa) await baixarCapa(f);
  if (d.logo) await baixarLogo(f);
  return true;
}

// Acha o filme no TMDB (pelo id, pelo código do IMDb, pela "Busca da capa" ou
// pelo título e ano) e atualiza. Devolve true se achou.
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

// ---------- AniList: os animes (NANDRoll) ----------

// Traz da AniList o que o app guarda de um anime e baixa a capa se mudou.
// Série: tudo vem de lá. Filme de anime: só o id e onde assistir (o resto é do TMDB).
async function processarAnilist(f, anilistId = null, { novo = false } = {}) {
  const id = anilistId || f.anilistId;
  if (!id) return false;
  // Série: todas as temporadas juntas no mesmo item. Filme de anime: só o id e onde assistir.
  const lista = ehSerie(f) ? await anilist.temporadas(id) : [await anilist.detalhes(id)].filter(Boolean);
  if (!lista.length) return false;
  const d = lista[0];
  const posterAntes = f.poster;
  atualizarFilme(f.id, ehSerie(f) ? anilist.camposSerie(lista, f, { novo }) : anilist.campos(d, f));
  if (ehSerie(f)) { await capaTmdbDaSerie(f, d); buscarNotasQueFaltam(); }
  if (f.poster && (f.poster !== posterAntes || (ehSerie(f) && !capaLocalExiste(f)))) await baixarCapa(f);
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
  if (c && c.logo) await baixarLogo(f);
}

// Séries em exibição (ou que ainda vão estrear) mudam: episódios, próximo
// episódio, data. São conferidas de novo ao abrir o app, no máximo a cada 6 horas.
let atualizandoSeries = false;
async function atualizarSeriesEmExibicao() {
  if (atualizandoSeries || !config.nandroll) return; // NANDRoll é opcional (Configurações)
  atualizandoSeries = true;
  const limite = Date.now() - 6 * 3600 * 1000;
  const fila = filmes.filter((f) => f.anilistId && (ehSerie(f) || !f.anilistEm)
    && (!f.anilistEm || (config.tmdbKey && !f.tmdbTvEm) || (['em exibição', 'não lançado', 'em hiato'].includes(f.exibicao) && Date.parse(f.anilistEm) < limite)));
  try {
    for (const f of fila) {
      await processarAnilist(f);
      avisar('filme:mudou', f);
      await new Promise((r) => setTimeout(r, 800)); // folga para o limite por minuto da AniList
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

let buscaEmAndamento = null;

// Atualiza pelo TMDB os filmes que ainda não passaram por ele (4 ao mesmo tempo)
// e baixa as capas que faltam no disco. `incluirNaoEncontradas`: tenta de novo
// os que o TMDB não achou da última vez.
async function buscarCapasQueFaltam({ incluirNaoEncontradas = false } = {}) {
  if (buscaEmAndamento) return buscaEmAndamento;
  if (!config.tmdbKey) return { pulada: 'chave' };

  const consultar = filmes.filter((f) => !f.tmdbEm || (incluirNaoEncontradas && !f.tmdbId));
  const semArquivo = filmes.filter((f) => f.tmdbEm && f.poster && !f.capaPersonalizada && !capaLocalExiste(f) && !consultar.includes(f));
  const fila = [
    ...consultar.map((f) => ({ f, consultar: true })),
    ...semArquivo.map((f) => ({ f, consultar: false })),
  ];
  if (!fila.length) { buscarNotasQueFaltam(); return { total: 0, encontradas: 0 }; }

  buscaEmAndamento = (async () => {
    const total = fila.length;
    let feitos = 0;
    let encontradas = 0;
    let erro = null;
    avisar('capas:progresso', { feitos, total });

    const trabalhar = async () => {
      while (fila.length && !erro) {
        const { f, consultar } = fila.shift();
        try {
          if (consultar) { if (await processarTmdb(f)) encontradas++; }
          else await baixarCapa(f);
          avisar('filme:mudou', f);
        } catch (e) {
          // Chave errada ou sem internet: para tudo (o resto fica para depois).
          if (e instanceof tmdb.ErroTmdb) erro = e;
        }
        feitos++;
        avisar('capas:progresso', { feitos, total });
      }
    };
    await Promise.all([trabalhar(), trabalhar(), trabalhar(), trabalhar()]);
    gravarAgora();
    const resultado = { total: feitos, encontradas, erro: erro ? { tipo: erro.tipo, mensagem: erro.message } : null };
    avisar('capas:fim', resultado);
    buscarNotasQueFaltam();
    return resultado;
  })();

  try {
    return await buscaEmAndamento;
  } finally {
    buscaEmAndamento = null;
  }
}

// ---------- OMDb: notas do IMDb, Metascore e Rotten Tomatoes (opcional) ----------

// Só com a chave do OMDb. Busca as notas dos filmes que ainda não têm (2 por vez)
// e para no limite do dia, sem chave ou sem internet; continua depois. Filmes que
// o TMDB não achou ganham também o resto das informações do OMDb.
// `forcar`: tenta mesmo que o limite do dia já tenha sido marcado como atingido.
const temNotasOmdb = (f) => Boolean(f.info && 'imdb' in f.info);
let buscandoInfos = false;
function buscarNotasQueFaltam({ forcar = false } = {}) {
  if (buscandoInfos) return { emAndamento: true };
  if (!config.omdbKey) return { pulada: 'chave' };
  const hoje = new Date().toISOString().slice(0, 10);
  if (!forcar && config.limiteAtingidoEm === hoje) return { pulada: 'limite' };
  const fila = filmes.filter((f) => f.imdbID && !temNotasOmdb(f));
  if (!fila.length) return { total: 0 };
  buscandoInfos = true;
  const total = fila.length;
  let feitos = 0;
  let erro = null;
  avisar('infos:progresso', { feitos, total });
  const trabalhar = async () => {
    while (fila.length && !erro) {
      const f = fila.shift();
      if (f.imdbID && !temNotasOmdb(f)) {
        try {
          const d = await omdb.detalhes(config.omdbKey, f.imdbID);
          const notas = Object.fromEntries(NOTAS_OMDB.map((k) => [k, (d && d.info[k]) || '']));
          // Sem TMDB, o OMDb completa o que faltar (gêneros, sinopse, país…).
          const base = f.tmdbId || !d ? {} : d.info;
          const mudancas = { info: { ...base, ...(f.info || {}), ...notas, atualizadoEm: new Date().toISOString() } };
          if (!f.diretor && d && d.diretor) mudancas.diretor = d.diretor;
          atualizarFilme(f.id, mudancas);
          avisar('filme:mudou', f);
        } catch (e) {
          erro = e;
          if (e.tipo === 'limite') {
            config.limiteAtingidoEm = hoje;
            gravarConfig();
          }
        }
      }
      feitos++;
      avisar('infos:progresso', { feitos, total });
    }
  };
  Promise.all([trabalhar(), trabalhar()]).then(() => {
    gravarAgora();
    buscandoInfos = false;
    const faltam = filmes.filter((f) => f.imdbID && !temNotasOmdb(f)).length;
    avisar('infos:fim', { total, faltam, erro: erro ? { tipo: erro.tipo || 'rede', mensagem: erro.message } : null });
  });
  return { iniciada: true, total };
}

ipcMain.handle('infos:buscar', () => buscarNotasQueFaltam({ forcar: true }));

// ---------- Janela ----------

function boundsValidos(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

function criarJanela() {
  const salvo = config.janela;
  const opcoes = {
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#14181C',
    title: 'Filmes legais',
    icon: path.join(__dirname, 'src', 'icone.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (salvo && boundsValidos(salvo.bounds)) Object.assign(opcoes, salvo.bounds);
  janela = new BrowserWindow(opcoes);
  // Rodando direto da pasta (sem build): fixar na barra de tarefas guarda o
  // comando que abre esta pasta no Electron, com o ícone do app. Assim o atalho
  // fixado sempre abre o código mais novo, sem precisar gerar o .exe.
  if (process.platform === 'win32' && !app.isPackaged) {
    janela.setAppDetails({
      appId: 'app.filmeslegais.pasta',
      relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'NANDFlix',
      appIconPath: path.join(__dirname, 'build', 'icon.ico'),
    });
  }
  if (salvo && salvo.maximizada) janela.maximize();
  janela.once('ready-to-show', () => janela.show());

  let timer = null;
  const lembrar = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (janela.isDestroyed()) return;
      const maximizada = janela.isMaximized();
      config.janela = { bounds: maximizada ? (config.janela?.bounds || janela.getBounds()) : janela.getBounds(), maximizada };
      gravarConfig();
    }, 400);
  };
  janela.on('resize', lembrar);
  janela.on('move', lembrar);
  janela.on('maximize', lembrar);
  janela.on('unmaximize', lembrar);

  // Links nunca abrem dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e) => e.preventDefault());

  // Trailers de fundo (destaque e prévia, sem controles): esconde a interface
  // do YouTube por cima do vídeo (título, botões, legendas, "More videos"),
  // para o vídeo aparecer limpo assim que começa a tocar.
  janela.webContents.on('frame-created', (_e, { frame }) => {
    if (frame) frame.on('dom-ready', () => limparTrailer(frame));
  });
  janela.webContents.on('did-frame-finish-load', (_e, principal, processo, rota) => {
    if (!principal) limparTrailer(webFrameMain.fromId(processo, rota));
  });

  janela.loadFile(path.join(__dirname, 'src', 'index.html'));
}

const CSS_TRAILER_LIMPO = `
  body > :not(#player), .html5-video-player > :not(.html5-video-container) { display: none !important; }
  .html5-video-player, body { background: transparent !important; cursor: default !important; }
`;

function limparTrailer(frame) {
  try {
    if (!frame || !/^https:\/\/www\.youtube-nocookie\.com\/embed\/.*[?&]controls=0/.test(frame.url)) return;
    frame.executeJavaScript(`(() => {
      if (document.getElementById('fl-limpo')) return;
      const s = document.createElement('style');
      s.id = 'fl-limpo';
      s.textContent = ${JSON.stringify(CSS_TRAILER_LIMPO)};
      (document.head || document.documentElement).append(s);
    })()`).catch(() => {});
  } catch { /* o quadro pode ter sumido */ }
}

// ---------- Atualização automática (versão compilada) ----------

// Procura versão nova nas releases do GitHub ao abrir e a cada 6 horas.
// Instalado (pelo Setup): baixa sozinho em segundo plano e avisa quando estiver
// pronto; reiniciar instala (fechar o app também instala). Portátil: não consegue
// trocar o próprio .exe, então só avisa, com o link da página de download.
const PORTATIL = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
let atualizador = null;

function iniciarAtualizacoes() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater: atualizador } = require('electron-updater'));
  } catch {
    return;
  }
  atualizador.autoDownload = !PORTATIL;
  atualizador.autoInstallOnAppQuit = !PORTATIL;
  atualizador.on('update-available', (info) => {
    if (PORTATIL) avisar('atualizacao:disponivel', { versao: info.version, url: `https://github.com/aabobrinha/NANDFlix/releases/tag/v${info.version}` });
  });
  atualizador.on('update-downloaded', (info) => avisar('atualizacao:pronta', { versao: info.version }));
  atualizador.on('error', () => {}); // sem internet ou GitHub fora do ar: tenta na próxima
  const verificar = () => atualizador.checkForUpdates().catch(() => {});
  setTimeout(verificar, 8000);
  setInterval(verificar, 6 * 60 * 60 * 1000);
}

ipcMain.handle('atualizacao:instalar', () => {
  if (!atualizador || PORTATIL) return;
  if (timerGravar) gravarAgora();
  atualizador.quitAndInstall();
});

// ---------- Links externos ----------

function stremioInstalado() {
  try {
    return Boolean(app.getApplicationNameForProtocol('stremio://'));
  } catch {
    return false;
  }
}

function linksStremio(filme) {
  if (filme.imdbID) {
    const tipo = ehSerie(filme) ? 'series' : 'movie'; // NANDRoll: séries de anime
    return {
      app: `stremio:///detail/${tipo}/${filme.imdbID}`,
      web: `https://web.stremio.com/#/detail/${tipo}/${filme.imdbID}`,
    };
  }
  const q = encodeURIComponent(filme.titulo);
  return {
    app: `stremio:///search?search=${q}`,
    web: `https://web.stremio.com/#/search?search=${q}`,
  };
}

function linkLetterboxd(filme) {
  if (filme.linkLetterboxd) return filme.linkLetterboxd;
  if (filme.imdbID) return `https://letterboxd.com/imdb/${filme.imdbID}/`;
  return `https://letterboxd.com/search/films/${encodeURIComponent(filme.titulo)}/`;
}

// ---------- Nuvem ----------

function iniciarNuvem() {
  const cfg = armazem.lerJSON(path.join(__dirname, 'lib', 'nuvem.config.json'), null);
  if (!cfg || !cfg.url || !cfg.chave) return;
  const cifra = safeStorage.isEncryptionAvailable();
  nuvem = new Nuvem({
    url: cfg.url,
    chave: cfg.chave,
    pasta: PASTA,
    marcas,
    filmes: () => filmes,
    definirFilmes: (lista) => { filmes = lista; },
    config: () => config,
    gravarFilmes: gravarAgora,
    gravarConfig,
    avisar,
    configPublica,
    aoReceberFilmes: baixarImagensRecebidas,
    cofre: {
      cifrar: (t) => (cifra ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8')),
      decifrar: (b) => (cifra ? safeStorage.decryptString(b) : b.toString('utf8')),
    },
    pastas: { capas: C.capas, imagens: C.imagens },
  });
  nuvem.pronto = nuvem.iniciar().catch((e) => console.error('nuvem', e));
  nuvem.pronto.then(() => publicarPacoteCelular());
  // Enquanto o app está aberto, um pacote novo montado (npm run montar) sobe sozinho.
  const manifesto = path.join(__dirname, 'mobile', 'pacote', 'versao.json');
  if (fs.existsSync(path.dirname(path.dirname(manifesto)))) fs.watchFile(manifesto, { interval: 5000 }, () => publicarPacoteCelular());
}

// O app do celular se atualiza sozinho baixando a interface de uma pasta pública
// do Supabase ("app"). Quem publica é este app, logado na sua conta: o
// `npm run montar` (em mobile/) deixa o pacote em mobile/pacote, e ele sobe daqui.
let publicandoPacote = null;
function publicarPacoteCelular() {
  if (publicandoPacote) return publicandoPacote;
  const pasta = path.join(__dirname, 'mobile', 'pacote');
  const v = armazem.lerJSON(path.join(pasta, 'versao.json'), null);
  if (!nuvem || !nuvem.usuario || !v || !v.versao || config.pacoteCelular === v.versao) return Promise.resolve();
  const zip = path.join(pasta, v.arquivo);
  if (!fs.existsSync(zip)) return Promise.resolve();
  publicandoPacote = (async () => {
    const app = nuvem.cliente.storage.from('app');
    const r1 = await app.upload(v.arquivo, fs.readFileSync(zip), { contentType: 'application/zip', upsert: true });
    if (r1.error) throw r1.error;
    // O manifesto por último (e com cache curto): o celular só vê a versão quando o zip já está lá.
    const r2 = await app.upload('versao.json', Buffer.from(JSON.stringify(v)), { contentType: 'application/json', upsert: true, cacheControl: '30' });
    if (r2.error) throw r2.error;
    config.pacoteCelular = v.versao;
    gravarConfig();
    console.log('pacote do celular publicado:', v.versao);
  })().catch((e) => console.error('pacote do celular', e.message || e)).finally(() => { publicandoPacote = null; });
  return publicandoPacote;
}

// Filmes que chegaram de outro aparelho: baixa a capa e a logo (vêm do TMDB pelo
// mesmo link), e os que ainda não passaram pelo TMDB entram na fila de lá.
async function baixarImagensRecebidas(lista) {
  if (lista.some((f) => !f.tmdbEm)) buscarCapasQueFaltam();
  for (const f of lista) {
    if (!f.tmdbEm) continue;
    let mudou = false;
    if (f.poster && !f.capaPersonalizada && !capaLocalExiste(f)) mudou = (await baixarCapa(f)) || mudou;
    if (f.logo && !f.logoLocal) mudou = (await baixarLogo(f)) || mudou;
    if (mudou) avisar('filme:mudou', f);
  }
}

ipcMain.handle('nuvem:status', async () => {
  if (!nuvem) return { indisponivel: true };
  await nuvem.pronto; // o login guardado já foi lido
  return nuvem.infos();
});
ipcMain.handle('nuvem:reenviar', (_e, email) => nuvem.reenviar(String(email || '').trim()));
ipcMain.handle('nuvem:entrar', async (_e, email, senha) => {
  const r = await nuvem.entrar(String(email || '').trim(), String(senha || ''));
  publicarPacoteCelular();
  return r;
});
ipcMain.handle('nuvem:criarConta', (_e, email, senha) => nuvem.criarConta(String(email || '').trim(), String(senha || '')));
ipcMain.handle('nuvem:sair', () => nuvem.sair());
ipcMain.handle('nuvem:sincronizar', async () => { await nuvem.sincronizar(); return nuvem.infos(); });

// ---------- IPC ----------

ipcMain.handle('dados:carregar', () => ({ filmes, config: configPublica(), pastaDados: PASTA, versao: app.getVersion() }));

function configPublica() {
  const { janela: _j, ...resto } = config;
  return resto;
}

ipcMain.handle('config:salvar', (_e, mudancas) => {
  // watchlists: { 'AAAA-MM-DD': [ids] }, os filmes que a pessoa pensa em ver em cada dia
  // (watchlistHoje é o formato antigo, de um dia só; o app o apaga ao salvar o novo).
  // filmesDoMes: { 'AAAA-MM': id }, o filme favorito de cada mês (só aparece no calendário).
  // tierlist: [{ id, nome, cor, filmes: [ids] }], as tiers de cima para baixo.
  const permitidas = ['tmdbKey', 'omdbKey', 'stremio', 'visualizacao', 'ordenacao', 'watchlists', 'watchlistHoje', 'filmesDoMes', 'tierlist', 'tierlists', 'tierlistAtiva', 'filtrosSorteio', 'listas', 'nandroll', 'nandrollTodasPlataformas', 'nandrollAssistir', 'nandrollPlataforma'];
  for (const k of permitidas) if (k in mudancas) config[k] = mudancas[k];
  if ('nandroll' in mudancas) { config.nandroll = Boolean(mudancas.nandroll); if (config.nandroll) atualizarSeriesEmExibicao(); }
  if ('omdbKey' in mudancas) config.limiteAtingidoEm = null;
  gravarConfig();
  if ('tmdbKey' in mudancas && config.tmdbKey) buscarCapasQueFaltam();
  if ('omdbKey' in mudancas) buscarNotasQueFaltam();
  return configPublica();
});

ipcMain.handle('filme:atualizar', (_e, id, mudancas) => {
  const permitidas = ['titulo', 'ano', 'diretor', 'visto', 'vistoEm', 'favorito', 'notas', 'minhaNota', 'linkLetterboxd', 'buscaCapa', 'pagina', 'paginaEm', 'story', 'listas', 'shots', 'paginaOutra'];
  const limpo = {};
  for (const k of permitidas) if (k in mudancas) limpo[k] = mudancas[k];
  // Mudar a busca da capa faz o filme ser procurado de novo no TMDB por ela.
  const atual = filmes.find((f) => f.id === id);
  if (ehSerie(atual)) {
    delete limpo.buscaCapa; // a capa das séries vem da AniList
    // O ✓ numa série acompanha o status (completar marca todos os episódios).
    if ('visto' in limpo) Object.assign(limpo, vistoSerie(atual, Boolean(limpo.visto)), 'vistoEm' in limpo ? { vistoEm: limpo.vistoEm } : {});
  } else if ('buscaCapa' in limpo) Object.assign(limpo, { capaNaoEncontrada: false, tmdbEm: '', tmdbId: '' });
  return atualizarFilme(id, limpo);
});

// Séries: episódios vistos e status. `dia` é o dia de hoje para o app (vira às 5h).
ipcMain.handle('serie:progresso', (_e, id, delta, dia, temporada) => {
  const f = filmes.find((x) => x.id === id);
  if (!ehSerie(f)) return null;
  return atualizarFilme(id, comDia(f, passoSerie(f, Number(delta) < 0 ? -1 : 1, Number.isInteger(temporada) ? temporada : null), dia));
});
ipcMain.handle('serie:definir', (_e, id, n, dia, temporada) => {
  const f = filmes.find((x) => x.id === id);
  if (!ehSerie(f)) return null;
  return atualizarFilme(id, comDia(f, definirSerie(f, n, Number.isInteger(temporada) ? temporada : null), dia));
});
// Marcar ou desmarcar um episódio avulso (a grade de episódios).
ipcMain.handle('serie:episodio', (_e, id, temporada, n, dia) => {
  const f = filmes.find((x) => x.id === id);
  if (!ehSerie(f)) return null;
  return atualizarFilme(id, comDia(f, alternarEpisodio(f, Number(temporada), n), dia));
});
ipcMain.handle('anilist:importar', (_e, nome) => chamar(() => importarAnilist(nome)));
ipcMain.handle('serie:status', (_e, id, status, dia) => {
  const f = filmes.find((x) => x.id === id);
  if (!ehSerie(f)) return null;
  return atualizarFilme(id, comDia(f, statusSerie(f, status), dia));
});
ipcMain.handle('anilist:pesquisar', (_e, termo) => chamar(() => anilist.pesquisar(termo)));
ipcMain.handle('anilist:atualizar', (_e, id) => chamar(async () => {
  const f = filmes.find((x) => x.id === id);
  if (!f || !f.anilistId) return null;
  await processarAnilist(f);
  gravarAgora();
  return f;
}));
// Abre o anime numa das plataformas oficiais (os links vêm da AniList).
ipcMain.handle('abrir:plataforma', async (_e, id, indice, temporada) => {
  const f = filmes.find((x) => x.id === id);
  const t = f && Number.isInteger(temporada) ? (f.temporadas || [])[temporada] : null;
  const l = f && ((t ? t.ondeAssistir : f.ondeAssistir) || [])[Number(indice)];
  if (!l || !/^https?:\/\//i.test(l.url)) return { ok: false };
  await shell.openExternal(l.url);
  return { ok: true, url: l.url };
});
ipcMain.handle('abrir:anilist', async (_e, id, temporada) => {
  const f = filmes.find((x) => x.id === id);
  if (!f || !f.anilistId) return { ok: false };
  const t = Number.isInteger(temporada) ? (f.temporadas || [])[temporada] : null;
  const url = `https://anilist.co/anime/${Number((t && t.anilistId) || f.anilistId)}`;
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle('filme:repetido', (_e, dados, ignorarId) => acharRepetido(filmes, dados, ignorarId));

ipcMain.handle('filme:adicionar', async (_e, dados) => {
  const ordem = filmes.reduce((m, f) => Math.max(m, f.ordem || 0), 0) + 1;
  const anilistId = Number(dados.anilistId) || '';
  const serie = Boolean(anilistId) && !dados.filme;
  const filme = novoFilme({
    ordem,
    titulo: String(dados.titulo || '').trim(),
    ano: String(dados.ano || '').trim(),
    diretor: String(dados.diretor || '').trim(),
    imdbID: dados.imdbID || '',
    poster: dados.poster || '',
    ...(anilistId ? { anime: true, anilistId } : {}),
    // Série de anime: episódios e status; a AniList preenche o resto em seguida.
    ...(serie ? { tipo: 'serie', episodios: 0, episodiosVistos: 0, status: 'planejo', tmdbEm: new Date().toISOString() } : {}),
  });
  filmes.push(filme);
  gravarDepois();
  if (anilistId) {
    processarAnilist(filme, null, { novo: true })
      .catch(() => {})
      .then(() => { gravarAgora(); avisar('filme:mudou', filme); });
    if (serie) return filme;
  }
  // Capa, logo, trailer e informações chegam em seguida, pelo TMDB.
  if (config.tmdbKey) {
    processarTmdb(filme, { tmdbId: dados.tmdbId || null })
      .catch(() => {})
      .then(() => { gravarAgora(); avisar('filme:mudou', filme); buscarNotasQueFaltam(); });
  }
  return filme;
});

// Excluir guarda o filme numa lixeira até o app fechar, para "Desfazer" poder
// devolvê-lo no mesmo lugar; a capa só é apagada do disco ao fechar.
const lixeira = new Map(); // id → { filme, indice }

function apagarCapaSeSobrou(filme) {
  const arquivo = filme.capaLocal && filme.capaLocal.split('?')[0];
  if (arquivo && !filmes.some((f) => f.capaLocal && f.capaLocal.split('?')[0] === arquivo)) {
    try { fs.rmSync(path.join(C.capas, arquivo), { force: true }); } catch { /* fica o arquivo */ }
  }
}

ipcMain.handle('filme:excluir', (_e, id) => {
  const indice = filmes.findIndex((f) => f.id === id);
  if (indice < 0) return false;
  lixeira.set(id, { filme: filmes[indice], indice });
  filmes = filmes.filter((f) => f.id !== id);
  gravarDepois();
  return true;
});

ipcMain.handle('filme:restaurar', (_e, id) => {
  const guardado = lixeira.get(id);
  if (!guardado) return null;
  lixeira.delete(id);
  filmes.splice(Math.min(guardado.indice, filmes.length), 0, guardado.filme);
  gravarDepois();
  return guardado.filme;
});

// Duas formas de trocar: outra capa do mesmo filme (`poster`), ou outro filme
// do TMDB (`tmdbId` diferente), que traz junto logo, trailer e informações.
ipcMain.handle('filme:trocarCapa', async (_e, id, escolha) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return null;
  try {
    if (ehSerie(filme)) {
      // NANDRoll: uma das capas da série (TMDB) ou de uma temporada (AniList).
      if (!/^https:\/\//.test(escolha.poster || '')) return null;
      atualizarFilme(id, { poster: escolha.poster, capaTmdb: true, capaPersonalizada: false, capaNaoEncontrada: false });
      await baixarCapa(filme);
    } else if (escolha.poster && String(escolha.tmdbId) === String(filme.tmdbId)) {
      atualizarFilme(id, { poster: escolha.poster, capaPersonalizada: false, capaNaoEncontrada: false });
      await baixarCapa(filme);
    } else {
      atualizarFilme(id, { capaPersonalizada: false });
      await processarTmdb(filme, { tmdbId: escolha.tmdbId, trocarFilme: true });
    }
  } catch (e) {
    return { erro: e.message };
  }
  gravarAgora();
  avisar('filme:mudou', filme);
  buscarNotasQueFaltam();
  return filme;
});

async function chamar(fn) {
  try {
    return { ok: true, dados: await fn() };
  } catch (e) {
    return { ok: false, erro: { tipo: e.tipo || 'rede', mensagem: e.message } };
  }
}

// Busca do "Adicionar" e do "Trocar capa": por título, ou pelo código do IMDb (tt…).
ipcMain.handle('tmdb:pesquisar', (_e, termo) => chamar(async () => {
  const t = String(termo || '').trim();
  if (/^tt\d+$/i.test(t)) {
    const id = await tmdb.idPorImdb(config.tmdbKey, t.toLowerCase());
    const d = id && await tmdb.detalhes(config.tmdbKey, id);
    return d ? [{ tmdbId: d.tmdbId, imdbID: d.imdbID, titulo: d.titulo, ano: d.ano, poster: d.poster }] : [];
  }
  return tmdb.pesquisar(config.tmdbKey, t);
}));
ipcMain.handle('tmdb:detalhes', (_e, tmdbId) => chamar(() => tmdb.detalhes(config.tmdbKey, tmdbId)));
ipcMain.handle('tmdb:capas', (_e, id) => chamar(() => {
  const filme = filmes.find((f) => f.id === id);
  if (ehSerie(filme)) return capasDaSerie(filme);
  return filme && filme.tmdbId ? tmdb.capas(config.tmdbKey, filme.tmdbId, filme.idiomaOriginal) : [];
}));

// Filmografia do diretor e "Mais como este", guardados enquanto o app está aberto.
const relacionadosCache = new Map();
ipcMain.handle('tmdb:relacionados', (_e, id) => chamar(async () => {
  // id de um filme da lista, ou "tmdb-<id>" de um filme aberto de fora da lista.
  const filme = filmes.find((f) => f.id === id);
  const tmdbId = filme ? filme.tmdbId : (String(id).match(/^tmdb-(\d+)$/) || [])[1];
  if (!tmdbId || !config.tmdbKey) return null;
  if (!relacionadosCache.has(tmdbId)) {
    relacionadosCache.set(tmdbId, tmdb.relacionados(config.tmdbKey, tmdbId)
      .catch((e) => { relacionadosCache.delete(tmdbId); throw e; }));
  }
  return relacionadosCache.get(tmdbId);
}));

// Confere uma chave nova com uma consulta simples (Um Sonho de Liberdade) antes de salvar.
ipcMain.handle('tmdb:testarChave', (_e, chave) => chamar(() => tmdb.idPorImdb(String(chave || '').trim(), 'tt0111161')));
ipcMain.handle('omdb:testarChave', (_e, chave) => chamar(() => omdb.detalhes(String(chave || '').trim(), 'tt0111161')));

ipcMain.handle('capas:buscar', (_e, opcoes) => buscarCapasQueFaltam(opcoes || {}));

// Quando o Stremio já está aberto, ele recebe o link mas fica atrás das outras
// janelas. No Windows, um processo iniciado pela janela em primeiro plano (este
// app) pode trazer outra janela para a frente.
const SCRIPT_FRENTE_WINDOWS = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Janela {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
for ($i = 0; $i -lt 20; $i++) {
  $p = Get-Process stremio-shell-ng, stremio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    if ([Janela]::IsIconic($p.MainWindowHandle)) { [Janela]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
    (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null
    [Janela]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    break
  }
  Start-Sleep -Milliseconds 500
}
`;

function trazerStremioParaFrente() {
  try {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(SCRIPT_FRENTE_WINDOWS, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Stremio'], { stdio: 'ignore' });
    } else {
      spawn('wmctrl', ['-a', 'Stremio'], { stdio: 'ignore' }).on('error', () => {});
    }
  } catch {
    // Trazer para a frente é só conveniência; o link já foi aberto.
  }
}

ipcMain.handle('abrir:stremio', async (_e, id, forcarWeb) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return { ok: false };
  const links = linksStremio(filme);
  if (forcarWeb || config.stremio === 'web') {
    await shell.openExternal(links.web);
    return { ok: true, url: links.web };
  }
  if (!stremioInstalado()) return { ok: false, semApp: true };
  await shell.openExternal(links.app);
  trazerStremioParaFrente();
  return { ok: true, url: links.app };
});

// ---------- Capas: baixar e usar arquivo próprio ----------

function nomeSeguro(texto) {
  return String(texto).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'capa';
}

function arquivoDaCapa(filme) {
  if (filme.capaLocal) {
    const p = path.join(C.capas, filme.capaLocal.split('?')[0]);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function bytesDaCapa(filme) {
  const local = arquivoDaCapa(filme);
  if (local) return { dados: fs.readFileSync(local), ext: path.extname(local) || '.jpg' };
  if (!filme.poster) return null;
  const r = await fetch(filme.poster, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  return { dados: Buffer.from(await r.arrayBuffer()), ext: '.jpg' };
}

ipcMain.handle('capa:baixar', async (_e, id) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return { erro: 'Filme não encontrado.' };
  const capa = await bytesDaCapa(filme).catch(() => null);
  if (!capa) return { erro: 'Esse filme ainda não tem capa para baixar.' };
  const nome = nomeSeguro(`${filme.titulo}${filme.ano ? ` (${filme.ano})` : ''}`) + capa.ext;
  const r = await dialog.showSaveDialog(janela, {
    title: 'Baixar capa',
    defaultPath: path.join(app.getPath('pictures'), nome),
    filters: [{ name: 'Imagem', extensions: [capa.ext.slice(1)] }],
  });
  if (r.canceled || !r.filePath) return { cancelado: true };
  fs.writeFileSync(r.filePath, capa.dados);
  return { arquivo: r.filePath };
});

// ---------- Story para o Instagram ----------

// O editor desenha a imagem num canvas; imagens de outra origem (capa:// e o
// TMDB) "sujariam" o canvas e impediriam de exportar. Por isso elas chegam
// aqui como data: URL. Só servem as capas baixadas e as imagens do TMDB.
ipcMain.handle('imagem:dados', async (_e, src) => {
  try {
    const url = new URL(String(src || ''));
    let dados;
    let tipo = 'image/jpeg';
    if (url.protocol === 'capa:') {
      const arquivo = path.join(url.hostname === 'foto' ? C.imagens : C.capas, path.basename(decodeURIComponent(url.pathname)));
      dados = await fs.promises.readFile(arquivo);
      if (/\.png$/i.test(arquivo)) tipo = 'image/png';
      else if (/\.webp$/i.test(arquivo)) tipo = 'image/webp';
    } else if (url.protocol === 'https:' && url.hostname === 'image.tmdb.org') {
      const r = await net.fetch(url.toString());
      if (!r.ok) return null;
      tipo = r.headers.get('content-type') || tipo;
      dados = Buffer.from(await r.arrayBuffer());
    } else return null;
    return `data:${tipo};base64,${dados.toString('base64')}`;
  } catch { return null; }
});

// ---------- Imagens das páginas e shots favoritos ----------

// Guarda uma imagem colada na pasta "imagens" e devolve o endereço dela
// (capa://foto/<arquivo>). Sem bytes, usa a imagem que estiver no clipboard.
const EXT_IMAGEM = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// A imagem do clipboard (print, "Copiar imagem" do navegador…). No Electron
// 44 o clipboard é como o da web: itens com tipos (readImage não existe mais).
async function imagemDoClipboard() {
  try {
    for (const item of await clipboard.read()) {
      const tipo = item.types.find((t) => EXT_IMAGEM[t]);
      if (!tipo) continue;
      const blob = await item.getType(tipo);
      return { dados: Buffer.from(await blob.arrayBuffer()), ext: EXT_IMAGEM[tipo] };
    }
  } catch { /* clipboard vazio ou sem permissão */ }
  // Um arquivo copiado no Explorer não aparece como imagem: pergunta ao
  // PowerShell qual arquivo está copiado.
  if (process.platform !== 'win32') return null;
  const caminhos = await new Promise((resolve) => {
    let saida = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }'],
    { windowsHide: true });
    ps.stdout.on('data', (d) => { saida += d; });
    ps.on('error', () => resolve([]));
    ps.on('close', () => resolve(saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)));
    setTimeout(() => { ps.kill(); resolve([]); }, 8000);
  });
  for (const caminho of caminhos) {
    const ext = (caminho.match(/\.(png|jpe?g|webp|gif)$/i) || [])[1];
    if (ext && fs.existsSync(caminho)) return { dados: await fs.promises.readFile(caminho), ext: ext.toLowerCase().replace('jpeg', 'jpg') };
  }
  return null;
}
ipcMain.handle('imagem:guardar', async (_e, bytes, tipo) => {
  let dados;
  let ext = EXT_IMAGEM[tipo];
  if (bytes && ext) {
    dados = Buffer.from(bytes);
  } else {
    const doClipboard = await imagemDoClipboard();
    if (!doClipboard) return { erro: 'Não há nenhuma imagem copiada.' };
    ({ dados, ext } = doClipboard);
  }
  if (!dados.length) return { erro: 'A imagem está vazia.' };
  const nome = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await fs.promises.mkdir(C.imagens, { recursive: true });
  await fs.promises.writeFile(path.join(C.imagens, nome), dados);
  return { src: `capa://foto/${nome}` };
});

const bytesDoPng = (dataUrl) => Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');

ipcMain.handle('story:salvar', async (_e, dataUrl, nome) => {
  const r = await dialog.showSaveDialog(janela, {
    title: 'Salvar story',
    defaultPath: path.join(app.getPath('pictures'), `${nomeSeguro(nome || 'Story')}.png`),
    filters: [{ name: 'Imagem PNG', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return { cancelado: true };
  await fs.promises.writeFile(r.filePath, bytesDoPng(dataUrl));
  return { arquivo: r.filePath };
});

// Várias imagens de uma vez (os stories da retrospectiva): escolhe a pasta e
// grava "<nome> 1.png", "<nome> 2.png"…
ipcMain.handle('story:salvarVarias', async (_e, dataUrls, nome) => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta para salvar os stories',
    defaultPath: app.getPath('pictures'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  const base = nomeSeguro(nome || 'Story');
  const arquivos = [];
  for (const [i, d] of (dataUrls || []).entries()) {
    const arquivo = path.join(r.filePaths[0], `${base} ${i + 1}.png`);
    await fs.promises.writeFile(arquivo, bytesDoPng(d));
    arquivos.push(arquivo);
  }
  return { pasta: r.filePaths[0], arquivos };
});

// O clipboard do Electron novo segue a API da web: uma lista de ClipboardItem
// (writeImage não existe mais).
ipcMain.handle('story:copiar', async (_e, dataUrl) => {
  const png = new Blob([bytesDoPng(dataUrl)], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return true;
});

ipcMain.handle('arquivo:mostrar', (_e, arquivo) => { if (arquivo) shell.showItemInFolder(arquivo); });

ipcMain.handle('capas:baixarTodas', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta para salvar todas as capas',
    defaultPath: app.getPath('pictures'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  const pasta = r.filePaths[0];
  let salvas = 0;
  for (const filme of filmes.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))) {
    const local = arquivoDaCapa(filme);
    if (!local) continue;
    const nome = nomeSeguro(`${String(filme.ordem).padStart(3, '0')} - ${filme.titulo}${filme.ano ? ` (${filme.ano})` : ''}`);
    fs.copyFileSync(local, path.join(pasta, nome + (path.extname(local) || '.jpg')));
    salvas++;
  }
  return { pasta, salvas };
});

const EXTENSOES_IMAGEM = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'];

ipcMain.handle('capa:usarArquivo', async (_e, id, caminho) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return { erro: 'Filme não encontrado.' };
  let origem = caminho;
  if (!origem) {
    const r = await dialog.showOpenDialog(janela, {
      title: `Escolher capa para “${filme.titulo}”`,
      defaultPath: app.getPath('pictures'),
      filters: [{ name: 'Imagens', extensions: EXTENSOES_IMAGEM }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return { cancelado: true };
    origem = r.filePaths[0];
  }
  const ext = path.extname(origem).toLowerCase();
  if (!EXTENSOES_IMAGEM.includes(ext.slice(1))) return { erro: 'Esse arquivo não é uma imagem (use JPG, PNG ou WEBP).' };
  const nome = `${filme.id}-propria${ext}`;
  fs.mkdirSync(C.capas, { recursive: true });
  fs.copyFileSync(origem, path.join(C.capas, nome));
  const atualizado = atualizarFilme(id, {
    capaLocal: `${nome}?v=${Date.now()}`,
    capaPersonalizada: true,
    capaNaoEncontrada: false,
    revisarCapa: false,
  });
  gravarAgora();
  return { filme: atualizado };
});

// ---------- Trailer e detalhes ----------

const trailersEmBusca = new Map();

ipcMain.handle('trailer:obter', async (_e, id) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return null;
  if (filme.trailerId) return filme.trailerId === 'nenhum' ? null : filme.trailerId;
  if (!trailersEmBusca.has(id)) {
    trailersEmBusca.set(id, trailer.buscarTrailer(filme)
      .then((videoId) => {
        atualizarFilme(id, { trailerId: videoId || 'nenhum' });
        return videoId;
      })
      .catch(() => null) // sem internet: tenta de novo da próxima vez
      .finally(() => trailersEmBusca.delete(id)));
  }
  return trailersEmBusca.get(id);
});

ipcMain.handle('trailer:definir', (_e, id, texto) => {
  const t = String(texto || '').trim();
  // Colado à mão: a atualização pelo TMDB não troca mais esse trailer.
  if (!t) return { filme: atualizarFilme(id, { trailerId: '', trailerManual: false }) };
  const videoId = trailer.idDoLink(t);
  if (!videoId) return { erro: 'Não reconheci esse link do YouTube.' };
  return { filme: atualizarFilme(id, { trailerId: videoId, trailerManual: true }) };
});

ipcMain.handle('filme:info', async (_e, id) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return { ok: false };
  if (filme.info || filme.tmdbEm || !config.tmdbKey) return { ok: true, info: filme.info || null };
  try {
    await processarTmdb(filme);
    gravarAgora();
    avisar('filme:mudou', filme);
    return { ok: true, info: filme.info || null };
  } catch (e) {
    return { ok: false, erro: { tipo: e.tipo || 'rede', mensagem: e.message } };
  }
});

ipcMain.handle('abrir:letterboxd', async (_e, id) => {
  const filme = filmes.find((f) => f.id === id);
  if (!filme) return { ok: false };
  const url = linkLetterboxd(filme);
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle('abrir:pastaDados', () => shell.openPath(PASTA));

// Importação de planilha em duas etapas: escolher/ler o arquivo, depois aplicar
// (substituir ou juntar), para o app perguntar o modo só depois de ler o arquivo.
// ---------- Importar do Letterboxd ----------

// Pasta do export do Letterboxd → lista. Filmes vistos são marcados como vistos,
// com as datas do diário; só entram as datas de antes do primeiro dia já
// registrado no NANDFlix (depois dele, o calendário daqui já tem o registro).
// A watchlist entra como filmes novos na lista (os que ainda não estão nela).
// As notas preenchem "Sua nota" só onde ela ainda está vazia. Filmes que não
// estão na lista são procurados no TMDB antes, para não duplicar por diferença
// de título; os novos ganham capa e informações na atualização pelo TMDB.
ipcMain.handle('letterboxd:importar', async (_e, pastaDada) => {
  const r = pastaDada ? { canceled: false, filePaths: [String(pastaDada)] } : await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta do export do Letterboxd (descompactada)',
    defaultPath: app.isPackaged ? app.getPath('downloads') : __dirname,
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  let itens;
  try {
    itens = letterboxd.ler(r.filePaths[0]);
  } catch (e) {
    return { erro: e.message };
  }
  armazem.fazerBackup(PASTA);
  const res = await letterboxd.aplicar(itens, filmes, {
    idPorTitulo: config.tmdbKey ? (titulo, ano) => tmdb.idPorTitulo(config.tmdbKey, titulo, ano) : null,
  });
  gravarAgora();
  buscarCapasQueFaltam();
  return { ...res, filmes };
});

ipcMain.handle('planilha:ler', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Importar planilha',
    filters: [{ name: 'Planilha do Excel', extensions: ['xlsx', 'xls', 'xlsm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  try {
    planilhaPendente = planilha.lerPlanilha(fs.readFileSync(r.filePaths[0]));
    return { total: planilhaPendente.length, arquivo: path.basename(r.filePaths[0]), jaTemFilmes: filmes.length > 0 };
  } catch (e) {
    return { erro: `Não consegui ler a planilha: ${e.message}` };
  }
});

ipcMain.handle('planilha:aplicar', (_e, modo) => {
  if (!planilhaPendente) return { erro: 'Nenhuma planilha carregada.' };
  armazem.fazerBackup(PASTA);
  let extra = {};
  if (modo === 'juntar') {
    const r = juntar(filmes, planilhaPendente);
    filmes = r.filmes;
    extra = { adicionados: r.adicionados, repetidos: r.repetidos };
  } else {
    filmes = planilhaPendente;
    extra = { adicionados: filmes.length, repetidos: 0 };
  }
  planilhaPendente = null;
  gravarAgora();
  return { ...resumo(filmes), ...extra, filmes };
});

ipcMain.handle('planilha:exportar', async () => {
  const r = await dialog.showSaveDialog(janela, {
    title: 'Exportar para Excel',
    defaultPath: path.join(app.getPath('documents'), 'Filmes legais.xlsx'),
    filters: [{ name: 'Planilha do Excel', extensions: ['xlsx'] }],
  });
  if (r.canceled || !r.filePath) return { cancelado: true };
  fs.writeFileSync(r.filePath, planilha.gerarPlanilha(filmes));
  return { arquivo: r.filePath };
});

ipcMain.handle('backup:exportar', async () => {
  const data = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(janela, {
    title: 'Exportar backup',
    defaultPath: path.join(app.getPath('documents'), `filmes-legais-backup-${data}.json`),
    filters: [{ name: 'Backup (JSON)', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { cancelado: true };
  armazem.gravarJSON(r.filePath, { ...instantaneo(), exportadoEm: new Date().toISOString() });
  return { arquivo: r.filePath };
});

ipcMain.handle('backup:importar', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Importar backup',
    filters: [{ name: 'Backup (JSON)', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  const b = lerBackup(r.filePaths[0]);
  if (!b) return { erro: 'Esse arquivo não parece um backup do NANDFlix.' };
  aplicarBackup(b);
  return { ...resumo(filmes), filmes, comConfig: Boolean(b.config) };
});

ipcMain.handle('backup:status', () => ({
  diarios: listaDiarios(),
  ultimo: ultimoBackup,
  pastaExtra: config.pastaBackup || '',
}));

ipcMain.handle('backup:escolherPasta', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Pasta extra para os backups (a do Google Drive, por exemplo)',
    defaultPath: config.pastaBackup || app.getPath('home'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelado: true };
  config.pastaBackup = r.filePaths[0];
  gravarConfig();
  backupDiario({ forcar: true });
  return { pasta: config.pastaBackup, erro: ultimoBackup.erroExtra };
});

ipcMain.handle('backup:tirarPasta', () => {
  delete config.pastaBackup;
  gravarConfig();
  return true;
});

ipcMain.handle('backup:agora', () => { backupDiario({ forcar: true }); return ultimoBackup; });

ipcMain.handle('backup:restaurar', (_e, arquivo) => {
  const nome = path.basename(String(arquivo || ''));
  if (!RE_DIARIO.test(nome)) return { erro: 'Backup inválido.' };
  const b = lerBackup(path.join(C.backups, nome));
  if (!b) return { erro: 'Não deu para ler esse backup.' };
  aplicarBackup(b);
  return { ok: true };
});

// ---------- Inicialização ----------

protocol.registerSchemesAsPrivileged([
  { scheme: 'capa', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const travaUnica = app.requestSingleInstanceLock();
if (!travaUnica) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(() => {
    fs.mkdirSync(C.capas, { recursive: true });
    armazem.fazerBackup(PASTA);
    filmes = armazem.lerFilmes(PASTA);
    marcas = new Marcas(C.sincronia);
    marcas.iniciar(filmes, config);
    iniciarNuvem();
    setTimeout(atualizarSeriesEmExibicao, 5000);

    // capa://img/<arquivo> → arquivo da pasta de capas (sem sair dela);
    // capa://foto/<arquivo> → imagem colada numa página ou shot favorito.
    protocol.handle('capa', (req) => {
      const url = new URL(req.url);
      const nome = path.basename(decodeURIComponent(url.pathname));
      const arquivo = path.join(url.hostname === 'foto' ? C.imagens : C.capas, nome);
      if (!fs.existsSync(arquivo)) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(arquivo).toString());
    });

    // O player do YouTube recusa tocar (erro 153) quando a página que o embute
    // não manda Referer, que é o caso de páginas file://.
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] },
      (detalhes, callback) => {
        detalhes.requestHeaders.Referer = 'https://filmeslegais.app/';
        callback({ requestHeaders: detalhes.requestHeaders });
      },
    );

    criarJanela();
    iniciarAtualizacoes();
    try { backupDiario(); } catch (e) { console.error('backup', e); }
    setInterval(() => { try { backupDiario(); } catch (e) { console.error('backup', e); } }, 60 * 60 * 1000);
  });

  app.on('before-quit', () => {
    if (timerGravar) gravarAgora();
    try { backupDiario(); } catch { /* fecha mesmo assim */ }
    for (const { filme } of lixeira.values()) apagarCapaSeSobrou(filme);
    lixeira.clear();
  });
  app.on('window-all-closed', () => {
    if (timerGravar) gravarAgora();
    app.quit();
  });
}
