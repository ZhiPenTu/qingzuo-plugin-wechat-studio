import YAML from 'yaml';
import { strToU8, zipSync } from 'fflate';
import { readOptional } from './project.mjs';

const PRESET_DIRS = [
  'closing-blocks',
  'cover-styles',
  'formatting',
  'image-styles',
  'sticker-styles',
  'structures',
  'title-styles',
  'components',
];
const SENSITIVE_KEYS = new Set([
  'appid',
  'appsecret',
  'wechatappid',
  'wechatappsecret',
  'wechatsecret',
  'wechataccounts',
  'writingmodel',
  'imagemodel',
  'apikey',
  'baseurl',
  'endpoint',
  'token',
  'secret',
  'secretkey',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'oauthtoken',
  'bearertoken',
  'authorization',
  'password',
  'passwd',
]);
const SECRET_KEY_PATTERN = '(?:api[_-]?key|app[_-]?secret|appsecret|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|bearer[_-]?token|base[_-]?url|endpoint)';

function normalizedKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(value) {
  const key = normalizedKey(value);
  return SENSITIVE_KEYS.has(key)
    || key.endsWith('apikey')
    || key.endsWith('appsecret')
    || key.endsWith('accesstoken')
    || key.endsWith('refreshtoken')
    || key.endsWith('clientsecret')
    || key.endsWith('secretkey');
}

function stripSecrets(value, removed = []) {
  if (!value || typeof value !== 'object') return value;
  const clone = structuredClone(value);
  const walk = (node, prefix = '') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, prefix + '[' + index + ']'));
      return;
    }
    for (const key of Object.keys(node)) {
      const dotted = prefix ? prefix + '.' + key : key;
      if (isSensitiveKey(key)) {
        delete node[key];
        removed.push(dotted);
      } else {
        walk(node[key], dotted);
      }
    }
  };
  walk(clone);
  return { value: clone, removed };
}

function sanitizeTextForExport(text, label, removed) {
  const source = String(text || '');
  if (!source) return '';
  const linePattern = new RegExp('^(\\s*' + SECRET_KEY_PATTERN + '\\s*[:=]\\s*).+$', 'gim');
  const jsonPattern = new RegExp('("(?:' + SECRET_KEY_PATTERN + ')"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"', 'gi');
  let changed = false;
  const result = source
    .replace(linePattern, (_match, prefix) => {
      changed = true;
      return prefix + '[已移除]';
    })
    .replace(jsonPattern, (_match, prefix) => {
      changed = true;
      return prefix + '"[已移除]"';
    });
  if (changed) removed.push(label);
  return result;
}

export function sanitizeConfigForExport(text) {
  if (!String(text || '').trim()) return { text: '', removed: [] };
  const parsed = YAML.parse(String(text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('config.yaml 根节点必须是对象。');
  const { value, removed } = stripSecrets(parsed);
  return { text: YAML.stringify(value, { lineWidth: 0 }), removed };
}

export function bundleFileName(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return 'wechat-studio-' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + '.aws';
}

export async function collectBundle(api) {
  const configText = await readOptional(api, '.aws-article/config.yaml');
  const sanitized = sanitizeConfigForExport(configText);
  const writingSpecSource = await readOptional(api, '.aws-article/writing-spec.md');
  const removed = [...sanitized.removed];
  const writingSpec = sanitizeTextForExport(writingSpecSource, 'writing-spec.md', removed);
  const files = {};
  if (sanitized.text) files['config.yaml'] = strToU8(sanitized.text);
  if (writingSpec.trim()) files['writing-spec.md'] = strToU8(writingSpec);
  for (const directory of PRESET_DIRS) {
    const entries = await api.workspace.list({ path: '.aws-article/presets/' + directory, recursive: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      const relative = entry.path.slice(('.aws-article/presets/' + directory + '/').length);
      const text = await api.workspace.readText({ path: entry.path, maxBytes: 2 * 1024 * 1024 });
      const label = 'presets/' + directory + '/' + relative;
      files[label] = strToU8(sanitizeTextForExport(text, label, removed));
    }
  }
  if (!Object.keys(files).length) throw new Error('当前工作区没有可导出的配置、写作规范或预设。');
  return { files, removed };
}

export async function exportBundle(api, date = new Date()) {
  const { files, removed } = await collectBundle(api);
  const bytes = zipSync(files, { level: 6 });
  return { bytes, filename: bundleFileName(date), removed, fileCount: Object.keys(files).length };
}

export async function saveBundle(api, result) {
  const data = bytesToBase64(result.bytes);
  const token = await api.files.create({ data, filename: result.filename, mime: 'application/zip' });
  try {
    return await api.files.save(token.token, result.filename);
  } finally {
    await api.files.release(token.token).catch(() => {});
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export { PRESET_DIRS, sanitizeTextForExport, stripSecrets };
