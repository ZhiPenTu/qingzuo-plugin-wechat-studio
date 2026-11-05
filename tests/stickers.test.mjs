import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigForSave } from '../src/lib/config.mjs';
import { buildStickerPrompt } from '../src/lib/prompts.mjs';
import {
  normalizeStickerLanguage,
  parseStickerSession,
  stickerCaptionPrefix,
  stickerCoverPath,
  stickerDocumentMarkdown,
  stickerImageItems,
  stickerPublicationFingerprintPayload,
  stickerPublishBlocked,
  stickerProjectMarkdown,
  stickerResetReceipt,
  stickerSessionSnapshot,
  withStickerLanguage,
} from '../src/lib/stickers.mjs';

const items = [
  { id: 's-1', prompt: '第一张', caption: '第一张配文' },
  { id: 's-2', prompt: '第二张', caption: '第二张配文' },
  { id: 's-3', prompt: '第三张', caption: '第三张配文' },
];

test('sticker language is normalized and enforced in prompts', () => {
  assert.equal(normalizeStickerLanguage('English'), 'English');
  assert.equal(normalizeStickerLanguage('unsupported'), '简体中文');
  assert.match(withStickerLanguage('a clean editorial illustration', '简体中文'), /统一主题语言/);
  assert.match(withStickerLanguage('a clean editorial illustration', '简体中文'), /简体中文/);
  assert.match(withStickerLanguage('a clean editorial illustration', 'English'), /English consistently/);
  assert.match(withStickerLanguage('a clean editorial illustration', '无文字'), /不要出现任何文字/);
});

test('sticker prompt carries the unified theme language', () => {
  const prompt = buildStickerPrompt({ sticker_language: '繁體中文', multi_image_count: 3 }, {
    topic: '算力券',
    count: 3,
  });
  assert.match(prompt.system, /整组统一主题语言：繁體中文/);
  assert.match(prompt.user, /统一主题语言：繁體中文/);
  assert.doesNotMatch(prompt.system, /简体中文。画面内/);
});

test('sticker document keeps image order, cover semantics and captions', () => {
  const files = {
    's-2': 'posts/stickers/demo/imgs/sticker-s-2.jpg',
    's-1': 'posts/stickers/demo/imgs/sticker-s-1.jpg',
  };
  assert.deepEqual(stickerImageItems(items, files).map(item => item.id), ['s-1', 's-2']);
  assert.equal(stickerCoverPath(items, files), 'posts/stickers/demo/imgs/sticker-s-1.jpg');

  const markdown = stickerDocumentMarkdown({
    title: '算力券怎么用',
    digest: '一张图讲清兑付链路。',
    items,
    filesByItem: files,
  });
  assert.match(markdown, /^# 算力券怎么用/);
  assert.match(markdown, /一张图讲清兑付链路。/);
  assert.match(markdown, /!\[封面：算力券怎么用\]\(posts\/stickers\/demo\/imgs\/sticker-s-1\.jpg\)/);
  assert.match(markdown, /!\[贴图：第 2 张\]\(posts\/stickers\/demo\/imgs\/sticker-s-2\.jpg\)/);
  assert.doesNotMatch(markdown, /sticker-s-3/);
  assert.ok(markdown.indexOf('第一张配文') < markdown.indexOf('第二张配文'));

  const projectMarkdown = stickerProjectMarkdown({
    title: '算力券怎么用',
    digest: '一张图讲清兑付链路。',
    items,
    filesByItem: files,
  });
  assert.match(projectMarkdown, /^# 算力券怎么用/);
  assert.match(projectMarkdown, /> 一张图讲清兑付链路。/);
  assert.match(projectMarkdown, /## 第 1 张/);
  assert.match(projectMarkdown, /## 第 2 张/);
  assert.match(projectMarkdown, /!\[封面：算力券怎么用\]/);
});

test('sticker language survives config normalization', () => {
  const value = normalizeConfigForSave({ sticker_language: 'English' });
  assert.equal(value.sticker_language, 'English');
  assert.equal(normalizeConfigForSave({}).sticker_language, '简体中文');
});

test('sticker fallback captions follow the selected language', () => {
  assert.equal(stickerCaptionPrefix('简体中文', 2), '第 2 张配文：');
  assert.equal(stickerCaptionPrefix('繁體中文', 2), '第 2 張配文：');
  assert.equal(stickerCaptionPrefix('English', 2), 'Image 2 caption: ');
  assert.equal(stickerCaptionPrefix('中英双语', 2), '第 2 张 / Image 2 caption: ');
  assert.equal(stickerCaptionPrefix('unsupported', 2), '第 2 张配文：');
});

test('sticker known failures can be retried and unknown states reset safely', () => {
  assert.equal(stickerPublishBlocked('draft-failed'), false);
  assert.equal(stickerPublishBlocked('failed'), true);
  assert.equal(stickerPublishBlocked('draft-unknown'), true);
  assert.deepEqual(stickerResetReceipt(), {
    state: 'draft-reset',
    mediaId: null,
    publishId: null,
    articleFingerprint: '',
    error: null,
  });
});

test('sticker fingerprint covers publish metadata and full image paths', () => {
  const payload = JSON.parse(stickerPublicationFingerprintPayload({
    title: '算力券',
    digest: '摘要',
    language: 'English',
    author: '作者',
    needOpenComment: 0,
    onlyFansCanComment: 1,
    items,
    filesByItem: { 's-1': 'posts/stickers/a/imgs/one.jpg' },
    outputFiles: [{ path: 'posts/stickers/a/imgs/one.jpg', size: 100, mtime: 9 }],
    directory: 'posts/stickers/a',
  }));
  assert.equal(payload.author, '作者');
  assert.equal(payload.needOpenComment, false);
  assert.equal(payload.onlyFansCanComment, true);
  assert.equal(payload.items[0].file, 'posts/stickers/a/imgs/one.jpg');
  assert.equal(payload.items[0].relative, 'imgs/one.jpg');
  assert.equal(payload.items[0].mtime, 9);
});

test('sticker session restores items, files and pending state safely', () => {
  const snapshot = stickerSessionSnapshot({
    topic: '算力券',
    count: 3,
    style: '统一手绘',
    medium: '马克笔白板',
    language: 'English',
    title: '算力券怎么用',
    digest: '摘要',
    items,
    directory: 'posts/stickers/demo',
    filesByItem: { 's-1': 'posts/stickers/demo/imgs/s-1.jpg' },
    itemStates: { 's-1': { state: 'unknown', error: 'timeout', taskId: 'task-1' } },
    accountId: 'wx-account',
    receipt: { state: 'draft-unknown', projectDirectory: 'drafts/20261103-demo' },
  });
  const restored = parseStickerSession(JSON.stringify(snapshot));
  assert.equal(restored.topic, '算力券');
  assert.equal(restored.language, 'English');
  assert.equal(restored.items.length, 3);
  assert.equal(restored.filesByItem['s-1'], 'posts/stickers/demo/imgs/s-1.jpg');
  assert.equal(restored.itemStates['s-1'].state, 'unknown');
  assert.equal(restored.receipt.state, 'draft-unknown');
  assert.equal(parseStickerSession('{bad json'), null);
  assert.equal(parseStickerSession(JSON.stringify({ ...snapshot, directory: 'posts/../../secret' })).directory, '');
});
