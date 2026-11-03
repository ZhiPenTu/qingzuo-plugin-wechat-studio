#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = pkg.commerce;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(pkg.version === '0.1.0', '版本号必须与首个发布版本 0.1.0 一致。');
assert(manifest?.manifestVersion === 1, 'manifestVersion 必须为 1。');
assert(manifest.id === 'official.wechat-studio', '插件标识必须为 official.wechat-studio。');
assert(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id), '插件标识格式无效。');
assert(manifest.title === '公众号 AI 工作台', '插件名称无效。');
assert(manifest.category === '内容创作', '插件分类无效。');
assert(manifest.api === '^1.9.0', '插件 API 必须固定为 ^1.9.0。');
assert(typeof manifest.ui === 'string' && !path.isAbsolute(manifest.ui) && !manifest.ui.includes('..'), '插件界面路径无效。');
assert(!manifest.backend, '纯前端插件不能声明本机后端。');

const permissions = manifest.permissions || {};
const allowed = new Set(['files', 'storage', 'ai', 'workspace', 'mcp', 'wechat']);
for (const key of Object.keys(permissions)) assert(allowed.has(key), '存在未支持的权限：' + key);
assert(permissions.files === true && permissions.storage === true && permissions.workspace === true, '缺少基础权限。');
assert(Array.isArray(permissions.ai) && permissions.ai.every(value => ['text', 'image-edit'].includes(value)), 'AI 权限无效。');
assert(Array.isArray(permissions.mcp) && permissions.mcp.length === 1 && permissions.mcp[0] === 'read', 'MCP 权限必须只读。');
assert(Array.isArray(permissions.wechat) && permissions.wechat.every(value => ['draft', 'publish', 'list'].includes(value)), '微信权限无效。');
assert(!('network' in permissions), '插件不能声明任意网络权限。');

await access(path.join(root, manifest.ui));
await access(path.join(root, 'ui', 'assets'));
await access(path.join(root, 'LICENSE'));
await access(path.join(root, 'NOTICE'));
console.log('插件清单与构建产物有效。');

