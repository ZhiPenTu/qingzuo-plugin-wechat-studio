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
  const scrubStructured = (value, format) => {
    try {
      const parsed = format === 'json' ? JSON.parse(value) : YAML.parse(value);
      const stripped = stripSecrets(parsed);
      for (const key of stripped.removed) removed.push(label + '.' + key);
      return format === 'json'
        ? JSON.stringify(stripped.value, null, 2) + '\n'
        : YAML.stringify(stripped.value, { lineWidth: 0 });
    } catch {
      return scrubSensitiveLines(value, label, removed);
    }
  };

  let result = source.replace(
    /^---\r?\n([\s\S]*?)\r?\n---/,
    (_match, body) => '---\n' + scrubStructured(body, 'yaml') + '---',
  );
  result = result.replace(
    /(```ya?ml[^\n]*\r?\n)([\s\S]*?)(```)/gi,
    (_match, start, body, end) => start + scrubStructured(body, 'yaml') + end,
  );
  result = result.replace(
    /(```json[^\n]*\r?\n)([\s\S]*?)(```)/gi,
    (_match, start, body, end) => start + scrubStructured(body, 'json') + end,
  );
  result = scrubSensitiveLines(result, label, removed);
  result = scrubInlineSecrets(result, label, removed);
  assertNoSecretMaterial(result, label);
  return result;
}

function scrubInlineSecrets(source, label, removed) {
  const keyValue = /(["']?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)(?!\/\/)((?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,}\]&]+))/g;
  let result = String(source || '');
  result = result.replace(
    /(authorization\s*:\s*)(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    (_match, prefix) => {
      removed.push(label + '.authorization');
      return prefix + '[已移除]';
    },
  );
  result = result.replace(
    /([?&])([A-Za-z0-9_.-]+)(=)([^&\s"'<>]+)/g,
    (match, prefix, key, separator) => {
      if (!isSensitiveKey(key)) return match;
      removed.push(label + '.' + key);
      return prefix + key + separator + '[已移除]';
    },
  );
  result = result.replace(keyValue, (match, quote, key, separator, value) => {
    if (!isSensitiveKey(key)) return match;
    const bare = value.replace(/^["']|["']$/g, '');
    if (bare === '|' || bare === '>' || bare.startsWith('[已移除]')) return match;
    removed.push(label + '.' + key);
    return quote + key + quote + separator + '[已移除]';
  });
  return result;
}

function assertNoSecretMaterial(source, label) {
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  if (forbidden.some(pattern => pattern.test(source))) {
    throw new Error(label + ' 仍包含无法安全剥离的密钥，已停止导出。');
  }
}

function scrubSensitiveLines(source, label, removed) {
  const lines = String(source || '').split(/\r?\n/);
  const output = [];
  let blockIndent = null;
  for (const line of lines) {
    if (blockIndent !== null) {
      if (!line.trim()) {
        output.push('');
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length || 0;
      if (indent > blockIndent) {
        output.push('');
        continue;
      }
      blockIndent = null;
    }
    const match = line.match(/^(\s*(?:-\s+)?)(["']?)([A-Za-z0-9_.-]+)\2\s*([:=])\s*(.*)$/);
    if (match && isSensitiveKey(match[3])) {
      const indent = line.match(/^\s*/)?.[0] || '';
      output.push(indent + (match[1].includes('-') ? '- ' : '') + match[3] + match[4] + ' [已移除]');
      removed.push(label + '.' + match[3]);
      const value = match[5].trim();
      if (!value || value.startsWith('|') || value.startsWith('>')) blockIndent = indent.length;
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

export function sanitizeConfigForExport(text) {
  if (!String(text || '').trim()) return { text: '', removed: [] };
  const parsed = YAML.parse(String(text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('config.yaml 根节点必须是对象。');
  const { value, removed } = stripSecrets(parsed);
  return { text: YAML.stringify(value, { lineWidth: 0 }), removed };
}

export function sanitizeYamlForExport(text, label = 'yaml') {
  if (!String(text || '').trim()) return { text: '', removed: [] };
  let parsed;
  try {
    parsed = YAML.parse(String(text));
  } catch {
    throw new Error(label + ' 无法解析，已停止导出。');
  }
  const { value, removed } = stripSecrets(parsed);
  return {
    text: value === null ? '' : YAML.stringify(value, { lineWidth: 0 }),
    removed: removed.map(key => label + '.' + key),
  };
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
      if (/\.ya?ml$/i.test(relative)) {
        const sanitizedPreset = sanitizeYamlForExport(text, label);
        removed.push(...sanitizedPreset.removed);
        files[label] = strToU8(sanitizedPreset.text);
      } else {
        files[label] = strToU8(sanitizeTextForExport(text, label, removed));
      }
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
