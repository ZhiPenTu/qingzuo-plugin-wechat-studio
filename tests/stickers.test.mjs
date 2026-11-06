import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigForSave } from '../src/lib/config.mjs';
import { buildStickerPrompt } from '../src/lib/prompts.mjs';
import {
  normalizeStickerLanguage,
  normalizeStickerPlan,
  parseStickerSession,
  parseStickerPlanContent,
  mergeStickerFiles,
  stickerBatchBindings,
  stickerBatchHasUnknown,
  stickerBatchMatches,
  stickerBatchRetryable,
  stickerCaptionPrefix,
  stickerCoverPath,
  stickerDocumentMarkdown,
  stickerGenerationPrompt,
  stickerImageItems,
  stickerItemDuplicateIssues,
  stickerMessageTitle,
  stickerOutlineMarkdown,
  stickerPlanBriefIssues,
  stickerPlanIssues,
  stickerPublicationFingerprintPayload,
  stickerDraftMatches,
  stickerPublishBlocked,
  stickerProjectMarkdown,
  stickerResetReceipt,
  stickerSessionSnapshot,
  withStickerLanguage,
} from '../src/lib/stickers.mjs';

const items = [
  { id: 's-1', prompt: '第一张', caption: '第一张配文' },
  { id: 's-2', prompt: '第二张', caption: '第二张配文' },
  { id: 's-3', prompt: '第三张', caption: '第三张配文' },
];

test('sticker language is normalized and enforced in prompts', () => {
  assert.equal(normalizeStickerLanguage('English'), 'English');
  assert.equal(normalizeStickerLanguage('unsupported'), '简体中文');
  assert.match(withStickerLanguage('a clean editorial illustration', '简体中文'), /统一主题语言/);
  assert.match(withStickerLanguage('a clean editorial illustration', '简体中文'), /简体中文/);
  assert.match(withStickerLanguage('a clean editorial illustration', 'English'), /English consistently/);
  assert.match(withStickerLanguage('a clean editorial illustration', '无文字'), /不要出现任何文字/);
});

test('sticker prompt carries the unified theme language', () => {
  const prompt = buildStickerPrompt({ sticker_language: '繁體中文', multi_image_count: 3 }, {
    topic: '算力券',
    count: 3,
  });
  assert.match(prompt.system, /整组统一主题语言：繁體中文/);
  assert.match(prompt.user, /统一主题语言：繁體中文/);
  assert.doesNotMatch(prompt.system, /简体中文。画面内/);
});

test('sticker plan requires distinct viewpoints and captions', () => {
  const plan = normalizeStickerPlan({
    title: '端侧 AI 的三个变化',
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从算力、模型到场景，拆开端侧 AI 的变化。',
    images: [
      { viewpoint: '算力开始下沉到终端', prompt: '手机主板上的芯片特写', caption: '算力不再只堆在云端。' },
      { viewpoint: '小模型先跑通高频场景', prompt: '手机屏幕里的语音助手', caption: '先落地的是高频小任务。' },
      { viewpoint: '端侧隐私成为卖点', prompt: '文件停留在本地的示意', caption: '数据不出设备，才有说服力。' },
    ],
  }, {
    topic: '端侧 AI',
    count: 3,
    style: '统一手绘',
    medium: '马克笔白板',
    language: '简体中文',
  });
  assert.equal(plan.images.length, 3);
  assert.equal(plan.type, '知识卡片');
  assert.equal(plan.style, '统一手绘');
  assert.equal(plan.medium, '马克笔白板');

  assert.throws(() => normalizeStickerPlan({
    type: '知识卡片',
    narrative: '并列展示',
    summary: '整组讲清变化。',
    images: [
      { viewpoint: '同一个观点', prompt: '画面一', caption: '配文一' },
      { viewpoint: '同一个观点', prompt: '画面二', caption: '配文二' },
    ],
  }, { topic: '测试', count: 2 }), /方案小结重复/);

  assert.throws(() => normalizeStickerPlan({
    type: '知识卡片',
    narrative: '并列展示',
    summary: '整组讲清变化。',
    images: [
      { viewpoint: '观点一', prompt: '画面一', caption: '第 1 张配文：国内端侧AI发展动态' },
      { viewpoint: '观点二', prompt: '画面二', caption: '第 2 张配文：国内端侧AI发展动态' },
    ],
  }, { topic: '国内端侧AI发展动态', count: 2 }), /配文重复/);

  assert.throws(() => normalizeStickerPlan({
    title: '缺方案字段',
    images: [
      { viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
    ],
  }, { topic: '测试', count: 1 }), /贴图类型/);
  assert.throws(() => normalizeStickerPlan({
    title: '非法类型',
    type: '随便画',
    narrative: '并列展示',
    summary: '整组讲清变化。',
    images: [
      { viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
    ],
  }, { topic: '测试', count: 1 }), /贴图类型需从/);
  assert.throws(() => normalizeStickerPlan({
    title: '缺叙事线',
    type: '知识卡片',
    summary: '整组讲清变化。',
    images: [
      { viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
    ],
  }, { topic: '测试', count: 1 }), /叙事线/);
});

test('sticker plan parsing tolerates fences and surrounding prose', () => {
  const value = parseStickerPlanContent('这里是方案：\n```json\n{"title":"Demo","images":[]}\n```\n请查收');
  assert.equal(value.title, 'Demo');
  assert.throws(() => parseStickerPlanContent('not json'), /不是有效 JSON/);
});

test('sticker generation prompt carries the per-image plan brief', () => {
  const prompt = stickerGenerationPrompt({
    topic: '端侧 AI',
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从算力到场景拆解变化。',
    style: '统一手绘',
    medium: '马克笔白板',
    index: 2,
    count: 3,
    language: '简体中文',
    item: {
      viewpoint: '小模型先跑通高频场景',
      prompt: '手机屏幕里的语音助手',
      caption: '先落地的是高频小任务。',
    },
  });
  assert.match(prompt, /本张位置：第 2 \/ 3 张/);
  assert.match(prompt, /本张方案小结（只讲这个观点）：小模型先跑通高频场景/);
  assert.match(prompt, /整组叙事线：知识点递进/);
  assert.match(prompt, /画面提示词：手机屏幕里的语音助手/);
});

test('sticker plan issues flag empty and duplicated card copy', () => {
  const plan = { type: '知识卡片', narrative: '并列展示', summary: '整组讲清三个变化。' };
  assert.deepEqual(stickerPlanBriefIssues(plan), []);
  assert.match(stickerPlanBriefIssues({ type: '知识卡片' }).join('\n'), /叙事线[\s\S]*主旨/);
  assert.deepEqual(stickerPlanIssues([
    { id: 's-1', viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
    { id: 's-2', viewpoint: '观点二', prompt: '画面二', caption: '配文二' },
  ], plan), []);
  assert.match(stickerPlanIssues([
    { id: 's-1', viewpoint: '', prompt: '画面一', caption: '配文一' },
    { id: 's-2', viewpoint: '观点二', prompt: '', caption: '配文一' },
  ], plan).join('\n'), /缺少方案小结[\s\S]*缺少画面提示词[\s\S]*配文重复/);
  assert.match(stickerPlanIssues([
    { id: 's-1', viewpoint: '观点一', prompt: '同一个画面', caption: '配文一' },
    { id: 's-2', viewpoint: '观点二', prompt: '同一个画面', caption: '配文二' },
  ], plan).join('\n'), /画面提示词重复/);
  assert.match(stickerPlanIssues([
    { id: 's-1', viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
  ], { type: '知识卡片', narrative: '', summary: '' }).join('\n'), /叙事线[\s\S]*主旨/);
  assert.match(stickerItemDuplicateIssues(
    { id: 's-2', viewpoint: '观点一', prompt: '画面二', caption: '配文二' },
    1,
    [
      { id: 's-1', viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
      { id: 's-2', viewpoint: '观点一', prompt: '画面二', caption: '配文二' },
    ],
  ).join('\n'), /方案小结重复/);
  assert.match(stickerItemDuplicateIssues(
    { id: 's-2', viewpoint: '观点二', prompt: '画面一', caption: '配文二' },
    1,
    [
      { id: 's-1', viewpoint: '观点一', prompt: '画面一', caption: '配文一' },
      { id: 's-2', viewpoint: '观点二', prompt: '画面一', caption: '配文二' },
    ],
  ).join('\n'), /画面提示词重复/);
});

test('sticker outline follows the repository skill table', () => {
  const outline = stickerOutlineMarkdown({
    title: '端侧 AI',
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从算力到场景拆解变化。',
    style: '统一手绘',
    medium: '马克笔白板',
    items: [
      { viewpoint: '算力下沉', prompt: '芯片特写', caption: '算力不再只堆在云端。' },
      { viewpoint: '小模型先落地', prompt: '语音助手', caption: '先跑通高频任务。' },
    ],
  });
  assert.match(outline, /^## 贴图方案：端侧 AI/);
  assert.match(outline, /\*\*张数\*\*：2 张/);
  assert.match(outline, /\*\*贴图类型\*\*：知识卡片/);
  assert.match(outline, /\*\*叙事线\*\*：知识点递进/);
  assert.match(outline, /\| 序号 \| 画面描述（方案小结） \| 配文 \| Prompt 要点 \|/);
  assert.match(outline, /\| 1 \| 算力下沉 \| 算力不再只堆在云端。 \| 芯片特写 \|/);
});

test('sticker batch bindings reject reorder, prompt and model drift', () => {
  const promptFor = item => withStickerLanguage(item.prompt, '简体中文');
  const bindings = stickerBatchBindings(items, 'model-a', promptFor);
  assert.equal(stickerBatchMatches(bindings, items, 'model-a', promptFor), true);
  assert.equal(stickerBatchMatches(bindings, [items[1], items[0], items[2]], 'model-a', promptFor), false);
  assert.equal(stickerBatchMatches(bindings, [
    items[0],
    { ...items[1], prompt: '修改后的提示词' },
    items[2],
  ], 'model-a', promptFor), false);
  assert.equal(stickerBatchMatches(bindings, items, 'model-b', promptFor), false);
  assert.equal(stickerBatchMatches(bindings, items.slice(0, 2), 'model-a', promptFor), false);
});

test('sticker batch merge keeps old images for failed or missing items', () => {
  const previous = {
    's-1': 'posts/stickers/demo/imgs/old-1.jpg',
    's-2': 'posts/stickers/demo/imgs/old-2.jpg',
    's-3': 'posts/stickers/demo/imgs/old-3.jpg',
    removed: 'posts/stickers/demo/imgs/removed.jpg',
  };
  const merged = mergeStickerFiles(previous, items, {
    's-1': 'posts/stickers/demo/imgs/new-1.jpg',
    's-2': 'posts/stickers/demo/imgs/new-2.jpg',
  });
  assert.deepEqual(merged, {
    's-1': 'posts/stickers/demo/imgs/new-1.jpg',
    's-2': 'posts/stickers/demo/imgs/new-2.jpg',
    's-3': 'posts/stickers/demo/imgs/old-3.jpg',
  });
});

test('sticker batch cleanup keeps failed and unknown workspaces retryable', () => {
  assert.equal(stickerBatchRetryable([{ state: 'succeeded' }, { state: 'failed' }]), true);
  assert.equal(stickerBatchRetryable([{ state: 'save-failed' }]), true);
  assert.equal(stickerBatchRetryable([{ state: 'succeeded' }, { state: 'unknown' }]), false);
  assert.equal(stickerBatchHasUnknown([{ state: 'succeeded' }, { state: 'unknown' }]), true);
  assert.equal(stickerBatchHasUnknown([{ state: 'failed' }]), false);
});

test('sticker document keeps image order, cover semantics and captions', () => {
  const files = {
    's-2': 'posts/stickers/demo/imgs/sticker-s-2.jpg',
    's-1': 'posts/stickers/demo/imgs/sticker-s-1.jpg',
  };
  assert.deepEqual(stickerImageItems(items, files).map(item => item.id), ['s-1', 's-2']);
  assert.equal(stickerCoverPath(items, files), 'posts/stickers/demo/imgs/sticker-s-1.jpg');

  const markdown = stickerDocumentMarkdown({
    title: '算力券怎么用',
    digest: '一张图讲清兑付链路。',
    items,
    filesByItem: files,
  });
  assert.match(markdown, /^# 算力券怎么用/);
  assert.match(markdown, /一张图讲清兑付链路。/);
  assert.match(markdown, /!\[封面：算力券怎么用\]\(posts\/stickers\/demo\/imgs\/sticker-s-1\.jpg\)/);
  assert.match(markdown, /!\[贴图：第 2 张\]\(posts\/stickers\/demo\/imgs\/sticker-s-2\.jpg\)/);
  assert.doesNotMatch(markdown, /sticker-s-3/);
  assert.ok(markdown.indexOf('第一张配文') < markdown.indexOf('第二张配文'));

  const projectMarkdown = stickerProjectMarkdown({
    title: '算力券怎么用',
    digest: '一张图讲清兑付链路。',
    items,
    filesByItem: files,
  });
  assert.match(projectMarkdown, /^# 算力券怎么用/);
  assert.match(projectMarkdown, /> 一张图讲清兑付链路。/);
  assert.match(projectMarkdown, /## 第 1 张/);
  assert.match(projectMarkdown, /## 第 2 张/);
  assert.match(projectMarkdown, /!\[封面：算力券怎么用\]/);
});

test('sticker language survives config normalization', () => {
  const value = normalizeConfigForSave({ sticker_language: 'English' });
  assert.equal(value.sticker_language, 'English');
  assert.equal(normalizeConfigForSave({}).sticker_language, '简体中文');
});

test('sticker fallback captions follow the selected language', () => {
  assert.equal(stickerCaptionPrefix('简体中文', 2), '第 2 张配文：');
  assert.equal(stickerCaptionPrefix('繁體中文', 2), '第 2 張配文：');
  assert.equal(stickerCaptionPrefix('English', 2), 'Image 2 caption: ');
  assert.equal(stickerCaptionPrefix('中英双语', 2), '第 2 张 / Image 2 caption: ');
  assert.equal(stickerCaptionPrefix('unsupported', 2), '第 2 张配文：');
});

test('sticker known failures can be retried and unknown states reset safely', () => {
  assert.equal(stickerPublishBlocked('draft-failed'), false);
  assert.equal(stickerPublishBlocked('failed'), true);
  assert.equal(stickerPublishBlocked('draft-unknown'), true);
  assert.deepEqual(stickerResetReceipt(), {
    state: 'draft-reset',
    mediaId: null,
    publishId: null,
    articleFingerprint: '',
    error: null,
  });
});

test('sticker draft matching requires the image-message delivery marker', () => {
  const current = {
    fingerprintReady: true,
    mediaId: 'draft-1',
    accountId: 'wx-account',
    receiptAccountId: 'wx-account',
    receiptFingerprint: 'fingerprint',
    fingerprint: 'fingerprint',
  };
  assert.equal(stickerDraftMatches({ ...current, delivery: 'image' }), true);
  assert.equal(stickerDraftMatches({ ...current, delivery: '' }), false);
  assert.equal(stickerDraftMatches({ ...current, delivery: 'news' }), false);
  assert.equal(stickerDraftMatches({ ...current, delivery: 'image', fingerprint: 'changed' }), false);
});

test('sticker fingerprint covers publish metadata and full image paths', () => {
  const payload = JSON.parse(stickerPublicationFingerprintPayload({
    title: '算力券',
    digest: '摘要',
    language: 'English',
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从兑付到核销拆解算力券。',
    medium: '马克笔白板',
    style: '统一手绘',
    needOpenComment: 0,
    onlyFansCanComment: 1,
    items: [{ ...items[0], viewpoint: '兑付链路' }, items[1], items[2]],
    filesByItem: { 's-1': 'posts/stickers/a/imgs/one.jpg' },
    outputFiles: [{ path: 'posts/stickers/a/imgs/one.jpg', size: 100, mtime: 9 }],
    directory: 'posts/stickers/a',
  }));
  assert.equal(payload.needOpenComment, false);
  assert.equal(payload.onlyFansCanComment, true);
  assert.equal(payload.type, '知识卡片');
  assert.equal(payload.narrative, '知识点递进');
  assert.equal(payload.summary, '从兑付到核销拆解算力券。');
  assert.equal(payload.medium, '马克笔白板');
  assert.equal(payload.style, '统一手绘');
  assert.equal(payload.items[0].file, 'posts/stickers/a/imgs/one.jpg');
  assert.equal(payload.items[0].prompt, '第一张');
  assert.equal(payload.items[0].relative, 'imgs/one.jpg');
  assert.equal(payload.items[0].mtime, 9);
  assert.equal(payload.items[0].viewpoint, '兑付链路');
});

test('sticker session restores items, files and pending state safely', () => {
  const snapshot = stickerSessionSnapshot({
    topic: '算力券',
    count: 3,
    style: '统一手绘',
    medium: '马克笔白板',
    language: 'English',
    planLanguage: 'English',
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从兑付到核销拆解算力券。',
    title: '算力券怎么用',
    digest: '摘要',
    items: [
      { ...items[0], viewpoint: '兑付链路' },
      { ...items[1], viewpoint: '核销边界' },
      { ...items[2], viewpoint: '适用范围' },
    ],
    directory: 'posts/stickers/demo',
    filesByItem: { 's-1': 'posts/stickers/demo/imgs/s-1.jpg' },
    itemStates: { 's-1': { state: 'unknown', error: 'timeout', taskId: 'task-1' } },
    accountId: 'wx-account',
    receipt: { state: 'draft-unknown', projectDirectory: 'drafts/20261103-demo' },
  });
  const restored = parseStickerSession(JSON.stringify(snapshot));
  assert.equal(restored.topic, '算力券');
  assert.equal(restored.language, 'English');
  assert.equal(restored.planLanguage, 'English');
  assert.equal(restored.items.length, 3);
  assert.equal(restored.type, '知识卡片');
  assert.equal(restored.narrative, '知识点递进');
  assert.equal(restored.summary, '从兑付到核销拆解算力券。');
  assert.equal(restored.items[0].viewpoint, '兑付链路');
  assert.equal(restored.filesByItem['s-1'], 'posts/stickers/demo/imgs/s-1.jpg');
  assert.equal(restored.itemStates['s-1'].state, 'unknown');
  assert.equal(restored.receipt.state, 'draft-unknown');
  assert.equal(parseStickerSession('{bad json'), null);
  assert.equal(parseStickerSession(JSON.stringify({ ...snapshot, directory: 'posts/../../secret' })).directory, '');
});

test('sticker sessions keep image-message titles within the WeChat limit', () => {
  const snapshot = stickerSessionSnapshot({ title: '标'.repeat(40), count: 1 });
  assert.equal([...snapshot.title].length, 32);
  assert.equal([...stickerMessageTitle('标'.repeat(40))].length, 32);
  const plan = normalizeStickerPlan({
    title: '标'.repeat(40),
    type: '知识卡片',
    narrative: '知识点递进',
    summary: '从兑付到核销拆解算力券。',
    images: [
      { viewpoint: '兑付链路', prompt: '第一张', caption: '第一张配文' },
      { viewpoint: '核销边界', prompt: '第二张', caption: '第二张配文' },
    ],
  }, { count: 2 });
  assert.equal([...plan.title].length, 32);
});

test('legacy sticker sessions restore with empty plan fields', () => {
  const restored = parseStickerSession(JSON.stringify({
    schemaVersion: 1,
    topic: '旧方案',
    items: [{ id: 's-1', prompt: '旧提示词', caption: '旧配文' }],
  }));
  assert.equal(restored.items[0].viewpoint, '');
  assert.equal(restored.type, '');
  assert.equal(restored.narrative, '');
  assert.equal(restored.summary, '');
  assert.equal(restored.planLanguage, '');
});
