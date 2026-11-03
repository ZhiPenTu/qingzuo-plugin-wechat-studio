import YAML from 'yaml';
import { ARTICLE_DEFAULTS, DEFAULT_CONFIG, deepMerge, parseYamlObject, serializeArticle, serializeConfig } from './config.mjs';

export const STAGES = [
  { id: 'topic', label: '选题', files: ['topic-card.md'] },
  { id: 'research', label: '调研', files: ['research.md'] },
  { id: 'writing', label: '写稿', files: ['draft.md'] },
  { id: 'review', label: '内容审', files: ['review.md'] },
  { id: 'format', label: '排版', files: ['article.md', 'article.html'] },
  { id: 'images', label: '配图', files: ['imgs/'] },
  { id: 'final', label: '终审', files: ['final-review.md'] },
  { id: 'publish', label: '草稿/发布', files: ['publish.json'] },
];

export const STAGE_FILES = {
  topic: 'topic-card.md',
  research: 'research.md',
  writing: 'draft.md',
  review: 'review.md',
  format: 'article.md',
  images: 'img-plan.json',
  final: 'final-review.md',
  publish: 'publish.json',
};

export function slugify(value) {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  if (ascii) return ascii;
  const fallback = String(value || '').replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  return fallback || 'untitled';
}

export function dateStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate());
}

export function normalizeDraftsRoot(value = 'drafts') {
  const cleaned = String(value || 'drafts').trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  return /^drafts(?:\/[^\\:*?"<>|]+)*$/.test(cleaned) ? cleaned : 'drafts';
}

export function articleDirectoryName(title, date = new Date(), suffix = 0, draftsRoot = 'drafts') {
  const root = normalizeDraftsRoot(draftsRoot);
  return root + '/' + dateStamp(date) + '-' + slugify(title) + (suffix ? '-' + suffix : '');
}

export async function uniqueArticleDirectory(api, title, date = new Date(), draftsRoot = 'drafts') {
  const root = normalizeDraftsRoot(draftsRoot);
  const existing = await api.workspace.list({ path: root }).catch(error => {
    if (isMissingError(error)) return [];
    throw error;
  });
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = articleDirectoryName(title, date, suffix, root);
    if (!existing.some(entry => entry.path === candidate)) return candidate;
  }
  throw new Error('无法生成不重复的文章目录。');
}

function pipelineText(value) {
  return YAML.stringify(value, { lineWidth: 0 });
}

export async function createProject(api, { title, mode = 'full', source = '', initialStage = 'topic', draftsRoot = 'drafts' }, date = new Date()) {
  const stage = STAGES.some(item => item.id === initialStage) ? initialStage : 'topic';
  const root = normalizeDraftsRoot(draftsRoot);
  const directory = await uniqueArticleDirectory(api, title, date, root);
  await api.workspace.mkdir({ path: directory });
  await api.workspace.mkdir({ path: directory + '/imgs' });
  await api.workspace.mkdir({ path: directory + '/imgs/prompts' });
  const article = {
    ...ARTICLE_DEFAULTS,
    title,
    author: '',
    digest: '',
    cover_image: 'cover.jpg',
    content_source: 'article.html',
  };
  await api.workspace.writeText({ path: directory + '/article.yaml', text: serializeArticle(article), overwrite: false });
  await api.workspace.writeText({
    path: directory + '/pipeline.yaml',
    text: pipelineText({ schemaVersion: 1, stage, status: 'active', mode, created: date.toISOString(), source, completed: [] }),
    overwrite: false,
  });
  await api.workspace.writeText({
    path: directory + '/closing.md',
    text: '',
    overwrite: false,
  });
  await api.workspace.writeText({
    path: directory + '/stage-log.md',
    text: '# 阶段日志\n\n- ' + date.toISOString() + ' 创建项目，进入「' + STAGES.find(item => item.id === stage).label + '」。\n',
    overwrite: false,
  });
  return { directory, article, pipeline: { stage, status: 'active', mode, completed: [] } };
}

export async function readOptional(api, path) {
  try {
    return await api.workspace.readText({ path });
  } catch (error) {
    if (isMissingError(error)) return '';
    throw error;
  }
}

function isMissingError(error) {
  return /ENOENT|no such file|not found|不存在|未找到/i.test(error instanceof Error ? error.message : String(error || ''));
}

export async function loadProject(api, directory) {
  const articleText = await readOptional(api, directory + '/article.yaml');
  const article = articleText ? parseYamlObject(articleText, 'article.yaml') : {};
  const pipelineTextValue = await readOptional(api, directory + '/pipeline.yaml');
  let pipeline = { schemaVersion: 1, stage: 'topic', status: 'active', completed: [] };
  if (pipelineTextValue) {
    try {
      pipeline = { ...pipeline, ...YAML.parse(pipelineTextValue) };
    } catch {
      pipeline.loadError = 'pipeline.yaml 无法解析。';
    }
  }
  const files = {};
  for (const [stage, file] of Object.entries(STAGE_FILES)) {
    files[stage] = await readOptional(api, directory + '/' + file);
  }
  files.html = await readOptional(api, directory + '/article.html');
  files.imagePlan = await readOptional(api, directory + '/img-plan.json');
  files.finalReview = await readOptional(api, directory + '/final-review.md');
  files.publish = files.publish || await readOptional(api, directory + '/publish.json');
  files.closing = await readOptional(api, directory + '/closing.md');
  const entries = await api.workspace.list({ path: directory, recursive: true });
  return {
    directory,
    article: deepMerge(ARTICLE_DEFAULTS, article),
    pipeline,
    files,
    entries,
    stage: STAGES.find(item => item.id === pipeline.stage) || STAGES[0],
  };
}

export async function listProjects(api, draftsRoot = 'drafts') {
  const root = normalizeDraftsRoot(draftsRoot);
  const entries = await api.workspace.list({ path: root, recursive: false }).catch(error => {
    if (isMissingError(error)) return [];
    throw error;
  });
  const prefix = root + '/';
  const directories = entries.filter(entry => entry.kind === 'directory'
    && entry.path.startsWith(prefix)
    && /^\d{8}-/.test(entry.path.slice(prefix.length)));
  const projects = [];
  for (const entry of directories.sort((left, right) => right.mtime - left.mtime).slice(0, 100)) {
    const articleText = await readOptional(api, entry.path + '/article.yaml');
    let article = {};
    try {
      article = articleText ? YAML.parse(articleText) || {} : {};
    } catch {
      article = {};
    }
    const pipelineTextValue = await readOptional(api, entry.path + '/pipeline.yaml');
    let pipeline = {};
    try {
      pipeline = pipelineTextValue ? YAML.parse(pipelineTextValue) || {} : {};
    } catch {
      pipeline = {};
    }
    projects.push({
      directory: entry.path,
      title: String(article.title || entry.name.replace(/^\d{8}-/, '')),
      stage: String(pipeline.stage || 'topic'),
      updatedAt: entry.mtime,
    });
  }
  return projects;
}

export async function saveStage(api, directory, stage, content, options = {}) {
  const stageInfo = STAGES.find(item => item.id === stage);
  if (!stageInfo) throw new Error('未知阶段。');
  if (content !== undefined) {
    await api.workspace.writeText({
      path: directory + '/' + STAGE_FILES[stage],
      text: String(content),
      overwrite: true,
    });
  }
  const project = await loadProject(api, directory);
  if (options.complete !== false && ['topic', 'research', 'writing', 'review', 'format', 'final'].includes(stage)) {
    if (!String(project.files[stage] || '').trim()) throw new Error('当前阶段还没有可完成的内容，请先保存并预览结果。');
  }
  const completed = new Set(Array.isArray(project.pipeline.completed) ? project.pipeline.completed : []);
  if (options.complete !== false) completed.add(stage);
  const next = options.next === false ? stage : nextStage(stage);
  const pipeline = {
    ...project.pipeline,
    stage: next,
    status: next === 'publish' ? 'ready' : 'active',
    completed: [...completed],
    updated: new Date().toISOString(),
  };
  await api.workspace.writeText({ path: directory + '/pipeline.yaml', text: pipelineText(pipeline), overwrite: true });
  await appendLog(api, directory, '完成「' + stageInfo.label + '」' + (next !== stage ? '，进入「' + STAGES.find(item => item.id === next)?.label + '」。' : '。'));
  return { pipeline, next };
}

export function nextStage(stage) {
  const index = STAGES.findIndex(item => item.id === stage);
  return STAGES[Math.min(STAGES.length - 1, index + 1)].id;
}

export function previousStage(stage) {
  const index = STAGES.findIndex(item => item.id === stage);
  return STAGES[Math.max(0, index - 1)].id;
}

export async function appendLog(api, directory, message) {
  const text = await readOptional(api, directory + '/stage-log.md');
  const line = '- ' + new Date().toISOString() + ' ' + String(message).replace(/\s+/g, ' ').slice(0, 500) + '\n';
  await api.workspace.writeText({ path: directory + '/stage-log.md', text: (text || '# 阶段日志\n\n') + line, overwrite: true });
}

export async function saveArticle(api, directory, patch) {
  const current = await loadProject(api, directory);
  const article = deepMerge(current.article, patch || {});
  await api.workspace.writeText({ path: directory + '/article.yaml', text: serializeArticle(article), overwrite: true });
  return article;
}

export async function saveConfigFiles(api, config, rawConfig) {
  const merged = deepMerge(DEFAULT_CONFIG, rawConfig || config || {});
  const text = serializeConfig(merged);
  await api.workspace.writeText({ path: '.aws-article/config.yaml', text, overwrite: true });
  return { config: merged, text };
}

export function stageProgress(pipeline = {}) {
  const completed = new Set(Array.isArray(pipeline.completed) ? pipeline.completed : []);
  return STAGES.map(stage => ({ ...stage, completed: completed.has(stage.id), current: pipeline.stage === stage.id }));
}
