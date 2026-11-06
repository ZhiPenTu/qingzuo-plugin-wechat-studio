import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_FINGERPRINTS,
  AI_REVIEW_HEADING,
  aiReviewSupplement,
  detectAiFlavor,
  formatReviewMarkdown,
  mergeReviewMarkdown,
  normalizeBlockFixMarkdown,
  preservesImageStructure,
  preservesLocalImageMarkers,
  preservesSourceContent,
  reviewArticle,
  reviewBlockFix,
} from '../src/lib/review.mjs';
import { buildBlockFixPrompt, buildReviewPrompt } from '../src/lib/prompts.mjs';

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

test('block fix prompt carries only blocking findings and preserves the source constraints', () => {
  const prompt = buildBlockFixPrompt(
    { forbidden_words: ['绝对'], forbidden_title_phrases: ['震惊'], target_word_count: '800-1200' },
    { title: '现有标题' },
    '# 正文',
    {
      issues: [
        { level: 'block', category: '敏感词', message: '命中「绝对」。', excerpt: '绝对第一' },
        { level: 'warning', category: '配图', message: '仍有占位符。' },
      ],
    },
  );
  assert.match(prompt.system, /只修复下面列出的阻断级问题，不处理警告和建议/);
  assert.match(prompt.system, /不新增事实、数字、案例、引文、观点或图片来源/);
  assert.match(prompt.system, /外链图片必须改为保留原 alt 的 placeholder/);
  assert.match(prompt.system, /无法在不虚构的前提下达标时保持安全内容并停止/);
  assert.match(prompt.system, /只输出完整修订后的 Markdown 正文/);
  assert.match(prompt.system, /禁用或敏感词：绝对/);
  assert.match(prompt.system, /标题禁用表达：震惊/);
  assert.match(prompt.user, /当前发布标题：现有标题/);
  assert.match(prompt.user, /敏感词：命中「绝对」。/);
  assert.match(prompt.user, /原句：绝对第一/);
  assert.doesNotMatch(prompt.user, /配图：仍有占位符/);
});

test('block fix output strips fences and leading explanations', () => {
  const fenced = '以下是修复后的正文：\n\n```markdown\n' + clean.trim() + '\n```\n';
  assert.equal(normalizeBlockFixMarkdown(fenced), clean.trim() + '\n');

  const trailingNote = '修复结果如下：\n\n```md\n' + clean.trim() + '\n```\n\n以上为修订正文。';
  assert.equal(normalizeBlockFixMarkdown(trailingNote), clean.trim() + '\n');

  const internalExample = clean + '\n```md\n# 示例标题\n```\n';
  assert.equal(normalizeBlockFixMarkdown(internalExample), clean + '\n```md\n# 示例标题\n```\n');

  const nested = '```markdown\n' + clean + '```js\nconst value = 1;\n```\n```\n';
  const unwrappedNested = normalizeBlockFixMarkdown(nested);
  assert.match(unwrappedNested, /## 结果/);
  assert.match(unwrappedNested, /```js\nconst value = 1;\n```/);

  assert.equal(normalizeBlockFixMarkdown('未闭合：\n\n```markdown\n' + clean.trim()), '');
  assert.equal(
    normalizeBlockFixMarkdown('未闭合：\n\n```markdown\n' + clean + '```js\nconst value = 1;\n```\n'),
    '',
  );
  assert.equal(normalizeBlockFixMarkdown(clean + '\n```md\n未闭合'), '');
});

test('block fix is accepted only after a clean local recheck', () => {
  const config = { target_word_count: '10-500', forbidden_words: ['绝对第一'] };
  const broken = clean.replace('第一次运行只花了', '绝对第一运行只花了');
  const unresolved = reviewBlockFix(broken, config);
  assert.equal(unresolved.ok, false);
  assert.ok(unresolved.review.issues.some(item => item.level === 'block' && item.category === '敏感词'));

  const fixed = reviewBlockFix('修复完成：\n\n' + clean, config);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.title, '标题');
  assert.equal(fixed.markdown, clean);
  assert.equal(fixed.review.counts.block, 0);
});

test('block fix rejects newly introduced external images', () => {
  const fixed = reviewBlockFix(clean + '\n![外链](https://example.com/a.png)', { target_word_count: '10-500' });
  assert.equal(fixed.ok, false);
  assert.ok(fixed.review.issues.some(item => item.level === 'block' && item.category === '图片'));
});

test('block fix reports when the published title needs to follow the revised H1', () => {
  const fixed = reviewBlockFix(clean, {
    target_word_count: '10-500',
    forbidden_words: ['绝对第一'],
  }, { title: '绝对第一的方法' });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.metadataReview.ok, false);
  assert.equal(fixed.needsTitleSync, true);
});

test('a valid custom publish title is not overwritten by the H1', () => {
  const fixed = reviewBlockFix(clean, { target_word_count: '10-500' }, { title: '用户自定义发布标题' });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.metadataReview.ok, true);
  assert.equal(fixed.needsTitleSync, false);
});

test('source fidelity rejects a structurally valid but unrelated replacement', () => {
  const replacement = `# 另一篇

> 这是完全不同的内容，用来说明替换风险。

## 天气

这里讨论**降雨**与**交通**，没有保留原文。

## 饮食

这里继续讨论**早餐**与**睡眠**，结论也不同。
`;
  assert.equal(preservesSourceContent(clean, clean), true);
  assert.equal(preservesSourceContent(clean, replacement), false);
  assert.equal(
    preservesSourceContent(clean, clean.slice(0, Math.floor(clean.length * 0.45)) + replacement),
    false,
  );
  assert.equal(preservesSourceContent(clean, clean + replacement), false);
  const fixed = reviewBlockFix(replacement, { target_word_count: '10-500' }, { source: clean });
  assert.equal(fixed.preservedContent, false);
  assert.equal(fixed.ok, false);
});

test('block fix cannot remove or rewrite existing local image markers', () => {
  const original = clean + '\n![信息图：四步流程](placeholder)\n';
  assert.equal(preservesLocalImageMarkers(original, original), true);
  assert.equal(preservesLocalImageMarkers(original, original + '\n![信息图：四步流程](placeholder)\n'), false);
  assert.equal(preservesLocalImageMarkers(clean, clean + '\n![编造图](invented.png)\n'), false);
  assert.equal(
    preservesLocalImageMarkers(
      clean + '\n![信息图：四步流程](placeholder "图：四步流程")\n',
      clean + '\n![信息图：四步流程](placeholder "图：错误图注")\n',
    ),
    false,
  );
  assert.equal(
    preservesLocalImageMarkers(
      clean + '\n![本地图](imgs/local.png)\n\n![信息图：四步流程](placeholder)\n',
      clean + '\n![信息图：四步流程](placeholder)\n\n![本地图](imgs/local.png)\n',
    ),
    false,
  );

  const removed = reviewBlockFix(clean, { target_word_count: '10-500' }, { source: original });
  assert.equal(removed.preservedImages, false);
  assert.equal(removed.ok, false);

  const preserved = reviewBlockFix(original, { target_word_count: '10-500' }, { source: original });
  assert.equal(preserved.preservedImages, true);
  assert.equal(preserved.ok, true);
});

test('external image checks reject uppercase URL schemes', () => {
  const result = reviewArticle(clean + '\n![外链](HTTPS://example.com/a.png)', { target_word_count: '10-500' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.level === 'block' && item.category === '图片'));
});

test('reference, protocol-relative and invalid local image paths are blocking', () => {
  const cases = [
    clean + '\n![外图][ref]\n\n[ref]: HTTPS://example.com/a.png\n',
    clean + '\n![外图](//cdn.example.com/a.png)\n',
    clean + '\n![外图]( HTTPS://example.com/a.png)\n',
    clean + '\n![根路径图片](/absolute/a.png)\n',
    clean + '\n![越界图片](../a.png)\n',
  ];
  for (const markdown of cases) {
    const result = reviewArticle(markdown, { target_word_count: '10-500' });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(item => item.level === 'block' && item.category === '图片'));
  }
});

test('reference-style local images are preserved by block fixes', () => {
  const original = clean + '\n![本地图][local]\n\n[local]: imgs/local.png\n';
  assert.equal(preservesLocalImageMarkers(original, original), true);
  assert.equal(preservesLocalImageMarkers(original, clean), false);
});

test('titles and leads inside code fences do not satisfy structural checks', () => {
  const markdown = '```md\n# 假标题\n\n> 假导语\n```\n\n## 一\n\n正文段落。\n\n## 二\n\n另一段正文。\n';
  const result = reviewArticle(markdown, { target_word_count: '10-500' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.category === '写作规范' && /文章标题/.test(item.message)));
  assert.ok(result.issues.some(item => item.category === '写作规范' && /摘要导语/.test(item.message)));
});

test('tilde and long fences are also excluded from structural checks', () => {
  const cases = [
    '~~~md\n# 假标题\n\n> 假导语\n~~~\n\n## 一\n\n正文。\n\n## 二\n\n正文。\n',
    '````md\n# 假标题\n\n> 假导语\n\n```js\nconst value = 1;\n```\n````\n\n## 一\n\n正文。\n\n## 二\n\n正文。\n',
  ];
  for (const markdown of cases) {
    const result = reviewArticle(markdown, { target_word_count: '10-500' });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(item => item.category === '写作规范' && /文章标题/.test(item.message)));
    assert.ok(result.issues.some(item => item.category === '写作规范' && /摘要导语/.test(item.message)));
  }
});

test('unclosed code fences block content review', () => {
  const result = reviewArticle(clean + '\n```md\n未闭合', { target_word_count: '10-500' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.level === 'block' && item.category === 'Markdown'));
});

test('unsupported image targets and Windows-style paths are blocking', () => {
  const cases = [
    '![图](<imgs/a b.png>)',
    '![图](..\\a.png)',
    '![图](\\absolute\\a.png)',
    '![外图](<https://example.com/a.png>)',
    '![图](imgs/a b.png)',
  ];
  for (const marker of cases) {
    const result = reviewArticle(clean + '\n' + marker + '\n', { target_word_count: '10-500' });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(item => item.level === 'block' && item.category === '图片'));
  }
});

test('image structure allows only explicit external-to-placeholder conversion', () => {
  const external = clean + '\n![流程图](https://example.com/a.png)\n';
  const converted = clean + '\n![流程图](placeholder)\n';
  assert.equal(preservesImageStructure(external, converted), true);
  assert.equal(preservesImageStructure(external, clean), false);
  assert.equal(preservesImageStructure(clean, clean + '\n![新增图位](placeholder-extra)\n'), false);
});

test('overlong titles are blocking in content review', () => {
  const result = reviewArticle(clean, { target_word_count: '10-500', title_max_length: 4 }, { title: '超过四个字的标题' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.level === 'block' && item.category === '标题规范'));
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

test('title metadata is checked against ordinary forbidden words too', () => {
  const result = reviewArticle(clean, {
    target_word_count: '10-500',
    forbidden_words: ['绝对第一'],
  }, { title: '绝对第一的方法' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(item => item.category === '标题规范' && item.level === 'block'));
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

test('cover placeholder is ignored when a cover is supplied', () => {
  const text = clean + '\n![封面：规整的配置台](placeholder)\n';
  const pending = reviewArticle(text, { target_word_count: '10-500' });
  assert.equal(pending.issues.filter(item => item.category === '配图').length, 1);

  const resolved = reviewArticle(text, { target_word_count: '10-500' }, { cover: 'cover-123.jpg' });
  assert.equal(resolved.issues.some(item => item.category === '配图'), false);
});

test('body placeholder keeps a warning with the exact marker', () => {
  const text = clean + '\n![封面：规整的配置台](placeholder)\n![信息图：四步流程](placeholder "图：四步完成")\n';
  const result = reviewArticle(text, { target_word_count: '10-500' }, { cover: 'cover-123.jpg' });
  const warning = result.issues.find(item => item.category === '配图');
  assert.equal(warning.level, 'warning');
  assert.match(warning.message, /1 个配图占位符/);
  assert.equal(warning.excerpt, '![信息图：四步流程](placeholder "图：四步完成")');
});

test('body image alt containing 封面 is still a body placeholder', () => {
  const text = clean + '\n![信息图：封面区域布局](placeholder)\n';
  const result = reviewArticle(text, { target_word_count: '10-500' }, { cover: 'cover-123.jpg' });
  assert.equal(result.issues.filter(item => item.category === '配图').length, 1);
});

test('placeholders inside code fences or inline code are ignored', () => {
  const text = clean + '\n```md\n![信息图：示例](placeholder)\n```\n\n行内示例 `![信息图：示例](placeholder)` 与 ``![信息图：双反引号](placeholder)`` 不是图片。\n';
  const result = reviewArticle(text, { target_word_count: '10-500' });
  assert.equal(result.issues.some(item => item.category === '配图'), false);
});

test('external images inside code blocks do not block publication', () => {
  const text = clean + '\n```md\n![示例](https://example.com/a.png)\n```\n';
  const result = reviewArticle(text, { target_word_count: '10-500' });
  assert.equal(result.issues.some(item => item.category === '图片' && item.level === 'block'), false);
});
