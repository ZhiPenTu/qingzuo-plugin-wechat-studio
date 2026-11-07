export const STICKER_LANGUAGES = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'English', label: 'English' },
  { value: '中英双语', label: '中英双语' },
  { value: '无文字', label: '无画面文字' },
];

export const DEFAULT_STICKER_LANGUAGE = '简体中文';
export const DEFAULT_STICKER_ASPECT = '3:4';
export const STICKER_SESSION_PATH = 'posts/stickers/.sticker-session.json';
export const STICKER_TYPES = ['场景故事', '知识卡片', '产品展示', '节日祝福', '投票互动'];
export const STICKER_MESSAGE_TITLE_LIMIT = 32;
export const STICKER_ASPECTS = [
  { value: '3:4', label: '竖版 3:4（推荐）' },
  { value: '1:1', label: '方形 1:1' },
  { value: '4:3', label: '横版 4:3' },
  { value: '16:9', label: '横版 16:9' },
];

export function normalizeStickerAspect(value) {
  const aspect = String(value || '').trim();
  return STICKER_ASPECTS.some(item => item.value === aspect) ? aspect : DEFAULT_STICKER_ASPECT;
}

export function stickerAspectDescription(value) {
  const aspect = normalizeStickerAspect(value);
  return {
    '3:4': '竖版 3:4',
    '1:1': '方形 1:1',
    '4:3': '横版 4:3',
    '16:9': '横版 16:9',
  }[aspect];
}

export function stickerPlanAspectChanged(items = [], planAspect = '', aspect = DEFAULT_STICKER_ASPECT) {
  return Boolean(
    (Array.isArray(items) ? items : []).length
    && planAspect
    && normalizeStickerAspect(planAspect) !== normalizeStickerAspect(aspect),
  );
}

export function stickerMessageTitle(value) {
  return [...String(value || '').trim()].slice(0, STICKER_MESSAGE_TITLE_LIMIT).join('');
}

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

export function stickerTextKey(value) {
  return String(value || '')
    .replace(/^第\s*\d+\s*[张張]\s*(?:配文)?\s*[:：]\s*/u, '')
    .replace(/^image\s*\d+\s*caption\s*:\s*/iu, '')
    .replace(/^第\s*\d+\s*[张張]\s*\/\s*image\s*\d+\s*caption\s*:\s*/iu, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLocaleLowerCase();
}

export function stickerItemDuplicateIssues(item, index, items = []) {
  const list = Array.isArray(items) ? items : [];
  const issues = [];
  const label = '第 ' + (index + 1) + ' 张';
  const viewpoint = stickerTextKey(item?.viewpoint);
  const prompt = stickerTextKey(item?.prompt);
  const caption = stickerTextKey(item?.caption);
  list.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    if (viewpoint && stickerTextKey(other?.viewpoint) === viewpoint) {
      issues.push(label + '与第 ' + (otherIndex + 1) + ' 张的方案小结重复，请改成各自独立的观点。');
    }
    if (prompt && stickerTextKey(other?.prompt) === prompt) {
      issues.push(label + '与第 ' + (otherIndex + 1) + ' 张的画面提示词重复，请改成各自的画面。');
    }
    if (caption && stickerTextKey(other?.caption) === caption) {
      issues.push(label + '与第 ' + (otherIndex + 1) + ' 张的配文重复，请补充这张独有的信息。');
    }
  });
  return [...new Set(issues)];
}

export function stickerPlanBriefIssues(plan = {}) {
  const issues = [];
  const planType = String(plan?.type || '').trim();
  if (!planType) {
    issues.push('请先选择贴图类型。');
  } else if (!STICKER_TYPES.includes(planType)) {
    issues.push('贴图类型需从「' + STICKER_TYPES.join(' / ') + '」中选择。');
  }
  if (!String(plan?.narrative || '').trim()) issues.push('请先写清整组叙事线。');
  if (!String(plan?.summary || '').trim()) issues.push('请先写清整组主旨。');
  return issues;
}

export function stickerPlanIssues(items = [], plan = {}) {
  const list = Array.isArray(items) ? items : [];
  const issues = stickerPlanBriefIssues(plan);
  if (!list.length) return ['还没有贴图方案，请先生成或手动新建方案。'];
  const viewpoints = new Map();
  const captions = new Map();
  const prompts = new Map();
  list.forEach((item, index) => {
    const label = '第 ' + (index + 1) + ' 张';
    const viewpoint = stickerTextKey(item?.viewpoint);
    const caption = stickerTextKey(item?.caption);
    const prompt = stickerTextKey(item?.prompt);
    if (!String(item?.viewpoint || '').trim()) {
      issues.push(label + '缺少方案小结，请写清这张只讲哪一个观点。');
    } else if (viewpoints.has(viewpoint)) {
      issues.push(label + '与第 ' + viewpoints.get(viewpoint) + ' 张的方案小结重复，请改成各自独立的观点。');
    } else {
      viewpoints.set(viewpoint, index + 1);
    }
    if (!String(item?.prompt || '').trim()) {
      issues.push(label + '缺少画面提示词。');
    } else if (prompts.has(prompt)) {
      issues.push(label + '与第 ' + prompts.get(prompt) + ' 张的画面提示词重复，请改成各自的画面。');
    } else {
      prompts.set(prompt, index + 1);
    }
    if (!String(item?.caption || '').trim()) {
      issues.push(label + '缺少配文，请补充画面之外的信息。');
    } else if (captions.has(caption)) {
      issues.push(label + '与第 ' + captions.get(caption) + ' 张的配文重复，请补充这张独有的信息。');
    } else {
      captions.set(caption, index + 1);
    }
  });
  return issues;
}

function trimmedText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

/**
 * Normalize an AI sticker plan into the shape used by the workbench.
 * The normalizer is deliberately strict about uniqueness: an identical
 * viewpoint or caption across the set is the failure mode this plan prevents.
 * @param {any} value
 * @param {{ topic?: string, count?: number, style?: string, medium?: string, language?: string }} [options]
 * @returns {{
 *   title: string, type: string, narrative: string, summary: string,
 *   style: string, medium: string, language: string,
 *   images: Array<{ viewpoint: string, prompt: string, caption: string }>,
 * }}
 */
export function normalizeStickerPlan(value, {
  topic = '',
  count = 6,
  style = '',
  medium = '',
  language = DEFAULT_STICKER_LANGUAGE,
} = {}) {
  const expected = Math.min(9, Math.max(1, Number(count) || 6));
  const rawImages = Array.isArray(value?.images) ? value.images : null;
  if (!rawImages) throw new Error('模型没有返回 images 数组。');
  if (rawImages.length < expected) {
    throw new Error('模型只返回 ' + rawImages.length + ' 张方案，少于要求的 ' + expected + ' 张。');
  }
  const images = rawImages.slice(0, expected).map(item => ({
    viewpoint: trimmedText(item?.viewpoint),
    prompt: trimmedText(item?.prompt),
    caption: trimmedText(item?.caption),
  }));
  const planType = trimmedText(value?.type);
  const planNarrative = trimmedText(value?.narrative);
  const planSummary = trimmedText(value?.summary).slice(0, 200);
  const issues = stickerPlanIssues(images, {
    type: planType,
    narrative: planNarrative,
    summary: planSummary,
  });
  if (issues.length) throw new Error(issues[0]);
  return {
    title: stickerMessageTitle(trimmedText(value?.title, topic || '今日分享')),
    type: planType,
    narrative: planNarrative,
    summary: planSummary,
    style: trimmedText(style, trimmedText(value?.style, '统一手绘')),
    medium: trimmedText(medium, trimmedText(value?.medium)),
    language: normalizeStickerLanguage(language || value?.language),
    images,
  };
}

export function parseStickerPlanContent(content) {
  const text = String(content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text) throw new Error('模型返回了空方案。');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through to the actionable error below.
      }
    }
    throw new Error('模型返回的方案不是有效 JSON，请重试。');
  }
}

export function stickerGenerationPrompt({
  topic = '',
  type = '',
  narrative = '',
  summary = '',
  style = '',
  medium = '',
  aspect = DEFAULT_STICKER_ASPECT,
  index = 1,
  count = 1,
  language = DEFAULT_STICKER_LANGUAGE,
  item = {},
} = {}) {
  const normalizedAspect = normalizeStickerAspect(aspect);
  const lines = [
    '整组贴图主题：' + (String(topic || '').trim() || '今日分享'),
    type ? '贴图类型：' + String(type).trim() : '',
    narrative ? '整组叙事线：' + String(narrative).trim() : '',
    summary ? '整组主旨：' + String(summary).trim() : '',
    '图片画幅：' + stickerAspectDescription(normalizedAspect) + '（宽高比 ' + normalizedAspect + '）。'
      + '请按完整画布构图，四周至少预留 6% 安全边距；标题、数字、人物和说明文字必须完整显示，不得贴边或被裁切。',
    '本张位置：第 ' + Math.max(1, Number(index) || 1) + ' / ' + Math.max(1, Number(count) || 1) + ' 张。',
    item?.viewpoint ? '本张方案小结（只讲这个观点）：' + String(item.viewpoint).trim() : '',
    style ? '统一风格：' + String(style).trim() : '',
    medium ? '统一媒介：' + String(medium).trim() : '',
    item?.prompt ? '画面提示词：' + String(item.prompt).trim() : '',
  ].filter(Boolean);
  return withStickerLanguage(lines.join('\n'), language);
}

function tableCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * @param {{
 *   title?: string, type?: string, narrative?: string, summary?: string,
 *   style?: string, medium?: string, aspect?: string,
 *   items?: Array<{ viewpoint?: string, prompt?: string, caption?: string }>,
 * }} [plan]
 */
export function stickerOutlineMarkdown({
  title = '',
  type = '',
  narrative = '',
  summary = '',
  style = '',
  medium = '',
  aspect = DEFAULT_STICKER_ASPECT,
  items = [],
} = {}) {
  const heading = String(title || '今日分享').trim() || '今日分享';
  const list = Array.isArray(items) ? items : [];
  const lines = [
    '## 贴图方案：' + heading,
    '',
    '**张数**：' + list.length + ' 张（≤ 9）',
    '**贴图类型**：' + (String(type || '').trim() || '未定'),
    '**叙事线**：' + (String(narrative || '').trim() || '未定'),
    '**统一形态**：' + ([String(style || '').trim(), String(medium || '').trim()].filter(Boolean).join(' · ') || '未定'),
    '**图片比例**：' + stickerAspectDescription(aspect),
  ];
  if (String(summary || '').trim()) lines.push('**整组主旨**：' + String(summary).trim());
  lines.push(
    '',
    '| 序号 | 画面描述（方案小结） | 配文 | Prompt 要点 |',
    '|------|----------------------|------|-------------|',
  );
  list.forEach((item, index) => {
    lines.push(
      '| ' + (index + 1)
      + ' | ' + (tableCell(item?.viewpoint) || '待补充')
      + ' | ' + (tableCell(item?.caption) || '待补充')
      + ' | ' + (tableCell(item?.prompt) || '待补充') + ' |',
    );
  });
  lines.push('', '> 生成前请先确认：每张只讲一个观点，观点之间不重复，配文与画面互补。');
  return lines.join('\n') + '\n';
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

export function stickerDraftMatches({
  fingerprintReady = false,
  stale = false,
  mediaId = '',
  delivery = '',
  accountId = '',
  receiptAccountId = '',
  receiptFingerprint = '',
  fingerprint = '',
} = {}) {
  return Boolean(
    fingerprintReady
    && !stale
    && mediaId
    && delivery === 'image'
    && accountId
    && receiptAccountId === accountId
    && receiptFingerprint
    && receiptFingerprint === fingerprint,
  );
}

export function stickerResetReceipt() {
  return {
    state: 'draft-reset',
    mediaId: null,
    publishId: null,
    articleFingerprint: '',
    error: null,
    stale: false,
    staleReason: null,
    staleAt: null,
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
 *   type?: string,
 *   narrative?: string,
 *   summary?: string,
 *   medium?: string,
 *   style?: string,
 *   aspect?: string,
 *   needOpenComment?: boolean | number | string,
 *   onlyFansCanComment?: boolean | number | string,
 *   items?: Array<{ id: string, viewpoint?: string, prompt?: string, caption?: string }>,
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
  type = '',
  narrative = '',
  summary = '',
  medium = '',
  style = '',
  aspect = DEFAULT_STICKER_ASPECT,
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
      viewpoint: item.viewpoint || '',
      prompt: item.prompt || '',
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
    type: String(type || '').trim(),
    narrative: String(narrative || '').trim(),
    summary: String(summary || '').trim(),
    medium: String(medium || '').trim(),
    style: String(style || '').trim(),
    aspect: normalizeStickerAspect(aspect),
    needOpenComment: commentToggle(needOpenComment, true),
    onlyFansCanComment: commentToggle(onlyFansCanComment, false),
    items: imagePayload,
  });
}

/**
 * @param {{
 *   topic?: string, count?: number, style?: string, medium?: string, language?: string, aspect?: string,
 *   planLanguage?: string, planAspect?: string, type?: string, narrative?: string, summary?: string,
 *   title?: string, digest?: string, items?: Array<{ id: string, viewpoint?: string, prompt?: string, caption?: string }>,
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
  aspect = DEFAULT_STICKER_ASPECT,
  planLanguage = '',
  planAspect = '',
  type = '',
  narrative = '',
  summary = '',
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
    aspect: normalizeStickerAspect(aspect),
    planLanguage: String(planLanguage || ''),
    planAspect: normalizeStickerAspect(planAspect || aspect),
    type: String(type || ''),
    narrative: String(narrative || ''),
    summary: String(summary || '').slice(0, 200),
    title: stickerMessageTitle(title),
    digest: String(digest || '').slice(0, 120),
    items: (Array.isArray(items) ? items : []).map(item => ({
      id: String(item.id || ''),
      viewpoint: String(item.viewpoint || ''),
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
      viewpoint: String(item?.viewpoint || ''),
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
  const filesByItem = value.filesByItem && typeof value.filesByItem === 'object'
    ? Object.fromEntries(Object.entries(value.filesByItem).map(([id, path]) => [String(id), String(path || '')]))
    : {};
  const legacyAspect = !value.aspect && Object.values(filesByItem).some(Boolean) ? '1:1' : DEFAULT_STICKER_ASPECT;
  const restoredAspect = normalizeStickerAspect(value.aspect || legacyAspect);
  const restoredPlanAspect = normalizeStickerAspect(
    value.planAspect || (value.aspect ? value.aspect : '1:1'),
  );
  return {
    topic: String(value.topic || ''),
    count: Math.min(9, Math.max(1, Number(value.count) || items.length)),
    style: String(value.style || ''),
    medium: String(value.medium || ''),
    language: normalizeStickerLanguage(value.language),
    aspect: restoredAspect,
    planLanguage: String(value.planLanguage || ''),
    planAspect: restoredPlanAspect,
    type: String(value.type || ''),
    narrative: String(value.narrative || ''),
    summary: String(value.summary || '').slice(0, 200),
    title: stickerMessageTitle(value.title),
    digest: String(value.digest || '').slice(0, 120),
    items,
    directory: directory.startsWith('posts/stickers/') && !directory.split('/').includes('..') ? directory : '',
    filesByItem,
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
