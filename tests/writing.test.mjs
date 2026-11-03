import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDraft,
  cjkCount,
  extractBoldOutline,
  normalizeBodyMarkdown,
  parseRange,
  splitTitleAndBody,
  stripCitations,
} from '../src/lib/writing.mjs';

const validArticle = `# 测试标题

> 这是正文导语，告诉已经点进来的读者这篇文章讲什么、按什么顺序展开。

## 第一节

这一段有一个**关键数字 88%**，读者只看加粗也能知道结论。

> 真正有用的方法。 —— 测试

## 第二节

- **先做选择**：先把边界说清楚。
- **再做验证**：用真实数据复核。
`;

test('range and CJK helpers are deterministic', () => {
  assert.deepEqual(parseRange('1800-2500'), [1800, 2500]);
  assert.deepEqual(parseRange('坏值', [1, 2]), [1, 2]);
  assert.equal(cjkCount('中文 88% abc'), 2);
});

test('valid short article still passes structural checks', () => {
  const result = checkDraft(validArticle, { target_word_count: '80-800' });
  assert.equal(result.ok, true);
  assert.equal(result.metrics.headings, 2);
  assert.equal(result.metrics.quoteCards, 1);
  assert.ok(result.outline.some(value => value.includes('88%')));
});

test('missing lead and headings are blocking', () => {
  const result = checkDraft('# 只有标题\n\n正文没有导语。', { target_word_count: '10-100' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(message => message.includes('摘要导语')));
  assert.ok(result.issues.some(message => message.includes('两个')));
});

test('citation stripping preserves whitespace shape', () => {
  const input = '事实一句（资料路径：`.aws-article/products/A/介绍.md`）。\n\n\n下一段\n';
  assert.equal(stripCitations(input), '事实一句。\n\n下一段\n');
});

test('bold outline and title split work', () => {
  assert.deepEqual(extractBoldOutline('**一** 和 **二**'), ['一', '二']);
  assert.deepEqual(splitTitleAndBody('# 标题\n\n正文'), { title: '标题', body: '正文' });
  assert.equal(normalizeBodyMarkdown('a  \r\n\r\n\r\nb'), 'a\n\nb');
});
