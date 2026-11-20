// nandchan: os serviços de streaming de onde dá para importar a lista.
//
// A Crunchyroll tem um leitor próprio (crunchyroll.js), pelas mesmas consultas
// que o site faz. Os outros não deixam ler a lista assim de fora, então o app
// abre a página da lista numa janela, a pessoa entra com a conta dela e clica
// em "Ler esta lista" (um botão que o app põe na página): o app rola a página
// até o fim e lê os títulos que estão nela. O app nunca vê a senha.
//
// Os sites mudam de tempos em tempos, então a leitura não depende de um
// desenho fixo: procura os links para a página de um título (`links`) e pega
// o nome do próprio link (aria-label, texto alternativo da capa ou o texto).
// Se nada bater, serve qualquer link com capa. Escolhidos os que estão na
// lista brasileira de plataformas do app e têm animes no catálogo.

const SERVICOS = [
  { ID: 'netflix', NOME: 'Netflix', LISTA: 'Minha lista', URL: 'https://www.netflix.com/browse/my-list', links: '/(watch|title)/\\d+' },
  { ID: 'primevideo', NOME: 'Prime Video', LISTA: 'Lista de interesses', URL: 'https://www.primevideo.com/mystuff/watchlist', links: '/detail/' },
  { ID: 'disney', NOME: 'Disney+', LISTA: 'Minha lista', URL: 'https://www.disneyplus.com/watchlist', links: '/(browse/entity-|series/|movies/)', filme: '/movies/', serie: '/series/' },
  { ID: 'hbomax', NOME: 'HBO Max', LISTA: 'Minha lista', URL: 'https://play.hbomax.com/my-stuff', links: '/(show|movie)/', filme: '/movie/', serie: '/show/' },
  { ID: 'appletv', NOME: 'Apple TV', LISTA: 'A Seguir', URL: 'https://tv.apple.com/', links: '/(show|movie)/', filme: '/movie/', serie: '/show/' },
  { ID: 'paramount', NOME: 'Paramount+', LISTA: 'Minha lista', URL: 'https://www.paramountplus.com/', links: '/(shows|movies)/', filme: '/movies/', serie: '/shows/' },
  { ID: 'globoplay', NOME: 'Globoplay', LISTA: 'Minha lista', URL: 'https://globoplay.globo.com/minha-lista/', links: '/t/[A-Za-z0-9]+' },
  { ID: 'animeonegai', NOME: 'Anime Onegai', LISTA: 'Minha lista', URL: 'https://www.animeonegai.com/', links: '' },
];

// Os nomes de menu e de botão que às vezes vêm junto com os links de título.
const NAO_SAO_TITULOS = /^(assistir|assista|ver mais|mais informações|detalhes|play|continuar|reproduzir|trailer|início|home|minha lista|my list|watchlist)$/i;

// Põe (ou repõe, se o site redesenhou a página) o botão "Ler esta lista" e diz
// se ele foi clicado desde a última vez. Roda dentro da página.
const SCRIPT_BOTAO = `(() => {
  let b = document.getElementById('nandchan-ler');
  if (!b && document.body) {
    b = document.createElement('button');
    b.id = 'nandchan-ler';
    b.textContent = 'Ler esta lista no nandchan';
    b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:14px 20px;border:0;border-radius:12px;background:#c084fc;color:#140a1f;font:600 15px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);cursor:pointer';
    b.onclick = () => { window.__nandchanLer = true; b.textContent = 'Lendo…'; };
    document.body.appendChild(b);
  }
  const clicou = window.__nandchanLer === true;
  window.__nandchanLer = false;
  return clicou;
})()`;

// Uma mensagem no botão (por exemplo, quando não achou nada na página).
const scriptMensagem = (texto) => `(() => { const b = document.getElementById('nandchan-ler'); if (b) b.textContent = ${JSON.stringify(texto)}; })()`;

// Rola a página até o fim (as listas carregam aos poucos) e lê os títulos.
// Devolve [{ titulo, filme }] (filme: true, false ou null quando não se sabe).
const scriptLer = (s) => `(async () => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  // Para quando nem a altura nem a quantidade de links mudam mais. O último
  // link vai até a tela e a página fica sabendo da rolagem: alguns sites só
  // carregam mais quando o fim da lista aparece.
  let antes = '', iguais = 0;
  for (let i = 0; i < 80 && iguais < 3; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const links = document.querySelectorAll('a[href]');
    if (links.length) links[links.length - 1].scrollIntoView({ block: 'end' });
    window.dispatchEvent(new Event('scroll'));
    await espera(700);
    const agora = document.documentElement.scrollHeight + '|' + document.querySelectorAll('a[href]').length;
    iguais = agora === antes ? iguais + 1 : 0;
    antes = agora;
  }
  window.scrollTo(0, 0);
  const padrao = ${JSON.stringify(s.links || '')};
  const ehFilme = ${JSON.stringify(s.filme || '')}, ehSerie = ${JSON.stringify(s.serie || '')};
  const nao = ${NAO_SAO_TITULOS.toString()};
  const limpar = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  const nomeDo = (a) => {
    const img = a.querySelector('img[alt]');
    const candidatos = [a.getAttribute('aria-label'), img && img.getAttribute('alt'), a.getAttribute('title'), (a.innerText || '').split('\\n')[0]];
    return candidatos.map(limpar).find((t) => t.length > 1 && !nao.test(t)) || '';
  };
  const ler = (filtro) => {
    const vistos = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!filtro(a, href)) continue;
      const titulo = nomeDo(a);
      if (!titulo) continue;
      const chave = titulo.toLowerCase();
      if (vistos.has(chave)) continue;
      const filme = ehFilme && new RegExp(ehFilme).test(href) ? true : ehSerie && new RegExp(ehSerie).test(href) ? false : null;
      vistos.set(chave, { titulo, filme });
    }
    return [...vistos.values()];
  };
  let itens = padrao ? ler((_a, href) => new RegExp(padrao).test(href)) : [];
  if (!itens.length) itens = ler((a) => Boolean(a.querySelector('img')));
  return itens.slice(0, 1000);
})()`;

module.exports = { SERVICOS, SCRIPT_BOTAO, scriptMensagem, scriptLer, NAO_SAO_TITULOS };
