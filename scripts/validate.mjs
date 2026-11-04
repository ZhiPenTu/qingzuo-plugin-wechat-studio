#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const manifest = pkg.commerce;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/^\d+\.\d+\.\d+$/.test(pkg.version), '插件版本必须为稳定的三段式版本号。');
assert(lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, 'package-lock.json 版本与插件版本不一致。');
assert(manifest?.manifestVersion === 1, 'manifestVersion 必须为 1。');
assert(manifest.id === 'official.wechat-studio', '插件标识必须为 official.wechat-studio。');
assert(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id), '插件标识格式无效。');
assert(manifest.title === '公众号 AI 工作台', '插件名称无效。');
assert(manifest.category === '内容创作', '插件分类无效。');
assert(manifest.api === '^1.11.0', '插件 API 必须固定为 ^1.11.0。');
assert(typeof manifest.ui === 'string' && !path.isAbsolute(manifest.ui) && !manifest.ui.includes('..'), '插件界面路径无效。');
assert(!manifest.backend, '纯前端插件不能声明本机后端。');

const iconPrefix = 'data:image/png;base64,';
assert(typeof manifest.icon === 'string' && manifest.icon.startsWith(iconPrefix), '插件图标必须为 PNG data URL。');
const iconBytes = Buffer.from(manifest.icon.slice(iconPrefix.length), 'base64');
const iconAsset = await readFile(path.join(root, 'assets', 'icon.png'));
assert(iconBytes.equals(iconAsset), '插件图标必须与 assets/icon.png 完全一致。');
assert(iconBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), '插件图标不是有效 PNG。');
assert(iconBytes.readUInt32BE(16) === 512 && iconBytes.readUInt32BE(20) === 512, '插件图标必须为 512x512。');
let iconOffset = 8;
let iconEnded = false;
while (iconOffset + 12 <= iconBytes.length) {
  const length = iconBytes.readUInt32BE(iconOffset);
  const type = iconBytes.subarray(iconOffset + 4, iconOffset + 8).toString('ascii');
  iconOffset += 12 + length;
  if (iconOffset > iconBytes.length) throw new Error('插件图标 PNG 数据不完整。');
  if (type === 'IEND') {
    iconEnded = true;
    break;
  }
}
assert(iconEnded && iconOffset === iconBytes.length, '插件图标 PNG 缺少完整 IEND。');

const permissions = manifest.permissions || {};
const allowed = new Set(['files', 'storage', 'ai', 'workspace', 'mcp', 'wechat']);
for (const key of Object.keys(permissions)) assert(allowed.has(key), '存在未支持的权限：' + key);
assert(permissions.files === true && permissions.storage === true && permissions.workspace === true, '缺少基础权限。');
assert(Array.isArray(permissions.ai) && permissions.ai.every(value => ['text', 'image-edit'].includes(value)), 'AI 权限无效。');
assert(Array.isArray(permissions.mcp) && permissions.mcp.length === 1 && permissions.mcp[0] === 'read', 'MCP 权限必须声明为 read；具体工具仍需逐项授权。');
assert(Array.isArray(permissions.wechat) && permissions.wechat.every(value => ['draft', 'publish', 'list'].includes(value)), '微信权限无效。');
assert(!('network' in permissions), '插件不能声明任意网络权限。');

await access(path.join(root, manifest.ui));
await access(path.join(root, 'ui', 'assets'));
await access(path.join(root, 'LICENSE'));
await access(path.join(root, 'NOTICE'));
console.log('插件清单与构建产物有效。');

