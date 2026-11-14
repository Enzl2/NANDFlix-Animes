'use strict';

// ---------- nandplay no celular: pílulas, fileiras e capas de jogo ----------
//
// Carregado depois de inicio.js e de src/jogos-lista.js (que tem o status, as tags e a Steam
// dos jogos). A tela inicial do celular é a do inicio.js; aqui, no nandplay, ela troca as pílulas
// (status, Steam, consoles, tags), as fileiras ("Jogando", "Quero jogar", "Zerados
// recentemente", por console) e o cartão de destaque. Um toque numa pílula abre a grade do
// filtro (o mesmo modo "genero" do inicio.js, com a chave do filtro em `jogos`).

// [chave do filtro, rótulo da pílula]. As de Steam só aparecem quando há o que mostrar.
const PILULAS_JOGO = [
  ['status:jogando', 'Jogando'], ['status:quero', 'Quero jogar'], ['zerados', 'Zerados'], ['status:pausado', 'Pausados'],
  ['status:cem', '100%'], ['status:larguei', 'Largados'], ['favoritos', 'Favoritos'], ['steam', 'Na Steam'], ['biblioteca', 'Na biblioteca'],
  ['recentes', 'Jogados recentemente'],
];

function passaModoJogo(f, chave) {
  if (!ehJogo(f)) return false;
  if (chave.startsWith('status:')) return statusDoJogo(f) === chave.slice(7);
  if (chave.startsWith('console:')) return consolesDoJogo(f).includes(chave.slice(8));
  if (chave.startsWith('tag:')) return tagsDoJogo(f).includes(chave.slice(4));
  if (chave === 'zerados') return Boolean(f.visto);
  if (chave === 'favoritos') return Boolean(f.favorito);
  if (chave === 'steam') return Boolean(f.steam);
  if (chave === 'recentes') return jogadoRecentemente(f);
  if (chave === 'biblioteca') { const bib = appidsNaBiblioteca(); return Boolean(bib) && bib.has(Number(f.steam)); }
  return true;
}

const filmesDoModoFilme = filmesDoModo;
filmesDoModo = () => (cel.modo.jogos ? itensDaPlataforma().filter((f) => passaModoJogo(f, cel.modo.jogos)) : filmesDoModoFilme());

// ---- Pílulas ----

const pilulasHTMLFilme = pilulasHTML;
pilulasHTML = () => {
  if (!ehPlataformaJogos()) return pilulasHTMLFilme();
  const m = cel.modo;
  const jogos = itensDaPlataforma();
  const consoles = contagens(consolesDoJogo);
  const tags = contagens(tagsDoJogo);
  const visivel = ([k]) => (k === 'steam' ? jogos.some((f) => f.steam) : k === 'biblioteca' || k === 'recentes' ? temBibliotecaSteam() : true);
  const pilula = ([k, r]) => `<button class="cel-pilula${m.jogos === k ? ' ativa' : ''}" data-cel="jogo-pilula" data-jogo="${esc(k)}" data-rotulo="${esc(r)}">${esc(r)}</button>`;
  const aberta = (prefixo) => (m.jogos && m.jogos.startsWith(prefixo) ? ' ativa' : '');
  const fechar = m.tipo !== 'inicio' ? `<button class="cel-pilula cel-pilula-x" data-cel="inicio" aria-label="Voltar ao início">${icone('X')}</button>` : '';
  return `<div class="cel-pilulas">${fechar}${PILULAS_JOGO.filter(visivel).map(pilula).join('')}
    ${consoles.length ? `<button class="cel-pilula${aberta('console:')}" data-cel="jogo-consoles">${aberta('console:') ? esc(m.genero) : 'Consoles'} ${icone('ChevronDown')}</button>` : ''}
    ${tags.length ? `<button class="cel-pilula${aberta('tag:')}" data-cel="jogo-tags">${aberta('tag:') ? esc(m.genero) : 'Tags'} ${icone('ChevronDown')}</button>` : ''}
    <button class="cel-pilula${m.tipo === 'todos' ? ' ativa' : ''}" data-cel="todos">Todos</button>
  </div>`;
};

// ---- Fileiras ----

const fileirasDoModoFilme = fileirasDoModo;
fileirasDoModo = (lista) => {
  if (!ehPlataformaJogos() || cel.modo.tipo !== 'inicio') return fileirasDoModoFilme(lista);
  const fileiras = [];
  const add = (titulo, itens, opcoes = {}) => { if (itens.length >= (opcoes.minimo || 1)) fileiras.push({ titulo, filmes: itens.slice(0, 24), ...opcoes }); };
  const porStatus = (s) => lista.filter((f) => statusDoJogo(f) === s);
  const recente = (f) => f.zeradoEm || ultimaVezVisto(f) || '';
  add('Jogando', porStatus('jogando'));
  add('Quero jogar hoje', idsWatchlist().map(porId).filter(Boolean));
  add('Quero jogar', porStatus('quero').sort((a, b) => (a.ordem || 0) - (b.ordem || 0)));
  add('Seus favoritos', lista.filter((f) => f.favorito && !f.visto));
  add('Zerados recentemente', lista.filter((f) => f.visto).sort((a, b) => recente(b).localeCompare(recente(a))), { nota: true });
  add('Pausados', porStatus('pausado'));
  // Os consoles com mais jogos, uma fileira cada.
  for (const [c] of contagens(consolesDoJogo).filter(([, n]) => n >= 3).slice(0, 4)) add(`No ${c}`, lista.filter((f) => consolesDoJogo(f).includes(c)));
  add('Adicionados recentemente', lista.slice().sort((a, b) => String(b.adicionadoEm || '').localeCompare(String(a.adicionadoEm || ''))), { minimo: 3 });
  return fileiras;
};

// ---- Capa e destaque do jogo ----

const capaCelHTMLFilme = capaCelHTML;
capaCelHTML = (f, opcoes = {}) => {
  if (!ehJogo(f)) return capaCelHTMLFilme(f, opcoes);
  const src = srcCapa(f);
  const alt = imagemAlternativaDoJogo(f);
  return `<button class="cel-capa" data-cel="filme" data-id="${f.id}" aria-label="${esc(f.titulo)}">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async"${alt ? ` data-alt="${esc(alt)}"` : ''}>` : `<span class="cel-capa-vazia">${esc(f.titulo)}</span>`}
    ${seloStatusJogoHTML(f)}${naWatchlist(f.id) ? '<span class="cel-selo">Hoje</span>' : ''}
  </button>`;
};
// A capa que falha cai no cabeçalho da Steam (o tratador do PC só cuida das capas da lista).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.cel-capa, .cel-destaque-capa') || !img.dataset.alt) return;
  const alt = img.dataset.alt;
  img.dataset.alt = '';
  if (img.src !== alt) img.src = alt;
}, true);

const destaqueCelHTMLFilme = destaqueCelHTML;
destaqueCelHTML = (f) => {
  if (!ehJogo(f)) return destaqueCelHTMLFilme(f);
  const src = srcCapa(f);
  const alt = imagemAlternativaDoJogo(f);
  const meta = [rotuloStatusJogo(statusDoJogo(f)), f.ano, consolesDoJogo(f).slice(0, 3).join(' ')].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const naHoje = naWatchlist(f.id);
  return `
    <article class="cel-destaque">
      <button class="cel-destaque-capa" data-cel="filme" data-id="${f.id}" aria-label="Ver os detalhes de ${esc(f.titulo)}">
        ${src ? `<img src="${esc(src)}" alt=""${alt ? ` data-alt="${esc(alt)}"` : ''}>` : `<span class="cel-destaque-titulo"><b>${esc(f.titulo)}</b></span>`}
      </button>
      <h2 class="cel-letreiro">${esc(f.titulo)}</h2>
      <p class="cel-destaque-meta">${meta}</p>
      <div class="cel-destaque-botoes">
        ${f.steam ? `<button class="cel-btn cel-btn-branco" data-cel="steam" data-id="${f.id}">${icone('Gamepad2')} Ver na Steam</button>` : ''}
        <button class="cel-btn cel-btn-cinza" data-cel="hoje" data-id="${f.id}">${icone(naHoje ? 'Check' : 'Plus')} ${naHoje ? 'Para hoje' : 'Jogar hoje'}</button>
      </div>
    </article>`;
};

// ---- Toques das pílulas de jogo ----

// Folha com uma lista de consoles ou de tags (o mesmo visual da folha de gêneros).
function abrirFolhaJogo(itens, prefixo) {
  abrirFolha(`<div class="cel-generos">${itens.map(([nome, n]) => `<button data-cel="jogo-pilula" data-jogo="${prefixo}${esc(nome)}" data-rotulo="${esc(nome)}"${cel.modo.jogos === `${prefixo}${nome}` ? ' class="ativo"' : ''}>${esc(nome)} <small>${n}</small></button>`).join('')}</div>`, 'cel-folha-generos');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cel]');
  if (!b) return;
  switch (b.dataset.cel) {
    case 'jogo-pilula':
      fecharFolha();
      irPara(cel.modo.jogos === b.dataset.jogo ? { tipo: 'inicio' } : { tipo: 'genero', genero: b.dataset.rotulo, jogos: b.dataset.jogo });
      break;
    case 'jogo-consoles': abrirFolhaJogo(contagens(consolesDoJogo), 'console:'); break;
    case 'jogo-tags': abrirFolhaJogo(contagens(tagsDoJogo), 'tag:'); break;
    case 'steam': abrirSteamDoJogo(b.dataset.id); break;
  }
});

