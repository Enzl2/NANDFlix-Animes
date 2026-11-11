'use strict';

// ---------- Tela inicial do celular ----------
//
// No celular, a tela inicial do PC (destaque com trailer, fileira de favoritos
// e a grade de todos os filmes) dá lugar a uma tela feita para o polegar:
// topo com o nome da tela, pílulas de filtro, um cartão de destaque e várias
// fileiras de capas para rolar de lado. Embaixo, a barra de navegação.
// Tocar numa capa abre os detalhes de sempre (abrirPainel).

const cel = {
  modo: { tipo: 'inicio' }, // { tipo: 'inicio' } | { tipo: 'filtro', filtro } | { tipo: 'genero', genero } | { tipo: 'todos' }
  destaqueId: null,
};

const ROTULOS_FILTRO = { 'nao-vistos': 'Não vistos', vistos: 'Vistos', favoritos: 'Favoritos', animes: 'Animes', assistindo: 'Assistindo' };

// ---- Estrutura (criada uma vez) ----

function montarCelular() {
  const topo = document.createElement('header');
  topo.className = 'cel-topo';
  topo.innerHTML = `
    <button class="cel-marca" data-cel="inicio" aria-label="Início"><img src="icone.png" alt=""></button>
    <h1 class="cel-titulo marca-nandflix" id="cel-titulo">nandflix</h1>
    <button class="cel-icone" data-cel="sortear" aria-label="Sortear um filme">${icone('Dices')}</button>
    <button class="cel-icone" data-cel="adicionar" aria-label="Adicionar filme">${icone('Plus')}</button>`;
  document.body.append(topo);

  const inicio = document.createElement('div');
  inicio.className = 'cel-inicio';
  inicio.id = 'cel-inicio';
  $('#principal').prepend(inicio);

  const nav = document.createElement('nav');
  nav.className = 'cel-nav';
  nav.setAttribute('aria-label', 'Navegação');
  const item = (id, ic, nome) => `<button class="cel-nav-item" data-cel="${id}">${icone(ic)}<span>${nome}</span></button>`;
  nav.innerHTML = item('inicio', 'House', 'Início') + item('calendario', 'CalendarDays', 'Calendário')
    + item('buscar', 'Search', 'Buscar') + item('tierlist', 'Medal', 'Tierlist') + item('mais', 'Menu', 'Mais');
  document.body.append(nav);

  document.addEventListener('click', aoTocarCelular);
  // O topo ganha fundo quando a tela rola.
  $('#principal').addEventListener('scroll', () => {
    topo.classList.toggle('rolado', $('#principal').scrollTop > 24);
  }, { passive: true });
}

// ---- Dados das fileiras ----

const embaralhar = (l, semente) => l.map((x, i) => [x, Math.sin(i * 9301 + semente) * 1e4 % 1]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
const ultimaVezVisto = (f) => (f.vistoEm && f.vistoEm.length ? f.vistoEm.slice().sort().at(-1) : '');

function filmesDoModo() {
  const m = cel.modo;
  const todos = estado.filmes;
  if (m.tipo === 'filtro') {
    if (m.filtro === 'nao-vistos') return todos.filter((f) => !f.visto);
    if (m.filtro === 'vistos') return todos.filter((f) => f.visto);
    if (m.filtro === 'favoritos') return todos.filter((f) => f.favorito);
    if (m.filtro === 'animes' || m.filtro === 'assistindo') return todos.filter((f) => passaFiltroAnime(f, m.filtro)); // NANDRoll
  }
  if (m.tipo === 'genero') return todos.filter((f) => generos(f.info).includes(m.genero));
  return todos;
}

function fileirasDoModo(lista) {
  const fileiras = [];
  const add = (titulo, filmes, opcoes = {}) => { if (filmes.length >= (opcoes.minimo || 1)) fileiras.push({ titulo, filmes: filmes.slice(0, 24), ...opcoes }); };
  const naoVistos = lista.filter((f) => !f.visto);
  const hojeIds = idsWatchlist();

  // NANDRoll: os animes em andamento vêm primeiro, com o "+1" no cartão.
  if (cel.modo.tipo === 'inicio' || (cel.modo.tipo === 'filtro' && ['animes', 'assistindo'].includes(cel.modo.filtro))) add('Continue assistindo', seriesAssistindo(), { continuar: true });
  if (cel.modo.tipo === 'inicio') add('Para ver hoje', hojeIds.map(porId).filter(Boolean));
  if (cel.modo.tipo !== 'filtro' || cel.modo.filtro !== 'favoritos') add('Seus favoritos', lista.filter((f) => f.favorito && !f.visto));
  add('Na sua lista', naoVistos.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)), { minimo: 3 });
  add('Suas maiores notas', lista.filter((f) => f.visto && f.minhaNota >= 4).sort((a, b) => b.minhaNota - a.minhaNota || ultimaVezVisto(b).localeCompare(ultimaVezVisto(a))), { grande: true, nota: true, minimo: 3 });

  // Um gênero por fileira: os que mais têm filmes não vistos.
  if (cel.modo.tipo !== 'genero') {
    const conta = new Map();
    for (const f of naoVistos) for (const g of generos(f.info)) conta.set(g, (conta.get(g) || 0) + 1);
    const top = [...conta].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const semente = Number(hoje().replace(/-/g, ''));
    for (const [g] of top) add(g, embaralhar(naoVistos.filter((f) => generos(f.info).includes(g)), semente), { genero: g });
  }

  // O diretor com mais filmes por ver.
  const porDiretor = new Map();
  for (const f of naoVistos) if (f.diretor) porDiretor.set(f.diretor, (porDiretor.get(f.diretor) || 0) + 1);
  const [diretor, nDir] = [...porDiretor].sort((a, b) => b[1] - a[1])[0] || [];
  if (diretor && nDir >= 3) add(`De ${diretor}`, naoVistos.filter((f) => f.diretor === diretor));

  add('Para uma noite curta', naoVistos.filter((f) => f.duracao && f.duracao <= 100).sort((a, b) => a.duracao - b.duracao), { minimo: 3 });
  add('Vistos recentemente', lista.filter((f) => f.visto && ultimaVezVisto(f)).sort((a, b) => ultimaVezVisto(b).localeCompare(ultimaVezVisto(a))), { nota: true });
  add('Adicionados recentemente', lista.slice().sort((a, b) => String(b.adicionadoEm || '').localeCompare(String(a.adicionadoEm || ''))), { minimo: 3 });
  return fileiras;
}

function escolherDestaque(lista) {
  const atual = cel.destaqueId && lista.find((f) => f.id === cel.destaqueId);
  if (atual) return atual;
  const doPc = filmeNoDestaque();
  const f = (doPc && lista.find((x) => x.id === doPc)) || lista.find((x) => !x.visto && x.poster) || lista[0];
  cel.destaqueId = f ? f.id : null;
  return f;
}

// ---- HTML ----

function capaCelHTML(f, { nota = false } = {}) {
  const src = srcCapa(f);
  const selo = naWatchlist(f.id) ? `<span class="cel-selo">Hoje</span>`
    : nota && f.minhaNota ? `<span class="cel-selo cel-selo-nota">${icone('Star', { preenchido: true })}${notaLegivel(f.minhaNota)}</span>` : '';
  return `<button class="cel-capa" data-cel="filme" data-id="${f.id}" aria-label="${esc(f.titulo)}">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="cel-capa-vazia">${esc(f.titulo)}</span>`}
    ${f.visto && !nota ? `<span class="cel-visto">${icone('Check')}</span>` : ''}${selo || seloSerieHTML(f)}
  </button>`;
}

function destaqueCelHTML(f) {
  const src = srcCapa(f);
  const logo = srcLogo(f);
  const meta = [...generos(f.info).slice(0, 3), duracaoDe(f) || f.ano].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('<i>•</i>');
  const naHoje = naWatchlist(f.id);
  return `
    <article class="cel-destaque">
      <button class="cel-destaque-capa" data-cel="filme" data-id="${f.id}" aria-label="Ver os detalhes de ${esc(f.titulo)}">
        ${src ? `<img src="${esc(src)}" alt="">` : ''}
        ${src ? '' : `<span class="cel-destaque-titulo">${logo ? `<img src="${esc(logo)}" alt="${esc(f.titulo)}" data-titulo-texto="${esc(f.titulo)}">` : `<b>${esc(f.titulo)}</b>`}</span>`}
      </button>
      <p class="cel-destaque-meta">${meta}</p>
      <div class="cel-destaque-botoes">
        <button class="cel-btn cel-btn-branco" data-cel="assistir" data-id="${f.id}">${icone('Play', { preenchido: true })} Assistir</button>
        <button class="cel-btn cel-btn-cinza" data-cel="hoje" data-id="${f.id}">${icone(naHoje ? 'Check' : 'Plus')} ${naHoje ? 'Para hoje' : 'Ver hoje'}</button>
      </div>
    </article>`;
}

function pilulasHTML() {
  const m = cel.modo;
  const ativo = (tipo, valor) => (m.tipo === tipo && (m.filtro === valor || m.genero === valor) ? ' ativa' : '');
  const fechar = m.tipo !== 'inicio' ? `<button class="cel-pilula cel-pilula-x" data-cel="inicio" aria-label="Voltar ao início">${icone('X')}</button>` : '';
  const filtros = Object.entries(ROTULOS_FILTRO).filter(([k]) => nandrollLigado() || (k !== 'animes' && k !== 'assistindo')).map(([k, r]) => `<button class="cel-pilula${ativo('filtro', k)}" data-cel="filtro" data-filtro="${k}">${r}</button>`).join('');
  return `<div class="cel-pilulas">${fechar}${filtros}
    <button class="cel-pilula${m.tipo === 'genero' ? ' ativa' : ''}" data-cel="generos">${m.tipo === 'genero' ? esc(m.genero) : 'Gêneros'} ${icone('ChevronDown')}</button>
    <button class="cel-pilula${m.tipo === 'todos' ? ' ativa' : ''}" data-cel="todos">Todos</button>
  </div>`;
}

function fileiraHTML(r) {
  return `<section class="cel-fileira${r.grande ? ' grande' : ''}">
    <h2>${r.genero ? `<button data-cel="genero" data-genero="${esc(r.genero)}">${esc(r.titulo)} ${icone('ChevronRight')}</button>` : esc(r.titulo)}</h2>
    <div class="cel-trilho">${r.filmes.map((f) => (r.continuar ? cartaoContinuarHTML(f, capaCelHTML(f, r)) : capaCelHTML(f, r))).join('')}</div>
  </section>`;
}

function tituloDoModo() {
  const m = cel.modo;
  if (m.tipo === 'filtro') return ROTULOS_FILTRO[m.filtro];
  if (m.tipo === 'genero') return m.genero;
  if (m.tipo === 'todos') return 'Todos os filmes';
  return 'Início';
}

function renderCelular() {
  const el = $('#cel-inicio');
  if (!el) return;
  // No início, a marca; nas outras telas, o nome delas.
  const titulo = $('#cel-titulo');
  titulo.classList.toggle('marca-nandflix', cel.modo.tipo === 'inicio');
  titulo.textContent = cel.modo.tipo === 'inicio' ? 'nandflix' : tituloDoModo();
  document.documentElement.classList.toggle('cel-modo-todos', cel.modo.tipo === 'todos');
  for (const b of $$('.cel-nav-item')) b.classList.toggle('ativo', b.dataset.cel === 'inicio');
  if (!estado.filmes.length) { el.innerHTML = pilulasHTML(); return; }
  if (cel.modo.tipo === 'todos') { el.innerHTML = pilulasHTML(); return; }
  const lista = filmesDoModo();
  const destaque = escolherDestaque(cel.modo.tipo === 'inicio' ? lista.filter((f) => !f.visto) : lista);
  const fileiras = fileirasDoModo(lista);
  const rolagens = new Map([...$$('.cel-fileira', el)].map((s) => [$('h2', s).textContent.trim(), $('.cel-trilho', s).scrollLeft]));
  el.innerHTML = `
    ${destaque && srcCapa(destaque) ? `<div class="cel-brilho" style="background-image:url('${esc(srcCapa(destaque))}')" aria-hidden="true"></div>` : ''}
    ${pilulasHTML()}
    ${destaque ? destaqueCelHTML(destaque) : ''}
    ${cel.modo.tipo === 'genero' ? `<div class="cel-grade">${lista.map((f) => capaCelHTML(f)).join('')}</div>` : fileiras.map(fileiraHTML).join('')}
    <div class="cel-fim"></div>`;
  // Mantém onde cada fileira estava (um render não pode jogar a fileira de volta ao começo).
  for (const s of $$('.cel-fileira', el)) {
    const x = rolagens.get($('h2', s).textContent.trim());
    if (x) $('.cel-trilho', s).scrollLeft = x;
  }
}

// ---- Folhas (gêneros e "Mais") ----

function abrirFolha(html, classe = '') {
  fecharFolha();
  const el = document.createElement('div');
  el.className = `cel-folha ${classe}`;
  el.innerHTML = `<div class="cel-folha-caixa">${html}</div><button class="cel-folha-fechar" data-cel="fechar-folha" aria-label="Fechar">${icone('X')}</button>`;
  el.addEventListener('click', (e) => { if (e.target === el) fecharFolha(); });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('aberta'));
}
function fecharFolha() {
  const el = $('.cel-folha');
  if (!el) return false;
  el.classList.remove('aberta');
  setTimeout(() => el.remove(), 200);
  return true;
}

function abrirGeneros() {
  const conta = new Map();
  for (const f of estado.filmes) for (const g of generos(f.info)) conta.set(g, (conta.get(g) || 0) + 1);
  const lista = [...conta].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  abrirFolha(`<div class="cel-generos">${lista.map(([g, n]) => `<button data-cel="genero" data-genero="${esc(g)}"${cel.modo.genero === g ? ' class="ativo"' : ''}>${esc(g)} <small>${n}</small></button>`).join('')}</div>`, 'cel-folha-generos');
}

function abrirMais() {
  const item = (id, ic, nome) => `<button data-cel="${id}">${icone(ic)}<span>${nome}</span></button>`;
  abrirFolha(`<div class="cel-mais">
    ${item('paginas', 'NotebookPen', 'Suas páginas')}
    ${item('estatisticas', 'ChartColumn', 'Estatísticas')}
    ${item('sortear', 'Dices', 'Sortear um filme')}
    ${item('sortear-filtro', 'SlidersHorizontal', 'Sortear com filtro')}
    ${nandrollLigado() ? item('agenda', 'CalendarClock', 'Agenda de episódios') : ''}
    ${item('adicionar', 'Plus', nandrollLigado() ? 'Adicionar filme ou anime' : 'Adicionar filme')}
    ${item('todos', 'LayoutGrid', 'Todos os filmes')}
    ${item('config', 'Settings', 'Configurações')}
  </div>`, 'cel-folha-mais');
}

// ---- Toques ----

function irPara(modo) {
  cel.modo = modo;
  if (modo.tipo !== 'inicio') cel.destaqueId = null;
  if (modo.tipo === 'todos') {
    estado.filtro = 'todos';
    $$('.chip[data-filtro]').forEach((c) => c.classList.toggle('ativo', c.dataset.filtro === 'todos'));
  }
  renderCelular();
  if (modo.tipo === 'todos') render();
  $('#principal').scrollTo({ top: 0 });
}

function aoTocarCelular(e) {
  const b = e.target.closest('[data-cel]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.cel) {
    case 'filme': abrirPainel(id); break;
    case 'assistir': abrirStremio(id); break;
    case 'hoje': alternarWatchlist(id); renderCelular(); break;
    case 'inicio': fecharFolha(); irPara({ tipo: 'inicio' }); break;
    case 'filtro': irPara(cel.modo.tipo === 'filtro' && cel.modo.filtro === b.dataset.filtro ? { tipo: 'inicio' } : { tipo: 'filtro', filtro: b.dataset.filtro }); break;
    case 'generos': abrirGeneros(); break;
    case 'genero': fecharFolha(); irPara({ tipo: 'genero', genero: b.dataset.genero }); break;
    case 'todos': fecharFolha(); irPara({ tipo: 'todos' }); break;
    case 'fechar-folha': fecharFolha(); break;
    case 'sortear': fecharFolha(); cel.destaqueId = null; sortear({ rolar: false }); renderCelular(); $('#principal').scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'sortear-filtro': fecharFolha(); $('#btn-sortear-filtro').click(); break;
    case 'adicionar': fecharFolha(); abrirAdicionar(); break;
    case 'calendario': abrirCalendario(); break;
    case 'buscar': abrirPaleta(); break;
    case 'tierlist': abrirTierlist(); break;
    case 'mais': abrirMais(); break;
    case 'paginas': fecharFolha(); $('#btn-paginas').click(); break;
    case 'estatisticas': fecharFolha(); abrirEstatisticas(); break;
    case 'config': fecharFolha(); abrirConfiguracoes(); break;
  }
}

// Esc / Voltar: fecha a folha; fora do início, volta para o início.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (fecharFolha()) { e.stopImmediatePropagation(); return; }
  const algoAberto = (modal && modal.open) || estado.painelId || $('.cel-telas-abertas') || document.querySelector('.calendario:not([hidden]), .retro-tela, .story-tela, .paleta, .entrada');
  if (!algoAberto && cel.modo.tipo !== 'inicio') { e.stopImmediatePropagation(); irPara({ tipo: 'inicio' }); }
}, true);

// O app redesenha a lista quando algo muda: a tela do celular vai junto.
const renderPc = render;
// eslint-disable-next-line no-func-assign
render = function renderComCelular() {
  renderPc();
  renderCelular();
};

// Com uma tela por cima (detalhes, calendário, tierlist, busca…), o topo e a
// barra de baixo saem do caminho.
let checarCoberto = 0;
new MutationObserver(() => {
  if (checarCoberto) return;
  checarCoberto = requestAnimationFrame(() => {
    checarCoberto = 0;
    const coberto = Boolean(estado.painelId)
      || Boolean(document.querySelector('.calendario:not([hidden]), #foco:not([hidden]), .retro-tela, .story-tela, .paleta, .entrada, dialog[open]'));
    document.documentElement.classList.toggle('cel-coberto', coberto);
  });
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });

montarCelular();
renderCelular();
