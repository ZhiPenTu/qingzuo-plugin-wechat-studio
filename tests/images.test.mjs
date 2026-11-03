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
  rewriteImageMarkers,
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

test('generated outputs map in batch index order and crop centers', () => {
  const plan = { prompts: ['a', 'b', 'c'] };
  const entries = [
    { kind: 'file', path: 'imgs/生成图-2-ai-abcdef12-2.png' },
    { kind: 'file', path: 'imgs/生成图-1-ai-abcdef12-1.png' },
    { kind: 'file', path: 'imgs/生成图-3-ai-abcdef12-3.png' },
  ];
  assert.deepEqual(mapGeneratedFiles(plan, entries).map(item => item.path), [
    'imgs/生成图-1-ai-abcdef12-1.png',
    'imgs/生成图-2-ai-abcdef12-2.png',
    'imgs/生成图-3-ai-abcdef12-3.png',
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
