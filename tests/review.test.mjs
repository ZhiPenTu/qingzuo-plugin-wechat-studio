import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_FINGERPRINTS, detectAiFlavor, formatReviewMarkdown, reviewArticle } from '../src/lib/review.mjs';

const clean = `# 标题

> 这篇讲一次具体测试，先说结论，再说过程。

## 过程

第一次运行只花了**七分钟**。多出来的三分钟用于核对来源。

## 结果

- **先保存**：避免重复操作。
- **再复核**：确认数字与正文一致。
`;

test('there are exactly fifteen AI flavor fingerprints', () => {
  assert.equal(AI_FINGERPRINTS.length, 15);
  assert.deepEqual(AI_FINGERPRINTS.map(item => item.id), Array.from({ length: 15 }, (_, index) => index + 1));
});

test('clean article has no blocking issues', () => {
  const result = reviewArticle(clean, { target_word_count: '10-500' });
  assert.equal(result.ok, true);
  assert.equal(result.counts.block, 0);
});

test('forbidden words and external images block publication', () => {
  const result = reviewArticle(clean + '\n禁用词：绝对第一\n![图](https://evil.example/a.png)', {
    target_word_count: '10-500',
    forbidden_words: ['绝对第一'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.category === '敏感词' && item.level === 'block'));
  assert.ok(result.issues.some(item => item.category === '图片' && item.level === 'block'));
});

test('title metadata is checked against forbidden title phrases', () => {
  const result = reviewArticle(clean, {
    target_word_count: '10-500',
    forbidden_title_phrases: ['震惊'],
  }, { title: '震惊，三分钟学会写作' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.category === '标题规范'));
});

test('AI flavor stays advisory even for strong signals', () => {
  const text = '# 标题\n\n> 导语。\n\n## 一\n\n这不是工具，而是伙伴。这不是速度，而是方向。这不是功能，而是习惯。\n\n## 二\n\n愿你在喧嚣中找到自己的节奏。';
  const result = reviewArticle(text, { target_word_count: '10-500' });
  assert.ok(result.fingerprints.length >= 2);
  assert.ok(result.fingerprints.some(item => item.name.includes('不是')));
  assert.equal(result.fingerprints.every(item => ['强信号', '中信号', '弱信号'].includes(item.signal)), true);
  assert.equal(result.issues.filter(item => item.category === 'AI 味').every(item => item.level === 'suggestion'), true);
});

test('review markdown contains counts and actionable labels', () => {
  const result = reviewArticle(clean, { target_word_count: '10-500' });
  const markdown = formatReviewMarkdown(result);
  assert.match(markdown, /阻断 0/);
  assert.match(markdown, /内容审稿/);
});
