import YAML from 'yaml';
import { DEFAULT_MCP_IMAGE_ARGS, renderMcpArguments } from './mcp-images.mjs';
import { normalizeStickerLanguage } from './stickers.mjs';

export const PRESET_FIELDS = [
  'structure',
  'closing_block',
  'title_style',
  'format_preset',
  'format_scheme',
  'cover_image_style',
  'article_image_style',
  'sticker_style',
];

export const IMAGE_ASPECTS = ['3:4', '4:3', '16:9', '1:1', '1.91:1', '2.35:1'];

export const DEFAULT_CONFIG = {
  article_category: '',
  target_reader: '',
  tone: '口语化',
  update_frequency: '',
  default_author: '',
  topic_direction: '',
  title_style: '干货型',
  title_max_length: 25,
  summary_length: '80-128',
  summary_guidance: '',
  forbidden_title_phrases: [],
  writing_style: '口语化',
  paragraph_preference: '短段为主',
  heading_density: '每节必有小标题',
  target_word_count: '1800-2500',
  closing_block: '',
  forbidden_words: [],
  original_attribution: '',
  default_structure: [],
  default_closing_block: [],
  default_title_style: [],
  default_format_preset: ['亲和'],
  default_format_scheme: [],
  default_cover_image_style: [],
  default_article_image_style: [],
  default_sticker_style: [],
  custom_structure: [],
  custom_closing_block: [],
  custom_title_style: [],
  custom_format_preset: [],
  custom_format_scheme: [],
  custom_cover_image_style: [],
  custom_article_image_style: [],
  custom_sticker_style: [],
  image_source: 'generated',
  image_generator: 'model',
  mcp_image_server: '',
  mcp_image_tool: '',
  mcp_image_args: DEFAULT_MCP_IMAGE_ARGS,
  cover_aspect: '3:4',
  article_image_aspect: '3:4',
  cover_style: '简约',
  image_density: '每节一图',
  caption_style: '有图注',
  multi_image_count: 6,
  sticker_language: '简体中文',
  review_required: ['敏感词', '错别字', '链接', '原创标注'],
  custom_sensitive_words: [],
  review_output_format: '分块详细',
  embeds: {
    profiles: [],
    miniprograms: [],
    miniprogram_cards: [],
    related_articles: { manual: [] },
  },
  drafts_root: 'drafts/',
  published_root: 'posts/published/',
  series_root: 'series/',
  publish_method: 'draft',
  wechat_publish_slot: 1,
  need_open_comment: 1,
  only_fans_can_comment: 0,
  publish_completed: false,
  writing_model: {},
  image_model: {},
};

export const ARTICLE_DEFAULTS = {
  title: '',
  author: '',
  digest: '',
  cover_image: '',
  pic_crop_235_1: '',
  pic_crop_1_1: '',
  cover_copy: '',
  body_copies: {},
  content_source: 'article.html',
  need_open_comment: 1,
  only_fans_can_comment: 0,
  publish_completed: false,
  image_source: 'generated',
  image_medium: '',
  default_structure: [],
  default_closing_block: [],
  default_title_style: [],
  default_format_preset: [],
  default_format_scheme: [],
  default_cover_image_style: [],
  default_article_image_style: [],
  default_sticker_style: [],
};

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function parseYamlObject(text, label = 'YAML') {
  if (typeof text !== 'string') throw new ConfigError(label + '内容无效。');
  let value;
  try {
    value = YAML.parse(text);
  } catch (error) {
    throw new ConfigError(label + '无法解析：' + (error?.message || '格式错误'));
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ConfigError(label + '根节点必须是对象。');
  return value;
}

function clone(value) {
  return structuredClone(value);
}

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return clone(base);
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

export function normalizePresetList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
}

export function resolvePreset(config, article, field) {
  const articleValue = normalizePresetList(article?.[`default_${field}`]);
  if (articleValue.length) return articleValue;
  const customValue = normalizePresetList(config?.[`custom_${field}`]);
  if (customValue.length) return customValue;
  return normalizePresetList(config?.[`default_${field}`]);
}

export function singlePreset(config, article, field, fallback = '') {
  const values = resolvePreset(config, article, field);
  return values.length ? values[0] : fallback;
}

export function resolveFormatOptions(config = {}, article = {}) {
  return {
    theme: singlePreset(config, article, 'format_preset', '亲和'),
    scheme: singlePreset(config, article, 'format_scheme', ''),
    color: String(article.format_color || config.format_color || ''),
    fontSize: String(article.format_font_size || config.format_font_size || ''),
  };
}

const SUMMARY_RANGE_PATTERN = /(\d{1,4})\s*[-–—~～至]\s*(\d{1,4})/g;

export function splitSummarySetting(value) {
  if (typeof value !== 'string' || !value.trim()) return { range: '', guidance: '' };
  const matches = [...value.matchAll(SUMMARY_RANGE_PATTERN)];
  if (!matches.length) return { range: '', guidance: '' };
  const preferred = matches.find(match => /^\s*字/.test(value.slice((match.index ?? 0) + match[0].length)));
  const selected = preferred || matches[0];
  const start = selected.index ?? 0;
  const end = start + selected[0].length;
  const range = selected[1] + '-' + selected[2];
  const unit = /^\s*字/.exec(value.slice(end));
  const cutoff = unit ? end + unit[0].length : end;
  const guidance = (value.slice(0, start) + value.slice(cutoff))
    .replace(/\s+([，,；;、])/g, '$1')
    .replace(/[，,、；;]+/g, run => run[run.length - 1])
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s，,；;、]+|[\s，,；;、]+$/g, '')
    .trim();
  return { range, guidance };
}

export function mergedConfig(config = {}, article = {}) {
  const normalized = deepMerge(DEFAULT_CONFIG, config);
  const result = deepMerge(normalized, article || {});
  const summary = splitSummarySetting(result.summary_length);
  if (summary.range) {
    result.summary_length = summary.range;
    if (!String(result.summary_guidance ?? '').trim() && summary.guidance) result.summary_guidance = summary.guidance;
  }
  for (const field of PRESET_FIELDS) result[`resolved_${field}`] = resolvePreset(normalized, article, field);
  return result;
}

export function serializeConfig(config) {
  const value = clone(config || {});
  for (const field of PRESET_FIELDS) delete value[`resolved_${field}`];
  return YAML.stringify(value, { lineWidth: 0 });
}

export function serializeArticle(article) {
  return YAML.stringify(deepMerge(ARTICLE_DEFAULTS, article || {}), { lineWidth: 0 });
}

export function validateConfig(config) {
  const value = deepMerge(DEFAULT_CONFIG, config);
  const errors = [];
  const titleMax = Number(value.title_max_length);
  if (!Number.isInteger(titleMax) || titleMax < 1 || titleMax > 80) errors.push('标题长度应为 1–80。');
  const pureSummaryRange = typeof value.summary_length === 'string' && /^\s*\d+\s*-\s*\d+\s*$/.test(value.summary_length);
  if (!pureSummaryRange && !splitSummarySetting(value.summary_length).range) errors.push('摘要字数范围需包含类似「80-128」的字数区间。');
  if (!['generated', 'user'].includes(value.image_source)) errors.push('图片来源应为 generated 或 user。');
  if (!['model', 'mcp'].includes(value.image_generator)) errors.push('生图方式应为 model 或 mcp。');
  if (value.image_generator === 'mcp' && value.image_source !== 'user') {
    if (!String(value.mcp_image_server || '').trim()) errors.push('使用 MCP 生图时需要选择 MCP 服务。');
    if (!String(value.mcp_image_tool || '').trim()) errors.push('使用 MCP 生图时需要选择生图工具。');
    try {
      renderMcpArguments(value.mcp_image_args, { prompt: '测试', size: '1:1', count: 1 });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'MCP 工具参数模板无效。');
    }
  }
  if (!IMAGE_ASPECTS.includes(value.cover_aspect)) errors.push('封面比例无效。');
  if (!IMAGE_ASPECTS.includes(value.article_image_aspect)) errors.push('正文配图比例无效。');
  if (!['有图注', '无图注', '关键图有'].includes(value.caption_style)) errors.push('图注规则无效。');
  if (!['draft', 'published', 'none'].includes(value.publish_method)) errors.push('发布方式无效。');
  if (!Array.isArray(value.review_required)) errors.push('审稿规则必须是列表。');
  if (!Array.isArray(value.forbidden_words)) errors.push('禁用词必须是列表。');
  if (!/^drafts(?:\/[^\\:*?"<>|]+)*\/?$/.test(String(value.drafts_root || ''))) errors.push('草稿目录必须位于 drafts/ 下。');
  if (!/^posts\/[^\\:*?"<>|]+(?:\/[^\\:*?"<>|]+)*\/?$/.test(String(value.published_root || ''))) errors.push('归档目录必须位于 posts/ 下。');
  return errors;
}

export function normalizeConfigForSave(config = {}) {
  const value = deepMerge(DEFAULT_CONFIG, config);
  const summary = splitSummarySetting(value.summary_length);
  if (summary.range) value.summary_length = summary.range;
  if (!String(value.summary_guidance ?? '').trim() && summary.guidance) value.summary_guidance = summary.guidance;
  value.title_max_length = Number(value.title_max_length) || 25;
  value.multi_image_count = Math.min(9, Math.max(1, Number(value.multi_image_count) || 6));
  value.sticker_language = normalizeStickerLanguage(value.sticker_language);
  value.wechat_publish_slot = Math.max(1, Number(value.wechat_publish_slot) || 1);
  value.need_open_comment = value.need_open_comment ? 1 : 0;
  value.only_fans_can_comment = value.only_fans_can_comment ? 1 : 0;
  value.publish_completed = Boolean(value.publish_completed);
  value.image_generator = value.image_generator === 'mcp' ? 'mcp' : 'model';
  value.mcp_image_server = String(value.mcp_image_server || '').trim();
  value.mcp_image_tool = String(value.mcp_image_tool || '').trim();
  value.mcp_image_args = String(value.mcp_image_args || '').trim() || DEFAULT_MCP_IMAGE_ARGS;
  value.review_required = [...new Set((Array.isArray(value.review_required) ? value.review_required : []).map(String).filter(Boolean))];
  value.forbidden_words = [...new Set((Array.isArray(value.forbidden_words) ? value.forbidden_words : []).map(String).filter(Boolean))];
  value.forbidden_title_phrases = [...new Set((Array.isArray(value.forbidden_title_phrases) ? value.forbidden_title_phrases : []).map(String).filter(Boolean))];
  value.custom_sensitive_words = [...new Set((Array.isArray(value.custom_sensitive_words) ? value.custom_sensitive_words : []).map(String).filter(Boolean))];
  return value;
}
