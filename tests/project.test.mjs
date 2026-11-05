import test from 'node:test';
import assert from 'node:assert/strict';
import {
  articleDirectoryName,
  createProject,
  dateStamp,
  listProjects,
  loadProject,
  nextStage,
  previousStage,
  saveArticle,
  saveStage,
  slugify,
  stageProgress,
} from '../src/lib/project.mjs';

function memoryApi() {
  const files = new Map();
  const directories = new Set(['drafts']);
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
  };
  return { api: { workspace }, files, directories };
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

test('project creation avoids overwrite and starts rewrite work at writing', async () => {
  const { api, directories } = memoryApi();
  directories.add('drafts/20261103-demo');
  const created = await createProject(api, { title: 'Demo', mode: 'rewrite', initialStage: 'writing' }, new Date(2026, 10, 3));
  assert.equal(created.directory, 'drafts/20261103-demo-1');
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
