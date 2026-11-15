import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'outputs', 'release');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const placeholder = '00000000-0000-4000-8000-000000000000';
const workerConfig = JSON.parse(await readFile(join(root, 'dist', 'server', 'wrangler.json'), 'utf8'));
const database = workerConfig.d1_databases?.[0];
if (workerConfig.d1_databases?.length !== 1 || database?.binding !== 'DB'
    || database.database_id !== placeholder || database.database_name !== 'chainburst') {
  throw new Error('Use the default database placeholder in wrangler.jsonc before building a public release.');
}

await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.staging-'));

function zip(parent, archive, directory) {
  const destination = join(output, archive);
  const [program, ...args] = process.platform === 'win32'
    ? ['tar.exe', '-a', '-cf', destination, '-C', parent, directory]
    : ['zip', '-q', '-r', destination, directory];
  const run = spawnSync(program, args, { cwd: parent, stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Could not package ${archive}`);
  return destination;
}

try {
  const offline = `chainburst-offline-v${version}`;
  const online = `chainburst-selfhost-v${version}`;
  const offlinePath = join(staging, offline);
  const onlinePath = join(staging, online);
  await mkdir(offlinePath);
  await mkdir(onlinePath);
  await cp(join(root, 'outputs', 'offline', 'chainburst-offline.html'), join(offlinePath, 'chainburst-offline.html'));
  await cp(join(root, 'outputs', 'offline', 'THIRD-PARTY-LICENSES.md'), join(offlinePath, 'THIRD-PARTY-LICENSES.md'));
  await cp(join(root, 'offline', 'PLAY-OFFLINE.md'), join(offlinePath, 'README.md'));
  const localBuildState = new Set(['.wrangler', 'vinext-server.json', '.dev.vars']);
  await cp(join(root, 'dist'), join(onlinePath, 'dist'), {
    recursive: true,
    filter: (path) => !localBuildState.has(basename(path)),
  });
  await cp(join(root, 'drizzle'), join(onlinePath, 'drizzle'), { recursive: true });
  await cp(join(root, 'docs', 'SELF-HOST.md'), join(onlinePath, 'README.md'));

  const extraLicenses = [];
  for (const name of ['tailwindcss', 'tw-animate-css', 'shadcn']) {
    const packagePath = join(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
    const license = (await readdir(packagePath)).find((path) => /^licen[cs]e(?:\.|$)/i.test(path));
    const licenseText = license ? await readFile(join(packagePath, license), 'utf8') : '';
    extraLicenses.push(`## ${name} ${pkg.version} (${pkg.license})\n\n${licenseText.trim()}`);
  }
  await writeFile(join(onlinePath, 'THIRD-PARTY-LICENSES.md'), [
    '# Third-party licenses',
    'JavaScript bundle notices are in the `.vite/license.md` files under `dist`. The following style sources are also included.',
    ...extraLicenses,
  ].join('\n\n') + '\n');
  for (const directory of [offlinePath, onlinePath]) {
    await cp(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  }

  const checksums = [];
  for (const directory of [offline, online]) {
    const archive = `${directory}.zip`;
    await rm(join(output, archive), { force: true });
    const path = zip(staging, archive, directory);
    const hash = createHash('sha256').update(await readFile(path)).digest('hex');
    checksums.push(`${hash}  ${archive}`);
    console.log(path);
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
} finally {
  await rm(staging, { force: true, recursive: true });
}
