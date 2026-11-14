'use strict';

// ---------- Destaque da tela inicial: as partes do visual novo ----------
//
// O destaque (app.js, mostrarDestaque) é montado com estas peças: a linha de dados, as
// notas com o serviço onde assistir, os botões e o objeto do sorteio à direita (ingresso
// no nandflix, nandchan e nandhub; cartucho no nandplay). No sorteio, as capas giram na
// janela do objeto, o destaque só escurece e depois troca (destaqueGirar).
// Carregado antes do app.js: tudo aqui é chamado depois que os outros arquivos carregaram.

const destaqueEhCartucho = () => plataformaAtual().id === 'nandplay';

// "13 de nov." (com o ano quando não é o atual).
function destaqueDataCurta(data) {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  const opcoes = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opcoes.year = 'numeric';
  return d.toLocaleDateString('pt-BR', opcoes);
}

// Há quantos dias o item está na lista (null sem a data).
function destaqueDiasNaLista(f) {
  const t = Date.parse(f.adicionadoEm || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// ---- Linha de dados: ano em negrito, duração, gêneros, direção ----

function destaqueMetaHTML(f) {
  if (ehJogo(f)) return destaqueHudJogoHTML(f);
  const partes = [];
  if (ehSerie(f)) {
    const eps = Number(f.episodios) || 0;
    if (eps) partes.push(`${eps} episódio${eps === 1 ? '' : 's'}`);
  } else if (duracaoDe(f)) partes.push(duracaoDe(f));
  const g = generos(f.info);
  if (g.length) partes.push(g.slice(0, 2).join(', '));
  const quem = f.diretor || f.estudio || '';
  if (quem) partes.push(quem);
  return (f.ano ? `<b>${esc(f.ano)}</b>` : '') + partes.map((p) => `<span>${esc(p)}</span>`).join('');
}

// ---- Jogo: tempo de jogo, jogado por último e para zerar (o que a Steam e a IGDB dizem) ----

const destaqueContextoSteam = () => ({ local: steamDaLista.local, biblioteca: steamDaLista.biblioteca, celular: api.plataforma === 'android' });

function destaqueHudJogoHTML(f) {
  const conta = contaSteamDoJogo(f);
  const blocos = [];
  if (conta) {
    const tempo = tempoDeJogoSteam(conta.minutos);
    blocos.push(`<div class="principal"><small>Tempo de jogo</small><b>${tempo ? esc(tempo) : 'Ainda não jogou'}</b></div>`);
    const ultima = tempo && conta.ultimaVez ? destaqueDataCurta(conta.ultimaVez) : '';
    if (ultima) blocos.push(`<div><small>Jogado por último</small><b>${esc(ultima)}</b></div>`);
  }
  if (horasLegiveis(f.tempoZerar)) blocos.push(`<div><small>Para zerar</small><b>${esc(horasLegiveis(f.tempoZerar))}</b></div>`);
  if (blocos.length) return `<div class="destaque-hud">${blocos.join('')}</div>`;
  // Sem nada da Steam nem da IGDB: ano, gêneros e quem fez.
  const partes = [(f.generos || []).slice(0, 2).join(', '), desenvolvedoresDoJogo(f).slice(0, 2).join(', ')].filter(Boolean);
  return (f.ano ? `<b>${esc(f.ano)}</b>` : '') + partes.map((p) => `<span>${esc(p)}</span>`).join('');
}

// ---- Notas e onde assistir (o logotipo do serviço vem do TMDB) ----

function destaqueOndeHTML(f) {
  if (ehJogo(f)) return '';
  // Anime: as plataformas oficiais da AniList (só o nome; a AniList não dá o logotipo).
  if (ehSerie(f) || (f.anime && Array.isArray(f.ondeAssistir) && f.ondeAssistir.length)) {
    const l = (f.ondeAssistir || []).filter(plataformaVisivel)[0];
    return l && /^https:\/\//i.test(l.url || '') ? `<button type="button" class="destaque-onde" data-link="${esc(l.url)}" title="Abrir em ${esc(l.site)}">${esc(l.site)}</button>` : '';
  }
  const meus = meusServicos();
  const s = servicosDoFilme(f).sort((a, b) => Number(meus.has(Number(b.id))) - Number(meus.has(Number(a.id))))[0];
  const ex = extrasDoPais(f) || {};
  if (!s) return ex.cinema === 'agora' ? `<span class="destaque-onde">${icone('Clapperboard')}Nos cinemas</span>` : '';
  const link = (ex.onde && ex.onde.link) || (f.tmdbId ? `https://www.themoviedb.org/movie/${f.tmdbId}/watch?locale=${paisOnde()}` : '');
  return `<button type="button" class="destaque-onde" data-link="${esc(link)}" title="${esc(s.nome)}${meus.has(Number(s.id)) ? ' (você assina)' : ''}">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : ''}${esc(s.nome)}</button>`;
}

// O jogo não tem linha de notas: os números dele são os da Steam (tempo de jogo).
const destaqueNotasHTML = (f) => (ehJogo(f) ? '' : notasHTML(f.info, f) + destaqueOndeHTML(f));

// ---- Botões ----

function destaqueEstadoSteam(f) { return estadoBotaoSteam(f, destaqueContextoSteam()); }

function destaqueBotoesHTML(f) {
  const sortearB = `<button class="btn btn-vidro btn-sortear" data-d="sortear">${icone('Dices')}Sortear outro</button>`;
  if (ehJogo(f)) {
    const e = destaqueEstadoSteam(f);
    // Jogar e Instalar são do jogo que você tem; a loja fica ao lado. Sem o jogo, a loja é o botão principal.
    const tem = e.tipo === 'steam' && (e.acao === 'jogar' || e.acao === 'instalar');
    const principal = tem
      ? `<button class="btn btn-primario btn-jogar" data-d="steam" title="${esc(e.dica)}">${e.acao === 'jogar' ? icone('Play', { preenchido: true }) : icone('Download')}${esc(e.rotulo)}</button>`
      : e.tipo === 'steam'
        ? `<button class="btn btn-primario btn-steam" data-d="steam" title="${esc(e.dica)}">${MARCA_STEAM_JOGO}${e.acao === 'abrir' ? 'Abrir na Steam' : 'Ver na Steam'}</button>`
        : `<button class="btn btn-primario" data-d="steam" title="${esc(e.dica)}">${icone(e.icone)}${esc(e.rotulo)}</button>`;
    const loja = tem ? `<button class="btn btn-vidro btn-steam" data-d="steam-loja" title="Abre a página do jogo na loja da Steam">${MARCA_STEAM_JOGO}Ver na Steam</button>` : '';
    return principal + loja + sortearB;
  }
  const tituloFav = f.favorito ? 'Tirar dos favoritos' : 'Favoritar';
  return `<button class="btn btn-primario btn-trailer" data-d="trailer">${icone('Play', { preenchido: true })}<span>Ver trailer</span></button>
    <button class="btn btn-vidro${f.visto ? ' visto-on' : ''}" data-d="visto" aria-pressed="${Boolean(f.visto)}" title="${f.visto ? 'Desmarcar visto' : 'Marcar como visto'}">${icone('Check')}<span>${f.visto ? 'Visto' : 'Já vi'}</span></button>
    <button class="btn btn-vidro btn-quadrado${f.favorito ? ' fav-on' : ''}" data-d="favorito" aria-pressed="${Boolean(f.favorito)}" title="${tituloFav}" aria-label="${tituloFav}">${icone('Heart', { preenchido: Boolean(f.favorito) })}</button>
    ${sortearB}`;
}

// O botão principal do jogo (nunca monta o link aqui: o processo principal monta).
async function destaqueUsarSteam(f, { loja = false } = {}) {
  if (!f) return;
  const e = destaqueEstadoSteam(f);
  if (e.tipo !== 'steam') { abrirLinkJogo(e.url); return; }
  const acao = loja ? (e.acao === 'web' ? 'web' : 'loja') : e.acao;
  const r = await api.abrirSteam(e.appid, acao);
  if (r && r.ok === false) { aviso('Não deu para abrir a Steam.', { tipo: 'erro' }); return; }
  if (acao === 'jogar' && (!f.status || f.status === 'quero') && typeof mudarStatusJogo === 'function') {
    aviso(`Abrindo “${f.titulo}” na Steam.`, { tipo: 'ok', duracao: 7000, acao: { rotulo: 'Marcar como jogando', fn: () => mudarStatusJogo(f, 'jogando') } });
  }
}

// A biblioteca da Steam chegou (ou mudou): refaz os números e os botões do jogo no destaque.
function destaqueAtualizarSteam() {
  const el = document.getElementById('destaque');
  const f = porId(filmeNoDestaque());
  if (!el || !f || !ehJogo(f) || el.classList.contains('sorteando')) return;
  const meta = el.querySelector('[data-info="meta"]');
  const botoes = el.querySelector('.destaque-botoes');
  if (meta) meta.innerHTML = destaqueMetaHTML(f);
  if (botoes) botoes.innerHTML = destaqueBotoesHTML(f);
}

// ---- O objeto do sorteio: ingresso ou cartucho ----

// O número da sessão: quantos você já viu nesta plataforma, mais este.
const destaqueSessao = () => itensDaPlataforma().filter((f) => f.visto).length + 1;

function bilheteFilaTexto(f, cartucho) {
  if (f.visto) return ehJogo(f) ? 'Já zerado' : 'Já visto';
  const dias = destaqueDiasNaLista(f);
  if (dias === null) return '';
  const onde = cartucho || ehJogo(f) ? 'Na lista' : 'Na fila';
  return dias === 0 ? `${onde} desde hoje` : `${onde} há ${dias.toLocaleString('pt-BR')} dia${dias === 1 ? '' : 's'}`;
}

function bilheteHTML(f) {
  const cartucho = destaqueEhCartucho();
  const fila = bilheteFilaTexto(f, cartucho);
  const hojeTexto = `Hoje, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
  return `<div class="bilhete ${cartucho ? 'cartucho' : 'ingresso'}" id="bilhete" data-d="detalhes" title="Mais informações" aria-live="polite">
      <div class="bilhete-corpo">
        <div class="bilhete-janela">${capaHTML(f, { tamanho: 'grande' })}</div>
        <div class="bilhete-info">
          <div><span class="bilhete-topo">${cartucho ? 'Jogador 1' : 'Admite um'}</span><span class="bilhete-titulo muda">${esc(f.titulo)}</span></div>
          <div class="muda">${fila ? `<span class="bilhete-sub">${esc(fila)}</span>` : ''}${cartucho ? '' : `<span class="bilhete-sub">${esc(hojeTexto)}</span>`}</div>
        </div>
      </div>
      <div class="bilhete-canhoto">${cartucho ? '' : `<span class="vert">Sessão</span><b data-num>${destaqueSessao()}</b>`}</div>
    </div>`;
}

// ---- A arte do fundo ----

// A arte em paisagem: a do jogo já vem no item; a do filme é buscada no TMDB na primeira vez.
// Enquanto não chega (ou se não existir), fica a capa desfocada de sempre.
const destaqueArtesPedidas = new Map();
function destaqueArteDe(f) {
  if (!f) return Promise.resolve('');
  if (f.fundo) return Promise.resolve(f.fundo);
  if (ehJogo(f) || f.fundoEm || typeof api.fundoFilme !== 'function') return Promise.resolve('');
  if (!destaqueArtesPedidas.has(f.id)) {
    destaqueArtesPedidas.set(f.id, Promise.resolve(api.fundoFilme(f.id)).then((url) => {
      if (url) f.fundo = url; else destaqueArtesPedidas.delete(f.id);
      return url || '';
    }, () => { destaqueArtesPedidas.delete(f.id); return ''; }));
  }
  return destaqueArtesPedidas.get(f.id);
}

// Põe a arte no destaque quando ela termina de carregar (sem piscar: aparece por cima da capa desfocada).
async function destaquePorArte(el, f, valido) {
  const url = await destaqueArteDe(f);
  if (!url || !valido()) return;
  const img = new Image();
  img.onload = () => {
    const arte = el.querySelector('.destaque-fundo-arte');
    if (!arte || !valido()) return;
    arte.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    arte.classList.add('visivel');
  };
  img.src = url;
}

// ---- O giro ----

const DESTAQUE_GIRO_MS = 3000;
let destaqueGiro = 0; // muda a cada giro (e a cada vez que o destaque é refeito por outro motivo)
const destaqueGirando = () => document.getElementById('destaque').classList.contains('sorteando');
function destaqueCancelarGiro() { destaqueGiro++; }

// Dá para girar? Precisa de um destaque desta plataforma na tela, com o objeto visível, e das animações ligadas.
function destaquePodeGirar() {
  const el = document.getElementById('destaque');
  const b = el && el.querySelector('.bilhete');
  // Ao trocar de plataforma o destaque muda direto (o objeto e as cores são outros).
  if (!b || el.dataset.plataforma !== plataformaAtual().id) return false;
  return b.offsetParent !== null && !document.documentElement.classList.contains('celular') && !Movimento.desligado();
}

// `f`: o sorteado (já é o do destaque em estado.historico); `capas`: de onde saem as que passam
// girando. O destaque antigo fica na tela, mais escuro, até o giro parar; aí `aoParar` troca.
function destaqueGirar(f, capas, aoParar) {
  const el = document.getElementById('destaque');
  const bilhete = el.querySelector('.bilhete');
  const janela = bilhete.querySelector('.bilhete-janela');
  const giro = ++destaqueGiro;
  const final = srcCapa(f);
  const pool = capas.filter((c) => c && c !== final);
  const fotos = [];
  for (let i = 0; i < 28 && pool.length; i++) fotos.push(pool[Math.floor(Math.random() * pool.length)]);
  if (!final || !fotos.length) { aoParar(); return; }
  fotos.push(final);
  el.classList.add('sorteando');
  bilhete.classList.add('girando');
  // A primeira "foto" é a capa que já estava na janela.
  const rolo = document.createElement('div');
  rolo.className = 'bilhete-rolo';
  const atual = janela.querySelector('img');
  rolo.innerHTML = (atual ? `<img src="${esc(atual.currentSrc || atual.src)}" alt="">` : '') + fotos.map((p) => `<img src="${esc(p)}" alt="">`).join('');
  const passos = rolo.children.length - 1;
  janela.replaceChildren(rolo);
  const altura = janela.clientHeight;
  rolo.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${passos * altura}px)` }],
    { duration: DESTAQUE_GIRO_MS, easing: 'cubic-bezier(.12,.75,.16,1)', fill: 'forwards' });
  // O número da sessão embaralha enquanto gira.
  const num = bilhete.querySelector('[data-num]');
  const certo = num ? num.textContent : '';
  const t0 = performance.now();
  (function conta() {
    if (!num || giro !== destaqueGiro || !num.isConnected) return;
    if (performance.now() - t0 < DESTAQUE_GIRO_MS - 200) { num.textContent = String(Math.floor(Math.random() * 999) + 1); requestAnimationFrame(conta); } else num.textContent = certo;
  })();
  setTimeout(() => {
    if (giro !== destaqueGiro) return; // o destaque foi refeito no meio do giro
    el.classList.remove('sorteando');
    aoParar();
  }, DESTAQUE_GIRO_MS + 150);
}

// Trocou de plataforma com o mesmo item no destaque: o objeto muda (ingresso ou cartucho) e a sessão é recontada.
document.addEventListener('plataforma', () => {
  const el = document.getElementById('destaque');
  const atual = el && el.querySelector('.bilhete');
  const f = typeof filmeNoDestaque === 'function' ? porId(filmeNoDestaque()) : null;
  if (!atual || !f || destaqueGirando()) return;
  atual.outerHTML = bilheteHTML(f);
});
