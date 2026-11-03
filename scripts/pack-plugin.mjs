#!/usr/bin/env node
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { artifactName, catalogFor, REPOSITORY, resolvePlatform } from './release-utils.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const platform = resolvePlatform(process.argv[2]);
const output = path.join(root, 'release');
const included = new Set([
  'LICENSE',
  'NOTICE',
  'README.md',
]);
const includedDirectories = ['ui'];

async function collect(directory, prefix = '') {
  const files = {};
  for (const name of (await readdir(directory)).sort()) {
    const filename = path.join(directory, name);
    const relative = prefix ? prefix + '/' + name : name;
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error('插件包不能包含符号链接。');
    if (info.isDirectory()) {
      Object.assign(files, await collect(filename, relative));
      continue;
    }
    if (!info.isFile()) throw new Error('插件包包含不支持的文件类型。');
    if (prefix === '' && !included.has(relative) && !includedDirectories.includes(relative)) continue;
    files[relative] = new Uint8Array(await readFile(filename));
  }
  return files;
}

const files = {};
files['package.json'] = new TextEncoder().encode(JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  commerce: pkg.commerce,
}, null, 2) + '\n');
for (const name of included) files[name] = new Uint8Array(await readFile(path.join(root, name)));
for (const directory of includedDirectories) Object.assign(files, await collect(path.join(root, directory), directory));
if (!files['ui/index.html']) throw new Error('缺少 ui/index.html，请先运行 npm run build。');

const bytes = zipSync(files, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') });
await mkdir(output, { recursive: true });
const name = artifactName(pkg, platform);
const artifact = path.join(output, name);
const catalogName = 'catalog-' + platform + '.json';
const catalog = catalogFor(pkg, platform, bytes);
await writeFile(artifact, bytes);
await writeFile(path.join(output, catalogName), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({
  id: pkg.commerce.id,
  version: pkg.version,
  platform,
  repository: REPOSITORY,
  bytes: bytes.length,
  sha256: catalog.plugins[0].artifacts[platform].sha256,
  artifacts: ['release/' + name],
  catalog: 'release/' + catalogName,
  files: Object.keys(files).sort(),
}, null, 2));

