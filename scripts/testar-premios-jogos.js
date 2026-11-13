// node scripts/testar-premios-jogos.js: confere o leitor dos prêmios de jogos (The Game Awards e
// BAFTA Games) sem internet, com trechos gravados de páginas da Wikipédia (scripts/fixtures-premios-jogos).
const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const premios = require('../lib/premios');

const trecho = (nome) => fs.readFileSync(path.join(__dirname, 'fixtures-premios-jogos', nome), 'utf8');
const tga = premios.lerPagina(premios.PREMIOS.tga, trecho('tga-trecho.txt'));
const bafta = premios.lerPagina(premios.PREMIOS.baftajogos, trecho('bafta-trecho.txt'));
const por = (cats, chave) => cats.find((k) => k.chave === chave);
const vencedores = (k) => k.indicados.filter((x) => x.venceu);

test('registro: os prêmios de jogos são de jogos e os de cinema continuam de filme', () => {
  assert.strictEqual(premios.PREMIOS.tga.tipo, 'jogo');
  assert.strictEqual(premios.PREMIOS.baftajogos.tipo, 'jogo');
  assert.strictEqual(premios.PREMIOS.oscar.tipo, 'filme');
  assert.strictEqual(premios.PREMIOS.bafta.tipo, 'filme');
  const lista = premios.listaPremios();
  assert.strictEqual(lista.find((p) => p.id === 'baftajogos').nome, 'BAFTA Games');
  assert.strictEqual(lista.find((p) => p.id === 'tga').tipo, 'jogo');
  assert.strictEqual(lista.find((p) => p.id === 'oscar').tipo, 'filme');
});

test('páginas: nomes e anos das edições', () => {
  assert.strictEqual(premios.PREMIOS.tga.pagina(2024), 'The Game Awards 2024');
  assert.strictEqual(premios.PREMIOS.baftajogos.pagina(21), '21st British Academy Games Awards');
  const b = premios.PREMIOS.baftajogos;
  assert.strictEqual(b.ano(1), 2004);
  assert.strictEqual(b.ano(5), 2009);
  assert.strictEqual(b.ano(21), 2025);
  // numero() desfaz ano(): a edição que cai em cada ano (menos o 2008, que não teve).
  for (const n of [1, 2, 3, 4, 5, 12, 21, 22]) assert.strictEqual(b.numero(b.ano(n)), n);
});

test('TGA: lê as categorias da tabela, com cabeçalhos com {{color}} e notas {{efn}}', () => {
  assert.deepStrictEqual(tga.map((k) => k.chave), ['Game of the Year', 'Best Game Direction', 'Best Score and Music', 'Best Performance', 'Most Anticipated Game', 'Best Adaptation', 'Best Esports Athlete', 'Best Esports Team', "Player's Voice", 'Global Gaming Citizens']);
});

test('TGA: o vencedor é o da primeira linha (‡) e o jogo vem com o link da página', () => {
  const k = por(tga, 'Game of the Year');
  assert.deepStrictEqual(vencedores(k).map((x) => x.titulo), ['Astro Bot']);
  assert.strictEqual(k.indicados.length, 3);
  const sh = k.indicados.find((x) => x.titulo === 'Silent Hill 2');
  assert.strictEqual(sh.wiki, 'Silent Hill 2 (2024 video game)');
  assert.strictEqual(sh.venceu, false);
  // A segunda coluna da mesma linha da tabela é outra categoria.
  assert.deepStrictEqual(vencedores(por(tga, 'Best Game Direction')).map((x) => x.titulo), ['Black Myth: Wukong']);
});

test('TGA: tradução para o português e a tabela de fora da seção não entra', () => {
  assert.strictEqual(por(tga, 'Game of the Year').nome, 'Jogo do Ano');
  assert.strictEqual(por(tga, 'Best Score and Music').nome, 'Melhor Trilha Sonora e Música');
  assert.strictEqual(por(tga, 'Best Esports Team').nome, 'Melhor Time de Esports');
  assert.strictEqual(por(tga, "Player's Voice").nome, 'Voz dos Jogadores');
  assert.ok(!tga.some((k) => /Nome|Game\(s\)|Fora/.test(k.chave)));
});

test('TGA: atuação traz a pessoa e o jogo', () => {
  const k = por(tga, 'Best Performance');
  assert.deepStrictEqual(vencedores(k).map((x) => [x.titulo, x.pessoa]), [["Senua's Saga: Hellblade II", 'Melina Juergens as Senua']]);
  assert.deepStrictEqual(k.indicados.find((x) => x.titulo === 'The Last of Us').pessoa, 'Troy Baker as Joel');
});

test('TGA: categorias de pessoas/times e adaptações não têm jogo para ligar', () => {
  for (const chave of ['Best Esports Athlete', 'Best Esports Team', 'Best Adaptation', 'Global Gaming Citizens']) {
    const k = por(tga, chave);
    assert.strictEqual(k.pessoas, true, chave);
    assert.ok(k.indicados.every((x) => !x.titulo && !x.wiki && x.pessoa), chave);
  }
  const t = por(tga, 'Best Esports Team');
  assert.deepStrictEqual(vencedores(t).map((x) => x.pessoa), ['T1 (League of Legends)']);
  assert.deepStrictEqual(vencedores(por(tga, 'Best Esports Athlete')).map((x) => x.pessoa), ['Lee "Faker" Sang-hyeok']);
  assert.deepStrictEqual(vencedores(por(tga, 'Best Adaptation')).map((x) => x.pessoa), ['Fallout – Amazon MGM Studios']);
  // Homenagem: quem aparece foi premiado.
  assert.ok(por(tga, 'Global Gaming Citizens').indicados.every((x) => x.venceu));
});

test('TGA: "Most Anticipated Game" é de jogos não lançados; as outras não', () => {
  assert.strictEqual(por(tga, 'Most Anticipated Game').naoLancado, true);
  assert.strictEqual(por(tga, 'Game of the Year').naoLancado, undefined);
  assert.strictEqual(por(tga, 'Most Anticipated Game').nome, 'Jogo Mais Aguardado');
});

test('TGA: cabeçalho largo com célula larga (Voz dos Jogadores) é uma categoria só', () => {
  const k = por(tga, "Player's Voice");
  assert.deepStrictEqual(k.indicados.map((x) => x.titulo), ['Black Myth: Wukong', 'Balatro']);
  assert.deepStrictEqual(vencedores(k).map((x) => x.titulo), ['Black Myth: Wukong']);
  // E a categoria de antes (esportes) não herdou os indicados dela.
  assert.strictEqual(por(tga, 'Best Esports Team').indicados.length, 2);
});

test('TGA: uma página sem a seção de indicados (o artigo geral) não vira edição', () => {
  assert.deepStrictEqual(premios.lerPagina(premios.PREMIOS.tga, '== History ==\n== Categories ==\n{|\n! Nominations\n|-\n| x\n|}\n'), []);
});

test('BAFTA Games: lê {{Award category}} com <br><small> e tira o prefixo da categoria', () => {
  assert.deepStrictEqual(bafta.map((k) => k.chave), ['Best Game', 'Artistic Achievement', 'Performer in a Leading Role', 'BAFTA Fellowship']);
  assert.deepStrictEqual(bafta.map((k) => k.nome), ['Melhor Jogo', 'Conquista Artística', 'Atuação Principal', 'Fellowship do BAFTA']);
  const k = por(bafta, 'Best Game');
  assert.deepStrictEqual(vencedores(k).map((x) => x.titulo), ['Astro Bot']);
  assert.strictEqual(k.indicados.find((x) => x.titulo === "Thank Goodness You're Here!").wiki, "Thank Goodness You're Here!");
});

test('BAFTA Games: atuação sem o "in" que sobra e a tabela de vitórias fica de fora', () => {
  const k = por(bafta, 'Performer in a Leading Role');
  assert.deepStrictEqual(vencedores(k).map((x) => [x.titulo, x.pessoa]), [['Still Wakes the Deep', 'Alec Newman as Cameron "Caz" McLeary']]);
  assert.strictEqual(k.indicados.find((x) => x.titulo === 'Indika').pessoa, 'Isabella Inchbald as Indika');
  assert.ok(!bafta.some((k2) => k2.chave === 'Game'));
});

test('cinema: a mesma leitura de sempre (o "in" de pessoa continua; as traduções de jogos não vazam)', () => {
  const w = "{{Award category|#EEDD82|[[Academy Award for Best Picture|Best Picture]]}}\n* '''''[[Oppenheimer (film)|Oppenheimer]]'' – produtores ‡'''\n** ''[[Barbie (film)|Barbie]]'' – produtores\n{{Award category|#EEDD82|[[Academy Award for Best Sound|Best Sound]]}}\n* '''Fulano in ''[[Filme]]'''''\n** ''[[Outro]]''\n";
  const cats = premios.lerCategorias(w, ['Academy Award for '], { tabela: true });
  assert.deepStrictEqual(cats.map((k) => k.nome), ['Melhor Filme', 'Melhor Som']);
  assert.strictEqual(cats[1].indicados[0].pessoa, 'Fulano in');
  assert.strictEqual(premios.traduzir('Music', 'Music'), 'Music');
  assert.strictEqual(premios.traduzir('Music', 'Music', true), 'Música');
});

test('formato guardado: jogos levam [slug, igdb, steam] e voltam com os nomes certos', () => {
  const cerimonias = [{ numero: 2024, ano: 2024, categorias: tga.slice(0, 1) }];
  const filmes = { 'Astro Bot': { igdbSlug: 'astro-bot', igdb: 252435, steam: 2778210 }, Balatro: { igdbSlug: 'balatro', igdb: 251833 }, 'Silent Hill 2 (2024 video game)': {} };
  const c = premios.compactar({ premio: 'tga', cerimonias, filmes });
  assert.strictEqual(c.tipo, 'jogo');
  assert.deepStrictEqual(c.filmes['Astro Bot'], ['astro-bot', 252435, 2778210]);
  assert.deepStrictEqual(c.filmes.Balatro, ['balatro', 251833]);
  const e = premios.expandir(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(e.tipo, 'jogo');
  assert.deepStrictEqual(e.filmes['Astro Bot'], { igdbSlug: 'astro-bot', igdb: 252435, steam: 2778210 });
  assert.deepStrictEqual(e.filmes.Balatro, { igdbSlug: 'balatro', igdb: 251833, steam: '' });
  assert.deepStrictEqual(e.filmes['Silent Hill 2 (2024 video game)'], { igdbSlug: '', igdb: '', steam: '' });
  assert.strictEqual(e.cerimonias[0].categorias[0].nome, 'Jogo do Ano');
});

test('formato guardado: um histórico antigo de cinema ([imdb, tmdb]) continua sendo lido', () => {
  const antigo = { premio: 'oscar', geradoEm: '2026-01-01', filmes: { Oppenheimer: ['tt15398776', '872585'], Barbie: ['tt1517268'] }, cerimonias: [[96, 2024, [['Best Picture', 'Best Picture', [['Oppenheimer', 'Oppenheimer', '', 1], ['Barbie', 'Barbie', '', 0]]]]]] };
  const e = premios.expandir(antigo);
  assert.deepStrictEqual(e.filmes.Oppenheimer, { imdb: 'tt15398776', tmdb: '872585' });
  assert.deepStrictEqual(e.filmes.Barbie, { imdb: 'tt1517268', tmdb: '' });
  assert.strictEqual(e.tipo, undefined);
  assert.strictEqual(e.cerimonias[0].categorias[0].nome, 'Melhor Filme');
});

test('histórico gerado: os dois arquivos existem, são de jogos e têm ids', () => {
  for (const id of ['tga', 'baftajogos']) {
    const d = premios.expandir(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', `premios-${id}.json`), 'utf8')));
    assert.strictEqual(d.tipo, 'jogo');
    assert.ok(d.cerimonias.length >= 12, id);
    const ids = Object.values(d.filmes);
    assert.ok(ids.filter((x) => x.igdbSlug || x.steam).length / ids.length > 0.9, id);
  }
});

// ---- Tela dos prêmios de jogos (src/premios-jogos.js, contas puras) ----
const tela = require('../src/premios-jogos');

test('desenvolvedor: a parte antes de "/" do "Jogo – Desenvolvedor/Publicadora"', () => {
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Sandfall Interactive / Kepler Interactive' }).desenvolvedor, 'Sandfall Interactive');
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Team Asobi/Sony Interactive Entertainment' }).desenvolvedor, 'Team Asobi');
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Treyarch/Raven/Activision' }).desenvolvedor, 'Treyarch');
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Hello Games' }).desenvolvedor, 'Hello Games');
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: '' }).desenvolvedor, '');
});

test('desenvolvedor: o jogo da lista manda; trilha sonora sem "/" é crédito, não estúdio', () => {
  const f = { desenvolvedores: [{ id: 1, nome: 'Larian Studios' }, { id: 2, nome: 'Outra' }] };
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Alguém / Pub' }, f).desenvolvedor, 'Larian Studios');
  assert.strictEqual(tela.desenvolvedorDoIndicado({ extra: 'Alguém' }, { desenvolvedores: [] }).desenvolvedor, 'Alguém');
  const m = tela.desenvolvedorDoIndicado({ extra: 'Lorien Testard' }, null, 'Best Score and Music');
  assert.deepStrictEqual(m, { desenvolvedor: '', credito: 'Lorien Testard' });
});

test('jogados: conta pelo status do jogo, nunca pelo palpite', () => {
  const lista = [{ status: 'quero' }, { status: 'jogando' }, { status: 'pausado' }, { status: 'zerado' }, { status: 'cem' }, { status: 'larguei' }, null, undefined, { status: 'quero', palpite: true }];
  assert.strictEqual(tela.contarJogados(lista), 5);
  assert.strictEqual(tela.jogoJogado({ status: 'quero' }), false);
  assert.strictEqual(tela.jogoJogado(null), false);
});

test('inicial dos indicados que são pessoas ou times', () => {
  assert.strictEqual(tela.inicialDe('Team Liquid'), 'TL');
  assert.strictEqual(tela.inicialDe('Chovy (Gen.G)'), 'C');
  assert.strictEqual(tela.inicialDe(''), '?');
});
