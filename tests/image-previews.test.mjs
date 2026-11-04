import test from 'node:test';
import assert from 'node:assert/strict';
import { projectImagePreviews } from '../src/lib/image-previews.mjs';

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
