import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_FINGERPRINTS,
  AI_REVIEW_HEADING,
  aiReviewSupplement,
  detectAiFlavor,
  formatReviewMarkdown,
  mergeReviewMarkdown,
  reviewArticle,
} from '../src/lib/review.mjs';
import { buildReviewPrompt } from '../src/lib/prompts.mjs';

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

test('AI review prompt only supplements local findings within a bounded response', () => {
  const prompt = buildReviewPrompt({ forbidden_words: ['绝对'] }, { title: '测试' }, '正文', {
    localIssues: ['警告 · 配图：仍有 8 个占位符'],
  });
  assert.match(prompt.system, /不要重复本地已列出的问题/);
  assert.match(prompt.system, /不超过 800 字/);
  assert.match(prompt.system, /禁用词：绝对/);
  assert.match(prompt.user, /警告 · 配图：仍有 8 个占位符/);
  assert.match(prompt.user, /只补充新的实质问题/);
});

test('AI review supplements replace only the AI section', () => {
  const local = '# 内容审稿\n\n阻断 0 · 警告 1\n\n- [警告] **配图**：仍有占位符。\n';
  const first = mergeReviewMarkdown(local, '1. 第一条补充。');
  assert.match(first, /仍有占位符/);
  assert.match(first, /第一条补充/);
  assert.equal(first.split(AI_REVIEW_HEADING).length - 1, 1);

  const second = mergeReviewMarkdown(first, AI_REVIEW_HEADING + '\n\n2. 第二条补充。');
  assert.match(second, /仍有占位符/);
  assert.doesNotMatch(second, /第一条补充/);
  assert.match(second, /第二条补充/);
  assert.equal(second.split(AI_REVIEW_HEADING).length - 1, 1);

  const third = mergeReviewMarkdown(local, '## 补充诊断\n\n3. 第三条补充。');
  assert.doesNotMatch(third, /补充诊断/);
  assert.match(third, /第三条补充/);

  const fourth = mergeReviewMarkdown(local, '\n\n## AI 补充意见\n\n## 补充诊断\n\n4. 第四条补充。');
  assert.equal(fourth.split(AI_REVIEW_HEADING).length - 1, 1);
  assert.doesNotMatch(fourth, /补充诊断/);
  assert.match(fourth, /第四条补充/);
});

test('recomputing local review keeps a saved AI supplement', () => {
  const saved = mergeReviewMarkdown('# 旧本地结果\n', 'AI 旧补充');
  const refreshed = mergeReviewMarkdown('# 新本地结果\n', aiReviewSupplement(saved));
  assert.match(refreshed, /新本地结果/);
  assert.doesNotMatch(refreshed, /旧本地结果/);
  assert.match(refreshed, /AI 旧补充/);
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
