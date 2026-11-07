import test from 'node:test';
import assert from 'node:assert/strict';
import {
  articleDirectoryName,
  createProject,
  dateStamp,
  deleteProjectDirectory,
  invalidateDerivedProjectFiles,
  listProjects,
  loadProject,
  markPublicationStale,
  nextStage,
  previousStage,
  saveArticle,
  saveProjectTopic,
  saveStage,
  slugify,
  stageProgress,
} from '../src/lib/project.mjs';

function memoryApi() {
  const files = new Map();
  const directories = new Set(['drafts']);
  const state = { failRemove: '', partialRemove: '', failWrite: '' };
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
      if (state.failWrite && path === state.failWrite) throw new Error('模拟写入失败。');
      if (!overwrite && files.has(path)) throw new Error('文件已存在。');
      files.set(path, text);
    },
    async readText({ path }) {
      if (!files.has(path)) throw new Error('文件不存在。');
      return files.get(path);
    },
    async list({ path }) {
      const prefix = path + '/';
      const children = new Map();
      for (const directory of directories) {
        if (!directory.startsWith(prefix) || directory === path) continue;
        const rest = directory.slice(prefix.length);
        const name = rest.split('/')[0];
        children.set(path + '/' + name, { path: path + '/' + name, name, kind: 'directory', mtime: 1 });
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (rest.includes('/')) continue;
        children.set(file, { path: file, name: rest, kind: 'file', size: files.get(file).length, mtime: 1 });
      }
      return [...children.values()];
    },
    async rename({ from, to }) {
      if (!directories.has(from) && !files.has(from)) throw new Error('文件不存在。');
      const rewrite = value => value === from || value.startsWith(from + '/')
        ? to + value.slice(from.length)
        : value;
      for (const directory of [...directories]) {
        if (directory === from || directory.startsWith(from + '/')) {
          directories.delete(directory);
          directories.add(rewrite(directory));
        }
      }
      for (const file of [...files.keys()]) {
        if (file === from || file.startsWith(from + '/')) {
          const text = files.get(file);
          files.delete(file);
          files.set(rewrite(file), text);
        }
      }
    },
    async remove({ path, recursive = false }) {
      if (state.failRemove && path.startsWith(state.failRemove)) throw new Error('模拟删除失败。');
      const children = [...directories].filter(directory => directory.startsWith(path + '/'));
      if (children.length && !recursive) throw new Error('目录不为空。');
      if (state.partialRemove && path.startsWith(state.partialRemove)) {
        const file = [...files.keys()].find(value => value.startsWith(path + '/'));
        if (file) files.delete(file);
        throw new Error('模拟部分删除失败。');
      }
      for (const directory of children) directories.delete(directory);
      for (const file of [...files.keys()]) {
        if (file === path || file.startsWith(path + '/')) files.delete(file);
      }
      directories.delete(path);
    },
  };
  return { api: { workspace }, files, directories, state };
}

test('project directory uses date and readable slug', () => {
  assert.equal(dateStamp(new Date(2026, 10, 3)), '20261103');
  assert.equal(slugify('AI 工作台 v2'), 'ai-v2');
  assert.equal(articleDirectoryName('配置一次', new Date(2026, 10, 3), 2), 'drafts/20261103-配置一次-2');
});

test('stage transitions are bounded', () => {
  assert.equal(nextStage('topic'), 'research');
  assert.equal(previousStage('topic'), 'topic');
  assert.equal(nextStage('publish'), 'publish');
});

test('stage progress marks current and completed', () => {
  const progress = stageProgress({ stage: 'writing', completed: ['topic', 'research'] });
  assert.equal(progress.find(item => item.id === 'writing').current, true);
  assert.equal(progress.find(item => item.id === 'topic').completed, true);
  assert.equal(progress.find(item => item.id === 'review').completed, false);
});

test('re-saving an earlier stage clears stale downstream completion', async () => {
  const { api, files } = memoryApi();
  files.set('drafts/demo/pipeline.yaml', [
    'schemaVersion: 1',
    'stage: final',
    'status: ready',
    'completed:',
    '  - topic',
    '  - research',
    '  - writing',
    '  - review',
    '  - format',
    '  - images',
    '  - final',
    '',
  ].join('\n'));
  await saveStage(api, 'drafts/demo', 'format', '# 新排版\n', { next: true });
  const project = await loadProject(api, 'drafts/demo');
  assert.deepEqual(project.pipeline.completed, ['topic', 'research', 'writing', 'review', 'format']);
  assert.equal(project.pipeline.stage, 'images');
});

test('draft replacement invalidates every downstream artifact', async () => {
  const { api, files } = memoryApi();
  for (const file of ['review.md', 'article.md', 'article.html', 'img-plan.json', 'final-review.md']) {
    files.set('drafts/demo/' + file, 'old');
  }
  files.set('drafts/demo/publish.json', JSON.stringify({ state: 'drafted', mediaId: 'MEDIA-1' }));
  files.set('drafts/demo/draft.md', '# 新稿\n');
  await invalidateDerivedProjectFiles(api, 'drafts/demo');
  assert.equal(files.has('drafts/demo/draft.md'), true);
  for (const file of ['review.md', 'article.md', 'article.html', 'img-plan.json', 'final-review.md']) {
    assert.equal(files.has('drafts/demo/' + file), false);
  }
  assert.equal(files.has('drafts/demo/publish.json'), true);
});

test('upstream saves keep the publication receipt and only mark it stale', async () => {
  const { api, files } = memoryApi();
  for (const file of ['review.md', 'article.md', 'article.html', 'img-plan.json', 'final-review.md']) {
    files.set('drafts/demo/' + file, 'old');
  }
  files.set('drafts/demo/publish.json', JSON.stringify({
    state: 'unknown',
    mediaId: 'MEDIA-1',
    publishId: 'PUBLISH-1',
    error: '上次发布超时',
    delivery: 'draft',
    accountId: 'acc-1',
    articleFingerprint: 'FP-1',
  }));
  files.set('drafts/demo/.qz-draft-review.json', JSON.stringify({ version: 1, base: '', text: '旧审稿草稿' }));
  files.set('drafts/demo/.qz-draft-writing.json', JSON.stringify({ version: 1, base: '', text: '保留中的写稿草稿' }));
  files.set('drafts/demo/pipeline.yaml', 'schemaVersion: 1\nstage: final\ncompleted:\n  - topic\n  - review\n  - final\n');
  await invalidateDerivedProjectFiles(api, 'drafts/demo');
  assert.equal(files.has('drafts/demo/publish.json'), true);
  const project = await loadProject(api, 'drafts/demo');
  assert.equal(project.pipeline.stage, 'review');
  const receipt = JSON.parse(files.get('drafts/demo/publish.json'));
  assert.equal(receipt.stale, true);
  assert.equal(receipt.staleReason, 'upstream-changed');
  assert.match(receipt.staleAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(receipt.state, 'unknown');
  assert.equal(receipt.mediaId, 'MEDIA-1');
  assert.equal(receipt.publishId, 'PUBLISH-1');
  assert.equal(receipt.error, '上次发布超时');
  assert.equal(receipt.delivery, 'draft');
  assert.equal(receipt.accountId, 'acc-1');
  assert.equal(receipt.articleFingerprint, 'FP-1');
  assert.equal(files.has('drafts/demo/.qz-draft-review.json'), false);
  assert.equal(files.has('drafts/demo/.qz-draft-writing.json'), true);
});

test('invalidating downstream artifacts prunes the completed stages', async () => {
  const { api, files } = memoryApi();
  files.set('drafts/demo/pipeline.yaml', [
    'schemaVersion: 1',
    'stage: review',
    'status: active',
    'completed:',
    '  - topic',
    '  - research',
    '  - writing',
    '  - review',
    '  - format',
    '  - images',
    '  - final',
    '',
  ].join('\n'));
  files.set('drafts/demo/article.html', '<p>旧排版</p>');
  await invalidateDerivedProjectFiles(api, 'drafts/demo');
  const project = await loadProject(api, 'drafts/demo');
  assert.deepEqual(project.pipeline.completed, ['topic', 'research', 'writing']);
});

test('keeping the review file preserves the review stage', async () => {
  const { api, files } = memoryApi();
  files.set('drafts/demo/pipeline.yaml', [
    'schemaVersion: 1',
    'stage: review',
    'status: active',
    'completed:',
    '  - topic',
    '  - research',
    '  - writing',
    '  - review',
    '  - format',
    '  - final',
    '',
  ].join('\n'));
  files.set('drafts/demo/review.md', '# 审稿\n');
  files.set('drafts/demo/article.html', '<p>旧排版</p>');
  await invalidateDerivedProjectFiles(api, 'drafts/demo', { includeReview: false });
  assert.equal(files.has('drafts/demo/review.md'), true);
  assert.equal(files.has('drafts/demo/article.html'), false);
  const project = await loadProject(api, 'drafts/demo');
  assert.deepEqual(project.pipeline.completed, ['topic', 'research', 'writing', 'review']);
});

test('a failed invalidation restores the deleted files and the pipeline', async () => {
  const { api, files, state } = memoryApi();
  const pipelineText = [
    'schemaVersion: 1',
    'stage: review',
    'status: active',
    'completed:',
    '  - topic',
    '  - writing',
    '  - review',
    '',
  ].join('\n');
  files.set('drafts/demo/pipeline.yaml', pipelineText);
  files.set('drafts/demo/review.md', '旧审稿');
  files.set('drafts/demo/article.md', '旧排版');
  files.set('drafts/demo/article.html', '<p>旧排版</p>');
  files.set('drafts/demo/publish.json', JSON.stringify({ state: 'drafted', mediaId: 'MEDIA-2' }));
  state.failRemove = 'drafts/demo/article.html';
  await assert.rejects(() => invalidateDerivedProjectFiles(api, 'drafts/demo'), /模拟删除失败/);
  assert.equal(files.get('drafts/demo/review.md'), '旧审稿');
  assert.equal(files.get('drafts/demo/article.md'), '旧排版');
  assert.equal(files.has('drafts/demo/article.html'), true);
  assert.equal(files.get('drafts/demo/pipeline.yaml'), pipelineText);
  assert.equal(JSON.parse(files.get('drafts/demo/publish.json')).stale, undefined);
});

test('a failed receipt update rolls back the pruned pipeline', async () => {
  const { api, files, state } = memoryApi();
  const pipelineText = [
    'schemaVersion: 1',
    'stage: review',
    'status: active',
    'completed:',
    '  - topic',
    '  - writing',
    '  - review',
    '',
  ].join('\n');
  files.set('drafts/demo/pipeline.yaml', pipelineText);
  files.set('drafts/demo/article.html', '<p>旧排版</p>');
  files.set('drafts/demo/publish.json', JSON.stringify({ state: 'drafted', mediaId: 'MEDIA-3' }));
  state.failWrite = 'drafts/demo/publish.json';
  await assert.rejects(() => invalidateDerivedProjectFiles(api, 'drafts/demo'), /模拟写入失败/);
  assert.equal(files.has('drafts/demo/article.html'), true);
  assert.equal(files.get('drafts/demo/pipeline.yaml'), pipelineText);
  assert.equal(JSON.parse(files.get('drafts/demo/publish.json')).stale, undefined);
});

test('marking a publication receipt stale keeps the receipt fields', async () => {
  const { api, files } = memoryApi();
  files.set('drafts/demo/publish.json', JSON.stringify({
    state: 'drafted',
    mediaId: 'MEDIA-9',
    publishId: 'PUBLISH-9',
    accountId: 'acc-9',
    delivery: 'draft',
    articleFingerprint: 'FP-9',
  }));
  const result = await markPublicationStale(api, 'drafts/demo');
  assert.equal(result.stale, true);
  assert.equal(files.has('drafts/demo/publish.json'), true);
  const receipt = JSON.parse(files.get('drafts/demo/publish.json'));
  assert.equal(receipt.stale, true);
  assert.equal(receipt.staleReason, 'upstream-changed');
  assert.equal(receipt.mediaId, 'MEDIA-9');
  assert.equal(receipt.publishId, 'PUBLISH-9');
  assert.equal(receipt.accountId, 'acc-9');
  assert.equal(receipt.delivery, 'draft');
  assert.equal(receipt.articleFingerprint, 'FP-9');
  assert.equal(receipt.state, 'drafted');
});

test('marking a missing publication receipt never creates a file', async () => {
  const { api, files } = memoryApi();
  const result = await markPublicationStale(api, 'drafts/demo');
  assert.equal(result.stale, false);
  assert.equal(result.receipt, null);
  assert.equal(files.has('drafts/demo/publish.json'), false);
});

test('project creation avoids overwrite and starts rewrite work at writing', async () => {
  const { api, directories, files } = memoryApi();
  directories.add('drafts/20261103-demo');
  const created = await createProject(api, { title: 'Demo', mode: 'rewrite', initialStage: 'writing' }, new Date(2026, 10, 3));
  assert.equal(created.directory, 'drafts/20261103-demo-1');
  assert.equal(files.has(created.directory + '/.qz-owner'), true);
  const project = await loadProject(api, created.directory);
  assert.equal(project.stage.id, 'writing');
  assert.equal(project.pipeline.mode, 'rewrite');
  assert.match(project.files.writing, /^$/);
  await saveStage(api, created.directory, 'writing', '# 新稿\n', { next: true });
  const updated = await loadProject(api, created.directory);
  assert.equal(updated.files.writing, '# 新稿\n');
  assert.equal(updated.pipeline.stage, 'review');
  const projects = await listProjects(api);
  assert.equal(projects.find(item => item.directory === 'drafts/20261103-demo-1').title, 'Demo');
});

test('saved layout settings survive a project reload', async () => {
  const { api, directories } = memoryApi();
  directories.add('drafts/20261103-layout');
  const created = await createProject(api, {
    title: 'Layout',
    mode: 'rewrite',
    initialStage: 'format',
  }, new Date(2026, 10, 3));
  await saveArticle(api, created.directory, {
    default_format_preset: ['书卷'],
    default_format_scheme: ['朱砂'],
    format_color: '#8f3b25',
    format_font_size: '16px',
  });
  const reloaded = await loadProject(api, created.directory);
  assert.deepEqual(reloaded.article.default_format_preset, ['书卷']);
  assert.deepEqual(reloaded.article.default_format_scheme, ['朱砂']);
  assert.equal(reloaded.article.format_color, '#8f3b25');
  assert.equal(reloaded.article.format_font_size, '16px');
});

test('project creation persists the topic and direction for later reloads', async () => {
  const { api } = memoryApi();
  const created = await createProject(api, {
    title: 'Topic',
    mode: 'full',
    source: '旧来源',
    topic: 'AI 编程助手',
    direction: '面向企业团队',
  }, new Date(2026, 10, 3));
  assert.equal(created.pipeline.topic, 'AI 编程助手');
  assert.equal(created.pipeline.direction, '面向企业团队');
  assert.equal(created.pipeline.source, '旧来源');
  const reloaded = await loadProject(api, created.directory);
  assert.equal(reloaded.pipeline.topic, 'AI 编程助手');
  assert.equal(reloaded.pipeline.direction, '面向企业团队');
  assert.equal(reloaded.pipeline.source, '旧来源');
});

test('project creation without a topic falls back to the source field', async () => {
  const { api } = memoryApi();
  const created = await createProject(api, {
    title: 'Sticker',
    mode: 'paste',
    source: '贴图工作流',
  }, new Date(2026, 10, 3));
  assert.equal(created.pipeline.topic, '贴图工作流');
  const reloaded = await loadProject(api, created.directory);
  assert.equal(reloaded.pipeline.topic, '贴图工作流');
  assert.equal(reloaded.pipeline.source, '贴图工作流');
});

test('custom drafts root stays inside the drafts workspace root', async () => {
  const { api, directories } = memoryApi();
  directories.add('drafts/team/20261103-demo');
  const created = await createProject(api, {
    title: 'Demo',
    mode: 'rewrite',
    initialStage: 'writing',
    draftsRoot: 'drafts/team/',
  }, new Date(2026, 10, 3));
  assert.equal(created.directory, 'drafts/team/20261103-demo-1');
  const projects = await listProjects(api, 'drafts/team');
  assert.ok(projects.some(item => item.directory === 'drafts/team/20261103-demo-1'));
});

test('selected topic survives a project reload', async () => {
  const { api } = memoryApi();
  const created = await createProject(api, {
    title: 'Topic',
    mode: 'full',
    topic: '初始方向',
    initialStage: 'topic',
  }, new Date(2026, 10, 3));
  await saveProjectTopic(api, created.directory, '用户在调研阶段确认的选题');
  const reloaded = await loadProject(api, created.directory);
  assert.equal(reloaded.pipeline.topic, '用户在调研阶段确认的选题');
});

test('custom image copies persist across reloads and clean up on reset', async () => {
  const { api } = memoryApi();
  const created = await createProject(api, {
    title: '电商直播间开始售卖 token',
    mode: 'rewrite',
    initialStage: 'images',
  }, new Date(2026, 10, 5));

  // 保存自定义文案
  await saveArticle(api, created.directory, {
    cover_copy: '直播间卖算力了',
    body_copies: { 2: '场景还原：书房晚间真实办公' },
  });
  let reloaded = await loadProject(api, created.directory);
  assert.equal(reloaded.article.cover_copy, '直播间卖算力了');
  assert.deepEqual(reloaded.article.body_copies, { 2: '场景还原：书房晚间真实办公' });

  // 重置自定义文案，验证空对象不会被 deepMerge 留存旧键
  await saveArticle(api, created.directory, {
    cover_copy: '',
    body_copies: {},
  });
  reloaded = await loadProject(api, created.directory);
  assert.equal(reloaded.article.cover_copy, '');
  assert.deepEqual(reloaded.article.body_copies, {});
});

test('project deletion is scoped and keeps cleanup failures in trash', async () => {
  const { api, directories, files, state } = memoryApi();
  directories.add('drafts/20261103-delete');
  const deleted = await deleteProjectDirectory(api, 'drafts/20261103-delete');
  assert.equal(deleted.cleaned, true);
  assert.equal(directories.has('drafts/20261103-delete'), false);
  await assert.rejects(() => deleteProjectDirectory(api, 'posts/not-a-draft'), /drafts/);

  directories.add('drafts/20261103-restore');
  state.failRemove = 'drafts/.trash/';
  const uncleaned = await deleteProjectDirectory(api, 'drafts/20261103-restore');
  assert.equal(uncleaned.cleaned, false);
  assert.equal(directories.has('drafts/20261103-restore'), false);
  assert.match(uncleaned.trashPath, /^drafts\/\.trash\//);
  assert.equal(directories.has(uncleaned.trashPath), true);

  const partial = 'drafts/20261103-partial';
  directories.add(partial);
  files.set(partial + '/article.md', '# Draft');
  state.failRemove = '';
  state.partialRemove = 'drafts/.trash/';
  const partiallyRemoved = await deleteProjectDirectory(api, partial);
  assert.equal(partiallyRemoved.cleaned, false);
  assert.equal(directories.has(partial), false);
  assert.equal(directories.has(partiallyRemoved.trashPath), true);
  assert.equal(files.has(partiallyRemoved.trashPath + '/article.md'), false);
});

test('project creation does not remove a directory owned by another creator', async () => {
  const { api, directories, files } = memoryApi();
  const occupied = 'drafts/20261103-race-1';
  directories.add('drafts/20261103-race');
  directories.add(occupied);
  files.set(occupied + '/.qz-owner', 'other-creator');
  const list = api.workspace.list;
  api.workspace.list = async options => {
    const entries = await list(options);
    return options?.path === 'drafts' ? entries.filter(entry => entry.path !== occupied) : entries;
  };
  await assert.rejects(
    () => createProject(api, { title: 'Race', initialStage: 'format' }, new Date(2026, 10, 3)),
    /文件已存在/,
  );
  assert.equal(directories.has(occupied), true);
  assert.equal(files.get(occupied + '/.qz-owner'), 'other-creator');
});
