import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingForPlan, projectImagePreviews } from '../src/lib/image-previews.mjs';

test('generated mapping follows slot identity instead of array position', () => {
  const saved = JSON.stringify({
    items: [
      { index: 0, slotIndex: 3, alt: '信息图：甲' },
      { index: 1, slotIndex: 7, alt: '氛围：乙' },
    ],
    generated: { 0: 'imgs/body-01-a.jpg', 1: 'imgs/body-02-b.jpg' },
  });
  const reordered = {
    items: [
      { index: 0, slotIndex: 7, alt: '氛围：乙' },
      { index: 1, slotIndex: 3, alt: '信息图：甲' },
    ],
  };
  assert.deepEqual(mappingForPlan(reordered, saved), {
    0: 'imgs/body-02-b.jpg',
    1: 'imgs/body-01-a.jpg',
  });
  const changed = {
    items: [
      { index: 0, slotIndex: 7, alt: '氛围：乙' },
      { index: 1, slotIndex: 3, alt: '信息图：改写后的甲' },
    ],
  };
  assert.deepEqual(mappingForPlan(changed, saved), { 0: 'imgs/body-02-b.jpg' });
});

test('generated mapping is ignored when the saved plan is invalid', () => {
  assert.deepEqual(mappingForPlan({ items: [{ index: 0, slotIndex: 1, alt: '甲' }] }, 'not json'), {});
  assert.deepEqual(mappingForPlan(null, JSON.stringify({ generated: { 0: 'imgs/body-01-a.jpg' } })), {
    0: 'imgs/body-01-a.jpg',
  });
});

test('project previews include the saved cover and mapped body images', () => {
  const previews = projectImagePreviews({
    directory: 'drafts/demo',
    article: { cover_image: 'cover-a.jpg' },
    files: {
      imagePlan: JSON.stringify({
        items: [{ index: 0 }, { index: 1 }, { index: 2 }],
        generated: { 0: 'imgs/body-01-a.jpg', 2: 'imgs/body-03-a.jpg' },
      }),
    },
    entries: [
      { path: 'drafts/demo/cover-a.jpg' },
      { path: 'drafts/demo/imgs/body-01-a.jpg' },
      { path: 'drafts/demo/imgs/body-03-a.jpg' },
    ],
  });
  assert.deepEqual(previews, [
    { path: 'drafts/demo/cover-a.jpg', title: '封面', kind: 'cover' },
    { path: 'drafts/demo/imgs/body-01-a.jpg', title: '配图 1', kind: 'body' },
    { path: 'drafts/demo/imgs/body-03-a.jpg', title: '配图 3', kind: 'body' },
  ]);
});

test('project previews skip missing files and invalid plans', () => {
  assert.deepEqual(projectImagePreviews({ directory: 'drafts/demo', files: { imagePlan: 'not json' } }), []);
  assert.deepEqual(projectImagePreviews({
    directory: 'drafts/demo',
    article: { cover_image: 'cover-a.jpg' },
    files: { imagePlan: JSON.stringify({ items: [{ index: 0 }], generated: { 0: 'imgs/body-01-a.jpg' } }) },
    entries: [],
  }), []);
});
