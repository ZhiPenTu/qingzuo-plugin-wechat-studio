import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {
  DEFAULT_CONFIG,
  IMAGE_ASPECTS,
  deepMerge,
  mergedConfig,
  normalizeConfigForSave,
  resolveFormatOptions,
  resolvePreset,
  serializeConfig,
  splitSummarySetting,
  validateConfig,
} from '../src/lib/config.mjs';

test('config precedence is article > custom > default', () => {
  const config = {
    default_format_preset: ['资讯'],
    custom_format_preset: ['书卷'],
  };
  assert.equal(resolvePreset(config, { default_format_preset: ['杂志'] }, 'format_preset')[0], '杂志');
  assert.equal(resolvePreset(config, {}, 'format_preset')[0], '书卷');
  assert.equal(resolvePreset({ default_format_preset: ['资讯'] }, {}, 'format_preset')[0], '资讯');
});

test('image aspect defaults favor complete 3:4 layouts', () => {
  assert.equal(DEFAULT_CONFIG.cover_aspect, '3:4');
  assert.equal(DEFAULT_CONFIG.article_image_aspect, '3:4');
  assert.equal(IMAGE_ASPECTS.includes('3:4'), true);
  assert.deepEqual(validateConfig({
    cover_aspect: '3:4',
    article_image_aspect: '3:4',
  }), []);
});

test('format options preserve article overrides and inherit config defaults', () => {
  const config = {
    default_format_preset: ['资讯'],
    default_format_scheme: ['墨黑'],
    custom_format_preset: ['书卷'],
    custom_format_scheme: ['朱砂'],
    format_color: '#111111',
    format_font_size: '16px',
  };
  assert.deepEqual(resolveFormatOptions(config, {
    default_format_preset: ['杂志'],
    default_format_scheme: ['靛青'],
    format_color: '#222222',
    format_font_size: '15px',
  }), {
    theme: '杂志',
    scheme: '靛青',
    color: '#222222',
    fontSize: '15px',
  });
  assert.deepEqual(resolveFormatOptions(config, {}), {
    theme: '书卷',
    scheme: '朱砂',
    color: '#111111',
    fontSize: '16px',
  });
  assert.deepEqual(resolveFormatOptions({}, {}), {
    theme: '亲和',
    scheme: '',
    color: '',
    fontSize: '',
  });
});

test('merged config preserves unknown fields', () => {
  const merged = mergedConfig({ ...DEFAULT_CONFIG, private_extension: { enabled: true } }, { title_style: '故事型' });
  assert.equal(merged.title_style, '故事型');
  assert.equal(merged.private_extension.enabled, true);
});

test('serialization drops derived fields but keeps unknown fields', () => {
  const text = serializeConfig({ ...DEFAULT_CONFIG, unknown_extension: '保留', resolved_structure: ['x'] });
  const value = YAML.parse(text);
  assert.equal(value.unknown_extension, '保留');
  assert.equal(value.resolved_structure, undefined);
});

test('deep merge replaces arrays and clones values', () => {
  const source = { nested: { a: 1 }, list: [1, 2] };
  const result = deepMerge(source, { nested: { b: 2 }, list: [3] });
  assert.deepEqual(result, { nested: { a: 1, b: 2 }, list: [3] });
  result.list.push(4);
  assert.deepEqual(source.list, [1, 2]);
});

test('config validation reports actionable invalid values', () => {
  const errors = validateConfig({
    title_max_length: 0,
    summary_length: 'long',
    image_source: 'remote',
    cover_aspect: '5:4',
    article_image_aspect: '2:3',
    caption_style: '有',
    publish_method: 'now',
    drafts_root: '../outside',
    published_root: 'output/escape',
  });
  assert.ok(errors.some(message => message.includes('标题长度')));
  assert.ok(errors.some(message => message.includes('摘要')));
  assert.ok(errors.some(message => message.includes('图片来源')));
  assert.ok(errors.some(message => message.includes('封面比例')));
  assert.ok(errors.some(message => message.includes('正文配图比例')));
  assert.ok(errors.some(message => message.includes('图注')));
  assert.ok(errors.some(message => message.includes('发布方式')));
  assert.ok(errors.some(message => message.includes('草稿目录')));
  assert.ok(errors.some(message => message.includes('归档目录')));
});

test('MCP image generation requires a server, tool and valid argument template', () => {
  const valid = validateConfig({ ...DEFAULT_CONFIG, image_generator: 'mcp', mcp_image_server: 'mcp-1', mcp_image_tool: 'generate_image' });
  assert.deepEqual(valid, []);
  const missing = validateConfig({ ...DEFAULT_CONFIG, image_generator: 'mcp', mcp_image_args: '[]' });
  assert.equal(missing.some(item => item.includes('MCP 服务')), true);
  assert.equal(missing.some(item => item.includes('JSON 对象')), true);
  assert.deepEqual(validateConfig({
    ...DEFAULT_CONFIG,
    image_source: 'user',
    image_generator: 'mcp',
    mcp_image_server: '',
    mcp_image_tool: '',
    mcp_image_args: '[]',
  }), []);
});

test('summary setting splits a range from writing guidance', () => {
  const value = '2-3句，60-100字；先给事件由头，再抛出反常识问题';
  assert.deepEqual(splitSummarySetting(value), {
    range: '60-100',
    guidance: '2-3句；先给事件由头，再抛出反常识问题',
  });
  assert.deepEqual(splitSummarySetting('80-128'), { range: '80-128', guidance: '' });
  assert.deepEqual(splitSummarySetting('60 至 100 字'), { range: '60-100', guidance: '' });
  assert.deepEqual(splitSummarySetting(''), { range: '', guidance: '' });
  assert.deepEqual(splitSummarySetting(null), { range: '', guidance: '' });
});

test('mixed summary setting validates and normalizes for save', () => {
  const mixed = '2-3句，60-100字；先给事件由头，再抛出反常识问题';
  assert.deepEqual(validateConfig({ summary_length: mixed }), []);
  const normalized = normalizeConfigForSave({ summary_length: mixed });
  assert.equal(normalized.summary_length, '60-100');
  assert.ok(normalized.summary_guidance.includes('先给事件由头'));
  assert.equal(normalizeConfigForSave({ summary_length: mixed, summary_guidance: '已有说明' }).summary_guidance, '已有说明');
});

test('merged config normalizes legacy mixed summary values', () => {
  const merged = mergedConfig({ summary_length: '2-3句，60-100字；先给事件由头' });
  assert.equal(merged.summary_length, '60-100');
  assert.ok(merged.summary_guidance.includes('先给事件由头'));
  assert.ok(validateConfig({ summary_length: 'long' }).some(message => message.includes('摘要')));
});

test('summary setting picks the first range when no unit marks one', () => {
  assert.deepEqual(splitSummarySetting('先定 20-30 的样本，再看 80-128 的全文'), {
    range: '20-30',
    guidance: '先定 的样本，再看 80-128 的全文',
  });
  const merged = mergedConfig({}, { summary_length: '2-3句，60-100字；先给事件由头', summary_guidance: '已有说明' });
  assert.equal(merged.summary_length, '60-100');
  assert.equal(merged.summary_guidance, '已有说明');
});

test('normalized summary setting survives a serialization round trip', () => {
  const normalized = normalizeConfigForSave({ summary_length: '2-3句，60-100字；先给事件由头' });
  const restored = normalizeConfigForSave(YAML.parse(serializeConfig(normalized)));
  assert.equal(restored.summary_length, '60-100');
  assert.equal(restored.summary_guidance, normalized.summary_guidance);
});
