'use strict';

// ---------- Estatísticas do nandplay (jogos) ----------
//
// Carregado depois de app.js e jogos-lista.js. O que conta num jogo é o dia em que zerou
// (zeradoEm): a conta do período é "zerados naquele período". "Tudo" também conta os zerados
// sem data. Status e tags olham a lista inteira. Com a chave e o perfil da Steam, as horas
// jogadas vêm de api.steamBiblioteca (minutos de sempre, não por período); sem chave, o resto
// continua igual e o cartão de horas não aparece.

const jogoZerado = (f) => Boolean(f.visto) || f.status === 'zerado' || f.status === 'cem';

// Minutos jogados na Steam por appid (um Map), ou null sem biblioteca.
function minutosSteamPorAppid() {
  const bib = typeof steamDaLista !== 'undefined' ? steamDaLista.biblioteca : null;
  if (!bib || !Array.isArray(bib.jogos)) return null;
  return new Map(bib.jogos.map((j) => [Number(j.appid), Number(j.minutos) || 0]));
}

function dadosDoPeriodoJogos(periodo, p, { minutosSteam = minutosSteamPorAppid() } = {}) {
  const noPeriodo = (d) => periodo === 'tudo' || String(d || '').startsWith(periodo);
  const todos = itensDaPlataforma(estado.filmes, p).filter(ehJogo);
  const lista = todos.filter((f) => jogoZerado(f) && (periodo === 'tudo' || noPeriodo(f.zeradoEm)));
  const sessoes = lista.filter((f) => f.zeradoEm).map((f) => ({ f, dia: f.zeradoEm }));
  const dias = [...new Set(sessoes.map((s) => s.dia))].sort();
  let sequencia = 0;
  let atual = 0;
  dias.forEach((d, i) => {
    atual = i && diaSeguinte(dias[i - 1]) === d ? atual + 1 : 1;
    sequencia = Math.max(sequencia, atual);
  });
  // Horas para zerar (IGDB) somadas: só dos que têm o tempo.
  const comTempo = lista.filter((f) => Number(f.tempoZerar) > 0);
  const horasZerar = comTempo.reduce((t, f) => t + Number(f.tempoZerar), 0);
  const comNota = lista.filter((f) => f.minhaNota);
  const media = comNota.length ? comNota.reduce((t, f) => t + f.minhaNota, 0) / comNota.length : 0;
  const cem = lista.filter((f) => f.status === 'cem');
  // Horas jogadas na Steam: os zerados do período (em "Tudo", a lista inteira que está na biblioteca).
  const baseHoras = periodo === 'tudo' ? todos : lista;
  const maisJogados = minutosSteam
    ? baseHoras.map((f) => [f, minutosSteam.get(Number(f.steam)) || 0]).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1] || a[0].titulo.localeCompare(b[0].titulo, 'pt')).slice(0, 8)
    : [];
  const minutosJogados = minutosSteam ? baseHoras.reduce((t, f) => t + (minutosSteam.get(Number(f.steam)) || 0), 0) : 0;
  return { p, todos, lista, itens: lista, sessoes, dias, sequencia, horasZerar, comTempo, comNota, media, cem, maisJogados, minutosJogados, temSteam: Boolean(minutosSteam) };
}

// "12 h" / "45 min" para minutos jogados.
const minutosLegiveis = (m) => (m >= 60 ? `${Math.round(m / 60).toLocaleString('pt-BR')} h` : `${Math.round(m)} min`);

function renderEstatisticasJogos(p) {
  const caixa = $('#retrospectiva-caixa');
  const anos = anosComFilmes(p);
  const periodo = periodoEst;
  const d = dadosDoPeriodoJogos(periodo, p);
  const numero = (n) => n.toLocaleString('pt-BR');
  const plural = (n, um, varios) => (n === 1 ? um : varios);
  const nomeMes = (m) => MESES[m].slice(0, 3);
  const doMesSo = periodo.length === 7;

  // Zerados por mês (do ano); em "Tudo", por ano quando há mais de um, senão por mês; num mês só, por dia.
  let colunas;
  if (doMesSo) {
    colunas = Array.from({ length: new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0).getDate() }, (_, i) => {
      const dia = `${periodo}-${String(i + 1).padStart(2, '0')}`;
      return { rotulo: String(i + 1), rotuloLongo: diaLegivel(dia), valor: d.sessoes.filter((s) => s.dia === dia).length, atual: dia === hoje() };
    });
  } else if (periodo === 'tudo' && anos.length > 1) {
    colunas = anos.map((a) => ({ rotulo: a, rotuloLongo: a, valor: d.sessoes.filter((s) => s.dia.startsWith(a)).length, atual: a === hoje().slice(0, 4) }));
  } else {
    const ano = periodo === 'tudo' ? (anos[0] || hoje().slice(0, 4)) : periodo;
    colunas = Array.from({ length: 12 }, (_, i) => {
      const m = `${ano}-${String(i + 1).padStart(2, '0')}`;
      return { rotulo: nomeMes(i), rotuloLongo: mesLegivel(m), valor: d.sessoes.filter((s) => s.dia.startsWith(m)).length, atual: m === hoje().slice(0, 7) };
    });
  }
  const tituloColunas = doMesSo ? 'Zerados por dia' : periodo === 'tudo' && anos.length > 1 ? 'Zerados por ano' : 'Zerados por mês';
  const dicaZerado = (n) => `${n} jogo${n === 1 ? '' : 's'} zerado${n === 1 ? '' : 's'}`;

  const statusLista = STATUS_DO_JOGO.map((s) => [s.rotulo, d.todos.filter((f) => statusDoJogo(f) === s.id).length]).filter(([, n]) => n);
  const notas = Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((n) => ({
    rotulo: notaLegivel(n), rotuloLongo: `${notaLegivel(n)} estrela${n === 1 ? '' : 's'}`, valor: d.comNota.filter((f) => f.minhaNota === n).length,
  }));
  const melhores = [...d.comNota].sort((a, b) => b.minhaNota - a.minhaNota || a.titulo.localeCompare(b.titulo)).slice(0, 8);
  const doMes = Object.entries(estado.config[chaveDoMes(p)] || {})
    .filter(([m]) => periodo === 'tudo' || m.startsWith(periodo))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m]) => ({ m, f: itemDoMes(m, p) })).filter((x) => x.f);
  const devTop = ranking(d.lista.flatMap((f) => [...new Set(desenvolvedoresDoJogo(f))]), 1)[0];

  // O número grande: jogos zerados; a frase diz o período e quanto tempo levam para zerar.
  const quando = periodo === 'tudo' ? 'até agora' : `em ${esc(nomePeriodo(periodo))}`;
  const horas = Math.round(d.horasZerar);
  const capas = [...d.lista].sort((a, b) => String(b.zeradoEm || '').localeCompare(String(a.zeradoEm || '')) || (b.minhaNota || 0) - (a.minhaNota || 0));
  const tags = ranking(d.todos.flatMap((f) => tagsDoJogo(f)), 10);
  caixa.innerHTML = topoEstatisticasHTML(p, periodo, anos) + estDestaqueHTML({
    numero: numero(d.lista.length),
    frase: `jogo${plural(d.lista.length, '', 's')} zerado${plural(d.lista.length, '', 's')} ${quando}.${horas ? ` Cerca de ${numero(horas)} hora${plural(horas, '', 's')} para zerar ${d.lista.length === 1 ? 'ele' : 'todos'}.` : ''}`,
    story: d.lista.length && (p.recursos || []).includes('retrospectiva'),
    capas,
  }) + estFatosHTML([
    [horas ? `${numero(horas)} h` : '', d.comTempo.length < d.lista.length ? `para zerar, de ${d.comTempo.length} com o tempo` : 'para zerar, somando cada um'],
    d.temSteam
      ? [d.minutosJogados ? minutosLegiveis(d.minutosJogados) : '', periodo === 'tudo' ? 'na Steam, de todos os jogos da lista' : 'na Steam, dos zerados do período']
      : [numero(d.todos.length), `jogo${plural(d.todos.length, '', 's')} na lista, ${numero(d.todos.filter((f) => statusDoJogo(f) === 'jogando').length)} jogando`],
    [d.media ? notaLegivel(Math.round(d.media * 10) / 10) : '', `de nota média, ${d.comNota.length} com nota`],
    [numero(d.cem.length), 'em 100%'],
    [devTop ? esc(devTop[0]) : '', 'o desenvolvedor que mais apareceu'],
  ]) + `
    <div class="est-grade">
      <section class="est-cartao est-largo">
        <h3>${tituloColunas}</h3>
        ${d.sessoes.length ? colunasHTML(colunas, dicaZerado) : '<p class="est-vazio">Os dias começam a contar quando você marca um jogo como zerado (ou muda o dia nos detalhes do jogo).</p>'}
      </section>
      <section class="est-cartao"><h3>Sua lista por status</h3>${barrasHTML(statusLista)}</section>
      <section class="est-cartao"><h3>Consoles</h3>${barrasHTML(ranking(d.lista.flatMap((f) => [...new Set(consolesDoJogo(f))])), { clicar: 'console' })}</section>
      <section class="est-cartao"><h3>Gêneros</h3>${barrasHTML(ranking(d.lista.flatMap((f) => f.generos || [])))}</section>
      <section class="est-cartao"><h3>Desenvolvedores</h3>${barrasHTML(ranking(d.lista.flatMap((f) => [...new Set(desenvolvedoresDoJogo(f))])))}</section>
      <section class="est-cartao"><h3>Tags mais usadas</h3>${tags.length ? barrasHTML(tags, { clicar: 'tag-jogo' }) : '<p class="est-vazio">Você ainda não criou tags nos jogos.</p>'}</section>
      <section class="est-cartao est-largo">
        <h3>Suas notas</h3>
        ${d.comNota.length ? colunasHTML(notas, (n) => `${n} jogo${n === 1 ? '' : 's'}`) : '<p class="est-vazio">Dê notas de ½ a 5 estrelas nos detalhes de cada jogo.</p>'}
      </section>
      ${melhores.length ? `<section class="est-cartao est-largo"><h3>Suas maiores notas</h3>${capasEstHTML(melhores, (f) => `${icone('Star', { preenchido: true })}${notaLegivel(f.minhaNota)}`)}</section>` : ''}
      ${d.maisJogados.length ? `<section class="est-cartao est-largo"><h3>Mais horas jogadas${periodo === 'tudo' ? '' : ' (dos zerados do período)'}</h3>${capasEstHTML(d.maisJogados.map(([f]) => f), (f) => minutosLegiveis(d.maisJogados.find(([x]) => x === f)[1]))}</section>` : ''}
      ${doMes.length ? `<section class="est-cartao est-largo"><h3>${icone('Trophy')} ${esc(rotuloDoMes(p))}</h3>${capasEstHTML(doMes.map((x) => x.f), (f) => esc(mesLegivel(doMes.find((x) => x.f === f).m)))}</section>` : ''}
    </div>
    <p class="est-nota-rodape">Tempo para zerar = o tempo médio da IGDB de cada jogo zerado. ${d.temSteam ? 'Horas na Steam = o total jogado de sempre, da sua biblioteca.' : 'Com a chave e o perfil da Steam (Configurações), as horas jogadas aparecem aqui.'} Zerados sem data só entram em “Tudo”.</p>`;
  Movimento.sequencia($$('#retrospectiva .est-destaque, #retrospectiva .est-fatos, #retrospectiva .est-cartao'), { y: 10, duracao: 380, passo: 30, atrasoInicial: 60 });
  // A biblioteca da Steam chega depois (pedida uma vez): redesenha se ainda não estava.
  if (!d.temSteam && typeof carregarSteamDaLista === 'function' && !estatisticasPediramSteam) {
    estatisticasPediramSteam = true;
    carregarSteamDaLista().then(() => { if (!estatisticas.hidden && porZerado(escopoEst()) && minutosSteamPorAppid()) renderEstatisticas(); });
  }
}
let estatisticasPediramSteam = false;

// Clicar num console ou numa tag das estatísticas filtra a lista do nandplay por ele.
function filtrarJogosPor(campo, valor) {
  fecharEstatisticas();
  if (plataformaAtual().hub) { /* o hub também mostra os jogos: o filtro de jogo vale lá */ }
  estado[campo] = valor;
  aplicarFiltroDaBarra();
}
