export const STICKER_LANGUAGES = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'English', label: 'English' },
  { value: '中英双语', label: '中英双语' },
  { value: '无文字', label: '无画面文字' },
];

export const DEFAULT_STICKER_LANGUAGE = '简体中文';
export const STICKER_SESSION_PATH = 'posts/stickers/.sticker-session.json';

export function normalizeStickerLanguage(value) {
  const language = String(value || '').trim();
  return STICKER_LANGUAGES.some(item => item.value === language) ? language : DEFAULT_STICKER_LANGUAGE;
}

export function stickerLanguageInstruction(value) {
  const language = normalizeStickerLanguage(value);
  if (language === '繁體中文') {
    return '整组图片统一使用繁體中文：画面内可见文字与逐图配文均使用繁體中文，不要混入简体中文或无关英文。';
  }
  if (language === 'English') {
    return 'Use English consistently across the set: all visible text inside the images and all captions must be English. Do not mix in Chinese labels.';
  }
  if (language === '中英双语') {
    return '整组图片统一使用中英双语：关键可见文字与逐图配文都同时给出简体中文和英文，两种语言不得互相遗漏。';
  }
  if (language === '无文字') {
    return '画面内不要出现任何文字、字母、数字标签或水印；逐图配文仍使用简体中文。';
  }
  return '整组图片统一使用简体中文：画面内可见文字与逐图配文均使用简体中文，不要出现无关英文标签。';
}

export function withStickerLanguage(prompt, language) {
  const text = String(prompt || '').trim();
  const instruction = stickerLanguageInstruction(language);
  return text ? text + '\n\n统一主题语言（必须遵守）：' + instruction : instruction;
}

export function stickerBatchBindings(items, modelId, promptFor = item => item?.prompt) {
  return (Array.isArray(items) ? items : []).map(item => ({
    id: String(item?.id || ''),
    prompt: String(promptFor(item) || ''),
    modelId: String(modelId || ''),
  })).filter(item => item.id);
}

export function stickerBatchMatches(bindings, items, modelId, promptFor = item => item?.prompt) {
  const current = stickerBatchBindings(items, modelId, promptFor);
  if (!Array.isArray(bindings) || bindings.length !== current.length) return false;
  return bindings.every((binding, index) => (
    binding.id === current[index].id
    && binding.prompt === current[index].prompt
    && binding.modelId === current[index].modelId
  ));
}

export function mergeStickerFiles(filesByItem = {}, items = [], updates = {}) {
  const currentIds = new Set((Array.isArray(items) ? items : []).map(item => String(item?.id || '')));
  const merged = Object.fromEntries(Object.entries(filesByItem || {})
    .filter(([id, path]) => currentIds.has(id) && String(path || '')));
  for (const [id, path] of Object.entries(updates || {})) {
    if (currentIds.has(id) && String(path || '')) merged[id] = String(path);
  }
  return merged;
}

export function stickerBatchRetryable(batchItems = []) {
  return (Array.isArray(batchItems) ? batchItems : [])
    .some(item => ['failed', 'save-failed'].includes(String(item?.state || '')));
}

export function stickerBatchHasUnknown(batchItems = []) {
  return (Array.isArray(batchItems) ? batchItems : [])
    .some(item => String(item?.state || '') === 'unknown');
}

export function stickerCaptionPrefix(language, position) {
  const index = Math.max(1, Number(position) || 1);
  const normalized = normalizeStickerLanguage(language);
  if (normalized === '繁體中文') return '第 ' + index + ' 張配文：';
  if (normalized === 'English') return 'Image ' + index + ' caption: ';
  if (normalized === '中英双语') return '第 ' + index + ' 张 / Image ' + index + ' caption: ';
  return '第 ' + index + ' 张配文：';
}

function markdownAlt(value) {
  return String(value || '').replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stickerImageItems(items, filesByItem = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      ...item,
      position: index + 1,
      file: String(filesByItem[item.id] || ''),
    }))
    .filter(item => item.file);
}

export function stickerCoverPath(items, filesByItem = {}) {
  return stickerImageItems(items, filesByItem)[0]?.file || '';
}

export function stickerDocumentMarkdown({ title, digest = '', items, filesByItem = {} }) {
  const heading = String(title || '今日分享').trim() || '今日分享';
  const summary = String(digest || '').trim();
  const lines = ['# ' + heading];
  if (summary) lines.push(summary);
  for (const item of stickerImageItems(items, filesByItem)) {
    const alt = item.position === 1 ? '封面：' + heading : '贴图：第 ' + item.position + ' 张';
    lines.push('![' + markdownAlt(alt) + '](' + item.file + ')');
    const caption = String(item.caption || '').trim();
    if (caption) lines.push(caption);
  }
  return lines.join('\n\n') + '\n';
}

export function stickerProjectMarkdown({ title, digest = '', items, filesByItem = {} }) {
  const heading = String(title || '今日分享').trim() || '今日分享';
  const images = stickerImageItems(items, filesByItem);
  const summary = String(digest || '').trim() || '本组贴图围绕「' + heading + '」展开，共 ' + images.length + ' 张。';
  const lines = ['# ' + heading, '> ' + summary];
  images.forEach((item, index) => {
    lines.push('## 第 ' + (index + 1) + ' 张');
    const alt = index === 0 ? '封面：' + heading : '贴图：第 ' + (index + 1) + ' 张';
    lines.push('![' + markdownAlt(alt) + '](' + item.file + ')');
    const caption = String(item.caption || '').trim();
    if (caption) lines.push(caption);
  });
  if (images.length < 2) {
    lines.push('## 补充说明', '本组图片可在文章项目中继续补充文案、顺序或发布设置。');
  }
  return lines.join('\n\n') + '\n';
}

export function stickerPublishBlocked(state) {
  return [
    'creating-draft',
    'draft-unknown',
    'failed',
    'submitting',
    'unknown',
  ].includes(String(state || ''));
}

export function stickerResetReceipt() {
  return {
    state: 'draft-reset',
    mediaId: null,
    publishId: null,
    articleFingerprint: '',
    error: null,
  };
}

function commentToggle(value, fallback) {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  return !(raw === false || raw === 0 || raw === '0');
}

/**
 * @param {{
 *   title?: string,
 *   topic?: string,
 *   digest?: string,
 *   language?: string,
 *   author?: string,
 *   needOpenComment?: boolean | number | string,
 *   onlyFansCanComment?: boolean | number | string,
 *   items?: Array<{ id: string, caption?: string }>,
 *   filesByItem?: Record<string, string>,
 *   outputFiles?: Array<{ path?: string, size?: number, mtime?: number }>,
 *   directory?: string,
 * }} input
 */
export function stickerPublicationFingerprintPayload({
  title,
  topic = '',
  digest = '',
  language = '',
  author = '',
  needOpenComment = true,
  onlyFansCanComment = false,
  items = [],
  filesByItem = {},
  outputFiles = [],
  directory = '',
}) {
  const outputByPath = new Map(
    (Array.isArray(outputFiles) ? outputFiles : []).map(entry => [String(entry?.path || ''), entry]),
  );
  const imagePayload = (Array.isArray(items) ? items : []).map(item => {
    const file = String(filesByItem[item.id] || '');
    const entry = outputByPath.get(file);
    return {
      id: item.id,
      caption: item.caption || '',
      file,
      relative: file && directory && file.startsWith(directory + '/')
        ? file.slice(directory.length + 1)
        : file,
      size: entry?.size || 0,
      mtime: entry?.mtime || 0,
    };
  });
  return JSON.stringify({
    title: String(title || topic || '').trim(),
    digest: String(digest || '').trim(),
    language: normalizeStickerLanguage(language),
    author: String(author || '').trim(),
    needOpenComment: commentToggle(needOpenComment, true),
    onlyFansCanComment: commentToggle(onlyFansCanComment, false),
    items: imagePayload,
  });
}

/**
 * @param {{
 *   topic?: string, count?: number, style?: string, medium?: string, language?: string,
 *   title?: string, digest?: string, items?: Array<{ id: string, prompt?: string, caption?: string }>,
 *   directory?: string, filesByItem?: Record<string, string>,
 *   itemStates?: Record<string, { state?: string, error?: string, taskId?: string }>, accountId?: string,
 *   receipt?: Record<string, any>,
 * }} input
 */
export function stickerSessionSnapshot({
  topic = '',
  count = 6,
  style = '',
  medium = '',
  language = DEFAULT_STICKER_LANGUAGE,
  title = '',
  digest = '',
  items = [],
  directory = '',
  filesByItem = {},
  itemStates = {},
  accountId = '',
  receipt = {},
}) {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    topic: String(topic || ''),
    count: Math.min(9, Math.max(1, Number(count) || 6)),
    style: String(style || ''),
    medium: String(medium || ''),
    language: normalizeStickerLanguage(language),
    title: [...String(title || '')].slice(0, 64).join(''),
    digest: String(digest || '').slice(0, 120),
    items: (Array.isArray(items) ? items : []).map(item => ({
      id: String(item.id || ''),
      prompt: String(item.prompt || ''),
      caption: String(item.caption || ''),
    })).filter(item => item.id),
    directory: String(directory || ''),
    filesByItem: Object.fromEntries(Object.entries(filesByItem || {})
      .map(([id, path]) => [String(id), String(path || '')])
      .filter(([, path]) => path)),
    itemStates: Object.fromEntries(Object.entries(itemStates || {})
      .filter(([, state]) => state && typeof state === 'object')
      .map(([id, state]) => [String(id), {
        state: String(state.state || ''),
        error: String(state.error || ''),
        taskId: String(state.taskId || ''),
      }])),
    accountId: String(accountId || ''),
    receipt: receipt && typeof receipt === 'object' ? { ...receipt } : {},
  };
}

/** @param {string | Record<string, any> | null | undefined} text */
export function parseStickerSession(text) {
  let value;
  try {
    value = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) return null;
  const items = Array.isArray(value.items)
    ? value.items.map(item => ({
      id: String(item?.id || ''),
      prompt: String(item?.prompt || ''),
      caption: String(item?.caption || ''),
    })).filter(item => item.id)
    : [];
  if (!items.length) return null;
  const directory = String(value.directory || '');
  const receipt = value.receipt && typeof value.receipt === 'object' ? { ...value.receipt } : {};
  if (!String(receipt.projectDirectory || '').startsWith('drafts/') || String(receipt.projectDirectory || '').split('/').includes('..')) {
    delete receipt.projectDirectory;
  }
  if (!String(receipt.stickersDirectory || '').startsWith('posts/stickers/') || String(receipt.stickersDirectory || '').split('/').includes('..')) {
    delete receipt.stickersDirectory;
  }
  return {
    topic: String(value.topic || ''),
    count: Math.min(9, Math.max(1, Number(value.count) || items.length)),
    style: String(value.style || ''),
    medium: String(value.medium || ''),
    language: normalizeStickerLanguage(value.language),
    title: [...String(value.title || '')].slice(0, 64).join(''),
    digest: String(value.digest || '').slice(0, 120),
    items,
    directory: directory.startsWith('posts/stickers/') && !directory.split('/').includes('..') ? directory : '',
    filesByItem: value.filesByItem && typeof value.filesByItem === 'object'
      ? Object.fromEntries(Object.entries(value.filesByItem).map(([id, path]) => [String(id), String(path || '')]))
      : {},
    itemStates: value.itemStates && typeof value.itemStates === 'object'
      ? Object.fromEntries(Object.entries(value.itemStates).map(([id, state]) => [String(id), {
        state: String(state?.state || ''),
        error: String(state?.error || ''),
        taskId: String(state?.taskId || ''),
      }]))
      : {},
    accountId: String(value.accountId || ''),
    receipt,
  };
}
