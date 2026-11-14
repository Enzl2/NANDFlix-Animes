// node montar.js: monta mobile/www (o que vai dentro do app de Android) a partir
// da interface do PC (../src) e da ponte do celular (api/).
//
// - api/index.js vira um arquivo só (api-celular.js), com o código de lib/
//   compartilhado com o PC; fs, path e crypto do Node trocados pelos do celular.
// - Os arquivos de ../src são copiados, e o index.html ganha a ponte, o CSS e
//   os ajustes de celular (web/), a tela do tamanho do aparelho e a política de
//   segurança que deixa falar com o Supabase, o TMDB e o OMDb direto daqui.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const AdmZip = require('adm-zip');

const AQUI = __dirname;
const SRC = path.join(AQUI, '..', 'src');
const WWW = path.join(AQUI, 'www');

function nuvemConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(AQUI, '..', 'lib', 'nuvem.config.json'), 'utf8')); } catch { return null; }
}

async function montar() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });

  // 1. A interface do PC.
  fs.cpSync(SRC, WWW, {
    recursive: true,
    filter: (p) => !/[\\/]amostras([\\/]|$)/.test(p) && !/[\\/]fonts[\\/](big-shoulders|instrument-sans)/.test(p),
  });

  // 2. Ícones (no PC vêm de ../node_modules).
  fs.mkdirSync(path.join(WWW, 'vendor'), { recursive: true });
  fs.copyFileSync(path.join(AQUI, '..', 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js'), path.join(WWW, 'vendor', 'lucide.min.js'));

  // 3. A ponte do celular.
  await esbuild.build({
    entryPoints: [path.join(AQUI, 'api', 'index.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    outfile: path.join(WWW, 'api-celular.js'),
    alias: {
      fs: path.join(AQUI, 'api', 'fs-shim.js'),
      crypto: path.join(AQUI, 'api', 'crypto-shim.js'),
      path: require.resolve('path-browserify'),
    },
    // Sem lib/nuvem.config.json (versão pública), o app fica sem nuvem.
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis', NUVEM_CONFIG: JSON.stringify(nuvemConfig()), APP_VERSAO: JSON.stringify(require('./package.json').version) },
    nodePaths: [path.join(AQUI, 'node_modules'), path.join(AQUI, '..', 'node_modules')],
    loader: { '.json': 'json' },
    minify: true,
    sourcemap: false,
    logLevel: 'warning',
  });

  // 3b. O histórico dos prêmios (lib/premios-<id>.json): um arquivo por prêmio, lido quando usado.
  fs.mkdirSync(path.join(WWW, 'premios'), { recursive: true });
  for (const n of fs.readdirSync(path.join(AQUI, '..', 'lib'))) {
    const m = n.match(/^premios-(\w+)\.json$/);
    if (m) fs.copyFileSync(path.join(AQUI, '..', 'lib', n), path.join(WWW, 'premios', `${m[1]}.json`));
  }

  // 4. Ajustes de celular.
  for (const n of fs.readdirSync(path.join(AQUI, 'web'))) fs.copyFileSync(path.join(AQUI, 'web', n), path.join(WWW, n));

  // 5. O index.html.
  let html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const trocar = (de, para) => {
    if (!html.includes(de)) throw new Error(`index.html: não achei ${de.slice(0, 60)}`);
    html = html.replace(de, () => para);
  };
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/,
    `<meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self' https: wss:; frame-src https://www.youtube-nocookie.com">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#050608">`);
  trocar('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="celular.css">\n  <link rel="stylesheet" href="inicio.css">\n  <link rel="stylesheet" href="detalhes.css">\n  <link rel="stylesheet" href="telas.css">\n  <link rel="stylesheet" href="calendario.css">\n  <link rel="stylesheet" href="tierlist.css">\n  <link rel="stylesheet" href="visual-celular.css">');
  trocar('<script src="../node_modules/lucide/dist/umd/lucide.min.js"></script>', '<script src="vendor/lucide.min.js"></script>\n  <script src="api-celular.js"></script>');
  trocar('<script src="busca.js"></script>', '<script src="busca.js"></script>\n  <script src="celular.js"></script>\n  <script src="inicio.js"></script>\n  <script src="detalhes.js"></script>\n  <script src="calendario.js"></script>\n  <script src="tierlist.js"></script>');
  trocar('<script src="jogos-lista.js"></script>', '<script src="jogos-lista.js"></script>\n  <script src="jogos-celular.js"></script>'); // nandplay: o celular
  // Na versão do GitHub a fonte (Montserrat) vem de ../node_modules: vai junto para dentro do app.
  const FONTE = '../node_modules/@fontsource/montserrat/';
  if (html.includes(FONTE)) {
    fs.cpSync(path.join(AQUI, '..', 'node_modules', '@fontsource', 'montserrat'), path.join(WWW, 'vendor', 'montserrat'), {
      recursive: true,
      filter: (p) => !/\.(md|json)$/.test(p) && !/files[\\/].*-(cyrillic|greek|vietnamese)/.test(p),
    });
    html = html.split(FONTE).join('vendor/montserrat/');
  }
  fs.writeFileSync(path.join(WWW, 'index.html'), html);

  // 6. Versão e pacote de atualização (o app do PC publica, o celular baixa sozinho).
  const d = new Date();
  const dois = (n) => String(n).padStart(2, '0');
  const versao = `${d.getFullYear()}.${dois(d.getMonth() + 1)}.${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
  fs.writeFileSync(path.join(WWW, 'versao.json'), JSON.stringify({ versao }));
  const PACOTE = path.join(AQUI, 'pacote');
  fs.rmSync(PACOTE, { recursive: true, force: true });
  fs.mkdirSync(PACOTE, { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(WWW);
  const arquivo = `nandflix-${versao}.zip`;
  zip.writeZip(path.join(PACOTE, arquivo));
  fs.writeFileSync(path.join(PACOTE, 'versao.json'), JSON.stringify({ versao, arquivo }));

  const kb = Math.round(fs.statSync(path.join(WWW, 'api-celular.js')).size / 1024);
  console.log(`ok: mobile/www montado (api-celular.js com ${kb} KB), versão ${versao}`);
}

montar().catch((e) => { console.error(e.message || e); process.exit(1); });
