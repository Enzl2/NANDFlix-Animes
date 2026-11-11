// Marcas de mudança, para sincronizar com a nuvem.
//
// A cada gravação, o estado novo é comparado com o anterior e cada campo que
// mudou ganha a hora da mudança. Assim, quando dois aparelhos mexem em coisas
// diferentes do mesmo filme, as duas mudanças ficam ("a última mudança de cada
// campo vence"). Comparar na gravação, em vez de marcar em cada lugar que muda
// um dado, pega tudo: edição, TMDB, importação de planilha, restaurar backup.
//
// sincronia.json guarda:
//   filmes:   { id: { campo: ms } }   quando cada campo de cada filme mudou
//   apagados: { id: ms }              filmes apagados (para o outro aparelho não devolvê-los)
//   config:   { chave: ms }           quando cada pedaço das configurações mudou
//
// As configurações são separadas em pedaços: cada dia da watchlist, cada filme
// do mês e cada tierlist é um registro próprio. Mudar a tierlist num aparelho
// não apaga a watchlist que o outro mexeu. Um pedaço com marca mas sem valor
// foi apagado naquela hora.
const fs = require('fs');
const path = require('path');

// Campos que só fazem sentido neste computador: arquivos da pasta de capas e a
// versão da página que perdeu para a de outro aparelho (até você escolher).
const CAMPOS_LOCAIS = new Set(['capaLocal', 'logoLocal', 'paginaOutra']);

// Configurações que vão para a nuvem. As de aparelho (janela, modo de
// visualização, ordenação, Stremio app ou web) ficam só aqui.
// 'mapa': cada chave do objeto é um registro; 'tierlists': cada lista pelo id,
// mais a ordem delas; 'valor': o valor inteiro é um registro só.
const CONFIG_SINC = {
  watchlists: 'mapa', // { 'AAAA-MM-DD': [ids] }
  filmesDoMes: 'mapa', // { 'AAAA-MM': id }
  tierlists: 'tierlists', // [{ id, nome, filtros, tiers }]
  tierlistAtiva: 'valor',
  filtrosSorteio: 'valor',
  listas: 'valor',
  nandroll: 'valor', // animes ligados ou não (NANDRoll)
  nandrollTodasPlataformas: 'valor', // mostrar também as plataformas de fora do Brasil
  nandrollAssistir: 'valor', // o botão Assistir dos animes: 'oficial' (padrão) ou 'stremio'
  nandrollPlataforma: 'valor', // a plataforma preferida (a última escolhida)
  tmdbKey: 'valor',
  omdbKey: 'valor',
};

const json = (v) => (v === undefined ? undefined : JSON.stringify(v));

// Os pedaços das configurações: { 'watchlists/2026-10-29': valor, 'tierlistAtiva': valor, ... }
function pedacosConfig(config) {
  const p = {};
  for (const [k, modo] of Object.entries(CONFIG_SINC)) {
    const v = config[k];
    if (v === undefined) continue;
    if (modo === 'mapa') {
      if (v && typeof v === 'object') for (const [sub, x] of Object.entries(v)) p[`${k}/${sub}`] = x;
    } else if (modo === 'tierlists') {
      if (Array.isArray(v)) {
        for (const l of v) if (l && l.id) p[`${k}/${l.id}`] = l;
        p[`${k}:ordem`] = v.filter((l) => l && l.id).map((l) => l.id);
      }
    } else {
      p[k] = v;
    }
  }
  return p;
}

// Os campos de um filme que sincronizam, já em JSON (para comparar).
function camposFilme(f) {
  const c = {};
  for (const [k, v] of Object.entries(f)) if (k !== 'id' && !CAMPOS_LOCAIS.has(k) && v !== undefined) c[k] = JSON.stringify(v);
  return c;
}

class Marcas {
  constructor(arquivo) {
    this.arquivo = arquivo;
    let d = null;
    try { d = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* primeira vez */ }
    this.filmes = (d && d.filmes) || {};
    this.apagados = (d && d.apagados) || {};
    this.config = (d && d.config) || {};
    this.ultima = (d && d.ultima) || 0;
    this.fotoFilmes = new Map(); // id → { inteiro, campos } do último estado gravado
    this.fotoConfig = {};
  }

  // Uma hora sempre maior que a última dada, mesmo com o relógio voltando.
  agora() {
    this.ultima = Math.max(Date.now(), this.ultima + 1);
    return this.ultima;
  }

  // Uma marca vinda de outro aparelho: as mudanças daqui depois dela ficam
  // com marca maior, mesmo se o relógio de lá estiver adiantado.
  ver(...ts) {
    this.ultima = Math.max(this.ultima, ...ts.filter(Number.isFinite));
  }

  // O que veio da nuvem já tem marca: vira a referência sem contar como mudança daqui.
  aceitarFilme(f) {
    this.fotoFilmes.set(f.id, { inteiro: JSON.stringify(f), campos: camposFilme(f) });
  }
  aceitarRemocao(id, t) {
    this.fotoFilmes.delete(id);
    delete this.filmes[id];
    this.apagados[id] = Math.max(this.apagados[id] || 0, t);
  }
  aceitarConfig(config) {
    this.fotoConfig = Object.fromEntries(Object.entries(pedacosConfig(config)).map(([k, v]) => [k, json(v)]));
  }

  // Ao abrir: o estado carregado vira a referência. Campos sem marca (dados de
  // antes da sincronia, ou de um campo novo) ganham a hora de agora.
  //
  // Os sem marca ganham a marca mais antiga possível (1), não a de agora: assim
  // sobem para a nuvem se ela ainda não tiver aquele dado, mas nunca passam por
  // cima de algo que já está lá. (Um arquivo antigo posto no lugar do atual não
  // pode desfazer o que foi feito nos outros aparelhos.)
  iniciar(filmes, config) {
    const ANTIGA = 1;
    for (const f of filmes) {
      const campos = camposFilme(f);
      const m = this.filmes[f.id] || (this.filmes[f.id] = {});
      for (const k of Object.keys(campos)) if (!m[k]) m[k] = ANTIGA;
      this.fotoFilmes.set(f.id, { inteiro: JSON.stringify(f), campos });
      delete this.apagados[f.id];
    }
    // Um filme com marca que não está na lista ao abrir NÃO conta como apagado:
    // só apagar de verdade, com o app aberto, vira exclusão. Aqui a marca é
    // esquecida, e se o filme existir na nuvem ele volta na próxima sincronia.
    const vivos = new Set(filmes.map((f) => f.id));
    for (const id of Object.keys(this.filmes)) if (!vivos.has(id)) delete this.filmes[id];

    const p = pedacosConfig(config);
    for (const k of Object.keys(p)) if (!this.config[k]) this.config[k] = ANTIGA;
    this.fotoConfig = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, json(v)]));
    this.gravar();
  }

  // Compara a lista com a da última gravação e marca o que mudou. Devolve se mudou algo.
  registrarFilmes(filmes) {
    let mudou = false;
    const vistos = new Set();
    for (const f of filmes) {
      vistos.add(f.id);
      const inteiro = JSON.stringify(f);
      const antes = this.fotoFilmes.get(f.id);
      if (antes && antes.inteiro === inteiro) continue;
      const campos = camposFilme(f);
      const m = this.filmes[f.id] || (this.filmes[f.id] = {});
      if (!antes) {
        // Filme novo (ou devolvido pelo "Desfazer"): tudo nele é de agora.
        const t = this.agora();
        for (const k of Object.keys(campos)) m[k] = t;
        delete this.apagados[f.id];
        mudou = true;
      } else {
        for (const k of new Set([...Object.keys(campos), ...Object.keys(antes.campos)])) {
          if (campos[k] !== antes.campos[k]) { m[k] = this.agora(); mudou = true; }
        }
      }
      this.fotoFilmes.set(f.id, { inteiro, campos });
    }
    for (const id of [...this.fotoFilmes.keys()]) {
      if (vistos.has(id)) continue;
      this.fotoFilmes.delete(id);
      delete this.filmes[id];
      this.apagados[id] = this.agora();
      mudou = true;
    }
    if (mudou) this.gravar();
    return mudou;
  }

  registrarConfig(config) {
    let mudou = false;
    const p = pedacosConfig(config);
    const agora = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, json(v)]));
    for (const k of new Set([...Object.keys(agora), ...Object.keys(this.fotoConfig)])) {
      if (agora[k] !== this.fotoConfig[k]) { this.config[k] = this.agora(); mudou = true; }
    }
    this.fotoConfig = agora;
    if (mudou) this.gravar();
    return mudou;
  }

  gravar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ versao: 1, ultima: this.ultima, filmes: this.filmes, apagados: this.apagados, config: this.config }), 'utf8');
    fs.renameSync(tmp, this.arquivo);
  }
}

module.exports = { Marcas, pedacosConfig, camposFilme, CAMPOS_LOCAIS, CONFIG_SINC };
