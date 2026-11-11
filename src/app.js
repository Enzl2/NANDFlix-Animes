'use strict';

// `api` é a ponte global exposta pelo preload.js.
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const MAC = api.plataforma === 'darwin';

const estado = {
  filmes: [],
  config: {},
  filtro: 'todos',
  busca: '',
  diretor: '', // "filmes do mesmo diretor", escolhido no painel
  pais: '', // filtro de país, escolhido no cabeçalho do grupo ou no painel
  lista: '', // filtro por uma das listas da pessoa (listas.js)
  ordenacao: 'ordem',
  vista: 'grade',
  painelId: null,
  buscandoCapas: false,
  historico: [], // ids sorteados, navegáveis no carrossel do destaque
  indiceDestaque: -1,
  som: false, // trailers começam mudos
};

const principal = $('#principal');
Movimento.iniciar(principal);
const rolarTopo = () => principal.scrollTo({ top: 0 });
const comportamentoRolagem = () => (Movimento.reduzido.matches ? 'auto' : 'smooth');
// Ao pesquisar ou filtrar, leva até "Todos os filmes" (descontando o topo, que flutua por cima).
function rolarParaLista() {
  const alvo = $('#secao-todos').offsetTop - $('#topo').offsetHeight - 8;
  principal.scrollTo({ top: Math.max(alvo, 0), behavior: comportamentoRolagem() });
}

// O topo é transparente sobre o destaque e ganha fundo ao rolar (ou quando não há destaque).
function atualizarTopo() {
  $('#topo').classList.toggle('rolado', principal.scrollTop > 24 || $('#secao-sorteado').hidden);
}
principal.addEventListener('scroll', atualizarTopo, { passive: true });

// Troca de filtro, ordem ou vista: a lista some de leve e volta (sem repetir as revelações).
function cruzarLista() {
  Movimento.animar($('#lista'), [{ opacity: 1 }, { opacity: 0.4, offset: 0.4 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
}


// ---------- Utilidades ----------

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlParaNo(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").toLowerCase();
}

// Filmes de fora da lista abertos nos detalhes (vindos de "Outros filmes do
// diretor" ou "Mais como este"), com id "tmdb-<id>". Não são salvos.
const filmesExternos = new Map();

function porId(id) {
  return estado.filmes.find((f) => f.id === id) || filmesExternos.get(id);
}

function anoNumero(ano) {
  const m = String(ano).match(/\d{4}/);
  return m ? Number(m[0]) : Infinity;
}

function meta(f) {
  return [f.ano, f.diretor].filter(Boolean).join(' · ');
}

function aviso(texto, { tipo = '', duracao = 3500, acao } = {}) {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.innerHTML = `<span>${esc(texto)}</span>`;
  if (acao) {
    const b = document.createElement('button');
    b.textContent = acao.rotulo;
    b.onclick = () => { el.remove(); acao.fn(); };
    el.append(b);
  }
  $('#avisos').append(el);
  if (duracao) setTimeout(() => el.remove(), duracao);
  return el;
}

// ---------- Capas ----------

function srcCapa(f) {
  if (f.capaLocal) return `capa://img/${f.capaLocal}`;
  return f.poster || '';
}

// Título do filme no destaque e nos detalhes: a logo do TMDB (arte do título,
// como na Netflix) quando houver; senão, o texto.
function srcLogo(f) {
  if (f.logoLocal) return `capa://img/${f.logoLocal}`;
  return f.logo || '';
}
function tituloHTML(f) {
  const src = srcLogo(f);
  return src
    ? `<h2 class="titulo-logo"><img src="${esc(src)}" alt="${esc(f.titulo)}" title="${esc(f.titulo)}" data-titulo-texto="${esc(f.titulo)}"></h2>`
    : `<h2>${esc(f.titulo)}</h2>`;
}
// Se a logo não carregar, volta para o título em texto.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.tituloTexto) return;
  const h2 = img.closest('h2');
  h2.classList.remove('titulo-logo');
  h2.textContent = img.dataset.tituloTexto;
}, true);

function capaHTML(f, { tamanho = 'normal' } = {}) {
  const src = srcCapa(f);
  const vazia = `<div class="capa-vazia"><strong>${esc(f.titulo)}</strong><span>${esc(f.ano)}</span></div>`;
  const img = src
    ? `<img src="${esc(src)}" alt="" loading="${tamanho === 'grande' ? 'eager' : 'lazy'}" decoding="async" data-remoto="${esc(f.poster)}" data-titulo="${esc(f.titulo)}" data-ano="${esc(f.ano)}">`
    : vazia;
  // NANDRoll: séries em andamento mostram o progresso na capa.
  return `<div class="capa">${img}${seloSerieHTML(f)}</div>`;
}

// Se a capa local sumir, tenta a URL original; se também falhar, mostra o quadro com o título.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.capa')) return;
  const remoto = img.dataset.remoto;
  if (remoto && img.src !== remoto && navigator.onLine) {
    img.src = remoto;
    return;
  }
  const vazia = document.createElement('div');
  vazia.className = 'capa-vazia';
  vazia.innerHTML = `<strong>${esc(img.dataset.titulo)}</strong><span>${esc(img.dataset.ano)}</span>`;
  img.replaceWith(vazia);
}, true);

// ---------- Países ----------

// O TMDB (e o OMDb) dá os países em inglês ("United States, Canada"), o principal primeiro.
// Aqui viram português pelo Intl; a tabela cobre o que ele não reconhece.
const PAISES_ESPECIAIS = {
  'Soviet Union': 'União Soviética', 'West Germany': 'Alemanha Ocidental', 'East Germany': 'Alemanha Oriental',
  Czechoslovakia: 'Tchecoslováquia', Yugoslavia: 'Iugoslávia', 'Federal Republic of Yugoslavia': 'Iugoslávia',
  'Serbia and Montenegro': 'Sérvia e Montenegro', 'Hong Kong': 'Hong Kong', Macao: 'Macau', 'Czech Republic': 'Tchéquia',
  'Republic of North Macedonia': 'Macedônia do Norte', UK: 'Reino Unido', USA: 'Estados Unidos',
  'Ivory Coast': 'Costa do Marfim', Burma: 'Mianmar', Korea: 'Coreia do Sul',
  // Nomes do TMDB que o Intl não reconhece
  'United States of America': 'Estados Unidos', 'Northern Ireland': 'Irlanda do Norte', Turkey: 'Turquia',
};
const codigosPais = (() => {
  const mapa = new Map();
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const codigo = String.fromCharCode(65 + i, 65 + j);
        const nome = en.of(codigo);
        if (nome && nome !== codigo) mapa.set(nome.toLowerCase(), codigo);
      }
    }
  } catch { /* sem Intl.DisplayNames: os países ficam em inglês */ }
  return mapa;
})();
const nomesPaisPt = (() => { try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { return null; } })();
const traducoesPais = new Map();
function paisEmPortugues(nome) {
  if (!traducoesPais.has(nome)) {
    const codigo = codigosPais.get(nome.toLowerCase());
    traducoesPais.set(nome, PAISES_ESPECIAIS[nome] || (codigo && nomesPaisPt ? nomesPaisPt.of(codigo) : nome));
  }
  return traducoesPais.get(nome);
}
const paisesDe = (f) => (f.info && f.info.pais
  ? f.info.pais.split(',').map((p) => p.trim()).filter((p) => p && p !== 'N/A').map(paisEmPortugues)
  : []);
const paisPrincipal = (f) => paisesDe(f)[0] || '';
// No painel cada país é um link que filtra a lista por ele.
const paisesHTML = (f) => paisesDe(f).map((p) => `<button class="link-pais" data-p="pais" data-pais="${esc(p)}" title="Ver só os filmes deste país">${esc(p)}</button>`).join(', ');

// ---------- Lista ----------

// "Joel Coen, Ethan Coen" → ['joel coen', 'ethan coen'] (codirigidos contam para os dois).
const diretoresDe = (texto) => normalizar(texto || '').split(/\s*(?:,|;|\/|&|\be\b|\band\b)\s*/).map((d) => d.trim()).filter(Boolean);

function filtrados() {
  const termo = normalizar(estado.busca.trim());
  const palavras = termo.split(/\s+/).filter(Boolean);
  const diretores = diretoresDe(estado.diretor);
  let lista = estado.filmes.filter((f) => {
    if (estado.filtro === 'nao-vistos' && f.visto) return false;
    if (estado.filtro === 'vistos' && !f.visto) return false;
    if (estado.filtro === 'favoritos' && !f.favorito) return false;
    if (!passaFiltroAnime(f, estado.filtro)) return false; // NANDRoll: 'animes' e 'assistindo'
    if (diretores.length && !diretoresDe(f.diretor).some((d) => diretores.includes(d))) return false;
    if (estado.pais && !paisesDe(f).includes(estado.pais)) return false;
    if (estado.lista && !listasDe(f).includes(estado.lista)) return false;
    if (!palavras.length) return true;
    const alvo = normalizar([f.titulo, f.ano, f.diretor, f.notas, f.buscaCapa, ...paisesDe(f)].join(' '));
    return palavras.every((p) => alvo.includes(p));
  });

  const comparaTitulo = (a, b) => a.titulo.localeCompare(b.titulo, 'pt', { sensitivity: 'base', numeric: true });
  // Agrupados: em ordem alfabética, e quem não tem a informação vai para o fim.
  const comparaGrupo = (x, y) => (x || '￿').localeCompare(y || '￿', 'pt', { sensitivity: 'base' });
  const ordens = {
    ordem: (a, b) => (a.ordem || 0) - (b.ordem || 0),
    titulo: comparaTitulo,
    ano: (a, b) => anoNumero(a.ano) - anoNumero(b.ano) || comparaTitulo(a, b),
    diretor: (a, b) => comparaGrupo((a.diretor || '').trim(), (b.diretor || '').trim()) || anoNumero(a.ano) - anoNumero(b.ano) || comparaTitulo(a, b),
    pais: (a, b) => comparaGrupo(paisPrincipal(a), paisPrincipal(b)) || anoNumero(a.ano) - anoNumero(b.ano) || comparaTitulo(a, b),
    recentes: (a, b) => String(b.adicionadoEm).localeCompare(String(a.adicionadoEm)) || (b.ordem || 0) - (a.ordem || 0),
  };
  return lista.sort(ordens[estado.ordenacao] || ordens.ordem);
}

function filtrarDiretor(diretor) {
  estado.diretor = diretor || '';
  fecharPainel();
  render();
  if (estado.diretor) rolarParaLista();
}

function filtrarPais(pais) {
  estado.pais = pais || '';
  fecharPainel();
  render();
  if (estado.pais) rolarParaLista();
}

// Ordenar por diretor ou por país separa a lista em grupos, cada um com um
// cabeçalho (nome e quantidade); clicar no nome filtra só aquele grupo.
const AGRUPAMENTOS = {
  diretor: { chave: (f) => (f.diretor || '').trim(), semChave: 'Diretor não informado', filtrar: filtrarDiretor, dica: 'Ver só os filmes deste diretor' },
  pais: {
    chave: paisPrincipal, semChave: 'País não informado', semChavePendente: 'País ainda não carregado',
    pendente: (f) => !f.tmdbEm, buscar: () => buscarCapas({ incluirNaoEncontradas: true }),
    filtrar: filtrarPais, dica: 'Ver só os filmes deste país',
  },
};

const cacheGrupos = new Map();
function cabecalhoGrupo(chave, fs, ag) {
  const id = `${estado.ordenacao}|${chave}`;
  let el = cacheGrupos.get(id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'grupo-cabecalho';
    if (chave) {
      el.innerHTML = `<button class="grupo-nome" title="${ag.dica}">${esc(chave)}</button><span class="grupo-contagem"></span>`;
      $('.grupo-nome', el).addEventListener('click', () => ag.filtrar(chave));
    }
    cacheGrupos.set(id, el);
  }
  // Grupo sem a informação: se ainda há filmes por buscar no TMDB, diz isso e
  // oferece buscar agora; senão o TMDB simplesmente não informa.
  if (!chave) {
    const pendentes = ag.pendente ? fs.some(ag.pendente) : false;
    if (el.dataset.pendentes !== String(pendentes)) {
      el.dataset.pendentes = String(pendentes);
      el.innerHTML = `<span class="grupo-nome">${pendentes ? ag.semChavePendente : ag.semChave}</span><span class="grupo-contagem"></span>${pendentes ? `<button class="btn btn-fantasma grupo-acao">${icone('RefreshCw')} Buscar agora</button>` : ''}`;
      if (pendentes) $('.grupo-acao', el).addEventListener('click', ag.buscar);
    }
  }
  const quantidade = fs.length;
  const texto = `${quantidade} filme${quantidade === 1 ? '' : 's'}`;
  const contagem = $('.grupo-contagem', el);
  if (contagem.textContent !== texto) contagem.textContent = texto;
  return el;
}

// Cartões da lista, com os cabeçalhos dos grupos quando a ordenação agrupa.
function itensDaLista(visiveis) {
  const ag = AGRUPAMENTOS[estado.ordenacao];
  if (!ag) return visiveis.map((f) => elementoCartao(f));
  const grupos = new Map();
  for (const f of visiveis) {
    const chave = ag.chave(f);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(f);
  }
  const itens = [];
  for (const [chave, fs] of grupos) itens.push(cabecalhoGrupo(chave, fs, ag), ...fs.map((f) => elementoCartao(f)));
  return itens;
}

// Botão e selo da watchlist de hoje (a "bolinha" do calendário na capa).
const tituloHoje = (naLista) => (naLista ? 'Tirar da watchlist de hoje' : 'Pensando em ver hoje');
const seloHojeHTML = () => `<span class="selo-hoje" title="Na watchlist de hoje">${icone('CalendarClock')}</span>`;

function cartaoHTML(f) {
  const tituloVisto = f.visto ? 'Desmarcar visto' : 'Marcar como visto';
  const tituloFav = f.favorito ? 'Tirar dos favoritos' : 'Favoritar';
  const hojeNaLista = naWatchlist(f.id);
  return `
    <article class="cartao${f.visto ? ' visto' : ''}" data-id="${f.id}" tabindex="0" aria-label="${esc(f.titulo)}${f.ano ? ` (${esc(f.ano)})` : ''}">
      <div class="capa-area">
        ${capaHTML(f)}
        ${f.visto ? `<span class="selo-visto" title="Visto">${icone('Check')}</span>` : ''}
        ${f.favorito ? `<span class="selo-fav" title="Favorito">${icone('Star', { preenchido: true })}</span>` : ''}
        ${hojeNaLista ? seloHojeHTML() : ''}
      </div>
      <div class="info">
        <h3 title="${esc(f.titulo)}"><span>${esc(f.titulo)}</span></h3>
        <p class="info-meta">${esc(meta(f))}</p>
        <span class="info-ano">${esc(f.ano)}</span>
        ${f.diretor ? `<button class="info-diretor" data-acao="diretor" title="Ver os filmes deste diretor na sua lista">${esc(f.diretor)}</button>` : ''}
      </div>
      <div class="acoes">
        <button class="acao${f.visto ? ' visto-on' : ''}" data-acao="visto" title="${tituloVisto}" aria-label="${tituloVisto}">${icone('Check')}</button>
        <button class="acao${f.favorito ? ' fav-on' : ''}" data-acao="favorito" title="${tituloFav}" aria-label="${tituloFav}">${icone('Star', { preenchido: f.favorito })}</button>
        <button class="acao${hojeNaLista ? ' hoje-on' : ''}" data-acao="hoje" title="${tituloHoje(hojeNaLista)}" aria-label="${tituloHoje(hojeNaLista)}">${icone('CalendarClock')}</button>
        <button class="acao acao-stremio" data-acao="stremio" title="Abrir no Stremio" aria-label="Abrir no Stremio">${icone('Play')}</button>
        ${ehSerie(f) ? acaoEpisodioHTML(f) : `<button class="acao acao-lb" data-acao="letterboxd" title="Abrir no Letterboxd" aria-label="Abrir no Letterboxd">${LB_PONTOS}</button>`}
      </div>
    </article>`;
}

// Reaproveita os elementos já criados: ao filtrar ou ordenar, só muda a ordem,
// e as capas já carregadas não piscam. A fileira de favoritos tem o próprio
// cache, porque um elemento não pode estar em dois lugares.
const cacheCartoes = new Map();
const cacheFileira = new Map();
// Visto, favorito e watchlist ficam fora da assinatura: mudam o cartão no lugar
// (ver atualizarCartao), sem recriar o elemento. Recriar tirava da página o
// botão que acabou de ser clicado e, com ele focado, o Chromium rolava a página.
function assinatura(f) {
  return [f.titulo, f.ano, f.diretor, f.capaLocal, f.poster].join('\u0001');
}
const estadoCartao = (f) => `${Boolean(f.visto)}|${Boolean(f.favorito)}|${naWatchlist(f.id)}|${estadoCartaoAnime(f)}`; // NANDRoll: progresso das séries

function atualizarCartao(el, f) {
  el.classList.toggle('visto', Boolean(f.visto));
  const area = $('.capa-area', el);
  $('.selo-visto', area)?.remove();
  $('.selo-fav', area)?.remove();
  $('.selo-hoje', area)?.remove();
  if (f.visto) area.insertAdjacentHTML('beforeend', `<span class="selo-visto" title="Visto">${icone('Check')}</span>`);
  if (f.favorito) area.insertAdjacentHTML('beforeend', `<span class="selo-fav" title="Favorito">${icone('Star', { preenchido: true })}</span>`);
  const hojeNaLista = naWatchlist(f.id);
  if (hojeNaLista) area.insertAdjacentHTML('beforeend', seloHojeHTML());
  const visto = $('.acao[data-acao="visto"]', el);
  const tituloVisto = f.visto ? 'Desmarcar visto' : 'Marcar como visto';
  visto.classList.toggle('visto-on', Boolean(f.visto));
  visto.title = tituloVisto;
  visto.setAttribute('aria-label', tituloVisto);
  const fav = $('.acao[data-acao="favorito"]', el);
  const tituloFav = f.favorito ? 'Tirar dos favoritos' : 'Favoritar';
  fav.classList.toggle('fav-on', Boolean(f.favorito));
  fav.title = tituloFav;
  fav.setAttribute('aria-label', tituloFav);
  fav.innerHTML = icone('Star', { preenchido: f.favorito });
  const botaoHoje = $('.acao[data-acao="hoje"]', el);
  botaoHoje.classList.toggle('hoje-on', hojeNaLista);
  botaoHoje.title = tituloHoje(hojeNaLista);
  botaoHoje.setAttribute('aria-label', tituloHoje(hojeNaLista));
  atualizarCartaoAnime(el, f); // NANDRoll
}

function elementoCartao(f, cache = cacheCartoes) {
  const sig = assinatura(f);
  const c = cache.get(f.id);
  if (c && c.sig === sig) {
    const atual = estadoCartao(f);
    if (c.estado !== atual) {
      atualizarCartao(c.el, f);
      c.estado = atual;
    }
    return c.el;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = cartaoHTML(f).trim();
  const el = tpl.content.firstElementChild;
  cache.set(f.id, { el, sig, estado: estadoCartao(f) });
  return el;
}

// Põe os cartões no contêiner só se algo mudou. Tirar da página o botão que
// está com foco (o que acabou de ser clicado) faz o Chromium rolar a página
// para outro lugar; por isso, se a lista mudar, o foco sai antes, sem rolar.
function trocarFilhos(conteiner, novos) {
  const atuais = conteiner.children;
  if (atuais.length === novos.length && novos.every((el, i) => atuais[i] === el)) return;
  const focado = document.activeElement;
  if (focado && conteiner.contains(focado)) {
    const cartao = focado.closest('.cartao');
    focado.blur();
    conteiner.replaceChildren(...novos);
    if (cartao && cartao.isConnected) focado.focus({ preventScroll: true });
    return;
  }
  conteiner.replaceChildren(...novos);
}

function renderFileira() {
  const fileira = $('#fileira');
  const favoritos = estado.filmes.filter((f) => f.favorito).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  $('#secao-favoritos').hidden = favoritos.length === 0;
  const vistosFav = favoritos.filter((f) => f.visto).length;
  $('#kicker-favoritos').textContent = `${favoritos.length} favorito${favoritos.length === 1 ? '' : 's'} · ${vistosFav} de ${favoritos.length} vistos`;
  trocarFilhos(fileira, favoritos.map((f) => elementoCartao(f, cacheFileira)));
  atualizarSetasFileira();
  Movimento.observar(fileira.children, 'fileira');
}

function atualizarSetasFileira() {
  const f = $('#fileira');
  $('#fileira-esq').disabled = f.scrollLeft <= 2;
  $('#fileira-dir').disabled = f.scrollLeft + f.clientWidth >= f.scrollWidth - 2;
}

// Rolagem fluida: a fileira desliza até o alvo desacelerando aos poucos. As
// setas andam uma "página" por vez, como na Netflix; o trackpad (ou Shift +
// roda do mouse) move o alvo e a fileira acompanha.
let alvoFileira = null;
function deslizarFileira(alvo) {
  const f = $('#fileira');
  const max = f.scrollWidth - f.clientWidth;
  const animando = alvoFileira !== null;
  alvoFileira = Math.max(0, Math.min(max, alvo));
  if (animando) return;
  let pos = f.scrollLeft;
  const passo = () => {
    const falta = alvoFileira - pos;
    if (Math.abs(falta) < 0.5) { f.scrollLeft = alvoFileira; alvoFileira = null; return; }
    pos += falta * 0.12;
    f.scrollLeft = pos;
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
function rolarFileira(direcao) {
  const f = $('#fileira');
  deslizarFileira((alvoFileira ?? f.scrollLeft) + direcao * (f.clientWidth - 160));
}
$('#fileira-esq').addEventListener('click', () => rolarFileira(-1));
$('#fileira-dir').addEventListener('click', () => rolarFileira(1));
$('#fileira').addEventListener('wheel', (e) => {
  const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
  if (!dx || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
  e.preventDefault();
  const f = $('#fileira');
  deslizarFileira((alvoFileira ?? f.scrollLeft) + dx * 2);
}, { passive: false });
$('#fileira').addEventListener('scroll', () => {
  atualizarSetasFileira();
  clearTimeout(timerPrevia);
  fecharPrevia();
}, { passive: true });
window.addEventListener('resize', atualizarSetasFileira);

let renderAgendado = false;
function agendarRender() {
  if (renderAgendado) return;
  renderAgendado = true;
  requestAnimationFrame(() => { renderAgendado = false; render(); });
}

function render() {
  aplicarNandroll(); // NANDRoll: chips de anime só com ele ligado
  const lista = $('#lista');
  const vazio = estado.filmes.length === 0;
  const vazioAntes = !$('#vazio').hidden;
  const semResultadosAntes = !$('#sem-resultados').hidden;
  $('#vazio').hidden = !vazio;
  $('#titulo-todos').hidden = vazio;
  $('#barra-ferramentas').hidden = vazio;
  $('#chip-diretor').hidden = !estado.diretor;
  $('#chip-diretor').innerHTML = `${icone('Film')}<span>${esc(estado.diretor)}</span>${icone('X')}`;
  $('#chip-pais').hidden = !estado.pais;
  $('#chip-pais').innerHTML = `${icone('Globe')}<span>${esc(estado.pais)}</span>${icone('X')}`;
  $('#chip-lista').hidden = !estado.lista;
  $('#chip-lista').innerHTML = `${icone('Tag')}<span>${esc(estado.lista || '')}</span>${icone('X')}`;
  $('#btn-listas').classList.toggle('ativo-leve', Boolean(estado.lista));
  if (vazio) $('#secao-sorteado').hidden = true;
  atualizarTopo();
  renderFileira();
  const visiveis = vazio ? [] : filtrados();
  $('#sem-resultados').hidden = vazio || visiveis.length > 0;
  lista.className = `lista ${estado.vista === 'lista' ? 'compacta' : 'grade'}`;
  trocarFilhos(lista, itensDaLista(visiveis));

  const total = estado.filmes.length;
  $('#contagem').textContent = vazio ? '' : (visiveis.length === total ? `${total} filmes` : `${visiveis.length} de ${total} filmes`);
  $('#sem-contagem').textContent = $('#contagem').textContent;
  // Buscou e nada da lista bate: oferece adicionar o filme, já com o texto buscado.
  const termoBusca = estado.busca.trim();
  const botaoAdicionar = $('#btn-sem-adicionar');
  botaoAdicionar.hidden = !termoBusca || visiveis.length > 0;
  if (!botaoAdicionar.hidden) botaoAdicionar.innerHTML = `${icone('Plus')} Adicionar “${esc(termoBusca)}”`;
  atualizarEstatisticas();

  // Estados que acabaram de aparecer entram em sequência; as capas se revelam ao rolar.
  if (vazio && !vazioAntes) {
    const v = $('#vazio');
    Movimento.sequencia([$('.vazio-rotulo', v), $('h2', v), $('.regua', v), $('.vazio-acoes', v)], { y: 12, duracao: 520, passo: 70 });
  }
  if (!$('#sem-resultados').hidden && !semResultadosAntes) {
    Movimento.animar($('#sem-resultados'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
  }
  Movimento.observar(lista.children, estado.vista === 'lista' ? 'lista' : 'grade');
}

function atualizarEstatisticas() {
  const total = estado.filmes.length;
  const vistos = estado.filmes.filter((f) => f.visto).length;
  const favs = estado.filmes.filter((f) => f.favorito).length;
  const pct = total ? Math.round((vistos / total) * 100) : 0;
  $('#est-vistos-texto').textContent = `${vistos} de ${total} vistos (${pct}%)`;
  $('#est-barra').style.width = `${total ? (vistos / total) * 100 : 0}%`;
  $('#est-fav').textContent = `${favs} favorito${favs === 1 ? '' : 's'}`;

  const semCapa = estado.filmes.filter((f) => !f.poster && !f.capaPersonalizada).length;
  const btn = $('#btn-capas-faltam');
  btn.hidden = !semCapa || estado.buscandoCapas;
  btn.innerHTML = `${icone('ImagePlus')}<span>Buscar capas que faltam (${semCapa})</span>`;
}

// ---------- Ações sobre filmes ----------

// ---------- Dias: histórico de vistos e watchlist de hoje ----------

// O dia vira às 5h: um filme visto de madrugada conta para a noite anterior,
// e a watchlist de hoje dura até as 5h do dia seguinte.
const HORA_VIRADA = 5;
function diaDe(data = new Date()) {
  const d = new Date(data.getTime() - HORA_VIRADA * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoje = () => diaDe();
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function diaLegivel(dia, { comAno = false } = {}) {
  const [a, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}${comAno ? ` de ${a}` : ''}`;
}

// Uma watchlist por dia: { 'AAAA-MM-DD': [ids] }. Valem hoje e os dias que vêm
// (arrastando um filme para outro dia no calendário); a de um dia que já passou
// some, mesmo que o filme não tenha sido visto.
function watchlists() {
  const c = estado.config;
  let w = c.watchlists && typeof c.watchlists === 'object' ? c.watchlists : {};
  // Formato antigo: uma lista só, a de um dia.
  if (c.watchlistHoje && c.watchlistHoje.dia && !w[c.watchlistHoje.dia]) w = { ...w, [c.watchlistHoje.dia]: c.watchlistHoje.ids || [] };
  return w;
}
function idsWatchlist(dia = hoje()) {
  if (dia < hoje()) return [];
  const ids = watchlists()[dia];
  return Array.isArray(ids) ? ids.filter((id) => porId(id)) : [];
}
const naWatchlist = (id) => idsWatchlist().includes(id);

function salvarWatchlist(ids, dia = hoje()) {
  const w = {};
  for (const [d, lista] of Object.entries(watchlists())) if (d >= hoje() && lista.length) w[d] = lista;
  if (ids.length) w[dia] = ids;
  else delete w[dia];
  estado.config.watchlists = w;
  delete estado.config.watchlistHoje;
  api.salvarConfig({ watchlists: w, watchlistHoje: null });
}

// Arrastar no calendário: para hoje ou um dia que vem, o filme passa para a
// watchlist daquele dia; para um dia que já passou, fica registrado como visto nele.
function moverWatchlist(id, de, para) {
  if (de === para) return;
  const f = porId(id);
  if (!f) return;
  salvarWatchlist(idsWatchlist(de).filter((x) => x !== id), de);
  if (para < hoje()) {
    f.visto = true;
    salvarVistoEm(f, [...(f.vistoEm || []), para]);
    aviso(`“${f.titulo}” registrado como visto em ${diaLegivel(para)}.`, { tipo: 'ok' });
    return;
  }
  const destino = idsWatchlist(para);
  if (!destino.includes(id)) salvarWatchlist([...destino, id], para);
  aviso(`“${f.titulo}” agora está na watchlist ${para === hoje() ? 'de hoje' : `de ${diaLegivel(para)}`}.`, { tipo: 'ok' });
  aposMudarDia(id);
}

function tirarDaWatchlist(id, dia) {
  salvarWatchlist(idsWatchlist(dia).filter((x) => x !== id), dia);
  aposMudarDia(id);
}

function alternarWatchlist(id) {
  const ids = idsWatchlist();
  const entra = !ids.includes(id);
  salvarWatchlist(entra ? [...ids, id] : ids.filter((x) => x !== id));
  const f = porId(id);
  aviso(entra ? `“${f.titulo}” está na sua watchlist de hoje.` : `“${f.titulo}” saiu da watchlist de hoje.`, {
    tipo: 'ok',
    acao: entra ? { rotulo: 'Ver calendário', fn: () => abrirCalendario(hoje()) } : undefined,
  });
  aposMudarDia(id);
}

// Redesenha o que mostra visto, datas ou watchlist depois de uma mudança.
function aposMudarDia(id) {
  agendarRender();
  if (estado.painelId === id) renderPainel();
  if (previaId === id) atualizarBotaoHojePrevia();
  if (!calendario.hidden) renderCalendario();
  if (!tierlist.hidden && !arrastoTl) renderTierlist();
  if (typeof paginasTela !== 'undefined' && !paginasTela.hidden) renderListaPaginas();
}

// Grava as datas de um filme (cada vez que foi visto conta).
async function salvarVistoEm(f, dias) {
  f.vistoEm = [...dias].sort();
  aposMudarDia(f.id);
  const novo = await api.atualizarFilme(f.id, { vistoEm: f.vistoEm, visto: f.visto });
  if (novo && ehSerie(f)) { Object.assign(f, novo); aposMudarDia(f.id); } // NANDRoll
}

// "Vi de novo hoje": mais uma data para um filme que já foi visto antes.
function viHoje(id) {
  const f = porId(id);
  const dias = f.vistoEm || [];
  if (dias.includes(hoje())) return;
  f.visto = true;
  if (naWatchlist(id)) salvarWatchlist(idsWatchlist().filter((x) => x !== id));
  salvarVistoEm(f, [...dias, hoje()]);
  aviso(`“${f.titulo}” marcado como visto hoje.`, { tipo: 'ok' });
}

async function alternar(id, campo, valor) {
  const f = porId(id);
  if (!f) return;
  f[campo] = valor ?? !f[campo];
  const mudancas = { [campo]: f[campo] };
  if (campo === 'visto') {
    // Marcar grava o dia de hoje (e tira da watchlist); desmarcar desfaz o de hoje.
    const dias = [...(f.vistoEm || [])];
    if (f.visto) {
      if (!dias.includes(hoje())) dias.push(hoje());
      if (naWatchlist(id)) salvarWatchlist(idsWatchlist().filter((x) => x !== id));
    } else {
      const i = dias.lastIndexOf(hoje());
      if (i >= 0) dias.splice(i, 1);
    }
    f.vistoEm = dias.sort();
    mudancas.vistoEm = f.vistoEm;
  }
  aposMudarDia(id);
  const novo = await api.atualizarFilme(id, mudancas);
  // NANDRoll: numa série, o ✓ muda também o status e os episódios.
  if (novo && ehSerie(f)) { Object.assign(f, novo); aposMudarDia(id); }
}

async function abrirStremio(id, { stremio = false } = {}) {
  // NANDRoll: o Assistir de um anime abre a plataforma oficial, se houver.
  if (!stremio && await assistirAnime(id)) return;
  const r = await api.abrirStremio(id);
  if (r.semApp) {
    const escolha = await perguntar({
      titulo: 'Stremio não encontrado',
      texto: 'Não encontrei o app do Stremio instalado neste computador. Quer abrir o filme no Stremio Web?',
      botoes: [
        { rotulo: 'Cancelar', valor: null, classe: 'btn-fantasma' },
        { rotulo: 'Sempre usar o Stremio Web', valor: 'sempre' },
        { rotulo: 'Abrir no Stremio Web', valor: 'web', classe: 'btn-laranja' },
      ],
    });
    if (escolha === 'sempre') {
      estado.config = await api.salvarConfig({ stremio: 'web' });
      aviso('Pronto: o ▶ Stremio vai abrir a versão web. Dá para mudar em Configurações.', { tipo: 'ok' });
    }
    if (escolha) await api.abrirStremio(id, true);
  }
}

function abrirLetterboxd(id) {
  return api.abrirLetterboxd(id);
}

// ---------- Painel de detalhes ----------

// `voltarPara`: o filme de onde se veio (pelas fileiras de relacionados), para o
// botão "Voltar" dos detalhes.
function abrirPainel(id, { voltarPara = null } = {}) {
  fecharPrevia();
  const jaAberto = Boolean(estado.painelId);
  estado.painelAnterior = voltarPara && voltarPara !== id && porId(voltarPara) ? voltarPara : null;
  estado.painelId = id;
  renderPainel();
  const painel = $('#painel');
  painel.classList.add('aberto');
  painel.setAttribute('aria-hidden', 'false');
  $('#painel-fundo').classList.add('aberto');
  painel.scrollTop = 0;
  if (jaAberto) {
    // Trocou de filme com o painel aberto: só cruza o conteúdo.
    Movimento.animar($('#painel-conteudo'), [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  } else {
    Movimento.animar($('.painel-capa', painel), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 450, delay: 120, fill: 'backwards' });
  }
  $('[data-p="fechar"]', painel).focus({ preventScroll: true });
}

// Tab e Shift+Tab ficam dentro do painel enquanto ele está aberto.
$('#painel').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !estado.painelId) return;
  const focaveis = $$('button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])', $('#painel'));
  if (!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
});

function fecharPainel() {
  if (!estado.painelId) return;
  const id = estado.painelId;
  estado.painelId = null;
  pararTrailerPainel();
  $('#painel').classList.remove('aberto');
  $('#painel').setAttribute('aria-hidden', 'true');
  $('#painel-fundo').classList.remove('aberto');
  const cartao = $(`.cartao[data-id="${id}"]`);
  if (cartao) cartao.focus({ preventScroll: true });
}

function renderPainel() {
  const f = porId(estado.painelId);
  if (!f) { fecharPainel(); return; }
  if (f.externo) { renderPainelExterno(f); return; }
  // Ao marcar visto/favorito o painel é redesenhado; o foco volta ao mesmo botão.
  const ativo = document.activeElement;
  const focoAntes = ativo && ativo.closest && ativo.closest('#painel [data-p]') ? ativo.dataset.p : null;
  queueMicrotask(() => {
    if (focoAntes && estado.painelId === f.id) $(`#painel [data-p="${focoAntes}"]`)?.focus({ preventScroll: true });
  });

  // O topo (trailer, capa e título) só é montado ao abrir outro filme: assim o
  // trailer não recomeça quando a pessoa marca visto ou favorito.
  const topo = $('#painel .painel-capa');
  if (topo && topo.dataset.id === f.id) {
    atualizarBotoesPainel(f);
  } else {
    $('#painel-conteudo').innerHTML = `
      <button class="redondo painel-fechar" data-p="fechar" aria-label="Fechar" title="Fechar (Esc)">${icone('X')}</button>
      ${botaoVoltarPainelHTML()}
      <div class="painel-capa" data-id="${f.id}">
        <div class="painel-fundo-video"><div class="destaque-fundo-capa"></div></div>
        <div class="painel-sombra"></div>
        <button class="btn-redondo painel-som" data-p="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
        <div class="painel-cabecalho">
          <div class="destaque-identidade">
            <div class="destaque-poster" data-p="trocar" title="Trocar capa (ou arraste uma imagem para cá)">${capaHTML(f, { tamanho: 'grande' })}</div>
            <div class="destaque-titulo">${tituloHTML(f)}</div>
          </div>
          <div class="painel-botoes">
            <button class="btn btn-assistir" data-p="stremio">${ICONE_PLAY} Assistir</button>
            <button class="btn painel-escrever-btn" data-p="pagina"></button>
            <button class="redondo" data-p="story" title="Criar story para o Instagram" aria-label="Criar story para o Instagram">${icone('ImagePlus')}</button>
            <button class="redondo" data-p="visto">${icone('Check')}</button>
            <button class="redondo" data-p="favorito"></button>
            <button class="redondo" data-p="hoje">${icone('CalendarClock')}</button>
            <button class="redondo" data-p="letterboxd" title="Abrir no Letterboxd" aria-label="Abrir no Letterboxd">${LB_PONTOS}</button>
            <button class="redondo" data-p="trailer" title="Ver o trailer em tela cheia" aria-label="Ver o trailer em tela cheia">${icone('Maximize')}</button>
          </div>
        </div>
      </div>
      <div id="painel-resto"></div>`;
    fundoDesfocado($('.painel-capa'), f);
    atualizarBotoesPainel(f);
    carregarTrailerPainel(f);
  }

  const serie = ehSerie(f); // NANDRoll: séries não têm Letterboxd nem busca de capa no TMDB
  const sinopse = f.info && f.info.sinopse ? f.info.sinopse : '';
  const elenco = f.info && f.info.elenco ? f.info.elenco.split(',').slice(0, 4).map((n) => n.trim()).join(', ') : '';
  const campo = (nome, rotulo, extra = '') =>
    `<div class="campo"><label for="c-${nome}">${rotulo}</label><input id="c-${nome}" data-campo="${nome}" value="${esc(f[nome])}" ${extra}></div>`;
  $('#painel-resto').innerHTML = `
    <div class="painel-corpo">
      <div>
        <p class="painel-meta" data-info="meta-painel">${painelMetaHTML(f)}</p>
        ${animeNoPainelHTML(f)}
        <div class="minha-nota-linha"><b>Sua nota</b>${estrelasHTML(f)}</div>
        <div class="painel-listas">${listasDoFilmeHTML(f)}</div>
        <div class="painel-vistos">${vistosEmHTML(f)}</div>
        ${paginaNoPainelHTML(f)}
        <div class="notas-linha">${notasHTML(f.info)}</div>
        <p class="painel-sinopse" data-info="sinopse-painel"${sinopse ? '' : ' hidden'}>${esc(sinopse)}</p>
      </div>
      <div class="painel-fichas">
        ${f.diretor ? `<p class="painel-ficha"><b>${serie ? 'Estúdio' : 'Direção'}:</b> <span>${esc(f.diretor)}</span></p>` : ''}
        <p class="painel-ficha" data-info="pais-painel"${paisesDe(f).length ? '' : ' hidden'}><b>País:</b> <span>${paisesHTML(f)}</span></p>
        <p class="painel-ficha" data-info="elenco-painel"${elenco ? '' : ' hidden'}><b>Elenco:</b> <span>${esc(elenco)}</span></p>
        <p class="painel-ficha" data-info="generos-painel"${generos(f.info).length ? '' : ' hidden'}><b>Gêneros:</b> <span>${esc(generos(f.info).join(', '))}</span></p>
        ${f.notas ? `<p class="painel-ficha"><b>Suas notas:</b> <span>${esc(f.notas)}</span></p>` : ''}
      </div>
    </div>
    <div id="painel-relacionados"></div>
    <div class="capa-acoes">
      <button class="btn btn-fantasma" data-p="baixar" title="Salvar a imagem da capa no computador">${icone('Download')} Baixar capa</button>
      <button class="btn btn-fantasma" data-p="arquivo" title="Usar uma imagem sua como capa (ou arraste a imagem para a capa)">${icone('FolderOpen')} Usar imagem minha</button>
    </div>
    <div class="painel-campos">
    ${campo('titulo', 'Título')}
    ${campo('ano', 'Ano')}
    <div class="campo">
      <label for="c-diretor">${serie ? 'Estúdio' : 'Diretor'}</label>
      <div class="campo-com-botoes">
        <input id="c-diretor" data-campo="diretor" value="${esc(f.diretor)}">
        <button class="btn btn-icone" data-p="mesmo-diretor" title="Ver os filmes deste diretor na sua lista" aria-label="Ver os filmes deste diretor na sua lista"${f.diretor ? '' : ' disabled'}>${icone('Search')}</button>
        ${serie ? '' : `<button class="btn btn-icone" data-p="diretor-letterboxd" title="Ver todos os filmes do diretor no Letterboxd" aria-label="Ver todos os filmes do diretor no Letterboxd"${f.diretor ? '' : ' disabled'}>${LB_PONTOS}</button>`}
      </div>
    </div>
    <div class="campo"><label for="c-notas">Notas</label><textarea id="c-notas" data-campo="notas">${esc(f.notas)}</textarea></div>
    ${serie ? '' : campo('linkLetterboxd', 'Link do Letterboxd', 'placeholder="https://letterboxd.com/film/…" spellcheck="false"')}
    <div class="campo"${serie ? ' hidden' : ''}>
      <label for="c-buscaCapa">Busca da capa</label>
      <input id="c-buscaCapa" data-campo="buscaCapa" value="${esc(f.buscaCapa)}" placeholder="Título em inglês ou código tt…" spellcheck="false">
      <span class="ajuda">${f.imdbID ? `IMDb: ${esc(f.imdbID)}` : 'Sem código do IMDb ainda.'}${f.capaPersonalizada ? ' · Capa escolhida por você.' : f.tmdbEm && !f.tmdbId ? ' · Não encontrado no TMDB.' : ''}</span>
    </div>
    <div class="campo">
      <label for="c-trailer">Trailer (link do YouTube)</label>
      <input id="c-trailer" data-trailer value="${f.trailerId && f.trailerId !== 'nenhum' ? `https://youtu.be/${esc(f.trailerId)}` : ''}" placeholder="Achado automaticamente; cole outro link para trocar" spellcheck="false">
    </div>
    </div>
    <div class="salvo" id="salvo"></div>
    <div class="painel-rodape">
      <button class="btn" data-p="trocar">${icone('Image')} Trocar capa</button>
      <button class="btn btn-perigo" data-p="excluir">${icone('Trash2')} Remover da lista</button>
    </div>`;

  carregarRelacionados(f);
  ajustarCapaTemporada(f); // NANDRoll: numa temporada, a capa dela

  if (!f.info) {
    const id = f.id;
    carregarInfo(f).then((info) => {
      if (!info || estado.painelId !== id) return;
      $('[data-info="meta-painel"]').innerHTML = painelMetaHTML(f);
      const p = $('[data-info="sinopse-painel"]');
      if (p && info.sinopse) { p.textContent = info.sinopse; p.hidden = false; }
      const pais = $('[data-info="pais-painel"]');
      if (pais && paisesDe(f).length) { $('span', pais).innerHTML = paisesHTML(f); pais.hidden = false; }
      const e = $('[data-info="elenco-painel"]');
      if (e && info.elenco) { $('span', e).textContent = info.elenco.split(',').slice(0, 4).map((n) => n.trim()).join(', '); e.hidden = false; }
      const g = $('[data-info="generos-painel"]');
      const lista = generos(info);
      if (g && lista.length) { $('span', g).textContent = lista.join(', '); g.hidden = false; }
      const notas = $('#painel .notas-linha');
      if (notas) notas.innerHTML = notasHTML(info);
    });
  }
}

// "2001  1h 56m  [PG-13]", como a linha de dados do modal da Netflix.
function painelMetaHTML(f) {
  if (ehSerie(f)) return serieMetaHTML(f); // NANDRoll
  const info = f.info || {};
  const partes = [f.ano, duracaoDe(f)].filter(Boolean).map((p) => `<span>${esc(p)}</span>`);
  if (info.classificacao && info.classificacao !== 'N/A') partes.push(`<span class="classificacao">${esc(info.classificacao)}</span>`);
  return partes.join('') || '&nbsp;';
}

function atualizarBotoesPainel(f) {
  const visto = $('#painel .painel-botoes [data-p="visto"]');
  const fav = $('#painel .painel-botoes [data-p="favorito"]');
  if (!visto || !fav) return;
  // NANDRoll: o Letterboxd só tem filmes.
  const lb = $('#painel .painel-botoes [data-p="letterboxd"]');
  if (lb) lb.hidden = ehSerie(f);
  const tituloVisto = f.visto ? 'Desmarcar visto' : 'Marcar como visto';
  const tituloFav = f.favorito ? 'Tirar dos favoritos' : 'Favoritar';
  visto.classList.toggle('visto-on', Boolean(f.visto));
  visto.title = tituloVisto;
  visto.setAttribute('aria-label', tituloVisto);
  visto.setAttribute('aria-pressed', String(Boolean(f.visto)));
  fav.classList.toggle('fav-on', Boolean(f.favorito));
  fav.innerHTML = icone('Star', { preenchido: f.favorito });
  fav.title = tituloFav;
  fav.setAttribute('aria-label', tituloFav);
  fav.setAttribute('aria-pressed', String(Boolean(f.favorito)));
  const botaoHoje = $('#painel .painel-botoes [data-p="hoje"]');
  const hojeNaLista = naWatchlist(f.id);
  botaoHoje.classList.toggle('hoje-on', hojeNaLista);
  botaoHoje.title = tituloHoje(hojeNaLista);
  botaoHoje.setAttribute('aria-label', tituloHoje(hojeNaLista));
  botaoHoje.setAttribute('aria-pressed', String(hojeNaLista));
  const escrever = $('#painel .painel-botoes [data-p="pagina"]');
  if (escrever) {
    // Só aparece depois de marcar como visto (ou se o filme já tem página).
    escrever.hidden = !f.visto && !temPagina(f);
    escrever.innerHTML = temPagina(f) ? `${icone('BookOpen')} Abrir sua página` : `${icone('NotebookPen')} Escrever sobre o filme`;
  }
  const botaoStory = $('#painel .painel-botoes [data-p="story"]');
  if (botaoStory) botaoStory.hidden = !f.visto;
}

// ---------- Outros filmes do diretor e "Mais como este" (TMDB) ----------

// Nos detalhes, duas fileiras de capas: a filmografia de quem dirigiu e as
// recomendações do TMDB. Cada capa diz se o filme já está na lista (ou já foi
// visto); as que não estão têm + para adicionar. Clicar abre o filme: o da
// lista nos detalhes; os outros, no Letterboxd.
const relacionadosPorFilme = new Map(); // tmdbId → { diretores, recomendacoes }

async function carregarRelacionados(f) {
  const area = $('#painel-relacionados');
  if (!area || !f.tmdbId || !estado.config.tmdbKey) return;
  let dados = relacionadosPorFilme.get(f.tmdbId);
  if (!dados) {
    const r = await api.relacionadosTmdb(f.id);
    if (!r.ok || !r.dados) return;
    dados = r.dados;
    relacionadosPorFilme.set(f.tmdbId, dados);
  }
  if (estado.painelId !== f.id || !$('#painel-relacionados')) return;
  $('#painel-relacionados').innerHTML = relacionadosHTML(dados);
  prepararSetasRelacionados();
}

function relacionadosHTML({ diretores, recomendacoes }) {
  const naLista = new Map(estado.filmes.filter((x) => x.tmdbId).map((x) => [String(x.tmdbId), x]));
  const cartao = (r) => {
    const meu = naLista.get(String(r.tmdbId));
    const selo = meu
      ? (meu.visto ? `<span class="rel-selo visto" title="Você já viu">${icone('Check')}</span>` : `<span class="rel-selo na-lista" title="Na sua lista">${icone('Bookmark')}</span>`)
      : `<button class="rel-mais" data-p="rel-adicionar" data-tmdb="${r.tmdbId}" data-titulo="${esc(r.titulo)}" data-ano="${esc(r.ano)}" title="Adicionar à lista" aria-label="Adicionar ${esc(r.titulo)} à lista">${icone('Plus')}</button>`;
    return `
      <div class="rel-filme${meu ? ' na-lista' : ''}">
        <button class="rel-capa" data-p="rel-abrir" data-tmdb="${r.tmdbId}"${meu ? ` data-meu="${meu.id}"` : ''} title="${esc(meu ? `${r.titulo}: abrir nos detalhes` : `${r.titulo}: ver os detalhes`)}">
          <div class="capa">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy" data-titulo="${esc(r.titulo)}" data-ano="${esc(r.ano)}">` : `<div class="capa-vazia"><strong>${esc(r.titulo)}</strong><span>${esc(r.ano)}</span></div>`}</div>
        </button>
        ${selo}
        <strong>${esc(r.titulo)}</strong><span>${esc(r.ano)}</span>
      </div>`;
  };
  const fileira = (titulo, itens) => (itens.length ? `
    <section class="relacionados">
      <h3>${titulo}</h3>
      <div class="rel-envoltorio">
        <button class="rel-seta esq" data-p="rel-rolar" data-lado="-1" aria-label="Voltar" hidden>${icone('ChevronLeft')}</button>
        <div class="rel-fileira">${itens.map(cartao).join('')}</div>
        <button class="rel-seta dir" data-p="rel-rolar" data-lado="1" aria-label="Mais">${icone('ChevronRight')}</button>
      </div>
    </section>` : '');
  return diretores.map((d) => fileira(`Outros filmes de ${esc(d.nome)}`, d.filmes)).join('') + fileira('Mais como este', recomendacoes);
}

// Esconde a seta do lado em que a fileira já chegou ao fim.
function atualizarSetasRelacionados(fileira) {
  const env = fileira.closest('.rel-envoltorio');
  const fim = fileira.scrollWidth - fileira.clientWidth - 2;
  $('.rel-seta.esq', env).hidden = fileira.scrollLeft <= 2;
  $('.rel-seta.dir', env).hidden = fileira.scrollLeft >= fim;
}
function prepararSetasRelacionados() {
  $$('#painel-relacionados .rel-fileira').forEach(atualizarSetasRelacionados);
}
// Um listener só, no painel (rolagem não sobe, então na fase de captura):
// os detalhes são redesenhados com frequência e as fileiras são recriadas.
$('#painel').addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.matches('.rel-fileira')) atualizarSetasRelacionados(e.target);
}, { capture: true, passive: true });

async function adicionarRelacionado(botao) {
  const { tmdb, titulo, ano } = botao.dataset;
  botao.disabled = true;
  const repetido = await api.acharRepetido({ tmdbId: tmdb, titulo, ano });
  if (repetido) { aviso(`“${repetido.titulo}” já está na sua lista.`); botao.disabled = false; return; }
  const novo = await api.adicionarFilme({ titulo, ano, tmdbId: tmdb });
  estado.filmes.push(novo);
  novo.tmdbId = Number(tmdb); // até o TMDB responder, já conta como "na lista"
  render();
  const f = porId(estado.painelId);
  const dados = f && relacionadosPorFilme.get(f.tmdbId);
  if (dados && $('#painel-relacionados')) { $('#painel-relacionados').innerHTML = relacionadosHTML(dados); prepararSetasRelacionados(); }
  aviso(`“${titulo}” foi adicionado à lista.`, { tipo: 'ok', acao: { rotulo: 'Ver', fn: () => abrirPainel(novo.id) } });
}

// ---------- Detalhes de um filme que não está na lista ----------

// Abre nos detalhes um filme das fileiras de relacionados, com o que vem do
// TMDB (capa, logo, trailer, sinopse, elenco…), sem salvá-lo. Os detalhes
// ficam só para ler, com "Adicionar à lista" no lugar de visto/favorito.
async function abrirFilmeExterno(tmdbId, { voltarPara = null } = {}) {
  const id = `tmdb-${tmdbId}`;
  const daLista = estado.filmes.find((f) => String(f.tmdbId) === String(tmdbId));
  if (daLista) { abrirPainel(daLista.id, { voltarPara }); return; }
  if (!filmesExternos.has(id)) {
    const r = await api.detalhesTmdb(tmdbId);
    if (!r.ok || !r.dados) { aviso(r.ok ? 'O TMDB não tem esse filme.' : r.erro.mensagem, { tipo: 'erro' }); return; }
    const d = r.dados;
    filmesExternos.set(id, {
      id, externo: true, tmdbId: d.tmdbId, imdbID: d.imdbID, titulo: d.titulo, ano: d.ano, diretor: d.diretor,
      poster: d.poster, logo: d.logo, trailerId: d.trailerId || 'nenhum', info: d.info, duracao: d.duracao,
      visto: false, favorito: false, vistoEm: [], minhaNota: 0, notas: '',
    });
  }
  abrirPainel(id, { voltarPara });
}

function botaoVoltarPainelHTML() {
  const anterior = estado.painelAnterior && porId(estado.painelAnterior);
  return anterior ? `<button class="painel-voltar" data-p="voltar" title="Voltar para ${esc(anterior.titulo)}">${icone('ChevronLeft')}<span>${esc(anterior.titulo)}</span></button>` : '';
}

function renderPainelExterno(f) {
  const topo = $('#painel .painel-capa');
  if (!topo || topo.dataset.id !== f.id) {
    $('#painel-conteudo').innerHTML = `
      <button class="redondo painel-fechar" data-p="fechar" aria-label="Fechar" title="Fechar (Esc)">${icone('X')}</button>
      ${botaoVoltarPainelHTML()}
      <div class="painel-capa" data-id="${f.id}">
        <div class="painel-fundo-video"><div class="destaque-fundo-capa"></div></div>
        <div class="painel-sombra"></div>
        <button class="btn-redondo painel-som" data-p="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
        <div class="painel-cabecalho">
          <div class="destaque-identidade">
            <div class="destaque-poster painel-poster-externo">${capaHTML(f, { tamanho: 'grande' })}</div>
            <div class="destaque-titulo">${tituloHTML(f)}</div>
          </div>
          <div class="painel-botoes">
            <button class="btn btn-assistir" data-p="externo-adicionar">${icone('Plus')} Adicionar à lista</button>
            <button class="redondo" data-p="externo-letterboxd" title="Abrir no Letterboxd" aria-label="Abrir no Letterboxd">${LB_PONTOS}</button>
            ${f.trailerId && f.trailerId !== 'nenhum' ? `<button class="redondo" data-p="trailer" title="Ver o trailer em tela cheia" aria-label="Ver o trailer em tela cheia">${icone('Maximize')}</button>` : ''}
          </div>
        </div>
      </div>
      <div id="painel-resto"></div>`;
    fundoDesfocado($('.painel-capa'), f);
    carregarTrailerPainel(f);
  }
  const info = f.info || {};
  const elenco = info.elenco ? info.elenco.split(',').slice(0, 4).map((n) => n.trim()).join(', ') : '';
  $('#painel-resto').innerHTML = `
    <div class="painel-corpo">
      <div>
        <p class="painel-meta">${painelMetaHTML(f)}</p>
        <p class="painel-externo-aviso">${icone('Info')} Este filme não está na sua lista.</p>
        <div class="notas-linha">${notasHTML(info)}</div>
        ${info.sinopse ? `<p class="painel-sinopse">${esc(info.sinopse)}</p>` : ''}
      </div>
      <div class="painel-fichas">
        ${f.diretor ? `<p class="painel-ficha"><b>Direção:</b> <span>${esc(f.diretor)}</span></p>` : ''}
        ${paisesDe(f).length ? `<p class="painel-ficha"><b>País:</b> <span>${paisesHTML(f)}</span></p>` : ''}
        ${elenco ? `<p class="painel-ficha"><b>Elenco:</b> <span>${esc(elenco)}</span></p>` : ''}
        ${generos(info).length ? `<p class="painel-ficha"><b>Gêneros:</b> <span>${esc(generos(info).join(', '))}</span></p>` : ''}
      </div>
    </div>
    <div id="painel-relacionados"></div>`;
  carregarRelacionados(f);
}

async function adicionarExterno(f, botao) {
  if (!f || !f.externo) return;
  botao.disabled = true;
  const repetido = await api.acharRepetido({ tmdbId: f.tmdbId, imdbID: f.imdbID, titulo: f.titulo, ano: f.ano });
  if (repetido) { abrirPainel(repetido.id, { voltarPara: estado.painelAnterior }); aviso(`“${repetido.titulo}” já estava na sua lista.`); return; }
  const novo = await api.adicionarFilme({ titulo: f.titulo, ano: f.ano, diretor: f.diretor, imdbID: f.imdbID, tmdbId: f.tmdbId, poster: f.poster });
  novo.tmdbId = f.tmdbId;
  estado.filmes.push(novo);
  filmesExternos.delete(f.id);
  render();
  abrirPainel(novo.id, { voltarPara: estado.painelAnterior });
  aviso(`“${novo.titulo}” foi adicionado à lista.`, { tipo: 'ok' });
}

// ---------- Sua nota (estrelas) ----------

// De ½ a 5 estrelas, dada nos detalhes do filme; aparece também na tierlist.
// Passar o mouse mostra a nota que vai ficar; clicar na mesma nota tira a nota.
const notaLegivel = (n) => String(n).replace('.', ',');

function estrelasHTML(f) {
  const n = f.minhaNota || 0;
  const estrelas = [0, 1, 2, 3, 4].map((i) => `
    <span class="estrela">${icone('Star')}<span class="estrela-cheia" style="width:${Math.max(0, Math.min(1, n - i)) * 100}%">${icone('Star', { preenchido: true })}</span></span>`).join('');
  return `<div class="minha-nota" role="slider" tabindex="0" aria-label="Sua nota" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${n}" aria-valuetext="${n ? `${notaLegivel(n)} estrelas` : 'Sem nota'}" data-nota="${n}">
      <div class="estrelas">${estrelas}</div>
      <span class="nota-texto">${n ? notaLegivel(n) : 'Dê sua nota'}</span>
    </div>`;
}

// Só para ler (na página do dia do calendário): as estrelas e o número.
function notaFixaHTML(n) {
  const estrelas = [0, 1, 2, 3, 4].map((i) => `
    <span class="estrela">${icone('Star')}<span class="estrela-cheia" style="width:${Math.max(0, Math.min(1, n - i)) * 100}%">${icone('Star', { preenchido: true })}</span></span>`).join('');
  return `<div class="nota-fixa" title="Sua nota: ${notaLegivel(n)}" aria-label="Sua nota: ${notaLegivel(n)} estrelas"><div class="estrelas">${estrelas}</div><b>${notaLegivel(n)}</b></div>`;
}

function pintarEstrelas(el, n, provisoria = false) {
  $$('.estrela-cheia', el).forEach((s, i) => { s.style.width = `${Math.max(0, Math.min(1, n - i)) * 100}%`; });
  $('.nota-texto', el).textContent = n ? notaLegivel(n) : 'Dê sua nota';
  el.classList.toggle('provisoria', provisoria);
}

function notaNoPonteiro(el, x) {
  const r = $('.estrelas', el).getBoundingClientRect();
  return Math.max(0.5, Math.min(5, Math.ceil(((x - r.left) / r.width) * 10) / 2));
}

async function definirMinhaNota(id, n) {
  const f = porId(id);
  if (!f) return;
  f.minhaNota = n;
  const el = $('#painel .minha-nota');
  if (el && estado.painelId === id) {
    el.dataset.nota = String(n);
    el.setAttribute('aria-valuenow', String(n));
    el.setAttribute('aria-valuetext', n ? `${notaLegivel(n)} estrelas` : 'Sem nota');
    pintarEstrelas(el, n);
    Movimento.animar($('.estrelas', el), [{ transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 260 });
  }
  if (!tierlist.hidden) renderTierlist();
  if (!calendario.hidden) renderCalendario();
  await api.atualizarFilme(id, { minhaNota: n });
}

$('#painel').addEventListener('pointermove', (e) => {
  const el = e.target.closest('.minha-nota');
  if (el && e.target.closest('.estrelas')) pintarEstrelas(el, notaNoPonteiro(el, e.clientX), true);
});
$('#painel').addEventListener('pointerout', (e) => {
  const el = e.target.closest('.minha-nota');
  if (el && !el.contains(e.relatedTarget)) pintarEstrelas(el, Number(el.dataset.nota) || 0);
});
$('#painel').addEventListener('click', (e) => {
  const el = e.target.closest('.minha-nota');
  if (!el || !e.target.closest('.estrelas') || !estado.painelId) return;
  const n = notaNoPonteiro(el, e.clientX);
  definirMinhaNota(estado.painelId, n === Number(el.dataset.nota) ? 0 : n);
});
$('#painel').addEventListener('keydown', (e) => {
  const el = e.target.closest('.minha-nota');
  if (!el || !estado.painelId) return;
  const atual = Number(el.dataset.nota) || 0;
  const passos = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 };
  if (e.key in passos) { e.preventDefault(); definirMinhaNota(estado.painelId, Math.max(0, Math.min(5, atual + passos[e.key]))); }
  if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '0') { e.preventDefault(); definirMinhaNota(estado.painelId, 0); }
});

// "Vi em: 19 de outubro, 22 de outubro" (cada vez que viu), com ✕ para tirar uma
// data, "Vi de novo hoje" e um campo para lançar um dia que passou.
function vistosEmHTML(f) {
  const dias = f.vistoEm || [];
  const datas = dias.map((d) => `<span class="dia-visto">${esc(diaLegivel(d, { comAno: true }))}<button data-p="remover-dia" data-dia="${d}" title="Tirar esta data" aria-label="Tirar a data ${esc(diaLegivel(d))}">${icone('X')}</button></span>`).join('');
  const jaHoje = dias.includes(hoje());
  return `
    <div class="vistos-em">
      <b>${dias.length ? `Vi ${dias.length === 1 ? 'em' : `${dias.length} vezes:`}` : 'Ainda não registrado no calendário'}</b>
      ${datas}
    </div>
    <div class="vistos-acoes">
      ${f.visto && !jaHoje ? `<button class="btn btn-fantasma" data-p="vi-hoje">${icone('RotateCcw')} Vi de novo hoje</button>` : ''}
      <label class="adicionar-dia">${icone('CalendarPlus')} Lançar outro dia <input type="date" data-adicionar-dia max="${hoje()}"></label>
    </div>`;
}

// Trailer tocando atrás do título, mudo como no destaque.
async function carregarTrailerPainel(f) {
  const id = f.id;
  const videoId = await trailerDe(id);
  const capa = $('#painel .painel-capa');
  if (!videoId || estado.painelId !== id || !capa || capa.dataset.id !== id) return;
  pausarDestaque('painel');
  $('.painel-fundo-video', capa).append(iframeTrailer(videoId, 'painel-video', { mudo: !estado.som }));
  capa.classList.add('com-trailer');
  $('[data-p="som"]', capa).hidden = false;
}

// Tira o trailer do painel ao fechar, para ele não continuar tocando escondido.
function pararTrailerPainel() {
  const capa = $('#painel .painel-capa');
  if (capa) { capa.dataset.id = ''; $('.painel-video', capa)?.remove(); }
  retomarDestaque('painel');
}

const timersCampo = {};
function editarCampo(id, campo, valor) {
  const f = porId(id);
  if (!f) return;
  f[campo] = valor;
  if (campo === 'buscaCapa') f.capaNaoEncontrada = false;
  if (campo === 'diretor') $$('[data-p="mesmo-diretor"], [data-p="diretor-letterboxd"]').forEach((b) => { b.disabled = !valor.trim(); });
  agendarRender();
  clearTimeout(timersCampo[campo]);
  timersCampo[campo] = setTimeout(async () => {
    await api.atualizarFilme(id, { [campo]: valor });
    const salvo = $('#salvo');
    if (salvo && estado.painelId === id) {
      salvo.textContent = 'Salvo';
      clearTimeout(salvo._t);
      salvo._t = setTimeout(() => { salvo.textContent = ''; }, 1500);
    }
    if (estado.painelId === id && (campo === 'titulo' || campo === 'ano')) {
      const titulo = $('#painel .destaque-titulo h2');
      if (titulo) titulo.textContent = f.titulo;
      const linhaMeta = $('[data-info="meta-painel"]');
      if (linhaMeta) linhaMeta.innerHTML = painelMetaHTML(f);
    }
  }, 400);
}

$('#painel').addEventListener('input', (e) => {
  const campo = e.target.dataset.campo;
  if (campo && estado.painelId) editarCampo(estado.painelId, campo, e.target.value);
});

$('#painel').addEventListener('click', async (e) => {
  if (!estado.painelId) return;
  const id = estado.painelId;
  const b = e.target.closest('[data-p]');
  if (!b) {
    // Clicar no trailer (fora do título e dos botões) abre o modo foco.
    const capa = e.target.closest('.painel-capa.com-trailer');
    if (capa && !e.target.closest('.painel-cabecalho')) abrirFoco(id, Number($('.painel-video', capa)?.dataset.tempo) || 0);
    return;
  }
  switch (b.dataset.p) {
    case 'fechar': fecharPainel(); break;
    case 'som': alternarSom(); break;
    case 'visto': alternar(id, 'visto'); break;
    case 'favorito': alternar(id, 'favorito'); break;
    case 'hoje': alternarWatchlist(id); break;
    case 'vi-hoje': viHoje(id); break;
    case 'pagina': abrirPagina(id); break;
    case 'story': abrirStory(id); break;
    case 'listas': abrirListasDoFilme(b, id); break;
    case 'ver-lista': filtrarLista(b.dataset.lista); break;
    case 'remover-dia': {
      const f = porId(id);
      const dias = [...(f.vistoEm || [])];
      dias.splice(dias.indexOf(b.dataset.dia), 1);
      salvarVistoEm(f, dias);
      break;
    }
    case 'stremio': abrirStremio(id); break;
    case 'letterboxd': abrirLetterboxd(id); break;
    case 'trocar': abrirTrocarCapa(id); break;
    case 'excluir': excluir(id); break;
    case 'baixar': baixarCapa(id); break;
    case 'arquivo': usarArquivoCapa(id); break;
    case 'trailer': abrirTrailer(id); break;
    case 'rel-adicionar': adicionarRelacionado(b); break;
    case 'rel-rolar': {
      const fileira = $('.rel-fileira', b.closest('.rel-envoltorio'));
      fileira.scrollBy({ left: Number(b.dataset.lado) * fileira.clientWidth * 0.85, behavior: 'smooth' });
      break;
    }
    case 'rel-abrir':
      if (b.dataset.meu) abrirPainel(b.dataset.meu, { voltarPara: id });
      else abrirFilmeExterno(b.dataset.tmdb, { voltarPara: id });
      break;
    case 'voltar': if (estado.painelAnterior) abrirPainel(estado.painelAnterior); break;
    case 'externo-adicionar': adicionarExterno(porId(id), b); break;
    case 'externo-letterboxd': window.open(`https://letterboxd.com/tmdb/${porId(id).tmdbId}/`); break;
    case 'mesmo-diretor': filtrarDiretor(porId(id).diretor); break;
    case 'pais': filtrarPais(b.dataset.pais); break;
    case 'diretor-letterboxd': {
      // Página do (primeiro) diretor no Letterboxd: letterboxd.com/director/nome-sobrenome/
      const nome = (porId(id).diretor || '').split(/\s*(?:,|;|\/|&)\s*/)[0];
      const slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug) window.open(`https://letterboxd.com/director/${slug}/`);
      break;
    }
  }
});

// Lançar um dia que passou ("vi ontem e esqueci de marcar").
$('#painel').addEventListener('change', (e) => {
  if (!e.target.matches('[data-adicionar-dia]') || !estado.painelId || !e.target.value) return;
  const f = porId(estado.painelId);
  const dia = e.target.value;
  if (dia > hoje()) { aviso('Esse dia ainda não chegou.', { tipo: 'erro' }); return; }
  f.visto = true;
  salvarVistoEm(f, [...(f.vistoEm || []), dia]);
  aviso(`“${f.titulo}” visto em ${diaLegivel(dia)}.`, { tipo: 'ok' });
});

$('#painel').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-trailer]') || !estado.painelId) return;
  const id = estado.painelId;
  const r = await api.definirTrailer(id, e.target.value);
  if (r.erro) { aviso(r.erro, { tipo: 'erro' }); return; }
  Object.assign(porId(id), { trailerId: r.filme.trailerId });
  buscasTrailer.delete(id);
  if (r.filme.trailerId) e.target.value = `https://youtu.be/${r.filme.trailerId}`;
  aviso(r.filme.trailerId ? 'Trailer trocado.' : 'Trailer limpo: será buscado de novo.', { tipo: 'ok' });
  if (filmeNoDestaque() === id) mostrarDestaque();
});

$('#painel-fundo').addEventListener('click', fecharPainel);

// ---------- Capa: baixar e usar imagem própria ----------

async function baixarCapa(id) {
  const r = await api.baixarCapa(id);
  if (r.erro) aviso(r.erro, { tipo: 'erro' });
  else if (r.arquivo) aviso(`Capa salva em ${r.arquivo}`, { tipo: 'ok', duracao: 6000 });
}

async function usarArquivoCapa(id, caminho) {
  const r = await api.usarArquivoCapa(id, caminho);
  if (r.cancelado) return;
  if (r.erro) { aviso(r.erro, { tipo: 'erro' }); return; }
  Object.assign(porId(id), r.filme);
  render();
  if (estado.painelId === id) renderPainel();
  if (filmeNoDestaque() === id) mostrarDestaque();
  aviso('Capa trocada pela sua imagem.', { tipo: 'ok' });
}

// Arrastar uma imagem do computador para a capa (no painel ou num cartão) troca a capa.
function alvoDeSoltar(e) {
  const capaPainel = e.target.closest('.painel-capa .capa');
  if (capaPainel && estado.painelId) return { el: capaPainel, id: estado.painelId };
  const cartao = e.target.closest('.cartao');
  return cartao ? { el: cartao, id: cartao.dataset.id } : null;
}
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault();
  $$('.soltar').forEach((el) => el.classList.remove('soltar'));
  const alvo = alvoDeSoltar(e);
  e.dataTransfer.dropEffect = alvo ? 'copy' : 'none';
  if (alvo) alvo.el.classList.add('soltar');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) $$('.soltar').forEach((el) => el.classList.remove('soltar'));
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  $$('.soltar').forEach((el) => el.classList.remove('soltar'));
  const alvo = alvoDeSoltar(e);
  const arquivo = e.dataTransfer && e.dataTransfer.files[0];
  if (!alvo || !arquivo) return;
  if (!arquivo.type.startsWith('image/')) { aviso('Solte um arquivo de imagem (JPG, PNG ou WEBP).', { tipo: 'erro' }); return; }
  usarArquivoCapa(alvo.id, api.caminhoDoArquivo(arquivo));
});

// Tira o filme da lista na hora, sem perguntar: o aviso tem "Desfazer", que o
// devolve no mesmo lugar (o processo principal guarda o filme até o app fechar).
async function excluir(id) {
  const f = porId(id);
  if (!f) return;
  const indice = estado.filmes.indexOf(f);
  await api.excluirFilme(id);
  estado.filmes = estado.filmes.filter((x) => x.id !== id);
  cacheCartoes.delete(id);
  cacheFileira.delete(id);
  if (estado.painelId === id) fecharPainel();
  if (previaId === id) fecharPrevia(false);
  const noDestaque = filmeNoDestaque() === id;
  estado.historico = estado.historico.filter((x) => x !== id);
  estado.indiceDestaque = Math.min(estado.indiceDestaque, estado.historico.length - 1);
  if (noDestaque) { if (estado.historico.length) mostrarDestaque(); else sortear({ rolar: false, avisarSeVazio: false }); }
  render();
  if (!calendario.hidden) renderCalendario();
  if (!tierlist.hidden) renderTierlist();
  aviso(`“${f.titulo}” foi removido da lista.`, {
    duracao: 8000,
    acao: {
      rotulo: 'Desfazer',
      fn: async () => {
        const volta = await api.restaurarFilme(id);
        if (!volta || porId(id)) return;
        estado.filmes.splice(Math.min(indice, estado.filmes.length), 0, volta);
        render();
        if (!calendario.hidden) renderCalendario();
        if (!tierlist.hidden) renderTierlist();
        aviso(`“${f.titulo}” voltou para a lista.`, { tipo: 'ok' });
      },
    },
  });
}

// ---------- Modais ----------

const modal = $('#modal');
let resolverModal = null;
// O evento `close` do <dialog> chega depois (assíncrono). Se o app fecha um
// modal e logo abre outro, esse evento atrasado não pode apagar o novo. Por isso
// os fechamentos feitos pelo app são resolvidos na hora, e o evento só trata o
// Esc nativo.
let fechamentosIgnorados = 0;

function finalizarModal(valor) {
  const resolver = resolverModal;
  resolverModal = null;
  if (resolver) resolver(valor);
}

function fecharModal(valor = null) {
  if (!modal.open) return;
  fechamentosIgnorados++;
  modal.close();
  modal.innerHTML = '';
  finalizarModal(valor);
}

function abrirModal(html, classe = '') {
  fecharModal(null);
  modal.className = `modal ${classe}`;
  modal.innerHTML = html;
  modal.showModal();
  return new Promise((resolve) => { resolverModal = resolve; });
}

modal.addEventListener('close', () => {
  if (fechamentosIgnorados) { fechamentosIgnorados--; return; }
  modal.innerHTML = '';
  finalizarModal(null);
});

// Clicar fora da caixa fecha o modal.
modal.addEventListener('mousedown', (e) => {
  if (e.target !== modal) return;
  const r = modal.getBoundingClientRect();
  const dentro = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!dentro) fecharModal(null);
});

modal.addEventListener('click', (e) => {
  if (e.target.closest('[data-fechar]')) fecharModal(null);
});

function cabecalhoModal(titulo) {
  return `<div class="modal-cabecalho"><h2>${esc(titulo)}</h2><button class="btn btn-fantasma btn-icone" data-fechar aria-label="Fechar">${icone('X')}</button></div>`;
}

function perguntar({ titulo, texto, botoes }) {
  const html = `${cabecalhoModal(titulo)}
    <div class="modal-corpo"><p style="margin:0;color:var(--texto-2)">${esc(texto)}</p></div>
    <div class="modal-rodape">${botoes.map((b, i) => `<button class="btn ${b.classe || ''}" data-i="${i}">${esc(b.rotulo)}</button>`).join('')}</div>`;
  const promessa = abrirModal(html, 'modal-pequeno');
  $$('.modal-rodape button', modal).forEach((el) => {
    el.onclick = () => fecharModal(botoes[Number(el.dataset.i)].valor);
  });
  const principal = $('.modal-rodape button:last-child', modal);
  if (principal) principal.focus();
  return promessa;
}

function resultadosHTML(itens, atualTmdb) {
  return itens.map((r, i) => `
    <button class="resultado${r.tmdbId && String(r.tmdbId) === String(atualTmdb) ? ' atual' : ''}" data-i="${i}">
      <div class="capa">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy" data-titulo="${esc(r.titulo)}" data-ano="${esc(r.ano)}">` : `<div class="capa-vazia"><strong>${esc(r.titulo)}</strong></div>`}</div>
      <strong>${esc(r.titulo)}</strong><span>${esc(r.ano)}${r.imdbID ? ` · ${esc(r.imdbID)}` : ''}${r.detalhe ? `${r.ano ? ' · ' : ''}${esc(r.detalhe)}` : ''}</span>
    </button>`).join('');
}

function mensagemErroTmdb(erro) {
  if (erro.tipo === 'chave') return erro.mensagem;
  return 'Sem conexão com o TMDB. Verifique a internet e tente de novo.';
}

// Caixa de busca no TMDB usada por "Trocar capa" e "Adicionar".
function montarBuscaTmdb({ termoInicial, atualTmdb, aoEscolher, fonte = () => 'filme' }) {
  const input = $('#busca-tmdb', modal);
  const area = $('#resultados-tmdb', modal);
  let itens = [];
  let geracao = 0;

  async function buscar() {
    const termo = input.value.trim();
    // NANDRoll: animes são buscados na AniList (sem chave); sem termo, o que está em alta.
    const anime = fonte() === 'anime';
    if (!termo && !anime) { area.innerHTML = ''; return; }
    if (!anime && !estado.config.tmdbKey) { geracao++; area.innerHTML = '<p class="mensagem">Coloque a chave do TMDB em Configurações para buscar.</p>'; return; }
    const minha = ++geracao;
    area.innerHTML = `<p class="mensagem carregando">Buscando ${anime ? 'na AniList' : 'no TMDB'}</p>`;
    const r = anime ? await api.pesquisarAnilist(termo) : await api.pesquisarTmdb(termo);
    if (minha !== geracao || !modal.open) return;
    if (!r.ok) { area.innerHTML = `<p class="mensagem">${esc(anime ? 'Sem conexão com a AniList. Verifique a internet e tente de novo.' : mensagemErroTmdb(r.erro))}</p>`; return; }
    itens = r.dados;
    area.innerHTML = itens.length
      ? `${anime && !termo ? '<h3 class="trocar-subtitulo">Em alta nesta temporada</h3>' : ''}<div class="resultados">${resultadosHTML(itens, atualTmdb)}</div>`
      : `<p class="mensagem">${anime ? 'Nada encontrado. Tente o título em inglês ou em japonês (romaji).' : 'Nada encontrado. Tente o título original ou o código do IMDb (tt…).'}</p>`;
  }
  ligarFontesBusca(modal, () => { input.placeholder = fonte() === 'anime' ? 'Digite o nome do anime e tecle Enter' : 'Digite o título e tecle Enter'; itens = []; area.innerHTML = ''; buscar(); input.focus(); });

  input.value = termoInicial || '';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
  $('#btn-busca-tmdb', modal).onclick = buscar;
  area.addEventListener('click', (e) => {
    const b = e.target.closest('.resultado');
    if (b) aoEscolher(itens[Number(b.dataset.i)], b);
  });
  input.focus();
  input.select();
  if (termoInicial || fonte() === 'anime') buscar();
}

// Duas partes: as outras capas deste mesmo filme no TMDB (idioma original
// primeiro) e, embaixo, a busca para quando o filme achado é o errado.
async function abrirTrocarCapa(id) {
  const f = porId(id);
  if (ehSerie(f)) { abrirTrocarCapaSerie(id); return; } // NANDRoll
  const trocar = async (escolha, botao, mensagem) => {
    botao.disabled = true;
    botao.classList.add('carregando');
    const novo = await api.trocarCapa(id, escolha);
    if (novo && novo.erro) { aviso(novo.erro, { tipo: 'erro' }); botao.disabled = false; return; }
    if (novo) Object.assign(f, novo);
    fecharModal();
    render();
    if (estado.painelId === id) renderPainel();
    if (filmeNoDestaque() === id) mostrarDestaque({ rapido: true });
    aviso(mensagem, { tipo: 'ok' });
  };
  abrirModal(`${cabecalhoModal(`Trocar capa — ${f.titulo}`)}
    <div class="modal-corpo">
      ${f.tmdbId ? `<h3 class="trocar-subtitulo">Outras capas deste filme</h3>
      <div id="outras-capas"><p class="mensagem carregando">Carregando as capas</p></div>
      <h3 class="trocar-subtitulo">É outro filme? Busque o certo</h3>` : ''}
      <div class="busca-linha"><input id="busca-tmdb" placeholder="Título ou código tt…" spellcheck="false"><button class="btn btn-laranja" id="btn-busca-tmdb">Buscar</button></div>
      <div id="resultados-tmdb"></div>
    </div>
    <div class="modal-rodape"><button class="btn" id="btn-capa-arquivo">${icone('FolderOpen')} Usar imagem minha…</button></div>`);
  $('#btn-capa-arquivo', modal).onclick = () => { fecharModal(); usarArquivoCapa(id); };
  montarBuscaTmdb({
    termoInicial: f.tmdbId ? '' : (f.buscaCapa || f.titulo),
    atualTmdb: f.tmdbId,
    aoEscolher: (escolha, botao) => trocar({ tmdbId: escolha.tmdbId }, botao, 'Filme trocado: capa, logo, trailer e informações atualizados.'),
  });
  if (!f.tmdbId) return;
  $('#busca-tmdb', modal).value = f.buscaCapa || f.titulo;
  const r = await api.capasTmdb(id);
  const area = $('#outras-capas', modal);
  if (!area) return;
  if (!r.ok || !r.dados.length) { area.innerHTML = `<p class="mensagem">${r.ok ? 'O TMDB não tem outras capas deste filme.' : esc(mensagemErroTmdb(r.erro))}</p>`; return; }
  const capas = r.dados.slice(0, 40);
  area.innerHTML = `<div class="resultados outras-capas">${capas.map((c, i) => `
    <button class="resultado${c.poster === f.poster ? ' atual' : ''}" data-i="${i}" title="${c.idioma ? `Idioma: ${esc(c.idioma)}` : 'Sem texto'}">
      <div class="capa"><img src="${esc(c.miniatura)}" alt="" loading="lazy"></div>
      <span>${c.idioma ? esc(c.idioma.toUpperCase()) : 'sem texto'}</span>
    </button>`).join('')}</div>`;
  area.addEventListener('click', (e) => {
    const b = e.target.closest('.resultado');
    if (b) trocar({ tmdbId: f.tmdbId, poster: capas[Number(b.dataset.i)].poster }, b, 'Capa trocada.');
  });
}

async function abrirAdicionar(termo = '') {
  abrirModal(`${cabecalhoModal(nandrollLigado() ? 'Adicionar à lista' : 'Adicionar filme')}
    <div class="modal-corpo">
      ${fontesBuscaHTML()}
      <div class="busca-linha"><input id="busca-tmdb" placeholder="${fonteAtual() === 'anime' ? 'Digite o nome do anime e tecle Enter' : 'Digite o título e tecle Enter'}" spellcheck="false"><button class="btn btn-laranja" id="btn-busca-tmdb">Buscar</button></div>
      <div id="resultados-tmdb"><p class="mensagem">${nandrollLigado() ? 'Busque e clique no resultado certo. Filmes vêm do TMDB; animes, da AniList.' : 'Busque o filme no TMDB e clique no resultado certo.'}</p></div>
    </div>
    <div class="modal-rodape"><button class="btn btn-fantasma" id="btn-sem-buscar">Adicionar sem buscar</button></div>`);

  const adicionar = async (dados) => {
    const repetido = await api.acharRepetido(dados);
    if (repetido) {
      const seguir = await perguntar({
        titulo: 'Esse filme já está na lista',
        texto: `“${repetido.titulo}”${repetido.ano ? ` (${repetido.ano})` : ''} já está na sua lista. Adicionar mesmo assim?`,
        botoes: [
          { rotulo: 'Ver o que já está', valor: 'ver', classe: 'btn-fantasma' },
          { rotulo: 'Adicionar mesmo assim', valor: 'sim', classe: 'btn-laranja' },
        ],
      });
      if (seguir === 'ver') { abrirPainel(repetido.id); return; }
      if (seguir !== 'sim') return;
    }
    const novo = await api.adicionarFilme(dados);
    estado.filmes.push(novo);
    fecharModal();
    render();
    abrirPainel(novo.id);
    aviso(`“${novo.titulo}” foi adicionado.`, { tipo: 'ok' });
  };

  $('#btn-sem-buscar', modal).onclick = () => {
    const titulo = $('#busca-tmdb', modal).value.trim();
    if (!titulo) { $('#busca-tmdb', modal).focus(); aviso('Digite o título primeiro.'); return; }
    adicionar({ titulo });
  };

  montarBuscaTmdb({
    termoInicial: termo,
    fonte: fonteAtual,
    aoEscolher: async (escolha, botao) => {
      botao.classList.add('carregando');
      // NANDRoll: um resultado da AniList. Série entra com episódios; filme de
      // anime entra como filme (o TMDB completa) e leva junto onde assistir.
      if (escolha.anilistId) {
        await adicionar({ titulo: escolha.titulo, ano: escolha.ano, poster: escolha.poster, anilistId: escolha.anilistId, filme: escolha.filme, tipo: escolha.filme ? undefined : 'serie' });
        botao.classList.remove('carregando');
        return;
      }
      const r = await api.detalhesTmdb(escolha.tmdbId);
      const d = r.ok && r.dados ? r.dados : null;
      await adicionar({
        titulo: (d && d.titulo) || escolha.titulo,
        ano: (d && d.ano) || escolha.ano || '',
        diretor: (d && d.diretor) || '',
        imdbID: (d && d.imdbID) || '',
        tmdbId: escolha.tmdbId,
      });
    },
  });
}

// ---------- Trailers (YouTube) ----------

function urlTrailer(videoId, { mudo = true, controles = false, inicio = 0 } = {}) {
  const p = new URLSearchParams({
    autoplay: '1', mute: mudo ? '1' : '0', controls: controles ? '1' : '0',
    loop: '1', playlist: videoId, rel: '0', modestbranding: '1', iv_load_policy: '3',
    playsinline: '1', enablejsapi: '1', cc_load_policy: '0', disablekb: controles ? '0' : '1', fs: controles ? '1' : '0',
  });
  if (inicio > 1) p.set('start', String(Math.floor(inicio)));
  return `https://www.youtube-nocookie.com/embed/${videoId}?${p}`;
}

// Trailers de fundo (destaque e prévia) só aparecem enquanto estão tocando; antes
// disso fica a capa desfocada. A interface do YouTube por cima do vídeo é
// escondida pelo processo principal (limparTrailer em main.js).
const ESTADO_TOCANDO = 1;
const ESTADO_CARREGANDO = 3;

function iframeTrailer(videoId, classe, opcoes = {}) {
  const fr = document.createElement('iframe');
  fr.className = classe;
  fr.src = urlTrailer(videoId, opcoes);
  fr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  fr.tabIndex = -1;
  fr.title = 'Trailer';
  if (!opcoes.controles) {
    fr.dataset.fundo = '';
    fr.addEventListener('load', () => {
      // Pede ao player que avise as mudanças de estado (API de iframe do YouTube).
      let tentativas = 0;
      const pedir = setInterval(() => {
        if (fr.dataset.ouvindo || ++tentativas > 20 || !fr.isConnected) { clearInterval(pedir); return; }
        if (fr.contentWindow) fr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      }, 250);
    }, { once: true });
  }
  return fr;
}

window.addEventListener('message', (e) => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || typeof e.data !== 'string') return;
  let dados;
  try { dados = JSON.parse(e.data); } catch { return; }
  const fr = $$('iframe[data-fundo]').find((f) => f.contentWindow === e.source);
  if (!fr) return;
  fr.dataset.ouvindo = '1';
  // Reforça o autoplay: em alguns casos o player fica parado em "não iniciado".
  if (dados.event === 'onReady') {
    comandoTrailer(fr, 'playVideo');
    if (fr.classList.contains('destaque-video')) aplicarPausaDestaque();
  }
  const info = dados.info;
  // Guarda o ponto do vídeo para o modo foco continuar de onde estava.
  if (info && typeof info.currentTime === 'number') fr.dataset.tempo = String(info.currentTime);
  let estadoPlayer = null;
  if (dados.event === 'onStateChange') estadoPlayer = info;
  else if (dados.event === 'infoDelivery' && info && typeof info.playerState === 'number') estadoPlayer = info.playerState;
  if (estadoPlayer === null || String(estadoPlayer) === fr.dataset.estado) return;
  fr.dataset.estado = String(estadoPlayer);
  // Carregando (3): mantém o último quadro na tela em vez de piscar a capa.
  if (estadoPlayer === ESTADO_CARREGANDO) return;
  fr.classList.toggle('visivel', estadoPlayer === ESTADO_TOCANDO);
  if (estadoPlayer === ESTADO_TOCANDO) {
    // Sem som o YouTube liga as legendas sozinho.
    comandoTrailer(fr, 'unloadModule', ['captions']);
    comandoTrailer(fr, 'unloadModule', ['cc']);
  }
});

// Uma busca por filme, compartilhada: a prévia já começa a procurar o trailer
// quando o mouse chega na capa, antes de abrir.
const buscasTrailer = new Map();
function trailerDe(id) {
  const ext = filmesExternos.get(id);
  if (ext) return Promise.resolve(ext.trailerId && ext.trailerId !== 'nenhum' ? ext.trailerId : null);
  if (!buscasTrailer.has(id)) {
    buscasTrailer.set(id, api.obterTrailer(id).then((videoId) => {
      const f = porId(id);
      if (f && videoId) f.trailerId = videoId;
      return videoId;
    }, () => { buscasTrailer.delete(id); return null; }));
  }
  return buscasTrailer.get(id);
}

function comandoTrailer(iframe, func, args = []) {
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }
}

const ICONE_MUDO = icone('VolumeX');
const ICONE_SOM = icone('Volume2');
const ICONE_PLAY = icone('Play');
const ICONE_MAIS_INFO = icone('ChevronDown');
// Logo do Letterboxd desenhado como o oficial (letterboxd-decal-dots): três
// círculos sobrepostos, laranja e azul cortados pelo verde, com as interseções
// em branco (versão para fundo escuro).
const LB_PONTOS = `<svg class="lb-pontos" viewBox="0 0 378 140" aria-hidden="true">
  <circle cx="189" cy="70" r="70" fill="#00E054"/>
  <path d="M129.85 33.7A70 70 0 1 0 129.85 106.3Z" fill="#FF8000"/>
  <path d="M248.15 33.56A70 70 0 1 1 248.15 106.44Z" fill="#40BCF4"/>
  <path d="M129.54 107.02C122.81 96.28 118.92 83.58 118.92 69.97S122.81 43.67 129.54 32.92C136.27 43.67 140.16 56.37 140.16 69.97S136.27 96.28 129.54 107.02Z" fill="#FFF"/>
  <path d="M248.46 32.92C255.19 43.67 259.08 56.37 259.08 69.97S255.19 96.28 248.46 107.02C241.73 96.28 237.84 83.58 237.84 69.97S241.73 43.67 248.46 32.92Z" fill="#FFF"/>
</svg>`;
const iconeSom = () => (estado.som ? ICONE_SOM : ICONE_MUDO);
const tituloSom = () => (estado.som ? 'Desligar o som' : 'Ligar o som');

function alternarSom() {
  estado.som = !estado.som;
  for (const fr of $$('iframe[data-fundo]')) comandoTrailer(fr, estado.som ? 'unMute' : 'mute');
  for (const b of $$('[data-d="som"], [data-v="som"], [data-p="som"]')) { b.innerHTML = iconeSom(); b.title = tituloSom(); }
}

// ---------- Trailer em foco: quase a tela toda, com som e controles ----------

const foco = $('#foco');

async function abrirFoco(id, tempo = 0) {
  const f = porId(id);
  if (!f) return;
  fecharPrevia(false);
  pausarDestaque('foco');
  comandoTrailer($('#painel .painel-video'), 'pauseVideo');
  foco.hidden = false;
  $('#foco-caixa').innerHTML = `
    <div class="foco-cabecalho">
      <h2>${esc(f.titulo)}${f.ano ? ` <span style="color:var(--texto-3);font-weight:600">${esc(f.ano)}</span>` : ''}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-assistir" data-f="stremio">${icone('Play')} Assistir</button>
        <button class="btn" data-f="fechar" title="Fechar (Esc)">${icone('X')} Fechar</button>
      </div>
    </div>
    <div class="foco-video"><p class="mensagem carregando">Procurando o trailer</p></div>`;
  foco.dataset.id = id;
  const videoId = await trailerDe(id);
  if (foco.hidden || foco.dataset.id !== id) return;
  const area = $('.foco-video', foco);
  if (!videoId) {
    area.innerHTML = '<p class="mensagem">Não achei o trailer. Cole um link do YouTube no campo “Trailer” do painel.</p>';
    return;
  }
  area.replaceChildren(iframeTrailer(videoId, '', { mudo: false, controles: true, inicio: tempo }));
}

function fecharFoco() {
  if (foco.hidden) return;
  foco.hidden = true;
  foco.dataset.id = '';
  $('#foco-caixa').innerHTML = '';
  retomarDestaque('foco');
  if (estado.painelId) comandoTrailer($('#painel .painel-video'), 'playVideo');
}

foco.addEventListener('click', (e) => {
  if (e.target === foco) { fecharFoco(); return; }
  const b = e.target.closest('[data-f]');
  if (!b) return;
  if (b.dataset.f === 'fechar') fecharFoco();
  if (b.dataset.f === 'stremio') abrirStremio(foco.dataset.id);
});

// Botão de tela cheia do painel: continua de onde o trailer de fundo estava.
function abrirTrailer(id) {
  abrirFoco(id, Number($('#painel .painel-video')?.dataset.tempo) || 0);
}

// ---------- Informações (TMDB; notas do OMDb) ----------

function duracaoLegivel(texto) {
  const min = parseInt(texto, 10);
  if (!min) return '';
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`;
}

// Duração do TMDB (f.duracao, em minutos) ou, se não houver, a do OMDb.
const duracaoDe = (f) => duracaoLegivel(f.duracao || (f.info && f.info.duracao) || '');
const generos = (info) => (info && info.genero ? info.genero.split(',').map((g) => g.trim()).filter(Boolean) : []);

// Destaque: "Crime • 1995 • 2h 50m • R", como "Show • Anime • 2026 • 16+" na Netflix.
function metaHTML(f) {
  const info = f.info || {};
  const partes = [];
  const g = generos(info);
  if (g.length) partes.push(esc(g.slice(0, 2).join(', ')));
  if (f.ano) partes.push(esc(f.ano));
  if (duracaoDe(f)) partes.push(esc(duracaoDe(f)));
  let html = partes.map((p) => `<span>${p}</span>`).join('');
  if (info.classificacao) html += ` <span class="classificacao">${esc(info.classificacao)}</span>`;
  if (f.favorito) html += '<span style="color:var(--dourado)">★ Favorito</span>';
  return html;
}

// Prévia: "[R] 1995 2h 50m", com os gêneros na linha de baixo.
function metaCurtaHTML(f) {
  const info = f.info || {};
  let html = '';
  if (info.classificacao) html += `<span class="classificacao">${esc(info.classificacao)}</span> `;
  html += [f.ano, duracaoDe(f)].filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('');
  if (f.favorito) html += '<span style="color:var(--dourado)">★ Favorito</span>';
  if (f.visto) html += '<span style="color:var(--verde)">✔ Visto</span>';
  return html;
}

function notasHTML(info) {
  if (!info) return '';
  const chips = [];
  if (info.anilist) chips.push(`<span class="nota-chip" title="Nota média na AniList"><span class="marca-anilist">AniList</span>${esc(info.anilist)}%</span>`); // NANDRoll
  if (info.imdb) chips.push(`<span class="nota-chip" title="Nota no IMDb"><span class="marca-imdb">IMDb</span>${esc(info.imdb)}</span>`);
  if (info.metascore) {
    const n = Number(info.metascore);
    const cor = n >= 61 ? '#54a72a' : n >= 40 ? '#d3a400' : '#e8302b';
    chips.push(`<span class="nota-chip" title="Metascore"><span class="marca-meta" style="background:${cor}">${esc(info.metascore)}</span><span class="rotulo-nota">Metascore</span></span>`);
  }
  if (info.rotten) {
    const fresco = parseInt(info.rotten, 10) >= 60;
    chips.push(`<span class="nota-chip" title="Rotten Tomatoes">${fresco ? '🍅' : '🤢'} ${esc(info.rotten)}</span>`);
  }
  return chips.join('');
}

function creditosHTML(f) {
  const partes = [];
  if (f.diretor) partes.push(`<b>Direção:</b> ${esc(f.diretor)}`);
  if (f.info && f.info.elenco) partes.push(`<b>Elenco:</b> ${esc(f.info.elenco.split(',').slice(0, 3).map((n) => n.trim()).join(', '))}`);
  return partes.join(' &nbsp;·&nbsp; ');
}

async function carregarInfo(f) {
  if (f.info || !f.imdbID) return f.info || null;
  const r = await api.infoFilme(f.id);
  if (r.ok && r.info) f.info = r.info;
  return f.info || null;
}

function fundoDesfocado(el, f) {
  const src = srcCapa(f);
  if (src) $('.destaque-fundo-capa', el).style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
}

// ---------- Destaque: o sorteado ocupa o topo, como um carrossel ----------

let tokenDestaque = 0;
const origemSorteio = new Map();
const filmeNoDestaque = () => estado.historico[estado.indiceDestaque] || null;
// O próximo sorteio já é escolhido antes, para o trailer dele ir sendo buscado.
let proximoSorteio = null;

// ---------- Filtros do sorteio ----------

// Guardados nas configurações. Valem só para o sorteio (a lista da tela não muda):
// duração máxima ("tenho 1h40"), gêneros, décadas, países e "só da watchlist de hoje".
const FILTROS_SORTEIO_VAZIOS = { duracao: 0, generos: [], decadas: [], paises: [], listas: [], soWatchlist: false };
const filtrosSorteio = () => ({ ...FILTROS_SORTEIO_VAZIOS, ...(estado.config.filtrosSorteio || {}) });
const minutosDe = (f) => f.duracao || parseInt(f.info && f.info.duracao, 10) || 0;
const decadaDe = (f) => { const a = anoNumero(f.ano); return Number.isFinite(a) ? Math.floor(a / 10) * 10 : null; };

function filtrosSorteioAtivos(fs = filtrosSorteio()) {
  return Boolean(fs.duracao || fs.generos.length || fs.decadas.length || fs.paises.length || fs.listas.length || fs.soWatchlist);
}

function passaNoSorteio(f, fs) {
  if (fs.duracao) { const m = minutosDe(f); if (!m || m > fs.duracao) return false; }
  if (fs.generos.length && !generos(f.info).some((g) => fs.generos.includes(g))) return false;
  if (fs.decadas.length && !fs.decadas.includes(decadaDe(f))) return false;
  if (fs.paises.length && !paisesDe(f).some((p) => fs.paises.includes(p))) return false;
  if (fs.listas.length && !listasDe(f).some((l) => fs.listas.includes(l))) return false;
  return true;
}

// Quem pode ser sorteado: os não vistos da tela (ou da watchlist de hoje) que passam nos filtros.
// `paraHoje` (página de hoje do calendário): qualquer não visto que ainda não está na watchlist.
function candidatosSorteio(fs = filtrosSorteio(), { paraHoje = false } = {}) {
  if (paraHoje) {
    const naLista = new Set(idsWatchlist());
    return estado.filmes.filter((f) => !f.visto && !naLista.has(f.id) && passaNoSorteio(f, fs));
  }
  const base = fs.soWatchlist ? idsWatchlist(hoje()).map(porId).filter(Boolean) : filtrados();
  return base.filter((f) => !f.visto && passaNoSorteio(f, fs));
}

function resumoFiltrosSorteio(fs = filtrosSorteio()) {
  const partes = [];
  if (fs.soWatchlist) partes.push('watchlist de hoje');
  if (fs.duracao) partes.push(`até ${duracaoLegivel(fs.duracao)}`);
  if (fs.generos.length) partes.push(fs.generos.join(', '));
  if (fs.decadas.length) partes.push(fs.decadas.map((d) => `anos ${String(d).slice(2)}`).join(', '));
  if (fs.paises.length) partes.push(fs.paises.join(', '));
  if (fs.listas.length) partes.push(fs.listas.join(', '));
  return partes;
}

// `paraHoje`: aberto pela página de hoje do calendário; "Sortear" faz a roleta
// de capas e põe o escolhido na watchlist de hoje (e "Sortear de" não aparece).
function abrirFiltrosSorteio({ paraHoje = false, botao = null } = {}) {
  let fs = filtrosSorteio();
  const naoVistos = estado.filmes.filter((f) => !f.visto);
  const contar = (lista) => [...lista.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const generosTodos = contar(naoVistos.flatMap((f) => generos(f.info)));
  const decadasTodas = contar(naoVistos.map(decadaDe).filter((d) => d !== null)).sort((a, b) => a[0] - b[0]);
  const paisesTodos = contar(naoVistos.flatMap((f) => paisesDe(f)));
  const listasTodas = contar(naoVistos.flatMap(listasDe));
  const DURACOES = [0, 90, 100, 120, 150];
  const chip = (grupo, valor, rotulo, ativo, qtd) => `<button class="chip${ativo ? ' ativo' : ''}" data-grupo="${grupo}" data-valor="${esc(valor)}" aria-pressed="${ativo}">${esc(rotulo)}${qtd ? `<span class="chip-qtd">${qtd}</span>` : ''}</button>`;
  const secao = (titulo, nome, classe = '') => `<div class="secao"><h3>${titulo}</h3><div class="chips-linha ${classe}" data-secao="${nome}"></div></div>`;

  abrirModal(`${cabecalhoModal('Filtros do sorteio')}
    <div class="modal-corpo filtros-sorteio">
      ${secao('Sortear de', 'origem')}
      ${listasTodas.length ? secao('Das suas listas', 'listas') : ''}
      ${secao('Quanto tempo você tem?', 'duracao')}
      ${generosTodos.length ? secao('Gêneros', 'generos') : ''}
      ${decadasTodas.length ? secao('Década', 'decadas') : ''}
      ${paisesTodos.length ? secao('País', 'paises', 'chips-rolam') : ''}
    </div>
    <div class="modal-rodape">
      <span class="filtros-contagem" id="filtros-contagem"></span>
      <button class="btn btn-fantasma" id="filtros-limpar">Limpar filtros</button>
      <button class="btn btn-primario" id="filtros-sortear">${icone('Dices')} Sortear</button>
    </div>`, 'modal-filtros');

  const desenhar = () => {
    const html = {
      origem: chip('origem', 'tela', paraHoje ? 'Filmes fora da watchlist' : 'Não vistos da lista', !fs.soWatchlist) + chip('origem', 'watchlist', paraHoje ? 'Um da watchlist de hoje' : 'Só da watchlist de hoje', fs.soWatchlist, idsWatchlist(hoje()).length || ''),
      duracao: DURACOES.map((m) => chip('duracao', m, m ? `Até ${duracaoLegivel(m)}` : 'Qualquer duração', fs.duracao === m)).join(''),
      generos: generosTodos.map(([g, n]) => chip('generos', g, g, fs.generos.includes(g), n)).join(''),
      decadas: decadasTodas.map(([d, n]) => chip('decadas', d, `Anos ${d < 2000 ? String(d).slice(2) : d}`, fs.decadas.includes(d), n)).join(''),
      paises: paisesTodos.map(([p, n]) => chip('paises', p, p, fs.paises.includes(p), n)).join(''),
      listas: listasTodas.map(([l, n]) => chip('listas', l, l, fs.listas.includes(l), n)).join(''),
    };
    for (const [nome, h] of Object.entries(html)) { const el = $(`[data-secao="${nome}"]`, modal); if (el) el.innerHTML = h; }
    const n = candidatosSorteio(fs, { paraHoje: paraHoje && !fs.soWatchlist }).length;
    $('#filtros-contagem', modal).textContent = n === 1 ? '1 filme pode ser sorteado' : `${n} filmes podem ser sorteados`;
    $('#filtros-sortear', modal).disabled = !n;
    $('#filtros-limpar', modal).disabled = !filtrosSorteioAtivos(fs);
  };
  const salvar = () => {
    estado.config.filtrosSorteio = fs;
    api.salvarConfig({ filtrosSorteio: fs });
    atualizarBotaoFiltros();
    desenhar();
  };
  $('.filtros-sorteio', modal).addEventListener('click', (e) => {
    const b = e.target.closest('[data-grupo]');
    if (!b) return;
    const { grupo, valor } = b.dataset;
    const alternarEm = (lista, v) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
    if (grupo === 'origem') fs = { ...fs, soWatchlist: valor === 'watchlist' };
    if (grupo === 'duracao') fs = { ...fs, duracao: Number(valor) };
    if (grupo === 'generos') fs = { ...fs, generos: alternarEm(fs.generos, valor) };
    if (grupo === 'decadas') fs = { ...fs, decadas: alternarEm(fs.decadas, Number(valor)) };
    if (grupo === 'paises') fs = { ...fs, paises: alternarEm(fs.paises, valor) };
    if (grupo === 'listas') fs = { ...fs, listas: alternarEm(fs.listas, valor) };
    salvar();
  });
  $('#filtros-limpar', modal).onclick = () => { fs = { ...FILTROS_SORTEIO_VAZIOS }; salvar(); };
  $('#filtros-sortear', modal).onclick = () => { fecharModal(); if (paraHoje) sortearParaHoje(botao, { comFiltro: true }); else sortear(); };
  desenhar();
}

// No dado do topo: ao passar o mouse, aparece "Sortear com filtro" embaixo dele.
// Com filtro ligado, o dado ganha um ponto roxo e o botão diz quantos filtros há.
function atualizarBotaoFiltros() {
  const grupo = $('#sortear-topo');
  const resumo = resumoFiltrosSorteio();
  grupo.classList.toggle('filtro-on', resumo.length > 0);
  $('.sortear-filtros-texto', grupo).textContent = resumo.length ? `Filtros (${resumo.length})` : 'Sortear com filtro';
  $('.sortear-filtros', grupo).title = resumo.length ? `Filtros do sorteio: ${resumo.join(' · ')}` : 'Sortear só por duração, gênero, década, país ou da watchlist de hoje';
}

function sortear({ rolar = true, avisarSeVazio = true } = {}) {
  if (!estado.filmes.length) return;
  const fs = filtrosSorteio();
  const candidatos = candidatosSorteio(fs);
  if (!candidatos.length) {
    if (!avisarSeVazio) return;
    if (filtrosSorteioAtivos(fs)) aviso('Nenhum filme não visto passa nos filtros do sorteio.', { acao: { rotulo: 'Ajustar filtros', fn: abrirFiltrosSorteio } });
    else aviso('Você já viu todos! 🎉', { tipo: 'ok' });
    return;
  }
  // Evita repetir os últimos sorteados quando há outras opções.
  const recentes = new Set(estado.historico.slice(-5));
  const opcoes = candidatos.filter((f) => !recentes.has(f.id));
  const lista = opcoes.length ? opcoes : candidatos;
  const aleatorio = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const f = lista.find((x) => x.id === proximoSorteio) || aleatorio(lista);
  const resto = lista.filter((x) => x.id !== f.id);
  proximoSorteio = resto.length ? aleatorio(resto).id : null;
  if (proximoSorteio) trailerDe(proximoSorteio);

  const filtros = [];
  const daTela = !fs.soWatchlist; // a watchlist de hoje ignora os filtros da tela
  if (daTela && estado.filtro === 'favoritos') filtros.push('★ Favoritos');
  if (daTela && estado.diretor) filtros.push(estado.diretor);
  if (daTela && estado.pais) filtros.push(estado.pais);
  filtros.push(...resumoFiltrosSorteio(fs));
  if (daTela && estado.busca.trim()) filtros.push(`“${estado.busca.trim()}”`);
  origemSorteio.set(f.id, `Sorteado entre ${candidatos.length} não visto${candidatos.length === 1 ? '' : 's'}${filtros.length ? ` · ${filtros.join(' · ')}` : ''}`);

  estado.historico = estado.historico.filter((id) => id !== f.id);
  estado.historico.push(f.id);
  if (estado.historico.length > 12) estado.historico.shift();
  estado.indiceDestaque = estado.historico.length - 1;
  mostrarDestaque();
  if (rolar) rolarTopo();
}

function mostrarDestaque(opcoes = {}) {
  const el = $('#destaque');
  const f = porId(filmeNoDestaque());
  if (!f) { fecharDestaque(); return; }
  const token = ++tokenDestaque;
  const n = estado.historico.length;
  const i = estado.indiceDestaque;
  $('#secao-sorteado').hidden = false;
  atualizarTopo();
  el.className = 'destaque';
  el.innerHTML = `
    <div class="destaque-fundo"><div class="destaque-fundo-capa"></div></div>
    <div class="destaque-sombra"></div>
    <div class="destaque-controles">
      <button class="btn-redondo" data-d="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
    </div>
    <div class="destaque-info">
      <div class="destaque-identidade">
        <div class="destaque-poster" data-d="detalhes" title="Mais informações">${capaHTML(f, { tamanho: 'grande' })}</div>
        <div class="destaque-titulo">
          ${tituloHTML(f)}
          <div class="meta-linha" data-info="meta">${metaHTML(f)}</div>
        </div>
      </div>
      <div class="destaque-textos">
        <div class="notas-linha" data-info="notas">${notasHTML(f.info)}</div>
        <p class="sinopse" data-info="sinopse"${f.info && f.info.sinopse ? '' : ' hidden'}>${esc(f.info ? f.info.sinopse : '')}</p>
        <p class="creditos" data-info="creditos">${creditosHTML(f)}</p>
        <div class="destaque-botoes">
          <button class="btn btn-assistir" data-d="assistir">${ICONE_PLAY} Assistir</button>
          <button class="btn btn-claro" data-d="detalhes">${icone('Info')} Mais info</button>
          <button class="redondo" data-d="sortear" title="Sortear outro" aria-label="Sortear outro">${icone('Dices')}</button>
          <button class="redondo${f.visto ? ' visto-on' : ''}" data-d="visto" title="${f.visto ? 'Desmarcar visto' : 'Marcar como visto'}" aria-label="Visto" aria-pressed="${f.visto}">${icone('Check')}</button>
          <button class="redondo" data-d="letterboxd" title="Logar no Letterboxd" aria-label="Logar no Letterboxd">${LB_PONTOS}</button>
        </div>
      </div>
    </div>
    <button class="seta seta-esq" data-d="anterior" ${i <= 0 ? 'disabled' : ''} title="Sorteado anterior" aria-label="Sorteado anterior">${icone('ChevronLeft')}</button>
    <button class="seta seta-dir" data-d="proximo" ${i >= n - 1 ? 'disabled' : ''} title="Próximo" aria-label="Próximo sorteado">${icone('ChevronRight')}</button>
    ${n > 1 ? `<div class="pontos">${estado.historico.map((_, k) => `<button data-ir="${k}" class="${k === i ? 'ativo' : ''}" title="Sorteio ${k + 1}" aria-label="Sorteio ${k + 1}"></button>`).join('')}</div>` : ''}
    <span class="dica-foco">Clique no trailer para ver em tela cheia</span>`;
  fundoDesfocado(el, f);
  atualizarBotaoFiltros();
  entradaDestaque(el, opcoes);
  carregarExtrasDestaque(f, token);
}

// O fundo surge e se aproxima; depois rótulo, título, dados, sinopse e botões sobem em sequência.
function entradaDestaque(el, { rapido = false } = {}) {
  if (Movimento.desligado()) { Movimento.cruzar($('.destaque-info', el), 120); return; }
  const fator = rapido ? 0.6 : 1;
  Movimento.animar($('.destaque-fundo', el), [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'none' }],
    { duration: 700 * fator, fill: 'backwards' });
  const t = $('.destaque-textos', el);
  Movimento.sequencia([$('.destaque-poster', el), $('.destaque-titulo h2', el), $('.destaque-titulo .meta-linha', el), $('.sinopse', t), $('.destaque-botoes', t)],
    { y: 16, duracao: 500 * fator, passo: 60 * fator, atrasoInicial: 120 * fator });
}

async function carregarExtrasDestaque(f, token) {
  const el = $('#destaque');
  carregarInfo(f).then((info) => {
    if (!info || token !== tokenDestaque) return;
    $('[data-info="meta"]', el).innerHTML = metaHTML(f);
    $('[data-info="notas"]', el).innerHTML = notasHTML(info);
    $('[data-info="creditos"]', el).innerHTML = creditosHTML(f);
    const sinopse = $('[data-info="sinopse"]', el);
    sinopse.textContent = info.sinopse;
    sinopse.hidden = !info.sinopse;
  });
  const videoId = await trailerDe(f.id);
  if (token !== tokenDestaque) return;
  if (!videoId) { el.classList.add('sem-trailer'); return; }
  f.trailerId = videoId;
  const fr = iframeTrailer(videoId, 'destaque-video', { mudo: !estado.som });
  fr.addEventListener('load', () => setTimeout(aplicarPausaDestaque, 800), { once: true });
  $('.destaque-fundo', el).append(fr);
  el.classList.add('com-trailer');
  $('[data-d="som"]', el).hidden = false;
}

function fecharDestaque() {
  tokenDestaque++;
  $('#destaque').innerHTML = '';
  $('#secao-sorteado').hidden = true;
  atualizarTopo();
}

$('#destaque').addEventListener('click', async (e) => {
  const id = filmeNoDestaque();
  if (!id) return;
  const ir = e.target.closest('[data-ir]');
  if (ir) { estado.indiceDestaque = Number(ir.dataset.ir); mostrarDestaque({ rapido: true }); return; }
  const b = e.target.closest('[data-d]');
  if (!b) {
    // Clicar no trailer (fora dos textos e botões) abre o modo foco.
    if (e.target.closest('.destaque-info')) return;
    const el = $('#destaque');
    if (el.classList.contains('com-trailer')) {
      const fr = $('.destaque-video', el);
      abrirFoco(id, Number(fr && fr.dataset.tempo) || 0);
    } else {
      abrirPainel(id);
    }
    return;
  }
  switch (b.dataset.d) {
    case 'assistir': abrirStremio(id); break;
    case 'letterboxd': abrirLetterboxd(id); break;
    case 'sortear': girarDado(b); sortear({ rolar: false }); break;
    case 'filtros': abrirFiltrosSorteio(); break;
    case 'detalhes': abrirPainel(id); break;
    case 'som': alternarSom(); break;
    case 'anterior': estado.indiceDestaque--; mostrarDestaque({ rapido: true }); break;
    case 'proximo': estado.indiceDestaque++; mostrarDestaque({ rapido: true }); break;
    case 'visto': {
      const f = porId(id);
      await alternar(id, 'visto');
      b.classList.toggle('visto-on', f.visto);
      b.setAttribute('aria-pressed', String(f.visto));
      b.title = f.visto ? 'Desmarcar visto' : 'Marcar como visto';
      break;
    }
  }
});

// O trailer do destaque pausa quando sai da tela, quando a prévia toca ou
// quando o modo foco está aberto.
const motivosPausa = new Set();
function aplicarPausaDestaque() {
  const fr = $('#destaque .destaque-video');
  if (!fr) return;
  comandoTrailer(fr, motivosPausa.size ? 'pauseVideo' : 'playVideo');
  comandoTrailer(fr, estado.som ? 'unMute' : 'mute');
}
function pausarDestaque(motivo) { motivosPausa.add(motivo); aplicarPausaDestaque(); }
function retomarDestaque(motivo) { motivosPausa.delete(motivo); aplicarPausaDestaque(); }

new IntersectionObserver(([entrada]) => {
  if (entrada.isIntersecting) retomarDestaque('rolagem');
  else pausarDestaque('rolagem');
}, { root: principal, threshold: 0.3 }).observe($('#destaque'));

// ---------- Prévia: 1 s com o mouse sobre a capa e ela "vira" o trailer ----------

const previa = $('#previa');
const ATRASO_PREVIA = 1000;
const LARGURA_PREVIA = 360;
let cartaoSobMouse = null;
let cartaoPrevia = null;
let timerPrevia = null;
let timerFecharPrevia = null;
let tokenPrevia = 0;
let previaId = null;

function agendarFecharPrevia() {
  clearTimeout(timerFecharPrevia);
  timerFecharPrevia = setTimeout(() => fecharPrevia(), 180);
}

function fecharPrevia(animar = true) {
  clearTimeout(timerFecharPrevia);
  if (previa.hidden) return;
  tokenPrevia++;
  const cartao = cartaoPrevia;
  previaId = null;
  cartaoPrevia = null;
  retomarDestaque('previa');
  const esconder = () => { previa.hidden = true; previa.innerHTML = ''; };
  if (!animar || !cartao || !cartao.isConnected) { esconder(); return; }
  // Encolhe de volta para a capa de onde saiu.
  const anim = previa.animate([{ transform: 'none', opacity: 1 }, { ...transformacaoDaCapa(cartao), opacity: 0 }],
    { duration: 160, easing: 'ease-in' });
  anim.onfinish = esconder;
}

function transformacaoDaCapa(cartao) {
  const r = $('.capa', cartao).getBoundingClientRect();
  const p = previa.getBoundingClientRect();
  return { transform: `translate(${r.left - p.left}px, ${r.top - p.top}px) scale(${r.width / p.width}, ${r.height / p.height})` };
}

// A prévia fica centrada sobre a capa (cobrindo-a), sem sair da janela.
function posicionarPrevia(cartao) {
  const r = $('.capa', cartao).getBoundingClientRect();
  const margem = 14;
  const h = previa.offsetHeight;
  const x = Math.min(Math.max(r.left + r.width / 2 - LARGURA_PREVIA / 2, margem), innerWidth - LARGURA_PREVIA - margem - 12);
  const topoMin = $('.topo').getBoundingClientRect().bottom + 8;
  const y = Math.min(Math.max(r.top + r.height / 2 - h / 2, topoMin), innerHeight - h - margem);
  previa.style.left = `${x}px`;
  previa.style.top = `${Math.max(y, topoMin)}px`;
}

function previaHTML(f) {
  return `
    <div class="previa-video" data-v="focar" title="Clique para ver em tela cheia">
      <div class="destaque-fundo-capa"></div>
      <div class="previa-titulo">${esc(f.titulo)}</div>
      <button class="btn-redondo" data-v="som" title="${tituloSom()}" hidden>${iconeSom()}</button>
    </div>
    <div class="previa-corpo">
      <div class="previa-botoes">
        <button class="redondo branco" data-v="stremio" title="Assistir no Stremio">${ICONE_PLAY}</button>
        <button class="redondo${f.visto ? ' visto-on' : ''}" data-v="visto" title="${f.visto ? 'Desmarcar visto' : 'Marcar como visto'}" aria-label="Visto">${icone('Check')}</button>
        <button class="redondo${f.favorito ? ' fav-on' : ''}" data-v="favorito" title="${f.favorito ? 'Tirar dos favoritos' : 'Favoritar'}" aria-label="Favorito">${icone('Star')}</button>
        <button class="redondo${naWatchlist(f.id) ? ' hoje-on' : ''}" data-v="hoje" title="${tituloHoje(naWatchlist(f.id))}" aria-label="${tituloHoje(naWatchlist(f.id))}">${icone('CalendarClock')}</button>
        <span class="espaco"></span>
        <button class="redondo" data-v="detalhes" title="Mais informações">${ICONE_MAIS_INFO}</button>
      </div>
      <div class="meta-linha" data-info="meta">${metaCurtaHTML(f)}</div>
      <div class="generos" data-info="generos">${esc(generos(f.info).slice(0, 3).join(' • '))}</div>
      <div class="notas-linha" data-info="notas">${notasHTML(f.info)}</div>
      ${f.diretor ? `<p class="creditos"><b>Direção:</b> ${esc(f.diretor)}</p>` : ''}
      ${f.notas ? `<p class="notas-pessoais">${esc(f.notas)}</p>` : ''}
    </div>`;
}

async function abrirPrevia(cartao) {
  if (modal.open || estado.painelId || !foco.hidden || !cartao.isConnected) return;
  const f = porId(cartao.dataset.id);
  if (!f) return;
  const token = ++tokenPrevia;
  previaId = f.id;
  cartaoPrevia = cartao;
  previa.innerHTML = previaHTML(f);
  fundoDesfocado(previa, f);
  previa.hidden = false;
  posicionarPrevia(cartao);
  // Cresce a partir da capa, como na Netflix.
  previa.animate([{ ...transformacaoDaCapa(cartao), opacity: 0.5 }, { transform: 'none', opacity: 1 }],
    { duration: 230, easing: 'cubic-bezier(.2, .75, .25, 1)' });
  pausarDestaque('previa');

  carregarInfo(f).then((info) => {
    if (token !== tokenPrevia || !info) return;
    $('[data-info="meta"]', previa).innerHTML = metaCurtaHTML(f);
    $('[data-info="generos"]', previa).textContent = generos(info).slice(0, 3).join(' • ');
    $('[data-info="notas"]', previa).innerHTML = notasHTML(info);
  });
  const videoId = await trailerDe(f.id);
  if (token !== tokenPrevia) return;
  const area = $('.previa-video', previa);
  if (!videoId) {
    area.insertAdjacentHTML('beforeend', '<div class="sem-trailer">Trailer não encontrado</div>');
    return;
  }
  f.trailerId = videoId;
  area.insertBefore(iframeTrailer(videoId, '', { mudo: !estado.som }), $('.previa-titulo', area));
  $('[data-v="som"]', area).hidden = false;
}

// Cartões da grade e da fileira de favoritos abrem a prévia.
// mousemove (e não mouseover) para que, depois de uma rolagem, a prévia volte a
// ser agendada assim que o mouse se mexer sobre a capa.
principal.addEventListener('mousemove', (e) => {
  // Mirando os botões redondos da capa: nada de trailer, só o clique que a pessoa quer.
  if (e.target.closest('.acoes')) {
    cartaoSobMouse = null;
    clearTimeout(timerPrevia);
    if (previaId) fecharPrevia(false);
    return;
  }
  const cartao = e.target.closest('.lista.grade .cartao, .fileira .cartao');
  if (!cartao || cartao === cartaoSobMouse) return;
  cartaoSobMouse = cartao;
  trailerDe(cartao.dataset.id);
  clearTimeout(timerPrevia);
  if (previaId) fecharPrevia(false);
  timerPrevia = setTimeout(() => abrirPrevia(cartao), ATRASO_PREVIA);
});

principal.addEventListener('mouseover', (e) => {
  if (!e.target.closest('.acoes')) return;
  cartaoSobMouse = null;
  clearTimeout(timerPrevia);
  if (previaId) fecharPrevia(false);
});

principal.addEventListener('mouseout', (e) => {
  const cartao = e.target.closest('.cartao');
  if (!cartao || (e.relatedTarget && cartao.contains(e.relatedTarget))) return;
  cartaoSobMouse = null;
  clearTimeout(timerPrevia);
});

previa.addEventListener('mouseenter', () => clearTimeout(timerFecharPrevia));
previa.addEventListener('mouseleave', () => {
  cartaoSobMouse = null;
  agendarFecharPrevia();
});

previa.addEventListener('click', async (e) => {
  if (!previaId) return;
  const id = previaId;
  const f = porId(id);
  const b = e.target.closest('[data-v]');
  if (!b) return;
  switch (b.dataset.v) {
    case 'som': e.stopPropagation(); alternarSom(); break;
    case 'focar': {
      const fr = $('.previa-video iframe', previa);
      abrirFoco(id, Number(fr && fr.dataset.tempo) || 0);
      break;
    }
    case 'stremio': abrirStremio(id); break;
    case 'letterboxd': abrirLetterboxd(id); break;
    case 'detalhes': fecharPrevia(false); abrirPainel(id); break;
    case 'remover': excluir(id); break;
    case 'visto':
    case 'favorito': {
      const campo = b.dataset.v;
      await alternar(id, campo);
      b.classList.toggle(campo === 'visto' ? 'visto-on' : 'fav-on', f[campo]);
      $('[data-info="meta"]', previa).innerHTML = metaCurtaHTML(f);
      break;
    }
    case 'hoje': alternarWatchlist(id); break;
  }
});

function atualizarBotaoHojePrevia() {
  const b = $('[data-v="hoje"]', previa);
  if (!b || !previaId) return;
  const naLista = naWatchlist(previaId);
  b.classList.toggle('hoje-on', naLista);
  b.title = tituloHoje(naLista);
  b.setAttribute('aria-label', tituloHoje(naLista));
}

principal.addEventListener('scroll', () => {
  clearTimeout(timerPrevia);
  cartaoSobMouse = null;
  fecharPrevia(false);
}, { passive: true });
window.addEventListener('blur', () => { clearTimeout(timerPrevia); fecharPrevia(false); });

// ---------- Configurações, importação e exportação ----------

// ---------- Chaves do TMDB e do OMDb ----------

// O TMDB é obrigatório (capas, logos, trailers e informações); o OMDb é opcional
// e só traz as notas do IMDb, Metascore e Rotten Tomatoes.
const CHAVES = {
  tmdb: {
    campo: 'tmdbKey',
    titulo: 'Chave do TMDB',
    testar: (chave) => api.testarChaveTmdb(chave),
    erro: 'Essa chave não funcionou. Confira se copiou a “Chave da API” inteira (ou o “Token de leitura”).',
    vazia: 'Cole a chave da API do TMDB.',
    semConexao: 'sem conexão com o TMDB',
    corpo: `
      <p>O nandflix usa o <b>TMDB</b> (The Movie Database) para buscar as capas, logos, trailers, sinopses e o resto das informações dos filmes. Cada pessoa usa a própria chave, que é <b>gratuita</b> e sem limite diário.</p>
      <ol>
        <li>Crie uma conta grátis no TMDB: <button class="link-chave" data-abrir="https://www.themoviedb.org/signup">themoviedb.org/signup</button> e confirme pelo e-mail.</li>
        <li>Abra <button class="link-chave" data-abrir="https://www.themoviedb.org/settings/api">themoviedb.org/settings/api</button> e peça uma chave (<b>Developer</b>). No formulário, o uso pode ser “app pessoal de catálogo de filmes”.</li>
        <li>Copie a <b>Chave da API</b> (32 letras e números) e cole aqui:</li>
      </ol>`,
    placeholder: 'Sua chave do TMDB',
  },
  omdb: {
    campo: 'omdbKey',
    titulo: 'Chave do OMDb (opcional)',
    testar: (chave) => api.testarChave(chave),
    erro: 'Essa chave não funcionou. Confira se copiou certinho e se já clicou no link de ativação do e-mail.',
    vazia: 'Cole a chave que chegou no seu e-mail.',
    semConexao: 'sem conexão com o OMDb',
    corpo: `
      <p>Opcional: com uma chave do <b>OMDb</b>, os filmes mostram as notas do <b>IMDb</b>, do <b>Rotten Tomatoes</b> e o <b>Metascore</b>. Sem ela, o app funciona igual, só sem essas notas. A chave é <b>gratuita</b> (1.000 consultas por dia).</p>
      <ol>
        <li>Abra a página de cadastro do OMDb: <button class="link-chave" data-abrir="https://www.omdbapi.com/apikey.aspx">omdbapi.com/apikey.aspx</button></li>
        <li>Escolha o plano <b>FREE</b>, preencha seu e-mail e o resto do formulário e clique em <b>Submit</b>.</li>
        <li>Abra o e-mail que o OMDb mandou e clique no <b>link de ativação</b>. Sem isso a chave não funciona.</li>
        <li>Copie a chave que veio no mesmo e-mail (8 letras e números, como <code>1a2b3c4d</code>) e cole aqui:</li>
      </ol>`,
    placeholder: 'Sua chave do OMDb',
  },
};

// Confere a chave e salva. Sem internet não dá para conferir, mas a chave é
// salva assim mesmo. Chave vazia (só no OMDb, que é opcional) tira a chave.
async function salvarChave(tipo, chave) {
  const c = CHAVES[tipo];
  chave = chave.trim();
  if (!chave && tipo === 'omdb') {
    estado.config = await api.salvarConfig({ omdbKey: '' });
    return { ok: true, removida: true };
  }
  if (!chave) return { ok: false, mensagem: c.vazia };
  const r = await c.testar(chave);
  if (!r.ok && r.erro.tipo === 'chave') return { ok: false, mensagem: c.erro };
  estado.config = await api.salvarConfig({ [c.campo]: chave });
  return { ok: true, conferida: r.ok || r.erro.tipo === 'limite' };
}

// A do TMDB abre ao iniciar enquanto não houver chave salva.
function pedirChave(tipo = 'tmdb') {
  const c = CHAVES[tipo];
  abrirModal(`${cabecalhoModal(c.titulo)}
    <div class="modal-corpo chave-omdb">
      ${c.corpo}
      <div class="busca-linha">
        <input id="chave-campo" placeholder="${c.placeholder}" value="${esc(estado.config[c.campo] || '')}" spellcheck="false" autocomplete="off">
        <button class="btn btn-primario" id="chave-salvar">Salvar chave</button>
      </div>
      <p class="chave-status" id="chave-status" role="status"></p>
    </div>
    <div class="modal-rodape"><button class="btn btn-fantasma" data-fechar>Agora não</button></div>`, 'modal-pequeno modal-chave');

  const campo = $('#chave-campo', modal);
  const status = $('#chave-status', modal);
  const botao = $('#chave-salvar', modal);
  $$('[data-abrir]', modal).forEach((b) => { b.onclick = () => window.open(b.dataset.abrir); });
  const salvar = async () => {
    botao.disabled = true;
    status.className = 'chave-status carregando';
    status.textContent = 'Conferindo a chave';
    const r = await salvarChave(tipo, campo.value);
    botao.disabled = false;
    if (!r.ok) {
      status.className = 'chave-status erro';
      status.textContent = r.mensagem;
      campo.focus();
      return;
    }
    fecharModal();
    if (r.removida) { aviso('Chave do OMDb removida: as notas do IMDb, Metascore e Rotten Tomatoes não serão mais buscadas.'); return; }
    const pronto = tipo === 'tmdb' ? 'Chave salva. As capas e informações vão começar a aparecer.' : 'Chave salva. As notas vão começar a aparecer.';
    aviso(r.conferida ? pronto : `Chave salva (não deu para conferir agora: ${c.semConexao}).`, { tipo: 'ok', duracao: 5000 });
  };
  botao.onclick = salvar;
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(); });
  campo.focus();
}
const pedirChaveTmdb = () => pedirChave('tmdb');
const pedirChaveOmdb = () => pedirChave('omdb');

function abrirConfiguracoes() {
  const c = estado.config;
  const pendentes = paraAtualizar();
  const naoEncontrados = estado.filmes.filter((f) => f.tmdbEm && !f.tmdbId).length;
  const mod = MAC ? '⌘' : 'Ctrl';
  abrirModal(`${cabecalhoModal('Configurações')}
    <div class="modal-corpo">
      <div class="secao">
        <h3>TMDB (capas, logos, trailers e informações)</h3>
        <div class="busca-linha" style="margin:0">
          <input id="cfg-chave-tmdb" value="${esc(c.tmdbKey || '')}" placeholder="Chave da API do TMDB" spellcheck="false">
          <button class="btn btn-laranja" id="cfg-salvar-tmdb">Salvar chave</button>
        </div>
        <p>Chave gratuita e sem limite diário. <button class="link-chave" id="cfg-como-tmdb">Como pegar a minha chave</button></p>
      </div>
      <div class="secao">
        <h3>OMDb (opcional: notas do IMDb, Metascore e Rotten Tomatoes)</h3>
        <div class="busca-linha" style="margin:0">
          <input id="cfg-chave" value="${esc(c.omdbKey || '')}" placeholder="Chave do OMDb (deixe vazio para não usar)" spellcheck="false">
          <button class="btn btn-laranja" id="cfg-salvar-chave">Salvar chave</button>
        </div>
        <p>Sem ela, o app funciona igual, só sem essas notas. <button class="link-chave" id="cfg-como-chave">Como pegar a minha chave</button></p>
      </div>
      <div class="secao">
        <h3>Abrir Stremio pelo</h3>
        <div class="opcoes-radio">
          <label><input type="radio" name="stremio" value="app" ${c.stremio !== 'web' ? 'checked' : ''}> App instalado</label>
          <label><input type="radio" name="stremio" value="web" ${c.stremio === 'web' ? 'checked' : ''}> Stremio Web</label>
        </div>
      </div>
${nandrollConfigHTML()}
      <div class="secao">
        <h3>Capas e informações</h3>
        <div class="linha-botoes">
          <button class="btn" id="cfg-capas" ${pendentes || naoEncontrados ? '' : 'disabled'} title="Capas, logos, trailers e informações pelo TMDB">${icone('RefreshCw')} Atualizar pelo TMDB${pendentes ? ` (${pendentes})` : ''}</button>
          ${c.omdbKey ? `<button class="btn" id="cfg-infos" ${semNotas() ? '' : 'disabled'} title="Notas do IMDb, Metascore e Rotten Tomatoes">${icone('Star')} Buscar notas que faltam (${semNotas()})</button>` : ''}
        </div>
        <p>${naoEncontrados ? `${naoEncontrados} filme(s) não foram encontrados no TMDB. Use “Trocar capa” ou preencha “Busca da capa” com o título original ou o código do IMDb (tt…).` : 'A atualização roda sozinha ao abrir o app.'}</p>
      </div>
      <div class="secao">
        <h3>Planilha e backup</h3>
        <div class="linha-botoes">
          <button class="btn" id="cfg-importar">Importar planilha</button>
          <button class="btn" id="cfg-exportar">Exportar para Excel</button>
          <button class="btn" id="cfg-backup-exp">Exportar backup</button>
          <button class="btn" id="cfg-backup-imp">Importar backup</button>
          <button class="btn" id="cfg-letterboxd" title="A pasta do export de dados do Letterboxd (Settings → Import &amp; Export), descompactada">${LB_PONTOS} Importar do Letterboxd</button>
          <button class="btn" id="cfg-capas-todas">${icone('Download')} Baixar todas as capas</button>
          <button class="btn btn-fantasma" id="cfg-pasta">Abrir pasta de dados</button>
        </div>
        <p>Tudo é salvo automaticamente. O backup exportado leva também watchlists, tierlists e listas.</p>
      </div>
      <div class="secao" id="cfg-nuvem" hidden>
        <h3>Nuvem (para usar no celular)</h3>
        <div id="cfg-nuvem-corpo"></div>
      </div>
      <div class="secao" id="cfg-backup-auto">
        <h3>Backup automático</h3>
        <p class="cfg-backup-status" id="cfg-backup-status">Carregando…</p>
        <div class="linha-botoes">
          <button class="btn" id="cfg-backup-pasta">${icone('FolderSync')} Copiar também para uma pasta…</button>
          <button class="btn" id="cfg-backup-restaurar">${icone('History')} Restaurar um dia…</button>
        </div>
      </div>
      <div class="secao">
        <h3>Atalhos</h3>
        <div class="atalhos">
          <kbd>${mod} F</kbd><span>Pesquisar</span>
          <kbd>${mod} K</kbd><span>Buscar em tudo (filmes, páginas, TMDB e ações)</span>
          <kbd>${mod} N</kbd><span>Adicionar filme</span>
          <kbd>R</kbd><span>Sortear</span>
          <kbd>Esc</kbd><span>Fechar painel ou janela</span>
        </div>
      </div>
      <p class="creditos-tmdb">NANDFlix ${esc(estado.versao || '')} · Este app usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.</p>
    </div>`);

  const salvarDoCampo = (tipo, seletor) => async () => {
    const r = await salvarChave(tipo, $(seletor, modal).value);
    if (!r.ok) { aviso(r.mensagem, { tipo: 'erro', duracao: 7000 }); return; }
    if (r.removida) { aviso('Chave do OMDb removida.'); return; }
    aviso(r.conferida ? 'Chave salva e conferida.' : `Chave salva (não deu para conferir agora: ${CHAVES[tipo].semConexao}).`, { tipo: 'ok' });
  };
  $('#cfg-salvar-tmdb', modal).onclick = salvarDoCampo('tmdb', '#cfg-chave-tmdb');
  $('#cfg-salvar-chave', modal).onclick = salvarDoCampo('omdb', '#cfg-chave');
  $('#cfg-como-tmdb', modal).onclick = pedirChaveTmdb;
  $('#cfg-como-chave', modal).onclick = pedirChaveOmdb;
  ligarNandrollConfig(modal); // NANDRoll
  $$('input[name="stremio"]', modal).forEach((r) => {
    r.onchange = async () => { estado.config = await api.salvarConfig({ stremio: r.value }); };
  });
  $('#cfg-capas', modal).onclick = () => { fecharModal(); buscarCapas({ incluirNaoEncontradas: true }); };
  $('#cfg-infos', modal)?.addEventListener('click', () => { fecharModal(); buscarInfos(); });
  $('#cfg-importar', modal).onclick = () => { fecharModal(); importarPlanilha(); };
  $('#cfg-exportar', modal).onclick = exportarPlanilha;
  $('#cfg-backup-exp', modal).onclick = async () => {
    const r = await api.exportarBackup();
    if (r.arquivo) aviso(`Backup salvo em ${r.arquivo}`, { tipo: 'ok', duracao: 6000 });
  };
  $('#cfg-backup-imp', modal).onclick = importarBackup;
  mostrarStatusBackup();
  mostrarNuvem();
  $('#cfg-backup-pasta', modal).onclick = async () => {
    const r = await api.escolherPastaBackup();
    if (r.cancelado) return;
    if (r.erro) aviso(`Não deu para gravar nessa pasta: ${r.erro}`, { tipo: 'erro', duracao: 7000 });
    else aviso('Pronto: os backups diários vão também para essa pasta.', { tipo: 'ok' });
    mostrarStatusBackup();
  };
  $('#cfg-backup-restaurar', modal).onclick = abrirRestaurarBackup;
  $('#cfg-letterboxd', modal).onclick = () => { fecharModal(); importarLetterboxd(); };
  $('#cfg-pasta', modal).onclick = () => api.abrirPastaDados();
  $('#cfg-capas-todas', modal).onclick = async () => {
    const r = await api.baixarTodasCapas();
    if (r.pasta) aviso(`${r.salvas} capas salvas em ${r.pasta}`, { tipo: 'ok', duracao: 6000 });
  };
}

async function exportarPlanilha() {
  const r = await api.exportarPlanilha();
  if (r.arquivo) aviso(`Planilha salva em ${r.arquivo}`, { tipo: 'ok', duracao: 6000 });
}

function substituirLista(filmes) {
  estado.filmes = filmes;
  cacheCartoes.clear();
  cacheFileira.clear();
  fecharPainel();
  estado.historico = [];
  estado.indiceDestaque = -1;
  fecharDestaque();
  render();
  sortear({ rolar: false, avisarSeVazio: false });
}

function mostrarResumo(titulo, r, extra = '') {
  abrirModal(`${cabecalhoModal(titulo)}
    <div class="modal-corpo">
      <div class="numeros">
        <div class="numero"><b>${r.total}</b><span>filmes</span></div>
        <div class="numero"><b style="color:var(--verde)">${r.vistos}</b><span>vistos</span></div>
        <div class="numero"><b style="color:var(--dourado)">${r.favoritos}</b><span>favoritos</span></div>
        <div class="numero"><b style="color:var(--azul)">${r.comCapa}</b><span>com capa</span></div>
      </div>
      ${extra}
    </div>
    <div class="modal-rodape"><button class="btn btn-laranja" data-fechar>OK</button></div>`);
}

async function importarPlanilha() {
  const r = await api.lerPlanilha();
  if (r.cancelado) return;
  if (r.erro) { aviso(r.erro, { tipo: 'erro', duracao: 7000 }); return; }
  let modo = 'substituir';
  if (r.jaTemFilmes) {
    modo = await perguntar({
      titulo: 'Importar planilha',
      texto: `“${r.arquivo}” tem ${r.total} filmes. Você quer substituir a lista atual ou juntar as duas? Ao juntar, filmes repetidos (mesmo IMDb, ou mesmo título e ano) mantêm os dados do app.`,
      botoes: [
        { rotulo: 'Cancelar', valor: null, classe: 'btn-fantasma' },
        { rotulo: 'Substituir tudo', valor: 'substituir', classe: 'btn-perigo' },
        { rotulo: 'Juntar', valor: 'juntar', classe: 'btn-laranja' },
      ],
    });
    if (!modo) return;
  }
  const res = await api.aplicarPlanilha(modo);
  if (res.erro) { aviso(res.erro, { tipo: 'erro' }); return; }
  substituirLista(res.filmes);
  const extra = modo === 'juntar'
    ? `<p style="margin:0;color:var(--texto-2)">${res.adicionados} filme(s) novos adicionados, ${res.repetidos} repetido(s) ignorados.</p>`
    : `<p style="margin:0;color:var(--texto-2)">${res.adicionados} filmes importados. As capas que faltam serão buscadas em segundo plano.</p>`;
  mostrarResumo('Planilha importada', res, extra);
  buscarCapas({ automatica: true });
}

// Pasta do export do Letterboxd: vistos (com as datas do diário de antes do
// calendário daqui), notas e a watchlist como filmes novos.
async function importarLetterboxd() {
  const r = await api.importarLetterboxd();
  if (r.cancelado) return;
  if (r.erro) { aviso(r.erro, { tipo: 'erro', duracao: 7000 }); return; }
  estado.filmes = r.filmes;
  cacheCartoes.clear();
  cacheFileira.clear();
  render();
  if (!calendario.hidden) renderCalendario();
  const linha = (n, texto) => (n ? `<li><b>${n}</b> ${texto}</li>` : '');
  const nada = !(r.novosWatchlist || r.novosVistos || r.marcadosVistos || r.datas || r.notas);
  abrirModal(`${cabecalhoModal('Letterboxd importado')}
    <div class="modal-corpo">
      ${nada ? '<p style="margin:0;color:var(--texto-2)">Nada novo: tudo do export já estava no NANDFlix.</p>' : `<ul class="resumo-importacao">
        ${linha(r.novosWatchlist, `filme${r.novosWatchlist === 1 ? '' : 's'} da watchlist adicionado${r.novosWatchlist === 1 ? '' : 's'} à lista`)}
        ${linha(r.novosVistos, `filme${r.novosVistos === 1 ? '' : 's'} visto${r.novosVistos === 1 ? '' : 's'} que não estava${r.novosVistos === 1 ? '' : 'm'} na lista`)}
        ${linha(r.marcadosVistos, `filme${r.marcadosVistos === 1 ? '' : 's'} da lista marcado${r.marcadosVistos === 1 ? '' : 's'} como visto${r.marcadosVistos === 1 ? '' : 's'}`)}
        ${linha(r.datas, `dia${r.datas === 1 ? '' : 's'} de filme no calendário`)}
        ${linha(r.notas, `nota${r.notas === 1 ? '' : 's'}`)}
      </ul>
      <p style="margin:12px 0 0;color:var(--texto-2)">As capas e informações dos filmes novos chegam em seguida, pelo TMDB.${r.primeiroDia ? ` O calendário agora começa em ${esc(mesLegivel(r.primeiroDia.slice(0, 7)))}.` : ''}</p>`}
    </div>
    <div class="modal-rodape">${r.datas ? '<button class="btn btn-fantasma" id="lb-calendario">Ver no calendário</button>' : ''}<button class="btn btn-laranja" data-fechar>OK</button></div>`);
  $('#lb-calendario', modal)?.addEventListener('click', () => { fecharModal(); abrirCalendario(`${r.primeiroDia}`); });
}

// ---------- Nuvem: conta e sincronia com o celular ----------

function statusNuvemTexto(st) {
  if (st.fase === 'sincronizando') return st.total ? `Sincronizando… ${st.enviados} de ${st.total}` : 'Sincronizando…';
  if (st.fase === 'erro') return `Não deu para sincronizar: ${st.erro}`;
  if (st.em) return `Em dia · sincronizado ${quandoLegivel(st.em)}`;
  return 'Conectando…';
}

async function mostrarNuvem(st) {
  const secao = $('#cfg-nuvem', modal);
  if (!secao) return;
  st = st || await api.statusNuvem();
  if (!modal.open || !$('#cfg-nuvem', modal)) return;
  if (st.indisponivel) return;
  secao.hidden = false;
  const corpo = $('#cfg-nuvem-corpo', modal);
  if (st.conta) {
    // Só atualiza o texto se já estiver mostrando a conta (não perde o foco dos botões).
    const linha = $('#cfg-nuvem-status', modal);
    if (linha && corpo.dataset.conta === st.conta) {
      linha.textContent = statusNuvemTexto(st);
      linha.classList.toggle('erro', st.fase === 'erro');
      return;
    }
    corpo.dataset.conta = st.conta;
    corpo.innerHTML = `
      <p>${icone('CloudCheck')}<span>Conectado como <b>${esc(st.conta)}</b>. Filmes, notas, páginas, watchlists, tierlists, listas e as chaves das APIs ficam iguais em todos os aparelhos com esta conta.</span></p>
      <p class="cfg-nuvem-status${st.fase === 'erro' ? ' erro' : ''}" id="cfg-nuvem-status" role="status">${esc(statusNuvemTexto(st))}</p>
      <div class="linha-botoes">
        <button class="btn" id="cfg-nuvem-agora">${icone('RefreshCw')} Sincronizar agora</button>
        <button class="btn btn-fantasma" id="cfg-nuvem-sair">Sair da conta</button>
      </div>`;
    $('#cfg-nuvem-agora', modal).onclick = async (e) => {
      e.currentTarget.disabled = true;
      await api.sincronizarNuvem();
      const b = $('#cfg-nuvem-agora', modal);
      if (b) b.disabled = false;
    };
    $('#cfg-nuvem-sair', modal).onclick = async () => {
      const ok = await perguntar({
        titulo: 'Sair da conta?',
        texto: 'Seus dados continuam neste computador e na nuvem, só param de sincronizar até você entrar de novo.',
        botoes: [{ rotulo: 'Cancelar', valor: false, classe: 'btn-fantasma' }, { rotulo: 'Sair', valor: true, classe: 'btn-laranja' }],
      });
      if (!ok) return;
      await api.sairNuvem();
      abrirConfiguracoes();
    };
    return;
  }
  delete corpo.dataset.conta;
  corpo.innerHTML = `
    <p>Entre com uma conta para ter a mesma lista no celular. Na primeira vez, tudo o que está aqui sobe para a nuvem.</p>
    <form class="cfg-nuvem-form" id="cfg-nuvem-form">
      <input type="email" id="cfg-nuvem-email" placeholder="E-mail" autocomplete="username" required>
      <input type="password" id="cfg-nuvem-senha" placeholder="Senha" title="Pelo menos 6 caracteres" autocomplete="current-password" minlength="6" required>
      <button class="btn btn-laranja" type="submit" data-acao="entrar">Entrar</button>
      <button class="btn" type="submit" data-acao="criar">Criar conta</button>
    </form>
    <p class="cfg-nuvem-status" id="cfg-nuvem-status" role="status"></p>`;
  const form = $('#cfg-nuvem-form', modal);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const criar = e.submitter && e.submitter.dataset.acao === 'criar';
    const status = $('#cfg-nuvem-status', modal);
    const botoes = $$('button', form);
    botoes.forEach((b) => { b.disabled = true; });
    status.className = 'cfg-nuvem-status carregando';
    status.textContent = criar ? 'Criando a conta' : 'Entrando';
    const email = $('#cfg-nuvem-email', modal).value;
    const senha = $('#cfg-nuvem-senha', modal).value;
    const r = criar ? await api.criarContaNuvem(email, senha) : await api.entrarNuvem(email, senha);
    if (!modal.open || !$('#cfg-nuvem-form', modal)) return;
    botoes.forEach((b) => { b.disabled = false; });
    if (r.erro) { status.className = 'cfg-nuvem-status erro'; status.textContent = r.erro; return; }
    if (r.confirmar) {
      status.className = 'cfg-nuvem-status';
      status.textContent = 'Conta criada. Abra o e-mail do Supabase e clique no link de confirmação (a página que abre pode dar erro, tudo bem). Depois clique em Entrar.';
      return;
    }
    mostrarNuvem(r);
  };
}

api.aoStatusNuvem((st) => {
  if (modal.open) mostrarNuvem(st);
});

// Mudanças que chegaram de outro aparelho.
api.aoMudarNuvem(({ filmes, removidos, config }) => {
  for (const novo of filmes) {
    const f = estado.filmes.find((x) => x.id === novo.id);
    if (f) {
      for (const k of Object.keys(f)) if (!(k in novo)) delete f[k];
      Object.assign(f, novo);
    } else {
      estado.filmes.push(novo);
    }
    cacheCartoes.delete(novo.id);
  }
  if (removidos.length) {
    estado.filmes = estado.filmes.filter((f) => !removidos.includes(f.id));
    for (const id of removidos) cacheCartoes.delete(id);
    if (removidos.includes(estado.painelId)) fecharPainel();
  }
  if (config) estado.config = config;
  cacheFileira.clear();
  agendarRender();
});

// ---------- Backup automático (um por dia, os 30 últimos) ----------

const horaLegivel = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function quandoLegivel(iso) {
  const dia = diaDe(new Date(iso));
  const ontem = diaDe(new Date(Date.now() - 864e5));
  const nome = dia === hoje() ? 'hoje' : dia === ontem ? 'ontem' : diaLegivel(dia, { comAno: dia.slice(0, 4) !== hoje().slice(0, 4) });
  return `${nome} às ${horaLegivel(iso)}`;
}

async function mostrarStatusBackup() {
  const el = $('#cfg-backup-status', modal);
  if (!el) return;
  const st = await api.statusBackup();
  if (!modal.open || !$('#cfg-backup-status', modal)) return;
  const ultimo = st.ultimo.em || (st.diarios[0] && st.diarios[0].salvoEm);
  const partes = [
    ultimo ? `Último backup: ${quandoLegivel(ultimo)}.` : 'Ainda não há backup.',
    `${st.diarios.length} ${st.diarios.length === 1 ? 'dia guardado' : 'dias guardados'} (ficam os 30 últimos; a cópia do dia é refeita a cada hora e ao fechar o app).`,
  ];
  el.innerHTML = esc(partes.join(' '))
    + (st.pastaExtra ? `<span class="cfg-backup-extra">${icone('FolderSync')} Também em <b>${esc(st.pastaExtra)}</b> <button class="link-chave" id="cfg-backup-tirar">não copiar mais</button></span>` : '')
    + (st.ultimo.erroExtra ? `<span class="cfg-backup-erro">Não deu para copiar para a pasta extra: ${esc(st.ultimo.erroExtra)}</span>` : '');
  $('#cfg-backup-pasta', modal).innerHTML = `${icone('FolderSync')} ${st.pastaExtra ? 'Trocar a pasta extra…' : 'Copiar também para uma pasta…'}`;
  $('#cfg-backup-restaurar', modal).disabled = !st.diarios.length;
  $('#cfg-backup-tirar', modal)?.addEventListener('click', async () => { await api.tirarPastaBackup(); mostrarStatusBackup(); });
}

async function abrirRestaurarBackup() {
  const st = await api.statusBackup();
  abrirModal(`${cabecalhoModal('Restaurar um dia')}
    <div class="modal-corpo">
      <p class="modal-texto">Volta a lista, as notas, as páginas, as watchlists, as tierlists e as listas para como estavam no fim daquele dia. O estado de agora é guardado antes, então dá para desfazer restaurando o backup de hoje.</p>
      <div class="backups-lista">${st.diarios.map((d) => `
        <button class="backup-item" data-arquivo="${esc(d.arquivo)}">
          ${icone('History')}
          <span><b>${esc(d.dia === hoje() ? 'Hoje' : diaLegivel(d.dia, { comAno: true }))}</b><small>salvo às ${horaLegivel(d.salvoEm)} · ${Math.max(1, Math.round(d.tamanho / 1024))} KB</small></span>
        </button>`).join('')}</div>
    </div>`, 'modal-pequeno');
  $('.backups-lista', modal).addEventListener('click', async (e) => {
    const b = e.target.closest('.backup-item');
    if (!b) return;
    const ok = await perguntar({
      titulo: 'Restaurar este backup?',
      texto: `A lista inteira volta para como estava em ${b.querySelector('b').textContent.toLowerCase() === 'hoje' ? 'hoje' : b.querySelector('b').textContent}. O app recarrega em seguida.`,
      botoes: [
        { rotulo: 'Cancelar', valor: false, classe: 'btn-fantasma' },
        { rotulo: 'Restaurar', valor: true, classe: 'btn-laranja' },
      ],
    });
    if (!ok) return;
    const r = await api.restaurarBackup(b.dataset.arquivo);
    if (r.erro) { aviso(r.erro, { tipo: 'erro' }); return; }
    location.reload();
  });
}

async function importarBackup() {
  const ok = await perguntar({
    titulo: 'Importar backup',
    texto: 'Importar um backup substitui a lista atual inteira. (A lista atual é guardada antes em backups.) Continuar?',
    botoes: [
      { rotulo: 'Cancelar', valor: false, classe: 'btn-fantasma' },
      { rotulo: 'Escolher arquivo…', valor: true, classe: 'btn-laranja' },
    ],
  });
  if (!ok) return;
  const r = await api.importarBackup();
  if (r.cancelado) return;
  if (r.erro) { aviso(r.erro, { tipo: 'erro', duracao: 6000 }); return; }
  if (r.comConfig) { location.reload(); return; } // watchlists e tierlists vieram junto
  substituirLista(r.filmes);
  mostrarResumo('Backup importado', r);
  buscarCapas({ automatica: true });
}

// ---------- Atualização pelo TMDB em segundo plano ----------

// Filmes que ainda não passaram pelo TMDB (os que vieram do OMDb, os novos e os
// que tiveram a "Busca da capa" mudada).
const paraAtualizar = () => estado.filmes.filter((f) => !f.tmdbEm).length;

async function buscarCapas(opcoes = {}) {
  if (!estado.config.tmdbKey) {
    if (!opcoes.automatica) aviso('Coloque a sua chave do TMDB para buscar as capas.', { acao: { rotulo: 'Colocar chave', fn: pedirChaveTmdb } });
    return;
  }
  await api.buscarCapas(opcoes);
}

// ---------- Notas do OMDb (IMDb, Metascore, Rotten Tomatoes), opcionais ----------

const semNotas = () => estado.filmes.filter((f) => f.imdbID && !(f.info && 'imdb' in f.info)).length;

async function buscarInfos() {
  const r = await api.buscarInfos();
  if (r.pulada === 'chave') { pedirChaveOmdb(); return; }
  if (r.emAndamento) { aviso('A busca de notas já está rodando.'); return; }
  if (!r.total) aviso('Todos os filmes já têm as notas.', { tipo: 'ok' });
}

api.aoProgressoInfos(({ feitos, total }) => {
  estado.buscandoInfos = true;
  if (estado.buscandoCapas) return; // a barra mostra a atualização pelo TMDB primeiro
  $('#progresso-capas').hidden = false;
  $('#progresso-cheio').style.width = `${total ? (feitos / total) * 100 : 0}%`;
  $('#progresso-texto').textContent = `Buscando notas do IMDb… ${feitos} de ${total}`;
});

api.aoFimInfos(({ faltam, erro }) => {
  estado.buscandoInfos = false;
  if (!estado.buscandoCapas) $('#progresso-capas').hidden = true;
  if (erro && erro.tipo === 'limite') {
    aviso(`O limite diário do OMDb acabou. Faltam as notas de ${faltam} filme(s); a busca continua amanhã, ao abrir o app.`, { tipo: 'erro', duracao: 9000 });
  } else if (erro) {
    const acao = erro.tipo === 'chave' ? { rotulo: 'Colocar chave', fn: pedirChaveOmdb } : undefined;
    aviso(erro.mensagem, { tipo: 'erro', duracao: 9000, acao });
  }
});

api.aoProgressoCapas(({ feitos, total }) => {
  estado.buscandoCapas = true;
  $('#progresso-capas').hidden = false;
  $('#progresso-cheio').style.width = `${total ? (feitos / total) * 100 : 0}%`;
  $('#progresso-texto').textContent = `Atualizando capas e informações pelo TMDB… ${feitos} de ${total}`;
  $('#btn-capas-faltam').hidden = true;
});

api.aoFimCapas((r) => {
  estado.buscandoCapas = false;
  if (!estado.buscandoInfos) $('#progresso-capas').hidden = true;
  atualizarEstatisticas();
  if (r.erro) {
    const acao = r.erro.tipo === 'chave' ? { rotulo: 'Configurações', fn: abrirConfiguracoes } : undefined;
    aviso(r.erro.mensagem, { tipo: 'erro', duracao: 9000, acao });
  } else if (r.total > 1) {
    aviso(`Atualização pelo TMDB concluída: ${r.encontradas} filme(s) atualizados.`, { tipo: 'ok' });
  }
});

api.aoMudarFilme((novo) => {
  const f = porId(novo.id);
  if (!f) return;
  // Só os campos da capa: o que o usuário está digitando no painel não é sobrescrito.
  const logoAntes = srcLogo(f);
  for (const k of ['imdbID', 'tmdbId', 'tmdbEm', 'poster', 'capaLocal', 'capaNaoEncontrada', 'capaPersonalizada', 'logo', 'logoLocal', 'info', 'duracao', 'duracaoDe', 'trailerId', 'trailerManual']) f[k] = novo[k];
  if (!f.diretor && novo.diretor) f.diretor = novo.diretor;
  // NANDRoll: o que a AniList trouxe (episódios, próximo episódio, onde assistir).
  const anilistAntes = f.anilistEm;
  for (const k of ['tipo', 'anime', 'anilistId', 'malId', 'formato', 'anilistEm', 'estudio', 'episodios', 'exibicao', 'proximoEpisodio', 'ondeAssistir', 'temporadas', 'episodiosVistos', 'status', 'capaTmdb', 'tmdbTvId', 'tmdbTvEm']) if (k in novo) f[k] = novo[k];
  if (novo.anilistEm !== anilistAntes) { if (novo.titulo) f.titulo = novo.titulo; if (novo.ano) f.ano = novo.ano; if (novo.diretor) f.diretor = novo.diretor; }
  if (novo.anilistEm !== anilistAntes && estado.painelId === f.id && !$('#painel-resto :focus')) { renderPainel(); $('#painel .destaque-titulo h2')?.replaceWith(htmlParaNo(tituloHTML(f))); }
  // A logo chegou (ou mudou): troca o título em texto por ela.
  if (srcLogo(f) !== logoAntes) {
    if (filmeNoDestaque() === f.id) $('#destaque .destaque-titulo h2')?.replaceWith(htmlParaNo(tituloHTML(f)));
    if (estado.painelId === f.id) $('#painel .destaque-titulo h2')?.replaceWith(htmlParaNo(tituloHTML(f)));
  }
  agendarRender();
  if (filmeNoDestaque() === f.id) {
    const capa = $('#destaque .destaque-poster .capa');
    fundoDesfocado($('#destaque'), f);
    if (capa) capa.outerHTML = capaHTML(f, { tamanho: 'grande' });
  }
  if (estado.painelId === f.id) {
    const capa = $('.painel-capa .capa');
    if (capa) capa.outerHTML = capaHTML(f, { tamanho: 'grande' });
  }
});

// ---------- Eventos da página ----------

principal.addEventListener('click', (e) => {
  const cartao = e.target.closest('.lista .cartao, .fileira .cartao');
  if (!cartao) return;
  const id = cartao.dataset.id;
  const botao = e.target.closest('[data-acao]');
  if (!botao) { abrirPainel(id); return; }
  e.stopPropagation();
  switch (botao.dataset.acao) {
    case 'visto': alternar(id, 'visto'); break;
    case 'favorito': alternar(id, 'favorito'); break;
    case 'hoje': alternarWatchlist(id); break;
    case 'stremio': abrirStremio(id); break;
    case 'letterboxd': abrirLetterboxd(id); break;
    case 'diretor': filtrarDiretor(porId(id).diretor); break;
  }
});

principal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('cartao')) abrirPainel(e.target.dataset.id);
});

let timerBusca = null;
$('#pesquisa').addEventListener('input', (e) => {
  clearTimeout(timerBusca);
  timerBusca = setTimeout(() => { estado.busca = e.target.value; render(); rolarParaLista(); }, 80);
});

$$('.chip[data-filtro]').forEach((chip) => {
  chip.addEventListener('click', () => {
    estado.filtro = chip.dataset.filtro;
    $$('.chip[data-filtro]').forEach((c) => {
      c.classList.toggle('ativo', c === chip);
      c.setAttribute('aria-checked', String(c === chip));
    });
    render();
    cruzarLista();
    rolarParaLista();
  });
});

$('#chip-diretor').addEventListener('click', () => filtrarDiretor(''));
$('#chip-pais').addEventListener('click', () => filtrarPais(''));
$('#btn-sem-adicionar').addEventListener('click', () => abrirAdicionar(estado.busca.trim()));

$('#ordenacao').addEventListener('change', async (e) => {
  estado.ordenacao = e.target.value;
  render();
  cruzarLista();
  estado.config = await api.salvarConfig({ ordenacao: estado.ordenacao });
});

function aplicarVista(vista) {
  estado.vista = vista;
  $$('.alternar-vista .btn').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.vista === vista);
    b.setAttribute('aria-pressed', String(b.dataset.vista === vista));
  });
  render();
}
$$('.alternar-vista .btn').forEach((b) => {
  b.addEventListener('click', async () => {
    aplicarVista(b.dataset.vista);
    cruzarLista();
    estado.config = await api.salvarConfig({ visualizacao: b.dataset.vista });
  });
});

$('#btn-sortear').addEventListener('click', (e) => { girarDado(e.currentTarget); sortear(); });
$('#btn-sortear-filtro').addEventListener('click', () => abrirFiltrosSorteio());

// Menus do topo: abrem ao passar o mouse na seta (ou ao clicar, pelo teclado).
// Escolher um item fecha a lista, mesmo com o mouse ainda em cima dela.
(() => {
  const menu = $('#menu-topo');
  const seta = $('#btn-menu-topo');
  const abrir = (sim) => {
    menu.classList.toggle('aberto', sim);
    seta.setAttribute('aria-expanded', String(sim));
  };
  seta.addEventListener('click', () => abrir(!menu.classList.contains('aberto')));
  menu.addEventListener('mouseenter', () => seta.setAttribute('aria-expanded', 'true'));
  menu.addEventListener('mouseleave', () => {
    menu.classList.remove('fechado');
    if (!menu.classList.contains('aberto')) seta.setAttribute('aria-expanded', 'false');
  });
  $('#menu-topo-lista').addEventListener('click', (e) => {
    if (!e.target.closest('.menu-topo-item')) return;
    abrir(false);
    menu.classList.add('fechado');
    document.activeElement?.blur?.();
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) abrir(false); });
  menu.addEventListener('keydown', (e) => {
    const itens = $$('.menu-topo-item', menu);
    const i = itens.indexOf(document.activeElement);
    if (e.key === 'Escape' && (menu.classList.contains('aberto') || i >= 0)) {
      e.stopPropagation(); abrir(false); seta.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      abrir(true);
      const n = itens.length;
      itens[e.key === 'ArrowDown' ? (i + 1 + n) % n : (i - 1 + n) % n].focus();
    }
  });
})();

// Retorno do botão de sortear: o dado dá meia-volta.
function girarDado(botao) {
  Movimento.animar($('.ico', botao), [{ transform: 'rotate(0)' }, { transform: 'rotate(180deg)' }], { duration: 240 });
}

// Pesquisa: só a lupa aparece; a caixa abre ao clicar nela (ou Ctrl/⌘ F).
function abrirPesquisa() {
  $('#pesquisa-caixa').classList.add('aberta');
  $('#pesquisa').tabIndex = 0;
  $('#pesquisa').focus();
  $('#pesquisa').select();
}
$('#btn-lupa').addEventListener('mousedown', (e) => e.preventDefault());
$('#btn-lupa').addEventListener('click', () => {
  if ($('#pesquisa-caixa').classList.contains('aberta') && !$('#pesquisa').value) $('#pesquisa').blur();
  else abrirPesquisa();
});
function fecharPesquisa() {
  $('#pesquisa-caixa').classList.remove('aberta');
  $('#pesquisa').tabIndex = -1;
}
$('#pesquisa').addEventListener('blur', () => {
  if (!$('#pesquisa').value) fecharPesquisa();
});
$('#btn-adicionar').addEventListener('click', () => abrirAdicionar());
$('#btn-adicionar-vazio').addEventListener('click', () => abrirAdicionar());
$('#btn-config').addEventListener('click', abrirConfiguracoes);
$('#btn-importar-vazio').addEventListener('click', importarPlanilha);
$('#btn-capas-faltam').addEventListener('click', () => buscarCapas({ incluirNaoEncontradas: true }));

function digitandoEm(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener('keydown', (e) => {
  if (typeof paginaFilme !== 'undefined' && !paginaFilme.hidden) {
    if (e.key === 'Escape' && !modal.open) { e.preventDefault(); fecharPagina(); }
    return;
  }
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (modal.open) fecharModal();
    abrirPesquisa();
    return;
  }
  if (mod && !e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    abrirAdicionar();
    return;
  }
  if (e.key === 'Escape' && !foco.hidden) {
    fecharFoco();
    return;
  }
  if (e.key === 'Escape' && !previa.hidden) {
    fecharPrevia();
    return;
  }
  if (e.key === 'Escape' && !modal.open && estado.painelId) {
    fecharPainel();
    return;
  }
  if (e.key === 'Escape' && !modal.open && !paginasTela.hidden) {
    fecharPaginas();
    return;
  }
  if (e.key === 'Escape' && !modal.open && !calendario.hidden) {
    // Na página de um dia, Esc volta para o mês (como a seta); no mês, fecha.
    if (diaCalendario) voltarParaMes();
    else fecharCalendario();
    return;
  }
  if (e.key === 'Escape' && !modal.open && !estatisticas.hidden && !estado.painelId) {
    fecharEstatisticas();
    return;
  }
  if (e.key === 'Escape' && !modal.open && !tierlist.hidden) {
    if ($('#tierlist .tl-paleta')) { fecharPaletaTier(); return; }
    if ($('#tierlist .tl-menu')) { fecharMenuTl(); return; }
    fecharTierlist();
    return;
  }
  if (e.key === 'Escape' && document.activeElement === $('#pesquisa')) {
    $('#pesquisa').value = '';
    estado.busca = '';
    render();
    $('#pesquisa').blur();
    fecharPesquisa();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && !modal.open && foco.hidden && calendario.hidden && tierlist.hidden && estatisticas.hidden && paginasTela.hidden && !digitandoEm(document.activeElement)) {
    e.preventDefault();
    sortear();
  }
});

// ---------- Calendário ----------

// Um mês por vez, de outubro de 2026 (quando a lista começou a registrar os
// dias), ou do mês mais antigo com um filme visto (as datas importadas do
// Letterboxd), até o mês atual. Cada dia mostra as capas do que foi visto; hoje mostra
// também a watchlist. Clicar num dia abre a página do dia, com as capas grandes.
const PRIMEIRO_MES = '2026-10';
const primeiroMes = () => estado.filmes.flatMap((f) => f.vistoEm || []).reduce((m, d) => (d.slice(0, 7) < m ? d.slice(0, 7) : m), PRIMEIRO_MES);
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const calendario = $('#calendario');
let mesCalendario = null; // 'AAAA-MM'
let diaCalendario = null; // 'AAAA-MM-DD' quando a página de um dia está aberta

function abrirCalendario(dia = null) {
  fecharPrevia(false);
  mesCalendario = (dia || hoje()).slice(0, 7);
  diaCalendario = dia;
  calendario.hidden = false;
  renderCalendario();
  Movimento.animar($('#calendario-caixa'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  if (dia) animarDia(); else animarMes();
  $('#calendario [data-c="fechar"], #calendario [data-c="voltar"]')?.focus({ preventScroll: true });
}

function fecharCalendario() {
  if (calendario.hidden) return;
  calendario.hidden = true;
  $('#calendario-caixa').innerHTML = '';
}

function vistosPorDia() {
  const mapa = new Map();
  for (const f of estado.filmes) {
    for (const dia of f.vistoEm || []) {
      if (!mapa.has(dia)) mapa.set(dia, []);
      if (!mapa.get(dia).includes(f)) mapa.get(dia).push(f);
    }
  }
  return mapa;
}

const mesLegivel = (mes) => { const [a, m] = mes.split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };
function mesVizinho(mes, passo) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderCalendario() {
  const caixa = $('#calendario-caixa');
  caixa.innerHTML = diaCalendario ? paginaDiaHTML(diaCalendario) : mesHTML(mesCalendario);
}

// Entradas do calendário: o mês desliza na direção da troca e as capas chegam em
// sequência; a página do dia sobe as capas grandes. Sem "reduzir movimento", nada anima.
function animarMes(direcao = 0) {
  const grade = $('#calendario .cal-grade');
  if (!grade) return;
  if (direcao) Movimento.animar(grade, [{ opacity: 0, transform: `translateX(${direcao * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 320 });
  Movimento.sequencia($$('#calendario .cal-vistos, #calendario .cal-wl'), { y: 8, duracao: 420, passo: 40, atrasoInicial: direcao ? 80 : 120 });
}
function animarDia() {
  const caixa = $('#calendario-caixa');
  Movimento.animar($('.cal-dia-fundo', caixa), [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'none' }], { duration: 600, fill: 'backwards' });
  Movimento.sequencia([$('.cal-dia-titulo', caixa), ...$$('.cal-filme', caixa)], { y: 14, duracao: 460, passo: 60, atrasoInicial: 60 });
}
// Troca de mês pelas setas: o mês que sai desliza para um lado e some enquanto o
// novo entra do outro, os dois cruzando no mesmo lugar. (A grade antiga fica por
// cima, sem receber cliques, só durante a animação.)
const DESLIZE_MES = 72;
function irParaMes(mes) {
  const direcao = mes > mesCalendario ? 1 : mes < mesCalendario ? -1 : 0;
  const caixa = $('#calendario-caixa');
  const velha = direcao && !diaCalendario && !Movimento.desligado() ? $('.cal-grade', caixa) : null;
  mesCalendario = mes;
  diaCalendario = null;
  renderCalendario();
  if (!velha) { animarMes(direcao); return; }

  const nova = $('.cal-grade', caixa);
  Object.assign(velha.style, {
    position: 'absolute', margin: '0', pointerEvents: 'none', zIndex: '1',
    left: `${nova.offsetLeft}px`, top: `${nova.offsetTop}px`,
    width: `${nova.offsetWidth}px`, height: `${nova.offsetHeight}px`,
  });
  velha.setAttribute('aria-hidden', 'true');
  caixa.append(velha);
  const saida = velha.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-direcao * DESLIZE_MES}px)` }],
    { duration: 300, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' },
  );
  saida.onfinish = () => velha.remove();
  saida.oncancel = () => velha.remove();
  Movimento.animar(nova, [{ opacity: 0, transform: `translateX(${direcao * DESLIZE_MES}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 460, delay: 40, fill: 'backwards' });
  Movimento.animar($('.cal-navegacao h2', caixa), [{ opacity: 0, transform: `translateX(${direcao * 16}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 360 });
  Movimento.sequencia($$('.cal-vistos, .cal-wl', nova), { y: 8, duracao: 420, passo: 40, atrasoInicial: 200 });
}

function voltarParaMes() {
  diaCalendario = null;
  renderCalendario();
  animarMes();
}
function irParaDia(dia) {
  diaCalendario = dia;
  renderCalendario();
  animarDia();
}

// `arrastarDe`: capa da watchlist daquele dia, que pode ser arrastada para outro dia.
// (A capa que se arrasta é um div que age como botão: clique e Enter abrem os
// detalhes; o arrasto é feito com o ponteiro, mais abaixo.)
function capinhaHTML(f, classe = '', arrastarDe = null) {
  if (arrastarDe) {
    return `<div class="cal-capa ${classe}" role="button" tabindex="0" data-arrastar="${arrastarDe}" data-c="detalhes" data-id="${f.id}" title="${esc(`${f.titulo} (arraste para outro dia)`)}" aria-label="${esc(f.titulo)}">${capaHTML(f)}</div>`;
  }
  return `<button class="cal-capa ${classe}" data-c="detalhes" data-id="${f.id}" title="${esc(f.titulo)}" aria-label="${esc(f.titulo)}">${capaHTML(f)}</button>`;
}

// Fundo desfocado de uma célula ou da página do dia: a própria capa do filme.
const fundoCapa = (f) => {
  const src = f && srcCapa(f);
  return src ? `background-image: url("${src.replace(/"/g, '%22')}")` : '';
};

// ---------- Filme do mês ----------

// Um por mês, entre os filmes vistos naquele mês, guardado nas configurações
// como { 'AAAA-MM': id }. Só aparece no calendário. Se o filme deixar de ter
// uma data naquele mês (a data foi apagada), ele deixa de valer.
function filmesVistosNoMes(mes) {
  return estado.filmes.filter((f) => (f.vistoEm || []).some((d) => d.startsWith(mes)));
}
function filmeDoMes(mes) {
  const id = (estado.config.filmesDoMes || {})[mes];
  const f = id && porId(id);
  return f && (f.vistoEm || []).some((d) => d.startsWith(mes)) ? f : null;
}
function definirFilmeDoMes(mes, id) {
  const todos = { ...(estado.config.filmesDoMes || {}) };
  if (id) todos[mes] = id;
  else delete todos[mes];
  estado.config.filmesDoMes = todos;
  api.salvarConfig({ filmesDoMes: todos });
  if (!calendario.hidden) renderCalendario();
  const nomeMes = MESES[Number(mes.slice(5)) - 1];
  if (id) aviso(`“${porId(id).titulo}” é o filme de ${nomeMes}.`, { tipo: 'ok' });
  else aviso(`${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)} ficou sem filme do mês.`);
}
function alternarFilmeDoMes(id, mes) {
  definirFilmeDoMes(mes, filmeDoMes(mes)?.id === id ? null : id);
}

// Janela para escolher (ou trocar) o filme do mês entre as capas dos vistos.
function escolherFilmeDoMes(mes) {
  const filmes = filmesVistosNoMes(mes);
  const atual = filmeDoMes(mes);
  const nomeMes = MESES[Number(mes.slice(5)) - 1];
  abrirModal(`${cabecalhoModal(`Filme de ${mesLegivel(mes)}`)}
    <div class="modal-corpo">
      <p class="filme-mes-ajuda">Dos ${filmes.length} filmes que você viu em ${esc(nomeMes)}, qual foi o seu favorito?</p>
      <div class="resultados filme-mes-opcoes">${filmes.map((f) => `
        <button class="resultado${atual && atual.id === f.id ? ' atual' : ''}" data-id="${f.id}">
          ${capaHTML(f)}
          <strong>${esc(f.titulo)}</strong><span>${esc(f.ano)}</span>
        </button>`).join('')}</div>
    </div>
    ${atual ? `<div class="modal-rodape"><button class="btn btn-fantasma" data-tirar-filme-do-mes>${icone('X')} Ficar sem filme do mês</button></div>` : ''}`);
  $$('.filme-mes-opcoes .resultado', modal).forEach((b) => {
    b.onclick = () => { fecharModal(); definirFilmeDoMes(mes, b.dataset.id); };
  });
  const tirar = $('[data-tirar-filme-do-mes]', modal);
  if (tirar) tirar.onclick = () => { fecharModal(); definirFilmeDoMes(mes, null); };
}

function mesHTML(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const deslocamento = new Date(ano, m - 1, 1).getDay();
  const diasNoMes = new Date(ano, m, 0).getDate();
  const porDia = vistosPorDia();
  const diaHoje = hoje();
  const mesAtual = diaHoje.slice(0, 7);
  const noMes = [...porDia.entries()].filter(([d]) => d.startsWith(mes)).reduce((n, [, fs]) => n + fs.length, 0);
  const wlHoje = idsWatchlist(diaHoje).length;
  const doMes = filmeDoMes(mes);

  let celulas = '';
  for (let i = 0; i < deslocamento; i++) celulas += '<div class="cal-dia vazio" aria-hidden="true"></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const dia = `${mes}-${String(d).padStart(2, '0')}`;
    let vistos = porDia.get(dia) || [];
    // No dia em que o filme do mês foi visto, ele fica na frente das outras capas.
    const temDoMes = Boolean(doMes && vistos.includes(doMes));
    if (temDoMes) vistos = [doMes, ...vistos.filter((f) => f !== doMes)];
    const wl = idsWatchlist(dia).map(porId).filter(Boolean);
    const ehHoje = dia === diaHoje;
    const classes = ['cal-dia'];
    if (temDoMes) classes.push('com-filme-do-mes');
    if (ehHoje) classes.push('hoje');
    if (dia > diaHoje) classes.push('futuro');
    if (vistos.length) classes.push('com-vistos');
    if (wl.length) classes.push('com-wl');
    if (vistos.length && wl.length) classes.push('misto');
    // O dia com filmes vistos ganha a capa do primeiro como fundo, como um pôster.
    const fundo = vistos.length ? `<div class="cal-fundo" style="${esc(fundoCapa(vistos[0]))}" aria-hidden="true"></div>` : '';
    const capas = vistos.length
      ? `<div class="cal-vistos qtd-${Math.min(vistos.length, 3)}">${vistos.slice(0, 3).map((f) => capinhaHTML(f)).join('')}</div>`
        + (vistos.length > 3 ? `<span class="cal-mais">+${vistos.length - 3}</span>` : '')
      : '';
    const pensando = wl.length
      ? `<div class="cal-wl" title="Pensando em ver"><div class="cal-wl-capas">${wl.slice(0, 3).map((f) => capinhaHTML(f, '', dia)).join('')}${wl.length > 3 ? `<span class="cal-mais">+${wl.length - 3}</span>` : ''}</div></div>`
      : '';
    const rotulo = `${diaLegivel(dia)}${vistos.length ? `: ${vistos.length} visto${vistos.length === 1 ? '' : 's'}` : ''}${wl.length ? `, ${wl.length} na watchlist` : ''}`;
    celulas += `
      <div class="${classes.join(' ')}" data-c="dia" data-dia="${dia}" role="button" tabindex="0" aria-label="${esc(rotulo)}">
        ${fundo}
        <span class="cal-cabeca"><span class="cal-numero">${d}</span>${ehHoje ? '<span class="cal-hoje">hoje</span>' : ''}</span>
        ${capas}${pensando}
        ${temDoMes ? `<span class="cal-trofeu" title="Filme do mês: ${esc(doMes.titulo)}">${icone('Trophy')}</span>` : ''}
      </div>`;
  }

  const anterior = mesVizinho(mes, -1);
  const proximo = mesVizinho(mes, 1);
  return `
    <div class="cal-topo">
      <div class="cal-navegacao">
        <h2>${esc(MESES[m - 1])} <span class="cal-ano">${ano}</span></h2>
        <div class="cal-setas">
          <button class="redondo" data-c="mes" data-mes="${anterior}" ${anterior < primeiroMes() ? 'disabled' : ''} title="Mês anterior" aria-label="Mês anterior">${icone('ChevronLeft')}</button>
          <button class="redondo" data-c="mes" data-mes="${proximo}" ${proximo > mesVizinho(mesAtual, 1) ? 'disabled' : ''} title="Próximo mês" aria-label="Próximo mês">${icone('ChevronRight')}</button>
        </div>
        ${mes !== mesAtual ? `<button class="btn btn-fantasma cal-ir-hoje" data-c="mes" data-mes="${mesAtual}">Voltar para hoje</button>` : ''}
      </div>
      <div class="cal-stats">
        <span class="cal-stat">${icone('Check')} ${noMes
          ? `<b>${noMes}</b> ${noMes === 1 ? 'filme visto' : 'filmes vistos'} em ${esc(MESES[m - 1])}`
          : `Nada visto em ${esc(MESES[m - 1])} ainda`}</span>
        ${doMes
          ? `<button class="cal-stat ouro" data-c="filme-do-mes" data-mes="${mes}" title="Filme do mês: ${esc(doMes.titulo)} (clique para trocar)">${icone('Trophy')} <b>${esc(doMes.titulo)}</b></button>`
          : noMes ? `<button class="cal-stat ouro vazio" data-c="filme-do-mes" data-mes="${mes}" title="Escolher o seu filme favorito deste mês">${icone('Trophy')} Filme do mês</button>` : ''}
        ${wlHoje ? `<button class="cal-stat roxo" data-c="dia" data-dia="${diaHoje}">${icone('CalendarClock')} <b>${wlHoje}</b> pensando em ver hoje</button>` : ''}
      </div>
      <span class="cal-dica-arrasto">${icone('Move')} Solte num dia: hoje ou depois, vai para a watchlist dele; antes de hoje, conta como visto nele</span>
      <button class="redondo cal-fechar" data-c="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
    </div>
    <div class="cal-semana" aria-hidden="true">${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grade">${celulas}</div>`;
}

// `pensandoEm`: o dia da watchlist em que o filme está (hoje ou um dia que vem).
// `vistoNoMes`: o mês em que o filme foi visto (cartões de vistos), para o botão de filme do mês.
function filmeDoDiaHTML(f, { pensandoEm = null, vistoNoMes = null } = {}) {
  const meta = [f.ano, duracaoDe(f)].filter(Boolean).map(esc).join(' · ');
  let acoes = '';
  const ehDoMes = Boolean(vistoNoMes && filmeDoMes(vistoNoMes)?.id === f.id);
  if (vistoNoMes) {
    acoes = `<button class="cal-trofeu-btn${ehDoMes ? ' on' : ''}" data-c="alternar-filme-do-mes" data-id="${f.id}" data-mes="${vistoNoMes}" aria-pressed="${ehDoMes}"
      title="${ehDoMes ? 'Deixar de ser o filme do mês' : 'Marcar como o seu filme favorito deste mês'}">${icone('Trophy')} ${ehDoMes ? 'Filme do mês' : 'Marcar como filme do mês'}</button>`;
  }
  if (pensandoEm) {
    const tirar = `<button class="redondo" data-c="tirar" data-id="${f.id}" data-dia="${pensandoEm}" title="Tirar da watchlist" aria-label="Tirar da watchlist">${icone('X')}</button>`;
    // Sem arrastar: levar o filme para o dia seguinte, ou trazer de volta para hoje.
    const mover = `<div class="cal-filme-mover">
        ${pensandoEm > hoje() ? `<button data-c="mover" data-id="${f.id}" data-de="${pensandoEm}" data-para="${hoje()}">${icone('Undo2')} Trazer para hoje</button>` : ''}
        <button data-c="mover" data-id="${f.id}" data-de="${pensandoEm}" data-para="${diaSeguinte(pensandoEm)}">${pensandoEm === hoje() ? 'Passar para amanhã' : 'Passar para o dia seguinte'} ${icone('ArrowRight')}</button>
      </div>`;
    const principais = pensandoEm === hoje()
      ? `<button class="btn btn-assistir" data-c="assistir" data-id="${f.id}">${ICONE_PLAY} Assistir</button>
         <button class="redondo" data-c="vi" data-id="${f.id}" title="Marcar como visto hoje" aria-label="Marcar como visto hoje">${icone('Check')}</button>`
      : '';
    acoes = `<div class="cal-filme-botoes">${principais}${tirar}</div>${mover}`;
  }
  if (vistoNoMes && temPagina(f)) return resenhaDoDiaHTML(f, { vistoNoMes, trofeu: acoes });
  if (vistoNoMes) acoes += `<button class="cal-escrever" data-c="pagina" data-id="${f.id}">${icone('PenLine')} Escrever sobre o filme</button>`;
  return `
    <article class="cal-filme${pensandoEm ? ' pensando' : ''}${ehDoMes ? ' do-mes' : ''}" data-id="${f.id}">
      ${capinhaHTML(f, 'grande')}
      <div class="cal-filme-info">
        <h4><button class="cal-filme-titulo" data-c="detalhes" data-id="${f.id}">${esc(f.titulo)}</button></h4>
        <p>${meta}${f.diretor ? `<br>${esc(f.diretor)}` : ''}</p>
        ${vistoNoMes && f.minhaNota ? notaFixaHTML(f.minhaNota) : ''}
      </div>
      ${acoes}
    </article>`;
}

function vistosDoDiaHTML(vistos, dia) {
  const comPagina = vistos.filter(temPagina);
  const semPagina = vistos.filter((f) => !temPagina(f));
  const mes = dia.slice(0, 7);
  return (comPagina.length ? `<div class="cal-resenhas">${comPagina.map((f) => filmeDoDiaHTML(f, { vistoNoMes: mes })).join('')}</div>` : '')
    + (semPagina.length ? `<div class="cal-filmes">${semPagina.map((f) => filmeDoDiaHTML(f, { vistoNoMes: mes })).join('')}</div>` : '');
}

function diaSeguinte(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const x = new Date(a, m - 1, d + 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function paginaDiaHTML(dia) {
  const vistos = vistosPorDia().get(dia) || [];
  const ehHoje = dia === hoje();
  const futuro = dia > hoje();
  const watchlist = idsWatchlist(dia).map(porId).filter(Boolean);
  const [ano, m] = dia.split('-').map(Number);
  const semana = new Date(ano, m - 1, Number(dia.slice(8))).toLocaleDateString('pt-BR', { weekday: 'long' });
  const nomeSemana = semana.charAt(0).toUpperCase() + semana.slice(1);
  const destaque = watchlist[0] || vistos[0];
  const contagem = (n) => (n ? `<span class="cal-contagem">${n}</span>` : '');
  return `
    <div class="cal-dia-topo${destaque ? ' com-fundo' : ''}">
      ${destaque ? `<div class="cal-dia-fundo" style="${esc(fundoCapa(destaque))}" aria-hidden="true"></div>` : ''}
      <div class="cal-topo">
        <div class="cal-navegacao">
          <button class="redondo" data-c="voltar" title="Voltar para ${esc(MESES[m - 1])}" aria-label="Voltar para o mês">${icone('ChevronLeft')}</button>
          <div class="cal-dia-titulo">
            <span class="cal-dia-semana">${esc(nomeSemana)}${ehHoje ? ' <span class="cal-hoje">hoje</span>' : ''}</span>
            <h2>${esc(diaLegivel(dia))}</h2>
          </div>
        </div>
      </div>
    </div>
    ${ehHoje || futuro ? `
      <section class="cal-secao" data-secao="watchlist">
        <h3>${icone('CalendarClock')} ${ehHoje ? 'Pensando em ver hoje' : 'Pensando em ver neste dia'} ${contagem(watchlist.length)}
          ${ehHoje ? `<span class="cal-sortear-botoes"><button class="btn btn-fantasma cal-sortear" data-c="sortear-hoje" title="Sortear um filme não visto para a watchlist de hoje">${icone('Dices')} Sortear um filme</button><button class="btn btn-fantasma cal-sortear" data-c="sortear-hoje-filtro" title="Sortear só por duração, gênero, década ou país">${icone('SlidersHorizontal')} Sortear com filtro</button></span>` : ''}</h3>
        ${watchlist.length
          ? `<div class="cal-filmes">${watchlist.map((f) => filmeDoDiaHTML(f, { pensandoEm: dia })).join('')}</div>`
          : `<p class="cal-vazio">${ehHoje
            ? `Nenhum filme ainda. Use o ${icone('CalendarClock')} na capa de um filme, na prévia ou nos detalhes para colocar aqui o que você está pensando em ver hoje. A lista some quando o dia vira, às 5h.`
            : 'Nenhum filme planejado para este dia. No mês, arraste uma capa da watchlist para cá.'}</p>`}
      </section>` : ''}
    ${futuro ? '' : `
    <section class="cal-secao cal-secao-vistos">
      <h3>${icone('Check')} ${ehHoje ? 'Vistos hoje' : 'Vistos neste dia'} ${contagem(vistos.length)}</h3>
      ${vistos.length
        ? vistosDoDiaHTML(vistos, dia)
        : `<p class="cal-vazio">${ehHoje ? 'Nenhum filme visto hoje ainda.' : 'Nenhum filme visto neste dia.'}</p>`}
    </section>`}`;
}

// ---------- Sortear um filme para a watchlist de hoje ----------

// Em tela cheia: o fundo escurece e, no centro, as capas passam rápido,
// desacelerando até parar no sorteado. Aí aparecem os dados dele e a escolha:
// colocar na watchlist, deixar para lá, ou sortear de novo (com um menu para
// sortear com os mesmos filtros, sem filtro ou escolher os filtros). A roleta
// anima mesmo com as animações do Windows desligadas: ela é o próprio sorteio.
let roleta = null; // { el, comFiltro, daWatchlist, escolhido, girando, geracao }

// `comFiltro`: só entre os que passam nos filtros do sorteio (duração, gênero,
// década, país). Com "Um da watchlist de hoje", sorteia entre os que já estão
// nela: aceitar leva o escolhido para o primeiro lugar, em vez de pôr na lista.
function candidatosRoleta(comFiltro) {
  const fs = comFiltro ? filtrosSorteio() : FILTROS_SORTEIO_VAZIOS;
  const daWatchlist = Boolean(comFiltro && fs.soWatchlist);
  return { fs, daWatchlist, candidatos: candidatosSorteio(fs, { paraHoje: !daWatchlist }) };
}

function sortearParaHoje(_botao, { comFiltro = false } = {}) {
  if (roleta && roleta.girando) return;
  const { daWatchlist, candidatos } = candidatosRoleta(comFiltro);
  if (!candidatos.length) {
    const ajustar = { rotulo: 'Ajustar filtros', fn: () => abrirFiltrosSorteio({ paraHoje: true }) };
    if (daWatchlist) aviso('Nenhum filme da watchlist de hoje passa nos filtros.', { acao: ajustar });
    else if (comFiltro) aviso('Nenhum filme não visto passa nos filtros do sorteio.', { acao: ajustar });
    else aviso('Não sobrou nenhum filme não visto para sortear.');
    return;
  }
  if (!roleta) abrirTelaRoleta();
  girarRoleta({ comFiltro, daWatchlist, candidatos });
}

function preCarregarImagem(src) {
  return new Promise((r) => { const img = new Image(); img.onload = img.onerror = () => r(); img.src = src; });
}

function abrirTelaRoleta() {
  const el = document.createElement('div');
  el.className = 'roleta-tela';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Sorteio para hoje');
  el.innerHTML = `
    <div class="roleta-fundo" aria-hidden="true"></div>
    <button class="redondo roleta-fechar" data-r="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
    <div class="roleta-palco">
      <span class="roleta-kicker"></span>
      <div class="roleta-capa"><div class="capa"><img alt=""></div></div>
      <div class="roleta-info">
        <div class="roleta-titulo"><h2></h2></div>
        <p class="roleta-meta"></p>
        <p class="roleta-sinopse"></p>
      </div>
      <div class="roleta-acoes" hidden>
        <button class="btn btn-assistir" data-r="aceitar"></button>
        <div class="roleta-de-novo">
          <button class="btn btn-claro" data-r="de-novo">${icone('Dices')} Sortear de novo</button>
          <button class="btn btn-claro roleta-seta" data-r="menu" aria-haspopup="menu" aria-label="Mais opções de sorteio" title="Sortear com filtro">${icone('ChevronDown')}</button>
          <div class="roleta-menu" role="menu" hidden>
            <button role="menuitem" data-r="de-novo">${icone('Dices')} <span class="roleta-menu-mesmos"></span></button>
            <button role="menuitem" data-r="sem-filtro">${icone('Shuffle')} Sortear sem filtro</button>
            <button role="menuitem" data-r="filtros">${icone('SlidersHorizontal')} Escolher filtros…</button>
          </div>
        </div>
        <button class="btn btn-fantasma" data-r="recusar">Agora não</button>
      </div>
    </div>`;
  document.body.append(el);
  roleta = { el, geracao: 0 };
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  el.addEventListener('click', aoClicarRoleta);
}

function fecharTelaRoleta() {
  if (!roleta) return;
  const { el } = roleta;
  roleta = null;
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }).onfinish = () => el.remove();
}

async function girarRoleta({ comFiltro, daWatchlist, candidatos }) {
  const r = roleta;
  const geracao = ++r.geracao;
  Object.assign(r, { comFiltro, daWatchlist, girando: true });
  const { el } = r;
  const comCapa = candidatos.filter((f) => srcCapa(f));
  const sorteaveis = (comCapa.length ? comCapa : candidatos).filter((f) => f.id !== r.escolhido?.id);
  const lista = sorteaveis.length ? sorteaveis : candidatos;
  const escolhido = lista[Math.floor(Math.random() * lista.length)];
  r.escolhido = escolhido;

  const resumo = comFiltro ? resumoFiltrosSorteio() : [];
  $('.roleta-kicker', el).innerHTML = `${icone('Dices')} ${daWatchlist ? 'Sorteando da sua watchlist de hoje' : 'Sorteando para hoje'}${resumo.filter((x) => x !== 'watchlist de hoje').length ? ` · ${esc(resumo.filter((x) => x !== 'watchlist de hoje').join(' · '))}` : ''}`;
  $('.roleta-acoes', el).hidden = true;
  $('.roleta-menu', el).hidden = true;
  el.classList.remove('parou');
  const img = $('.roleta-capa img', el);
  const capa = $('.roleta-capa .capa', el);
  const titulo = $('.roleta-titulo', el);
  $('.roleta-meta', el).textContent = '';
  $('.roleta-sinopse', el).textContent = '';

  // Umas 16 capas ao acaso e o sorteado por último, já carregadas para não piscar.
  const outros = comCapa.filter((f) => f.id !== escolhido.id).sort(() => Math.random() - 0.5).slice(0, 16);
  const fila = [...outros, escolhido];
  await Promise.race([Promise.all(fila.map((f) => preCarregarImagem(srcCapa(f)))), new Promise((ok) => setTimeout(ok, 900))]);

  let atraso = 55;
  for (const [i, f] of fila.entries()) {
    if (roleta !== r || r.geracao !== geracao) return; // fechou ou sorteou de novo
    img.src = srcCapa(f) || '';
    titulo.innerHTML = `<h2>${esc(f.titulo)}</h2>`;
    capa.animate([{ transform: 'translateY(-6%) scale(.96)', opacity: 0.55 }, { transform: 'none', opacity: 1 }],
      { duration: Math.min(atraso, 170), easing: 'ease-out' });
    if (i < fila.length - 1) {
      await new Promise((ok) => setTimeout(ok, atraso));
      atraso = Math.min(atraso * 1.18, 360);
    }
  }
  if (roleta !== r || r.geracao !== geracao) return;

  // Parou: o sorteado cresce, o fundo ganha a capa dele, e aparecem os dados e a escolha.
  r.girando = false;
  el.classList.add('parou');
  $('.roleta-fundo', el).style.backgroundImage = srcCapa(escolhido) ? `url("${srcCapa(escolhido).replace(/"/g, '%22')}")` : '';
  capa.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 560, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  titulo.innerHTML = tituloHTML(escolhido);
  $('.roleta-meta', el).textContent = [escolhido.ano, duracaoDe(escolhido), generos(escolhido.info).slice(0, 2).join(', '), escolhido.diretor].filter(Boolean).join(' · ');
  $('.roleta-sinopse', el).textContent = (escolhido.info && escolhido.info.sinopse) || '';
  const aceitar = $('[data-r="aceitar"]', el);
  aceitar.innerHTML = daWatchlist ? `${icone('ArrowUp')} Ver este hoje` : `${icone('Plus')} Colocar na watchlist`;
  $('.roleta-menu-mesmos', el).textContent = comFiltro && resumo.length ? 'Sortear com os mesmos filtros' : 'Sortear de novo';
  const acoes = $('.roleta-acoes', el);
  acoes.hidden = false;
  [$('.roleta-info', el), acoes].forEach((x, i) => x.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay: 120 + i * 90, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' }));
  aceitar.focus({ preventScroll: true });
}

function aceitarSorteado() {
  const { escolhido, daWatchlist } = roleta;
  const antes = idsWatchlist();
  salvarWatchlist(daWatchlist ? [escolhido.id, ...antes.filter((x) => x !== escolhido.id)] : [...antes, escolhido.id]);
  fecharTelaRoleta();
  aposMudarDia(escolhido.id);
  const cartao = $(`#calendario [data-secao="watchlist"] .cal-filme[data-id="${escolhido.id}"]`);
  if (cartao) {
    cartao.scrollIntoView({ block: 'nearest' });
    cartao.animate([{ transform: 'scale(.94)', opacity: 0.6 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 520 });
  }
  aviso(daWatchlist ? `Hoje é: “${escolhido.titulo}”.` : `“${escolhido.titulo}” entrou na watchlist de hoje.`, {
    tipo: 'ok',
    acao: { rotulo: 'Desfazer', fn: () => { salvarWatchlist(antes); aposMudarDia(escolhido.id); } },
  });
}

function aoClicarRoleta(e) {
  if (!roleta) return;
  const b = e.target.closest('[data-r]');
  const menu = $('.roleta-menu', roleta.el);
  if (!b) { menu.hidden = true; return; }
  if (b.dataset.r !== 'menu') menu.hidden = true;
  switch (b.dataset.r) {
    case 'fechar':
    case 'recusar': fecharTelaRoleta(); break;
    case 'aceitar': if (!roleta.girando) aceitarSorteado(); break;
    case 'menu': menu.hidden = !menu.hidden; break;
    case 'de-novo': sortearParaHoje(null, { comFiltro: roleta.comFiltro }); break;
    case 'sem-filtro': sortearParaHoje(null, { comFiltro: false }); break;
    case 'filtros': abrirFiltrosSorteio({ paraHoje: true }); break;
  }
}

// Esc: fecha o menu, ou a tela do sorteio (antes de fechar o calendário).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !roleta || modal.open) return;
  e.stopImmediatePropagation();
  const menu = $('.roleta-menu', roleta.el);
  if (!menu.hidden) menu.hidden = true;
  else fecharTelaRoleta();
}, true);

calendario.addEventListener('click', (e) => {
  if (e.target === calendario) { fecharCalendario(); return; }
  const alvo = e.target.closest('[data-c]');
  if (!alvo) return;
  const id = alvo.dataset.id;
  switch (alvo.dataset.c) {
    case 'fechar': fecharCalendario(); break;
    case 'mes': irParaMes(alvo.dataset.mes); break;
    case 'dia': irParaDia(alvo.dataset.dia); break;
    case 'voltar': voltarParaMes(); break;
    case 'sortear-hoje': sortearParaHoje(alvo); break;
    case 'sortear-hoje-filtro': abrirFiltrosSorteio({ paraHoje: true, botao: $('#calendario [data-c="sortear-hoje"]') }); break;
    case 'detalhes': abrirPainel(id); break;
    case 'assistir': abrirStremio(id); break;
    case 'vi': alternar(id, 'visto', true); aviso(`“${porId(id).titulo}” marcado como visto hoje.`, { tipo: 'ok' }); break;
    case 'tirar': tirarDaWatchlist(id, alvo.dataset.dia || hoje()); break;
    case 'mover': moverWatchlist(id, alvo.dataset.de, alvo.dataset.para); break;
    case 'filme-do-mes': escolherFilmeDoMes(alvo.dataset.mes); break;
    case 'alternar-filme-do-mes': alternarFilmeDoMes(id, alvo.dataset.mes); break;
    case 'pagina': abrirPagina(id); break;
  }
});

// Arrastar uma capa da watchlist de um dia para outro dia, com o ponteiro.
// (O drag-and-drop do HTML falhava muito aqui: começava pela imagem pequena e
// um movimento curto virava clique.) Só vira arrasto depois de 5 px; uma cópia
// da capa segue o mouse, o dia embaixo acende, e parar sobre as setas ‹ › troca
// o mês para dar para levar um filme de um mês para o outro.
let arrasto = null; // { id, de, x0, y0, ativo, fantasma, timerMes, mesAlvo }
let ignorarClique = false;

function diaSobPonteiro(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && calendario.contains(el) ? el : null;
}

function terminarArrasto() {
  if (!arrasto) return;
  clearTimeout(arrasto.timerMes);
  arrasto.fantasma?.remove();
  arrasto = null;
  calendario.classList.remove('arrastando');
  $$('.cal-soltar, .cal-origem, .cal-seta-alvo', calendario).forEach((el) => el.classList.remove('cal-soltar', 'cal-origem', 'cal-seta-alvo'));
}

calendario.addEventListener('dragstart', (e) => e.preventDefault());

// Na página de um dia, arrastar a capa de um filme da watchlist muda a ordem:
// o cartão vai andando entre os outros (que escorregam para abrir espaço) e,
// ao soltar, a ordem da tela vira a ordem da watchlist daquele dia.
let reordenacao = null; // { cartao, grade, dia, x0, y0, ativo, fantasma }

calendario.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !diaCalendario) return;
  const capa = e.target.closest('[data-secao="watchlist"] .cal-filme .cal-capa');
  if (!capa) return;
  const cartao = capa.closest('.cal-filme');
  reordenacao = { cartao, grade: cartao.parentElement, dia: diaCalendario, x0: e.clientX, y0: e.clientY, ativo: false };
});

document.addEventListener('pointermove', (e) => {
  if (!reordenacao) return;
  const r = reordenacao;
  if (!r.ativo) {
    if (Math.hypot(e.clientX - r.x0, e.clientY - r.y0) < 5) return;
    r.ativo = true;
    r.fantasma = document.createElement('div');
    r.fantasma.className = 'cal-fantasma cal-fantasma-grande';
    r.fantasma.innerHTML = capaHTML(porId(r.cartao.dataset.id));
    document.body.append(r.fantasma);
    r.cartao.classList.add('reordenando');
    calendario.classList.add('arrastando');
  }
  e.preventDefault();
  r.fantasma.style.transform = `translate(${e.clientX - 50}px, ${e.clientY - 75}px) rotate(-3deg)`;
  // Antes ou depois do cartão mais perto do ponteiro (pelo layout, não pela animação).
  const outros = $$('.cal-filme', r.grade).filter((c) => c !== r.cartao);
  let perto = null;
  let menor = Infinity;
  for (const c of outros) {
    const p = centroNoLayout(c, r.grade);
    const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (d < menor) { menor = d; perto = c; }
  }
  if (!perto) return;
  const antes = e.clientX < centroNoLayout(perto, r.grade).x;
  if (antes && perto.previousElementSibling !== r.cartao) escorregar($$('.cal-filme', r.grade), () => perto.before(r.cartao));
  else if (!antes && perto.nextElementSibling !== r.cartao) escorregar($$('.cal-filme', r.grade), () => perto.after(r.cartao));
});

function terminarReordenacao() {
  const r = reordenacao;
  reordenacao = null;
  if (!r || !r.ativo) return;
  r.fantasma.remove();
  r.cartao.classList.remove('reordenando');
  calendario.classList.remove('arrastando');
  ignorarClique = true;
  setTimeout(() => { ignorarClique = false; }, 0);
  const ordem = $$('.cal-filme', r.grade).map((c) => c.dataset.id);
  const atual = idsWatchlist(r.dia);
  if (ordem.join() !== atual.join()) salvarWatchlist([...ordem, ...atual.filter((id) => !ordem.includes(id))], r.dia);
}
document.addEventListener('pointerup', terminarReordenacao);
document.addEventListener('pointercancel', terminarReordenacao);

calendario.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const capa = e.target.closest('[data-arrastar]');
  if (!capa) return;
  arrasto = { id: capa.dataset.id, de: capa.dataset.arrastar, x0: e.clientX, y0: e.clientY, ativo: false };
});

document.addEventListener('pointermove', (e) => {
  if (!arrasto) return;
  if (!arrasto.ativo) {
    if (Math.hypot(e.clientX - arrasto.x0, e.clientY - arrasto.y0) < 5) return;
    arrasto.ativo = true;
    const f = porId(arrasto.id);
    const fantasma = document.createElement('div');
    fantasma.className = 'cal-fantasma';
    fantasma.innerHTML = capaHTML(f);
    document.body.append(fantasma);
    arrasto.fantasma = fantasma;
    calendario.classList.add('arrastando');
    $(`.cal-dia[data-dia="${arrasto.de}"]`, calendario)?.classList.add('cal-origem');
  }
  e.preventDefault();
  arrasto.fantasma.style.transform = `translate(${e.clientX - 30}px, ${e.clientY - 44}px) rotate(-4deg)`;

  const sob = diaSobPonteiro(e.clientX, e.clientY);
  const celula = sob && sob.closest('.cal-dia[data-dia]');
  $$('.cal-soltar', calendario).forEach((el) => { if (el !== celula) el.classList.remove('cal-soltar'); });
  if (celula) celula.classList.add('cal-soltar');

  // Parado sobre ‹ ou › por um instante: troca o mês sem soltar o filme.
  const seta = sob && sob.closest('[data-c="mes"]:not(:disabled)');
  const mesAlvo = seta ? seta.dataset.mes : null;
  if (mesAlvo !== arrasto.mesAlvo) {
    clearTimeout(arrasto.timerMes);
    $$('.cal-seta-alvo', calendario).forEach((el) => el.classList.remove('cal-seta-alvo'));
    arrasto.mesAlvo = mesAlvo;
    if (seta) {
      seta.classList.add('cal-seta-alvo');
      arrasto.timerMes = setTimeout(() => {
        if (!arrasto) return;
        arrasto.mesAlvo = null;
        irParaMes(mesAlvo);
        calendario.classList.add('arrastando');
      }, 600);
    }
  }
});

document.addEventListener('pointerup', (e) => {
  if (!arrasto) return;
  if (!arrasto.ativo) { arrasto = null; return; } // foi um clique: abre os detalhes normalmente
  const sob = diaSobPonteiro(e.clientX, e.clientY);
  const celula = sob && sob.closest('.cal-dia[data-dia]');
  const { id, de } = arrasto;
  terminarArrasto();
  // O clique que vem depois de soltar não deve abrir os detalhes nem o dia.
  ignorarClique = true;
  setTimeout(() => { ignorarClique = false; }, 0);
  if (celula) moverWatchlist(id, de, celula.dataset.dia);
});

document.addEventListener('pointercancel', terminarArrasto);
window.addEventListener('blur', terminarArrasto);

calendario.addEventListener('click', (e) => {
  if (!ignorarClique) return;
  ignorarClique = false;
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);


calendario.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.cal-capa[role="button"]')) {
    e.preventDefault();
    e.stopPropagation();
    abrirPainel(e.target.dataset.id);
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.cal-dia[data-c="dia"]')) {
    e.preventDefault();
    irParaDia(e.target.dataset.dia);
  }
});

$('#btn-calendario').addEventListener('click', () => abrirCalendario());

// Quando o dia vira (às 5h) com o app aberto, a watchlist de ontem some da tela.
let diaAtual = hoje();
setInterval(() => {
  if (hoje() === diaAtual) return;
  diaAtual = hoje();
  agendarRender();
  if (estado.painelId) renderPainel();
  if (!calendario.hidden) renderCalendario();
}, 60 * 1000);

// ---------- Tierlist ----------

// Os filmes vistos, arrastados para tiers (várias por filme não; vários filmes por
// tier sim). Pode haver várias tierlists, cada uma com nome ("Terror",
// "Melhores de 2026"…) e os seus próprios filtros, guardadas nas configurações
// como tierlists: [{ id, nome, filtros, tiers: [{ id, nome, cor, filmes: [ids] }] }]
// (tiers de cima para baixo) e tierlistAtiva. O que não está em nenhuma tier
// fica na bandeja "Sem tier", embaixo. Clicar no nome da tier renomeia.
const CORES_TIER = ['#FF6B6B', '#FF9F5A', '#FFC857', '#F2E55C', '#A8E063', '#5BD69A', '#3DD6D0', '#5AB8FF', '#7B8CFF', '#9B7BDC', '#E57AD8', '#FF7AA8', '#D9DCE1', '#8A8F98'];
const TIERS_PADRAO = ['S', 'A', 'B', 'C', 'D', 'F'];
const tierlist = $('#tierlist');
let buscaTl = '';

const tiersPadrao = () => TIERS_PADRAO.map((nome, i) => ({ id: `t${i}`, nome, cor: CORES_TIER[i], filmes: [] }));

// A primeira vez, a tierlist antiga (config.tierlist) vira a primeira da lista.
function listasTl() {
  if (!Array.isArray(estado.config.tierlists) || !estado.config.tierlists.length) {
    const antiga = Array.isArray(estado.config.tierlist) ? estado.config.tierlist : tiersPadrao();
    estado.config.tierlists = [{ id: 'l1', nome: 'Tierlist', filtros: {}, tiers: antiga }];
  }
  return estado.config.tierlists;
}
function listaAtiva() {
  const listas = listasTl();
  return listas.find((l) => l.id === estado.config.tierlistAtiva) || listas[0];
}
function tiers() { return listaAtiva().tiers; }
function salvarTiers() { api.salvarConfig({ tierlists: listasTl(), tierlistAtiva: listaAtiva().id }); }

// ---- Filtros da tierlist (gênero, diretor, país, década, mês em que viu) ----
const FILTROS_TL = [
  { chave: 'listas', titulo: 'Lista', valores: (f) => listasDe(f) },
  { chave: 'generos', titulo: 'Gênero', valores: (f) => generos(f.info) },
  { chave: 'diretores', titulo: 'Diretor', valores: (f) => nomesDiretores(f.diretor) },
  { chave: 'paises', titulo: 'País', valores: (f) => paisesDe(f) },
  { chave: 'decadas', titulo: 'Década', valores: (f) => { const d = decadaDe(f); return d === null ? [] : [String(d)]; } },
  { chave: 'meses', titulo: 'Mês em que viu', valores: (f) => [...new Set((f.vistoEm || []).map((d) => d.slice(0, 7)))] },
];
const rotuloFiltroTl = (chave, v) => (chave === 'decadas' ? `Anos ${Number(v) < 2000 ? v.slice(2) : v}` : chave === 'meses' ? mesLegivel(v) : v);
const filtrosTl = () => listaAtiva().filtros || {};
const qtdFiltrosTl = () => Object.values(filtrosTl()).reduce((n, v) => n + (v || []).length, 0);
function passaFiltroTl(f, filtros = filtrosTl()) {
  return FILTROS_TL.every(({ chave, valores }) => {
    const escolhidos = filtros[chave] || [];
    return !escolhidos.length || valores(f).some((v) => escolhidos.includes(v));
  });
}
const tierPorId = (id) => tiers().find((t) => t.id === id);

function abrirTierlist() {
  fecharPrevia(false);
  tierlist.hidden = false;
  buscaTl = '';
  renderTierlist();
  Movimento.animar($('#tierlist-caixa'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  Movimento.sequencia($$('#tierlist .tl-tier'), { x: -10, duracao: 360, passo: 40, atrasoInicial: 80 });
  $('#tierlist [data-t="fechar"]')?.focus({ preventScroll: true });
}

function fecharTierlist() {
  if (tierlist.hidden) return;
  terminarArrastoTl();
  tierlist.hidden = true;
  $('#tierlist-caixa').innerHTML = '';
}

function capaTlHTML(f) {
  const nota = f.minhaNota ? `<span class="tl-nota" title="Sua nota">${icone('Star', { preenchido: true })}${notaLegivel(f.minhaNota)}</span>` : '';
  return `<div class="tl-capa" role="button" tabindex="0" data-id="${f.id}" title="${esc(`${f.titulo}${f.ano ? ` (${f.ano})` : ''}`)}" aria-label="${esc(f.titulo)}">${capaHTML(f)}${nota}</div>`;
}

function renderTierlist() {
  const caixa = $('#tierlist-caixa');
  // Redesenhar não pode mandar as listas de volta para o topo.
  const rolagem = [...$$('.tl-tiers, .tl-sem', caixa)].map((el) => el.scrollTop);
  const todosVistos = estado.filmes.filter((f) => f.visto);
  const vistos = todosVistos.filter((f) => passaFiltroTl(f));
  const vistosIds = new Set(vistos.map((f) => f.id));
  const naTier = new Set();
  const nFiltros = qtdFiltrosTl();
  const linhas = tiers().map((t) => {
    const filmes = t.filmes.filter((id) => vistosIds.has(id) && !naTier.has(id)).map(porId);
    filmes.forEach((f) => naTier.add(f.id));
    return `
      <div class="tl-tier" data-tier="${t.id}" style="--cor: ${esc(t.cor)}">
        <span class="tl-alca" title="Arraste para mudar a tier de posição" aria-hidden="true">${icone('GripVertical')}</span>
        <button class="tl-rotulo" data-t="renomear" title="Clique para renomear, arraste para mudar de posição"><span class="tl-nome">${esc(t.nome) || '&nbsp;'}</span></button>
        <div class="tl-filmes" data-soltar="${t.id}">${filmes.map(capaTlHTML).join('')}</div>
        <div class="tl-acoes">
          <button class="tl-acao" data-t="cor" title="Trocar a cor" aria-label="Trocar a cor">${icone('Palette')}</button>
          <button class="tl-acao" data-t="apagar" title="Apagar a tier (os filmes voltam para Sem tier)" aria-label="Apagar a tier">${icone('Trash2')}</button>
        </div>
      </div>`;
  }).join('');
  const termo = normalizar(buscaTl.trim());
  const soltos = vistos.filter((f) => !naTier.has(f.id));
  caixa.innerHTML = `
    <div class="tl-topo">
      <button class="tl-titulo" data-t="listas" title="Trocar de tierlist, criar outra ou renomear" aria-haspopup="menu"><h2>${esc(listaAtiva().nome || 'Tierlist')}</h2>${icone('ChevronDown')}</button>
      <span class="cal-stat">${icone('Check')} <b>${naTier.size}</b> de ${vistos.length} ${vistos.length === 1 ? 'filme visto' : 'filmes vistos'}${nFiltros ? ' (com filtro)' : ''} classificados</span>
      <button class="btn btn-fantasma tl-filtros${nFiltros ? ' ativo' : ''}" data-t="filtros" aria-haspopup="dialog">${icone('SlidersHorizontal')} ${nFiltros ? `Filtros (${nFiltros})` : 'Filtros'}</button>
      <button class="btn btn-fantasma tl-nova" data-t="nova">${icone('Plus')} Nova tier</button>
      <button class="redondo tl-fechar" data-t="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
    </div>
    <div class="tl-tiers">${linhas || '<p class="tl-nenhuma">Nenhuma tier. Crie uma em “Nova tier”.</p>'}</div>
    <div class="tl-bandeja">
      <div class="tl-bandeja-topo">
        <h3>Sem tier <span>${soltos.length}</span></h3>
        <label class="tl-busca">${icone('Search')}<input type="search" placeholder="Filtrar" value="${esc(buscaTl)}" spellcheck="false" aria-label="Filtrar filmes sem tier"></label>
      </div>
      <div class="tl-filmes tl-sem" data-soltar="">${soltos.map((f) => capaTlHTML(f).replace('class="tl-capa"',
        `class="tl-capa"${termo && !normalizar(`${f.titulo} ${f.ano} ${f.diretor || ''}`).includes(termo) ? ' hidden' : ''}`)).join('')}</div>
      ${vistos.length ? '' : `<p class="tl-nenhuma">${nFiltros && todosVistos.length ? 'Nenhum filme visto passa nos filtros desta tierlist.' : 'Os filmes que você marcar como vistos aparecem aqui.'}</p>`}
    </div>`;
  ajustarTamanhoTl();
  [...$$('.tl-tiers, .tl-sem', caixa)].forEach((el, i) => { el.scrollTop = rolagem[i] || 0; });
}

// As tiers dividem a altura disponível entre si, e as capas acompanham a altura
// da faixa: com poucas tiers, todas cabem sem rolar. Abaixo de 76 px por faixa
// elas param de encolher e a lista passa a rolar.
function ajustarTamanhoTl() {
  const caixa = $('#tierlist-caixa');
  const lista = $('.tl-tiers', caixa);
  const n = tiers().length;
  if (!lista || !n) return;
  const altura = Math.floor((lista.clientHeight - 6 * (n - 1)) / n);
  const faixa = Math.max(76, Math.min(140, altura));
  caixa.style.setProperty('--alt-tier', `${faixa}px`);
  caixa.style.setProperty('--larg-capa-tl', `${Math.round((faixa - 16) * 2 / 3)}px`);
  ajustarFonteRotulos();
}

// O nome da tier começa grande e vai diminuindo até caber no rótulo ("S" fica
// enorme, "Obras-primas absolutas" fica pequeno). Só no tamanho mínimo uma
// palavra longa demais pode ser quebrada no meio.
function ajustarFonteRotulos() {
  for (const rotulo of $$('#tierlist button.tl-rotulo')) {
    const nome = $('.tl-nome', rotulo);
    rotulo.classList.remove('quebrar');
    const larg = rotulo.clientWidth - 16;
    const alt = rotulo.clientHeight - 12;
    let tam = 34;
    for (; tam > 12; tam -= 1) {
      nome.style.fontSize = `${tam}px`;
      if (nome.scrollWidth <= larg && nome.offsetHeight <= alt) break;
    }
    if (tam <= 12) rotulo.classList.add('quebrar');
  }
}
window.addEventListener('resize', () => { if (!tierlist.hidden) ajustarTamanhoTl(); });

function renomearTier(botao) {
  const t = tierPorId(botao.closest('.tl-tier').dataset.tier);
  const campo = document.createElement('input');
  campo.className = 'tl-rotulo tl-rotulo-campo';
  campo.value = t.nome;
  campo.maxLength = 40;
  campo.setAttribute('aria-label', 'Nome da tier');
  botao.replaceWith(campo);
  campo.focus();
  campo.select();
  let feito = false;
  const terminar = (salvar) => {
    if (feito) return;
    feito = true;
    if (salvar) { t.nome = campo.value.trim(); salvarTiers(); }
    renderTierlist();
  };
  campo.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Esc cancela a edição, não fecha a tierlist
    if (e.key === 'Enter') terminar(true);
    if (e.key === 'Escape') terminar(false);
  });
  campo.addEventListener('blur', () => terminar(true));
}

tierlist.addEventListener('click', (e) => {
  if (e.target === tierlist) { fecharTierlist(); return; }
  const capa = e.target.closest('.tl-capa');
  if (capa) { abrirPainel(capa.dataset.id); return; }
  const alvo = e.target.closest('[data-t]');
  if (!alvo) return;
  const t = alvo.closest('.tl-tier') && tierPorId(alvo.closest('.tl-tier').dataset.tier);
  switch (alvo.dataset.t) {
    case 'fechar': fecharTierlist(); break;
    case 'listas': abrirMenuListas(alvo); break;
    case 'filtros': abrirFiltrosTl(alvo); break;
    case 'renomear': renomearTier(alvo); break;
    case 'cor': abrirPaletaTier(alvo, t); break;
    case 'apagar': {
      const lista = tiers();
      const i = lista.indexOf(t);
      lista.splice(i, 1);
      salvarTiers();
      renderTierlist();
      aviso(`Tier “${t.nome || 'sem nome'}” apagada.`, { acao: { rotulo: 'Desfazer', fn: () => { tiers().splice(i, 0, t); salvarTiers(); if (!tierlist.hidden) renderTierlist(); } } });
      break;
    }
    case 'nova': {
      const usadas = new Set(tiers().map((x) => x.cor));
      tiers().push({ id: `t${Date.now().toString(36)}`, nome: 'Nova', cor: CORES_TIER.find((c) => !usadas.has(c)) || CORES_TIER[tiers().length % CORES_TIER.length], filmes: [] });
      salvarTiers();
      renderTierlist();
      const rotulos = $$('#tierlist .tl-tier .tl-rotulo');
      const novo = rotulos[rotulos.length - 1];
      novo.scrollIntoView({ block: 'nearest' });
      renomearTier(novo);
      break;
    }
  }
});

// Paleta de cores que abre ao lado do botão: as cores prontas e "Outra cor",
// que abre o seletor do sistema. A cor muda na hora; fecha ao clicar fora ou com Esc.
function fecharPaletaTier() {
  $('#tierlist .tl-paleta')?.remove();
  $$('#tierlist .tl-acoes.aberta').forEach((el) => el.classList.remove('aberta'));
}
function abrirPaletaTier(botao, t) {
  const jaAberta = $('#tierlist .tl-paleta')?.dataset.tier === t.id;
  fecharPaletaTier();
  if (jaAberta) return;
  const linha = botao.closest('.tl-tier');
  const paleta = document.createElement('div');
  paleta.className = 'tl-paleta';
  paleta.dataset.tier = t.id;
  paleta.setAttribute('role', 'dialog');
  paleta.setAttribute('aria-label', `Cor da tier ${t.nome}`);
  paleta.innerHTML = `
    <div class="tl-paleta-cores">${CORES_TIER.map((c) => `
      <button class="tl-cor${c.toLowerCase() === t.cor.toLowerCase() ? ' on' : ''}" data-cor="${c}" style="--c: ${c}" aria-label="Cor ${c}"></button>`).join('')}
    </div>
    <label class="tl-outra-cor">${icone('Pipette')} Outra cor<input type="color" value="${esc(t.cor)}"></label>`;
  $('#tierlist-caixa').append(paleta);
  botao.closest('.tl-acoes').classList.add('aberta');
  // À esquerda do botão, sem sair da caixa por baixo.
  const caixa = $('#tierlist-caixa').getBoundingClientRect();
  const rb = botao.getBoundingClientRect();
  const alt = paleta.offsetHeight;
  paleta.style.left = `${rb.left - caixa.left - paleta.offsetWidth - 10}px`;
  paleta.style.top = `${Math.min(rb.top - caixa.top + $('#tierlist-caixa').scrollTop - 8, caixa.height - alt - 12)}px`;
  Movimento.animar(paleta, [{ opacity: 0, transform: 'translateX(6px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 180 });

  const aplicar = (cor) => {
    t.cor = cor;
    linha.style.setProperty('--cor', cor);
    $$('.tl-cor', paleta).forEach((b) => b.classList.toggle('on', b.dataset.cor === cor));
    salvarTiers();
  };
  paleta.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('.tl-cor');
    if (b) { aplicar(b.dataset.cor); fecharPaletaTier(); }
  });
  $('input', paleta).addEventListener('input', (e) => aplicar(e.target.value));
  $('.tl-cor.on', paleta)?.focus({ preventScroll: true });
}
tierlist.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.tl-paleta, [data-t="cor"]')) fecharPaletaTier();
  if (!e.target.closest('.tl-menu, [data-t="listas"], [data-t="filtros"]')) fecharMenuTl();
}, true);

// Menus que abrem embaixo de um botão do topo da tierlist.
function fecharMenuTl() { $('#tierlist .tl-menu')?.remove(); }
function abrirMenuTl(botao, html, classe = '') {
  const jaAberto = $('#tierlist .tl-menu')?.dataset.de === botao.dataset.t;
  fecharMenuTl();
  if (jaAberto) return null;
  const menu = document.createElement('div');
  menu.className = `tl-menu ${classe}`;
  menu.dataset.de = botao.dataset.t;
  menu.innerHTML = html;
  const caixa = $('#tierlist-caixa');
  caixa.append(menu);
  const rc = caixa.getBoundingClientRect();
  const rb = botao.getBoundingClientRect();
  menu.style.top = `${rb.bottom - rc.top + caixa.scrollTop + 8}px`;
  menu.style.left = `${Math.max(12, Math.min(rb.left - rc.left, rc.width - menu.offsetWidth - 12))}px`;
  Movimento.animar(menu, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 160 });
  return menu;
}

// Trocar de tierlist, criar uma nova, renomear ou apagar a atual.
function abrirMenuListas(botao) {
  const listas = listasTl();
  const ativa = listaAtiva();
  const classificados = (l) => new Set(l.tiers.flatMap((x) => x.filmes).filter((id) => porId(id)?.visto)).size;
  const menu = abrirMenuTl(botao, `
    <div class="tl-menu-itens" role="menu">${listas.map((l) => `
      <button class="tl-menu-item${l === ativa ? ' atual' : ''}" role="menuitemradio" aria-checked="${l === ativa}" data-lista="${l.id}">
        <span class="tl-menu-check">${l === ativa ? icone('Check') : ''}</span><span class="tl-menu-nome">${esc(l.nome || 'Tierlist')}</span><span class="tl-menu-qtd">${classificados(l)}</span>
      </button>`).join('')}</div>
    <div class="tl-menu-sep"></div>
    <button class="tl-menu-item" data-acao="nova">${icone('Plus')} Nova tierlist</button>
    <button class="tl-menu-item" data-acao="renomear">${icone('Pencil')} Renomear “${esc(ativa.nome || 'Tierlist')}”</button>
    ${listas.length > 1 ? `<button class="tl-menu-item perigo" data-acao="apagar">${icone('Trash2')} Apagar esta tierlist</button>` : ''}`, 'tl-menu-listas');
  if (!menu) return;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    fecharMenuTl();
    if (b.dataset.lista) { trocarTierlist(b.dataset.lista); return; }
    if (b.dataset.acao === 'nova') {
      const nova = { id: `l${Date.now().toString(36)}`, nome: 'Nova tierlist', filtros: {}, tiers: tiersPadrao() };
      listas.push(nova);
      trocarTierlist(nova.id);
      renomearTierlist();
    }
    if (b.dataset.acao === 'renomear') renomearTierlist();
    if (b.dataset.acao === 'apagar') {
      const i = listas.indexOf(ativa);
      listas.splice(i, 1);
      trocarTierlist(listas[Math.max(0, i - 1)].id);
      aviso(`Tierlist “${ativa.nome}” apagada.`, { duracao: 8000, acao: { rotulo: 'Desfazer', fn: () => { listasTl().splice(i, 0, ativa); trocarTierlist(ativa.id); } } });
    }
  });
}

function trocarTierlist(id) {
  estado.config.tierlistAtiva = id;
  salvarTiers();
  if (tierlist.hidden) return;
  renderTierlist();
  Movimento.sequencia($$('#tierlist .tl-tier'), { x: -10, duracao: 300, passo: 30 });
}

// O nome da tierlist vira um campo no lugar do título; Enter salva, Esc cancela.
function renomearTierlist() {
  const titulo = $('#tierlist .tl-titulo');
  if (!titulo) return;
  const lista = listaAtiva();
  const campo = document.createElement('input');
  campo.className = 'tl-titulo-campo';
  campo.value = lista.nome || '';
  campo.maxLength = 60;
  campo.placeholder = 'Nome da tierlist (ex.: Terror, Melhores de 2026)';
  campo.setAttribute('aria-label', 'Nome da tierlist');
  titulo.replaceWith(campo);
  campo.focus();
  campo.select();
  let feito = false;
  const terminar = (salvar) => {
    if (feito) return;
    feito = true;
    if (salvar && campo.value.trim()) { lista.nome = campo.value.trim(); salvarTiers(); }
    renderTierlist();
  };
  campo.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') terminar(true);
    if (e.key === 'Escape') terminar(false);
  });
  campo.addEventListener('blur', () => terminar(true));
}

// Filtros desta tierlist: gênero, diretor, país, década e mês em que viu. Ficam
// salvos com a tierlist (uma tierlist "Terror" pode guardar o filtro de terror).
function abrirFiltrosTl(botao) {
  const vistos = estado.filmes.filter((f) => f.visto);
  const grupos = FILTROS_TL.map(({ chave, titulo, valores }) => {
    const contagem = new Map();
    for (const f of vistos) for (const v of valores(f)) contagem.set(v, (contagem.get(v) || 0) + 1);
    let itens = [...contagem];
    itens = chave === 'meses' || chave === 'decadas' ? itens.sort((a, b) => b[0].localeCompare(a[0])) : itens.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt'));
    if (chave === 'decadas') itens.reverse();
    return { chave, titulo, itens };
  }).filter((g) => g.itens.length);
  const desenhar = (menu) => {
    const filtros = filtrosTl();
    $('.tl-filtros-grupos', menu).innerHTML = grupos.map((g) => `
      <div class="tl-filtros-grupo">
        <h4>${g.titulo}</h4>
        <div class="chips-linha${g.itens.length > 14 ? ' chips-rolam' : ''}">${g.itens.map(([v, n]) => {
          const ativo = (filtros[g.chave] || []).includes(v);
          return `<button class="chip${ativo ? ' ativo' : ''}" data-grupo="${g.chave}" data-valor="${esc(v)}" aria-pressed="${ativo}">${esc(rotuloFiltroTl(g.chave, v))}<span class="chip-qtd">${n}</span></button>`;
        }).join('')}</div>
      </div>`).join('');
    const n = vistos.filter((f) => passaFiltroTl(f)).length;
    $('.tl-filtros-contagem', menu).textContent = n === 1 ? '1 filme visto aparece' : `${n} filmes vistos aparecem`;
    $('[data-acao="limpar"]', menu).disabled = !qtdFiltrosTl();
  };
  const menu = abrirMenuTl(botao, `
    <div class="tl-filtros-grupos"></div>
    <div class="tl-filtros-rodape">
      <span class="tl-filtros-contagem"></span>
      <button class="btn btn-fantasma" data-acao="limpar">Limpar filtros</button>
    </div>`, 'tl-menu-filtros');
  if (!menu) return;
  desenhar(menu);
  menu.addEventListener('click', (e) => {
    const lista = listaAtiva();
    const chip = e.target.closest('[data-grupo]');
    if (e.target.closest('[data-acao="limpar"]')) lista.filtros = {};
    else if (chip) {
      const { grupo, valor } = chip.dataset;
      const atuais = (lista.filtros && lista.filtros[grupo]) || [];
      lista.filtros = { ...(lista.filtros || {}), [grupo]: atuais.includes(valor) ? atuais.filter((x) => x !== valor) : [...atuais, valor] };
    } else return;
    salvarTiers();
    // Redesenha a tierlist por baixo e mantém o menu aberto, no mesmo lugar.
    const { top, left } = menu.style;
    const rolagemMenu = $('.tl-filtros-grupos', menu).scrollTop;
    renderTierlist();
    $('#tierlist-caixa').append(menu);
    Object.assign(menu.style, { top, left });
    desenhar(menu);
    $('.tl-filtros-grupos', menu).scrollTop = rolagemMenu;
  });
}

tierlist.addEventListener('input', (e) => {
  if (!e.target.matches('.tl-busca input')) return;
  buscaTl = e.target.value;
  const termo = normalizar(buscaTl.trim());
  $$('#tierlist .tl-sem .tl-capa').forEach((el) => {
    const f = porId(el.dataset.id);
    el.hidden = Boolean(termo) && !normalizar(`${f.titulo} ${f.ano} ${f.diretor || ''}`).includes(termo);
  });
});
tierlist.addEventListener('keydown', (e) => {
  if (e.target.matches('.tl-busca input') && e.key === 'Escape' && e.target.value) {
    e.stopPropagation();
    e.target.value = '';
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tl-capa')) {
    e.preventDefault();
    abrirPainel(e.target.dataset.id);
  }
});

// Arrastar com o ponteiro, como no calendário: depois de 5 px uma cópia da capa
// segue o mouse e a própria capa (apagadinha) vai andando pelas tiers até o
// lugar onde vai ficar. Ao soltar, a ordem que está na tela é a que fica salva.
let arrastoTl = null; // { el, x0, y0, ativo, fantasma }
let ignorarCliqueTl = false;

function terminarArrastoTl() {
  if (!arrastoTl) return;
  arrastoTl.fantasma?.remove();
  arrastoTl.el.classList.remove('tl-origem');
  arrastoTl = null;
  tierlist.classList.remove('arrastando');
  $$('.tl-alvo', tierlist).forEach((el) => el.classList.remove('tl-alvo'));
}

// Muda o DOM e faz cada elemento escorregar da posição antiga para a nova
// (em vez de pular). Não passa pelo Movimento: é o que mostra para onde a capa
// ou a tier foi, então anima mesmo com as animações do Windows desligadas.
function escorregar(els, mudar) {
  const antes = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  mudar();
  for (const [el, r] of antes) {
    const n = el.getBoundingClientRect();
    const dx = r.left - n.left;
    const dy = r.top - n.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}

// Centro de um item pelo layout (offsetTop/Left), não pelo que está na tela:
// no meio de uma animação o retângulo visível ainda está saindo do lugar antigo.
function centroNoLayout(item, lista) {
  const r = lista.getBoundingClientRect();
  return {
    x: r.left + lista.clientLeft + item.offsetLeft - lista.scrollLeft + item.offsetWidth / 2,
    y: r.top + lista.clientTop + item.offsetTop - lista.scrollTop + item.offsetHeight / 2,
  };
}

// Põe a capa arrastada antes ou depois da capa mais próxima do ponteiro na lista.
function posicionarCapaTl(lista, el, x, y) {
  let perto = null;
  let menor = Infinity;
  const capas = $$('.tl-capa:not([hidden])', lista);
  for (const c of capas) {
    if (c === el) continue;
    const p = centroNoLayout(c, lista);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < menor) { menor = d; perto = c; }
  }
  let mudar = null;
  if (!perto) { if (el.parentElement !== lista) mudar = () => lista.append(el); }
  else if (x < centroNoLayout(perto, lista).x) { if (perto.previousElementSibling !== el) mudar = () => perto.before(el); }
  else if (perto.nextElementSibling !== el) mudar = () => perto.after(el);
  if (!mudar) return;
  const vizinhas = new Set([...capas, ...$$('.tl-capa:not([hidden])', el.parentElement)]);
  escorregar([...vizinhas].slice(0, 200), mudar);
}

tierlist.addEventListener('dragstart', (e) => e.preventDefault());

// Arrastar pelo rótulo move a tier inteira para cima ou para baixo; um clique
// (sem passar de 5 px) continua renomeando.
let arrastoTier = null; // { el, y0, ativo }

tierlist.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const rotulo = e.target.closest('button.tl-rotulo, .tl-alca');
  if (rotulo) { arrastoTier = { el: rotulo.closest('.tl-tier'), y0: e.clientY, ativo: false }; return; }
  const capa = e.target.closest('.tl-capa');
  if (!capa) return;
  arrastoTl = { el: capa, x0: e.clientX, y0: e.clientY, ativo: false };
});

document.addEventListener('pointermove', (e) => {
  if (!arrastoTl) return;
  if (!arrastoTl.ativo) {
    if (Math.hypot(e.clientX - arrastoTl.x0, e.clientY - arrastoTl.y0) < 5) return;
    arrastoTl.ativo = true;
    const fantasma = document.createElement('div');
    fantasma.className = 'cal-fantasma tl-fantasma';
    fantasma.innerHTML = capaHTML(porId(arrastoTl.el.dataset.id));
    document.body.append(fantasma);
    arrastoTl.fantasma = fantasma;
    arrastoTl.el.classList.add('tl-origem');
    tierlist.classList.add('arrastando');
  }
  e.preventDefault();
  arrastoTl.fantasma.style.transform = `translate(${e.clientX - 36}px, ${e.clientY - 54}px) rotate(-4deg)`;

  const sob = document.elementFromPoint(e.clientX, e.clientY);
  const linha = sob && tierlist.contains(sob) && sob.closest('.tl-tier, .tl-bandeja');
  const lista = linha && $('[data-soltar]', linha);
  $$('.tl-alvo', tierlist).forEach((el) => { if (el !== linha) el.classList.remove('tl-alvo'); });
  if (lista) {
    linha.classList.add('tl-alvo');
    posicionarCapaTl(lista, arrastoTl.el, e.clientX, e.clientY);
  }

  // Perto da borda de cima ou de baixo das tiers, elas rolam sozinhas.
  const tiersEl = $('.tl-tiers', tierlist);
  const r = tiersEl.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right) {
    if (e.clientY < r.top + 40 && e.clientY > r.top - 30) tiersEl.scrollTop -= 14;
    else if (e.clientY > r.bottom - 40 && e.clientY < r.bottom + 10) tiersEl.scrollTop += 14;
  }
});

document.addEventListener('pointerup', () => {
  if (!arrastoTl) return;
  if (!arrastoTl.ativo) { arrastoTl = null; return; } // foi um clique: abre os detalhes
  terminarArrastoTl();
  ignorarCliqueTl = true;
  setTimeout(() => { ignorarCliqueTl = false; }, 0);
  // A ordem da tela vira a ordem salva. Filmes que estão numa tier mas não
  // aparecem (desmarcados como vistos) continuam guardados no fim dela.
  const naTela = new Set($$('#tierlist .tl-capa').map((el) => el.dataset.id));
  // Quem estava na tela deixa uma vaga, preenchida na ordem nova; os escondidos
  // pelo filtro da tierlist ficam onde estavam.
  for (const t of tiers()) {
    const lista = $(`#tierlist [data-soltar="${t.id}"]`);
    const fila = lista ? $$('.tl-capa', lista).map((el) => el.dataset.id) : [];
    const novo = [];
    for (const id of t.filmes) {
      if (!naTela.has(id)) novo.push(id);
      else if (fila.length) novo.push(fila.shift());
    }
    t.filmes = [...novo, ...fila];
  }
  salvarTiers();
  renderTierlist();
});

document.addEventListener('pointermove', (e) => {
  if (!arrastoTier) return;
  if (!arrastoTier.ativo) {
    if (Math.abs(e.clientY - arrastoTier.y0) < 5) return;
    arrastoTier.ativo = true;
    arrastoTier.el.classList.add('tl-movendo');
    tierlist.classList.add('arrastando');
  }
  e.preventDefault();
  // Fica antes da primeira tier cujo meio está abaixo do ponteiro.
  const lista = $('.tl-tiers', tierlist);
  const outras = $$('.tl-tier', lista).filter((t) => t !== arrastoTier.el);
  const depois = outras.find((t) => e.clientY < centroNoLayout(t, lista).y);
  const el = arrastoTier.el;
  if (depois) { if (el.nextElementSibling !== depois) escorregar($$('.tl-tier', lista), () => depois.before(el)); }
  else if (lista.lastElementChild !== el) escorregar($$('.tl-tier', lista), () => lista.append(el));
  const r = lista.getBoundingClientRect();
  if (e.clientY < r.top + 40) lista.scrollTop -= 14;
  else if (e.clientY > r.bottom - 40) lista.scrollTop += 14;
});

function terminarArrastoTier() {
  if (!arrastoTier) return;
  const { el, ativo } = arrastoTier;
  arrastoTier = null;
  if (!ativo) return; // foi um clique: renomeia
  el.classList.remove('tl-movendo');
  tierlist.classList.remove('arrastando');
  ignorarCliqueTl = true;
  setTimeout(() => { ignorarCliqueTl = false; }, 0);
  const ordem = $$('#tierlist .tl-tier').map((t) => t.dataset.tier);
  tiers().sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));
  salvarTiers();
}
document.addEventListener('pointerup', terminarArrastoTier);
document.addEventListener('pointercancel', terminarArrastoTier);
window.addEventListener('blur', terminarArrastoTier);

document.addEventListener('pointercancel', terminarArrastoTl);
window.addEventListener('blur', terminarArrastoTl);

tierlist.addEventListener('click', (e) => {
  if (!ignorarCliqueTl) return;
  ignorarCliqueTl = false;
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);

$('#btn-tierlist').addEventListener('click', () => abrirTierlist());

// ---------- Atualização automática ----------

// Instalado: a versão nova já foi baixada; reiniciar instala (ou instala ao fechar).
api.aoAtualizacaoPronta(({ versao }) => {
  aviso(`A versão ${versao} do NANDFlix está pronta.`, { tipo: 'ok', duracao: 30000, acao: { rotulo: 'Reiniciar e atualizar', fn: () => api.instalarAtualizacao() } });
});
// Portátil: só avisa, com o link para baixar o .exe novo.
api.aoAtualizacaoDisponivel(({ versao, url }) => {
  aviso(`Saiu a versão ${versao} do NANDFlix.`, { duracao: 30000, acao: { rotulo: 'Baixar', fn: () => window.open(url) } });
});

// ---------- Estatísticas e retrospectiva ----------

// Tudo sai do que já está guardado: os dias em que cada filme foi visto
// (vistoEm), duração, diretor, país, gêneros, ano e a sua nota. "Tudo" conta
// também os filmes marcados como vistos sem data (vieram da planilha); um ano
// conta só o que tem data naquele ano. Cada vez que um filme foi visto é uma sessão.
const estatisticas = $('#retrospectiva');
// Os diretores de um filme como estão escritos (para mostrar; diretoresDe normaliza para comparar).
const nomesDiretores = (texto) => String(texto || '').split(/\s*(?:,|;|\/|&)\s*/).map((d) => d.trim()).filter(Boolean);
let periodoEst = 'tudo'; // 'tudo' | 'AAAA' | 'AAAA-MM'
// "outubro de 2026", "2026" ou "tudo".
const nomePeriodo = (p) => (p === 'tudo' ? 'tudo' : p.length === 7 ? mesLegivel(p) : p);
const mesesComFilmes = (ano) => [...new Set(estado.filmes.flatMap((f) => (f.vistoEm || []).filter((d) => d.startsWith(ano)).map((d) => d.slice(0, 7))))].sort();

function abrirEstatisticas() {
  fecharPrevia(false);
  const anos = anosComFilmes();
  periodoEst = anos.includes(hoje().slice(0, 4)) ? hoje().slice(0, 4) : 'tudo';
  estatisticas.hidden = false;
  renderEstatisticas();
  Movimento.animar($('#retrospectiva-caixa'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  $('#retrospectiva [data-e="fechar"]')?.focus({ preventScroll: true });
}

function fecharEstatisticas() {
  if (estatisticas.hidden) return;
  estatisticas.hidden = true;
  $('#retrospectiva-caixa').innerHTML = '';
}

const anosComFilmes = () => [...new Set(estado.filmes.flatMap((f) => (f.vistoEm || []).map((d) => d.slice(0, 4))))].sort();

function dadosDoPeriodo(periodo) {
  const sessoes = []; // { f, dia }
  const filmes = new Set();
  for (const f of estado.filmes) {
    const dias = (f.vistoEm || []).filter((d) => periodo === 'tudo' || d.startsWith(periodo));
    dias.forEach((dia) => sessoes.push({ f, dia }));
    if (dias.length || (periodo === 'tudo' && f.visto)) filmes.add(f);
  }
  const lista = [...filmes];
  // Horas: cada sessão conta; vistos sem data contam uma vez.
  const minutos = sessoes.reduce((t, s) => t + minutosDe(s.f), 0)
    + lista.filter((f) => !(f.vistoEm || []).length).reduce((t, f) => t + minutosDe(f), 0);
  const dias = [...new Set(sessoes.map((s) => s.dia))].sort();
  let sequencia = 0;
  let atual = 0;
  dias.forEach((d, i) => {
    atual = i && diaSeguinte(dias[i - 1]) === d ? atual + 1 : 1;
    sequencia = Math.max(sequencia, atual);
  });
  const comNota = lista.filter((f) => f.minhaNota);
  const media = comNota.length ? comNota.reduce((t, f) => t + f.minhaNota, 0) / comNota.length : 0;
  const revistos = lista.filter((f) => (f.vistoEm || []).filter((d) => periodo === 'tudo' || d.startsWith(periodo)).length > 1);
  return { sessoes, lista, minutos, dias, sequencia, comNota, media, revistos };
}

function ranking(valores, max = 8) {
  const m = new Map();
  for (const v of valores) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt')).slice(0, max);
}

// Colunas de um valor só (uma cor): a maior leva o número em cima; as outras mostram ao passar o mouse.
function colunasHTML(itens, rotuloDica) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const maior = itens.reduce((m, i) => (i.valor > m.valor ? i : m), itens[0]);
  return `<div class="est-colunas" style="--n:${itens.length}">${itens.map((i) => `
    <div class="est-col" tabindex="0" aria-label="${esc(`${i.rotuloLongo || i.rotulo}: ${rotuloDica(i.valor)}`)}">
      <span class="est-dica">${esc(i.rotuloLongo || i.rotulo)} · ${esc(rotuloDica(i.valor))}</span>
      <div class="est-trilho">${i === maior && i.valor ? `<span class="est-valor">${i.valor}</span>` : ''}<div class="est-barra" style="height:${(i.valor / max) * 100}%"></div></div>
      <span class="est-rotulo">${esc(i.rotulo)}</span>
    </div>`).join('')}</div>`;
}

// Ranking em barras deitadas, com o nome e o número em texto (não na cor).
function barrasHTML(itens, { clicar } = {}) {
  if (!itens.length) return '<p class="est-vazio">Sem dados ainda.</p>';
  const max = Math.max(...itens.map(([, n]) => n));
  return `<ol class="est-barras">${itens.map(([nome, n]) => `
    <li${clicar ? ` data-e="${clicar}" data-valor="${esc(nome)}" tabindex="0" role="button" title="Ver na lista"` : ''}>
      <span class="est-nome">${esc(nome)}</span>
      <span class="est-faixa"><span style="width:${(n / max) * 100}%"></span></span>
      <span class="est-num">${n}</span>
    </li>`).join('')}</ol>`;
}

function capasEstHTML(filmes, legenda = () => '') {
  return `<div class="est-capas">${filmes.map((f) => `
    <button class="est-capa" data-e="filme" data-id="${f.id}" title="${esc(f.titulo)}">${capaHTML(f)}<span>${legenda(f)}</span></button>`).join('')}</div>`;
}

function renderEstatisticas() {
  const caixa = $('#retrospectiva-caixa');
  const anos = anosComFilmes();
  const periodo = periodoEst;
  const d = dadosDoPeriodo(periodo);
  const horas = Math.round(d.minutos / 60);
  const numero = (n) => n.toLocaleString('pt-BR');
  const nomeMes = (m) => MESES[m].slice(0, 3);

  // Filmes por mês: os 12 meses do ano escolhido; em "Tudo", do primeiro mês com data até hoje.
  // Num mês só, filmes por dia.
  const doMesSo = periodo.length === 7;
  const anoSel = periodo === 'tudo' ? '' : periodo.slice(0, 4);
  let meses;
  if (doMesSo) {
    meses = [];
  } else if (periodo === 'tudo') {
    const primeiro = d.dias[0] ? d.dias[0].slice(0, 7) : hoje().slice(0, 7);
    meses = [];
    for (let m = primeiro; m <= hoje().slice(0, 7); m = mesVizinho(m, 1)) meses.push(m);
  } else {
    meses = Array.from({ length: 12 }, (_, i) => `${periodo}-${String(i + 1).padStart(2, '0')}`);
  }
  const porMes = meses.map((m) => {
    const n = d.sessoes.filter((s) => s.dia.startsWith(m)).length;
    const [a, mm] = m.split('-').map(Number);
    return { rotulo: periodo === 'tudo' && meses.length > 12 ? `${nomeMes(mm - 1)}/${String(a).slice(2)}` : nomeMes(mm - 1), rotuloLongo: mesLegivel(m), valor: n };
  });
  const porDia = !doMesSo ? [] : Array.from({ length: new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0).getDate() }, (_, i) => {
    const dia = `${periodo}-${String(i + 1).padStart(2, '0')}`;
    return { rotulo: String(i + 1), rotuloLongo: diaLegivel(dia), valor: d.sessoes.filter((x) => x.dia === dia).length };
  });

  const notas = Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((n) => ({
    rotulo: notaLegivel(n), rotuloLongo: `${notaLegivel(n)} estrela${n === 1 ? '' : 's'}`, valor: d.comNota.filter((f) => f.minhaNota === n).length,
  }));
  const melhores = [...d.comNota].sort((a, b) => b.minhaNota - a.minhaNota || a.titulo.localeCompare(b.titulo)).slice(0, 8);
  const maisRevistos = [...d.revistos].sort((a, b) => b.vistoEm.length - a.vistoEm.length).slice(0, 8);
  const doMes = Object.entries(estado.config.filmesDoMes || {})
    .filter(([m]) => periodo === 'tudo' || m.startsWith(periodo))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m]) => ({ m, f: filmeDoMes(m) })).filter((x) => x.f);
  const diretorTop = ranking(d.lista.flatMap((f) => nomesDiretores(f.diretor)), 1)[0];
  const paisTop = ranking(d.lista.map(paisPrincipal), 1)[0];
  const generoTop = ranking(d.lista.flatMap((f) => generos(f.info)), 1)[0];

  const frase = d.lista.length
    ? `${periodo === 'tudo' ? 'Até agora' : `Em ${nomePeriodo(periodo)}`}, você viu <b>${numero(d.lista.length)} filme${d.lista.length === 1 ? '' : 's'}</b>${horas ? `, somando <b>${numero(horas)} hora${horas === 1 ? '' : 's'}</b> de cinema` : ''}.`
      + (diretorTop ? ` Quem mais apareceu foi <b>${esc(diretorTop[0])}</b>` + (paisTop ? `, e o país que mais rendeu foi <b>${esc(paisTop[0])}</b>` : '') + '.' : '')
      + (generoTop ? ` Gênero do período: <b>${esc(generoTop[0])}</b>.` : '')
    : 'Nenhum filme visto neste período ainda.';

  const tile = (rotulo, valor, extra = '') => `<div class="est-tile"><span>${rotulo}</span><b>${valor}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
  caixa.innerHTML = `
    <div class="tl-topo est-topo">
      <h2>Estatísticas</h2>
      <div class="chips-linha est-periodos" role="radiogroup" aria-label="Período">
        ${['tudo', ...anos].map((p) => `<button class="chip${p === periodo || p === anoSel ? ' ativo' : ''}" data-e="periodo" data-periodo="${p}" role="radio" aria-checked="${p === periodo || p === anoSel}">${p === 'tudo' ? 'Tudo' : p}</button>`).join('')}
      </div>
      <button class="redondo tl-fechar" data-e="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
      ${anoSel ? `<div class="chips-linha est-meses" role="radiogroup" aria-label="Mês de ${anoSel}">
        <button class="chip chip-mes${!doMesSo ? ' ativo' : ''}" data-e="periodo" data-periodo="${anoSel}" role="radio" aria-checked="${!doMesSo}">O ano todo</button>
        ${mesesComFilmes(anoSel).map((m) => `<button class="chip chip-mes${m === periodo ? ' ativo' : ''}" data-e="periodo" data-periodo="${m}" role="radio" aria-checked="${m === periodo}">${MESES[Number(m.slice(5)) - 1]}</button>`).join('')}
      </div>` : ''}
    </div>
    <section class="est-hero">
      <span class="est-kicker">${icone('Sparkles')} ${periodo === 'tudo' ? 'Sua retrospectiva' : `Retrospectiva de ${nomePeriodo(periodo)}`}</span>
      <p>${frase}</p>
      ${d.lista.length ? `<button class="btn btn-primario est-story" data-e="story">${icone('ImagePlus')} Criar stories da retrospectiva</button>` : ''}
    </section>
    <div class="est-tiles">
      ${tile('Filmes vistos', numero(d.lista.length), d.sessoes.length > d.lista.length ? `${numero(d.sessoes.length)} sessões` : '')}
      ${tile('Horas de filme', numero(horas), d.lista.length ? `${Math.round(d.minutos / Math.max(1, d.sessoes.length + d.lista.filter((f) => !(f.vistoEm || []).length).length))} min em média` : '')}
      ${tile('Dias com filme', numero(d.dias.length), d.sequencia > 1 ? `${d.sequencia} dias seguidos no máximo` : '')}
      ${tile('Sua nota média', d.media ? `${icone('Star', { preenchido: true })}${notaLegivel(Math.round(d.media * 10) / 10)}` : '—', d.comNota.length ? `${d.comNota.length} com nota` : 'dê notas nos detalhes')}
      ${tile('Revistos', numero(d.revistos.length))}
    </div>
    <div class="est-grade">
      <section class="est-cartao est-largo">
        <h3>${doMesSo ? 'Filmes por dia' : 'Filmes por mês'}</h3>
        ${d.sessoes.length ? colunasHTML(doMesSo ? porDia : porMes, (n) => `${n} filme${n === 1 ? '' : 's'}`) : '<p class="est-vazio">As datas começam a contar quando você marca um filme como visto (ou lança o dia nos detalhes).</p>'}
      </section>
      <section class="est-cartao"><h3>Diretores mais vistos</h3>${barrasHTML(ranking(d.lista.flatMap((f) => nomesDiretores(f.diretor))), { clicar: 'diretor' })}</section>
      <section class="est-cartao"><h3>Países</h3>${barrasHTML(ranking(d.lista.map(paisPrincipal)), { clicar: 'pais' })}</section>
      <section class="est-cartao"><h3>Gêneros</h3>${barrasHTML(ranking(d.lista.flatMap((f) => generos(f.info))))}</section>
      <section class="est-cartao"><h3>Décadas</h3>${barrasHTML(ranking(d.lista.map(decadaDe).filter((x) => x !== null), 20)
        .sort((a, b) => a[0] - b[0]).map(([x, n]) => [`Anos ${x < 2000 ? String(x).slice(2) : x}`, n]))}</section>
      <section class="est-cartao est-largo">
        <h3>Suas notas</h3>
        ${d.comNota.length ? colunasHTML(notas, (n) => `${n} filme${n === 1 ? '' : 's'}`) : '<p class="est-vazio">Dê notas de ½ a 5 estrelas nos detalhes de cada filme.</p>'}
      </section>
      ${melhores.length ? `<section class="est-cartao est-largo"><h3>Suas maiores notas</h3>${capasEstHTML(melhores, (f) => `${icone('Star', { preenchido: true })}${notaLegivel(f.minhaNota)}`)}</section>` : ''}
      ${doMes.length ? `<section class="est-cartao est-largo"><h3>${icone('Trophy')} Filmes do mês</h3>${capasEstHTML(doMes.map((x) => x.f), (f) => esc(mesLegivel(doMes.find((x) => x.f === f).m)))}</section>` : ''}
      ${maisRevistos.length ? `<section class="est-cartao est-largo"><h3>Os que você mais reviu</h3>${capasEstHTML(maisRevistos, (f) => `${f.vistoEm.length}×`)}</section>` : ''}
    </div>`;
  Movimento.sequencia($$('#retrospectiva .est-tile, #retrospectiva .est-cartao'), { y: 10, duracao: 380, passo: 30, atrasoInicial: 60 });
}

estatisticas.addEventListener('click', (e) => {
  if (e.target === estatisticas) { fecharEstatisticas(); return; }
  const alvo = e.target.closest('[data-e]');
  if (!alvo) return;
  switch (alvo.dataset.e) {
    case 'fechar': fecharEstatisticas(); break;
    case 'periodo': periodoEst = alvo.dataset.periodo; renderEstatisticas(); break;
    case 'story': abrirRetrospectivaStory(periodoEst); break;
    case 'filme': abrirPainel(alvo.dataset.id); break;
    case 'diretor': fecharEstatisticas(); filtrarDiretor(alvo.dataset.valor); break;
    case 'pais': fecharEstatisticas(); filtrarPais(alvo.dataset.valor); break;
  }
});
estatisticas.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li[data-e]')) { e.preventDefault(); e.target.click(); }
});

$('#btn-estatisticas').addEventListener('click', () => abrirEstatisticas());

// ---------- Início ----------

(async function iniciar() {
  $('#btn-lupa').dataset.dica = `Pesquisar (${MAC ? '⌘' : 'Ctrl'} F)`;
  const dados = await api.carregar();
  estado.filmes = dados.filmes;
  estado.config = dados.config;
  atualizarBotaoFiltros();
  estado.versao = dados.versao;
  estado.ordenacao = dados.config.ordenacao || 'ordem';
  $('#ordenacao').value = estado.ordenacao;
  aplicarVista(dados.config.visualizacao === 'lista' ? 'lista' : 'grade');
  // Já começa com um filme sorteado.
  sortear({ rolar: false, avisarSeVazio: false });
  // Sem conta conectada, a tela de entrada vem antes de tudo. Ao entrar, os
  // dados da nuvem (e a chave do TMDB, se estiver lá) chegam em seguida.
  if (await mostrarEntradaSePreciso(estado.filmes)) {
    await esperarSincronia();
    if (estado.filmes.length && filmeNoDestaque() == null) sortear({ rolar: false, avisarSeVazio: false });
  }
  if (!estado.config.tmdbKey) pedirChaveTmdb();
  else if (estado.filmes.length) buscarCapas({ automatica: true });
})();

// NANDRoll: liga o bloco de anime do painel (episódios, status, onde assistir).
ligarAnimeNoPainel();
