import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {
  DEFAULT_CONFIG,
  deepMerge,
  mergedConfig,
  resolvePreset,
  serializeConfig,
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
    cover_aspect: '4:3',
    caption_style: '有',
    publish_method: 'now',
    drafts_root: '../outside',
    published_root: 'output/escape',
  });
  assert.ok(errors.some(message => message.includes('标题长度')));
  assert.ok(errors.some(message => message.includes('摘要')));
  assert.ok(errors.some(message => message.includes('图片来源')));
  assert.ok(errors.some(message => message.includes('封面比例')));
  assert.ok(errors.some(message => message.includes('图注')));
  assert.ok(errors.some(message => message.includes('发布方式')));
  assert.ok(errors.some(message => message.includes('草稿目录')));
  assert.ok(errors.some(message => message.includes('归档目录')));
});
