import test from 'node:test';
import assert from 'node:assert/strict';
import { imageModelLabel, imageModelSource, mergeImageModels } from '../src/lib/image-models.mjs';

test('image models merge official and proxy sources without duplicates', () => {
  const models = mergeImageModels(
    [{ id: 'official-image', title: 'Official', source: 'official' }],
    [
      { id: 'official-image', title: 'Duplicate', source: 'proxy' },
      { id: 'antigravity/gemini-3.1-flash-image', title: 'Gemini 3.1 Flash Image', source: 'proxy' },
    ],
  );
  assert.deepEqual(models.map(model => model.id), ['official-image', 'antigravity/gemini-3.1-flash-image']);
  assert.equal(models[0].title, 'Official');
  assert.equal(imageModelSource(models, 'official-image'), 'official');
  assert.equal(imageModelSource(models, 'antigravity/gemini-3.1-flash-image'), 'proxy');
  assert.equal(imageModelSource(models, 'unknown'), 'official');
});

test('proxy models are labelled separately from official models', () => {
  assert.equal(imageModelLabel({ id: 'antigravity/gemini-3.1-flash-image', title: 'Gemini 3.1 Flash Image', source: 'proxy' }), 'Gemini 3.1 Flash Image（兼容服务）');
  assert.equal(imageModelLabel({ id: 'gemini-3-pro-image', title: 'Nano Banana Pro', source: 'official' }), 'Nano Banana Pro');
  assert.equal(imageModelLabel({ id: 'legacy-model' }), 'legacy-model');
});
