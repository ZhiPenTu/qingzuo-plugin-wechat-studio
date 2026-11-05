import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeStickerProject,
  stickerProjectArticleFingerprint,
  stickerProjectReady,
  stickerProjectRelativeFiles,
  stickerWechatPayload,
} from '../src/lib/sticker-project.mjs';

function memoryApi() {
  const files = new Map();
  const sizes = new Map();
  const directories = new Set(['drafts']);
  const writes = [];
  const workspace = {
    async mkdir({ path }) {
      const parts = path.split('/');
      let current = '';
      for (const part of parts) {
        current = current ? current + '/' + part : part;
        directories.add(current);
      }
    },
    async writeText({ path, text, overwrite = false }) {
      if (!overwrite && files.has(path)) throw new Error('文件已存在。');
      files.set(path, text);
      return { path, size: text.length };
    },
    async readText({ path }) {
      if (!files.has(path)) throw new Error('文件不存在。');
      return files.get(path);
    },
    async readFile({ path }) {
      if (!files.has(path)) throw new Error('文件不存在。');
      const jpeg = path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg');
      return {
        data: files.get(path),
        mime: jpeg ? 'image/jpeg' : 'image/webp',
        size: jpeg ? (sizes.get(path) ?? 512 * 1024) : files.get(path).length,
      };
    },
    async writeBase64({ path, data, mime, overwrite = false }) {
      if (!overwrite && files.has(path)) throw new Error('文件已存在。');
      files.set(path, data);
      const size = data === 'bGFyZ2U=' ? 1024 * 1024 + 1 : 512 * 1024;
      sizes.set(path, size);
      writes.push({ path, mime, data });
      return { path, size };
    },
    async list({ path, recursive = false }) {
      const prefix = path + '/';
      const result = [];
      for (const directory of directories) {
        if (directory === path || !directory.startsWith(prefix)) continue;
        const rest = directory.slice(prefix.length);
        if (!recursive && rest.includes('/')) continue;
        result.push({ path: directory, name: rest.split('/')[0], kind: 'directory', mtime: 1 });
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!recursive && rest.includes('/')) continue;
        result.push({ path: file, name: rest.split('/').at(-1), kind: 'file', size: 1, mtime: 1 });
      }
      return result;
    },
    async remove({ path, recursive = false }) {
      const children = [...directories].filter(directory => directory.startsWith(path + '/'));
      if (children.length && !recursive) throw new Error('目录不为空。');
      for (const directory of children) directories.delete(directory);
      directories.delete(path);
      for (const file of [...files.keys()]) {
        if (file === path || file.startsWith(path + '/')) files.delete(file);
      }
    },
  };
  return { api: { workspace }, files, sizes, directories, writes };
}

const items = [
  { id: 's-1', prompt: '第一张', caption: '第一张配文' },
  { id: 's-2', prompt: '第二张', caption: '第二张配文' },
  { id: 's-3', prompt: '第三张', caption: '第三张配文' },
];

test('sticker project materializes JPEG assets in a drafts article project', async () => {
  const { api, files, sizes, writes } = memoryApi();
  files.set('posts/stickers/demo/s-1.webp', 'c291cmNlMQ==');
  files.set('posts/stickers/demo/s-2.webp', 'c291cmNlMg==');
  files.set('posts/stickers/demo/s-3.webp', 'c291cmNlMw==');
  const filesByItem = {
    's-1': 'posts/stickers/demo/s-1.webp',
    's-2': 'posts/stickers/demo/s-2.webp',
    's-3': 'posts/stickers/demo/s-3.webp',
  };
  assert.deepEqual(stickerProjectRelativeFiles(items), {
    's-1': 'imgs/sticker-01.jpg',
    's-2': 'imgs/sticker-02.jpg',
    's-3': 'imgs/sticker-03.jpg',
  });
  const project = await materializeStickerProject(api, {
    title: '算力券怎么用',
    digest: '一组图讲清兑付链路。',
    items,
    filesByItem,
    medium: '马克笔白板',
    language: '简体中文',
    config: { default_author: '读以观心', need_open_comment: 1, only_fans_can_comment: 0 },
    draftsRoot: 'drafts',
  }, {
    convertImage: async () => ({ data: 'anBlZw==', mime: 'image/jpeg', size: 512 * 1024 }),
  });

  assert.match(project.directory, /^drafts\//);
  assert.equal(writes.length, 3);
  assert.ok(writes.every(write => write.path.endsWith('.jpg') && write.mime === 'image/jpeg'));
  const markdown = files.get(project.directory + '/article.md');
  assert.ok(markdown.indexOf('![封面：算力券怎么用](imgs/sticker-01.jpg)') > 0);
  assert.ok(markdown.indexOf('![贴图：第 2 张](imgs/sticker-02.jpg)') > 0);
  assert.match(files.get(project.directory + '/article.yaml'), /cover_image: imgs\/sticker-01\.jpg/);
  assert.match(files.get(project.directory + '/article.yaml'), /image_source: user/);
  assert.match(files.get(project.directory + '/article.html'), /src="imgs\/sticker-01\.jpg"/);
  assert.match(project.articleFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(await stickerProjectArticleFingerprint(api, project.directory), project.articleFingerprint);
  const imagePlan = JSON.parse(files.get(project.directory + '/img-plan.json'));
  assert.equal(imagePlan.cover.file, 'imgs/sticker-01.jpg');
  assert.equal(imagePlan.items.length, 2);
  assert.equal(imagePlan.items[0].slotIndex, 1);
  assert.equal(imagePlan.items[0].file, 'imgs/sticker-02.jpg');
  assert.equal(await stickerProjectReady(api, project.directory, project.relativeFiles), true);
  sizes.set(project.directory + '/imgs/sticker-02.jpg', 1024 * 1024 + 1);
  assert.equal(await stickerProjectReady(api, project.directory, project.relativeFiles), false);
  sizes.set(project.directory + '/imgs/sticker-02.jpg', 512 * 1024);

  const payload = stickerWechatPayload({
    accountId: 'wx-account',
    directory: project.directory,
    relativeFiles: project.relativeFiles,
    items,
    title: project.title,
    digest: project.digest,
    config: { default_author: '读以观心', need_open_comment: 1, only_fans_can_comment: 0 },
  });
  assert.equal(payload.article.articleDir, project.directory);
  assert.equal(payload.article.assets.length, 3);
  assert.equal(payload.article.cover.path, project.directory + '/imgs/sticker-01.jpg');
  assert.equal(payload.article.needOpenComment, true);
  assert.equal(payload.article.onlyFansCanComment, false);
  assert.doesNotMatch(payload.article.html, /src="imgs\//);
  assert.match(payload.article.html, /src="qingzuo-asset:asset-/);
});

test('sticker project rejects non-drafts publishing and non-JPEG conversion', async () => {
  assert.throws(() => stickerWechatPayload({
    accountId: 'wx-account',
    directory: 'posts/stickers/demo',
    relativeFiles: { 's-1': 'imgs/sticker-01.jpg' },
    items: [items[0]],
    title: 'Demo',
  }), /drafts\//);
  assert.throws(() => stickerWechatPayload({
    accountId: 'wx-account',
    directory: 'drafts/20261103-demo',
    relativeFiles: { 's-1': 'imgs/sticker-01.jpg' },
    items: items.slice(0, 2),
    title: 'Demo',
  }), /没有物化/);
  assert.throws(() => stickerWechatPayload({
    accountId: 'wx-account',
    directory: 'drafts/20261103-demo',
    relativeFiles: { 's-1': 'imgs/sticker-01.jpg' },
    items: [items[0]],
    title: '标'.repeat(65),
  }), /64/);

  const { api, files, directories } = memoryApi();
  files.set('posts/stickers/demo/s-1.webp', 'c291cmNl');
  await assert.rejects(() => materializeStickerProject(api, {
    title: '转换失败',
    items: [items[0]],
    filesByItem: { 's-1': 'posts/stickers/demo/s-1.webp' },
    config: {},
  }, {
    convertImage: async () => ({ data: 'cG5n', mime: 'image/png', size: 100 }),
  }), /JPEG/);
  const leftovers = [...directories].filter(path => path !== 'drafts');
  assert.deepEqual(leftovers, []);
});

test('sticker project rejects an oversized converted image and removes partial output', async () => {
  const { api, files, directories } = memoryApi();
  files.set('posts/stickers/demo/s-1.webp', 'c291cmNl');
  await assert.rejects(() => materializeStickerProject(api, {
    title: '图片过大',
    items: [items[0]],
    filesByItem: { 's-1': 'posts/stickers/demo/s-1.webp' },
    config: {},
  }, {
    convertImage: async () => ({ data: 'bGFyZ2U=', mime: 'image/jpeg', size: 1024 * 1024 + 1 }),
  }), /1 MB/);
  assert.deepEqual([...directories].filter(path => path !== 'drafts'), []);
});
