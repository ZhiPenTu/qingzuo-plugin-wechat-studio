#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { artifactName, resolvePlatform } from './release-utils.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const platform = resolvePlatform(process.argv[2]);
const name = artifactName(pkg, platform);
const bytes = new Uint8Array(await readFile(path.join(root, 'release', name)));
const catalog = JSON.parse(await readFile(path.join(root, 'release', 'catalog-' + platform + '.json'), 'utf8'));
const files = unzipSync(bytes);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const normalized = Object.keys(files);
assert(normalized.length > 0 && normalized.length < 20000, '插件包文件数量无效。');
for (const filename of normalized) {
  assert(!filename.startsWith('/') && !filename.includes('\\') && !filename.split('/').includes('..'), '插件包包含越界路径。');
}

const packaged = JSON.parse(strFromU8(files['package.json']));
assert(packaged.version === pkg.version, '插件包版本与 package.json 不一致。');
assert(packaged.commerce?.id === pkg.commerce.id, '插件包标识与发布清单不一致。');
assert(files[pkg.commerce.ui], '插件包缺少声明的主界面。');
assert(!Object.keys(files).some(filename => filename.startsWith('node_modules/')), '插件包不能包含 node_modules。');

const entry = catalog.plugins?.[0];
assert(catalog.schemaVersion === 1 && catalog.plugins.length === 1, 'catalog 片段格式无效。');
assert(entry.id === pkg.commerce.id && entry.version === pkg.version, 'catalog 片段身份不一致。');
assert(entry.title === pkg.commerce.title && entry.description === pkg.commerce.description, 'catalog 片段说明不一致。');
assert(entry.api === pkg.commerce.api && entry.category === pkg.commerce.category, 'catalog 片段兼容信息不一致。');
const artifact = entry.artifacts?.[platform];
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert(artifact?.url === 'https://github.com/ZhiPenTu/qingzuo-plugin-wechat-studio/releases/download/v' + pkg.version + '/' + name, 'catalog 制品地址无效。');
assert(artifact.size === bytes.length && artifact.sha256 === sha256, 'catalog 制品大小或摘要不一致。');

console.log('插件包与 ' + platform + ' catalog 片段校验通过：' + sha256);
