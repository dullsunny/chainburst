import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const configPath = resolve('dist/server/wrangler.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const database = config.d1_databases?.find(({ binding }) => binding === 'DB');
if (!database?.migrations_dir) {
  throw new Error('The generated Wrangler configuration is missing DB migrations.');
}

// The Vite plugin keeps D1 migration paths relative to the source project.
// Rebase them for Wrangler commands that explicitly use the generated file.
database.migrations_dir = relative(dirname(configPath), resolve(database.migrations_dir)).split(sep).join('/');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
