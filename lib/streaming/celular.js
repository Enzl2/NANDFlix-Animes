// nandchan no celular: lê as listas da Crunchyroll pelo navegador dentro do
// app (o plugin InAppBrowser). O app abre o site, põe o script da página
// (crunchyroll.scriptCelular) a cada página carregada e espera a mensagem com
// as listas, que o script manda sozinho assim que acha a conta da pessoa.
// Fechar o navegador antes disso cancela. Separado do resto do app do celular
// para dar para testar sem um aparelho (o navegador entra como parâmetro).

const crunchyroll = require('./crunchyroll');

const erro = (mensagem, tipo) => Object.assign(new Error(mensagem), tipo ? { tipo } : {});

// Devolve as listas: [{ nome, origem, itens: [{ titulo, filme, favorito }] }].
function lerCrunchyrollNoCelular(navegador, { limite = 15 * 60 * 1000 } = {}) {
  return new Promise((ok, falhou) => {
    const alcas = [];
    let acabou = false;
    let tempo = null;
    const terminar = (fn, valor) => {
      if (acabou) return;
      acabou = true;
      clearTimeout(tempo);
      for (const a of alcas) Promise.resolve(a).then((h) => h && h.remove()).catch(() => {});
      Promise.resolve().then(() => navegador.close()).catch(() => {}); // já fechado pela pessoa: tudo bem
      fn(valor);
    };
    // A cada página carregada o script entra de novo (ele mesmo não se repete).
    alcas.push(navegador.addListener('browserPageLoaded', () => {
      Promise.resolve().then(() => navegador.executeScript({ code: crunchyroll.scriptCelular() })).catch(() => {});
    }));
    alcas.push(navegador.addListener('messageFromWebview', (e) => {
      const d = e && e.detail;
      if (d && d.tipo === 'listas' && Array.isArray(d.listas)) terminar(ok, d.listas);
    }));
    alcas.push(navegador.addListener('closeEvent', () => terminar(falhou, erro('Janela fechada antes de terminar.', 'cancelado'))));
    tempo = setTimeout(() => terminar(falhou, erro('O tempo para ler as listas acabou.', 'tempo')), limite);
    Promise.all(alcas)
      .then(() => navegador.openWebView({
        url: `${crunchyroll.SITE}/watchlist`,
        title: 'Importar da Crunchyroll',
        preventDeeplink: true, // os links da Crunchyroll não abrem o app dela
        isPresentAfterPageLoad: false,
      }))
      .catch((e) => terminar(falhou, erro(`Não deu para abrir a Crunchyroll: ${e && e.message ? e.message : e}`)));
  });
}

module.exports = { lerCrunchyrollNoCelular };
