import { checkDraft, normalizeBodyMarkdown, splitMarkdownBlocks } from './writing.mjs';
import { isCoverImageAlt } from './markdown.mjs';
import { fencesBalanced, lineCodeFlags } from './markdown-syntax.mjs';

const SEVERITY_ORDER = { block: 0, warning: 1, suggestion: 2 };
const RAW_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]*)\)/g;

function issue(level, category, message, excerpt = '', signal = '') {
  return { level, category, message, excerpt: String(excerpt || '').slice(0, 160), ...(signal ? { signal } : {}) };
}

export function findImagePlaceholders(markdown) {
  return parseImageSyntax(markdown).markers
    .filter(marker => marker.src.startsWith('placeholder'))
    .map(marker => ({ alt: marker.alt, src: marker.src, markdown: marker.marker }));
}

function resolveImageReferences(markdown) {
  const text = visibleMarkdown(markdown);
  const definitions = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+["“'‘](.*?)["”'’])?\s*$/);
    if (match) definitions.set(match[1].toLowerCase(), { url: match[2], title: match[3] || '' });
  }
  return text.split('\n').map(line => line.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (match, alt, id) => {
    const item = definitions.get((id || alt).toLowerCase());
    return item ? '![' + alt + '](' + item.url + (item.title ? ' "' + item.title + '"' : '') + ')' : match;
  })).join('\n');
}

function parseImageSyntax(markdown) {
  const resolved = resolveImageReferences(markdown);
  const markers = [];
  const invalid = [];
  for (const match of resolved.matchAll(RAW_IMAGE_PATTERN)) {
    const alt = match[1];
    const rawTarget = match[2].trim();
    if (!rawTarget || rawTarget.startsWith('<')) {
      invalid.push(match[0]);
      continue;
    }
    const target = rawTarget.match(/^(\S+)(?:\s+(["“'‘][\s\S]*["”'’]))?$/);
    if (!target) {
      invalid.push(match[0]);
      continue;
    }
    markers.push({
      alt,
      src: target[1],
      title: target[2] || '',
      marker: match[0],
    });
  }
  return { markers, invalid };
}

function normalizedImagePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function localImageMarkers(markdown) {
  return parseImageSyntax(markdown).markers
    .filter(marker => !/^(?:https?:)?\/\//i.test(marker.src));
}

export function preservesLocalImageMarkers(before, after) {
  const original = localImageMarkers(before);
  const next = localImageMarkers(after);
  const originalFiles = original.filter(marker => !marker.src.startsWith('placeholder'));
  const nextFiles = next.filter(marker => !marker.src.startsWith('placeholder'));
  if (originalFiles.length !== nextFiles.length) return false;
  if (originalFiles.some((marker, index) => marker.marker !== nextFiles[index].marker)) return false;

  const placeholders = original.filter(marker => marker.src.startsWith('placeholder'));
  if (!placeholders.length) return true;
  const counts = new Map();
  for (const marker of placeholders) counts.set(marker.marker, (counts.get(marker.marker) || 0) + 1);
  for (const marker of next) {
    if (!counts.has(marker.marker)) continue;
    const remaining = counts.get(marker.marker) - 1;
    if (remaining < 0) return false;
    counts.set(marker.marker, remaining);
  }
  if ([...counts.values()].some(value => value !== 0)) return false;

  let cursor = 0;
  for (const marker of next) {
    if (marker.marker === original[cursor].marker) cursor += 1;
    if (cursor === original.length) return true;
  }
  return false;
}

export function preservesImageStructure(before, after) {
  if (!preservesLocalImageMarkers(before, after)) return false;
  const beforeSyntax = parseImageSyntax(before);
  const afterSyntax = parseImageSyntax(after);
  if (afterSyntax.invalid.length) return false;
  if (afterSyntax.markers.some(marker => /^(?:https?:)?\/\//i.test(marker.src))) return false;

  const externalAlts = new Map();
  const originalPlaceholders = new Map();
  for (const marker of beforeSyntax.markers) {
    if (/^(?:https?:)?\/\//i.test(marker.src)) {
      externalAlts.set(marker.alt, (externalAlts.get(marker.alt) || 0) + 1);
    } else if (marker.src.startsWith('placeholder')) {
      originalPlaceholders.set(marker.marker, (originalPlaceholders.get(marker.marker) || 0) + 1);
    }
  }
  for (const marker of afterSyntax.markers) {
    if (!marker.src.startsWith('placeholder')) continue;
    const existing = originalPlaceholders.get(marker.marker) || 0;
    if (existing > 0) {
      originalPlaceholders.set(marker.marker, existing - 1);
      continue;
    }
    const external = externalAlts.get(marker.alt) || 0;
    if (external <= 0) return false;
    externalAlts.set(marker.alt, external - 1);
  }
  return [...originalPlaceholders.values()].every(value => value === 0)
    && [...externalAlts.values()].every(value => value === 0);
}

function contentText(markdown) {
  return visibleMarkdown(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[`*_>#()[\]{}~|-]/g, ' ')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function contentShingles(text) {
  const size = 4;
  if (text.length < size) return new Set(text ? [text] : []);
  const values = new Set();
  for (let index = 0; index <= text.length - size; index += 1) values.add(text.slice(index, index + size));
  return values;
}

export function preservesSourceContent(before, after, minimumCoverage = 0.45) {
  const beforeText = contentText(before);
  const afterText = contentText(after);
  if (!beforeText) return true;
  if (!afterText) return false;
  const lengthRatio = afterText.length / beforeText.length;
  if (lengthRatio < 0.7 || lengthRatio > 1.45) return false;
  const original = contentShingles(beforeText);
  const next = contentShingles(afterText);
  if (!original.size) return true;
  let matched = 0;
  for (const value of original) if (next.has(value)) matched += 1;
  const forward = matched / original.size;
  const reverse = matched / next.size;
  return forward >= Math.max(0.65, minimumCoverage) && reverse >= 0.5;
}

function visibleMarkdown(markdown) {
  const sourceLines = String(markdown || '').split('\n');
  const codeFlags = lineCodeFlags(sourceLines);
  const lines = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    if (codeFlags[index]) continue;
    const rawLine = sourceLines[index];
    lines.push(rawLine.replace(/(`+)([\s\S]*?)\1/g, ''));
  }
  return lines.join('\n');
}

function bodyText(markdown) {
  return splitMarkdownBlocks(markdown)
    .filter(block => ['paragraph', 'list', 'quote'].includes(block.kind))
    .map(block => block.text)
    .join('\n');
}

function matchesOf(text, pattern) {
  return [...String(text || '').matchAll(pattern)].map(match => match[0]);
}

function containsAny(text, words) {
  return (Array.isArray(words) ? words : [])
    .map(word => String(word || '').trim())
    .filter(Boolean)
    .filter(word => text.toLowerCase().includes(word.toLowerCase()));
}

const AI_FINGERPRINTS = [
  {
    id: 1,
    name: '工整三段式排比',
    signal: '中信号',
    detect: text => {
      const lines = text.split(/\n+/).filter(Boolean);
      const parallel = lines.filter(line => (line.match(/，[^，。！？]{2,18}，[^，。！？]{2,18}，/g) || []).length > 0);
      return parallel.length >= 3 ? parallel.slice(0, 3) : [];
    },
  },
  {
    id: 2,
    name: '「不是 X，而是 Y」句式滥用',
    signal: '强信号',
    detect: text => {
      const found = matchesOf(text, /不是[^，。！？\n]{1,30}，?而是[^，。！？\n]{1,40}/g);
      return found.length >= 3 ? found : [];
    },
  },
  {
    id: 3,
    name: '面面俱到、没有取舍',
    signal: '强信号',
    detect: text => {
      const markers = ['优点', '缺点', '适用', '不适合', '前提', '例外', '另一方面', '当然'];
      const hits = markers.filter(marker => text.includes(marker));
      return hits.length >= 5 ? [hits.join('、')] : [];
    },
  },
  {
    id: 4,
    name: '反复让步、两头讨好',
    signal: '中信号',
    detect: text => {
      const found = matchesOf(text, /(?:当然|诚然|不可否认|话虽如此|需要指出的是)[，,]/g);
      return found.length >= 2 ? found : [];
    },
  },
  {
    id: 5,
    name: '命名仪式感',
    signal: '中信号',
    detect: text => matchesOf(text, /(?:称为|称之为|这就是所谓的|我把它叫作)[「“『]?[^」”』，。]{2,24}[」”』]?/g),
  },
  {
    id: 6,
    name: '情绪曲线太平滑',
    signal: '中信号',
    detect: text => {
      const emotional = matchesOf(text, /(?:温暖|治愈|从容|美好|力量|希望|赋能|平静)/g);
      return emotional.length >= 8 && !/[！？]/.test(text) ? [emotional.slice(0, 8).join('、')] : [];
    },
  },
  {
    id: 7,
    name: '祝福式收尾',
    signal: '强信号',
    detect: text => matchesOf(text, /(?:愿你在|愿你|你值得拥有|希望你永远)[^。！？\n]{0,50}[。！？]?/g),
  },
  {
    id: 8,
    name: '翻译腔',
    signal: '中信号',
    detect: text => {
      const found = matchesOf(text, /(?:值得注意的是|在某种程度上|众所周知|让我们来看看|在……的过程中|被认为是)[^。！？\n]{0,40}/g);
      return found.length >= 2 ? found : [];
    },
  },
  {
    id: 9,
    name: '万能套话开头',
    signal: '强信号',
    detect: text => {
      const first = text.trim().slice(0, 120);
      return /^(?:随着[^，。]{2,30}的发展|在当今|在这个|在快节奏的现代生活)/.test(first) ? [first.slice(0, 80)] : [];
    },
  },
  {
    id: 10,
    name: '强行拔高升华',
    signal: '中信号',
    detect: text => {
      const tail = text.trim().slice(-260);
      return /(?:人生|时代|意义|成长|生活态度|更大世界|未来已来)/.test(tail) && !/(?:人生|成长)/.test(text.slice(0, -260)) ? [tail.slice(-120)] : [];
    },
  },
  {
    id: 11,
    name: '模板化假故事',
    signal: '中信号',
    detect: text => {
      const found = matchesOf(text, /(?:我有个朋友|记得有一次|曾经有个人)[^。！？\n]{0,100}/g);
      return found.filter(value => !/\d{1,2}点|昨天|上周|在上海|在北京|咖啡|会议|电话|微信/.test(value));
    },
  },
  {
    id: 12,
    name: '总分总八股',
    signal: '中信号',
    detect: text => {
      const found = matchesOf(text, /(?:本文将从[^。]{0,30}(?:方面|部分)|总而言之|综上所述|最后总结)/g);
      return found;
    },
  },
  {
    id: 13,
    name: '过度规整的标点与节奏',
    signal: '弱信号',
    detect: text => {
      const sentences = text.split(/[。！？!?]/).map(item => item.trim()).filter(Boolean);
      if (sentences.length < 12) return [];
      const lengths = sentences.map(item => [...item].length);
      const average = lengths.reduce((sum, item) => sum + item, 0) / lengths.length;
      const variance = lengths.reduce((sum, item) => sum + (item - average) ** 2, 0) / lengths.length;
      return Math.sqrt(variance) < 4 && !/[？！]|……|——/.test(text) ? ['句长标准差约 ' + Math.sqrt(variance).toFixed(1)] : [];
    },
  },
  {
    id: 14,
    name: '形容词和副词通货膨胀',
    signal: '弱信号',
    detect: text => {
      const found = matchesOf(text, /(?:极其重要|无比关键|真正意义上|彻头彻尾|完美解决|全面提升|深度赋能|颠覆性)/g);
      return found.length >= 3 ? found : [];
    },
  },
  {
    id: 15,
    name: '概念名词扎堆、缺少具体',
    signal: '中信号',
    detect: text => {
      const words = ['赋能', '闭环', '抓手', '底层逻辑', '认知升级', '护城河', '方法论', '价值锚点'];
      const hits = words.filter(word => text.includes(word));
      const concrete = (text.match(/\d+(?:\.\d+)?\s*(?:%|元|万|千|小时|分钟|天|次|个)/g) || []).length;
      return hits.length >= 3 && concrete < 2 ? [hits.join('、')] : [];
    },
  },
];

const TYPO_RULES = [
  [/的的/g, '「的的」'],
  [/了了/g, '「了了」'],
  [/帐号/g, '「帐号」应为「账号」'],
  [/登陆(?=微信|账号|系统)/g, '「登陆」应为「登录」'],
  [/做为/g, '「做为」应为「作为」'],
  [/即使.*也.*但是/g, '「即使…也…但是」句式杂糅'],
  [/其它/g, '「其它」建议统一为「其他」'],
  [/部份/g, '「部份」应为「部分」'],
];

export function detectAiFlavor(markdown) {
  const text = bodyText(markdown);
  const matches = [];
  for (const fingerprint of AI_FINGERPRINTS) {
    const excerpts = fingerprint.detect(text).filter(Boolean);
    if (!excerpts.length) continue;
    matches.push({
      id: fingerprint.id,
      name: fingerprint.name,
      signal: fingerprint.signal,
      excerpts: excerpts.slice(0, 3),
    });
  }
  return matches;
}

export function reviewArticle(markdown, config = {}, extras = {}) {
  const source = String(markdown || '');
  const text = bodyText(source);
  const result = checkDraft(source, config);
  const issues = [];

  if (!fencesBalanced(source.split('\n'))) issues.push(issue('block', 'Markdown', '代码围栏未闭合，无法可靠排版。'));
  for (const message of result.issues) issues.push(issue('block', '写作规范', message));
  for (const message of result.warnings) issues.push(issue('warning', '写作规范', message));

  const forbidden = [...(config.forbidden_words || []), ...(config.custom_sensitive_words || [])];
  for (const word of containsAny(source, forbidden)) {
    issues.push(issue('block', '敏感词', '命中禁用或敏感词「' + word + '」。', word));
  }
  const visible = visibleMarkdown(source);
  const markdownTitle = visible.match(/^#\s+(.+)$/m)?.[1]?.trim() || visible.split('\n')[0] || '';
  const titleText = [markdownTitle, String(extras.title || '').trim()].filter(Boolean).join('\n');
  const titleForbidden = [...new Set([
    ...containsAny(titleText, config.forbidden_title_phrases || []),
    ...containsAny(titleText, forbidden),
  ])];
  for (const word of titleForbidden) issues.push(issue('block', '标题规范', '标题包含禁用表达「' + word + '」。', word));
  const titleLimit = Math.max(1, Number(config.title_max_length) || 64);
  if ([markdownTitle, String(extras.title || '').trim()].some(value => [...value].length > titleLimit)) {
    issues.push(issue('block', '标题规范', '标题超过 ' + titleLimit + ' 字上限。'));
  }

  for (const [pattern, message] of TYPO_RULES) {
    const matches = matchesOf(source, pattern);
    for (const match of [...new Set(matches)].slice(0, 5)) issues.push(issue('warning', '错别字', message, match));
  }

  const links = matchesOf(visible, /\]\((https?:\/\/[^)\s]+)\)/g);
  if (links.length > 10) issues.push(issue('warning', '链接', '正文有 ' + links.length + ' 个外链，发布前请逐一确认可访问。'));
  const imageSyntax = parseImageSyntax(source);
  const imageMarkers = imageSyntax.markers
    .filter(marker => !marker.src.startsWith('placeholder'));
  const externalImages = imageMarkers.filter(marker => /^(?:https?:)?\/\//i.test(marker.src));
  if (externalImages.length) issues.push(issue('block', '图片', '正文仍含外链图片，发布前必须换成本地图片。'));
  const invalidImages = imageMarkers.filter(marker =>
    !/^(?:https?:)?\/\//i.test(marker.src)
      && (normalizedImagePath(marker.src).startsWith('/')
        || normalizedImagePath(marker.src).split('/').includes('..')
        || /^[a-z][a-z0-9+.-]*:/i.test(marker.src)));
  if (invalidImages.length) issues.push(issue('block', '图片', '正文含宿主无法读取的图片路径，请改为项目内相对路径。'));
  if (imageSyntax.invalid.length) issues.push(issue('block', '图片', '正文含不支持或无法解析的图片语法。', imageSyntax.invalid[0]));

  const requiredReview = Array.isArray(config.review_required) ? config.review_required : [];
  if (requiredReview.includes('原创标注') && !String(config.original_attribution || '').trim()) {
    issues.push(issue('warning', '原创标注', '尚未填写原创标注。'));
  }
  if (requiredReview.includes('链接') && links.length > 0) {
    issues.push(issue('suggestion', '链接', '已检查 ' + links.length + ' 个正文链接，请确认均为可信来源。'));
  }

  const cover = String(extras.cover || '').trim();
  const placeholders = findImagePlaceholders(source)
    .filter(item => !(cover && isCoverImageAlt(item.alt)));
  if (placeholders.length) {
    issues.push(issue(
      'warning',
      '配图',
      '仍有 ' + placeholders.length + ' 个配图占位符，排版或配图后才能发布。',
      placeholders[0].markdown,
    ));
  }

  if (extras.html) {
    if (/<script\b|javascript:|on\w+\s*=|<iframe\b|<object\b/i.test(extras.html)) {
      issues.push(issue('block', 'HTML', 'HTML 含脚本、事件属性或不允许的嵌入。'));
    }
    if (/src=["']https?:\/\//i.test(extras.html)) {
      issues.push(issue('warning', 'HTML', 'HTML 仍引用外部图片，发布前会由宿主校验拦截。'));
    }
  }

  const fingerprints = detectAiFlavor(source);
  for (const fingerprint of fingerprints) {
    issues.push(issue(
      'suggestion',
      'AI 味',
      '可能命中「' + fingerprint.name + '」（' + fingerprint.signal + '）。',
      fingerprint.excerpts[0],
      fingerprint.signal,
    ));
  }

  issues.sort((left, right) => SEVERITY_ORDER[left.level] - SEVERITY_ORDER[right.level]);
  return {
    ok: !issues.some(item => item.level === 'block'),
    issues,
    counts: {
      block: issues.filter(item => item.level === 'block').length,
      warning: issues.filter(item => item.level === 'warning').length,
      suggestion: issues.filter(item => item.level === 'suggestion').length,
    },
    fingerprints,
    metrics: result.metrics,
    outline: result.outline,
  };
}

export function formatReviewMarkdown(review) {
  const labels = { block: '阻断', warning: '警告', suggestion: '建议' };
  const rows = (review.issues || []).map(item =>
    '- [' + labels[item.level] + '] **' + item.category + '**：' + item.message + (item.excerpt ? '\n  > ' + item.excerpt.replace(/\n/g, ' ') : ''));
  return '# 内容审稿\n\n' +
    '阻断 ' + review.counts.block + ' · 警告 ' + review.counts.warning + ' · 建议 ' + review.counts.suggestion + '\n\n' +
    (rows.length ? rows.join('\n') : '未发现需要修改的问题。') + '\n';
}

export function normalizeBlockFixMarkdown(value) {
  let text = String(value || '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n');
  const headingIndex = lines.findIndex(line => /^#\s+\S/.test(line));
  if (headingIndex > 0) {
    let openIndex = -1;
    let fenceChar = '';
    let fenceLength = 0;
    for (let index = 0; index < headingIndex; index += 1) {
      const match = lines[index].match(/^(`{3,}|~{3,})\s*(?:markdown|md)?\s*$/i);
      if (!match) continue;
      openIndex = index;
      fenceChar = match[1][0];
      fenceLength = match[1].length;
      break;
    }
    if (openIndex >= 0) {
      let closeIndex = -1;
      for (let index = lines.length - 1; index > headingIndex; index -= 1) {
        const match = lines[index].match(/^(`{3,}|~{3,})\s*$/);
        if (match && match[1][0] === fenceChar && match[1].length >= fenceLength) {
          closeIndex = index;
          break;
        }
      }
      if (closeIndex < 0) return '';
      const inner = lines.slice(openIndex + 1, closeIndex);
      if (!fencesBalanced(inner)) return '';
      text = inner.join('\n').trim();
    }
  }
  const firstHeading = text.search(/^#\s+\S/m);
  if (firstHeading > 0) {
    const prefix = text.slice(0, firstHeading);
    text = text.slice(firstHeading);
    if (/```/.test(prefix)) text = text.replace(/\n```\s*$/, '');
  }
  if (!fencesBalanced(text.split('\n'))) return '';
  const normalized = normalizeBodyMarkdown(text);
  return normalized ? normalized + '\n' : '';
}

export function reviewBlockFix(value, config = {}, extras = {}) {
  const markdown = normalizeBlockFixMarkdown(value);
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const metadataTitle = String(extras.title || '').trim();
  const review = reviewArticle(markdown, config, {
    ...extras,
    title: title || extras.title,
  });
  const metadataReview = metadataTitle && metadataTitle !== title
    ? reviewArticle(markdown, config, { ...extras, title: metadataTitle })
    : review;
  const preservedImages = extras.source === undefined
    ? true
    : preservesImageStructure(extras.source, markdown);
  const preservedContent = extras.source === undefined
    ? true
    : preservesSourceContent(extras.source, markdown);
  return {
    markdown,
    title,
    review,
    metadataReview,
    needsTitleSync: Boolean(title) && !metadataReview.ok,
    preservedImages,
    preservedContent,
    ok: Boolean(markdown) && review.ok && preservedImages && preservedContent,
  };
}

export const AI_REVIEW_HEADING = '## AI 补充意见';
export const AI_REVIEW_NOTE = '> 以下为 AI 补充提示，不改变上方本地统计和进入排版的门禁。';

function cleanAiSupplement(value) {
  let text = String(value || '').replace(AI_REVIEW_NOTE, '').trimStart();
  while (/^##\s*AI 补充意见[^\n]*\n+/i.test(text)) {
    text = text.replace(/^##\s*AI 补充意见[^\n]*\n+/i, '');
  }
  text = text.replace(/^#{1,6}\s+(?!阻断|警告|建议)[^\n]*\n+/i, '');
  return text.trim();
}

export function aiReviewSupplement(markdown) {
  const match = String(markdown || '').match(/\n*## AI 补充意见\s*\n+([\s\S]*)$/);
  if (!match) return '';
  return cleanAiSupplement(match[1]);
}

export function mergeReviewMarkdown(markdown, supplement) {
  const base = String(markdown || '').replace(/\n*## AI 补充意见\s*\n[\s\S]*$/, '').trimEnd();
  const cleaned = cleanAiSupplement(supplement);
  if (!cleaned) return base ? base + '\n' : '';
  return (base ? base + '\n\n' : '') + AI_REVIEW_HEADING + '\n\n' + AI_REVIEW_NOTE + '\n\n' + cleaned + '\n';
}

export { AI_FINGERPRINTS };
