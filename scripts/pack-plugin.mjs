#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release');
const included = new Set([
  'package.json',
  'LICENSE',
  'NOTICE',
  'README.md',
]);
const includedDirectories = ['ui'];

async function collect(directory, prefix = '') {
  const files = {};
  for (const name of await readdir(directory)) {
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
for (const name of included) files[name] = new Uint8Array(await readFile(path.join(root, name)));
for (const directory of includedDirectories) Object.assign(files, await collect(path.join(root, directory), directory));
if (!files['ui/index.html']) throw new Error('缺少 ui/index.html，请先运行 npm run build。');

const bytes = zipSync(files, { level: 9 });
const sha256 = createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const names = [
  'official.wechat-studio-' + pkg.version + '-darwin-arm64.ecplugin',
  'official.wechat-studio-' + pkg.version + '-win32-x64.ecplugin',
];
for (const name of names) await writeFile(path.join(output, name), bytes);
console.log(JSON.stringify({
  id: pkg.commerce.id,
  version: pkg.version,
  bytes: bytes.length,
  sha256,
  artifacts: names.map(name => 'release/' + name),
  files: Object.keys(files).sort(),
}, null, 2));

