'use strict';

// ---------- Prêmios: o palco (o desenho do PC) ----------
//
// Uma caixa grande nas cores da premiação, uma categoria por vez: o nome dela bem grande e os
// indicados lado a lado, com Palpite e Joguei (jogos) ou Vi (filmes) embaixo de cada pôster.
// As categorias ficam numa gaveta que abre embaixo do botão "Categorias", por cima dos indicados.
// Vale para os prêmios de jogos (The Game Awards, BAFTA Games) e de filmes (Oscar, Globo de Ouro,
// Cannes…). Os dados, as cédulas e os cliques continuam em premios.js; aqui é só o desenho.
// O celular fica com o desenho dele (premiosNoCelular → o renderPremios de premios.js).

// O símbolo do The Game Awards (a estatueta de frente), do site oficial.
const SIMBOLO_TGA_PREMIOS = '<svg class="pp-simbolo" viewBox="0 0 44 40" aria-hidden="true" focusable="false"><path d="M29.3333 28.6667L37 21L39 14.3333L29.3333 24V28.6667Z"/><path d="M2 6.66667L19.3333 24V28.6667L21.6667 26.3333L24.3333 29V33.6667L26.6667 31.3333L31.5133 36.18L32.8333 32.8333L0 0L2 6.66667Z"/><path d="M6.33334 21L14.3333 29L10.5 32.8333L11.82 36.18L16.6667 31.3333L19.3333 34L13.3333 40H18L21.6667 36.3333L25.3333 40H30L4.33334 14.3333L6.33334 21Z"/><path d="M24.3333 19V23.6667L41.3333 6.66667L43.3333 0L24.3333 19Z"/></svg>';

// O nome de cada premiação na aba. Só o TGA tem símbolo (o oficial); o Oscar e o BAFTA vão só
// com o nome, em letra: a estatueta e a máscara são marcas registradas e não são imitadas aqui.
function marcaPremioHTML(id) {
  if (id === 'tga') return `${SIMBOLO_TGA_PREMIOS}<span>The Game Awards</span>`;
  if (id === 'baftajogos') return '<span class="pp-sigla">BAFTA</span><span>Games</span>';
  if (id === 'bafta') return '<span class="pp-sigla">BAFTA</span>';
  if (id === 'oscar') return '<span class="pp-oscar">Oscar</span>';
  return `<span>${esc(NOMES_PREMIOS[id] || id)}</span>`;
}
// Na faixa do vencedor: o símbolo do TGA antes do "Venceu"; no Oscar e no BAFTA, o nome no canto.
function faixaVenceuHTML(id) {
  if (id === 'tga') return `${SIMBOLO_TGA_PREMIOS}<span>Venceu</span>`;
  const marca = id === 'oscar' ? '<span class="pp-oscar pp-faixa-marca">Oscar</span>' : (id === 'bafta' || id === 'baftajogos') ? '<span class="pp-sigla pp-faixa-marca">BAFTA</span>' : '';
  return `<span>Venceu</span>${marca}`;
}

// Quantas colunas cabem bem: até 10 indicados (Melhor Filme no Oscar), uma fileira só, todos à vista;
// até 18, duas; os festivais (a competição inteira, 20 e tantos filmes) ganham mais fileiras e o palco rola.
function gradePalco(n) {
  const linhas = n <= 10 ? 1 : Math.max(2, Math.ceil(n / 9));
  return { linhas, colunas: Math.max(1, Math.ceil(n / linhas)) };
}

// "Na sua lista, quero jogar" (jogo: o status) ou "Na sua lista, na watchlist de hoje" (filme).
function naListaPalco(premio, f) {
  if (!f) return '';
  if (premioEhDeJogo(premio)) {
    const r = ROTULOS_STATUS_PREMIOS[f.status];
    return `Na sua lista${r ? `, ${r.toLocaleLowerCase('pt-BR')}` : ''}`;
  }
  if (f.visto) return 'Na sua lista';
  return naWatchlist(f.id) ? 'Na sua lista, na watchlist de hoje' : 'Na sua lista, para ver';
}

function indicadoPalcoHTML({ x, i, f }, k, premio, palpite) {
  const jogo = premioEhDeJogo(premio);
  const ids = idsDoIndicado(premio, x);
  const eu = palpite === chaveIndicado(x);
  const feito = itemFeito(premio, f);
  const semTitulo = !x.titulo; // pessoa ou time: o nome no lugar do título, a inicial no lugar da capa
  const nome = semTitulo ? x.pessoa : (f ? f.titulo : x.titulo);
  const linhas = [];
  if (jogo) {
    const { desenvolvedor, credito } = semTitulo ? { desenvolvedor: '', credito: x.extra || '' } : desenvolvedorDoIndicado(x, f, k.chave);
    if (desenvolvedor) linhas.push(desenvolvedor);
    if (credito) linhas.push(credito);
  } else if (semTitulo && x.extra) linhas.push(x.extra);
  if (!semTitulo && x.pessoa && x.pessoa !== x.titulo) linhas.push(x.pessoa);
  const faixa = x.venceu ? `<span class="pp-faixa" title="Vencedor">${faixaVenceuHTML(premio)}</span>` : '';
  const capa = semTitulo
    ? `<div class="pp-capa pp-inicial"><span aria-hidden="true">${esc(inicialDe(x.pessoa))}</span>${faixa}</div>`
    : `<button class="pp-capa" data-pr="abrir" title="Ver os detalhes de ${esc(x.titulo)}">${capaIndicadoHTML(f, ids, nome, jogo, jogo ? x.titulo : '', 'medium')}${faixa}</button>`;
  const lista = naListaPalco(premio, f);
  const botaoFeito = semTitulo || k.naoLancado ? '' : (jogo
    ? `<button class="pp-b pp-feito${feito ? ' on' : ''}" data-pr="joguei" aria-pressed="${feito}" title="${feito ? 'Você já jogou (clique para desmarcar)' : f ? 'Marcar como jogado' : 'Adicionar à sua lista como jogado'}">${icone('Check')}<span>Joguei</span></button>`
    : `<button class="pp-b pp-feito${feito ? ' on' : ''}" data-pr="visto" aria-pressed="${feito}" title="${feito ? 'Você já viu (clique para desmarcar)' : f ? 'Marcar como visto' : 'Adicionar à sua lista como visto'}">${icone('Check')}<span>Vi</span></button>`);
  return `<li class="pp-ind${x.venceu ? ' venceu' : ''}${eu ? ' palpite' : ''}${feito ? ' feito' : ''}${semTitulo ? ' sem-item' : ''}" data-i="${i}">
      ${capa}
      <h4 title="${esc(nome)}">${esc(nome)}</h4>
      ${linhas.map((t) => `<span class="pp-sub" title="${esc(t)}">${esc(t)}</span>`).join('')}
      ${lista ? `<span class="pp-na-lista">${esc(lista)}</span>` : ''}
      <div class="pp-botoes">
        <button class="pp-b pp-palpite${eu ? ' on' : ''}" data-pr="palpite" aria-pressed="${eu}" title="${eu ? 'Tirar o palpite' : 'Acho que este vence'}">${icone('Mail')}<span>Palpite</span></button>
        ${botaoFeito}
      </div>
    </li>`;
}

// A gaveta abre logo abaixo do botão, alinhada a ele: o mouse continua em cima do botão para fechar.
function gavetaPremios(abrir) {
  const caixa = $('#premios-caixa');
  const botao = $('.pp-abrir-cats', caixa);
  vista.menu = Boolean(abrir) && Boolean(botao) && !botao.disabled;
  caixa.classList.toggle('pp-cats-abertas', vista.menu);
  if (!botao) return;
  botao.setAttribute('aria-expanded', String(vista.menu));
  if (!vista.menu) return;
  const b = botao.getBoundingClientRect();
  const c = caixa.getBoundingClientRect();
  caixa.style.setProperty('--pp-gx', `${Math.round(b.left - c.left)}px`);
  caixa.style.setProperty('--pp-gy', `${Math.round(b.bottom - c.top + 8)}px`);
  $('.pp-gaveta li.ativo', caixa)?.scrollIntoView({ block: 'nearest' });
}

function renderPremiosPalco() {
  const caixa = $('#premios-caixa');
  const premio = vista.premio;
  const d = premiosDados[premio];
  if (!d) return;
  // A edição escolhida sumiu (ou ainda não havia dados ao abrir): a padrão.
  if (!d.cerimonias.some((x) => x.numero === vista.numero)) vista.numero = cerimoniaPadrao(premio);
  const c = d.cerimonias.find((x) => x.numero === vista.numero);
  const info = infoPremio(premio);
  const jogo = premioEhDeJogo(premio);
  const v = vocPremio(premio); // filmes: "viu" / "ver"; jogos: "jogou" / "jogar"
  // "98º Oscar 2026", ou "Cannes 2025" quando a edição é o próprio ano.
  const nomeEdicao = (x) => (x.numero === x.ano ? `${d.nome} ${x.ano}` : `${x.numero}º ${d.nome} ${x.ano}`);
  const visiveis = premiosVisiveis();
  const lista = visiveis.includes(premio) ? visiveis : [premio, ...visiveis];
  const muitos = lista.length > 3; // os de filme são dez: os anos descem para uma linha própria

  const premiacoes = lista.map((p) => `<button class="pp-premiacao${p === premio ? ' ativo' : ''}" data-pr="premio" data-premio="${p}" role="radio" aria-checked="${p === premio}">${marcaPremioHTML(p)}</button>`).join('');
  const anos = `<div class="pp-anos" role="tablist" aria-label="Edições">${d.cerimonias.map((x) => `<button class="pp-ano${x.numero === vista.numero ? ' ativo' : ''}${x.indicados ? '' : ' breve'}" data-pr="cerimonia" data-numero="${x.numero}" role="tab" aria-selected="${x.numero === vista.numero}" title="${x.indicados ? esc(nomeEdicao(x)) : (info.festival ? 'Competição ainda não anunciada' : 'Indicados ainda não anunciados')}">${x.ano}</button>`).join('')}</div>`;

  let palco = '';
  let gaveta = '';
  let rodape = '';
  let nCats = '';
  let chaveCat = '';
  if (!c) {
    palco = `<div class="pp-aviso"><p>Ainda não há edições aqui. ${esc(info.quando)}.</p></div>`;
  } else if (!c.indicados) {
    palco = `<div class="pp-aviso">
        <h3>${esc(nomeEdicao(c))}</h3>
        <p>${info.festival ? 'Os filmes da competição ainda não foram anunciados.' : 'Os indicados ainda não foram anunciados.'} ${esc(info.quando)}, e aparecem aqui sozinhos.</p>
        <button class="pp-b pp-procurar" data-pr="atualizar">${icone('RefreshCw')}<span>Procurar agora</span></button>
      </div>`;
  } else {
    const ced = cedula(premio, c.numero);
    const ks = c.categorias;
    const iCat = indiceCategoriaAberta(c);
    const k = ks[iCat];
    if (k) {
      vista.cat = k.chave;
      chaveCat = k.chave;
      const palpite = ced.palpites[k.chave];
      const todos = k.indicados.map((x, j) => ({ x, i: j, f: filmeDoIndicado(premio, x, c) }));
      // "Só o que falta": sem pessoas, times e jogos que ainda não saíram, e sem o que você já viu/jogou.
      const falta = ({ x, f }, cat) => Boolean(x.titulo) && !cat.naoLancado && !itemFeito(premio, f);
      const itens = todos.filter((it) => !vista.soFalta || falta(it, k));
      const nomesRepetidos = new Set(ks.map((o) => o.nome).filter((n, j, l) => l.indexOf(n) !== j));

      // A conta: cada filme/jogo uma vez (pessoas, times e jogos ainda não lançados não contam).
      const unicos = (pares) => { const m = new Map(); for (const { x, f } of pares) { const ch = x.wiki || normalizar(x.titulo); if (!m.has(ch)) m.set(ch, f); } return [...m.values()]; };
      const daCat = k.naoLancado ? [] : unicos(todos.filter(({ x }) => x.titulo));
      const doAno = unicos(ks.filter((o) => !o.naoLancado).flatMap((o) => o.indicados.filter((x) => x.titulo).map((x) => ({ x, f: filmeDoIndicado(premio, x, c) }))));
      const feitos = (l) => l.filter((f) => itemFeito(premio, f)).length;
      const palpitados = ks.filter((o) => ced.palpites[o.chave]).length;
      const acertou = (o) => o.indicados.some((x) => x.venceu && chaveIndicado(x) === ced.palpites[o.chave]);
      const acertos = c.vencedores ? ks.filter(acertou).length : 0;

      const { linhas, colunas } = gradePalco(itens.length);
      palco = `<div class="pp-centro">
          <div class="pp-categoria">
            ${jogo ? '' : `<p class="pp-edicao">${esc(nomeEdicao(c))}</p>`}
            <h3${k.nome.length > 30 ? ' class="longo"' : ''}>${esc(k.nome)}</h3>
            ${nomesRepetidos.has(k.nome) ? `<p class="pp-original">${esc(k.original)}</p>` : ''}
          </div>
          ${itens.length
    ? `<ol class="pp-indicados" style="--pp-cols:${colunas}">${itens.map((it) => indicadoPalcoHTML(it, k, premio, palpite)).join('')}</ol>`
    : `<p class="pp-vazio">Você já ${v.viu} todos os indicados desta categoria.</p>`}
        </div>`;
      caixa.dataset.linhas = String(Math.min(linhas, 3));

      gaveta = ks.map((o, j) => {
        const p = ced.palpites[o.chave];
        const marca = !p ? '' : c.vencedores
          ? (acertou(o) ? `<span class="pp-marca acertou" title="Palpite certo">${icone('Check')}</span>` : `<span class="pp-marca errou" title="Palpite errado">${icone('X')}</span>`)
          : `<span class="pp-marca feito" title="Palpite feito">${icone('Mail')}</span>`;
        const nadaFalta = vista.soFalta && !o.indicados.some((x) => falta({ x, f: filmeDoIndicado(premio, x, c) }, o));
        return `<li class="${j === iCat ? 'ativo' : ''}${nadaFalta ? ' completa' : ''}"><button data-pr="cat-ir" data-chave="${esc(o.chave)}"${j === iCat ? ' aria-current="true"' : ''}>
            <span class="pp-num">${j + 1}</span><span class="pp-cat-nome">${esc(o.nome)}${nomesRepetidos.has(o.nome) ? ` <small>${esc(o.original)}</small>` : ''}</span>${marca}</button></li>`;
      }).join('');
      nCats = `${iCat + 1} de ${ks.length}`;

      const noAno = info.festival ? 'na competição' : 'no ano';
      const conta = daCat.length && !info.festival
        ? `Você ${v.viu} <b>${feitos(daCat)}</b> de ${daCat.length} nesta categoria, <b>${feitos(doAno)}</b> de ${doAno.length} ${noAno}`
        : `Você ${v.viu} <b>${feitos(doAno)}</b> de ${doAno.length} ${noAno}`;
      rodape = `<span class="pp-conta">${conta}</span>
        <button class="pp-so-falta${vista.soFalta ? ' ativo' : ''}" data-pr="so-falta" aria-pressed="${vista.soFalta}">${icone('Eye')}<span>Só o que falta ${v.ver}</span></button>
        <div class="pp-palpites">
          <span><b>${palpitados}</b> ${palpitados === 1 ? 'palpite' : 'palpites'}</span>
          ${c.vencedores && palpitados ? `<span><b>${acertos}</b> ${acertos === 1 ? 'acerto' : 'acertos'}</span>` : ''}
          ${palpitados ? `<button class="pp-limpar" data-pr="limpar-palpites" title="Limpar os palpites desta edição" aria-label="Limpar os palpites desta edição">${icone('Eraser')}</button>` : ''}
        </div>`;
    }
  }

  // Ao redesenhar a mesma categoria (Palpite, Joguei), nada pula nem anima de novo.
  const chaveVista = `${premio}|${vista.numero}|${chaveCat}`;
  const mesma = caixa.dataset.vista === chaveVista;
  const rolagens = ['.pp-anos', '.pp-premiacoes', '.pp-gaveta ol', '.pp-palco'].map((s) => { const el = $(s, caixa); return el ? [el.scrollLeft, el.scrollTop] : [0, 0]; });
  const tinhaPalco = caixa.classList.contains('pp');

  caixa.classList.add('pp');
  caixa.classList.remove('pr-larga');
  caixa.classList.toggle('pp-muitos', muitos);
  caixa.dataset.premio = premio;
  caixa.dataset.tipo = jogo ? 'jogo' : 'filme';
  if (!rodape) delete caixa.dataset.linhas;
  caixa.innerHTML = `
    <div class="pp-topo">
      <h2>Prêmios</h2>
      <button class="pp-abrir-cats" data-pr="cat-menu" aria-expanded="false" aria-controls="pp-gaveta"${gaveta ? '' : ' disabled'}>${icone('Mail')}<span>Categorias</span>${nCats ? `<small>${nCats}</small>` : ''}</button>
      <div class="pp-premiacoes" role="radiogroup" aria-label="Premiação">${premiacoes}</div>
      ${muitos ? '' : anos}
      <button class="pp-fechar" data-pr="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('X')}</button>
    </div>
    ${muitos ? anos : ''}
    <section class="pp-palco${mesma ? '' : ' pp-troca'}" data-chave="${esc(chaveCat)}">${palco}</section>
    <div class="pp-rodape">${rodape}</div>
    <div class="pp-sombra-gaveta"></div>
    <nav class="pp-gaveta" id="pp-gaveta" aria-label="Categorias"><ol>${gaveta}</ol></nav>`;
  caixa.dataset.vista = chaveVista;

  // As fileiras que rolam de lado voltam para onde estavam; o prêmio e o ano escolhidos ficam à vista.
  ['.pp-anos', '.pp-premiacoes', '.pp-gaveta ol', '.pp-palco'].forEach((s, j) => {
    const el = $(s, caixa);
    if (!el || !tinhaPalco) return;
    if (j < 2) el.scrollLeft = rolagens[j][0];
    else if (mesma || j === 2) el.scrollTop = rolagens[j][1];
  });
  $('.pp-premiacao.ativo', caixa)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('.pp-ano.ativo', caixa)?.scrollIntoView({ block: 'nearest', inline: tinhaPalco ? 'nearest' : 'center' });
  // A gaveta acompanha o estado: fechada depois de escolher, aberta se o desenho veio com ela aberta.
  gavetaPremios(vista.menu);
}

// No PC, o palco; no celular, o desenho de antes. Jogos: depois de cada desenho, as capas que faltam vêm da IGDB.
const renderPremiosLista = renderPremios;
renderPremios = () => {
  if (premiosNoCelular()) { renderPremiosLista(); return; }
  renderPremiosPalco();
  if (premioEhDeJogo(vista.premio)) completarCapasJogosPremios();
};
