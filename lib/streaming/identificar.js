// nandchan: de um título visto num serviço de streaming até o anime da AniList.
//
// - Crunchyroll: tudo lá é anime; procura o título na AniList (com as
//   tentativas extras da busca) e fica com o do mesmo tipo e mesmo nome.
// - Os outros (Netflix, Prime Video…): a lista tem de tudo. Com a chave do
//   TMDB, o título (em português, como o serviço mostra) passa antes por lá:
//   se não for animação, nem vai para a AniList; se for animação japonesa, a
//   AniList é consultada pelo título original em japonês, que acha o anime
//   certo mesmo quando o nome traduzido não ajuda. Animação de outro país
//   (Terminator Zero, Scott Pilgrim, Castlevania) entra se a AniList tiver o
//   mesmo nome, da mesma época. Sem a chave, só vale o anime da AniList que
//   tem exatamente o mesmo nome.

const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// O anime certo entre os resultados da AniList (com `nomes`, da busca exata).
// `nomes`: os nomes que valem; `confirmado`: o TMDB disse que é anime (aí, se
// nenhum nome bater, serve o mais relevante do mesmo tipo e da mesma época).
function escolherAnime(resultados, { nomes = [], filme = null, ano = '', confirmado = false } = {}) {
  const lista = Array.isArray(resultados) ? resultados : [];
  const alvos = new Set(nomes.map(normal).filter(Boolean));
  const mesmoTipo = (r) => filme === null || Boolean(r.filme) === Boolean(filme);
  const perto = (r) => !ano || !r.ano || Math.abs(Number(r.ano) - Number(ano)) <= 1;
  // Quem tem o nome como título principal vem antes de quem só o tem entre
  // os nomes alternativos ("Link Click" antes de "LINK CLICK (Shorts)").
  const comNome = lista.filter((r) => (r.nomes || [r.titulo]).some((n) => alvos.has(normal(n))))
    .sort((x, y) => Number(!alvos.has(normal(x.titulo))) - Number(!alvos.has(normal(y.titulo))));
  // Sem o TMDB confirmar que é anime, a época também tem de bater (o Devil May
  // Cry de 2025 não é o anime de 2007).
  const achado = confirmado
    ? comNome.find((r) => mesmoTipo(r) && perto(r)) || comNome.find(mesmoTipo) || comNome[0]
    : comNome.find((r) => mesmoTipo(r) && perto(r)) || comNome.find(perto);
  if (achado) return achado;
  if (confirmado) return lista.find((r) => mesmoTipo(r) && perto(r)) || null;
  return null;
}

// Um item ({ titulo, filme }) → { anime, naoAnime }. `anime`: o resultado da
// AniList, ou null; `naoAnime`: o TMDB disse que não é anime.
async function identificar(item, { anilist, tmdb, chaveTmdb = '', tudoAnime = false }) {
  const titulo = String(item.titulo || '').trim();
  if (!titulo) return { anime: null, naoAnime: false };
  if (tudoAnime) {
    const r = await anilist.pesquisar(titulo);
    const alvo = normal(titulo);
    const mesmoTipo = r.filter((x) => item.filme == null || Boolean(x.filme) === Boolean(item.filme));
    return { anime: mesmoTipo.find((x) => normal(x.titulo) === alvo) || r.find((x) => normal(x.titulo) === alvo) || mesmoTipo[0] || r[0] || null, naoAnime: false };
  }
  let t = null;
  if (chaveTmdb && tmdb) {
    try { t = await tmdb.animeJapones(chaveTmdb, titulo); } catch { t = null; } // sem TMDB: só a AniList
  }
  // Não é animação (Breaking Bad, um live-action): fica de fora.
  if (t && !t.anime && !t.animacao) return { anime: null, naoAnime: true };
  const filme = item.filme == null ? (t ? t.filme : null) : item.filme;
  if (t && t.anime) {
    const r = await anilist.pesquisar(t.original, { exata: true });
    const a = escolherAnime(r, { nomes: [t.original, titulo], filme, ano: t.ano, confirmado: true });
    if (a) return { anime: a, naoAnime: false };
  }
  // Animação de fora do Japão, ou sem o TMDB: vale se a AniList tiver o mesmo
  // nome (e, se o TMDB disse o ano, a mesma época).
  const nomes = t ? [titulo, t.original] : [titulo];
  const r = await anilist.pesquisar(t && t.original !== titulo ? t.original : titulo, { exata: true });
  let a = escolherAnime(r, { nomes, filme, ano: t ? t.ano : '' });
  if (!a && t && t.original !== titulo) a = escolherAnime(await anilist.pesquisar(titulo, { exata: true }), { nomes, filme, ano: t.ano });
  return { anime: a, naoAnime: false };
}

// Vários itens, cada título procurado uma vez só. `aoAvancar(feitos, total)`
// mostra o progresso (a AniList tem limite por minuto: pode demorar).
async function identificarTodos(itens, opcoes, aoAvancar = () => {}) {
  const chave = (x) => `${x.servico || ''}|${x.filme == null ? '?' : x.filme ? 'f' : 's'}|${normal(x.titulo)}`;
  const unicos = [...new Map(itens.map((x) => [chave(x), x])).values()];
  const achados = new Map();
  let feitos = 0;
  for (const x of unicos) {
    let r;
    try { r = await identificar(x, { ...opcoes, tudoAnime: Boolean(x.tudoAnime) }); } catch { r = { anime: null, naoAnime: false }; }
    achados.set(chave(x), r);
    aoAvancar(++feitos, unicos.length);
  }
  return itens.map((x) => ({ ...x, ...achados.get(chave(x)) }));
}

module.exports = { normal, escolherAnime, identificar, identificarTodos };
