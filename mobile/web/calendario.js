'use strict';

// ---------- Calendário no celular ----------
//
// O mês do PC (células altas com as capas empilhadas) não cabe numa tela de
// celular. Aqui o calendário tem a cara de um app: uma barra fixa no alto (←,
// título), o mês numa grade de capas pequenas, e embaixo a watchlist de hoje
// numa fileira e o diário do mês em lista. A página do dia também é própria
// do celular: uma lista, no lugar dos cartões largos do PC. Os cliques usam os
// mesmos data-c, tratados pelo app.js.

function barraCalHTML({ voltar, titulo, acao = '' }) {
  return `
    <header class="cbar">
      <button class="cbar-voltar" data-c="${voltar}" aria-label="Voltar">${icone('ArrowLeft')}</button>
      <h1>${esc(titulo)}</h1>
      ${acao}
    </header>`;
}

const capaCalHTML = (f) => (srcCapa(f) ? `<img src="${esc(srcCapa(f))}" alt="" loading="lazy">` : `<span class="ccal-sem-capa">${esc(f.titulo)}</span>`);

// eslint-disable-next-line no-func-assign
mesHTML = function mesHTMLCelular(mes) {
  const p = escopoCal();
  const porEp = porEpisodio(p);
  const jogos = porZerado(p);
  const [ano, m] = mes.split('-').map(Number);
  const deslocamento = new Date(ano, m - 1, 1).getDay();
  const diasNoMes = new Date(ano, m, 0).getDate();
  const porDia = vistosPorDia(p);
  const diaHoje = hoje();
  const mesAtual = diaHoje.slice(0, 7);
  const doMes = itemDoMes(mes, p);
  const diasDoMes = [...porDia.entries()].filter(([d]) => d.startsWith(mes)).sort((a, b) => b[0].localeCompare(a[0]));
  const contagem = contagemDoMes(p, mes, porDia);
  const noMes = contagem.sessoes;
  const wlHoje = idsWatchlist(diaHoje, p).map(porId).filter(Boolean);

  let celulas = '';
  for (let i = 0; i < deslocamento; i++) celulas += '<span class="ccal-dia ccal-branco" aria-hidden="true"></span>';
  for (let d = 1; d <= diasNoMes; d++) {
    const dia = `${mes}-${String(d).padStart(2, '0')}`;
    let vistos = porDia.get(dia) || [];
    const temDoMes = Boolean(doMes && vistos.includes(doMes));
    if (temDoMes) vistos = [doMes, ...vistos.filter((f) => f !== doMes)];
    const wlFilmes = idsWatchlist(dia, p).map(porId).filter(Boolean);
    const wl = wlFilmes.length;
    const wlSrc = wl && !vistos.length ? srcCapa(wlFilmes[0]) : '';
    const eps = porEp ? selosEpisodios(vistos, dia) : 0;
    const classes = ['ccal-dia'];
    if (vistos.length) classes.push('com-vistos');
    if (vistos.length > 1) classes.push('varios');
    if (wl && !vistos.length) classes.push('com-wl');
    if (temDoMes) classes.push('do-mes');
    if (dia === diaHoje) classes.push('hoje');
    if (dia > diaHoje) classes.push('futuro');
    const src = vistos.length ? srcCapa(vistos[0]) : '';
    celulas += `
      <button class="${classes.join(' ')}" data-c="dia" data-dia="${dia}" aria-label="${esc(`${diaLegivel(dia)}${vistos.length ? (porEp ? `: ${eps ? `${eps} episódio${eps === 1 ? '' : 's'}` : 'assistido'}` : (jogos ? `: ${vistos.length} zerado${vistos.length === 1 ? '' : 's'}` : `: ${vistos.length} visto${vistos.length === 1 ? '' : 's'}`)) : ''}`)}">
        ${src ? `<img src="${esc(src)}" alt="">` : ''}
        ${wlSrc ? `<img class="ccal-wl-capa" src="${esc(wlSrc)}" alt="">` : ''}
        <span class="ccal-num">${d}</span>
        ${porEp && eps ? `<span class="ccal-mais ccal-eps">${eps}ep</span>` : vistos.length > 1 ? `<span class="ccal-mais">${vistos.length}</span>` : ''}
        ${temDoMes ? `<span class="ccal-trofeu">${icone('Trophy')}</span>` : ''}
        ${wl && !vistos.length ? `<span class="ccal-talvez" aria-hidden="true">${wl > 1 ? `+${wl - 1}` : 'talvez'}</span>` : ''}
      </button>`;
  }

  const anterior = mesVizinho(mes, -1);
  const proximo = mesVizinho(mes, 1);
  const linhaDiario = (f, dia) => `
    <button class="ccal-linha" data-c="detalhes" data-id="${f.id}">
      <span class="ccal-capa">${capaCalHTML(f)}</span>
      <span class="ccal-info">
        <strong>${esc(f.titulo)}</strong>
        <small>${esc([episodiosNoDia(f, dia) ? `${episodiosNoDia(f, dia)} ep.` : '', f.ano, jogos ? horasLegiveis(f.tempoZerar) : porEp ? '' : f.diretor].filter(Boolean).join(' · '))}</small>
        ${f.minhaNota ? notaFixaHTML(f.minhaNota) : ''}
      </span>
      ${doMes === f ? `<span class="ccal-linha-trofeu" title="${esc(rotuloDoMes(p))}">${icone('Trophy')}</span>` : temPagina(f) ? `<span class="ccal-linha-pagina" title="Tem página">${icone('NotebookPen')}</span>` : ''}
    </button>`;
  const grupoDiario = ([dia, fs]) => {
    const dt = new Date(`${dia}T12:00:00`);
    const semana = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
    return `
      <div class="ccal-grupo">
        <button class="ccal-grupo-dia" data-c="dia" data-dia="${dia}">
          <b>${dt.getDate()}</b><span>${esc(dia === diaHoje ? 'hoje' : semana)}</span>${icone('ChevronRight')}
        </button>
        ${fs.map((f) => linhaDiario(f, dia)).join('')}
      </div>`;
  };

  return `
    ${barraCalHTML({ voltar: 'fechar', titulo: 'Calendário' })}
    ${seletorEscopoHTML('calendario') ? `<div class="ccal-escopo">${seletorEscopoHTML('calendario')}</div>` : ''}
    <div class="cal-topo ccal-topo">
      <div class="cal-navegacao">
        <h2>${esc(MESES[m - 1])} <span class="cal-ano">${ano}</span></h2>
        <div class="cal-setas">
          <button class="ccal-seta" data-c="mes" data-mes="${anterior}" ${anterior < primeiroMes() ? 'disabled' : ''} aria-label="Mês anterior">${icone('ChevronLeft')}</button>
          <button class="ccal-seta" data-c="mes" data-mes="${proximo}" ${proximo > mesVizinho(mesAtual, 1) ? 'disabled' : ''} aria-label="Próximo mês">${icone('ChevronRight')}</button>
        </div>
      </div>
      <p class="ccal-resumo">
        <span>${noMes ? resumoDoMesHTML(p, contagem) : textoDoTipo(p, 'Nada visto ainda', 'Nada assistido ainda', 'Nada zerado ainda')}</span>
        ${mes !== mesAtual ? `<button class="ccal-hoje-btn" data-c="mes" data-mes="${mesAtual}">Voltar para hoje</button>` : ''}
      </p>
    </div>
    <div class="ccal-semana" aria-hidden="true">${DIAS_SEMANA.map((d) => `<span>${d.slice(0, 1)}</span>`).join('')}</div>
    <div class="cal-grade ccal-grade">${celulas}</div>
    ${doMes
      ? `<button class="ccal-do-mes" data-c="filme-do-mes" data-mes="${mes}">
          <span class="ccal-do-mes-capa">${capaCalHTML(doMes)}</span>
          <span class="ccal-do-mes-texto"><small>${icone('Trophy')} ${esc(rotuloDoMes(p).replace(' do mês', ''))} de ${esc(MESES[m - 1])}</small><strong>${esc(doMes.titulo)}</strong></span>
          ${icone('ChevronRight')}
        </button>`
      : noMes ? `<button class="ccal-do-mes vazio" data-c="filme-do-mes" data-mes="${mes}">
          <span class="ccal-do-mes-icone">${icone('Trophy')}</span>
          <span class="ccal-do-mes-texto"><strong>Escolher ${voc('artigo', undefined, p)} ${esc(rotuloDoMes(p).toLowerCase())}</strong><small>O melhor que você ${textoDoTipo(p, 'viu', 'assistiu', 'zerou')} em ${esc(MESES[m - 1])}</small></span>
          ${icone('ChevronRight')}
        </button>` : ''}
    ${mes === mesAtual ? `
      <section class="ccal-secao">
        <header>
          <h3>${jogos ? 'Quero jogar hoje' : 'Para ver hoje'}</h3>
          <button class="ccal-acao" data-c="dia" data-dia="${diaHoje}">Ver o dia ${icone('ChevronRight')}</button>
        </header>
        <div class="ccal-trilho">
          ${wlHoje.map((f) => `<button class="ccal-wl" data-c="detalhes" data-id="${f.id}" aria-label="${esc(f.titulo)}">${capaCalHTML(f)}</button>`).join('')}
          <button class="ccal-wl ccal-wl-sortear" data-c="sortear-hoje">${icone('Dices')}<span>${voc('sortear', undefined, p)}</span></button>
        </div>
      </section>` : ''}
    <section class="ccal-secao">
      <header><h3>Diário de ${esc(MESES[m - 1])}</h3></header>
      ${diasDoMes.length
        ? `<div class="ccal-diario">${diasDoMes.map(grupoDiario).join('')}</div>`
        : `<p class="ccal-vazio">${porEp ? `Nenhum episódio assistido em ${esc(MESES[m - 1])}.` : jogos ? `Nenhum jogo zerado em ${esc(MESES[m - 1])}.` : `Nenhum filme visto em ${esc(MESES[m - 1])}.`}</p>`}
    </section>`;
};

// ---------- A página do dia ----------

function itemWatchlistCelHTML(f, dia) {
  const ehHoje = dia === hoje();
  const jogo = ehJogo(f);
  const meta = jogo ? [f.ano, horasLegiveis(f.tempoZerar), desenvolvedoresDoJogo(f)[0]].filter(Boolean).join(' · ') : [f.ano, duracaoDe(f), f.diretor].filter(Boolean).join(' · ');
  return `
    <article class="cal-filme cdia-item" data-id="${f.id}">
      <button class="cdia-capa" data-c="detalhes" data-id="${f.id}" aria-label="Detalhes de ${esc(f.titulo)}">${capaCalHTML(f)}</button>
      <div class="cdia-info">
        <strong>${esc(f.titulo)}</strong>
        <small>${esc(meta)}</small>
        <div class="cdia-botoes">
          ${ehHoje ? (jogo
            ? `<button class="cdia-assistir" data-c="detalhes" data-id="${f.id}">${icone('Gamepad2')} Ver o jogo</button>
            <button class="cdia-icone" data-c="vi" data-id="${f.id}" aria-label="Marcar como zerado hoje">${icone('Check')}</button>`
            : `<button class="cdia-assistir" data-c="assistir" data-id="${f.id}">${icone('Play', { preenchido: true })} Assistir</button>
            <button class="cdia-icone" data-c="vi" data-id="${f.id}" aria-label="Marcar como visto hoje">${icone('Check')}</button>`) : ''}
          <button class="cdia-icone" data-c="mover" data-id="${f.id}" data-de="${dia}" data-para="${diaSeguinte(dia)}" aria-label="${ehHoje ? 'Passar para amanhã' : 'Passar para o dia seguinte'}">${icone('Forward')}</button>
          <button class="cdia-icone" data-c="tirar" data-id="${f.id}" data-dia="${dia}" aria-label="Tirar da watchlist">${icone('X')}</button>
        </div>
        ${dia > hoje() ? `<button class="cdia-link" data-c="mover" data-id="${f.id}" data-de="${dia}" data-para="${hoje()}">${icone('Undo2')} Trazer para hoje</button>` : ''}
      </div>
    </article>`;
}

function itemVistoCelHTML(f, dia) {
  const mes = dia.slice(0, 7);
  const pf = plataformaDoItem(f);
  const ehDoMes = itemDoMes(mes, pf)?.id === f.id;
  const eps = episodiosNoDia(f, dia);
  const meta = [eps ? `${eps} episódio${eps === 1 ? '' : 's'}` : '', f.ano, porZerado(pf) ? horasLegiveis(f.tempoZerar) : porEpisodio(pf) ? '' : f.diretor].filter(Boolean).join(' · ');
  const trofeu = `<button class="cdia-trofeu${ehDoMes ? ' on' : ''}" data-c="alternar-filme-do-mes" data-id="${f.id}" data-mes="${mes}" aria-pressed="${ehDoMes}">
      ${icone('Trophy')} ${ehDoMes ? rotuloDoMes(pf) : `${rotuloDoMes(pf)}?`}</button>`;
  const pagina = temPagina(f);
  return `
    <article class="cal-filme cdia-item cdia-visto${pagina ? ' com-pagina' : ''}${ehDoMes ? ' do-mes' : ''}" data-id="${f.id}">
      <button class="cdia-capa" data-c="detalhes" data-id="${f.id}" aria-label="Detalhes de ${esc(f.titulo)}">${capaCalHTML(f)}</button>
      <div class="cdia-info">
        <strong>${esc(f.titulo)}</strong>
        <small>${esc(meta)}</small>
        ${f.minhaNota ? notaFixaHTML(f.minhaNota) : ''}
      </div>
      ${pagina
        ? `<button class="cdia-citacao" data-c="pagina" data-id="${f.id}">
            <span class="cdia-citacao-texto">“${esc(trechoDaPagina(f.pagina, 200))}”</span>
            <span class="cdia-citacao-rodape">${icone('BookOpen')} Ler página · ${esc(leituraDaPagina(f.pagina))}</span>
          </button>`
        : ''}
      <div class="cdia-rodape">
        ${trofeu}
        ${pagina ? '' : `<button class="cdia-escrever" data-c="pagina" data-id="${f.id}">${icone('PenLine')} ${vocTextoDe(f, 'Escrever sobre {artigo} {item}')}</button>`}
      </div>
    </article>`;
}

// eslint-disable-next-line no-func-assign
paginaDiaHTML = function paginaDiaHTMLCelular(dia) {
  const p = escopoCal();
  const porEp = porEpisodio(p);
  const jogos = porZerado(p);
  const vistos = vistosPorDia(p).get(dia) || [];
  const ehHoje = dia === hoje();
  const futuro = dia > hoje();
  const watchlist = idsWatchlist(dia, p).map(porId).filter(Boolean);
  const dt = new Date(`${dia}T12:00:00`);
  const semana = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
  const nomeSemana = semana.charAt(0).toUpperCase() + semana.slice(1);
  const destaque = vistos.find(temPagina) || vistos[0] || watchlist[0];
  const ordenados = [...vistos.filter(temPagina), ...vistos.filter((f) => !temPagina(f))];
  const contagem = (n) => (n ? `<span class="cdia-n">${n}</span>` : '');
  return `
    ${barraCalHTML({ voltar: 'voltar', titulo: MESES[dt.getMonth()].replace(/^./, (c) => c.toUpperCase()) })}
    <div class="cdia-topo${destaque ? ' com-fundo' : ''}">
      ${destaque ? `<div class="cal-dia-fundo cdia-fundo" style="${esc(fundoCapa(destaque))}" aria-hidden="true"></div>` : ''}
      <div class="cal-dia-titulo cdia-titulo">
        <b>${dt.getDate()}</b>
        <span>${esc(nomeSemana)}${ehHoje ? ' <em>hoje</em>' : ''}<small>${esc(MESES[dt.getMonth()])} de ${dt.getFullYear()}</small></span>
      </div>
    </div>
    ${ehHoje || futuro ? `
      <section class="cal-secao cdia-secao" data-secao="watchlist">
        <header><h3>${jogos ? (ehHoje ? 'Quero jogar hoje' : 'Quero jogar neste dia') : ehHoje ? 'Para ver hoje' : 'Para ver neste dia'} ${contagem(watchlist.length)}</h3></header>
        ${ehHoje ? `<div class="cdia-pilulas">
            <button class="cel-pilula" data-c="sortear-hoje">${icone('Dices')} ${voc('sortear', undefined, p)}</button>
            <button class="cel-pilula" data-c="sortear-hoje-filtro">${icone('SlidersHorizontal')} Com filtro</button>
          </div>` : ''}
        ${watchlist.length
          ? `<div class="cdia-lista">${watchlist.map((f) => itemWatchlistCelHTML(f, dia)).join('')}</div>`
          : `<p class="ccal-vazio">${ehHoje
            ? `Nada separado ainda. Sorteie ${voc('um', undefined, p)} ou toque em ${icone('CalendarClock')} nos detalhes ${voc('de', undefined, p)}. A lista vira junto com o dia, às 5h.`
            : `${voc('Nenhum', undefined, p)} planejado para este dia.`}</p>`}
      </section>` : ''}
    ${futuro ? '' : `
      <section class="cal-secao cdia-secao">
        <header><h3>${jogos ? (ehHoje ? 'Zerados hoje' : 'Zerados neste dia') : porEp ? (ehHoje ? 'Assistidos hoje' : 'Assistidos neste dia') : (ehHoje ? 'Vistos hoje' : 'Vistos neste dia')} ${contagem(vistos.length)}</h3></header>
        ${vistos.length
          ? `<div class="cdia-lista">${ordenados.map((f) => itemVistoCelHTML(f, dia)).join('')}</div>`
          : `<p class="ccal-vazio">${jogos ? (ehHoje ? 'Nenhum jogo zerado hoje ainda.' : 'Nenhum jogo zerado neste dia.') : porEp ? (ehHoje ? 'Nenhum episódio assistido hoje ainda.' : 'Nenhum episódio assistido neste dia.') : (ehHoje ? 'Nada visto hoje ainda.' : 'Nada visto neste dia.')}</p>`}
      </section>`}`;
};

// Deslizar o dedo de lado na grade troca o mês, como nas setas.
(() => {
  let x0 = null;
  let y0 = null;
  const caixa = document.getElementById('calendario-caixa');
  caixa.addEventListener('touchstart', (e) => {
    const grade = e.target.closest('.ccal-grade');
    if (!grade || e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  caixa.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const seta = caixa.querySelectorAll('.ccal-seta')[dx < 0 ? 1 : 0];
    if (seta && !seta.disabled) seta.click();
  }, { passive: true });
})();
