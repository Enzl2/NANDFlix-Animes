'use strict';

// ---------- NANDRoll: animes ----------
//
// A parte de animes da interface. Um anime pode ser:
// - série (`tipo: 'serie'`): tem episódios, status e vem da AniList;
// - filme de anime (`anime: true`, sem tipo): é um filme como os outros, e a
//   AniList só acrescenta onde assistir.
// O app.js chama as funções daqui nos pontos marcados com "NANDRoll".

// O NANDRoll é opcional: liga em Configurações. Desligado, o app é o NANDFlix
// de sempre (sem busca de animes nem filtros); os animes já adicionados ficam
// na lista, com o painel deles, para nada se perder.
const nandrollLigado = () => Boolean(estado.config && estado.config.nandroll);

// Mostra ou esconde o que é só de anime na tela principal.
function aplicarNandroll() {
  const ligado = nandrollLigado();
  for (const c of $$('.chip[data-filtro="animes"], .chip[data-filtro="assistindo"]')) c.hidden = !ligado;
  if (!ligado && (estado.filtro === 'animes' || estado.filtro === 'assistindo')) {
    estado.filtro = 'todos';
    for (const c of $$('.chip[data-filtro]')) { c.classList.toggle('ativo', c.dataset.filtro === 'todos'); c.setAttribute('aria-checked', String(c.dataset.filtro === 'todos')); }
  }
}

// A seção das Configurações.
function nandrollConfigHTML() {
  return `
      <div class="secao">
        <h3>NANDRoll (animes)</h3>
        <div class="opcoes-radio">
          <label><input type="checkbox" id="cfg-nandroll" ${nandrollLigado() ? 'checked' : ''}> Ativar animes</label>
          <label><input type="checkbox" id="cfg-nandroll-plataformas" ${todasPlataformas() ? 'checked' : ''}> Mostrar plataformas de fora do Brasil</label>
        </div>
        <p>Busca de animes na AniList (sem chave), episódios e status das séries, próximo episódio e onde assistir. Desligado, o app fica como o NANDFlix original; os animes já adicionados continuam na lista.</p>
      </div>`;
}

function ligarNandrollConfig(raiz) {
  const fora = $('#cfg-nandroll-plataformas', raiz);
  if (fora) fora.onchange = async () => {
    estado.config = await api.salvarConfig({ nandrollTodasPlataformas: fora.checked });
    if (estado.painelId) renderPainel();
  };
  const caixa = $('#cfg-nandroll', raiz);
  if (!caixa) return;
  caixa.onchange = async () => {
    estado.config = await api.salvarConfig({ nandroll: caixa.checked });
    aplicarNandroll();
    render();
    if (typeof renderCelular === 'function') renderCelular();
    aviso(caixa.checked ? 'NANDRoll ativado: busque animes em Adicionar.' : 'NANDRoll desativado.', { tipo: 'ok' });
  };
}

// A fonte da busca do "Adicionar": só há animes com o NANDRoll ligado.
const fonteAtual = () => (nandrollLigado() ? fonteBusca : 'filme');

const ehSerie = (f) => Boolean(f) && f.tipo === 'serie';
const ehAnime = (f) => Boolean(f) && (f.anime === true || ehSerie(f));

const STATUS_ROTULOS = { planejo: 'Planejo ver', assistindo: 'Assistindo', pausado: 'Pausado', completo: 'Completo', largado: 'Larguei' };

// ---- Temporadas ----
//
// Uma série guarda todas as temporadas no mesmo item (`temporadas`). No painel,
// "Tudo" mostra a soma e a capa principal (TMDB); escolher uma temporada mostra
// os episódios dela e a capa dela (a da AniList, num quadro menor).

const temporadasDe = (f) => (Array.isArray(f.temporadas) ? f.temporadas : []);
const temporadaLancada = (t) => t.exibicao !== 'não lançado';
const temporadaCompleta = (t) => Boolean(t.episodios) && (Number(t.vistos) || 0) >= t.episodios;

// A temporada escolhida em cada painel (id do item → índice; sem entrada = "Tudo").
const temporadaEscolhida = new Map();
function indiceTemporada(f) {
  const i = temporadaEscolhida.get(f.id);
  return Number.isInteger(i) && temporadasDe(f)[i] ? i : null;
}
// A temporada em que a pessoa está: a primeira lançada ainda não terminada (ou a última lançada).
function temporadaCorrente(f) {
  const ts = temporadasDe(f);
  const lancadas = ts.filter(temporadaLancada);
  return lancadas.find((t) => !temporadaCompleta(t)) || lancadas[lancadas.length - 1] || ts[0] || null;
}

// Nome curto da temporada para o chip: o que sobra do título depois do nome da
// série ("SPY x FAMILY Season 2" → "Temporada 2", "… Mugen Train Arc" → "Mugen Train Arc").
function rotuloTemporada(f, t, i) {
  if (i === 0) return 'Temporada 1';
  const limpo = (x) => String(x || '').replace(/[×✕]/g, 'x').trim();
  const raiz = temporadasDe(f)[0] || {};
  let resto = '';
  for (const [titulo, base] of [[t.titulo, raiz.titulo], [t.tituloRomaji, raiz.tituloRomaji], [t.titulo, raiz.tituloRomaji], [t.tituloRomaji, raiz.titulo]]) {
    const a = limpo(titulo); const b = limpo(base);
    if (a && b && a.toLowerCase().startsWith(b.toLowerCase()) && a.length > b.length) { resto = a.slice(b.length).replace(/^[\s:–—-]+/, '').trim(); break; }
  }
  if (!resto) return t.titulo || `Parte ${i + 1}`;
  return resto
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i, 'Temporada $1')
    .replace(/\bfinal season\b/i, 'Temporada final')
    .replace(/\bseason\s*(\d+)\b/i, 'Temporada $1')
    .replace(/\b(?:part|cour)\s*(\d+)\b/i, 'Parte $1');
}

// "3 / 12 episódios", ou "3 episódios vistos" quando ainda não se sabe o total.
function contaEpisodiosHTML(vistos, total) {
  return total
    ? `<b>${vistos}</b> / ${total} episódio${total > 1 ? 's' : ''}`
    : `<b>${vistos}</b> episódio${vistos === 1 ? '' : 's'} visto${vistos === 1 ? '' : 's'}`;
}

// "Episódio 5 sai sexta-feira, 14 de novembro, às 12:30"
function proximoEpisodioTexto(p) {
  if (!p || !p.em) return '';
  const quando = new Date(p.em);
  if (Number.isNaN(quando.getTime()) || quando.getTime() < Date.now()) return '';
  const dia = quando.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Episódio ${p.numero} sai ${dia}, às ${hora}`;
}

// Linha de dados do painel de uma série: "2022  4 temporadas  50 eps  24 min/ep  finalizado".
function serieMetaHTML(f) {
  const partes = [f.ano];
  const n = temporadasDe(f).filter(temporadaLancada).length;
  if (n > 1) partes.push(`${n} temporadas`);
  if (f.episodios) partes.push(`${f.episodios} ep${f.episodios > 1 ? 's' : ''}`);
  if (f.duracao) partes.push(`${f.duracao} min/ep`);
  if (f.exibicao) partes.push(f.exibicao);
  return partes.filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('') || '&nbsp;';
}

// ---- Onde assistir ----

// Os serviços que funcionam no Brasil. A AniList lista os links de todos os
// países; por padrão só estes aparecem (Configurações → NANDRoll mostra todos).
const PLATAFORMAS_BR = new Set(['crunchyroll', 'netflix', 'amazon prime video', 'prime video', 'amazon', 'disney plus', 'disney+', 'max', 'hbo max',
  'youtube', 'apple tv', 'apple tv+', 'paramount plus', 'paramount+', 'pluto tv', 'globoplay', 'star+', 'claro video', 'looke', 'anime onegai', 'mubi']);
const todasPlataformas = () => Boolean(estado.config && estado.config.nandrollTodasPlataformas);
const plataformaVisivel = (l) => todasPlataformas() || PLATAFORMAS_BR.has(String(l.site || '').toLowerCase().trim());

// Os links das plataformas oficiais, para séries (da temporada `t`) e filmes de anime.
function ondeAssistirHTML(f, t = null, indice = null) {
  const todos = Array.isArray((t || f).ondeAssistir) ? (t || f).ondeAssistir : [];
  const links = todos.map((l, i) => ({ ...l, i })).filter(plataformaVisivel);
  const id = (t && t.anilistId) || f.anilistId;
  if (!links.length && !id) return '';
  const dt = indice === null ? '' : ` data-t="${indice}"`;
  const botoes = links.map((l) => `<button class="chip chip-plataforma" data-serie="plataforma" data-i="${l.i}"${dt} title="Abrir em ${esc(l.site)}">${icone('Play')} ${esc(l.site)}</button>`).join('');
  const anilist = id ? `<button class="chip chip-plataforma chip-anilist" data-serie="anilist"${dt} title="Abrir a página na AniList">AniList</button>` : '';
  const escondidos = todos.length - links.length;
  const nota = escondidos && !links.length ? `<span class="onde-nota">Só em plataformas de fora do Brasil (${escondidos}).</span>` : '';
  return `<div class="onde-assistir"><b>${links.length ? 'Onde assistir' : 'Mais sobre'}</b><div class="chips-linha">${botoes}${anilist}</div>${nota}</div>`;
}

// ---- O bloco do painel ----

function chipsTemporadasHTML(f, sel) {
  const ts = temporadasDe(f);
  if (ts.length < 2) return '';
  const chip = (i, rotulo, extra = '', titulo = '') => `<button class="chip chip-temporada${sel === i ? ' ativo' : ''}${extra}" data-serie="temporada" data-t="${i === null ? '' : i}" role="tab" aria-selected="${sel === i}"${titulo ? ` title="${esc(titulo)}"` : ''}>${rotulo}</button>`;
  return `<div class="chips-linha temporadas" role="tablist" aria-label="Temporadas">
    ${chip(null, 'Tudo')}
    ${ts.map((t, i) => chip(i, `${temporadaCompleta(t) ? icone('Check') : ''}${esc(rotuloTemporada(f, t, i))}`, temporadaLancada(t) ? '' : ' nao-lancada', `${t.titulo}${t.ano ? ` (${t.ano})` : ''}`)).join('')}
  </div>`;
}

// Contador de episódios, status, próximo episódio e onde assistir.
function animeNoPainelHTML(f) {
  if (!ehAnime(f)) return '';
  if (!ehSerie(f)) return `<div class="serie" data-anime-bloco>${ondeAssistirHTML(f)}</div>`;
  const ts = temporadasDe(f);
  const sel = indiceTemporada(f);
  const t = sel === null ? null : ts[sel];
  const vistos = t ? Number(t.vistos) || 0 : Number(f.episodiosVistos) || 0;
  const total = t ? Number(t.episodios) || 0 : Number(f.episodios) || 0;
  const status = STATUS_ROTULOS[f.status] ? f.status : 'planejo';
  const corrente = t || temporadaCorrente(f);
  const proximo = proximoEpisodioTexto(t ? t.proximoEpisodio : f.proximoEpisodio);
  // Com todos os episódios mas sem estar completa (o ✓ foi desmarcado), "Vi mais um" completa de novo.
  const cheio = t ? (temporadaCompleta(t) || !temporadaLancada(t)) : (total > 0 && vistos >= total && status === 'completo');
  const nomeDaVez = !t && ts.length > 1 && corrente && status !== 'completo' ? `<p class="serie-da-vez">Você está em: <b>${esc(rotuloTemporada(f, corrente, ts.indexOf(corrente)))}</b></p>` : '';
  const cabecalho = t ? `
      <div class="serie-temporada">
        ${t.poster ? `<img class="serie-capa-temporada" src="${esc(t.poster)}" alt="" loading="lazy">` : ''}
        <p><b>${esc(t.titulo)}</b><span>${[t.ano, t.episodios ? `${t.episodios} eps` : '', t.exibicao].filter(Boolean).map(esc).join(' · ')}</span></p>
      </div>` : '';
  return `
    <div class="serie" data-anime-bloco>
      ${chipsTemporadasHTML(f, sel)}
      ${cabecalho}${nomeDaVez}
      <div class="serie-linha">
        <button class="redondo serie-menos" data-serie="menos" title="Um episódio a menos" aria-label="Um episódio a menos"${vistos ? '' : ' disabled'}>${icone('Minus')}</button>
        <span class="serie-conta" aria-live="polite">${contaEpisodiosHTML(vistos, total)}</span>
        <button class="btn btn-laranja serie-mais" data-serie="mais"${cheio ? ' disabled' : ''}>${icone('Plus')} Vi mais um</button>
        <label class="serie-status"><span class="sr-so">Status</span>
          <select data-serie-status aria-label="Status da série">
            ${Object.entries(STATUS_ROTULOS).map(([k, r]) => `<option value="${k}"${k === status ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </label>
      </div>
      ${total ? `<div class="serie-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${vistos}"><span style="width:${Math.round((vistos / total) * 100)}%"></span></div>` : ''}
      ${t && !temporadaLancada(t) ? '<p class="serie-proximo">Ainda não lançada.</p>' : ''}
      ${proximo ? `<p class="serie-proximo">${icone('CalendarClock')} ${esc(proximo)}</p>` : ''}
      ${ts.length ? ondeAssistirHTML(f, corrente, corrente ? ts.indexOf(corrente) : null) : ondeAssistirHTML(f)}
    </div>`;
}

// A capa do painel: a principal em "Tudo"; numa temporada, a capa dela (a da
// AniList) num quadro menor e do formato da própria imagem, sem faixas nem corte.
function ajustarCapaTemporada(f) {
  const lugar = $('#painel .destaque-poster');
  if (!lugar || !f) return;
  const sel = ehSerie(f) ? indiceTemporada(f) : null;
  const t = sel === null ? null : temporadasDe(f)[sel];
  const deTemporada = Boolean(t && t.poster);
  if (!deTemporada && !lugar.classList.contains('de-temporada')) return; // já é a principal
  lugar.classList.toggle('de-temporada', deTemporada);
  lugar.innerHTML = deTemporada
    ? `<div class="capa capa-temporada"><img src="${esc(t.poster)}" alt="" data-titulo="${esc(t.titulo)}" data-ano="${esc(t.ano)}"></div>`
    : capaHTML(f, { tamanho: 'grande' });
}

// Selo na capa das séries em andamento: "3/12".
function seloSerieTexto(f) {
  if (!ehSerie(f)) return '';
  const vistos = Number(f.episodiosVistos) || 0;
  if (!vistos || f.status === 'completo') return '';
  return f.episodios ? `${vistos}/${f.episodios}` : `ep ${vistos}`;
}

async function mudarEpisodios(id, delta) {
  const f = porId(id);
  if (!ehSerie(f)) return;
  const antes = f.status;
  const novo = await api.progressoSerie(id, delta, hoje(), indiceTemporada(f));
  if (!novo) return;
  Object.assign(f, novo);
  if (f.status === 'completo' && antes !== 'completo') aviso(`“${f.titulo}” completo!`, { tipo: 'ok' });
  aposMudarDia(id);
}

async function mudarStatusSerie(id, status) {
  const f = porId(id);
  if (!ehSerie(f)) return;
  const novo = await api.statusSerie(id, status, hoje());
  if (!novo) return;
  Object.assign(f, novo);
  aposMudarDia(id);
}

// Cliques e trocas no bloco de anime do painel (os botões usam data-serie, não
// data-p, para o painel do app.js não tratar).
function ligarAnimeNoPainel() {
  const painel = $('#painel');
  if (!painel || painel.dataset.anime) return;
  painel.dataset.anime = '1';
  painel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-serie]');
    const id = estado.painelId;
    if (!b || !id) return;
    const f = porId(id);
    if (!f) return;
    const t = b.dataset.t === undefined || b.dataset.t === '' ? null : Number(b.dataset.t);
    switch (b.dataset.serie) {
      case 'mais': mudarEpisodios(id, 1); break;
      case 'menos': mudarEpisodios(id, -1); break;
      case 'temporada':
        if (t === null) temporadaEscolhida.delete(id); else temporadaEscolhida.set(id, t);
        renderPainel();
        break;
      case 'plataforma': api.abrirPlataforma(id, Number(b.dataset.i), t); break;
      case 'anilist': api.abrirAnilist(id, t); break;
      default:
    }
  });
  painel.addEventListener('change', (e) => {
    if (e.target.matches('[data-serie-status]') && estado.painelId) mudarStatusSerie(estado.painelId, e.target.value);
  });
}

// ---- Adicionar: buscar entre filmes (TMDB) ou animes (AniList) ----

let fonteBusca = 'filme';
try { fonteBusca = localStorage.getItem('fonteBusca') === 'anime' ? 'anime' : 'filme'; } catch { /* fica filme */ }

function fontesBuscaHTML() {
  if (!nandrollLigado()) return '';
  const chip = (k, r) => `<button class="chip${fonteBusca === k ? ' ativo' : ''}" data-fonte="${k}" role="radio" aria-checked="${fonteBusca === k}">${r}</button>`;
  return `<div class="chips fontes-busca" role="radiogroup" aria-label="Onde buscar">${chip('filme', 'Filmes')}${chip('anime', 'Animes')}</div>`;
}

// Liga os chips "Filmes | Animes" do modal; `aoTrocar` refaz a busca.
function ligarFontesBusca(raiz, aoTrocar) {
  const grupo = $('.fontes-busca', raiz);
  if (!grupo) return;
  grupo.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fonte]');
    if (!b || b.dataset.fonte === fonteBusca) return;
    fonteBusca = b.dataset.fonte;
    try { localStorage.setItem('fonteBusca', fonteBusca); } catch { /* só não lembra */ }
    for (const c of $$('[data-fonte]', grupo)) {
      c.classList.toggle('ativo', c === b);
      c.setAttribute('aria-checked', String(c === b));
    }
    aoTrocar();
  });
}

// ---- Filtros da lista ----

// Os filtros "Animes" e "Assistindo" (chips do PC e pílulas do celular).
function passaFiltroAnime(f, filtro) {
  if (!nandrollLigado()) return true;
  if (filtro === 'animes') return ehAnime(f);
  if (filtro === 'assistindo') return ehSerie(f) && f.status === 'assistindo';
  return true;
}
