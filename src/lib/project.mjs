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

export const PUBLICATION_STALE_REASON = 'upstream-changed';

export const DERIVED_ARTIFACT_FILES = ['article.md', 'article.html', 'img-plan.json', 'final-review.md'];

const EDITOR_DRAFT_FILES = {
  topic: ['.qz-draft-topic.json'],
  research: ['.qz-draft-research.json', '.qz-draft-research-topic.json'],
  writing: ['.qz-draft-writing.json'],
  review: ['.qz-draft-review.json'],
  format: ['.qz-draft-format.json'],
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

export async function createProject(api, {
  title,
  mode = 'full',
  source = '',
  topic = '',
  direction = '',
  initialStage = 'topic',
  draftsRoot = 'drafts',
}, date = new Date()) {
  const stage = STAGES.some(item => item.id === initialStage) ? initialStage : 'topic';
  const root = normalizeDraftsRoot(draftsRoot);
  const directory = await uniqueArticleDirectory(api, title, date, root);
  const ownerMarker = directory + '/.qz-owner';
  const ownerToken = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const topicInfo = normalizeTopicOption(topic, direction);
  const topicText = topicInfo.topic || String(source || '').trim();
  let ownsDirectory = false;
  try {
    await api.workspace.mkdir({ path: directory });
    await api.workspace.writeText({ path: ownerMarker, text: ownerToken, overwrite: false });
    ownsDirectory = true;
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
    const pipeline = {
      schemaVersion: 1,
      stage,
      status: 'active',
      mode,
      created: date.toISOString(),
      source,
      topic: topicText,
      completed: [],
    };
    if (topicInfo.direction) pipeline.direction = topicInfo.direction;
    await api.workspace.writeText({
      path: directory + '/pipeline.yaml',
      text: pipelineText(pipeline),
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
    return {
      directory,
      article,
      pipeline: {
        stage,
        status: 'active',
        mode,
        source,
        topic: topicText,
        ...(topicInfo.direction ? { direction: topicInfo.direction } : {}),
        completed: [],
      },
    };
  } catch (error) {
    if (ownsDirectory) await api.workspace.remove({ path: directory, recursive: true }).catch(() => {});
    throw error;
  }
}

export async function readOptional(api, path) {
  try {
    return await api.workspace.readText({ path });
  } catch (error) {
    if (isMissingError(error)) return '';
    throw error;
  }
}

async function readSnapshot(api, path) {
  try {
    return { exists: true, text: await api.workspace.readText({ path }) };
  } catch (error) {
    if (isMissingError(error)) return { exists: false, text: '' };
    throw error;
  }
}

async function restoreSnapshot(api, path, snapshot) {
  if (snapshot.exists) {
    await api.workspace.writeText({ path, text: snapshot.text, overwrite: true });
    return;
  }
  await api.workspace.remove({ path, recursive: false }).catch(() => {});
}

async function restoreIfChanged(api, path, snapshot) {
  try {
    const current = await readSnapshot(api, path);
    if (current.exists === snapshot.exists && current.text === snapshot.text) return;
  } catch {
    // 无法比较时按回滚处理。
  }
  await restoreSnapshot(api, path, snapshot);
}

function normalizeTopicOption(topic, direction) {
  if (topic && typeof topic === 'object' && !Array.isArray(topic)) {
    return {
      topic: String(topic.title || topic.topic || topic.name || '').trim(),
      direction: String(topic.direction || direction || '').trim(),
    };
  }
  return {
    topic: String(topic || '').trim(),
    direction: String(direction || '').trim(),
  };
}

function normalizeIsoTime(value) {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function markReceiptStale(receipt, options = {}) {
  const base = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  const reason = String(options.reason || PUBLICATION_STALE_REASON);
  return {
    ...base,
    stale: true,
    staleReason: reason,
    staleAt: normalizeIsoTime(options.at),
  };
}

export function isPublicationStale(receipt) {
  return Boolean(receipt && typeof receipt === 'object' && receipt.stale);
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

export async function deleteProjectDirectory(api, directory) {
  const target = String(directory || '').trim().replace(/\/+$/, '');
  if (!/^drafts(?:\/[^\\:*?"<>|]+)+$/.test(target) || target.split('/').includes('..')) {
    throw new Error('只能删除 drafts/ 下的文章项目。');
  }
  const parent = target.slice(0, target.lastIndexOf('/'));
  const name = target.slice(target.lastIndexOf('/') + 1);
  const trashRoot = parent + '/.trash';
  const tombstone = trashRoot + '/' + name + '-' + Date.now().toString(36)
    + '-' + Math.random().toString(36).slice(2, 8);
  await api.workspace.mkdir({ path: trashRoot });
  await api.workspace.rename({ from: target, to: tombstone });
  try {
    await api.workspace.remove({ path: tombstone, recursive: true });
  } catch {
    return { cleaned: false, trashPath: tombstone };
  }
  return { cleaned: true, trashPath: tombstone };
}

function stageIndex(stage) {
  return STAGES.findIndex(item => item.id === stage);
}

function resolveInvalidationStage(value, includeReview) {
  const requested = String(value || '').trim();
  if (requested && stageIndex(requested) >= 0) return requested;
  return includeReview ? 'review' : 'format';
}

function isDownstreamStage(stage, fromStage) {
  const from = stageIndex(fromStage);
  const index = stageIndex(stage);
  if (from < 0 || index < 0) return false;
  return index >= from;
}

function editorDraftsFor(fromStage) {
  const from = stageIndex(fromStage);
  if (from < 0) return [];
  return STAGES
    .filter(stage => stageIndex(stage.id) >= from)
    .flatMap(stage => EDITOR_DRAFT_FILES[stage.id] || []);
}

function prunedPipelineState(snapshot, fromStage) {
  if (!snapshot.exists) return { changed: false, completed: [], pipeline: null };
  let pipeline = null;
  try {
    pipeline = YAML.parse(snapshot.text) || {};
  } catch {
    return { changed: false, completed: [], pipeline: null };
  }
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline)) {
    return { changed: false, completed: [], pipeline: null };
  }
  const completed = Array.isArray(pipeline.completed)
    ? pipeline.completed.filter(item => typeof item === 'string')
    : [];
  const kept = completed.filter(item => !isDownstreamStage(item, fromStage));
  const stageChanged = pipeline.stage !== fromStage;
  if (kept.length === completed.length && !stageChanged) {
    return { changed: false, completed: kept, pipeline };
  }
  return {
    changed: true,
    completed: kept,
    pipeline: { ...pipeline, stage: fromStage, completed: kept, updated: new Date().toISOString() },
  };
}

async function writeStaleReceipt(api, publishPath, snapshot, options = {}) {
  if (!snapshot.exists) return { changed: false, stale: false, receipt: null };
  let receipt = null;
  try {
    receipt = JSON.parse(snapshot.text || '{}');
  } catch {
    return { changed: false, stale: false, receipt: null };
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { changed: false, stale: false, receipt: null };
  }
  const next = markReceiptStale(receipt, options);
  await api.workspace.writeText({
    path: publishPath,
    text: JSON.stringify(next, null, 2),
    overwrite: true,
  });
  return { changed: true, stale: true, receipt: next };
}

export async function markPublicationStale(api, directory, options = {}) {
  const path = directory + '/publish.json';
  const snapshot = await readSnapshot(api, path);
  const result = await writeStaleReceipt(api, path, snapshot, options);
  return { path, stale: result.stale, receipt: result.receipt, changed: result.changed };
}

export async function invalidateDerivedProjectFiles(api, directory, options = {}) {
  const includeReview = options.includeReview !== false;
  let fromStage = resolveInvalidationStage(options.fromStage, includeReview);
  if (!includeReview && stageIndex(fromStage) >= 0 && stageIndex(fromStage) < stageIndex('format')) {
    fromStage = 'format';
  }
  const targets = [
    ...(includeReview ? ['review.md'] : []),
    ...DERIVED_ARTIFACT_FILES,
    ...editorDraftsFor(fromStage),
  ];
  const pipelinePath = directory + '/pipeline.yaml';
  const publishPath = directory + '/publish.json';
  const pipelineSnapshot = await readSnapshot(api, pipelinePath);
  const publishSnapshot = await readSnapshot(api, publishPath);
  const removed = [];
  try {
    for (const file of targets) {
      const path = directory + '/' + file;
      const snapshot = await readSnapshot(api, path);
      if (!snapshot.exists) continue;
      await api.workspace.remove({ path, recursive: false });
      removed.push({ path, text: snapshot.text });
    }
    const pruned = prunedPipelineState(pipelineSnapshot, fromStage);
    if (pruned.changed) {
      await api.workspace.writeText({
        path: pipelinePath,
        text: pipelineText(pruned.pipeline),
        overwrite: true,
      });
    }
    const stale = await writeStaleReceipt(api, publishPath, publishSnapshot, options.stale);
    return {
      removed: removed.map(item => item.path),
      stale: stale.stale,
      receipt: stale.receipt,
      completed: pruned.completed,
      fromStage,
    };
  } catch (error) {
    const rollbackFailures = [];
    for (const item of removed) {
      await api.workspace.writeText({ path: item.path, text: item.text, overwrite: true })
        .catch(() => rollbackFailures.push(item.path));
    }
    await restoreIfChanged(api, publishPath, publishSnapshot)
      .catch(() => rollbackFailures.push(publishPath));
    await restoreIfChanged(api, pipelinePath, pipelineSnapshot)
      .catch(() => rollbackFailures.push(pipelinePath));
    if (rollbackFailures.length) {
      const next = new Error((error instanceof Error ? error.message : String(error))
        + '；自动回滚失败：' + rollbackFailures.join('、'));
      next.rollbackFailures = rollbackFailures;
      throw next;
    }
    throw error;
  }
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
  for (const item of [...completed]) {
    if (stageIndex(item) > stageIndex(stage)) completed.delete(item);
  }
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
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'body_copies')) {
    article.body_copies = structuredClone(patch.body_copies || {});
  }
  await api.workspace.writeText({ path: directory + '/article.yaml', text: serializeArticle(article), overwrite: true });
  return article;
}

export async function saveProjectTopic(api, directory, topic, direction = '') {
  const info = normalizeTopicOption(topic, direction);
  const project = await loadProject(api, directory);
  const pipeline = {
    ...project.pipeline,
    topic: info.topic,
    ...(info.direction ? { direction: info.direction } : {}),
    updated: new Date().toISOString(),
  };
  await api.workspace.writeText({
    path: directory + '/pipeline.yaml',
    text: pipelineText(pipeline),
    overwrite: true,
  });
  return pipeline;
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
