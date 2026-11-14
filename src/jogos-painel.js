'use strict';

// ---------- nandplay: a página do jogo ----------
//
// O painel de detalhes de um jogo (ehJogo), no estilo do de filmes e animes:
// fundo da Steam (library_hero) ou arte da IGDB, logo da Steam (ou o título em
// texto), trailer do YouTube, o botão principal da Steam (Jogar / Instalar /
// Ver na loja / Abrir na Steam / loja na web), onde jogar (a Steam primeiro),
// status, tags, nota, tempos do HowLongToBeat e "Mais de <desenvolvedor>".
//
// abrirPainelJogo(f): um jogo da lista. abrirJogoFora(igdbId, dadosLeves): um
// jogo que não está na lista (das fileiras "Mais de…" ou da busca), com
// "Adicionar à lista". renderPainel (app.js) chama renderPainelJogo para jogos.
//
// Carregado antes do app.js: nada aqui usa $, estado, porId… na carga, só
// dentro das funções. Os links steam:// nunca são montados aqui: o botão chama
// api.abrirSteam(appid, acao) e o processo principal monta o link.

const ROTULOS_STATUS_JOGO = { quero: 'Quero jogar', jogando: 'Jogando', pausado: 'Pausado', zerado: 'Zerei', cem: '100%', larguei: 'Larguei' };
const STATUS_JOGO_ZERADO = ['zerado', 'cem'];

const NOMES_LOJA_JOGO = {
  steam: 'Steam', epic: 'Epic Games Store', gog: 'GOG', itch: 'itch.io', playstation: 'PlayStation Store',
  xbox: 'Xbox / Microsoft Store', nintendo: 'Nintendo eShop', appstore: 'App Store', googleplay: 'Google Play',
};

// O que o botão da Steam diz em cada estado (a ação é a de lib/steam.js, acaoSteam).
const BOTAO_STEAM_JOGO = {
  jogar: { rotulo: 'Jogar', icone: 'Play', dica: 'Abre o jogo na Steam' },
  instalar: { rotulo: 'Instalar', icone: 'Download', dica: 'Está na sua biblioteca da Steam: abre a instalação' },
  loja: { rotulo: 'Ver na loja', icone: 'Store', dica: 'Você ainda não tem este jogo: abre a página dele na Steam' },
  abrir: { rotulo: 'Abrir na Steam', icone: 'Gamepad2', dica: 'A Steam abre o jogo (ou a loja, se você não tiver). Com o seu perfil da Steam em Configurações, o app sabe se você já tem.' },
  web: { rotulo: 'Ver na loja da Steam', icone: 'ExternalLink', dica: 'Abre a página do jogo na loja da Steam' },
};

// A marca oficial da Steam (página de marca da Valve, partner.steamgames.com/doc/marketing/branding;
// o contorno vem do Simple Icons): o círculo azul da Steam com o braço branco. O contorno é o
// círculo com o braço vazado; por baixo, um círculo branco preenche o braço.
const MARCA_STEAM_JOGO = `<svg class="steam-marca" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><defs><linearGradient id="steam-marca-azul" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111D2E"/><stop offset=".5" stop-color="#144B7E"/><stop offset="1" stop-color="#1387B8"/></linearGradient></defs><circle cx="12" cy="12" r="11.6" fill="#FFFFFF"/><path fill="url(#steam-marca-azul)" d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/></svg>`;

// ---------- Lógica pura (testada em scripts/testar-jogos.js) ----------

// O appid da Steam do jogo (número) ou null. Só inteiro positivo.
function appidDoJogo(f) {
  const t = String((f && f.steam) ?? '').trim();
  if (!/^[1-9]\d{0,9}$/.test(t)) return null;
  const n = Number(t);
  return n <= 0xFFFFFFFF ? n : null;
}

const linkHttpsJogo = (url) => (/^https:\/\//i.test(String(url || '')) ? String(url) : '');

// As lojas do jogo, a Steam primeiro (com o appid, mesmo sem estar em `lojas`).
function lojasDoJogo(f) {
  const r = [];
  const appid = appidDoJogo(f);
  if (appid) r.push({ loja: 'steam', nome: 'Steam', url: `https://store.steampowered.com/app/${appid}/` });
  for (const l of (f && Array.isArray(f.lojas) ? f.lojas : [])) {
    const url = linkHttpsJogo(l && l.url);
    if (!url || !l.loja || r.some((x) => x.loja === l.loja)) continue;
    r.push({ loja: l.loja, nome: NOMES_LOJA_JOGO[l.loja] || l.loja, url });
  }
  return r;
}

// A biblioteca da Steam vale se tem a lista de jogos; senão, "não sabemos" (null).
const bibliotecaConhecida = (b) => (b && Array.isArray(b.jogos) ? b : null);

// O botão principal. contexto: { local: { steamNoPc, instalados } | null (ainda
// não sabemos), biblioteca: { jogos: [{ appid, minutos }] } | null (sem conta /
// não sabemos), celular }. Mesmas regras de acaoSteam (lib/steam.js):
//   celular ou sem Steam no PC → loja na web; instalado → Jogar; na biblioteca →
//   Instalar; biblioteca conhecida sem o jogo → Ver na loja; sem saber → Abrir na Steam.
// Sem appid, vira a loja (ou o site) principal do jogo; sem nada, a busca da Steam.
function estadoBotaoSteam(f, { local = null, biblioteca = null, celular = false } = {}) {
  const appid = appidDoJogo(f);
  if (!appid) {
    const loja = lojasDoJogo(f)[0];
    if (loja) return { tipo: 'link', url: loja.url, rotulo: `Ver na ${loja.nome}`, icone: 'ExternalLink', dica: `Abre a página do jogo na ${loja.nome}` };
    const site = linkHttpsJogo(f && f.site);
    if (site) return { tipo: 'link', url: site, rotulo: 'Site oficial', icone: 'ExternalLink', dica: 'Abre o site oficial do jogo' };
    return { tipo: 'link', url: `https://store.steampowered.com/search/?term=${encodeURIComponent(String((f && f.titulo) || '').trim())}`, rotulo: 'Procurar na Steam', icone: 'Search', dica: 'Procura o jogo na loja da Steam' };
  }
  const bib = bibliotecaConhecida(biblioteca);
  const daConta = bib ? bib.jogos.find((j) => Number(j && j.appid) === appid) || null : null;
  const base = { tipo: 'steam', appid, naBiblioteca: bib ? Boolean(daConta) : null, minutos: daConta ? Number(daConta.minutos) || 0 : null, ultimaVez: daConta ? daConta.ultimaVez || '' : '', instalado: false };
  const com = (acao, extra = {}) => ({ ...base, ...extra, acao, ...BOTAO_STEAM_JOGO[acao] });
  if (celular || (local && !local.steamNoPc)) return com('web');
  // A pasta da Steam ainda não foi lida: só "não tem" é certo; o resto a Steam decide.
  if (!local) return com(base.naBiblioteca === false ? 'loja' : 'abrir');
  if ((local.instalados || []).some((j) => Number(j && typeof j === 'object' ? j.appid : j) === appid)) return com('jogar', { instalado: true });
  if (base.naBiblioteca === true) return com('instalar');
  if (base.naBiblioteca === false) return com('loja');
  return com('abrir');
}

// Horas jogadas: "42 h", "menos de 1 h".
function horasJogadas(minutos) {
  const m = Number(minutos) || 0;
  if (m <= 0) return '';
  if (m < 60) return 'menos de 1 h';
  return `${Math.round(m / 60).toLocaleString('pt-BR')} h`;
}
// Tempo de jogo como na biblioteca da Steam: "108,3 h", "45 min".
function tempoDeJogoSteam(minutos) {
  const m = Number(minutos) || 0;
  if (m <= 0) return '';
  if (m < 60) return `${m} min`;
  return `${(m / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}
// "Hoje", "Ontem", "3 de nov.", "3 de nov. de 2024".
function ultimaVezSteam(iso, agora = new Date()) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dif = Math.round((dia(agora) - dia(d)) / 86400000);
  if (dif === 0) return 'Hoje';
  if (dif === 1) return 'Ontem';
  const opcoes = { day: 'numeric', month: 'short', ...(d.getFullYear() !== agora.getFullYear() ? { year: 'numeric' } : {}) };
  return d.toLocaleDateString('pt-BR', opcoes);
}
// Ao lado do botão: "TEMPO DE JOGO 108,3 h · JOGADO POR ÚLTIMO 3 de nov." (só com a biblioteca da Steam).
function tempoSteamJogoHTML(e) {
  if (!e || e.tipo !== 'steam' || !e.naBiblioteca) return '';
  const tempo = tempoDeJogoSteam(e.minutos);
  const ultima = ultimaVezSteam(e.ultimaVez);
  const bloco = (rotulo, valor) => `<div class="jogo-tempo-item"><span>${rotulo}</span><b>${esc(valor)}</b></div>`;
  return [tempo ? bloco('Tempo de jogo', tempo) : '', ultima ? bloco('Jogado por último', ultima) : ''].join('');
}

// Tempo de jogo como no HowLongToBeat: 12.5 → "12½ h".
function horasHltb(h) {
  const n = Number(h);
  if (!(n > 0)) return '';
  const inteiro = Math.floor(n);
  const meio = n - inteiro >= 0.5;
  return `${inteiro || ''}${meio ? '½' : ''}${inteiro || meio ? '' : '0'} h`;
}
// Os três tempos do HLTB a partir do contrato (IGDB, game_time_to_beats):
// rápido (só a história), normal (história + extras), completo (100%).
function temposHltb(f) {
  const rapido = Number(f && f.tempoZerarRapido) || null;
  let normal = Number(f && f.tempoZerar) || null;
  if (normal && rapido && normal === rapido) normal = null; // tempoZerar caiu para o rápido: não repete
  return { historia: rapido, extras: normal, cem: Number(f && f.tempoZerarCompleto) || null };
}

// O link do HowLongToBeat: a página exata (id do Wikidata) ou a busca pelo título.
function linkHltbJogo(f) {
  const id = String((f && f.hltb) ?? '').trim();
  if (/^[1-9]\d{0,8}$/.test(id)) return `https://howlongtobeat.com/game/${id}`;
  return `https://howlongtobeat.com/?q=${encodeURIComponent(String((f && f.titulo) || '').trim())}`;
}

// Tags que o usuário já usou em outros jogos (as mais usadas primeiro), menos as deste.
function sugestoesTagsJogo(f, lista) {
  const conta = new Map();
  const deste = new Set(((f && f.tags) || []).map((t) => String(t).toLocaleLowerCase('pt-BR')));
  for (const j of lista || []) {
    if (!j || j.tipo !== 'jogo' || j === f || (f && j.id === f.id)) continue;
    for (const t of Array.isArray(j.tags) ? j.tags : []) {
      const k = String(t).toLocaleLowerCase('pt-BR');
      if (!t || deste.has(k)) continue;
      const atual = conta.get(k) || { tag: String(t), n: 0 };
      atual.n++;
      conta.set(k, atual);
    }
  }
  return [...conta.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'pt-BR')).map((x) => x.tag);
}

// Uma tag nova: sem espaços sobrando, até 40 letras (como lib/jogo-usuario.js).
const limparTagJogo = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();

// Status novo → o que gravar. Zerei/100% gravam a data (hoje, se ainda não
// havia); voltar para outro status tira a data (o calendário marca só ela).
function mudancasDoStatusJogo(f, status, dia) {
  if (!ROTULOS_STATUS_JOGO[status]) return null;
  const m = { status };
  if (STATUS_JOGO_ZERADO.includes(status)) { if (!f.zeradoEm) m.zeradoEm = dia; } else if (f.zeradoEm) m.zeradoEm = '';
  return m;
}

// ---------- Steam: o que está instalado e a biblioteca da conta ----------

const steamDoJogo = { local: null, biblioteca: null, pedindo: null };

function contextoSteamJogo() {
  return { local: steamDoJogo.local, biblioteca: steamDoJogo.biblioteca, celular: Boolean(window.api && window.api.celular) };
}

function carregarSteamDoJogo() {
  if (steamDoJogo.pedindo) return steamDoJogo.pedindo;
  steamDoJogo.pedindo = Promise.all([
    Promise.resolve().then(() => api.steamLocal()).catch(() => null),
    Promise.resolve().then(() => api.steamBiblioteca()).catch(() => null),
  ]).then(([local, bib]) => {
    if (local && typeof local === 'object') steamDoJogo.local = local;
    steamDoJogo.biblioteca = bib && bib.ok ? bibliotecaConhecida(bib.dados) : steamDoJogo.biblioteca;
  }).finally(() => { steamDoJogo.pedindo = null; });
  return steamDoJogo.pedindo;
}

// A biblioteca chegou (api.aoBibliotecaSteam): o botão do jogo aberto se atualiza.
function receberBibliotecaSteam(dados) {
  steamDoJogo.biblioteca = bibliotecaConhecida(dados);
  const f = typeof estado !== 'undefined' && estado.painelId ? porId(estado.painelId) : null;
  if (ehJogo(f)) atualizarBotaoSteamJogo(f);
}

// Pontos de passagem para a API (os testes por CDP trocam estas funções para
// conferir o que seria aberto sem abrir a Steam de verdade).
function abrirSteamPeloApp(appid, acao) { return api.abrirSteam(appid, acao); }
function pedirDetalhesJogo(igdbId) { return api.detalhesJogo(igdbId); }
function pedirJogosDoDesenvolvedor(empresaId, opcoes) { return api.jogosDoDesenvolvedor(empresaId, opcoes); }
function pedirHltbJogo(jogo) { return api.hltbJogo(jogo); }
function pedirImagensSteam(appids) { return api.imagensSteam(appids); }

function abrirLinkJogo(url) {
  const u = linkHttpsJogo(url);
  if (u) api.abrirLink(u);
}

// O botão principal foi apertado (no painel ou no trailer em foco).
async function usarBotaoSteam(f) {
  if (!f) return;
  const e = estadoBotaoSteam(f, contextoSteamJogo());
  if (e.tipo !== 'steam') { abrirLinkJogo(e.url); return; }
  const r = await abrirSteamPeloApp(e.appid, e.acao);
  if (!r || !r.ok) { aviso('Não deu para abrir a Steam.', { tipo: 'erro' }); return; }
  // Jogar algo que estava em "quero jogar": oferece passar para "jogando".
  if (e.acao === 'jogar' && !f.externo && (!f.status || f.status === 'quero')) {
    aviso(`Abrindo “${f.titulo}” na Steam.`, { tipo: 'ok', duracao: 7000, acao: { rotulo: 'Marcar como jogando', fn: () => mudarStatusJogo(f, 'jogando') } });
  }
}

function botaoSteamConteudoHTML(e) {
  const ico = e.tipo === 'steam' && e.acao !== 'web' && e.acao !== 'abrir' ? icone(e.icone) : e.tipo === 'steam' ? MARCA_STEAM_JOGO : icone(e.icone);
  return `${ico}<span>${esc(e.rotulo)}</span>`;
}

// O botão do trailer em foco (app.js, abrirFoco).
function botaoSteamFocoHTML(f) {
  const e = estadoBotaoSteam(f, contextoSteamJogo());
  return `<button class="btn btn-assistir jogo-steam-btn" data-f="steam" data-acao="${e.tipo === 'steam' ? e.acao : 'link'}" title="${esc(e.dica)}">${botaoSteamConteudoHTML(e)}</button>`;
}

function atualizarBotaoSteamJogo(f) {
  const e = estadoBotaoSteam(f, contextoSteamJogo());
  for (const b of document.querySelectorAll('#painel [data-j="steam"], #foco [data-f="steam"]')) {
    b.innerHTML = botaoSteamConteudoHTML(e);
    b.title = e.dica;
    b.dataset.acao = e.tipo === 'steam' ? e.acao : 'link';
  }
  const tempo = document.querySelector('#painel [data-j-steam-tempo]');
  if (tempo) { const t = tempoSteamJogoHTML(e); tempo.innerHTML = t; tempo.hidden = !t; }
  const sub = document.querySelector('#painel .jogo-loja-steam small');
  if (sub) sub.textContent = subtituloSteamJogo(e);
  atualizarPaginaJogoSteam(f, e);
}

const subtituloSteamJogo = (e) => (e && e.tipo === 'steam' ? (e.instalado ? 'Instalado' : e.naBiblioteca === true ? 'Na sua biblioteca' : 'Loja da Steam') : '');

// ---------- Imagens ----------

const IMAGENS_STEAM_JOGO = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/';
const imagensSteamDoJogo = new Map(); // appid → { fundo, logo, … } (as certas, de api.imagensSteam)

function logoDoJogo(f) {
  if (f.logo) return f.logo;
  const appid = appidDoJogo(f);
  return appid ? (imagensSteamDoJogo.get(appid) || {}).logo || `${IMAGENS_STEAM_JOGO}${appid}/logo.png` : '';
}
// Os fundos possíveis, em ordem: o do item, o hero da Steam, as artes da IGDB.
function fundosDoJogo(f) {
  const appid = appidDoJogo(f);
  const steamFundo = appid ? (imagensSteamDoJogo.get(appid) || {}).fundo || `${IMAGENS_STEAM_JOGO}${appid}/library_hero.jpg` : '';
  return [f.fundo, steamFundo, ...(Array.isArray(f.artes) ? f.artes : [])].filter((u, i, l) => u && l.indexOf(u) === i);
}
// O item com os nomes que capaHTML/tituloHTML (app.js) usam.
// Sem capa (ex.: jogo de fora sem os detalhes da IGDB), a capa em pé da Steam.
function capaDoJogo(f) {
  if (f.poster || f.capa) return f.poster || f.capa;
  const appid = appidDoJogo(f);
  return appid ? (imagensSteamDoJogo.get(appid) || {}).capa || `${IMAGENS_STEAM_JOGO}${appid}/library_600x900.jpg` : '';
}
const comImagensDoJogo = (f) => ({ ...f, poster: capaDoJogo(f), logo: logoDoJogo(f), logoLocal: f.logoLocal || '' });

// O fundo que não carregar passa para o próximo; sem nenhum, fica a capa desfocada.
function trocarFundoQueFalhou(ev) {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('jogo-fundo-img')) return;
  let resto = [];
  try { resto = JSON.parse(img.dataset.resto || '[]'); } catch { /* sem alternativas */ }
  if (resto.length) { img.dataset.resto = JSON.stringify(resto.slice(1)); img.src = resto[0]; } else img.remove();
}

// As imagens certas da Steam (o caminho com código dos jogos novos): troca o fundo se mudou.
async function trazerImagensSteamJogo(f) {
  const appid = appidDoJogo(f);
  if (!appid || imagensSteamDoJogo.has(appid)) return;
  const r = await Promise.resolve().then(() => pedirImagensSteam([appid])).catch(() => null);
  const img = r && r.ok && r.dados && r.dados[appid];
  if (!img) return;
  imagensSteamDoJogo.set(appid, img);
  if (estado.painelId !== f.id || f.fundo) return;
  const el = $('#painel .jogo-fundo-img');
  if (el && img.fundo && el.getAttribute('src') !== img.fundo) el.src = img.fundo;
}

// ---------- Abrir ----------

function abrirPainelJogo(f, opcoes = {}) {
  const item = typeof f === 'string' ? porId(f) : f;
  if (!item) return;
  abrirPainel(item.id, opcoes);
}

const jogosFora = new Map(); // igdb → dados leves vistos nas fileiras (para abrir sem esperar)

// Um jogo que não está na lista: abre com o que já se sabe (dadosLeves) e
// completa com os detalhes da IGDB. Se já está na lista, abre o da lista.
function abrirJogoFora(igdbId, dadosLeves = {}, { voltarPara = null } = {}) {
  const leves = dadosLeves || {};
  const igdb = Number(igdbId || leves.igdb) || null;
  const steam = appidDoJogo(leves);
  if (!igdb && !steam) return;
  const daLista = estado.filmes.find((x) => ehJogo(x) && ((igdb && Number(x.igdb) === igdb) || (!igdb && steam && appidDoJogo(x) === steam)));
  if (daLista) { abrirPainel(daLista.id, { voltarPara }); return; }
  const id = igdb ? `igdb-${igdb}` : `steam-${steam}`;
  if (!filmesExternos.has(id)) {
    const plataformasJogo = Array.isArray(leves.plataformasJogo) ? leves.plataformasJogo
      : (Array.isArray(leves.plataformas) ? leves.plataformas : []).map((p) => (typeof p === 'object' ? p : { id: null, nome: String(p), abrev: String(p) }));
    filmesExternos.set(id, {
      ...leves, id, externo: true, tipo: 'jogo', igdb, steam: steam || null, plataformasJogo,
      titulo: leves.titulo || leves.nome || '', ano: leves.ano || '', capa: leves.capa || '',
      trailerId: 'nenhum', detalhado: false,
    });
  }
  abrirPainel(id, { voltarPara });
  const ext = filmesExternos.get(id);
  if (igdb && !ext.detalhado && !ext.pedindo) {
    ext.pedindo = true;
    Promise.resolve().then(() => pedirDetalhesJogo(igdb)).catch(() => null).then((r) => {
      ext.pedindo = false;
      if (r && r.ok && r.dados) {
        const { status, tags, zeradoEm, minhaNota, ...d } = r.dados; // nada do usuário vem da IGDB, mas por garantia
        Object.assign(ext, d, { id, externo: true, tipo: 'jogo', detalhado: true, semDetalhes: '' });
        if (!ext.steam) ext.steam = steam || null;
      } else ext.semDetalhes = (r && r.erro && r.erro.tipo) || 'rede';
      if (estado.painelId !== id) return;
      const topo = $('#painel .painel-capa');
      if (topo && ext.detalhado) topo.dataset.id = ''; // logo, fundo e trailer novos: monta o topo de novo
      renderPainel();
    });
  }
}

// "Adicionar à lista" num jogo de fora: vira o item, e a página passa a ser a dele.
async function adicionarJogoFora(f, botao) {
  if (!f || !f.externo) return;
  if (botao) botao.disabled = true;
  const { id, externo, detalhado, semDetalhes, pedindo, trailerId, ...dados } = f;
  let novo = null;
  try {
    novo = await adicionarJogo(dados); // src/jogos-lista.js: grava e devolve o item (ou o que já estava)
  } catch (e) {
    console.error('adicionar jogo', e);
  }
  if (!novo || !novo.id) { if (botao) botao.disabled = false; aviso('Não deu para adicionar o jogo.', { tipo: 'erro' }); return; }
  filmesExternos.delete(id);
  abrirPainel(novo.id, { voltarPara: estado.painelAnterior });
}

// ---------- Desenho ----------

function renderPainelJogo(f) {
  if (!paginaJogoNoCelular()) { renderPaginaJogo(f); return; } // PC: a página nova (abaixo)
  $('#painel').setAttribute('aria-label', 'Detalhes do jogo');
  const topo = $('#painel .painel-capa');
  if (!topo || topo.dataset.id !== f.id) {
    const visivel = comImagensDoJogo(f);
    const [fundo, ...resto] = fundosDoJogo(f);
    const e = estadoBotaoSteam(f, contextoSteamJogo());
    $('#painel-conteudo').innerHTML = `
      <button class="redondo painel-fechar" data-p="fechar" aria-label="Fechar" title="Fechar (Esc)">${icone('X')}</button>
      ${botaoVoltarPainelHTML()}
      <div class="painel-capa painel-jogo" data-id="${esc(f.id)}">
        <div class="painel-fundo-video"><div class="destaque-fundo-capa"></div>${fundo ? `<img class="jogo-fundo-img" src="${esc(fundo)}" alt="" data-resto="${esc(JSON.stringify(resto))}">` : ''}</div>
        <div class="painel-sombra"></div>
        <button class="btn-redondo painel-som" data-p="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
        <div class="painel-cabecalho">
          <div class="destaque-identidade">
            <div class="destaque-poster painel-poster-externo">${capaHTML(visivel, { tamanho: 'grande' })}</div>
            <div class="destaque-titulo">${tituloHTML(visivel)}</div>
          </div>
          <div class="painel-botoes">
            <button class="btn btn-assistir jogo-steam-btn" data-j="steam" data-acao="${e.tipo === 'steam' ? e.acao : 'link'}" title="${esc(e.dica)}">${botaoSteamConteudoHTML(e)}</button>
            ${f.externo ? '' : zereiBotaoHTML(f)}
            ${f.externo ? '' : favJogoBotaoHTML(f)}
            ${f.externo ? `<button class="btn jogo-adicionar" data-j="adicionar">${icone('Plus')} Adicionar à lista</button>` : ''}
            ${f.externo ? '' : `<button class="redondo" data-p="story" title="Criar story para o Instagram" aria-label="Criar story para o Instagram">${icone('ImagePlus')}</button>`}
            ${f.trailer ? `<button class="redondo" data-p="trailer" data-rotulo="Trailer" title="Ver o trailer em tela cheia" aria-label="Ver o trailer em tela cheia">${icone('Maximize')}</button>` : ''}
            <div class="jogo-tempo-steam" data-j-steam-tempo${tempoSteamJogoHTML(e) ? '' : ' hidden'}>${tempoSteamJogoHTML(e)}</div>
          </div>
        </div>
      </div>
      <div id="painel-resto"></div>`;
    fundoDesfocado($('.painel-capa'), visivel);
    carregarTrailerPainel(f);
    carregarSteamDoJogo().then(() => { if (estado.painelId === f.id) atualizarBotaoSteamJogo(f); });
    trazerImagensSteamJogo(f);
  } else {
    atualizarBotaoSteamJogo(f);
  }

  const fichas = [
    ['Desenvolvimento', nomesJogo(f.desenvolvedores)],
    ['Publicação', nomesJogo(f.publicadoras)],
    ['Gêneros', (f.generos || []).join(', ')],
    ['Modos', (f.modos || []).join(', ')],
    ['Lançamento', f.lancamento ? diaLegivel(f.lancamento, { comAno: true }) : ''],
  ].filter(([, v]) => v);
  $('#painel-resto').innerHTML = `
    <div class="painel-corpo corpo-jogo">
      <div>
        <p class="painel-meta" data-info="meta-painel">${metaJogoHTML(f)}</p>
        ${f.externo ? foraDaListaHTML(f) : usuarioJogoHTML(f)}
        ${f.sinopse ? `<p class="painel-sinopse">${esc(f.sinopse)}</p>` : ''}
        ${ondeJogarHTML(f)}
      </div>
      <div class="jogo-lado">
        <div class="painel-fichas">
          ${fichas.map(([r, v]) => `<p class="painel-ficha"><b>${r}:</b> <span>${esc(v)}</span></p>`).join('')}
        </div>
        ${hltbHTML(f)}
      </div>
    </div>
    <div id="painel-relacionados"></div>`;
  carregarMaisDoDesenvolvedor(f);
  procurarHltbJogo(f);
}

const nomesJogo = (lista) => (Array.isArray(lista) ? lista.map((x) => (x && x.nome) || '').filter(Boolean).join(', ') : '');

// "2018 · Ação, Indie · ⌛ 23 h para zerar"
function metaJogoHTML(f) {
  const partes = [];
  if (f.ano) partes.push(`<span>${esc(f.ano)}</span>`);
  if ((f.generos || []).length) partes.push(`<span>${esc(f.generos.slice(0, 3).join(' · '))}</span>`);
  const t = temposHltb(f);
  const zerar = t.historia || t.extras;
  if (zerar) partes.push(`<span class="jogo-meta-tempo" title="Tempo para zerar (HowLongToBeat, pela IGDB)">${icone('Hourglass')} ${esc(horasHltb(zerar))} para zerar</span>`);
  return partes.join('') || '&nbsp;';
}

function foraDaListaHTML(f) {
  const chave = f.semDetalhes === 'chave';
  return `
    <p class="painel-externo-aviso">${icone('Info')} Este jogo não está na sua lista.</p>
    ${f.semDetalhes ? `<p class="jogo-aviso-detalhes">${chave
    ? `Para ver todos os detalhes (plataformas, desenvolvedor, tempos), coloque as chaves do IGDB em Configurações. <button class="btn btn-fantasma" data-j="config">${icone('Settings')} Abrir Configurações</button>`
    : 'Não deu para buscar os detalhes do jogo agora.'}</p>` : ''}`;
}

// O que é do usuário: status (como nos animes), a data em que zerou, nota, tags e remover.
function usuarioJogoHTML(f) {
  if (!paginaJogoNoCelular()) return usuarioPaginaJogoHTML(f);
  const status = ROTULOS_STATUS_JOGO[f.status] ? f.status : 'quero';
  const zerado = STATUS_JOGO_ZERADO.includes(status);
  const tags = Array.isArray(f.tags) ? f.tags : [];
  const sugestoes = sugestoesTagsJogo(f, estado.filmes).slice(0, 8);
  return `
    <div class="jogo-usuario" data-jogo-usuario>
      <div class="jogo-status-linha">
        <label class="serie-status jogo-status"><span class="sr-so">Status</span>
          <select data-j-status aria-label="Status do jogo">
            ${Object.entries(ROTULOS_STATUS_JOGO).map(([k, r]) => `<option value="${k}"${k === status ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </label>
        ${zerado ? `<label class="jogo-zerado">${icone('Trophy')} ${status === 'cem' ? 'Fiz 100% em' : 'Zerei em'} <input type="date" data-j-zerado value="${esc(f.zeradoEm || '')}" max="${hoje()}" aria-label="Dia em que zerou"></label>` : ''}
      </div>
      <div class="minha-nota-linha"><b>Sua nota</b>${estrelasHTML(f)}</div>
      <div class="jogo-tags">
        <b>${icone('Tags')} Tags</b>
        ${tags.map((t) => `<span class="jogo-tag">${esc(t)}<button data-j="tirar-tag" data-tag="${esc(t)}" title="Tirar a tag" aria-label="Tirar a tag ${esc(t)}">${icone('X')}</button></span>`).join('')}
        <input class="jogo-tag-nova" data-j-tag list="jogo-tags-sugestoes" maxlength="40" placeholder="${tags.length ? 'Outra tag…' : 'Nova tag (ex.: jogar nas férias)'}" aria-label="Nova tag" enterkeyhint="done">
        <datalist id="jogo-tags-sugestoes">${sugestoesTagsJogo(f, estado.filmes).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      </div>
      ${sugestoes.length ? `<div class="jogo-tags-sugeridas"><span>Suas tags:</span>${sugestoes.map((t) => `<button class="jogo-tag-sugerida" data-j="por-tag" data-tag="${esc(t)}">${icone('Plus')} ${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="serie-remover-linha"><button class="btn btn-perigo serie-remover" data-p="excluir">${icone('Trash2')} Remover da lista</button></div>
    </div>`;
}

// Onde jogar: a Steam primeiro e em destaque, depois as outras lojas (com
// link) e as plataformas (consoles) do jogo.
function ondeJogarHTML(f) {
  const lojas = lojasDoJogo(f);
  const plataformas = (f.plataformasJogo || []).map((p) => (p && (p.abrev || p.nome)) || '').filter((p, i, l) => p && l.indexOf(p) === i);
  if (!lojas.length && !plataformas.length) return '';
  const steam = lojas.find((l) => l.loja === 'steam');
  const outras = lojas.filter((l) => l.loja !== 'steam');
  const e = estadoBotaoSteam(f, contextoSteamJogo());
  return `
    <section class="jogo-secao jogo-onde">
      <h3>Onde jogar</h3>
      <div class="jogo-lojas">
        ${steam ? `<button class="jogo-loja jogo-loja-steam" data-j="loja-steam" title="Abre a página do jogo na loja da Steam">${MARCA_STEAM_JOGO}<span><b>Steam</b><small>${esc(subtituloSteamJogo(e))}</small></span></button>` : ''}
        ${outras.map((l) => `<button class="jogo-loja" data-j="loja" data-url="${esc(l.url)}" title="Abre a página do jogo na ${esc(l.nome)}">${icone('ExternalLink')}<span>${esc(l.nome)}</span></button>`).join('')}
      </div>
      ${plataformas.length ? `<div class="jogo-plataformas" aria-label="Plataformas">${plataformas.map((p) => `<span class="jogo-plataforma">${esc(p)}</span>`).join('')}</div>` : ''}
    </section>`;
}

// HowLongToBeat: os três tempos (da IGDB) no estilo do site e o botão para ele.
function hltbHTML(f) {
  const t = temposHltb(f);
  const tempo = (classe, rotulo, h) => `<div class="hltb-tempo ${classe}"><span>${rotulo}</span><b>${h ? esc(horasHltb(h)) : '—'}</b></div>`;
  const algum = t.historia || t.extras || t.cem;
  return `
    <section class="jogo-secao jogo-hltb">
      <h3>HowLongToBeat</h3>
      ${algum ? `<div class="hltb-tempos">${tempo('hltb-historia', 'História', t.historia)}${tempo('hltb-extras', 'História + extras', t.extras)}${tempo('hltb-cem', '100%', t.cem)}</div>
      <p class="hltb-fonte">Tempos médios dos jogadores, pela IGDB.</p>` : '<p class="hltb-fonte">Ainda sem os tempos deste jogo.</p>'}
      <button class="btn btn-fantasma" data-j="hltb" title="${f.hltb ? 'Abre a página do jogo no HowLongToBeat' : 'Procura o jogo no HowLongToBeat'}">${icone('ExternalLink')} Ver no HowLongToBeat</button>
    </section>`;
}

// O id do HLTB (Wikidata), procurado uma vez por jogo; no item da lista, fica gravado.
const hltbProcurados = new Set();
async function procurarHltbJogo(f) {
  if (f.hltb || (!f.igdbSlug && !appidDoJogo(f))) return;
  const chave = `${f.igdbSlug || ''}|${appidDoJogo(f) || ''}`;
  if (hltbProcurados.has(chave)) return;
  hltbProcurados.add(chave);
  const r = await Promise.resolve().then(() => pedirHltbJogo({ igdbSlug: f.igdbSlug || '', steam: appidDoJogo(f) })).catch(() => null);
  const id = r && r.ok ? Number(r.dados) || null : null;
  if (!r || !r.ok) hltbProcurados.delete(chave); // sem internet: tenta de novo da próxima vez
  if (!id) return;
  f.hltb = id;
  if (!f.externo) api.atualizarFilme(f.id, { hltb: id });
  const b = estado.painelId === f.id && $('#painel [data-j="hltb"]');
  if (b) b.title = 'Abre a página do jogo no HowLongToBeat';
}

// ---------- Mais do desenvolvedor ----------

const jogosDoDevCache = new Map(); // `${empresa}:${excluir}` → resposta ok

async function jogosDoDevGuardados(empresaId, excluir) {
  const chave = `${empresaId}:${excluir || ''}`;
  if (jogosDoDevCache.has(chave)) return jogosDoDevCache.get(chave);
  const r = await Promise.resolve().then(() => pedirJogosDoDesenvolvedor(empresaId, { excluir: excluir ? [excluir] : [] })).catch(() => null);
  if (r && r.ok) jogosDoDevCache.set(chave, r);
  return r;
}

async function carregarMaisDoDesenvolvedor(f) {
  const devs = (f.desenvolvedores || []).filter((d) => d && d.id).slice(0, 3);
  if (!devs.length) return;
  const respostas = await Promise.all(devs.map((d) => jogosDoDevGuardados(d.id, f.igdb)));
  const area = $('#painel-relacionados');
  if (estado.painelId !== f.id || !area) return;
  let html = devs.map((d, i) => {
    const r = respostas[i];
    const jogos = r && r.ok && r.dados ? (r.dados.jogos || []).filter((j) => Number(j.igdb) !== Number(f.igdb)) : [];
    return jogos.length ? fileiraDevHTML(`Mais da ${(r.dados.empresa && r.dados.empresa.nome) || d.nome}`, jogos) : '';
  }).join('');
  if (!html && respostas.some((r) => r && !r.ok && r.erro && r.erro.tipo === 'chave')) {
    html = `<p class="jogo-dev-aviso">${icone('Info')} Com as chaves do IGDB em Configurações, aparecem aqui os outros jogos de ${esc(devs.map((d) => d.nome).join(', '))}.</p>`;
  }
  area.innerHTML = html;
  prepararSetasRelacionados();
}

function fileiraDevHTML(titulo, jogos) {
  const meus = estado.filmes.filter(ehJogo);
  const cartao = (r) => {
    jogosFora.set(Number(r.igdb), r);
    const meu = meus.find((x) => (r.igdb && Number(x.igdb) === Number(r.igdb)) || (r.steam && appidDoJogo(x) === appidDoJogo(r)));
    const capa = r.capa
      ? `<img src="${esc(r.capa)}" alt="" loading="lazy" data-titulo="${esc(r.titulo)}" data-ano="${esc(r.ano)}">`
      : `<div class="capa-vazia"><strong>${esc(r.titulo)}</strong><span>${esc(r.ano)}</span></div>`;
    return `
      <div class="rel-filme${meu ? ' na-lista' : ''}">
        <button class="rel-capa" data-j="dev-abrir" data-igdb="${esc(r.igdb)}"${meu ? ` data-meu="${esc(meu.id)}"` : ''} title="${esc(meu ? `${r.titulo}: na sua lista` : `${r.titulo}: ver o jogo`)}">
          <div class="capa">${capa}</div>
        </button>
        ${meu ? `<span class="rel-selo na-lista" title="Na sua lista">${icone('Bookmark')}</span>` : ''}
        <strong>${esc(r.titulo)}</strong><span>${esc(r.ano)}</span>
      </div>`;
  };
  return `
    <section class="relacionados">
      <h3>${esc(titulo)}</h3>
      <div class="rel-envoltorio">
        <button class="rel-seta esq" data-p="rel-rolar" data-lado="-1" aria-label="Voltar" hidden>${icone('ChevronLeft')}</button>
        <div class="rel-fileira">${jogos.map(cartao).join('')}</div>
        <button class="rel-seta dir" data-p="rel-rolar" data-lado="1" aria-label="Mais">${icone('ChevronRight')}</button>
      </div>
    </section>`;
}

// ---------- Mudanças do usuário ----------

async function salvarJogo(f, mudancas) {
  Object.assign(f, mudancas);
  // Zerei e 100% são o "visto" do jogo (o processo principal grava o mesmo; aqui só para a tela já refletir).
  if ('status' in mudancas) f.visto = STATUS_JOGO_ZERADO.includes(mudancas.status);
  agendarRender();
  if (typeof calendario !== 'undefined' && !calendario.hidden) renderCalendario();
  if (!f.externo) await api.atualizarFilme(f.id, mudancas);
}

// Redesenha só o bloco do usuário (o resto da página, com trailer e fileiras, fica).
function renderUsuarioJogo(f, foco = null) {
  const bloco = $('#painel [data-jogo-usuario]');
  if (!bloco || estado.painelId !== f.id) return;
  bloco.outerHTML = usuarioJogoHTML(f);
  if (foco) $(`#painel ${foco}`)?.focus({ preventScroll: true });
}

// O botão "Zerei" ao lado do Jogar: o jeito rápido de marcar (e desmarcar) o jogo como zerado.
function zereiBotaoHTML(f) {
  const status = ROTULOS_STATUS_JOGO[f.status] ? f.status : 'quero';
  const zerado = STATUS_JOGO_ZERADO.includes(status);
  const nome = status === 'cem' ? '100%' : 'Zerado';
  const texto = zerado ? nome : 'Zerei';
  const dica = zerado
    ? `${nome}${f.zeradoEm ? ` em ${diaLegivel(f.zeradoEm)}` : ''}. Clique para desmarcar.`
    : 'Marcar como zerado hoje (o dia aparece no calendário)';
  return `<button class="btn jogo-zerei${zerado ? ' ativo' : ''}" data-j="zerei" aria-pressed="${zerado}" title="${esc(dica)}">${icone('Trophy')} ${texto}</button>`;
}
// A estrela de favorito (como nos filmes): os favoritos aparecem no filtro e na fileira de favoritos.
function favJogoBotaoHTML(f) {
  const dica = f.favorito ? 'Tirar dos favoritos' : 'Favoritar';
  return `<button class="redondo jogo-fav${paginaJogoNoCelular() ? '' : ' pj-quadrado'}${f.favorito ? ' fav-on' : ''}" data-j="favorito" data-rotulo="Favorito" aria-pressed="${Boolean(f.favorito)}" title="${dica}" aria-label="${dica}">${icone('Star', { preenchido: Boolean(f.favorito) })}</button>`;
}
async function alternarFavJogo(f) {
  await alternar(f.id, 'favorito');
  const b = document.querySelector('#painel [data-j="favorito"]');
  if (b && estado.painelId === f.id) b.outerHTML = favJogoBotaoHTML(f);
  aviso(f.favorito ? `“${f.titulo}” está nos favoritos.` : `“${f.titulo}” saiu dos favoritos.`, { tipo: f.favorito ? 'ok' : '' });
}
function atualizarZereiJogo(f) {
  const b = document.querySelector('#painel [data-j="zerei"]');
  if (b && estado.painelId === f.id) b.outerHTML = zereiBotaoHTML(f);
}
// Zerei: marca zerado hoje. Já zerado: volta para "jogando", com Desfazer (devolve o status e o dia).
async function alternarZereiJogo(f) {
  if (!STATUS_JOGO_ZERADO.includes(f.status)) { await mudarStatusJogo(f, 'zerado'); return; }
  const antes = { status: f.status, zeradoEm: f.zeradoEm || '' };
  await mudarStatusJogo(f, 'jogando');
  aviso(`“${f.titulo}” não está mais como zerado.`, {
    duracao: 6000,
    acao: { rotulo: 'Desfazer', fn: async () => { await salvarJogo(f, antes); renderUsuarioJogo(f); atualizarZereiJogo(f); } },
  });
}

async function mudarStatusJogo(f, status) {
  const m = mudancasDoStatusJogo(f, status, hoje());
  if (!m) return;
  const antes = f.status;
  await salvarJogo(f, m);
  renderUsuarioJogo(f, '[data-j-status]');
  atualizarZereiJogo(f);
  atualizarStatusPaginaJogo(f);
  if (STATUS_JOGO_ZERADO.includes(status) && !STATUS_JOGO_ZERADO.includes(antes)) {
    aviso(`“${f.titulo}”: ${status === 'cem' ? '100%' : 'zerado'} em ${diaLegivel(f.zeradoEm)}! Dá para mudar o dia ao lado do status.`, { tipo: 'ok', duracao: 6000 });
  }
}

function adicionarTagJogo(f, texto) {
  const tag = limparTagJogo(texto);
  if (!tag) return;
  const tags = Array.isArray(f.tags) ? f.tags : [];
  if (tags.some((t) => t.toLocaleLowerCase('pt-BR') === tag.toLocaleLowerCase('pt-BR'))) return;
  salvarJogo(f, { tags: [...tags, tag] });
  renderUsuarioJogo(f, '[data-j-tag]');
}

function tirarTagJogo(f, tag) {
  salvarJogo(f, { tags: (f.tags || []).filter((t) => t !== tag) });
  renderUsuarioJogo(f, '[data-j-tag]');
}

// ---------- Eventos (no #painel, que já existe quando este arquivo carrega) ----------

function ligarPainelJogo(painel) {
  painel.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-j]');
    const f = estado.painelId ? porId(estado.painelId) : null;
    if (!b || !ehJogo(f)) return;
    switch (b.dataset.j) {
      case 'steam': usarBotaoSteam(f); break;
      case 'loja-steam': { const id = appidDoJogo(f); if (id) abrirSteamPeloApp(id, 'web'); break; }
      case 'loja': abrirLinkJogo(b.dataset.url); break;
      case 'hltb': abrirLinkJogo(linkHltbJogo(f)); break;
      case 'adicionar': adicionarJogoFora(f, b); break;
      case 'zerei': alternarZereiJogo(f); break;
      case 'favorito': alternarFavJogo(f); break;
      case 'tirar-tag': tirarTagJogo(f, b.dataset.tag); break;
      case 'por-tag': adicionarTagJogo(f, b.dataset.tag); break;
      case 'config': fecharPainel(); abrirConfiguracoes(); setTimeout(() => document.getElementById('cfg-nandplay')?.scrollIntoView({ block: 'start' }), 60); break;
      case 'dev-abrir':
        if (b.dataset.meu) abrirPainel(b.dataset.meu, { voltarPara: f.id });
        else abrirJogoFora(b.dataset.igdb, jogosFora.get(Number(b.dataset.igdb)) || {}, { voltarPara: f.id });
        break;
    }
  });
  painel.addEventListener('change', (ev) => {
    const f = estado.painelId ? porId(estado.painelId) : null;
    if (!ehJogo(f) || f.externo) return;
    if (ev.target.matches('[data-j-status]')) mudarStatusJogo(f, ev.target.value);
    if (ev.target.matches('[data-j-zerado]')) {
      const dia = ev.target.value;
      if (!dia) { ev.target.value = f.zeradoEm || ''; return; }
      if (dia > hoje()) { aviso('Esse dia ainda não chegou.', { tipo: 'erro' }); ev.target.value = f.zeradoEm || ''; return; }
      salvarJogo(f, { zeradoEm: dia });
      aviso(`“${f.titulo}”: zerado em ${diaLegivel(dia, { comAno: true })}.`, { tipo: 'ok' });
    }
    // A sugestão escolhida na lista (datalist) entra direto.
    if (ev.target.matches('[data-j-tag]') && ev.target.value.trim()) adicionarTagJogo(f, ev.target.value);
  });
  painel.addEventListener('keydown', (ev) => {
    if (!ev.target.matches || !ev.target.matches('[data-j-tag]') || ev.key !== 'Enter') return;
    ev.preventDefault();
    const f = estado.painelId ? porId(estado.painelId) : null;
    if (ehJogo(f) && !f.externo) adicionarTagJogo(f, ev.target.value);
  });
}

if (typeof document !== 'undefined' && document.getElementById('painel')) {
  ligarPainelJogo(document.getElementById('painel'));
  document.addEventListener('error', trocarFundoQueFalhou, true);
  if (window.api && typeof window.api.aoBibliotecaSteam === 'function') window.api.aoBibliotecaSteam(receberBibliotecaSteam);
}

// ---------- A página do jogo no PC (visual novo) ----------
//
// O celular segue com o painel acima (mobile/web/detalhes.js rearruma). No PC:
// só o Jogar como primário; "Ver na Steam" com o logotipo; o status num seletor
// único ("Zerado em 3 de nov. / Zerei", abre um menu); favorito; tags com canto
// de 4px; "Onde jogar" com a Steam primeiro; o HowLongToBeat numa régua só, com
// o seu tempo marcado em cima; e "Mais da <desenvolvedora>" embaixo.

function paginaJogoNoCelular() { return Boolean(typeof window !== 'undefined' && window.api && window.api.celular); }

const MESES_CURTOS_JOGO = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
// "3 de nov." (e o ano, se não for o atual).
function diaCurtoJogo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const ano = Number(m[1]) !== new Date().getFullYear() ? ` de ${m[1]}` : '';
  return `${Number(m[3])} de ${MESES_CURTOS_JOGO[Number(m[2]) - 1]}${ano}`;
}

// O que o seletor de status mostra: { rotulo: 'Zerei', detalhe: 'Zerado em 3 de nov.' }.
function textoStatusJogo(f) {
  const status = ROTULOS_STATUS_JOGO[f.status] ? f.status : 'quero';
  const dia = diaCurtoJogo(f.zeradoEm);
  let detalhe = 'Status';
  if (status === 'zerado') detalhe = dia ? `Zerado em ${dia}` : 'Zerado';
  else if (status === 'cem') detalhe = dia ? `100% em ${dia}` : 'Completo';
  return { status, rotulo: ROTULOS_STATUS_JOGO[status], detalhe };
}

function statusPaginaJogoHTML(f) {
  const t = textoStatusJogo(f);
  const zerado = STATUS_JOGO_ZERADO.includes(t.status);
  return `<div class="pj-status" data-pj-status>
      <button class="pj-status-btn" data-j="status-menu" aria-haspopup="menu" aria-expanded="false" title="Mudar o status">
        <span class="pj-status-rot"><small>${esc(t.detalhe)}</small><b>${esc(t.rotulo)}</b></span>${icone('ChevronDown')}
      </button>
      <div class="pj-status-menu" role="menu" hidden>
        ${Object.entries(ROTULOS_STATUS_JOGO).map(([k, r]) => `<button role="menuitemradio" aria-checked="${k === t.status}" class="${k === t.status ? 'atual' : ''}" data-j="status" data-status="${k}">${esc(r)}${k === t.status ? icone('Check') : ''}</button>`).join('')}
        ${zerado ? `<label class="pj-status-dia">${t.status === 'cem' ? 'Fez 100% em' : 'Zerou em'}<input type="date" data-j-zerado value="${esc(f.zeradoEm || '')}" max="${hoje()}" aria-label="Dia em que zerou"></label>` : ''}
      </div>
    </div>`;
}

function atualizarStatusPaginaJogo(f) {
  const el = document.querySelector('#painel [data-pj-status]');
  if (el && estado.painelId === f.id) el.outerHTML = statusPaginaJogoHTML(f);
}

function fecharMenuStatusJogo() {
  const menu = document.querySelector('#painel .pj-status-menu:not([hidden])');
  if (!menu) return;
  menu.hidden = true;
  menu.parentElement.querySelector('[data-j="status-menu"]')?.setAttribute('aria-expanded', 'false');
}

// "Ver na Steam" (com o logotipo): só quando o primário não é já a loja.
function verNaSteamJogoHTML(f, e) {
  if (!e || e.tipo !== 'steam' || e.acao === 'web' || e.acao === 'loja') return '';
  return `<button class="btn btn-pj pj-vidro pj-ver-steam" data-j="loja-steam" title="Abre a página do jogo na loja da Steam">${MARCA_STEAM_JOGO}Ver na Steam</button>`;
}

// "2020  Ação, Indie, RPG  22 h para zerar  Supergiant Games"
function metaPaginaJogoHTML(f) {
  const partes = [];
  if (f.ano) partes.push(`<span class="pj-ano">${esc(f.ano)}</span>`);
  if ((f.generos || []).length) partes.push(`<span>${esc(f.generos.slice(0, 3).join(', '))}</span>`);
  const t = temposHltb(f);
  const zerar = t.historia || t.extras;
  if (zerar) partes.push(`<span title="Tempo para zerar (HowLongToBeat, pela IGDB)">${esc(horasHltb(zerar))} para zerar</span>`);
  const dev = nomesJogo((f.desenvolvedores || []).slice(0, 1));
  if (dev) partes.push(`<span>${esc(dev)}</span>`);
  return partes.join('') || '&nbsp;';
}

// Tags e nota (o bloco que se redesenha a cada mudança: data-jogo-usuario).
function usuarioPaginaJogoHTML(f) {
  const tags = Array.isArray(f.tags) ? f.tags : [];
  const sugestoes = sugestoesTagsJogo(f, estado.filmes);
  return `
    <div class="pj-usuario" data-jogo-usuario>
      <section>
        <h3 class="pcf-rotulo">Tags</h3>
        <div class="pj-tags">
          ${tags.map((t) => `<span class="pj-tag">${esc(t)}<button data-j="tirar-tag" data-tag="${esc(t)}" title="Tirar a tag" aria-label="Tirar a tag ${esc(t)}">${icone('X')}</button></span>`).join('')}
          <input class="pj-tag-nova" data-j-tag list="jogo-tags-sugestoes" maxlength="40" placeholder="+ tag" aria-label="Nova tag" enterkeyhint="done">
          <datalist id="jogo-tags-sugestoes">${sugestoes.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
        ${sugestoes.length ? `<div class="pj-tags-sugeridas">${sugestoes.slice(0, 8).map((t) => `<button class="pj-tag-sugerida" data-j="por-tag" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
      </section>
      <section>
        <h3 class="pcf-rotulo">Sua nota</h3>
        <div class="minha-nota-linha">${estrelasHTML(f)}</div>
      </section>
    </div>`;
}

// Onde jogar: a Steam primeiro (com "instalado" quando estiver), as outras lojas e as plataformas.
function ondeJogarPaginaHTML(f, e) {
  const lojas = lojasDoJogo(f);
  const plataformas = (f.plataformasJogo || []).map((p) => (p && (p.abrev || p.nome)) || '').filter((p, i, l) => p && l.indexOf(p) === i);
  if (!lojas.length && !plataformas.length) return '';
  const steam = lojas.find((l) => l.loja === 'steam');
  const outras = lojas.filter((l) => l.loja !== 'steam');
  return `<section>
      <h3 class="pcf-rotulo">Onde jogar</h3>
      <div class="pj-lojas">
        ${steam ? `<button class="pj-loja pj-loja-steam" data-j="loja-steam" title="Abre a página do jogo na loja da Steam">${MARCA_STEAM_JOGO}<b>Steam</b><small>${esc(subtituloSteamJogo(e).toLocaleLowerCase('pt-BR'))}</small></button>` : ''}
        ${outras.map((l) => `<button class="pj-loja" data-j="loja" data-url="${esc(l.url)}" title="Abre a página do jogo na ${esc(l.nome)}">${esc(l.nome)}</button>`).join('')}
        ${plataformas.filter((p) => !(steam && /^PC$/i.test(p))).map((p) => `<span class="pj-loja pj-plataforma">${esc(p)}</span>`).join('')}
      </div>
    </section>`;
}

// HowLongToBeat numa régua só: História, + extras e 100% em tons do verde do nandplay,
// com o seu tempo (da Steam) marcado em cima.
function reguaHltbHTML(f, e) {
  const t = temposHltb(f);
  const minutos = e && e.tipo === 'steam' ? Number(e.minutos) || 0 : 0;
  const voce = minutos >= 60 ? minutos / 60 : 0;
  const marcas = [['historia', 'história', t.historia], ['extras', 'com extras', t.extras], ['cem', '100%', t.cem]].filter(([, , h]) => h > 0);
  const botao = `<button class="pj-hltb-link" data-j="hltb" title="${f.hltb ? 'Abre a página do jogo no HowLongToBeat' : 'Procura o jogo no HowLongToBeat'}">${icone('ExternalLink')} Ver no HowLongToBeat</button>`;
  if (!marcas.length) return `<section data-pj-hltb><h3 class="pcf-rotulo">HowLongToBeat</h3><p class="pcf-vazio">Ainda sem os tempos deste jogo.</p>${botao}</section>`;
  const max = Math.max(...marcas.map(([, , h]) => h), voce) || 1;
  const pct = (h) => Math.min(100, (h / max) * 100);
  const cores = { historia: '#0F8E57', extras: '#2EB97A', cem: '#7FE3B4' };
  let inicio = 0;
  const faixas = marcas.map(([k, , h]) => { const p = pct(h); const s = `${cores[k]} ${inicio}% ${p}%`; inicio = p; return s; });
  if (inicio < 100) faixas.push(`rgba(255, 255, 255, .1) ${inicio}% 100%`);
  let anterior = -100;
  let desce = false;
  const rotulos = marcas.map(([, nome, h]) => {
    const p = pct(h);
    const baixo = p - anterior < 20; // perto demais da marca anterior: desce uma linha
    if (baixo) desce = true; else anterior = p;
    return `<span class="pj-marca${baixo ? ' baixo' : ''}${p < 14 ? ' inicio' : ''}" style="left:${p}%"><b>${esc(horasHltb(h))}</b>${esc(nome)}</span>`;
  }).join('');
  const pv = pct(voce);
  const marcaVoce = voce ? `<span class="pj-voce${pv < 12 ? ' inicio' : pv > 88 ? ' fim' : ''}" style="left:${pv}%">você, ${esc(horasJogadas(minutos))}</span>` : '';
  const legenda = marcas.map(([, nome, h]) => `${nome}: ${horasHltb(h)}`).join(', ') + (voce ? `; você: ${tempoDeJogoSteam(minutos)}` : '');
  return `<section data-pj-hltb>
      <h3 class="pcf-rotulo">HowLongToBeat</h3>
      <div class="pj-regua${voce ? ' com-voce' : ''}${desce ? ' duas-linhas' : ''}" role="img" aria-label="${esc(legenda)}">
        <div class="pj-barra" style="background:linear-gradient(90deg, ${faixas.join(', ')})"></div>
        ${marcaVoce}${rotulos}
      </div>
      ${botao}
    </section>`;
}

// A biblioteca/instalados da Steam chegaram: "instalado", o "Ver na Steam" e a régua.
function atualizarPaginaJogoSteam(f, e) {
  if (paginaJogoNoCelular() || estado.painelId !== f.id) return;
  const sub = document.querySelector('#painel .pj-loja-steam small');
  if (sub) sub.textContent = subtituloSteamJogo(e).toLocaleLowerCase('pt-BR');
  const ver = document.querySelector('#painel [data-pj-ver-steam]');
  if (ver) ver.innerHTML = verNaSteamJogoHTML(f, e);
  const regua = document.querySelector('#painel [data-pj-hltb]');
  if (regua) regua.outerHTML = reguaHltbHTML(f, e);
}

function capturasJogoValidas(f) { return (Array.isArray(f.capturas) ? f.capturas : []).filter((u) => /^https:\/\//i.test(String(u))); }

function capturasPaginaJogoHTML(f) {
  const lista = capturasJogoValidas(f);
  if (!lista.length) return '';
  return `<section>
      <h3 class="pcf-rotulo">Capturas</h3>
      <div class="pj-capturas">${lista.slice(0, 3).map((u, i) => `<button class="pj-captura" data-j="captura" data-i="${i}" aria-label="Ver a captura ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>
    </section>`;
}

function renderPaginaJogo(f) {
  $('#painel').setAttribute('aria-label', 'Detalhes do jogo');
  const e = estadoBotaoSteam(f, contextoSteamJogo());
  const topo = $('#painel .painel-capa');
  if (!topo || topo.dataset.id !== f.id) {
    const visivel = comImagensDoJogo(f);
    const [fundo, ...resto] = fundosDoJogo(f);
    $('#painel-conteudo').innerHTML = `
      <button class="redondo painel-fechar" data-p="fechar" aria-label="Fechar" title="Fechar (Esc)">${icone('X')}</button>
      ${botaoVoltarPainelHTML()}
      <div class="painel-capa painel-jogo pj" data-id="${esc(f.id)}">
        <div class="painel-fundo-video"><div class="destaque-fundo-capa"></div>${fundo ? `<img class="jogo-fundo-img" src="${esc(fundo)}" alt="" data-resto="${esc(JSON.stringify(resto))}">` : ''}</div>
        <div class="painel-sombra"></div>
        <button class="btn-redondo painel-som" data-p="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
        <div class="painel-cabecalho">
          <div class="pj-capa destaque-poster painel-poster-externo">${capaHTML(visivel, { tamanho: 'grande' })}</div>
          <div class="pj-info">
            <div class="destaque-titulo">${tituloHTML(visivel)}</div>
            <p class="pj-meta" data-info="meta-painel">${metaPaginaJogoHTML(f)}</p>
            <div class="painel-botoes">
              <button class="btn btn-pj pj-jogar jogo-steam-btn" data-j="steam" data-acao="${e.tipo === 'steam' ? e.acao : 'link'}" title="${esc(e.dica)}">${botaoSteamConteudoHTML(e)}</button>
              <span class="pj-ver-steam-lugar" data-pj-ver-steam>${verNaSteamJogoHTML(f, e)}</span>
              ${f.externo ? `<button class="btn btn-pj pj-vidro" data-j="adicionar">${icone('Plus')} Adicionar à lista</button>` : statusPaginaJogoHTML(f)}
              ${f.externo ? '' : favJogoBotaoHTML(f)}
              ${f.externo ? '' : `<button class="redondo pj-quadrado" data-p="story" title="Criar story para o Instagram" aria-label="Criar story para o Instagram">${icone('ImagePlus')}</button>`}
              ${f.trailer ? `<button class="redondo pj-quadrado" data-p="trailer" title="Ver o trailer em tela cheia" aria-label="Ver o trailer em tela cheia">${icone('Clapperboard')}</button>` : ''}
              <div class="jogo-tempo-steam pj-tempo" data-j-steam-tempo${tempoSteamJogoHTML(e) ? '' : ' hidden'}>${tempoSteamJogoHTML(e)}</div>
            </div>
          </div>
        </div>
      </div>
      <div id="painel-resto"></div>`;
    fundoDesfocado($('.painel-capa'), visivel);
    carregarTrailerPainel(f);
    carregarSteamDoJogo().then(() => { if (estado.painelId === f.id) atualizarBotaoSteamJogo(f); });
    trazerImagensSteamJogo(f);
  } else {
    atualizarBotaoSteamJogo(f);
    atualizarStatusPaginaJogo(f);
  }

  const fichas = [
    ['Desenvolvimento', nomesJogo(f.desenvolvedores)],
    ['Publicação', nomesJogo(f.publicadoras)],
    ['Modos', (f.modos || []).join(', ')],
    ['Lançamento', f.lancamento ? diaLegivel(f.lancamento, { comAno: true }) : ''],
  ].filter(([, v]) => v);
  $('#painel-resto').innerHTML = `
    <div class="painel-corpo pj-corpo">
      <div class="pj-principal">
        ${f.externo ? foraDaListaHTML(f) : ''}
        ${f.sinopse ? `<section><h3 class="pcf-rotulo">Sobre</h3><p class="painel-sinopse">${esc(f.sinopse)}</p></section>` : ''}
        ${f.externo ? '' : usuarioJogoHTML(f)}
        ${capturasPaginaJogoHTML(f)}
      </div>
      <aside class="pj-lado">
        ${ondeJogarPaginaHTML(f, e)}
        ${fichas.length ? `<section><dl class="pcf-ficha pj-ficha">${fichas.map(([r, v]) => `<dt>${r}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>` : ''}
        ${reguaHltbHTML(f, e)}
      </aside>
    </div>
    <div id="painel-relacionados"></div>
    ${f.externo ? '' : `<div class="painel-rodape pj-rodape"><span></span><button class="btn btn-perigo" data-p="excluir">${icone('Trash2')} Remover da lista</button></div>`}`;
  carregarMaisDoDesenvolvedor(f);
  procurarHltbJogo(f);
}

if (typeof document !== 'undefined' && document.getElementById('painel')) {
  const painelDoJogoPc = document.getElementById('painel');
  painelDoJogoPc.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-j]');
    const f = estado.painelId ? porId(estado.painelId) : null;
    if (!b || !ehJogo(f)) return;
    if (b.dataset.j === 'status-menu') {
      const menu = b.parentElement.querySelector('.pj-status-menu');
      const abrir = menu.hidden;
      menu.hidden = !abrir;
      b.setAttribute('aria-expanded', String(abrir));
      if (abrir) (menu.querySelector('.atual') || menu.querySelector('button'))?.focus({ preventScroll: true });
    } else if (b.dataset.j === 'status') {
      fecharMenuStatusJogo();
      if (b.dataset.status !== f.status) mudarStatusJogo(f, b.dataset.status);
    } else if (b.dataset.j === 'captura') {
      abrirVisor(capturasJogoValidas(f), Number(b.dataset.i) || 0);
    }
  });
  // O dia em que zerou (no menu do status) muda o texto do seletor.
  painelDoJogoPc.addEventListener('change', (ev) => {
    if (!ev.target.matches('.pj-status [data-j-zerado]')) return;
    const f = estado.painelId ? porId(estado.painelId) : null;
    if (ehJogo(f)) setTimeout(() => { const s = document.querySelector('#painel .pj-status-rot small'); if (s) s.textContent = textoStatusJogo(f).detalhe; }, 0);
  });
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.pj-status')) fecharMenuStatusJogo(); }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !document.querySelector('#painel .pj-status-menu:not([hidden])')) return;
    ev.stopImmediatePropagation();
    fecharMenuStatusJogo();
    document.querySelector('#painel [data-j="status-menu"]')?.focus({ preventScroll: true });
  }, true);
}
