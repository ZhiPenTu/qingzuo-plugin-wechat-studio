import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_STYLES,
  COVER_STYLES,
  IMAGE_MEDIA,
  chooseCoverStyle,
  chooseMedium,
  mapGeneratedFiles,
  planImages,
  rewriteCoverImageMarker,
  rewriteImageMarkers,
  rewriteImageMarkersWithMapping,
  targetImageSize,
} from '../src/lib/images.mjs';
import { centerCropRect, containRect } from '../src/lib/crop.mjs';
import { buildWritingPrompt } from '../src/lib/prompts.mjs';

test('image catalogs expose twelve covers, eight bodies and eight media', () => {
  assert.equal(COVER_STYLES.length, 12);
  assert.equal(BODY_STYLES.length, 8);
  assert.equal(IMAGE_MEDIA.length, 8);
  assert.equal(new Set(COVER_STYLES).size, 12);
});

test('cover style follows content signals', () => {
  assert.equal(chooseCoverStyle('2026 年效率提升 300%'), '数字冲击');
  assert.equal(chooseCoverStyle('两套方案前后对比'), '对比式');
  assert.equal(chooseCoverStyle('公众号配置教程'), '截图标注');
  assert.equal(chooseCoverStyle('为什么你的周报没人看'), '纯色大字');
});

test('medium follows content before preferred tone', () => {
  assert.equal(chooseMedium({}, {}, '运行 npm 命令时出现报错'), '终端等宽');
  assert.equal(chooseMedium({}, {}, '逐条评测和拆解'), '打印稿批注');
  assert.equal(chooseMedium({}, {}, '这是一篇个人随笔'), '牛皮纸圆珠笔');
});

const article = `# 配置一次，规矩自动加载

![封面：规整的配置台](placeholder)

## 先看清问题

![信息图：四步操作流程](placeholder "图：四步完成")

## 再看结果

![氛围：桌面上收好的卡片](placeholder)
`;

test('image plan separates cover and body slots with real content prompts', () => {
  const plan = planImages(article, {
    cover_aspect: '3:4',
    article_image_aspect: '3:4',
    image_density: '每节一图',
  }, {});
  assert.equal(plan.cover.style, '截图标注');
  assert.equal(plan.cover.aspect, '3:4');
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].style, '流程步骤');
  assert.equal(plan.items[0].aspect, '3:4');
  assert.equal(plan.items[0].role, '信息位');
  assert.equal(plan.items[0].src, 'placeholder');
  assert.equal(plan.items[1].role, '节奏位');
  assert.equal(plan.prompts.length, 3);
  assert.match(plan.cover.prompt, /竖版 3:4/);
  assert.match(plan.cover.prompt, /6% 安全边距/);
  assert.match(plan.items[0].prompt, /竖版 3:4/);
  assert.match(plan.items[0].prompt, /不得贴边或被裁切/);
});

test('image prompts are distilled from the article thesis, sections and nearby facts', () => {
  const contextualArticle = `# 电商直播间开始，品牌为什么还在亏

> 直播间真正决定利润的不是开场热闹，而是开播前一小时的清单、首播优惠承接和复盘口径。

## 开播前：先把三张清单钉在桌上

运营要在开播前 60 分钟确认商品排序、库存和优惠叠加规则，任何一项遗漏都会让流量进来后无法成交。

![封面：直播间控制台上的开播清单](placeholder)

![信息图：开播前 60 分钟的三张检查清单](placeholder)

## 首播承接：优惠要跟着流量节奏走

首场直播用 3 个阶梯优惠承接流量，而不是一次性放出最低价；每 20 分钟根据在线人数调整一次。

![数据图表：在线人数与优惠力度的三段变化](placeholder)
`;
  const plan = planImages(contextualArticle, {
    cover_aspect: '3:4',
    article_image_aspect: '3:4',
  }, {});
  assert.match(plan.brief.thesis, /利润/);
  assert.match(plan.cover.prompt, /核心主旨：.*利润/);
  assert.match(plan.cover.prompt, /开播前：先把三张清单钉在桌上/);
  assert.match(plan.cover.prompt, /60 分钟/);
  assert.equal(plan.items[0].context.section, '开播前：先把三张清单钉在桌上');
  assert.match(plan.items[0].prompt, /原文依据：.*60 分钟/);
  assert.match(plan.items[0].prompt, /商品排序、库存和优惠叠加规则/);
  assert.doesNotMatch(plan.items[0].prompt, /placeholder/);
  assert.match(plan.items[1].prompt, /3 个阶梯优惠/);
  assert.match(plan.items[1].prompt, /20 分钟/);
  assert.doesNotMatch(plan.items[1].prompt, /；；/);
});

test('writing prompt requires article-grounded image markers', () => {
  const prompt = buildWritingPrompt({ image_density: '每节一图' }, {}, {}).system;
  assert.match(prompt, /每个图位说明必须从本节正文提炼/);
  assert.match(prompt, /封面标记必须同时扣住标题和导语主旨/);
  assert.match(prompt, /不得为了配图虚构正文中没有的事实/);
});

test('table facts are distilled into readable labels instead of markdown pipes', () => {
  const source = `# 数据文章

> 导语说明文章只讨论成本结构。

## 成本结构

| 项目 | 数值 |
|---|---|
| 成本 | 30% |

![数据图表：成本变化](placeholder)
`;
  const plan = planImages(source, {}, {});
  assert.match(plan.brief.facts.join(' '), /项目：成本，数值：30%/);
  assert.match(plan.items[0].prompt, /原文依据：项目：成本，数值：30%/);
  assert.doesNotMatch(plan.items[0].prompt, /\|\s*-{3,}/);
});

test('data charts do not demand numeric facts from a section without numbers', () => {
  const source = `# 投放复盘

> 这篇文章只讨论成本和投放之间的关系。

## 关键判断

履约成本才是关键，投放并不是主因，团队需要先看清成本结构。

![数据图表：成本与投放的关系](placeholder)
`;
  const plan = planImages(source, {}, {});
  assert.equal(plan.items[0].context.numericFacts.length, 0);
  assert.match(plan.items[0].prompt, /原文没有明确数字时只画关系或数量级/);
  assert.doesNotMatch(plan.items[0].prompt, /数字逐字使用/);
});

test('indented code and inline image alt do not leak into article facts', () => {
  const source = `# 客户增长

> 正文讨论 42 个客户 ![封面：库存清单](cover.png) 的续费变化。

## 数据

    伪造代码里的 999% 不应进入提示词。

真实数据只有 42 个客户。

![数据图表：客户续费变化](placeholder)
`;
  const plan = planImages(source, {}, {});
  const prompt = plan.items[0].prompt;
  assert.match(prompt, /42 个客户/);
  assert.doesNotMatch(prompt, /999%/);
  assert.doesNotMatch(prompt, /封面：库存清单/);
});

test('oversized numeric facts are dropped rather than truncated into a fake number', () => {
  const prefix = '这是一段没有标点的背景说明'.repeat(14);
  const source = `# 数据边界

> 导语说明文章关注长期变化。

## 增长

${prefix}最终达到 1234 万元。

![数据图表：增长变化](placeholder)
`;
  const plan = planImages(source, {}, {});
  assert.equal(plan.items[0].context.numericFacts.length, 0);
  assert.doesNotMatch(plan.items[0].prompt, /数字逐字使用/);
  assert.doesNotMatch(plan.items[0].prompt, /1234[\s\S]*…/);
});

test('numeric facts keep the unit attached when the excerpt is clipped', () => {
  const prefix = '这是一段没有标点的背景说明'.repeat(8);
  const source = `# 数据边界

> 导语说明文章关注长期变化。

## 增长

${prefix} 1234 万元增长数据需要保留。

![数据图表：增长变化](placeholder)
`;
  const plan = planImages(source, {}, {});
  assert.match(plan.items[0].context.numericFacts.join(' '), /1234 万元/);
  assert.match(plan.items[0].prompt, /数字逐字使用：.*1234 万元/);
});

test('indented list continuations after a blank stay in the section context', () => {
  const source = `# 客户清单

> 导语说明文章讨论客户续费。

## 清单

- **第一项**：已有 100 个客户续费。

    第二项补充说明，含 200 个客户。

![信息图：客户续费清单](placeholder)
`;
  const plan = planImages(source, {}, {});
  assert.match(plan.items[0].context.evidence, /200 个客户/);
  assert.match(plan.items[0].prompt, /200 个客户/);
});

test('cover and body aspect ratios can be configured independently', () => {
  const plan = planImages(article, {
    cover_aspect: '4:3',
    article_image_aspect: '3:4',
  }, {});
  assert.equal(plan.cover.aspect, '4:3');
  assert.equal(plan.items.every(item => item.aspect === '3:4'), true);
  assert.match(plan.cover.prompt, /横版 4:3/);
  assert.match(plan.items[0].prompt, /竖版 3:4/);
});

test('image plan honors configured cover and body style candidates', () => {
  const plan = planImages(article, {
    custom_cover_image_style: ['对比式'],
    custom_article_image_style: ['清单要点'],
  }, {});
  assert.equal(plan.cover.style, '对比式');
  assert.equal(plan.items.every(item => item.style === '清单要点'), true);
});

test('image plan honors per-article cover and medium selections', () => {
  const plan = planImages(article, {
    custom_cover_image_style: ['对比式'],
    image_medium: '扁平矢量',
  }, {
    cover_image_style: '菜品特写',
    image_medium: '打印稿批注',
  });
  assert.equal(plan.cover.style, '菜品特写');
  assert.equal(plan.medium, '打印稿批注');
});

test('invalid per-article cover style falls back to configured candidates', () => {
  const plan = planImages(article, { custom_cover_image_style: ['对比式'] }, { cover_image_style: '不存在的形态' });
  assert.equal(plan.cover.style, '对比式');
});

test('user image mode never creates image-generation prompts', () => {
  const plan = planImages(article, { image_source: 'user' }, {});
  assert.equal(plan.cover.generate, false);
  assert.equal(plan.items.every(item => !item.generate), true);
  assert.equal(plan.prompts.length, 0);
});

test('rewriting markers uses stable local image paths', () => {
  const plan = planImages(article, {}, {});
  const rewritten = rewriteImageMarkers(article, plan);
  assert.match(rewritten, /\(imgs\/body-01\.png "图：四步完成"\)/);
  assert.match(rewritten, /\(imgs\/body-02\.png\)/);
});

test('cover marker follows the selected cover image and keeps its caption', () => {
  const plan = planImages(article, {}, {});
  const replaced = rewriteCoverImageMarker(article, 'cover-new.jpg');
  assert.match(replaced, /!\[封面：规整的配置台\]\(cover-new\.jpg\)/);
  assert.doesNotMatch(replaced, /封面[^\n]*placeholder/);
  assert.match(replaced, /\[信息图：四步操作流程\]\(placeholder/, 'body markers stay untouched');

  const caption = rewriteCoverImageMarker('![封面：配置台](placeholder "封面图注")', 'cover.jpg');
  assert.equal(caption, '![封面：配置台](cover.jpg "封面图注")');

  const inserted = rewriteCoverImageMarker('# 标题\n\n正文', 'cover.jpg', { insert: true, plan });
  assert.match(inserted, /^!\[封面：规矩自动加载\]\(cover\.jpg\)\n\n# 标题/);
});

test('mapping rewrite updates body images and the current cover together', () => {
  const plan = planImages(article, {}, {});
  const rewritten = rewriteImageMarkersWithMapping(article, plan, {
    0: 'imgs/body-01.jpg',
    1: 'imgs/body-02.jpg',
  }, { cover: 'cover-new.jpg' });
  assert.match(rewritten, /!\[封面：规整的配置台\]\(cover-new\.jpg\)/);
  assert.match(rewritten, /\(imgs\/body-01\.jpg "图：四步完成"\)/);
  assert.match(rewritten, /\(imgs\/body-02\.jpg\)/);
  assert.doesNotMatch(rewritten, /\(placeholder/);
});

test('cover rewrite keeps a single cover and leaves fenced examples alone', () => {
  const source = '# 标题\n\n![封面：旧](cover-old.jpg)\n\n```md\n![封面：示例](placeholder)\n```\n\n![封面：重复](cover-old-2.jpg)';
  const rewritten = rewriteCoverImageMarker(source, 'cover-new.jpg');
  assert.match(rewritten, /!\[封面：旧\]\(cover-new\.jpg\)/);
  assert.match(rewritten, /```md\n!\[封面：示例\]\(placeholder\)\n```/);
  assert.doesNotMatch(rewritten, /cover-old-2/);
  assert.equal((rewritten.match(/!\[封面/g) || []).length, 2);
});

test('cover rewrite moves a misplaced cover to the top and handles CRLF', () => {
  const source = '# 标题\n\n正文\n\n![封面：旧](placeholder)\n\n图注：封面说明\n\n![信息图：流程](placeholder)';
  const moved = rewriteCoverImageMarker(source, 'cover-new.jpg');
  assert.match(moved, /^!\[封面：旧\]\(cover-new\.jpg\)\n\n图注：封面说明\n\n# 标题/);
  assert.doesNotMatch(moved, /!\[封面[^\n]*placeholder/);

  const crlf = '![封面：旧](placeholder)\r\n\r\n![信息图：流程](placeholder)\r\n';
  const plan = planImages(crlf, {}, {});
  const rewritten = rewriteImageMarkersWithMapping(crlf, plan, { 0: 'imgs/body-01.jpg' }, { cover: 'cover-new.jpg' });
  assert.match(rewritten, /!\[封面：旧\]\(cover-new\.jpg\)/);
  assert.match(rewritten, /\[信息图：流程\]\(imgs\/body-01\.jpg\)/);
  assert.doesNotMatch(rewritten, /\r/);
});

test('missing cover can downgrade stale cover paths to placeholders', () => {
  assert.equal(rewriteCoverImageMarker('![封面：旧](cover-missing.jpg)', ''), '![封面：旧](cover-missing.jpg)');
  assert.equal(
    rewriteCoverImageMarker('![封面：旧](cover-missing.jpg)', '', { invalid: 'placeholder' }),
    '![封面：旧](placeholder)',
  );
  assert.equal(
    rewriteCoverImageMarker('# 标题', '', { insert: true, invalid: 'placeholder' }),
    '# 标题',
  );
});

test('fence tracking respects longer fences', () => {
  const source = '![封面：旧](cover-old.jpg)\n\n````md\n```\n![封面：代码示例](placeholder)\n```\n````\n\n![封面：重复](cover-old-2.jpg)';
  const rewritten = rewriteCoverImageMarker(source, 'cover-new.jpg');
  assert.match(rewritten, /````md\n```\n!\[封面：代码示例\]\(placeholder\)\n```\n````/);
  assert.doesNotMatch(rewritten, /cover-old-2/);
});

test('image plans skip fenced examples before real slots', () => {
  const source = '# 标题\n\n~~~md\n![信息图：示例](placeholder)\n~~~\n\n![信息图：真实](placeholder)';
  const plan = planImages(source, {}, {});
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].alt, '信息图：真实');
  const rewritten = rewriteImageMarkersWithMapping(source, plan, { 0: 'imgs/body-01.jpg' }, { insertCover: false });
  assert.match(rewritten, /~~~md\n!\[信息图：示例\]\(placeholder\)\n~~~/);
  assert.match(rewritten, /!\[信息图：真实\]\(imgs\/body-01\.jpg\)/);
});

test('generated outputs map in batch index order and crop centers', () => {
  const plan = { prompts: ['a', 'b', 'c', 'd'] };
  const entries = [
    { kind: 'file', path: 'imgs/生成图-2-ai-abcdef12-2.png' },
    { kind: 'file', path: 'imgs/生成图-1-ai-abcdef12-1.png' },
    { kind: 'file', path: 'imgs/生成图-3-ai-abcdef12-3.png' },
    { kind: 'file', path: 'imgs/生成图-4-ai-abcdef12-4.gif' },
  ];
  assert.deepEqual(mapGeneratedFiles(plan, entries).map(item => item.path), [
    'imgs/生成图-1-ai-abcdef12-1.png',
    'imgs/生成图-2-ai-abcdef12-2.png',
    'imgs/生成图-3-ai-abcdef12-3.png',
    'imgs/生成图-4-ai-abcdef12-4.gif',
  ]);
  assert.deepEqual(centerCropRect(1000, 1000, 900, 383), { x: 0, y: 287, width: 1000, height: 426 });
  assert.deepEqual(containRect(1000, 1000, 900, 1200), { x: 0, y: 150, width: 900, height: 900 });
  assert.deepEqual(targetImageSize('3:4'), { width: 900, height: 1200 });
  assert.deepEqual(targetImageSize('unsupported'), { width: 900, height: 1200 });
});

test('partial generation keeps stable batch indexes instead of shifting later images', () => {
  const plan = { prompts: ['cover', 'body-1', 'body-2'] };
  const entries = [
    { kind: 'file', path: 'drafts/demo/imgs/生成图-3-ai-abcdef12-3.png', name: '生成图-3-ai-abcdef12-3.png' },
    { kind: 'file', path: 'drafts/demo/imgs/生成图-1-ai-abcdef12-1.png', name: '生成图-1-ai-abcdef12-1.png' },
  ];
  const mapped = mapGeneratedFiles(plan, entries);
  assert.deepEqual(mapped.map(item => item.batchIndex), [1, 3]);
});
