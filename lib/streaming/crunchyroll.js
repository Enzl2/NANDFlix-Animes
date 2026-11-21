// nandchan: importar da Crunchyroll a Watchlist (com os favoritos) e as
// Crunchylists.
//
// A Crunchyroll não tem API pública nem exportação. O app abre o site numa
// janela própria, a pessoa entra com a conta dela, e o app usa a mesma sessão
// que o site usa para pedir as listas (as mesmas consultas que a página faz).
// O app nunca vê a senha. Esta parte só lê as respostas: a janela e a sessão
// ficam no main.js.
//
// As respostas mudam de formato de tempos em tempos, então a leitura não
// depende de um caminho fixo: procura, em qualquer lugar do JSON, os objetos
// que descrevem uma série ou um filme.

const ID = 'crunchyroll';
const NOME = 'Crunchyroll';
const URL_ENTRAR = 'https://www.crunchyroll.com/login';
const SITE = 'https://www.crunchyroll.com';

// As consultas que o app faz com a sessão da pessoa (títulos em inglês: acham
// mais fácil o anime certo na AniList).
const consultas = {
  conta: () => `${SITE}/accounts/v1/me`,
  watchlist: (conta) => `${SITE}/content/v2/discover/${encodeURIComponent(conta)}/watchlist?order=desc&n=1000&locale=en-US`,
  crunchylists: (conta) => `${SITE}/content/v2/${encodeURIComponent(conta)}/custom-lists?locale=en-US`,
  crunchylist: (conta, lista) => `${SITE}/content/v2/${encodeURIComponent(conta)}/custom-lists/${encodeURIComponent(lista)}?locale=en-US&n=1000`,
};

// O código que lê as respostas da Crunchyroll fica num texto, e não em funções
// soltas: no celular ele roda dentro da página do site (scriptCelular), e a
// montagem do app do celular renomeia as funções (minifica), o que quebraria
// uma cópia feita do código delas. No PC (e nos testes) o mesmo texto vira as
// funções abaixo, na primeira vez que forem usadas.
const LEITURA = String.raw`
// Um item da Crunchyroll (série, filme ou o próximo episódio de uma série) vira
// { id, titulo, filme }. Devolve null para o que não é nenhum dos dois.
function lerPainel(p) {
  if (!p || typeof p !== 'object') return null;
  const tipo = String(p.type || '');
  if (tipo === 'series') return p.title ? { id: String(p.id || p.title), titulo: String(p.title), filme: false } : null;
  if (tipo === 'movie_listing') return p.title ? { id: String(p.id || p.title), titulo: String(p.title), filme: true } : null;
  const ep = p.episode_metadata;
  if (tipo === 'episode' && ep && ep.series_title) return { id: String(ep.series_id || ep.series_title), titulo: String(ep.series_title), filme: false };
  const mv = p.movie_metadata;
  if (tipo === 'movie' && mv && (mv.movie_listing_title || p.title)) return { id: String(mv.movie_listing_id || p.id), titulo: String(mv.movie_listing_title || p.title), filme: true };
  return null;
}

// Todos os títulos de uma resposta, sem repetir, na ordem em que aparecem. Um
// item com is_favorite marcado sai como favorito.
function titulos(json) {
  const vistos = new Map();
  const visitar = (no, favorito) => {
    if (!no || typeof no !== 'object') return;
    if (Array.isArray(no)) { no.forEach((x) => visitar(x, favorito)); return; }
    const fav = favorito || no.is_favorite === true;
    const item = lerPainel(no.panel) || lerPainel(no);
    if (item) {
      const antes = vistos.get(item.id);
      if (!antes) vistos.set(item.id, Object.assign({}, item, { favorito: fav }));
      else if (fav) antes.favorito = true;
      return;
    }
    for (const v of Object.values(no)) if (v && typeof v === 'object') visitar(v, fav);
  };
  visitar(json, false);
  return [...vistos.values()];
}

// As Crunchylists da conta: [{ id, nome }].
function crunchylists(json) {
  const dados = (json && (json.data || json.items)) || [];
  return (Array.isArray(dados) ? dados : [])
    .map((l) => ({ id: String(l.list_id || l.id || ''), nome: String(l.title || l.name || '') }))
    .filter((l) => l.id && l.nome);
}

// O id da conta, da resposta de /accounts/v1/me.
function idDaConta(json) { return (json && (json.account_id || json.external_id)) || ''; }
`;

let leitura = null;
const ler = () => leitura || (leitura = new Function(`${LEITURA}\nreturn { lerPainel, titulos, crunchylists, idDaConta };`)());
const lerPainel = (p) => ler().lerPainel(p);
const titulos = (json) => ler().titulos(json);
const crunchylists = (json) => ler().crunchylists(json);
const idDaConta = (json) => ler().idDaConta(json);

// ---------- No celular ----------
//
// No celular não dá para ler os pedidos da página por fora, como no PC. O app
// abre a Crunchyroll num navegador dentro dele e põe este script em cada página:
// - no site de login (sso.crunchyroll.com), só uma faixa pedindo para entrar;
// - no site, ele guarda a sessão quando o próprio site a usa nos pedidos dele
//   (fetch e XMLHttpRequest). Se o site ainda não pediu nada desde que o script
//   entrou, abre a Fila ou as Crunchylists pelo próprio site, o que o faz pedir.
//   Com a sessão, lê sozinho a Fila (Watchlist) e as Crunchylists e manda para o
//   app (window.mobileApp.postMessage, do plugin do navegador), que fecha o
//   navegador e mostra a conferência.
// Uma faixa embaixo diz o que está acontecendo; se der errado, tem "Tentar de
// novo".
function scriptCelular() {
  return `(() => {
  if (window.__nandchanCr) return;
  const estado = window.__nandchanCr = { token: '', lendo: false, pronto: false, tentativas: 0 };
  const SITE = ${JSON.stringify(SITE)};
  ${LEITURA}
  const consultas = {
    conta: () => SITE + '/accounts/v1/me',
    watchlist: (conta) => ${JSON.stringify(consultas.watchlist('CONTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)),
    crunchylists: (conta) => ${JSON.stringify(consultas.crunchylists('CONTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)),
    crunchylist: (conta, l) => ${JSON.stringify(consultas.crunchylist('CONTANANDCHAN', 'LISTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)).replace('LISTANANDCHAN', encodeURIComponent(l)),
  };
  const noSite = location.origin === SITE;

  // A faixa: um texto e, quando precisa, um botão.
  let faixa = null;
  function mostrar(texto, botao) {
    if (!document.body) return;
    if (!faixa || !faixa.isConnected) {
      faixa = document.createElement('div');
      faixa.id = 'nandchan-faixa';
      faixa.style.cssText = 'position:fixed;left:12px;right:12px;bottom:72px;z-index:2147483647;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#1d1328;color:#f3e8ff;border:1px solid #c084fc;font:500 15px/1.35 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.55)';
      document.body.appendChild(faixa);
    }
    faixa.innerHTML = '';
    const t = document.createElement('span');
    t.style.flex = '1';
    t.textContent = texto;
    faixa.appendChild(t);
    if (botao) {
      const b = document.createElement('button');
      b.id = 'nandchan-ler';
      b.textContent = botao;
      b.style.cssText = 'flex:none;padding:10px 14px;border:0;border-radius:10px;background:#c084fc;color:#140a1f;font:600 15px/1 system-ui,sans-serif';
      b.onclick = () => { estado.tentativas = 0; tentar(); };
      faixa.appendChild(b);
    }
  }

  if (!noSite) {
    // Login (sso.crunchyroll.com) ou outra página: só a explicação.
    const pedirLogin = () => mostrar('Entre na sua conta da Crunchyroll. Depois, o nandchan lê as suas listas sozinho.');
    pedirLogin();
    setInterval(() => { if (!faixa || !faixa.isConnected) pedirLogin(); }, 1000);
    return;
  }

  const guardar = (v) => { if (v && /^Bearer\\s/i.test(String(v))) estado.token = String(v); };
  const deCabecalhos = (h) => {
    if (!h) return;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) { guardar(h.get('Authorization')); return; }
      if (Array.isArray(h)) { for (const [k, v] of h) if (/^authorization$/i.test(k)) guardar(v); return; }
      for (const k of Object.keys(h)) if (/^authorization$/i.test(k)) guardar(h[k]);
    } catch (e) { /* cabeçalhos estranhos: ignora */ }
  };
  const fetchOriginal = window.fetch;
  window.fetch = function (entrada, opcoes) {
    deCabecalhos(opcoes && opcoes.headers);
    if (entrada && typeof entrada === 'object' && entrada.headers) deCabecalhos(entrada.headers);
    return fetchOriginal.apply(this, arguments);
  };
  const cabecalhoOriginal = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (/^authorization$/i.test(k)) guardar(v);
    return cabecalhoOriginal.apply(this, arguments);
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const pedir = (url) => fetchOriginal(url, { headers: { Authorization: estado.token }, credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const enviar = (dados) => { try { window.mobileApp.postMessage({ detail: dados }); } catch (e) { /* sem o app por perto */ } };

  // Faz o site pedir algo (e usar a sessão), abrindo a Fila ou as Crunchylists.
  async function provocar() {
    for (let i = 0; i < 2 && !estado.token; i++) {
      const alvo = location.pathname.indexOf('/watchlist') >= 0 ? '/crunchylists' : '/watchlist';
      const link = [...document.querySelectorAll('a[href]')].find((a) => { try { return new URL(a.href, location.href).pathname.replace(/\\/$/, '').endsWith(alvo); } catch (e) { return false; } });
      if (link) link.click();
      else { history.pushState({}, '', alvo); window.dispatchEvent(new PopStateEvent('popstate')); }
      for (let j = 0; j < 12 && !estado.token; j++) await espera(500);
    }
  }
  async function lerListas() {
    const conta = idDaConta(await pedir(consultas.conta()));
    if (!conta) return null;
    const listas = [];
    const watch = titulos(await pedir(consultas.watchlist(conta)));
    if (watch.length) listas.push({ nome: 'Watchlist', origem: 'watchlist', itens: watch });
    for (const l of crunchylists(await pedir(consultas.crunchylists(conta)))) {
      const itens = titulos(await pedir(consultas.crunchylist(conta, l.id)));
      if (itens.length) listas.push({ nome: l.nome, origem: 'crunchylist', itens });
    }
    return listas;
  }
  async function tentar() {
    if (estado.lendo || estado.pronto) return;
    estado.lendo = true;
    estado.tentativas++;
    try {
      mostrar('Procurando a sua conta…');
      if (!estado.token) await espera(1500); // o site pode pedir sozinho logo ao abrir
      if (!estado.token) await provocar();
      const listas = estado.token ? await lerListas() : null;
      if (!listas) {
        mostrar('Não achei a sua conta. Se ainda não entrou, entre pelo menu da Crunchyroll.', 'Tentar de novo');
      } else if (!listas.length) {
        mostrar('Sua Fila e suas Crunchylists estão vazias.', 'Tentar de novo');
      } else {
        estado.pronto = true;
        const n = listas.reduce((t, l) => t + l.itens.length, 0);
        mostrar('Pronto! ' + n + ' títulos em ' + listas.length + (listas.length === 1 ? ' lista' : ' listas') + '. Voltando ao nandchan…');
        enviar({ tipo: 'listas', listas });
      }
    } catch (e) {
      mostrar('Não deu para ler as listas.', 'Tentar de novo');
    }
    estado.lendo = false;
  }
  // O site redesenha a página ao navegar: a faixa volta se sumir.
  setInterval(() => { if (faixa && !faixa.isConnected && document.body) document.body.appendChild(faixa); }, 1000);
  const comecar = () => { if (document.body) tentar(); else setTimeout(comecar, 300); };
  comecar();
})()`;
}

module.exports = { ID, NOME, URL_ENTRAR, SITE, consultas, LEITURA, lerPainel, titulos, crunchylists, idDaConta, scriptCelular };
