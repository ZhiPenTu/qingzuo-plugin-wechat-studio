import test from 'node:test';
import assert from 'node:assert/strict';
import {
  articlePublicationFingerprint,
  articleDraftMatches,
  buildPublicationGate,
  hasSavedCover,
  publicationReceiptConflictsWithNews,
  publicationReceiptDelivery,
  reviewIssueStage,
} from '../src/lib/publication.mjs';

const bodyImage = 'imgs/body-01.jpg';

function fixture({ markdown = '# 标题\n\n正文段落。', html = '', articles = {} } = {}) {
  const content = html || '<p>' + '正文'.repeat(80) + '</p><img src="' + bodyImage + '">';
  return {
    directory: 'drafts/article',
    article: { title: '标题', author: '作者', digest: '摘要', cover_image: 'cover.jpg', ...articles },
    files: { format: markdown, html: content },
    entries: [
      { path: 'drafts/article/cover.jpg', kind: 'file' },
      { path: 'drafts/article/' + bodyImage, kind: 'file' },
    ],
  };
}

function gateItem(project, label) {
  return buildPublicationGate(project, { counts: { block: 0 }, issues: [] }).items.find(item => item.label === label);
}

test('saved cover resolves the cover placeholder without hiding body placeholders', () => {
  const project = fixture({ markdown: '# 标题\n\n![封面：配置台](placeholder)\n\n![信息图：四步流程](placeholder)' });
  assert.equal(hasSavedCover(project), true);
  const placeholder = gateItem(project, '占位符');
  assert.equal(placeholder.ok, false);
  assert.match(placeholder.detail, /四步流程/);
  assert.equal(placeholder.stage, 'images');
});

test('missing cover file keeps the cover placeholder in the gate', () => {
  const project = fixture({ markdown: '# 标题\n\n![封面：配置台](placeholder)' });
  project.entries = project.entries.filter(entry => !entry.path.endsWith('cover.jpg'));
  assert.equal(hasSavedCover(project), false);
  assert.equal(gateItem(project, '封面').ok, false);
  assert.equal(gateItem(project, '占位符').ok, false);
});

test('body image alt containing 封面 is not ignored as a cover slot', () => {
  const project = fixture({ markdown: '# 标题\n\n![信息图：封面区域布局](placeholder)' });
  const placeholder = gateItem(project, '占位符');
  assert.equal(placeholder.ok, false);
  assert.match(placeholder.detail, /封面区域布局/);
});

test('placeholders inside fenced or inline code do not block publication', () => {
  const markdown = '# 标题\n\n```md\n![信息图：示例](placeholder)\n```\n\n行内示例 `![信息图：示例](placeholder)` 不是图片。';
  const project = fixture({ markdown });
  assert.equal(gateItem(project, '占位符').ok, true);
});

test('stale HTML placeholders route to the format stage', () => {
  const project = fixture({ html: '<p>' + '正文'.repeat(80) + '</p><img src="placeholder">' });
  const placeholder = gateItem(project, '占位符');
  assert.equal(placeholder.ok, false);
  assert.equal(placeholder.stage, 'format');
});

test('review issue stages point at an editable surface', () => {
  assert.equal(reviewIssueStage('标题规范'), 'meta-title');
  assert.equal(reviewIssueStage('配图'), 'images');
  assert.equal(reviewIssueStage('HTML'), 'format');
  assert.equal(reviewIssueStage('原创标注'), 'config');
});

test('publication receipts keep image and news drafts separate', () => {
  assert.equal(publicationReceiptDelivery({ delivery: 'image' }), 'image');
  assert.equal(publicationReceiptDelivery({ source: 'sticker' }), 'image');
  assert.equal(publicationReceiptDelivery({ delivery: 'news' }), 'news');
  assert.equal(publicationReceiptDelivery({}), 'news');
  const common = {
    fingerprintReady: true,
    mediaId: 'media-1',
    accountId: 'account-1',
    receiptMediaId: 'media-1',
    receiptAccountId: 'account-1',
    receiptFingerprint: 'fingerprint-1',
    fingerprint: 'fingerprint-1',
  };
  assert.equal(articleDraftMatches({ ...common, delivery: 'news' }), true);
  assert.equal(articleDraftMatches({ ...common, delivery: 'image' }), false);
  assert.equal(articleDraftMatches({ ...common, delivery: 'news', stale: true }), false);
  assert.equal(publicationReceiptConflictsWithNews({}), false);
  assert.equal(publicationReceiptConflictsWithNews({ state: 'draft' }), false);
  assert.equal(publicationReceiptConflictsWithNews({ delivery: 'image', state: 'unknown' }), true);
  assert.equal(publicationReceiptConflictsWithNews({ source: 'sticker', state: 'unknown' }), true);
});

test('article fingerprint covers publish settings used by draft creation', async () => {
  const project = fixture();
  const first = await articlePublicationFingerprint(project, {
    needOpenComment: 1,
    onlyFansCanComment: 0,
  });
  const changedComments = await articlePublicationFingerprint(project, {
    needOpenComment: 0,
    onlyFansCanComment: 0,
  });
  const ignoredMethod = await articlePublicationFingerprint(project, {
    needOpenComment: 1,
    onlyFansCanComment: 0,
    publishMethod: 'published',
  });
  assert.notEqual(first, changedComments);
  assert.equal(first, ignoredMethod);
});
