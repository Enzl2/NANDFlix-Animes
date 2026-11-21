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
// item com `is_favorite` marcado sai como favorito.
function titulos(json) {
  const vistos = new Map();
  const visitar = (no, favorito) => {
    if (!no || typeof no !== 'object') return;
    if (Array.isArray(no)) { no.forEach((x) => visitar(x, favorito)); return; }
    const fav = favorito || no.is_favorite === true;
    const item = lerPainel(no.panel) || lerPainel(no);
    if (item) {
      const antes = vistos.get(item.id);
      if (!antes) vistos.set(item.id, { ...item, favorito: fav });
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
const idDaConta = (json) => (json && (json.account_id || json.external_id)) || '';

// ---------- No celular ----------
//
// No celular não dá para ler os pedidos da página por fora, como no PC. O app
// abre a Crunchyroll num navegador dentro dele e põe este script na página:
// ele guarda a sessão quando o próprio site a usa nos pedidos dele (fetch e
// XMLHttpRequest), mostra o botão "Ler minhas listas" e, ao toque, faz as
// mesmas consultas do PC dali de dentro e manda as listas para o app
// (window.mobileApp.postMessage, do plugin do navegador). Se o site ainda não
// fez nenhum pedido desde que o script entrou, o script abre a Watchlist ou as
// Crunchylists pelo próprio site, o que o faz pedir.
function scriptCelular() {
  const ajudantes = [lerPainel, titulos, crunchylists].map((f) => f.toString()).join('\n');
  return `(() => {
  if (window.__nandchanCr) return;
  const estado = window.__nandchanCr = { token: '', lendo: false };
  const SITE = ${JSON.stringify(SITE)};
  ${ajudantes}
  const idDaConta = ${idDaConta.toString()};
  const consultas = {
    conta: () => SITE + '/accounts/v1/me',
    watchlist: (conta) => ${JSON.stringify(consultas.watchlist('CONTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)),
    crunchylists: (conta) => ${JSON.stringify(consultas.crunchylists('CONTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)),
    crunchylist: (conta, l) => ${JSON.stringify(consultas.crunchylist('CONTANANDCHAN', 'LISTANANDCHAN'))}.replace('CONTANANDCHAN', encodeURIComponent(conta)).replace('LISTANANDCHAN', encodeURIComponent(l)),
  };
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
  async function provocar() {
    for (let i = 0; i < 2 && !estado.token; i++) {
      const alvo = location.pathname.indexOf('/watchlist') >= 0 ? '/crunchylists' : '/watchlist';
      const link = [...document.querySelectorAll('a[href]')].find((a) => { try { return new URL(a.href, location.href).pathname.replace(/\\/$/, '').endsWith(alvo); } catch (e) { return false; } });
      if (link) link.click();
      else { history.pushState({}, '', alvo); window.dispatchEvent(new PopStateEvent('popstate')); }
      for (let j = 0; j < 12 && !estado.token; j++) await espera(500);
    }
  }
  async function ler() {
    await provocar();
    if (!estado.token) throw new Error('Entre na sua conta e toque de novo.');
    const conta = idDaConta(await pedir(consultas.conta()));
    if (!conta) throw new Error('Entre na sua conta e toque de novo.');
    const listas = [];
    const watch = titulos(await pedir(consultas.watchlist(conta)));
    if (watch.length) listas.push({ nome: 'Watchlist', origem: 'watchlist', itens: watch });
    for (const l of crunchylists(await pedir(consultas.crunchylists(conta)))) {
      const itens = titulos(await pedir(consultas.crunchylist(conta, l.id)));
      if (itens.length) listas.push({ nome: l.nome, origem: 'crunchylist', itens });
    }
    return listas;
  }
  const TEXTO = 'Ler minhas listas no nandchan';
  function botao() {
    if (!document.body || document.getElementById('nandchan-ler')) return;
    const b = document.createElement('button');
    b.id = 'nandchan-ler';
    b.textContent = TEXTO;
    b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:16px;border:0;border-radius:14px;background:#c084fc;color:#140a1f;font:600 16px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45)';
    b.onclick = async () => {
      if (estado.lendo) return;
      estado.lendo = true;
      b.textContent = 'Lendo as suas listas…';
      try {
        const listas = await ler();
        b.textContent = 'Pronto!';
        enviar({ tipo: 'listas', listas });
      } catch (e) {
        b.textContent = e.message || 'Não deu. Toque de novo.';
        setTimeout(() => { if (!estado.lendo) b.textContent = TEXTO; }, 4000);
      }
      estado.lendo = false;
    };
    document.body.appendChild(b);
  }
  // O site redesenha a página ao navegar: o botão volta se sumir.
  botao();
  setInterval(botao, 1000);
})()`;
}

module.exports = { ID, NOME, URL_ENTRAR, SITE, consultas, lerPainel, titulos, crunchylists, idDaConta, scriptCelular };
