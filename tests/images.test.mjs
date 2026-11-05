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
import { centerCropRect } from '../src/lib/crop.mjs';

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
  const plan = planImages(article, { cover_aspect: '2.35:1', image_density: '每节一图' }, {});
  assert.equal(plan.cover.style, '截图标注');
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].style, '流程步骤');
  assert.equal(plan.items[0].role, '信息位');
  assert.equal(plan.items[0].src, 'placeholder');
  assert.equal(plan.items[1].role, '节奏位');
  assert.equal(plan.prompts.length, 3);
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
  assert.deepEqual(targetImageSize('2.35:1'), { width: 900, height: 383 });
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
