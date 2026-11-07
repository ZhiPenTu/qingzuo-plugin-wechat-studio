import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsBlockFixFinish, applyBlockFix } from '../src/lib/review-fix.mjs';

const clean = `# 标题

> 这篇讲一次具体测试，先说结论，再说过程。

## 过程

第一次运行只花了**七分钟**。多出来的三分钟用于核对来源。

## 结果

- **先保存**：避免重复操作。
- **再复核**：确认数字与正文一致。
`;

function workspaceFixture(files, failWriteAt = 0, afterWrite = null, failRemovePaths = []) {
  const writes = [];
  const removals = [];
  let writeCount = 0;
  const api = {
    workspace: {
      async readText({ path }) {
        if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error('ENOENT: ' + path);
        return files[path];
      },
      async writeText({ path, text, overwrite = false }) {
        writeCount += 1;
        writes.push({ path, text, overwrite });
        if (writeCount === failWriteAt) throw new Error('write failed');
        files[path] = text;
        afterWrite?.({ path, index: writeCount, files, writes });
      },
      async list({ path }) {
        return Object.keys(files)
          .filter(file => file.startsWith(path + '/'))
          .map(file => ({ path: file, name: file.split('/').pop(), kind: 'file', size: files[file].length, mtime: 1 }));
      },
      async remove({ path }) {
        removals.push({ path });
        if (failRemovePaths.includes(path)) throw new Error('remove failed');
        delete files[path];
      },
    },
  };
  return { api, files, writes, removals };
}

function fixOptions(overrides = {}) {
  return {
    directory: 'drafts/article',
    source: clean,
    sourcePath: 'drafts/article/draft.md',
    articleTitle: '标题',
    config: { target_word_count: '10-500' },
    content: clean,
    ...overrides,
  };
}

test('block fixes accept only normal completion states', () => {
  assert.equal(acceptsBlockFixFinish(''), true);
  assert.equal(acceptsBlockFixFinish('stop'), true);
  assert.equal(acceptsBlockFixFinish('COMPLETE'), true);
  assert.equal(acceptsBlockFixFinish('length'), false);
  assert.equal(acceptsBlockFixFinish('content_filter'), false);
  assert.equal(acceptsBlockFixFinish('error'), false);
});

test('verified block fix writes draft and review only after all checks pass', async () => {
  const { api, files, writes } = workspaceFixture({
    'drafts/article/draft.md': fixOptions().source,
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, true);
  assert.equal(result.fixed.review.counts.block, 0);
  assert.deepEqual(writes.map(item => item.path), [
    'drafts/article/draft.md',
    'drafts/article/review.md',
  ]);
  assert.equal(files['drafts/article/draft.md'], clean);
  assert.match(files['drafts/article/review.md'], /阻断 0/);
});

test('unresolved blockers and lost image markers never write workspace files', async () => {
  const incomplete = workspaceFixture({
    'drafts/article/draft.md': '# 绝对第一的方法\n\n正文',
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const incompleteResult = await applyBlockFix(incomplete.api, fixOptions({
    source: '# 绝对第一的方法\n\n正文',
    content: '# 绝对第一的方法\n\n正文',
    config: { target_word_count: '10-500', forbidden_words: ['绝对第一'] },
  }));
  assert.equal(incompleteResult.ok, false);
  assert.equal(incompleteResult.reason, 'blocked');
  assert.equal(incomplete.writes.length, 0);

  const withPlaceholder = '# 标题\n\n> 导语。\n\n## 一\n\n正文。\n\n![信息图：四步流程](placeholder)\n';
  const lostImage = workspaceFixture({
    'drafts/article/draft.md': withPlaceholder,
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const lostImageResult = await applyBlockFix(lostImage.api, fixOptions({
    source: withPlaceholder,
    config: { target_word_count: '10-500' },
  }));
  assert.equal(lostImageResult.ok, false);
  assert.equal(lostImageResult.reason, 'images');
  assert.equal(lostImage.writes.length, 0);
});

test('AI output that replaces the source article is rejected as unfaithful', async () => {
  const replacement = `# 另一篇

> 这是完全不同的内容，用来说明替换风险。

## 天气

这里讨论**降雨**与**交通**，没有保留原文。

## 饮食

这里继续讨论**早餐**与**睡眠**，结论也不同。
`;
  const { api, writes } = workspaceFixture({
    'drafts/article/draft.md': clean,
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const result = await applyBlockFix(api, fixOptions({ content: replacement }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content');
  assert.equal(writes.length, 0);
});

test('concurrent draft changes win over the AI result', async () => {
  const { api, writes } = workspaceFixture({
    'drafts/article/draft.md': '# 标题\n\n已被别处修改',
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale');
  assert.equal(writes.length, 0);
});

test('a revised H1 is synced to article metadata before review is saved', async () => {
  const source = clean.replace('# 标题', '# 绝对第一的方法');
  const { api, files, writes } = workspaceFixture({
    'drafts/article/draft.md': source,
    'drafts/article/review.md': '# 旧审稿\n',
    'drafts/article/article.yaml': 'title: 绝对第一的方法\n',
  });
  const result = await applyBlockFix(api, fixOptions({
    source,
    articleTitle: '标题',
    config: { target_word_count: '10-500', forbidden_words: ['绝对第一'] },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.fixed.needsTitleSync, true);
  assert.match(files['drafts/article/article.yaml'], /title: 标题/);
  assert.deepEqual(writes.map(item => item.path), [
    'drafts/article/draft.md',
    'drafts/article/article.yaml',
    'drafts/article/review.md',
  ]);
});

test('draft fixes invalidate stale format artifacts', async () => {
  const source = fixOptions().source;
  const { api, files, removals } = workspaceFixture({
    'drafts/article/draft.md': source,
    'drafts/article/article.md': '# 旧排版\n',
    'drafts/article/article.html': '<p>旧排版</p>',
    'drafts/article/img-plan.json': '{"old":true}',
    'drafts/article/final-review.md': '# 旧终审\n',
    'drafts/article/publish.json': '{"status":"submitted"}',
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, true);
  assert.equal(files['drafts/article/draft.md'], clean);
  assert.equal(files['drafts/article/article.md'], undefined);
  assert.equal(files['drafts/article/article.html'], undefined);
  assert.equal(files['drafts/article/img-plan.json'], undefined);
  assert.equal(files['drafts/article/final-review.md'], undefined);
  assert.notEqual(files['drafts/article/publish.json'], undefined);
  assert.deepEqual(removals.map(item => item.path), [
    'drafts/article/article.md',
    'drafts/article/article.html',
    'drafts/article/img-plan.json',
    'drafts/article/final-review.md',
  ]);
});

test('block fixes keep the publication receipt and mark it stale', async () => {
  const source = fixOptions().source;
  const { api, files, removals } = workspaceFixture({
    'drafts/article/draft.md': source,
    'drafts/article/publish.json': JSON.stringify({
      state: 'unknown',
      mediaId: 'MEDIA-1',
      publishId: 'PUBLISH-1',
      accountId: 'acc-1',
      delivery: 'draft',
      articleFingerprint: 'FP-1',
    }),
    'drafts/article/review.md': '# 旧审稿\n',
  });
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, true);
  assert.equal(removals.some(item => item.path === 'drafts/article/publish.json'), false);
  const receipt = JSON.parse(files['drafts/article/publish.json']);
  assert.equal(receipt.stale, true);
  assert.equal(receipt.staleReason, 'upstream-changed');
  assert.match(receipt.staleAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(receipt.state, 'unknown');
  assert.equal(receipt.mediaId, 'MEDIA-1');
  assert.equal(receipt.publishId, 'PUBLISH-1');
  assert.equal(receipt.accountId, 'acc-1');
  assert.equal(receipt.delivery, 'draft');
  assert.equal(receipt.articleFingerprint, 'FP-1');
});

test('a failed cleanup restores the publication receipt', async () => {
  const source = fixOptions().source;
  const receiptText = JSON.stringify({ state: 'drafted', mediaId: 'MEDIA-2' });
  const { api, files } = workspaceFixture({
    'drafts/article/draft.md': source,
    'drafts/article/article.html': '<p>旧排版</p>',
    'drafts/article/publish.json': receiptText,
    'drafts/article/review.md': '# 旧审稿\n',
  }, 0, null, ['drafts/article/article.html']);
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write');
  assert.deepEqual(result.rollbackFailures, []);
  assert.equal(files['drafts/article/draft.md'], source);
  assert.equal(files['drafts/article/review.md'], '# 旧审稿\n');
  assert.equal(files['drafts/article/publish.json'], receiptText);
});

test('article.md source is updated in place and only stale HTML is removed', async () => {
  const source = fixOptions().source;
  const { api, files, writes, removals } = workspaceFixture({
    'drafts/article/article.md': source,
    'drafts/article/article.html': '<p>旧排版</p>',
    'drafts/article/review.md': '# 旧审稿\n',
    'drafts/article/article.yaml': 'title: 标题\n',
  });
  const result = await applyBlockFix(api, fixOptions({ sourcePath: 'drafts/article/article.md' }));
  assert.equal(result.ok, true);
  assert.equal(files['drafts/article/article.md'], clean);
  assert.equal(files['drafts/article/article.html'], undefined);
  assert.equal(files['drafts/article/draft.md'], undefined);
  assert.deepEqual(writes.map(item => item.path), [
    'drafts/article/article.md',
    'drafts/article/review.md',
  ]);
  assert.deepEqual(removals.map(item => item.path), ['drafts/article/article.html']);
});

test('write failure rolls back the draft and leaves review unchanged', async () => {
  const original = fixOptions().source;
  const { api, files, writes } = workspaceFixture({
    'drafts/article/draft.md': original,
    'drafts/article/review.md': '# 旧审稿\n',
  }, 2);
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write');
  assert.deepEqual(result.rollbackFailures, []);
  assert.equal(files['drafts/article/draft.md'], original);
  assert.equal(files['drafts/article/review.md'], '# 旧审稿\n');
  assert.deepEqual(writes.map(item => item.path), [
    'drafts/article/draft.md',
    'drafts/article/review.md',
    'drafts/article/draft.md',
  ]);
});

test('failure on the first write does not rewrite the original source', async () => {
  const original = fixOptions().source;
  const { api, files, writes } = workspaceFixture({
    'drafts/article/draft.md': original,
    'drafts/article/review.md': '# 旧审稿\n',
  }, 1);
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write');
  assert.equal(files['drafts/article/draft.md'], original);
  assert.equal(writes.length, 1);
});

test('rollback never overwrites a concurrent edit made after the AI write', async () => {
  const original = fixOptions().source;
  const concurrent = '# 并发新稿\n\n> 用户刚刚保存的新正文。\n\n## 一\n\n正文。\n\n## 二\n\n正文。\n';
  const { api, files, writes } = workspaceFixture({
    'drafts/article/draft.md': original,
    'drafts/article/review.md': '# 旧审稿\n',
  }, 2, ({ index }) => {
    if (index === 1) files['drafts/article/draft.md'] = concurrent;
  });
  const result = await applyBlockFix(api, fixOptions());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write');
  assert.equal(files['drafts/article/draft.md'], concurrent);
  assert.ok(result.rollbackFailures.some(value => /并发修改/.test(value)));
  assert.deepEqual(writes.map(item => item.path), [
    'drafts/article/draft.md',
    'drafts/article/review.md',
  ]);
});
