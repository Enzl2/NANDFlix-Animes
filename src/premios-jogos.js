'use strict';

// Prêmios de jogos: contas puras (sem tela), usadas por premios.js e testadas em
// scripts/testar-premios-jogos.js (por isso o module.exports no fim).

// "Já jogou": começou o jogo (jogando, pausado, zerado, 100% ou largou). "Quero jogar" ainda não é
// jogar, e o palpite nunca conta: a conta é só pelo status do jogo na lista.
const STATUS_JOGOU = ['jogando', 'pausado', 'zerado', 'cem', 'larguei'];
const jogoJogado = (f) => Boolean(f) && STATUS_JOGOU.includes(f.status);

// Quantos dos jogos (itens da lista, ou null/undefined quando não estão nela) já foram jogados.
const contarJogados = (itens) => itens.filter(jogoJogado).length;

// Nas páginas da Wikipédia, o indicado vem como "Jogo – Desenvolvedor/Publicadora": o texto depois do
// travessão chega em `extra`. O desenvolvedor é a parte antes da primeira "/".
const CATEGORIA_DE_CREDITO = /score|music|m[uú]sica|trilha/i; // aqui o extra é o compositor, não o estúdio
function desenvolvedorDoIndicado(x, f = null, chaveCategoria = '') {
  const extra = String((x && x.extra) || '').trim();
  const doItem = f && Array.isArray(f.desenvolvedores) && f.desenvolvedores[0] && f.desenvolvedores[0].nome;
  let desenvolvedor = '';
  let credito = '';
  if (extra.includes('/')) desenvolvedor = extra.split(/\s*\/\s*/)[0].trim();
  else if (CATEGORIA_DE_CREDITO.test(chaveCategoria)) credito = extra;
  else desenvolvedor = extra;
  if (doItem) desenvolvedor = doItem; // o jogo está na sua lista: o nome dele é o certo
  return { desenvolvedor, credito };
}

// A inicial grande dos indicados que são pessoas ou times: até duas letras ("Team Liquid" → "TL").
function inicialDe(nome) {
  const palavras = String(nome || '').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  return palavras.slice(0, 2).map((p) => (p.match(/[\p{L}\p{N}]/u) || [''])[0].toLocaleUpperCase('pt-BR')).join('') || '?';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { jogoJogado, contarJogados, desenvolvedorDoIndicado, inicialDe, STATUS_JOGOU };
