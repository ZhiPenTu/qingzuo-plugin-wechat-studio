import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  bundleFileName,
  exportBundle,
  sanitizeConfigForExport,
  sanitizeTextForExport,
  sanitizeYamlForExport,
  stripSecrets,
} from '../src/lib/bundle.mjs';

test('bundle export removes all secrets and model endpoints', () => {
  const result = sanitizeConfigForExport(`
article_category: 内容创作
tone: 口语化
writing_model:
  api_key: secret
  base_url: https://private.example
wechat_accounts:
  - appid: wx123
    appsecret: secret
unknown_extension:
  keep: true
`);
  assert.doesNotMatch(result.text, /secret|private\.example|wx123/);
  assert.match(result.text, /unknown_extension/);
  assert.ok(result.removed.includes('writing_model'));
  assert.ok(result.removed.includes('wechat_accounts'));
});

test('generic recursive secret stripper reports dotted paths', () => {
  const result = stripSecrets({ a: { api_key: 'x', keep: 1 }, token: 'y' });
  assert.deepEqual(result.value, { a: { keep: 1 } });
  assert.deepEqual(result.removed.sort(), ['a.api_key', 'token']);
});

test('preset YAML strips block scalars, flow maps and nested credential lists', () => {
  const result = sanitizeYamlForExport(`
profile:
  appsecret: |
    leaked-line
  access_token: leaked-token
candidates:
  - api_key: leaked-key
    keep: true
flow: { appid: wx-secret, keep: yes }
`, 'presets/components/card.yaml');
  assert.doesNotMatch(result.text, /leaked-line|leaked-token|leaked-key|wx-secret/);
  assert.match(result.text, /keep: true/);
  assert.ok(result.removed.includes('presets/components/card.yaml.profile.appsecret'));
  assert.ok(result.removed.includes('presets/components/card.yaml.candidates[0].api_key'));
});

test('text export strips frontmatter and fenced YAML credentials', () => {
  const removed = [];
  const result = sanitizeTextForExport(`---
default_author: 小轻
appsecret: leaked-frontmatter
---
# 写作规范

\`\`\`yaml
writing_model:
  api_key: leaked-fenced
keep: yes
\`\`\`

token: |
  leaked-inline
keep: yes
`, 'writing-spec.md', removed);
  assert.doesNotMatch(result, /leaked-/);
  assert.match(result, /keep: yes/);
  assert.ok(removed.length >= 3);
});

test('text export strips inline JSON, arrays, URL queries and shell secrets', () => {
  const removed = [];
  const result = sanitizeTextForExport(`{"apiKey":"leaked-inline"}
[{"token":"leaked-array"}]
curl "https://api.example.com?token=leaked-url&keep=yes"
export OPENAI_API_KEY=leaked-shell
Authorization: Bearer leaked-bearer
规范正文保持。`, 'writing-spec.md', removed);
  assert.doesNotMatch(result, /leaked-/);
  assert.match(result, /规范正文保持/);
  assert.match(result, /keep=yes/);
  assert.ok(removed.length >= 5);
});

test('text export fails closed for recognizable unkeyed secret material', () => {
  assert.throws(
    () => sanitizeTextForExport('token material\n-----BEGIN PRIVATE KEY-----\nleaked\n', 'writing-spec.md', []),
    /无法安全剥离/,
  );
});

test('bundle filename is stable and dated', () => {
  assert.equal(bundleFileName(new Date(2026, 10, 3, 9, 7)), 'wechat-studio-20261103-0907.aws');
});

test('a whitelisted map can be zipped and read back', () => {
  const files = { 'config.yaml': new TextEncoder().encode('tone: 口语化\n') };
  const zipped = unzipSync(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.deepEqual(Object.keys(zipped), []);
  assert.equal(strFromU8(files['config.yaml']), 'tone: 口语化\n');
});

test('exportBundle produces a real whitelisted ZIP with presets and no secrets', async () => {
  const files = new Map([
    ['.aws-article/config.yaml', 'tone: 口语化\nwriting_model:\n  api_key: secret\nunknown: keep\n'],
    ['.aws-article/writing-spec.md', '# 写作规范\n'],
    ['.aws-article/presets/components/card.yaml', 'name: card\nappsecret: |\n  leaked-preset\nkeep: true\n'],
    ['.aws-article/presets/formatting/main.css', '.main{}\n'],
    ['.aws-article/private.env', 'SECRET=x\n'],
  ]);
  const api = {
    workspace: {
      async readText({ path }) {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
      async list({ path }) {
        return [...files.keys()]
          .filter(name => name.startsWith(path + '/'))
          .map(name => ({ path: name, name: name.split('/').pop(), kind: 'file', size: 1, mtime: 1 }));
      },
    },
  };
  const result = await exportBundle(api, new Date(2026, 10, 3, 9, 7));
  const unpacked = unzipSync(result.bytes);
  assert.deepEqual(Object.keys(unpacked).sort(), [
    'config.yaml',
    'presets/components/card.yaml',
    'presets/formatting/main.css',
    'writing-spec.md',
  ]);
  assert.doesNotMatch(strFromU8(unpacked['config.yaml']), /secret|api_key/);
  assert.doesNotMatch(strFromU8(unpacked['presets/components/card.yaml']), /leaked-preset|appsecret/);
  assert.match(strFromU8(unpacked['presets/components/card.yaml']), /keep: true/);
  assert.match(strFromU8(unpacked['config.yaml']), /unknown: keep/);
  assert.equal(result.filename, 'wechat-studio-20261103-0907.aws');
});
