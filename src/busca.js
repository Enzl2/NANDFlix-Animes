'use strict';

// ---------- Busca única (Ctrl+K) ----------
//
// Uma caixa só que procura nas ações do app, nos seus filmes, nas suas páginas
// e no TMDB, e já faz o que se quer com o resultado: Enter abre; Shift+Enter
// põe o filme na watchlist de hoje (ou adiciona, se ele vier do TMDB). Os
// botões de cada linha fazem o resto (página, story, listas…).

let paleta = null; // { el, itens, sel, termo, geracaoTmdb, tmdb }

const ACOES_PALETA = [
  { get titulo() { return voc('Adicionar'); }, icone: 'Plus', termos: 'novo', fazer: () => abrirAdicionar() },
  { titulo: 'Calendário', icone: 'CalendarDays', termos: 'diario watchlist hoje dia', fazer: () => abrirCalendario() },
  { titulo: 'Watchlist de hoje', icone: 'CalendarClock', termos: 'hoje calendario', fazer: () => abrirCalendario(hoje()) },
  { titulo: 'Suas páginas', icone: 'NotebookPen', termos: 'anotacoes textos resenhas', fazer: () => abrirPaginas() },
  { titulo: 'Tierlist', icone: 'Medal', termos: 'ranking tiers', fazer: () => abrirTierlist() },
  { titulo: 'Estatísticas', icone: 'ChartColumn', termos: 'retrospectiva numeros', fazer: () => abrirEstatisticas() },
  { titulo: 'Prêmios', recurso: 'premios', icone: 'Trophy', termos: 'oscar globo de ouro golden globe critics choice bafta sag actor awards spirit gotham cannes veneza venice berlim berlinale festival the game awards tga bafta games jogos cedula bolao palpites indicados vencedores premiacao', fazer: () => abrirPremios() },
  { titulo: 'Retrospectiva do mês em stories', recurso: 'retrospectiva', icone: 'Sparkles', termos: 'instagram imagem mes', fazer: () => abrirRetrospectivaStory(hoje().slice(0, 7)) },
  { titulo: 'Retrospectiva do ano em stories', recurso: 'retrospectiva', icone: 'Sparkles', termos: 'instagram imagem ano', fazer: () => abrirRetrospectivaStory(hoje().slice(0, 4)) },
  { get titulo() { return voc('sortear'); }, icone: 'Dices', termos: 'aleatorio sorteio', fazer: () => $('#btn-sortear').click() },
  { titulo: 'Sortear com filtro', icone: 'SlidersHorizontal', termos: 'sorteio filtros', fazer: () => abrirFiltrosSorteio() },
  { titulo: 'Listas', icone: 'Tags', termos: 'tags colecoes', fazer: () => abrirMenuListasTela($('#btn-listas')) },
  { titulo: 'Configurações', icone: 'Settings', termos: 'chave tmdb omdb opcoes', fazer: () => abrirConfiguracoes() },
  { titulo: 'Restaurar um backup', icone: 'History', termos: 'backup copia seguranca', fazer: () => abrirRestaurarBackup() },
  { titulo: 'Importar de outro app', icone: 'Download', termos: 'importar letterboxd imdb stremio rotten tomatoes csv avaliacoes notas watchlist', fazer: () => abrirImportar() },
];

function abrirPaleta(termo = '') {
  if (paleta) { $('.paleta-input', paleta.el).select(); return; }
  fecharPrevia?.(false);
  const el = document.createElement('div');
  el.className = 'paleta-tela';
  el.innerHTML = `
    <div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar em tudo">
      <div class="paleta-campo">
        ${icone('Search')}
        <input class="paleta-input" placeholder="${vocTexto('Busque {um}, uma página ou uma ação…')}" spellcheck="false" autocomplete="off"
               role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list">
        <kbd>Esc</kbd>
      </div>
      <div class="paleta-lista" id="paleta-lista" role="listbox"></div>
    </div>`;
  document.body.append(el);
  paleta = { el, itens: [], sel: 0, termo: '', geracaoTmdb: 0, externo: null, timer: null };
  const input = $('.paleta-input', el);
  input.value = termo;
  input.addEventListener('input', () => atualizarPaleta());
  input.addEventListener('keydown', teclaPaleta);
  el.addEventListener('pointerdown', (e) => { if (e.target === el) fecharPaleta(); });
  el.addEventListener('click', cliquePaleta);
  el.addEventListener('mousemove', (e) => {
    const linha = e.target.closest('.paleta-item');
    if (linha && Number(linha.dataset.i) !== paleta.sel) marcarPaleta(Number(linha.dataset.i), false);
  });
  Movimento.animar($('.paleta', el), [{ opacity: 0, transform: 'translateY(-8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180 });
  input.focus();
  atualizarPaleta();
}

function fecharPaleta() {
  if (!paleta) return;
  clearTimeout(paleta.timer);
  paleta.el.remove();
  paleta = null;
}

// Trecho da página em volta da palavra achada.
function trechoComTermo(html, palavras) {
  const texto = textoDaPagina(html).replace(/\s+/g, ' ');
  const norm = normalizar(texto);
  const i = Math.max(0, ...palavras.map((p) => norm.indexOf(p)).filter((x) => x >= 0).slice(0, 1));
  const ini = Math.max(0, i - 50);
  return `${ini ? '…' : ''}${texto.slice(ini, ini + 140).trim()}${ini + 140 < texto.length ? '…' : ''}`;
}

// De onde vêm os resultados de fora da lista, conforme a plataforma: filmes no TMDB (precisa da
// chave), animes na AniList (sem chave). O hub busca nos dois.
function fontesExternasPaleta() {
  const fontes = [];
  if (plataformaInclui('nandflix') && estado.config.tmdbKey) fontes.push('filme');
  if (plataformaInclui('nandanimes') && nandrollLigado()) fontes.push('anime');
  return fontes;
}

function atualizarPaleta() {
  const termo = $('.paleta-input', paleta.el).value.trim();
  const mudouTermo = termo !== paleta.termo;
  paleta.termo = termo;
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  const bate = (texto) => palavras.every((p) => normalizar(texto).includes(p));
  const itens = [];

  // Ações
  const disponiveis = ACOES_PALETA.filter((a) => !a.recurso || plataformaTem(a.recurso)); // Plataformas: sem prêmios no nandanimes
  const acoes = palavras.length ? disponiveis.filter((a) => bate(`${a.titulo} ${a.termos}`)) : disponiveis.slice(0, 7);
  const linhasAcoes = acoes.slice(0, palavras.length ? 4 : 7).map((a) => ({ grupo: 'Ações', tipo: 'acao', ...a }));
  if (!palavras.length) itens.push(...linhasAcoes);

  if (palavras.length) {
    // Seus filmes: quem começa com o termo vem primeiro.
    const t0 = normalizar(termo);
    const filmes = itensDaPlataforma() // Plataformas: só os da plataforma atual
      .filter((f) => bate([f.titulo, f.ano, f.diretor, f.buscaCapa, ...listasDe(f)].join(' ')))
      .sort((a, b) => Number(normalizar(b.titulo).startsWith(t0)) - Number(normalizar(a.titulo).startsWith(t0)) || a.titulo.localeCompare(b.titulo, 'pt'))
      .slice(0, 6);
    for (const f of filmes) itens.push({ grupo: `Seus ${voc('itens')}`, tipo: 'filme', f });

    // Suas páginas: só pelo texto (o título já aparece acima).
    if (termo.length >= 3) {
      const paginas = itensDaPlataforma().filter((f) => temPagina(f) && bate(textoDaPagina(f.pagina))).slice(0, 4);
      for (const f of paginas) itens.push({ grupo: 'Nas suas páginas', tipo: 'pagina', f, trecho: trechoComTermo(f.pagina, palavras) });
    }

    itens.push(...linhasAcoes);

    // Fora da lista (o que ainda não está nela): TMDB para filmes, AniList para animes (o hub busca nos dois)
    const fontes = fontesExternasPaleta();
    const veio = paleta.externo && paleta.externo.termo === termo;
    if (veio) {
      const naLista = new Set(estado.filmes.map((f) => String(f.tmdbId)).filter(Boolean));
      const idsAni = new Set(estado.filmes.map((f) => String(f.anilistId)).filter((x) => x !== 'undefined' && x !== 'null' && x));
      const lote = fontes.length > 1 ? 3 : 5;
      if (fontes.includes('filme')) for (const r of paleta.externo.tmdb.filter((x) => !naLista.has(String(x.tmdbId))).slice(0, lote)) itens.push({ grupo: 'No TMDB', tipo: 'tmdb', r });
      if (fontes.includes('anime')) for (const r of paleta.externo.anilist.filter((x) => !idsAni.has(String(x.anilistId))).slice(0, lote)) itens.push({ grupo: 'Na AniList', tipo: 'anilist', r });
    }
    itens.push({ grupo: veio ? 'Adicionar' : 'Adicionar', tipo: 'adicionar', titulo: `Adicionar “${termo}”`, icone: 'Plus' });
  }

  paleta.itens = itens;
  if (mudouTermo) paleta.sel = 0;
  paleta.sel = Math.min(paleta.sel, itens.length - 1);
  desenharPaleta();

  // Busca no TMDB um pouco depois de parar de digitar.
  if (mudouTermo) {
    clearTimeout(paleta.timer);
    if (termo.length >= 2 && fontesExternasPaleta().length) {
      const ger = ++paleta.geracaoTmdb;
      paleta.timer = setTimeout(async () => {
        const fontes = fontesExternasPaleta();
        const [rt, ra] = await Promise.all([
          fontes.includes('filme') ? api.pesquisarTmdb(termo) : null,
          fontes.includes('anime') ? api.pesquisarAnilist(termo) : null,
        ]);
        if (!paleta || paleta.geracaoTmdb !== ger) return;
        paleta.externo = { termo, tmdb: rt && rt.ok ? rt.dados : [], anilist: ra && ra.ok ? ra.dados : [] };
        atualizarPaleta();
      }, 350);
    }
  }
}

function linhaPaletaHTML(item, i) {
  const sel = i === paleta.sel;
  const base = (miniatura, titulo, sub, extras = '') => `
    <div class="paleta-item${sel ? ' sel' : ''}" role="option" aria-selected="${sel}" data-i="${i}" id="paleta-op-${i}">
      ${miniatura}
      <span class="paleta-texto"><b>${titulo}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      ${extras ? `<span class="paleta-extras">${extras}</span>` : ''}
    </div>`;
  const botao = (acao, ic, rotulo, ativo = false) => `<button class="paleta-extra${ativo ? ' ativo' : ''}" data-extra="${acao}" data-i="${i}" title="${rotulo}" aria-label="${rotulo}" tabindex="-1">${icone(ic)}</button>`;
  const miniCapa = (src) => `<span class="paleta-capa">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : icone('Film')}</span>`;
  if (item.tipo === 'acao' || item.tipo === 'adicionar') return base(`<span class="paleta-icone">${icone(item.icone)}</span>`, esc(item.titulo), '');
  if (item.tipo === 'filme') {
    const f = item.f;
    const sub = [f.ano, nomesDiretores(f.diretor)[0], f.visto ? (f.minhaNota ? `★ ${notaLegivel(f.minhaNota)}` : 'visto') : ''].filter(Boolean).map(esc).join(' · ');
    return base(miniCapa(srcCapa(f)), esc(f.titulo), sub,
      botao('hoje', 'CalendarClock', naWatchlist(f.id) ? 'Tirar da watchlist de hoje' : 'Pôr na watchlist de hoje', naWatchlist(f.id))
      + (f.visto ? botao('pagina', temPagina(f) ? 'BookOpen' : 'NotebookPen', temPagina(f) ? 'Abrir sua página' : vocTextoDe(f, 'Escrever sobre {artigo} {item}')) + botao('story', 'ImagePlus', 'Criar story') : ''));
  }
  if (item.tipo === 'pagina') return base(miniCapa(srcCapa(item.f)), esc(item.f.titulo), esc(item.trecho));
  if (item.tipo === 'tmdb') return base(miniCapa(item.r.poster), esc(item.r.titulo), esc(item.r.ano || ''), botao('adicionar', 'Plus', 'Adicionar à lista'));
  if (item.tipo === 'anilist') return base(miniCapa(item.r.poster), esc(item.r.titulo), esc([item.r.ano, item.r.filme ? 'filme de anime' : 'anime'].filter(Boolean).join(' · ')), botao('adicionar', 'Plus', 'Adicionar à lista'));
  return '';
}

function desenharPaleta() {
  const lista = $('.paleta-lista', paleta.el);
  let grupo = '';
  let html = '';
  paleta.itens.forEach((item, i) => {
    if (item.grupo !== grupo) { grupo = item.grupo; html += `<div class="paleta-grupo">${esc(grupo)}</div>`; }
    html += linhaPaletaHTML(item, i);
  });
  if (paleta.termo.length >= 2 && fontesExternasPaleta().length && !(paleta.externo && paleta.externo.termo === paleta.termo)) html += `<p class="paleta-buscando">Buscando ${fontesExternasPaleta().includes('anime') ? (fontesExternasPaleta().includes('filme') ? 'no TMDB e na AniList' : 'na AniList') : 'no TMDB'}…</p>`;
  lista.innerHTML = html || '<p class="paleta-buscando">Nada encontrado.</p>';
  $('.paleta-input', paleta.el).setAttribute('aria-activedescendant', `paleta-op-${paleta.sel}`);
}

function marcarPaleta(i, rolar = true) {
  paleta.sel = i;
  for (const el of $$('.paleta-item', paleta.el)) {
    const sim = Number(el.dataset.i) === i;
    el.classList.toggle('sel', sim);
    el.setAttribute('aria-selected', String(sim));
  }
  $('.paleta-input', paleta.el).setAttribute('aria-activedescendant', `paleta-op-${i}`);
  if (rolar) $(`#paleta-op-${i}`, paleta.el)?.scrollIntoView({ block: 'nearest' });
}

function executarPaleta(item, { secundaria = false, extra = '' } = {}) {
  if (!item) return;
  const termo = paleta.termo;
  const fechar = () => fecharPaleta();
  if (item.tipo === 'acao') { fechar(); item.fazer(); return; }
  if (item.tipo === 'adicionar') { fechar(); abrirAdicionar(termo); return; }
  if (item.tipo === 'filme' || item.tipo === 'pagina') {
    const id = item.f.id;
    const acao = extra || (secundaria ? 'hoje' : item.tipo === 'pagina' ? 'pagina' : 'detalhes');
    if (acao === 'hoje') {
      alternarWatchlist(id);
      aviso(naWatchlist(id) ? `“${item.f.titulo}” entrou na watchlist de hoje.` : `“${item.f.titulo}” saiu da watchlist de hoje.`, { tipo: 'ok' });
      desenharPaleta();
      return;
    }
    fechar();
    if (acao === 'pagina') abrirPagina(id);
    else if (acao === 'story') abrirStory(id);
    else abrirPainel(id);
    return;
  }
  if (item.tipo === 'anilist') {
    fechar();
    if (secundaria || extra === 'adicionar') adicionarAnilistDaPaleta(item.r);
    else { fonteBusca = 'anime'; abrirAdicionar(item.r.titulo); } // abre o Adicionar já na AniList, buscando
    return;
  }
  if (item.tipo === 'tmdb') {
    fechar();
    if (secundaria || extra === 'adicionar') {
      abrirFilmeExterno(item.r.tmdbId).then(() => {
        const f = porId(`tmdb-${item.r.tmdbId}`);
        if (f) adicionarExterno(f, document.createElement('button'));
      });
    } else abrirFilmeExterno(item.r.tmdbId);
  }
}

// Um resultado da AniList direto para a lista (como o Adicionar faz).
async function adicionarAnilistDaPaleta(r) {
  const dados = { titulo: r.titulo, ano: r.ano, poster: r.poster, anilistId: r.anilistId, filme: r.filme, tipo: r.filme ? undefined : 'serie' };
  const repetido = await api.acharRepetido(dados);
  if (repetido) { aviso(`“${repetido.titulo}” já está na sua lista.`); abrirPainel(repetido.id); return; }
  const novo = await api.adicionarFilme(dados);
  estado.filmes.push(novo);
  render();
  abrirPainel(novo.id);
  aviso(`“${novo.titulo}” foi adicionado.`, { tipo: 'ok' });
}

function teclaPaleta(e) {
  const n = paleta.itens.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); marcarPaleta((paleta.sel + 1) % n); }
  else if (e.key === 'ArrowUp' && n) { e.preventDefault(); marcarPaleta((paleta.sel - 1 + n) % n); }
  else if (e.key === 'Enter') { e.preventDefault(); executarPaleta(paleta.itens[paleta.sel], { secundaria: e.shiftKey }); }
}

function cliquePaleta(e) {
  const extra = e.target.closest('[data-extra]');
  if (extra) { executarPaleta(paleta.itens[Number(extra.dataset.i)], { extra: extra.dataset.extra }); return; }
  const linha = e.target.closest('.paleta-item');
  if (linha) executarPaleta(paleta.itens[Number(linha.dataset.i)], { secundaria: e.shiftKey });
}

document.addEventListener('keydown', (e) => {
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (paleta) fecharPaleta();
    else { if (modal.open) fecharModal(); abrirPaleta(); }
    return;
  }
  if (e.key === 'Escape' && paleta) {
    e.preventDefault();
    e.stopImmediatePropagation();
    fecharPaleta();
  }
}, true);

$('#btn-paleta').addEventListener('click', () => abrirPaleta());
if (MAC) $('#btn-paleta kbd').textContent = '⌘ K';
