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

module.exports = { ID, NOME, URL_ENTRAR, SITE, consultas, lerPainel, titulos, crunchylists, idDaConta };
