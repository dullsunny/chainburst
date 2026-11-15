import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = new URL('../', import.meta.url);
const licensesFilename = 'THIRD-PARTY-LICENSES.md';
const result = await build({
  root: fileURLToPath(root),
  configFile: fileURLToPath(new URL('vite.offline.config.ts', root)),
  mode: 'production',
  build: { write: false },
});
const files = Array.isArray(result) ? result.flatMap((output) => output.output) : result.output;
const scripts = files.filter((file) => file.type === 'chunk');
const styles = files.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'));
const jsLicenses = files.find((file) => file.type === 'asset' && file.fileName === licensesFilename);
if (scripts.length !== 1 || styles.length !== 1 || !jsLicenses || files.length !== 3) {
  throw new Error('The offline edition must contain a single script and stylesheet without external assets.');
}

const [script] = scripts;
const [style] = styles;
if (script.imports.length || script.dynamicImports.length) {
  throw new Error('The offline edition must be loadable directly from a file.');
}
const favicon = await readFile(new URL('public/favicon.svg', root));
const scriptText = script.code.replace(/<\/script/gi, '<\\/script');
const styleText = String(style.source).replace(/<\/style/gi, '<\\/style');
const cssLicenses = await Promise.all([
  ['tailwindcss', 'LICENSE'],
  ['tw-animate-css', 'LICENSE'],
  ['shadcn', 'LICENSE.md'],
].map(async ([name, licenseFile]) => {
  const directory = new URL(`node_modules/${name}/`, root);
  const version = JSON.parse(await readFile(new URL('package.json', directory), 'utf8')).version;
  const contents = await readFile(new URL(licenseFile, directory), 'utf8');
  return `## ${name} ${version}\n\n${contents.trim()}`;
}));
const notices = [String(jsLicenses.source).trim(), ...cssLicenses].join('\n\n') + '\n';
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob: data:">
  <title>爆炸棋 · 单机版</title>
  <link rel="icon" href="data:image/svg+xml;base64,${favicon.toString('base64')}">
  <style>${styleText}</style>
</head>
<body class="antialiased">
  <div id="root"></div>
  <noscript>请在浏览器中启用 JavaScript 后重新打开本文件。</noscript>
  <script>${scriptText}</script>
</body>
</html>
<!-- Third-party licenses
${notices.replaceAll('-->', '--&gt;')}-->
`;

const directory = new URL('outputs/offline/', root);
const filename = new URL('chainburst-offline.html', directory);
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(filename, html),
  writeFile(new URL(licensesFilename, directory), notices),
]);
console.log(fileURLToPath(filename));
