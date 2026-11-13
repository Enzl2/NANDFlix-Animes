'use strict';

// ---------- Prêmios: o Oscar (e, depois, outros) ----------
//
// Os dados vêm de lib/premios.js (api.premios): cada cerimônia com as categorias
// e os indicados, e cada filme indicado com o código do IMDb e o id do TMDB.
// A tela tem a lista de prêmios, uma aba por cerimônia (a mais recente com
// indicados primeiro) e, em cada categoria, a sua cédula: os indicados que você
// já viu (marcados sozinhos se o filme está na sua lista como visto) e o seu
// palpite de vencedor. Depois da cerimônia, o vencedor aparece e o app conta os
// acertos. As cédulas ficam em config.premios['oscar-98'] e vão para a nuvem.
//
// Os prêmios também viram filtros: na barra da lista ("Filtros"), no sorteio e
// na tierlist; e os detalhes do filme mostram as indicações dele.

// A lista dos prêmios (lib/premios.js → listaPremios): Oscar, Globo de Ouro,
// Critics Choice, BAFTA, SAG, Spirit, Gotham, Cannes, Veneza e Berlim.
// E os de jogos (The Game Awards, BAFTA Games; tipo 'jogo'), que só aparecem onde há jogos
// (nandplay e nandhub) e ligam o indicado ao jogo da lista por igdb / igdbSlug / steam.
let PREMIOS_INFO = []; // [{ id, nome, indicado, venceu, quando, festival, tipo }]
const LISTA_PREMIOS = []; // os ids, na ordem
const NOMES_PREMIOS = {};
const infoPremio = (id) => PREMIOS_INFO.find((p) => p.id === id) || { id, nome: id, indicado: `Indicado: ${id}`, venceu: `Venceu: ${id}`, quando: '', festival: false, tipo: 'filme' };

// ---- Filmes e jogos ----

// Um item de jogo (contrato do nandplay: tipo 'jogo'). Usa o ehJogo() global quando o registro das
// plataformas o declara; sem ele, olha o tipo.
const itemEhJogo = (f) => (typeof ehJogo === 'function' ? ehJogo(f) : Boolean(f) && f.tipo === 'jogo');
const premioEhDeJogo = (id) => infoPremio(id).tipo === 'jogo';
// jogoJogado (pelo status do jogo na lista, nunca pelo palpite) vem de premios-jogos.js.
const ROTULOS_STATUS_PREMIOS = { quero: 'Quero jogar', jogando: 'Jogando', pausado: 'Pausado', zerado: 'Zerado', cem: '100%', larguei: 'Larguei' };
// "Já viu" (filme) ou "já jogou" (jogo): o que conta na cédula.
const itemFeito = (premio, f) => Boolean(f) && (premioEhDeJogo(premio) ? jogoJogado(f) : Boolean(f.visto));

// Os tipos de prêmio da plataforma em uso: filmes no nandflix, jogos no nandplay, os dois no
// nandhub (as das plataformas habilitadas); no nandchan não há prêmios.
function tiposDePremioDaPlataforma() {
  const p = plataformaAtual();
  const ids = p.hub ? plataformasHabilitadas() : [p.id];
  const tipos = new Set();
  if (ids.includes('nandflix')) tipos.add('filme');
  if (ids.includes('nandplay')) tipos.add('jogo');
  return tipos;
}
// Os prêmios que aparecem agora (a lista, o filtro, o sorteio e a tela).
const premiosVisiveis = () => { const t = tiposDePremioDaPlataforma(); return LISTA_PREMIOS.filter((id) => t.has(infoPremio(id).tipo || 'filme')); };

// O vocabulário do prêmio: filmes pelo registro do nandflix, jogos pelo do nandplay (no hub, o
// da plataforma de verdade, não "títulos"), com o verbo que combina: ver / jogar.
function vocPremio(premio) {
  const jogo = premioEhDeJogo(premio);
  const p = plataformaPorId(jogo ? 'nandplay' : 'nandflix');
  const itens = p ? voc('itens', undefined, p) : (jogo ? 'jogos' : 'filmes');
  return jogo
    ? { itens, ver: 'jogar', viu: 'jogou', feito: 'Joguei', qtd: (n) => (p ? voc('qtd', n, p) : `${n} ${n === 1 ? 'jogo' : 'jogos'}`) }
    : { itens, ver: 'ver', viu: 'viu', feito: 'Visto', qtd: (n) => (p ? voc('qtd', n, p) : `${n} ${n === 1 ? 'filme' : 'filmes'}`) };
}
const premiosDados = {}; // id → { nome, cerimonias, filmes }
let indicePremios = null;
const cachePremiosFilme = new Map();
const premiosTela = $('#premios');
// cat: a categoria aberta (prêmios de jogos); menu: a lista de categorias está aberta.
const vista = { premio: 'oscar', numero: null, soFalta: false, cat: null, menu: false };

// ---- Dados ----

let carregandoPremios = null;
function carregarPremios() {
  if (!carregandoPremios) {
    carregandoPremios = (async () => {
      PREMIOS_INFO = await api.listaPremios();
      LISTA_PREMIOS.splice(0, LISTA_PREMIOS.length, ...PREMIOS_INFO.map((p) => p.id));
      for (const p of PREMIOS_INFO) NOMES_PREMIOS[p.id] = p.nome;
      await Promise.all(LISTA_PREMIOS.map(async (id) => { premiosDados[id] = await api.premios(id); }));
      indicePremios = null;
      cachePremiosFilme.clear();
      agendarRender();
    })();
  }
  return carregandoPremios;
}

// Busca as cerimônias recentes (a cada 3 h na temporada de cada prêmio, 1 vez por dia fora dela).
// `so`: só esse prêmio (o aberto na tela); sem ele, todos, um de cada vez.
async function atualizarPremios({ forcar = false, so = null } = {}) {
  await carregarPremios();
  const erros = [];
  for (const id of so ? [so] : LISTA_PREMIOS) {
    const r = await api.atualizarPremios(id, { forcar });
    if (!r || !r.ok) { erros.push(`${NOMES_PREMIOS[id]}: ${r && r.erro ? r.erro.mensagem : 'sem internet'}`); continue; }
    if (!r.dados) continue; // nada mudou
    premiosDados[id] = await api.premios(id);
    indicePremios = null;
    cachePremiosFilme.clear();
    if (!premiosTela.hidden && vista.premio === id) renderPremios();
    agendarRender();
  }
  if (forcar && erros.length) aviso(`Não deu para atualizar. ${erros.join(' · ')}`, { tipo: 'erro', duracao: 7000 });
}

// Os ids do indicado: { imdb, tmdb } (filmes) ou { igdbSlug, igdb, steam } (jogos).
const idsDoIndicado = (premio, x) => (x.wiki && premiosDados[premio] && premiosDados[premio].filmes[x.wiki]) || {};
const temIdsDeJogo = (ids) => Boolean(ids.igdb || ids.igdbSlug || ids.steam);
// O item da lista é este jogo? (pelo número ou slug do IGDB, ou pela Steam)
const mesmoJogo = (f, ids) => Boolean(f) && ((ids.igdb && String(f.igdb) === String(ids.igdb)) || (ids.igdbSlug && f.igdbSlug === ids.igdbSlug) || (ids.steam && String(f.steam) === String(ids.steam)));

// Cada indicação, achável pelo IMDb, pelo TMDB (filmes), pelo IGDB ou pela Steam (jogos) ou
// (sem nenhum id) pelo título. Os jogos "não lançados" (Most Anticipated Game) não entram: ainda
// não são jogo indicado/premiado para o selo do jogo.
function indice() {
  if (indicePremios) return indicePremios;
  const porImdb = new Map();
  const porTmdb = new Map();
  const porTitulo = new Map();
  const porIgdb = new Map();
  const porSlug = new Map();
  const porSteam = new Map();
  const add = (m, k, r) => { if (!k) return; const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const premio of LISTA_PREMIOS) {
    const d = premiosDados[premio];
    if (!d) continue;
    const jogo = premioEhDeJogo(premio);
    for (const c of d.cerimonias) {
      for (const k of c.categorias) {
        if (k.naoLancado) continue;
        for (const x of k.indicados) {
          if (!x.titulo) continue; // pessoa/time: não é um jogo
          const ids = idsDoIndicado(premio, x);
          const r = { premio, numero: c.numero, ano: c.ano, chave: k.chave, nome: k.nome, pessoa: x.pessoa, venceu: x.venceu };
          if (jogo) {
            add(porIgdb, ids.igdb && String(ids.igdb), r);
            add(porSlug, ids.igdbSlug, r);
            add(porSteam, ids.steam && String(ids.steam), r);
            if (!temIdsDeJogo(ids)) add(porTitulo, `jogo|${normalizar(x.titulo)}`, r);
            continue;
          }
          add(porImdb, ids.imdb, r);
          add(porTmdb, ids.tmdb && String(ids.tmdb), r);
          if (!ids.imdb && !ids.tmdb) add(porTitulo, normalizar(x.titulo), r);
        }
      }
    }
  }
  indicePremios = { porImdb, porTmdb, porTitulo, porIgdb, porSlug, porSteam };
  return indicePremios;
}

// As indicações de um filme ou jogo (da lista ou de fora): [{ premio, numero, ano, chave, nome, pessoa, venceu }].
function premiosDoFilme(f) {
  if (!f) return [];
  const jogo = itemEhJogo(f);
  const chave = jogo ? `${f.id}|${f.igdb}|${f.igdbSlug}|${f.steam}|${f.titulo}|${f.ano}` : `${f.id}|${f.imdbID}|${f.tmdbId}|${f.titulo}|${f.ano}`;
  if (cachePremiosFilme.has(chave)) return cachePremiosFilme.get(chave);
  const { porImdb, porTmdb, porTitulo, porIgdb, porSlug, porSteam } = indice();
  const ano = anoNumero(f.ano);
  let achados;
  if (jogo) {
    achados = new Set([...(porIgdb.get(String(f.igdb || '')) || []), ...(porSlug.get(f.igdbSlug || '') || []), ...(porSteam.get(String(f.steam || '')) || [])]);
    // Sem id: pelo título, com o ano a um de distância (o TGA é no ano do jogo; o BAFTA, no seguinte).
    for (const r of porTitulo.get(`jogo|${normalizar(f.titulo)}`) || []) if (Number.isFinite(ano) && Math.abs(r.ano - ano) <= 1) achados.add(r);
  } else {
    achados = new Set([...(porImdb.get(f.imdbID) || []), ...(porTmdb.get(String(f.tmdbId || '')) || [])]);
    // Sem código: pelo título, se o ano bate (a cerimônia é no ano seguinte ao do filme).
    // (Num festival, o filme é do mesmo ano do festival.)
    for (const r of porTitulo.get(normalizar(f.titulo)) || []) if (Number.isFinite(ano) && Math.abs(r.ano - (infoPremio(r.premio).festival ? 0 : 1) - ano) <= 1) achados.add(r);
  }
  const lista = [...achados].sort((a, b) => b.numero - a.numero || Number(b.venceu) - Number(a.venceu));
  cachePremiosFilme.set(chave, lista);
  return lista;
}

// O filme ou jogo da sua lista que é este indicado (ou null). Indicado sem jogo (pessoa/time) não tem item.
function filmeDoIndicado(premio, x, cerimonia) {
  if (!x.titulo) return null;
  const ids = idsDoIndicado(premio, x);
  if (premioEhDeJogo(premio)) {
    const jogos = estado.filmes.filter(itemEhJogo);
    return jogos.find((f) => mesmoJogo(f, ids))
      || (!temIdsDeJogo(ids) ? jogos.find((f) => normalizar(f.titulo) === normalizar(x.titulo) && Math.abs(anoNumero(f.ano) - cerimonia.ano) <= 1) : null)
      || null;
  }
  return estado.filmes.find((f) => !itemEhJogo(f) && ((ids.imdb && f.imdbID === ids.imdb) || (ids.tmdb && String(f.tmdbId) === String(ids.tmdb))))
    || (!ids.imdb && !ids.tmdb ? estado.filmes.find((f) => !itemEhJogo(f) && normalizar(f.titulo) === normalizar(x.titulo) && Math.abs(anoNumero(f.ano) - (cerimonia.ano - (infoPremio(premio).festival ? 0 : 1))) <= 1) : null)
    || null;
}

// A página de um jogo indicado que não está na sua lista: abrirJogoFora (src/jogos-painel.js) precisa
// do id da IGDB; sem ele (ou sem a página de jogo), não faz nada e a cédula só mostra o nome.
// `ids` = { igdb, igdbSlug, steam }. Devolve se abriu algo.
function abrirIndicadoJogo(ids, x) {
  if (typeof abrirJogoFora === 'function' && ids && ids.igdb) {
    abrirJogoFora(Number(ids.igdb), { igdb: Number(ids.igdb), igdbSlug: ids.igdbSlug || '', steam: ids.steam ? Number(ids.steam) : undefined, titulo: x.titulo });
    return true;
  }
  return false;
}

// ---- Filtros (barra da lista, sorteio, tierlist) ----

// 'oscar:indicado', 'oscar:venceu', 'oscar:venceu:Best Picture' ou '*:venceu' (qualquer prêmio).
// Nos festivais, "indicado" é estar na competição.
function passaPremio(f, filtro) {
  if (!filtro) return true;
  const [premio, tipo, chave] = filtro.split(':');
  return premiosDoFilme(f).some((r) => (premio === '*' || r.premio === premio) && (tipo !== 'venceu' || r.venceu) && (!chave || nomeCategoria(r.premio, chave) === nomeCategoria(r.premio, r.chave)));
}

// O nome em português junta as categorias renomeadas (Filme Estrangeiro = Internacional).
function nomeCategoria(premio, chave) {
  for (const c of (premiosDados[premio] || { cerimonias: [] }).cerimonias) {
    const k = c.categorias.find((x) => x.chave === chave);
    if (k) return k.nome;
  }
  return chave;
}

function rotuloFiltroPremio(filtro) {
  const [premio, tipo, chave] = filtro.split(':');
  if (premio === '*') return tipo === 'venceu' ? 'Venceu algum prêmio' : 'Indicado a algum prêmio';
  const info = infoPremio(premio);
  return `${tipo === 'venceu' ? info.venceu : info.indicado}${chave ? ` · ${nomeCategoria(premio, chave)}` : ''}`;
}

function filtrarPremio(filtro) {
  estado.premio = filtro || '';
  aplicarFiltroDaBarra();
}

// As categorias de um prêmio que têm algum filme da sua lista (para escolher no filtro).
function categoriasNaLista(premio) {
  const conta = new Map();
  for (const f of estado.filmes) {
    const nomes = new Set();
    for (const r of premiosDoFilme(f)) if (r.premio === premio && !nomes.has(r.nome)) { nomes.add(r.nome); const c = conta.get(r.nome) || { chave: r.chave, n: 0 }; c.n++; conta.set(r.nome, c); }
  }
  return [...conta].sort((a, b) => b[1].n - a[1].n).map(([nome, { chave, n }]) => ({ nome, chave, n }));
}

// Escolher um prêmio, indicados ou vencedores, e (opcional) uma categoria.
function escolherCategoriaPremio(premioInicial = null) {
  const qtd = (filtro) => itensDaPlataforma().filter((f) => passaPremio(f, filtro)).length;
  const visiveis = premiosVisiveis();
  const comFilmes = visiveis.filter((p) => qtd(`${p}:indicado`));
  let [premio, tipo] = estado.premio && !estado.premio.startsWith('*') ? estado.premio.split(':') : [premioInicial || comFilmes[0] || visiveis[0] || 'oscar', 'indicado'];
  abrirModal(`${cabecalhoModal('Filtrar por prêmio')}
    <div class="modal-corpo filtros-sorteio">
      <div class="secao"><h3>Prêmio</h3><div class="chips-linha" data-secao="premio"></div></div>
      <div class="secao"><h3>Mostrar</h3><div class="chips-linha" data-secao="tipo"></div></div>
      <div class="secao"><h3>Categoria</h3><div class="chips-linha" data-secao="cats"></div></div>
    </div>
    <div class="modal-rodape"><span class="filtros-contagem" id="premio-contagem"></span><button class="btn btn-primario" id="premio-aplicar">Mostrar</button></div>`, 'modal-filtros');
  const desenhar = () => {
    const info = infoPremio(premio);
    $('[data-secao="premio"]', modal).innerHTML = (comFilmes.length ? comFilmes : visiveis)
      .map((p) => `<button class="chip${p === premio ? ' ativo' : ''}" data-premio-escolha="${p}" aria-pressed="${p === premio}">${esc(NOMES_PREMIOS[p])}<span class="chip-qtd">${qtd(`${p}:indicado`) || ''}</span></button>`).join('');
    $('[data-secao="tipo"]', modal).innerHTML = [['indicado', info.festival ? 'Na competição' : 'Indicados'], ['venceu', info.festival ? 'Premiados' : 'Vencedores']]
      .map(([v, r]) => `<button class="chip${tipo === v ? ' ativo' : ''}" data-tipo="${v}" aria-pressed="${tipo === v}">${r}</button>`).join('');
    const cats = categoriasNaLista(premio);
    $('[data-secao="cats"]', modal).innerHTML = cats.length ? cats.map((c) => {
      const n = qtd(`${premio}:${tipo}:${c.chave}`);
      return `<button class="chip" data-cat="${esc(c.chave)}"${n ? '' : ' disabled'}>${esc(c.nome)}<span class="chip-qtd">${n}</span></button>`;
    }).join('') : `<p>Nenhum ${esc(vocPremio(premio).itens.replace(/s$/, ''))} da sua lista foi indicado a este prêmio.</p>`;
    const n = qtd(`${premio}:${tipo}`);
    $('#premio-contagem', modal).textContent = vocPremio(premio).qtd(n);
    $('#premio-aplicar', modal).disabled = !n;
  };
  $('.filtros-sorteio', modal).addEventListener('click', (e) => {
    const p = e.target.closest('[data-premio-escolha]');
    if (p) { premio = p.dataset.premioEscolha; desenhar(); return; }
    const t = e.target.closest('[data-tipo]');
    if (t) { tipo = t.dataset.tipo; desenhar(); return; }
    const c = e.target.closest('[data-cat]');
    if (c) { fecharModal(); filtrarPremio(`${premio}:${tipo}:${c.dataset.cat}`); }
  });
  $('#premio-aplicar', modal).onclick = () => { fecharModal(); filtrarPremio(`${premio}:${tipo}`); };
  desenhar();
}

SECOES_FILTRO.push({
  titulo: 'Prêmios',
  recurso: 'premios',
  ativa: () => Boolean(estado.premio),
  itensHTML: () => {
    const qtd = (filtro) => itensDaPlataforma().filter((f) => passaPremio(f, filtro)).length;
    const porPremio = estado.premio && !estado.premio.startsWith('*');
    return itemMenuHTML(estado.premio === '*:indicado', 'data-premio="*:indicado"', 'Indicados a algum prêmio', qtd('*:indicado'))
      + itemMenuHTML(estado.premio === '*:venceu', 'data-premio="*:venceu"', 'Vencedores de algum prêmio', qtd('*:venceu'))
      + itemMenuHTML(porPremio, 'data-premio-categoria=""', porPremio ? `${esc(rotuloFiltroPremio(estado.premio))}…` : 'Por prêmio e categoria…', '');
  },
  aoClicar: (e) => {
    const cat = e.target.closest('[data-premio-categoria]');
    if (cat) { fecharFlutuante(); escolherCategoriaPremio(cat.dataset.premioCategoria || null); return true; }
    const b = e.target.closest('[data-premio]');
    if (!b) return false;
    filtrarPremio(b.dataset.premio === estado.premio ? '' : b.dataset.premio);
    return true;
  },
  atualizarChip: () => {
    if (estado.premio && !plataformaTem('premios')) estado.premio = ''; // Plataformas: sem prêmios aqui
    const chip = $('#chip-premio');
    chip.hidden = !estado.premio;
    chip.innerHTML = `${icone('Trophy')}<span>${esc(estado.premio ? rotuloFiltroPremio(estado.premio) : '')}</span>${icone('X')}`;
  },
});
$('#chip-premio').addEventListener('click', () => filtrarPremio(''));

// Sorteio: "Indicado a algum prêmio", "Venceu algum prêmio" e um por prêmio
// (os que têm algum filme não visto da lista).
function filtrosPremioSorteio() {
  const naoVistos = itensDaPlataforma().filter((f) => !(itemEhJogo(f) ? jogoJogado(f) : f.visto));
  return ['*:indicado', '*:venceu', ...premiosVisiveis().map((p) => `${p}:indicado`).filter((x) => naoVistos.some((f) => passaPremio(f, x)))];
}

// Tierlist: "Indicado ao Oscar", "Venceu o Oscar", "Na competição de Cannes"…
FILTROS_TL.push({
  chave: 'premios',
  titulo: 'Prêmios',
  valores: (f) => {
    const v = new Set();
    for (const r of premiosDoFilme(f)) { const info = infoPremio(r.premio); v.add(info.indicado); if (r.venceu) v.add(info.venceu); }
    return [...v];
  },
});

// ---- Nos detalhes do filme ----

function premiosPainelHTML(f) {
  const lista = premiosDoFilme(f);
  if (!lista.length) return '';
  const item = (r, texto, pessoa, venceu) => `<li${venceu ? ' class="venceu"' : ''}>
      <button class="link-premio" data-p="premio" data-premio="${r.premio}" data-numero="${r.numero}" title="Abrir a cédula: ${esc(NOMES_PREMIOS[r.premio])} ${r.ano}">${r.ano}</button>
      <span>${esc(texto)}${pessoa ? ` <small>${esc(pessoa)}</small>` : ''}</span>
      ${venceu ? `<b class="selo-venceu">${icone('Trophy')} Venceu</b>` : ''}
    </li>`;
  return LISTA_PREMIOS.map((p) => {
    const doPremio = lista.filter((r) => r.premio === p);
    if (!doPremio.length) return '';
    let resumo;
    let itens;
    if (infoPremio(p).festival) {
      // Num festival, o filme está em todas as categorias da competição: uma linha por edição.
      const porEdicao = new Map();
      for (const r of doPremio) {
        const x = porEdicao.get(r.numero) || { r, ganhou: [] };
        if (r.venceu) x.ganhou.push(r.nome);
        porEdicao.set(r.numero, x);
      }
      const ganhou = [...porEdicao.values()].flatMap((x) => x.ganhou);
      resumo = ganhou.length ? ganhou.join(' · ') : (porEdicao.size === 1 ? 'na competição' : `na competição ${porEdicao.size} vezes`);
      itens = [...porEdicao.values()].map(({ r, ganhou: g }) => item(r, g.length ? g.join(', ') : 'Competição oficial', '', g.length > 0)).join('');
    } else {
      const vitorias = doPremio.filter((r) => r.venceu).length;
      resumo = [vitorias ? `${vitorias} ${vitorias === 1 ? 'vitória' : 'vitórias'}` : '', `${doPremio.length} ${doPremio.length === 1 ? 'indicação' : 'indicações'}`].filter(Boolean).join(' · ');
      itens = doPremio.map((r) => item(r, r.nome, r.pessoa, r.venceu)).join('');
    }
    return `<details class="painel-ficha painel-premios">
      <summary><b>${icone('Trophy')} ${esc(NOMES_PREMIOS[p])}:</b> <span>${esc(resumo)}</span></summary>
      <ul>${itens}</ul>
    </details>`;
  }).join('');
}

// ---- A tela ----

const chaveCedula = (premio, numero) => `${premio}-${numero}`;
const cedula = (premio, numero) => ((estado.config.premios || {})[chaveCedula(premio, numero)]) || { palpites: {} };
const chaveIndicado = (x) => `${x.titulo}|${x.pessoa}`;

function salvarCedula(premio, numero, c) {
  const todas = { ...(estado.config.premios || {}), [chaveCedula(premio, numero)]: { ...c, em: new Date().toISOString() } };
  estado.config.premios = todas;
  api.salvarConfig({ premios: todas });
}

function cerimoniaPadrao(premio) {
  const d = premiosDados[premio];
  if (!d || !d.cerimonias.length) return null;
  return (d.cerimonias.find((c) => c.indicados) || d.cerimonias[0]).numero;
}

async function abrirPremios({ premio = null, numero = null } = {}) {
  // Sem prêmio pedido: o último aberto, se a plataforma atual o mostra (senão, o primeiro que ela mostra).
  if (!premio) {
    const visiveis = premiosVisiveis();
    premio = visiveis.includes(vista.premio) || !visiveis.length ? vista.premio : visiveis[0];
  }
  fecharPrevia(false);
  fecharPainel();
  premiosTela.hidden = false;
  vista.premio = premio;
  if (!premiosDados[premio]) {
    $('#premios-caixa').innerHTML = `<div class="tl-topo"><h2>Prêmios</h2><button class="redondo tl-fechar" data-pr="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button></div><p class="mensagem">Carregando…</p>`;
    await carregarPremios();
  }
  vista.numero = numero || (vista.numero && premiosDados[premio].cerimonias.some((c) => c.numero === vista.numero) ? vista.numero : cerimoniaPadrao(premio));
  renderPremios();
  Movimento.animar($('#premios-caixa'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  $('#premios [data-pr="fechar"]')?.focus({ preventScroll: true });
  // As cerimônias recentes podem ter mudado (indicados novos, vencedores).
  atualizarPremios({ so: premio });
}

function fecharPremios() {
  if (premiosTela.hidden) return;
  premiosTela.hidden = true;
  $('#premios-caixa').innerHTML = '';
}

// A capa de um indicado: a sua (se o filme está na lista) ou a do Stremio (Cinemeta), pelo IMDb.
// Jogo: a da lista, a da IGDB (todos os consoles; vem de capasJogosPremios), a capa em pé da
// Steam (pelo appid) e, se ela falhar, o cabeçalho da Steam; sem nada, só o nome (e a IGDB
// completa depois, em completarCapasJogosPremios).
// busca: o nome do jogo, para achar a capa na IGDB quando o indicado não tem id (só jogos, não pessoas).
function capaIndicadoHTML(f, ids, titulo, jogo = false, busca = '') {
  const imdb = ids.imdb || (f && f.imdbID);
  const steam = ids.steam && Number.isInteger(Number(ids.steam)) ? Number(ids.steam) : 0;
  const daIgdb = jogo ? capaIgdbDoIndicado({ ...ids, busca }) : '';
  const steamBase = steam ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steam}/` : '';
  const src = (f && srcCapa(f)) || (jogo
    ? (daIgdb || (steam ? `${steamBase}library_600x900.jpg` : ''))
    : (imdb ? `https://images.metahub.space/poster/small/${imdb}/img` : ''));
  // Jogo: os ids vão junto, para a capa da IGDB entrar se esta falhar (ou se não houver nenhuma).
  const idsJogo = jogo ? ` data-jogo-igdb="${esc(ids.igdb || '')}" data-jogo-slug="${esc(ids.igdbSlug || '')}" data-jogo-busca="${esc(!ids.igdb && !ids.igdbSlug && !(f && srcCapa(f)) ? busca : '')}"` : '';
  const alt = jogo && steamBase && !daIgdb && !(f && srcCapa(f)) ? ` data-capa-alt="${steamBase}header.jpg"` : '';
  return src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" data-titulo-capa="${esc(titulo)}"${idsJogo}${alt}>`
    : `<span class="pr-capa-vazia"${idsJogo}>${esc(titulo)}</span>`;
}

// ---- Capas dos jogos indicados pela IGDB (as da Steam faltam em jogo de console e em alguns da Steam) ----
// Cache neste aparelho: id/slug → image_id ('' = a IGDB não tem capa). Não vai para a nuvem.
const CHAVE_CAPAS_PREMIOS = 'nandplay-capas-premios';
const capasJogosPremios = (() => {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(CHAVE_CAPAS_PREMIOS) || '{}'))); } catch { return new Map(); }
})();
function guardarCapasJogosPremios() {
  try { localStorage.setItem(CHAVE_CAPAS_PREMIOS, JSON.stringify(Object.fromEntries(capasJogosPremios))); } catch { /* sem armazenamento: busca de novo da próxima vez */ }
}
const chavesCapaIndicado = (ids) => [ids.igdb ? `id:${ids.igdb}` : '', ids.igdbSlug ? `slug:${ids.igdbSlug}` : '', ids.busca ? `busca:${normalizar(ids.busca)}` : ''].filter(Boolean);
function capaIgdbDoIndicado(ids) {
  for (const k of chavesCapaIndicado(ids)) {
    const c = capasJogosPremios.get(k);
    if (c) return /^https:/.test(c) ? c : `https://images.igdb.com/igdb/image/upload/t_cover_big/${c}.jpg`; // pela busca, já vem o endereço
  }
  return '';
}

// A capa não carregou: o cabeçalho da Steam, depois a da IGDB (se já soubermos), senão o título.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.tituloCapa) return;
  if (img.dataset.capaAlt) { img.src = img.dataset.capaAlt; img.removeAttribute('data-capa-alt'); img.classList.add('pr-capa-deitada'); return; }
  const daIgdb = capaIgdbDoIndicado({ igdb: img.dataset.jogoIgdb, igdbSlug: img.dataset.jogoSlug, busca: img.dataset.jogoBusca });
  if (daIgdb && img.getAttribute('src') !== daIgdb) { img.src = daIgdb; img.classList.remove('pr-capa-deitada'); return; }
  const s = document.createElement('span');
  s.className = 'pr-capa-vazia';
  s.textContent = img.dataset.tituloCapa;
  if (img.dataset.jogoIgdb !== undefined) Object.assign(s.dataset, { jogoIgdb: img.dataset.jogoIgdb, jogoSlug: img.dataset.jogoSlug, jogoBusca: img.dataset.jogoBusca || '' });
  img.replaceWith(s);
}, true);

// Depois de desenhar: pede à IGDB as capas que faltam e troca os títulos (e as capas deitadas
// do cabeçalho da Steam) pela capa em pé. Sem as chaves da IGDB, fica como está.
let pedindoCapasPremios = null;
async function completarCapasJogosPremios() {
  const caixa = $('#premios-caixa');
  if (!caixa || !api.capasJogos) return;
  const alvos = [...caixa.querySelectorAll('[data-jogo-igdb]')];
  if (!alvos.length) return;
  const faltam = { ids: new Set(), slugs: new Set(), buscas: new Set() };
  for (const el of alvos) {
    const ids = { igdb: el.dataset.jogoIgdb, igdbSlug: el.dataset.jogoSlug, busca: el.dataset.jogoBusca };
    if (chavesCapaIndicado(ids).some((k) => capasJogosPremios.has(k))) continue;
    if (ids.igdb) faltam.ids.add(ids.igdb); else if (ids.igdbSlug) faltam.slugs.add(ids.igdbSlug); else if (ids.busca) faltam.buscas.add(ids.busca);
  }
  if ((faltam.ids.size || faltam.slugs.size || faltam.buscas.size) && !pedindoCapasPremios) {
    pedindoCapasPremios = (async () => {
      if (faltam.ids.size || faltam.slugs.size) {
        const r = await api.capasJogos({ ids: [...faltam.ids], slugs: [...faltam.slugs] });
        if (!r || !r.ok || !r.dados) return; // sem chaves ou sem internet: tenta na próxima vez
        for (const id of faltam.ids) capasJogosPremios.set(`id:${id}`, r.dados.porId[id] || '');
        for (const s of faltam.slugs) capasJogosPremios.set(`slug:${s}`, r.dados.porSlug[s] || '');
      }
      // Sem id no Wikidata (poucos): a busca da IGDB pelo nome, ficando com o resultado de mesmo nome.
      for (const nome of faltam.buscas) {
        const r = await api.buscarJogos(nome);
        if (!r || !r.ok) break;
        const alvo = normalizar(nome);
        const achado = (r.dados || []).find((j) => j.capa && normalizar(j.titulo) === alvo) || (r.dados || []).find((j) => j.capa && normalizar(j.titulo).startsWith(alvo));
        capasJogosPremios.set(`busca:${alvo}`, achado ? achado.capa : '');
      }
      guardarCapasJogosPremios();
    })().finally(() => { pedindoCapasPremios = null; });
    await pedindoCapasPremios;
  }
  for (const el of caixa.querySelectorAll('.pr-capa-vazia[data-jogo-igdb], img.pr-capa-deitada[data-jogo-igdb]')) {
    const src = capaIgdbDoIndicado({ igdb: el.dataset.jogoIgdb, igdbSlug: el.dataset.jogoSlug, busca: el.dataset.jogoBusca });
    if (!src) continue;
    if (el instanceof HTMLImageElement) { el.src = src; el.classList.remove('pr-capa-deitada'); continue; }
    const img = document.createElement('img');
    Object.assign(img, { src, alt: '', loading: 'lazy', decoding: 'async' });
    Object.assign(img.dataset, { tituloCapa: el.textContent, jogoIgdb: el.dataset.jogoIgdb, jogoSlug: el.dataset.jogoSlug, jogoBusca: el.dataset.jogoBusca || '' });
    el.replaceWith(img);
  }
}

// ---- Prêmios de jogos: uma categoria por vez, os indicados lado a lado (como a página do The Game Awards) ----

// Um cartão: capa em pé, título, desenvolvedor, e os botões Joguei e Palpite. Pessoas e times (sem jogo)
// trazem o nome no lugar do título e uma inicial grande no lugar da capa, sem o Joguei.
function cartaoJogoHTML({ x, i, f }, k, premio, palpite) {
  const ids = idsDoIndicado(premio, x);
  const eu = palpite === chaveIndicado(x);
  const jogou = itemFeito(premio, f);
  const semTitulo = !x.titulo;
  const nome = semTitulo ? x.pessoa : (f ? f.titulo : x.titulo);
  const { desenvolvedor, credito } = semTitulo ? { desenvolvedor: '', credito: x.extra || '' } : desenvolvedorDoIndicado(x, f, k.chave);
  const pessoa = !semTitulo && x.pessoa && x.pessoa !== x.titulo ? x.pessoa : '';
  const seloLista = f ? `<span class="pr-na-lista">Na sua lista${ROTULOS_STATUS_PREMIOS[f.status] ? ` · ${ROTULOS_STATUS_PREMIOS[f.status]}` : ''}</span>` : '';
  const capa = semTitulo
    ? `<div class="pr-card-capa pr-inicial" aria-hidden="true"><span>${esc(inicialDe(x.pessoa))}</span></div>`
    : `<button class="pr-card-capa" data-pr="abrir" title="Ver os detalhes de ${esc(x.titulo)}">${capaIndicadoHTML(f, ids, nome, true, x.titulo)}</button>`;
  return `<li class="pr-card${x.venceu ? ' venceu' : ''}${eu ? ' palpite' : ''}${jogou ? ' visto' : ''}${semTitulo ? ' sem-jogo' : ''}" data-i="${i}">
      ${x.venceu ? `<em class="selo-venceu pr-faixa">${icone('Trophy')} Venceu</em>` : ''}
      ${capa}
      <b class="pr-card-titulo" title="${esc(nome)}">${esc(nome)}</b>
      ${desenvolvedor ? `<span class="pr-card-dev" title="${esc(desenvolvedor)}">${esc(desenvolvedor)}</span>` : ''}
      ${credito ? `<span class="pr-card-credito" title="${esc(credito)}">${esc(credito)}</span>` : ''}
      ${pessoa ? `<span class="pr-card-credito" title="${esc(pessoa)}">${esc(pessoa)}</span>` : ''}
      ${seloLista}
      <div class="pr-card-acoes">
        ${semTitulo || k.naoLancado ? '' : `<button class="pr-botao pr-visto${jogou ? ' on' : ''}" data-pr="joguei" aria-pressed="${jogou}" title="${jogou ? 'Você já jogou (clique para desmarcar)' : f ? 'Marcar como jogado' : 'Adicionar à sua lista como jogado'}">${icone('Check')}<span>Joguei</span></button>`}
        <button class="pr-botao pr-palpite${eu ? ' on' : ''}" data-pr="palpite" aria-pressed="${eu}" title="${eu ? 'Tirar o palpite' : 'Acho que este vence'}">${icone('Trophy')}<span>Palpite</span></button>
      </div>
    </li>`;
}

// A categoria aberta de uma edição (a primeira, se a guardada não existe nela).
function indiceCategoriaAberta(c) {
  const i = c.categorias.findIndex((k) => k.chave === vista.cat);
  return i >= 0 ? i : 0;
}

function corpoJogosHTML(premio, c, ced, resumoHTML, nomesRepetidos) {
  const ks = c.categorias;
  const i = indiceCategoriaAberta(c);
  const k = ks[i];
  if (!k) return resumoHTML;
  vista.cat = k.chave;
  const palpite = ced.palpites[k.chave];
  let status = '';
  if (c.vencedores && palpite) status = k.indicados.some((x) => x.venceu && chaveIndicado(x) === palpite) ? `<span class="pr-status certo">${icone('Check')} Acertou</span>` : `<span class="pr-status errado">${icone('X')} Errou</span>`;
  else if (!c.vencedores) status = palpite ? `<span class="pr-status">${icone('Trophy')} Palpite feito</span>` : '<span class="pr-status vazio">Sem palpite</span>';
  const itens = k.indicados.map((x, j) => ({ x, i: j, f: filmeDoIndicado(premio, x, c) }))
    // "Só o que falta jogar": sem pessoas, times e jogos que ainda não saíram, e sem o que você já jogou.
    .filter(({ x, f }) => !vista.soFalta || (x.titulo && !k.naoLancado && !itemFeito(premio, f)));
  const menu = ks.map((o, j) => `<li role="option" aria-selected="${j === i}"><button class="pr-catmenu-item${j === i ? ' ativo' : ''}" data-pr="cat-ir" data-chave="${esc(o.chave)}">
      <span>${esc(o.nome)}</span>${ced.palpites[o.chave] ? `<i class="pr-catmenu-ponto" title="Palpite feito">${icone('Trophy')}</i>` : ''}</button></li>`).join('');
  return `<nav class="pr-catnav" aria-label="Categorias">
      <button class="redondo pr-seta" data-pr="cat-ant" title="Categoria anterior (←)" aria-label="Categoria anterior">${icone('ChevronLeft')}</button>
      <div class="pr-catcentro">
        <button class="pr-catnome" data-pr="cat-menu" aria-haspopup="listbox" aria-expanded="${vista.menu}" title="Escolher a categoria">
          <span>${esc(k.nome)}</span>${icone('ChevronDown')}
        </button>
        <div class="pr-catinfo">${nomesRepetidos.has(k.nome) ? `<small>${esc(k.original)}</small> · ` : ''}<span>${i + 1} de ${ks.length}</span>${status ? ` · ${status}` : ''}</div>
        <ul class="pr-catmenu" role="listbox" aria-label="Todas as categorias"${vista.menu ? '' : ' hidden'}>${menu}</ul>
      </div>
      <button class="redondo pr-seta" data-pr="cat-prox" title="Próxima categoria (→)" aria-label="Próxima categoria">${icone('ChevronRight')}</button>
    </nav>
    <section class="pr-cat-atual" data-chave="${esc(k.chave)}">
      ${itens.length ? `<ol class="pr-fileira">${itens.map((it) => cartaoJogoHTML(it, k, premio, palpite)).join('')}</ol>` : `<p class="mensagem">Você já jogou todos os indicados desta categoria. 🎉</p>`}
    </section>
    ${resumoHTML}`;
}

// ← → e as setas do topo: vão para a categoria anterior/próxima (voltando ao fim/começo).
function irParaCategoria(delta, chave = null) {
  const d = premiosDados[vista.premio];
  const c = d && d.cerimonias.find((x) => x.numero === vista.numero);
  if (!c || !c.indicados || !c.categorias.length) return;
  const n = c.categorias.length;
  const novo = chave ? c.categorias.findIndex((k) => k.chave === chave) : (indiceCategoriaAberta(c) + delta + n) % n;
  if (novo < 0) return;
  vista.cat = c.categorias[novo].chave;
  vista.menu = false;
  renderPremios();
}

// Joguei: o jogo da lista vira "zerado" sem data (jogou em algum momento; o calendário não ganha um
// dia inventado). Fora da lista, entra já assim. Desligar volta para "quero jogar", com Desfazer.
// O palpite não tem nada a ver com isso.
async function alternarJogueiIndicado(premio, c, x) {
  const f = filmeDoIndicado(premio, x, c);
  if (f) {
    if (jogoJogado(f)) {
      const antes = { status: f.status, zeradoEm: f.zeradoEm || '' };
      await salvarJogo(f, { status: 'quero', zeradoEm: '' });
      aviso(`“${f.titulo}” voltou para “quero jogar”.`, {
        duracao: 6000,
        acao: { rotulo: 'Desfazer', fn: async () => { await salvarJogo(f, antes); if (!premiosTela.hidden) renderPremios(); } },
      });
    } else {
      await salvarJogo(f, { status: 'zerado', zeradoEm: '' });
    }
    renderPremios();
    return;
  }
  const ids = idsDoIndicado(premio, x);
  const novo = await adicionarJogo({ igdb: ids.igdb ? Number(ids.igdb) : undefined, igdbSlug: ids.igdbSlug || '', steam: ids.steam ? Number(ids.steam) : undefined, titulo: x.titulo });
  if (!novo) { aviso(`Não consegui adicionar “${x.titulo}” à sua lista.`, { tipo: 'erro' }); renderPremios(); return; }
  if (!jogoJogado(novo)) await salvarJogo(novo, { status: 'zerado', zeradoEm: '' });
  aviso(`“${novo.titulo}” entrou na sua lista como jogado.`, { tipo: 'ok', duracao: 5000 });
  renderPremios();
}

function renderPremios() {
  const caixa = $('#premios-caixa');
  const premio = vista.premio;
  const d = premiosDados[premio];
  if (!d) return;
  // A edição escolhida sumiu (ou ainda não havia dados ao abrir): a padrão.
  if (!d.cerimonias.some((x) => x.numero === vista.numero)) vista.numero = cerimoniaPadrao(premio);
  const c = d.cerimonias.find((x) => x.numero === vista.numero);
  const info = infoPremio(premio);
  // "98º Oscar · 2026", ou "Cannes 2025" quando a edição é o próprio ano.
  const nomeEdicao = (x) => (x.numero === x.ano ? `${d.nome} ${x.ano}` : `${x.numero}º ${d.nome} · ${x.ano}`);
  const abas = d.cerimonias.map((x) => `<button class="chip pr-aba${x.numero === vista.numero ? ' ativo' : ''}" data-pr="cerimonia" data-numero="${x.numero}" role="tab" aria-selected="${x.numero === vista.numero}" title="${esc(nomeEdicao(x))}${x.indicados ? '' : ' (ainda não anunciado)'}">${x.ano}${x.indicados ? '' : ' <small>em breve</small>'}</button>`).join('');

  let corpo = '';
  if (!c) {
    corpo = `<p class="mensagem">Ainda não há edições aqui. ${esc(info.quando)}.</p>`;
  } else if (!c.indicados) {
    corpo = `<section class="pr-resumo pr-aguardando">
      <span class="est-kicker">${icone('Hourglass')} ${esc(nomeEdicao(c))}</span>
      <p>${info.festival ? 'Os filmes da competição ainda não foram anunciados.' : 'Os indicados ainda não foram anunciados.'} ${esc(info.quando)}, e aparecem aqui sozinhos.</p>
      <button class="btn" data-pr="atualizar">${icone('RefreshCw')} Procurar agora</button>
    </section>`;
  } else {
    const ced = cedula(premio, c.numero);
    const jogo = premioEhDeJogo(premio);
    const v = vocPremio(premio); // filmes: "viu" / "ver"; jogos: "jogou" / "jogar"
    // Os filmes (ou jogos) indicados, cada um uma vez, e quantos você viu (jogou). Pessoas e times não
    // contam, nem os jogos ainda não lançados (Most Anticipated Game).
    const filmes = new Map();
    for (const k of c.categorias) for (const x of k.indicados) {
      if (!x.titulo || k.naoLancado) continue;
      const chave = x.wiki || normalizar(x.titulo);
      if (!filmes.has(chave)) filmes.set(chave, filmeDoIndicado(premio, x, c));
    }
    const vistos = [...filmes.values()].filter((f) => itemFeito(premio, f)).length;
    const naLista = [...filmes.values()].filter(Boolean).length;
    const palpitados = c.categorias.filter((k) => ced.palpites[k.chave]).length;
    const acertos = c.vencedores ? c.categorias.filter((k) => k.indicados.some((x) => x.venceu && chaveIndicado(x) === ced.palpites[k.chave])).length : 0;
    const pct = filmes.size ? Math.round((vistos / filmes.size) * 100) : 0;
    const nomesRepetidos = new Set(c.categorias.map((k) => k.nome).filter((n, i, l) => l.indexOf(n) !== i));

    const cards = jogo ? '' : c.categorias.map((k) => {
      const palpite = ced.palpites[k.chave];
      const indicados = k.indicados.map((x, i) => ({ x, i, f: filmeDoIndicado(premio, x, c) }))
        // "Só o que falta ver/jogar": sem pessoas, times e jogos que ainda não saíram, e sem o que você já fez.
        .filter(({ x, f }) => !vista.soFalta || (x.titulo && !k.naoLancado && !itemFeito(premio, f)));
      if (vista.soFalta && !indicados.length) return '';
      let status = '';
      if (c.vencedores && palpite) status = k.indicados.some((x) => x.venceu && chaveIndicado(x) === palpite) ? `<span class="pr-status certo">${icone('Check')} Acertou</span>` : `<span class="pr-status errado">${icone('X')} Errou</span>`;
      else if (!c.vencedores) status = palpite ? `<span class="pr-status">${icone('Trophy')} Palpite feito</span>` : '<span class="pr-status vazio">Sem palpite</span>';
      return `<section class="pr-cat" data-chave="${esc(k.chave)}">
        <header>
          <h4>${esc(k.nome)}${nomesRepetidos.has(k.nome) ? ` <small>${esc(k.original)}</small>` : ''}</h4>
          ${status}
        </header>
        <ol class="pr-indicados">${indicados.map(({ x, i, f }) => {
          const ids = idsDoIndicado(premio, x);
          const eu = palpite === chaveIndicado(x);
          const visto = itemFeito(premio, f);
          // Sem jogo (pessoa ou time): o próprio nome é o título.
          const semTitulo = !x.titulo;
          const nomeInd = semTitulo ? x.pessoa : (f ? f.titulo : x.titulo);
          const pessoa = !semTitulo && x.pessoa && x.pessoa !== x.titulo ? x.pessoa : '';
          // Jogo da sua lista: o estado dele (Zerado, Jogando…). Os de filme não têm selo.
          const seloLista = jogo && f ? `<span class="pr-na-lista">Na sua lista${ROTULOS_STATUS_PREMIOS[f.status] ? ` · ${ROTULOS_STATUS_PREMIOS[f.status]}` : ''}</span>` : '';
          return `<li class="pr-ind${x.venceu ? ' venceu' : ''}${eu ? ' palpite' : ''}${visto ? ' visto' : ''}${semTitulo ? ' sem-jogo' : ''}" data-i="${i}">
            <button class="pr-capa" data-pr="abrir" ${semTitulo ? 'tabindex="-1" aria-hidden="true"' : `title="Ver os detalhes de ${esc(x.titulo)}"`}>${capaIndicadoHTML(f, ids, nomeInd, jogo, jogo && !semTitulo ? x.titulo : '')}</button>
            <div class="pr-ind-texto">
              <b title="${esc(nomeInd)}">${esc(nomeInd)}</b>
              ${pessoa ? `<span>${esc(pessoa)}</span>` : ''}
              ${seloLista}
              ${x.venceu ? `<em class="selo-venceu">${icone('Trophy')} Venceu</em>` : ''}
            </div>
            <div class="pr-ind-acoes">
              ${semTitulo || jogo ? '' : `<button class="pr-botao pr-visto${visto ? ' on' : ''}" data-pr="visto" aria-pressed="${visto}" title="${visto ? 'Você já viu (clique para desmarcar)' : f ? 'Marcar como visto' : 'Adicionar à sua lista como visto'}">${icone('Check')}<span>Visto</span></button>`}
              <button class="pr-botao pr-palpite${eu ? ' on' : ''}" data-pr="palpite" aria-pressed="${eu}" title="${eu ? 'Tirar o palpite' : 'Acho que este vence'}">${icone('Trophy')}<span>Palpite</span></button>
            </div>
          </li>`;
        }).join('')}</ol>
      </section>`;
    }).join('');

    const resumoHTML = `<section class="pr-resumo">
        <div class="pr-resumo-titulo">
          <span class="est-kicker">${icone('Trophy')} ${esc(nomeEdicao(c))}</span>
          <h3>Você ${v.viu} ${vistos} de ${filmes.size} ${v.itens} ${info.festival ? 'da competição' : 'indicados'}</h3>
          <div class="pr-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
          <p>${naLista - vistos > 0 ? `${naLista - vistos} ${naLista - vistos === 1 ? 'está' : 'estão'} na sua lista para ${v.ver}. ` : ''}${c.vencedores ? (info.festival ? 'Os prêmios do júri já saíram.' : 'Os vencedores já saíram.') : (info.festival ? 'O júri anuncia os prêmios no fim do festival; faça seus palpites.' : 'Os vencedores saem na cerimônia; faça seus palpites.')}</p>
        </div>
        <div class="pr-numeros">
          <div><b>${palpitados}<small>/${c.categorias.length}</small></b><span>palpites</span></div>
          ${c.vencedores && palpitados ? `<div class="ouro"><b>${acertos}<small>/${palpitados}</small></b><span>acertos</span></div>` : ''}
        </div>
        <div class="pr-acoes">
          <button class="chip${vista.soFalta ? ' ativo' : ''}" data-pr="so-falta" aria-pressed="${vista.soFalta}">${icone('EyeOff')} Só o que falta ${v.ver}</button>
          ${palpitados ? `<button class="chip" data-pr="limpar-palpites">${icone('Eraser')} Limpar palpites</button>` : ''}
        </div>
      </section>`;
    corpo = jogo
      ? corpoJogosHTML(premio, c, ced, resumoHTML, nomesRepetidos)
      : `${resumoHTML}
      <div class="pr-categorias">${cards || `<p class="mensagem">Você já ${v.viu} todos os ${info.festival ? `${v.itens} da competição` : 'indicados'}. 🎉</p>`}</div>`;
  }

  // Jogos: a caixa ocupa quase a janela toda. Ao redesenhar a mesma categoria (Joguei, Palpite), a
  // fileira e a rolagem ficam onde estavam.
  const jogos = premioEhDeJogo(premio);
  const chaveVista = `${premio}|${vista.numero}|${vista.cat}`;
  const mesma = caixa.dataset.vista === chaveVista;
  const esq = mesma ? ($('.pr-fileira', caixa) || { scrollLeft: 0 }).scrollLeft : 0;
  const rolagem = mesma ? caixa.scrollTop : 0;
  caixa.classList.toggle('pr-larga', jogos);
  caixa.innerHTML = `
    <div class="tl-topo pr-topo">
      <h2>Prêmios</h2>
      <div class="chips-linha pr-lista" role="radiogroup" aria-label="Prêmio">
        ${premiosVisiveis().map((p) => `<button class="chip${p === premio ? ' ativo' : ''}" data-pr="premio" data-premio="${p}" role="radio" aria-checked="${p === premio}">${icone('Trophy')} ${esc(NOMES_PREMIOS[p])}</button>`).join('')}
      </div>
      <button class="redondo tl-fechar" data-pr="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
    </div>
    <div class="pr-abas" role="tablist" aria-label="Cerimônias">${abas}</div>
    ${corpo}`;
  // O prêmio e a aba escolhidos à vista.
  $('.pr-lista .chip.ativo', caixa)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('.pr-aba.ativo', caixa)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  caixa.dataset.vista = `${premio}|${vista.numero}|${vista.cat}`;
  const fileira = $('.pr-fileira', caixa);
  if (mesma) { caixa.scrollTop = rolagem; if (fileira) fileira.scrollLeft = esq; }
  else if (fileira) { caixa.scrollTop = 0; $('.pr-card.venceu', fileira)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
}

// Visto: o filme da lista muda; um filme fora da lista entra nela já como visto
// (sem data: dá para pôr no calendário depois, em "Lançar outro dia").
async function alternarVistoIndicado(premio, c, x) {
  const f = filmeDoIndicado(premio, x, c);
  if (f) {
    if (f.visto) { await alternar(f.id, 'visto', false); }
    else { f.visto = true; aposMudarDia(f.id); await api.atualizarFilme(f.id, { visto: true }); }
    renderPremios();
    return;
  }
  const ids = idsDoIndicado(premio, x);
  const dados = { titulo: x.titulo, ano: String(c.ano - 1), imdbID: ids.imdb || '', tmdbId: ids.tmdb || '' };
  const repetido = await api.acharRepetido(dados);
  if (repetido) {
    const f2 = porId(repetido.id) || repetido;
    f2.visto = true;
    aposMudarDia(f2.id);
    await api.atualizarFilme(f2.id, { visto: true });
  } else {
    const novo = await api.adicionarFilme(dados);
    novo.tmdbId = dados.tmdbId;
    novo.visto = true;
    estado.filmes.push(novo);
    await api.atualizarFilme(novo.id, { visto: true });
    aviso(`“${x.titulo}” entrou na sua lista como visto. Para pôr a data no calendário, use “Lançar outro dia” nos detalhes.`, { tipo: 'ok', duracao: 6000 });
  }
  render();
  renderPremios();
}

premiosTela.addEventListener('click', async (e) => {
  if (e.target === premiosTela) { fecharPremios(); return; }
  const b = e.target.closest('[data-pr]');
  // A lista de categorias fecha com qualquer clique fora dela.
  if (vista.menu && !(b && b.dataset.pr === 'cat-menu') && !e.target.closest('.pr-catmenu')) fecharMenuCategorias();
  if (!b) return;
  const d = premiosDados[vista.premio];
  const c = d && d.cerimonias.find((x) => x.numero === vista.numero);
  const li = b.closest('.pr-ind, .pr-card');
  const cat = b.closest('.pr-cat, .pr-cat-atual');
  const k = c && cat ? c.categorias.find((x) => x.chave === cat.dataset.chave) : null;
  const x = k && li ? k.indicados[Number(li.dataset.i)] : null;
  switch (b.dataset.pr) {
    case 'fechar': fecharPremios(); break;
    case 'premio': vista.premio = b.dataset.premio; vista.numero = cerimoniaPadrao(vista.premio); renderPremios(); atualizarPremios({ so: vista.premio }); break;
    case 'cerimonia': vista.numero = Number(b.dataset.numero); renderPremios(); $('#premios-caixa').scrollTo({ top: 0 }); break;
    case 'so-falta': vista.soFalta = !vista.soFalta; renderPremios(); break;
    case 'atualizar': b.disabled = true; await atualizarPremios({ forcar: true, so: vista.premio }); renderPremios(); break;
    case 'limpar-palpites': salvarCedula(vista.premio, c.numero, { ...cedula(vista.premio, c.numero), palpites: {} }); renderPremios(); break;
    case 'palpite': {
      if (!x) return;
      const ced = cedula(vista.premio, c.numero);
      const palpites = { ...ced.palpites };
      if (palpites[k.chave] === chaveIndicado(x)) delete palpites[k.chave]; else palpites[k.chave] = chaveIndicado(x);
      salvarCedula(vista.premio, c.numero, { ...ced, palpites });
      renderPremios();
      break;
    }
    case 'cat-ant': irParaCategoria(-1); break;
    case 'cat-prox': irParaCategoria(1); break;
    case 'cat-menu': {
      vista.menu = !vista.menu;
      const lista = $('.pr-catmenu', premiosTela);
      if (lista) { lista.hidden = !vista.menu; b.setAttribute('aria-expanded', String(vista.menu)); $('.pr-catmenu-item.ativo', lista)?.scrollIntoView({ block: 'nearest' }); }
      break;
    }
    case 'cat-ir': irParaCategoria(0, b.dataset.chave); break;
    case 'joguei': if (x) { b.disabled = true; await alternarJogueiIndicado(vista.premio, c, x); } break;
    case 'visto': if (x) { b.disabled = true; await alternarVistoIndicado(vista.premio, c, x); } break;
    case 'abrir': {
      if (!x || !x.titulo) return; // pessoa ou time: não há página
      const f = filmeDoIndicado(vista.premio, x, c);
      const ids = idsDoIndicado(vista.premio, x);
      if (f) abrirPainel(f.id);
      else if (premioEhDeJogo(vista.premio)) abrirIndicadoJogo(ids, x); // fora da lista: só se houver página de jogo
      else if (ids.tmdb) abrirFilmeExterno(ids.tmdb);
      else aviso('Não achei esse filme no TMDB.');
      break;
    }
  }
});

function fecharMenuCategorias() {
  vista.menu = false;
  const lista = $('.pr-catmenu', premiosTela);
  if (lista) lista.hidden = true;
  $('.pr-catnome', premiosTela)?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('keydown', (e) => {
  if (premiosTela.hidden || modal.open || estado.painelId) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (vista.menu) fecharMenuCategorias(); else fecharPremios();
    return;
  }
  // ← → trocam de categoria nos prêmios de jogos (fora de campos de texto).
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && premioEhDeJogo(vista.premio) && !e.altKey && !e.ctrlKey && !e.metaKey
    && !e.target.closest('input, textarea, select, [contenteditable]') && !e.target.closest('.pr-abas, .pr-lista')) {
    e.preventDefault();
    irParaCategoria(e.key === 'ArrowLeft' ? -1 : 1);
  }
});

// A roda do mouse rola de lado a lista de prêmios e as abas dos anos.
premiosTela.addEventListener('wheel', (e) => {
  const abas = e.target.closest('.pr-abas, .pr-lista, .pr-fileira');
  if (!abas || Math.abs(e.deltaX) > Math.abs(e.deltaY) || abas.scrollWidth <= abas.clientWidth) return;
  e.preventDefault();
  abas.scrollLeft += e.deltaY;
}, { passive: false });

// Nos detalhes: o ano de uma indicação abre a cédula daquela cerimônia.
document.addEventListener('click', (e) => {
  const b = e.target.closest('#painel [data-p="premio"]');
  if (!b) return;
  e.stopPropagation();
  abrirPremios({ premio: b.dataset.premio, numero: Number(b.dataset.numero) });
}, true);

$('#btn-premios').addEventListener('click', () => abrirPremios());

carregarPremios().then(() => setTimeout(() => atualizarPremios(), 8000));

// Jogos: depois de cada desenho, as capas que faltam vêm da IGDB.
const renderPremiosSemCapas = renderPremios;
renderPremios = () => { renderPremiosSemCapas(); if (premioEhDeJogo(vista.premio)) completarCapasJogosPremios(); };
