'use strict';

// ---------- A página do filme (e do anime) no PC ----------
//
// O visual novo dos detalhes: a arte do filme no alto (com "Sessão nº 212", o
// número daquela sessão no ano), a capa ao lado da logo, do título original, da
// linha de dados e dos botões; o ingresso "Visto em" à direita. Embaixo, duas
// colunas: sinopse, sua nota, quando viu, sua página, listas e fotogramas; ao
// lado, as notas (com os logotipos dos sites), a ficha e onde assistir (com os
// logotipos dos serviços, do TMDB).
//
// Só no PC: o celular continua com o painel de sempre (renderPainel, app.js),
// que mobile/web/detalhes.js rearruma. Os botões e campos usam os mesmos
// data-p / data-info do painel antigo, então os cliques são os do app.js.

// A arte do TMDB (fundo, fotogramas, título original), uma vez por item.
const artePaginaFilme = new Map(); // id → { fundo, fotogramas, tituloOriginal } | null

function pedirArtePaginaFilme(f) {
  if (artePaginaFilme.has(f.id)) return Promise.resolve(artePaginaFilme.get(f.id));
  if (typeof api.arteTmdb !== 'function' || !estado.config.tmdbKey || (!f.tmdbId && !f.tmdbTvId)) return Promise.resolve(null);
  return api.arteTmdb(f.id).then((r) => {
    const arte = r && r.ok && r.dados ? r.dados : null;
    if (r && r.ok) artePaginaFilme.set(f.id, arte); // erro de rede: tenta de novo da próxima vez
    return arte;
  }).catch(() => null);
}

// ---- A sessão: "Sessão nº 212", o 212º item visto no ano ----

const DIAS_SEMANA_PAGINA = ['um domingo', 'uma segunda', 'uma terça', 'uma quarta', 'uma quinta', 'uma sexta', 'um sábado'];
const MESES_CURTOS_PAGINA = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

// A última vez que viu e o número dela no ano, contando todas as sessões da
// plataforma do item (rever conta de novo). No mesmo dia, vale a ordem da lista.
function sessaoDoItem(f) {
  const dias = (f.vistoEm || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const dia = dias[dias.length - 1];
  if (!dia) return null;
  const ano = dia.slice(0, 4);
  const p = plataformaDoItem(f);
  const ordem = (x) => Number(x.ordem) || 0;
  let n = 0;
  for (const x of estado.filmes) {
    if (!daPlataforma(x, p)) continue;
    for (const d of x.vistoEm || []) {
      if (d.slice(0, 4) !== ano) continue;
      if (d < dia || (d === dia && (x === f ? true : ordem(x) < ordem(f)))) n++;
    }
  }
  return { dia, n: Math.max(1, n) };
}

function ingressoPaginaHTML(f) {
  const s = f.visto ? sessaoDoItem(f) : null;
  if (!s) return '';
  const [a, m, d] = s.dia.split('-').map(Number);
  const semana = DIAS_SEMANA_PAGINA[new Date(a, m - 1, d).getDay()];
  const doAno = String(a) === String(new Date().getFullYear()) ? 'do ano' : `de ${a}`;
  const anime = ehAnime(f);
  // nandflix: um ingresso; nandchan: um volume de mangá (lombada à esquerda).
  return `<div class="pcf-ingresso${anime ? ' pcf-volume' : ''}" title="${esc(`Visto em ${diaLegivel(s.dia, { comAno: true })}`)}">
      ${anime ? '<span class="pcf-lombada" aria-hidden="true"></span>' : ''}
      <small>Visto em</small>
      <strong>${d} de ${MESES_CURTOS_PAGINA[m - 1]} ${a}</strong>
      <span>${semana}, ${vocDe(f, 'artigo')} ${s.n}º ${esc(vocDe(f, 'item'))} ${doAno}</span>
    </div>`;
}

function sessaoPaginaTexto(f) {
  const s = f.visto ? sessaoDoItem(f) : null;
  return s ? `Sessão nº ${s.n}` : '';
}

// ---- Cabeçalho ----

// "2003  120 min  Thriller, Mistério  [18]  Park Chan-wook  Coreia do Sul": só espaço entre as partes.
function metaPaginaFilmeHTML(f) {
  if (ehSerie(f)) return serieMetaHTML(f).replace(/^<span>/, '<span class="pcf-ano">');
  const info = f.info || {};
  const min = minutosDe(f);
  const partes = [];
  if (f.ano) partes.push(`<span class="pcf-ano">${esc(f.ano)}</span>`);
  if (min) partes.push(`<span>${min} min</span>`);
  const gen = generos(info).slice(0, 2).join(', ');
  if (gen) partes.push(`<span>${esc(gen)}</span>`);
  if (info.classificacao && info.classificacao !== 'N/A') partes.push(`<span class="classificacao">${esc(info.classificacao)}</span>`);
  if (f.diretor) partes.push(`<span>${esc(f.diretor)}</span>`);
  const pais = paisesDe(f)[0];
  if (pais) partes.push(`<span>${esc(pais)}</span>`);
  return partes.join('') || '&nbsp;';
}

function cabecalhoPaginaFilmeHTML(f) {
  return `
      <button class="redondo painel-fechar" data-p="fechar" aria-label="Fechar" title="Fechar (Esc)">${icone('X')}</button>
      ${botaoVoltarPainelHTML()}
      <div class="painel-capa pcf" data-id="${f.id}">
        <div class="painel-fundo-video"><div class="destaque-fundo-capa"></div><img class="pcf-arte" alt="" hidden></div>
        <div class="painel-sombra"></div>
        <p class="pcf-sessao" data-pcf-sessao${sessaoPaginaTexto(f) ? '' : ' hidden'}>${esc(sessaoPaginaTexto(f))}</p>
        <button class="btn-redondo painel-som" data-p="som" title="${tituloSom()}" aria-label="${tituloSom()}" hidden>${iconeSom()}</button>
        <div class="painel-cabecalho">
          <div class="destaque-poster" data-p="trocar" title="Trocar capa (ou arraste uma imagem para cá)">${capaHTML(f, { tamanho: 'grande' })}</div>
          <div class="pcf-info">
            <div class="destaque-titulo">${tituloHTML(f)}</div>
            <p class="pcf-original" data-pcf-original hidden></p>
            <p class="painel-meta pcf-meta" data-info="meta-painel" data-pc="1">${metaPaginaFilmeHTML(f)}</p>
            <div class="painel-botoes">
              <button class="btn pcf-visto" data-p="visto"></button>
              <button class="btn pcf-vidro" data-p="stremio">${ICONE_PLAY} Assistir</button>
              <button class="btn pcf-vidro" data-p="trailer" title="Ver o trailer em tela cheia">${icone('Clapperboard')} Trailer</button>
              <button class="redondo pcf-quadrado" data-p="favorito"></button>
              <button class="redondo pcf-quadrado" data-p="story" title="Criar story para o Instagram" aria-label="Criar story para o Instagram">${icone('ImagePlus')}</button>
              <button class="redondo pcf-quadrado" data-p="listas" title="Listas" aria-label="Listas" aria-haspopup="menu">${icone('Tag')}</button>
              <button class="redondo pcf-quadrado" data-p="hoje">${icone('CalendarClock')}</button>
            </div>
          </div>
          <div class="pcf-ingresso-lugar" data-pcf-ingresso>${ingressoPaginaHTML(f)}</div>
        </div>
      </div>
      <div id="painel-resto"></div>`;
}

// Visto, favorito, hoje… (atualizarBotoesPainel faz o comum) e o que depende do visto.
function atualizarCabecalhoPaginaFilme(f) {
  atualizarBotoesPainel(f);
  const visto = $('#painel .pcf-visto');
  if (visto) visto.innerHTML = `${icone('Check')} ${f.visto ? 'Visto' : 'Marcar visto'}`;
  const sessao = $('#painel [data-pcf-sessao]');
  if (sessao) { const t = sessaoPaginaTexto(f); sessao.textContent = t; sessao.hidden = !t; }
  const ingresso = $('#painel [data-pcf-ingresso]');
  if (ingresso) ingresso.innerHTML = ingressoPaginaHTML(f);
}

// A arte chegou: o fundo (por cima da capa desfocada), o título original e os fotogramas.
function aplicarArtePaginaFilme(f, arte) {
  if (!arte || estado.painelId !== f.id) return;
  const img = $('#painel .pcf-arte');
  if (img && arte.fundo && img.getAttribute('src') !== arte.fundo) {
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { img.hidden = true; };
    img.src = arte.fundo;
  }
  const orig = $('#painel [data-pcf-original]');
  const original = String(arte.tituloOriginal || '').trim();
  const comparavel = (t) => String(t || '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, '');
  if (orig && original && comparavel(original) !== comparavel(f.titulo)) {
    orig.innerHTML = `Original: <b>${esc(original)}</b>`;
    orig.hidden = false;
  }
  const tira = $('#painel [data-pcf-fotogramas]');
  if (tira) tira.outerHTML = fotogramasPaginaHTML(f);
}

// ---- Corpo ----

// Notas numa linha só, cada uma ao lado do logotipo do site (IMDb, Letterboxd, TMDB; AniList no anime).
function notasPaginaFilmeHTML(info, f) {
  info = info || {};
  const partes = [];
  if (info.anilist) partes.push(`<span class="pcf-nota" title="Nota média na AniList"><span class="marca-anilist">AniList</span>${esc(info.anilist)}%</span>`);
  for (const site of ['imdb', 'letterboxd', 'tmdb']) {
    const s = SITES_NOTA[site];
    const v = String(s.valor(f, info) || '');
    // O Letterboxd fica sempre (é o caminho para ele, já que o botão saiu do cabeçalho).
    if (!v && site === 'letterboxd' && !ehSerie(f) && !f.externo) { partes.push(`<button type="button" class="pcf-nota" data-link="${esc(s.link(f))}" title="Abrir no Letterboxd" aria-label="Abrir no Letterboxd">${s.marca(v)}</button>`); continue; }
    if (!v) continue;
    const dica = `${s.nome}: ${v} de ${s.max} · abrir no ${s.nome}`;
    partes.push(`<button type="button" class="pcf-nota pcf-nota-${site}" data-link="${esc(s.link(f))}" title="${esc(dica)}" aria-label="${esc(dica)}">${s.marca(v)}<span>${esc(v)}</span></button>`);
  }
  return partes.join('');
}

// Onde assistir: os serviços com o logotipo oficial (TMDB) e o nome; assinatura e
// grátis primeiro (os que você assina antes), depois aluguel e compra, menores.
function ondePaginaFilmeHTML(f) {
  if (f.externo) return '';
  const ex = extrasDoPais(f);
  if (!ex) return f.tmdbId || f.imdbID ? '<p class="pcf-vazio">Procurando onde assistir…</p>' : '';
  const meus = meusServicos();
  const link = (ex.onde && ex.onde.link) || (f.tmdbId ? `https://www.themoviedb.org/movie/${f.tmdbId}/watch?locale=${paisOnde()}` : '');
  const ordenar = (l) => l.slice().sort((a, b) => Number(meus.has(Number(b.id))) - Number(meus.has(Number(a.id))));
  const onde = ex.onde || {};
  const servico = (s, extra = '') => {
    const meu = meus.has(Number(s.id));
    return `<button type="button" class="pcf-servico${meu ? ' meu' : ''}" data-link="${esc(link)}" title="${esc(`${s.nome}${extra}${meu ? ' (você assina)' : ''}`)}">
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : ''}<span>${esc(s.nome)}</span></button>`;
  };
  const principais = ordenar([...(onde.assinatura || []), ...(onde.gratis || [])]);
  const vistos = new Set(principais.map((s) => Number(s.id)));
  const outros = ordenar([...(onde.aluguel || []), ...(onde.compra || [])]).filter((s) => !vistos.has(Number(s.id)) && vistos.add(Number(s.id)));
  const selos = [];
  if (ex.cinema === 'agora') selos.push(`<span class="pcf-selo">${icone('Clapperboard')} Nos cinemas</span>`);
  if (ex.cinema === 'em-breve') selos.push(`<span class="pcf-selo">${icone('Clapperboard')} Nos cinemas a partir de ${dataCurta(ex.cinemaData)}</span>`);
  if (ex.stremio === true) selos.push(`<button type="button" class="pcf-selo pcf-stremio" data-p="stremio" title="Está no catálogo do Stremio. Se dá para assistir depende dos complementos do seu Stremio.">${icone('Play')} No Stremio</button>`);
  const nada = !principais.length && !outros.length;
  const pais = PAISES_ONDE[paisOnde()] || paisOnde();
  return `
    ${principais.length ? `<div class="pcf-servicos">${principais.map((s) => servico(s)).join('')}</div>` : ''}
    ${outros.length ? `<p class="pcf-sub">Aluguel e compra</p><div class="pcf-servicos pcf-servicos-menores">${outros.map((s) => servico(s, ' (aluguel ou compra)')).join('')}</div>` : ''}
    ${nada ? `<p class="pcf-vazio">Não está em nenhum streaming ${paisOnde() === 'BR' ? 'no Brasil' : `em ${esc(pais)}`} agora.</p>` : ''}
    ${selos.length ? `<div class="pcf-selos">${selos.join('')}</div>` : ''}
    ${nada ? '' : `<p class="pcf-credito">${esc(pais)}, dados da JustWatch</p>`}`;
}

// Sua página: o título que você deu (o primeiro título da página) e o começo do texto.
function paginaPaginaFilmeHTML(f) {
  if (!temPagina(f)) {
    return f.visto ? `<button class="pcf-escrever" data-p="pagina">${icone('NotebookPen')} ${esc(vocTextoDe(f, 'Escrever sobre {artigo} {item}'))}</button>` : '';
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = f.pagina;
  const h = tpl.content.querySelector('h2, h3');
  const titulo = h ? h.textContent.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '') : '';
  const fotos = shotsDe(f).length;
  const quando = [quandoPagina(f), leituraDaPagina(f.pagina), fotos ? `${fotos === 1 ? '1 foto' : `${fotos} fotos`}` : ''].filter(Boolean).join(', ');
  return `<button class="pcf-pagina" data-p="pagina" title="Abrir sua página">
      ${titulo ? `<h3>${esc(titulo)}</h3>` : ''}
      <p>${esc(trechoDaPagina(f.pagina, 320))}</p>
      <span class="pcf-assinatura">${icone('PenLine')} ${esc(quando)}</span>
    </button>`;
}

// Fotogramas numa tira de película: os seus shots primeiro, depois as cenas do TMDB.
function fotogramasPaginaHTML(f) {
  const arte = artePaginaFilme.get(f.id);
  const srcs = [...shotsDe(f), ...((arte && arte.fotogramas) || [])].slice(0, 5);
  if (!srcs.length) return '<div data-pcf-fotogramas hidden></div>';
  return `<div data-pcf-fotogramas>
      <h3 class="pcf-rotulo">Fotogramas</h3>
      <div class="pcf-tira">${srcs.map((s, i) => `<button class="pcf-fotograma" data-pcf-foto="${i}" aria-label="Ver o fotograma ${i + 1}"><img src="${esc(s)}" alt="" loading="lazy"></button>`).join('')}</div>
    </div>`;
}

function fichaPaginaFilmeHTML(f) {
  const serie = ehSerie(f);
  const elenco = f.info && f.info.elenco ? f.info.elenco.split(',').slice(0, 4).map((n) => n.trim()).join(', ') : '';
  const gen = generos(f.info).join(', ');
  const linhas = [];
  if (f.diretor) linhas.push([serie ? 'Estúdio' : 'Direção', `<button class="pcf-link" data-p="mesmo-diretor" title="${esc(vocTexto('Ver {itens} deste diretor na sua lista'))}">${esc(f.diretor)}</button>`]);
  if (elenco) linhas.push(['Elenco', esc(elenco)]);
  if (gen) linhas.push(['Gênero', esc(gen)]);
  if (paisesDe(f).length) linhas.push([paisesDe(f).length > 1 ? 'Países' : 'País', paisesHTML(f)]);
  if (f.adicionadoEm) linhas.push(['Adicionado', esc(diaLegivel(diaDe(new Date(f.adicionadoEm)), { comAno: true }))]);
  if (f.notas) linhas.push(['Suas notas', esc(f.notas)]);
  return `<dl class="pcf-ficha" data-pcf-ficha>${linhas.map(([r, v]) => `<dt>${r}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function corpoPaginaFilmeHTML(f) {
  const sinopse = f.info && f.info.sinopse ? f.info.sinopse : '';
  const premios = premiosPainelHTML(f);
  // O anime tem o onde assistir dele (AniList), no bloco de temporadas.
  const onde = ehAnime(f) ? '' : ondePaginaFilmeHTML(f);
  const pagina = paginaPaginaFilmeHTML(f);
  return `
    <div class="painel-corpo pcf-corpo">
      <div class="pcf-principal">
        ${animeNoPainelHTML(f)}
        <section data-pcf-sinopse${sinopse ? '' : ' hidden'}><h3 class="pcf-rotulo">Sinopse</h3><p class="painel-sinopse" data-info="sinopse-painel">${esc(sinopse)}</p></section>
        <section><h3 class="pcf-rotulo">Sua nota</h3><div class="minha-nota-linha">${estrelasHTML(f)}</div></section>
        <section><h3 class="pcf-rotulo">Quando você viu</h3><div class="painel-vistos">${vistosEmHTML(f)}</div></section>
        ${pagina ? `<section><h3 class="pcf-rotulo">Sua página</h3>${pagina}</section>` : ''}
        <section><h3 class="pcf-rotulo">Listas</h3><div class="painel-listas">${listasDoFilmeHTML(f)}</div></section>
        ${fotogramasPaginaHTML(f)}
      </div>
      <aside class="pcf-lado">
        <section data-pcf-notas${notasPaginaFilmeHTML(f.info, f) ? '' : ' hidden'}><h3 class="pcf-rotulo">Notas</h3><div class="notas-linha pcf-notas" data-pc="1">${notasPaginaFilmeHTML(f.info, f)}</div></section>
        <section><h3 class="pcf-rotulo">Ficha</h3>${fichaPaginaFilmeHTML(f)}</section>
        ${premios ? `<section class="pcf-premios"><h3 class="pcf-rotulo">Prêmios</h3><div class="painel-fichas">${premios}</div></section>` : ''}
        <section data-pcf-onde${onde ? '' : ' hidden'}><h3 class="pcf-rotulo">Onde assistir</h3><div data-info="onde">${onde}</div></section>
      </aside>
    </div>
    <div id="painel-relacionados"></div>`;
}

// Os campos de edição e o rodapé, como no painel de sempre.
function camposPaginaFilmeHTML(f) {
  const serie = ehSerie(f);
  const campo = (nome, rotulo, extra = '') =>
    `<div class="campo"><label for="c-${nome}">${rotulo}</label><input id="c-${nome}" data-campo="${nome}" value="${esc(f[nome])}" ${extra}></div>`;
  return `
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
        <button class="btn btn-icone" data-p="mesmo-diretor" title="${vocTexto('Ver {itens} deste diretor na sua lista')}" aria-label="${vocTexto('Ver {itens} deste diretor na sua lista')}"${f.diretor ? '' : ' disabled'}>${icone('Search')}</button>
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
      ${serie ? '' : `<button class="btn btn-perigo" data-p="excluir">${icone('Trash2')} Remover da lista</button>`}
    </div>`;
}

// O renderPainel do PC para filmes e animes da lista (chamado pelo app.js).
function renderPaginaFilme(f) {
  const topo = $('#painel .painel-capa.pcf');
  if (topo && topo.dataset.id === f.id) {
    atualizarCabecalhoPaginaFilme(f);
  } else {
    $('#painel-conteudo').innerHTML = cabecalhoPaginaFilmeHTML(f);
    fundoDesfocado($('.painel-capa'), f);
    atualizarCabecalhoPaginaFilme(f);
    carregarTrailerPainel(f);
    const id = f.id;
    pedirArtePaginaFilme(f).then((arte) => { const atual = porId(id); if (atual) aplicarArtePaginaFilme(atual, arte); });
  }
  if (artePaginaFilme.has(f.id)) aplicarArtePaginaFilme(f, artePaginaFilme.get(f.id));

  $('#painel-resto').innerHTML = corpoPaginaFilmeHTML(f) + camposPaginaFilmeHTML(f);

  carregarRelacionados(f);
  ajustarCapaTemporada(f); // NANDRoll: numa temporada, a capa dela
  api.extrasAgora(f.id).then((ex) => {
    if (!ex || estado.painelId !== f.id) return;
    f.extras = ex;
    atualizarExtrasPainel(f);
    agendarRender();
  });
  if (!f.info) {
    const id = f.id;
    carregarInfo(f).then((info) => {
      if (!info || estado.painelId !== id) return;
      const meta = $('#painel [data-info="meta-painel"]');
      if (meta) meta.innerHTML = metaPaginaFilmeHTML(f);
      const sin = $('#painel [data-pcf-sinopse]');
      if (sin && info.sinopse) { $('.painel-sinopse', sin).textContent = info.sinopse; sin.hidden = false; }
      const ficha = $('#painel [data-pcf-ficha]');
      if (ficha) ficha.outerHTML = fichaPaginaFilmeHTML(f);
      atualizarExtrasPainel(f);
    });
  }
}

// Os extras (notas do Letterboxd e do TMDB, onde assistir) chegaram.
function atualizarExtrasPaginaFilme(f) {
  const notas = $('#painel [data-pcf-notas]');
  if (notas) { const h = notasPaginaFilmeHTML(f.info, f); $('.pcf-notas', notas).innerHTML = h; notas.hidden = !h; }
  const onde = $('#painel [data-pcf-onde]');
  if (onde) { const h = ehAnime(f) ? '' : ondePaginaFilmeHTML(f); $('[data-info="onde"]', onde).innerHTML = h; onde.hidden = !h; }
}

// Clicar num fotograma abre o visor (o mesmo das páginas).
document.getElementById('painel')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pcf-foto]');
  if (!b || !estado.painelId) return;
  const srcs = $$('#painel .pcf-fotograma img').map((i) => i.getAttribute('src'));
  abrirVisor(srcs, Number(b.dataset.pcfFoto) || 0);
});
