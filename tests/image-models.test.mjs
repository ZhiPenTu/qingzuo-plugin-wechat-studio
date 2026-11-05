import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupImageRequests,
  imageModelLabel,
  imageModelSource,
  imageParametersForModel,
  mergeImageModels,
} from '../src/lib/image-models.mjs';

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

test('image parameters use supported ratios before pixel sizes', () => {
  const gemini = {
    id: 'gemini',
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    sizes: ['1K', '2K', '4K'],
  };
  assert.deepEqual(imageParametersForModel(gemini, '3:4'), { ratio: '3:4' });
  assert.deepEqual(imageParametersForModel(gemini, '2.35:1'), { ratio: '16:9' });

  const openai = {
    id: 'gpt-image',
    sizes: ['auto', '1024x1024', '1536x1024', '1024x1536', '1536x864'],
  };
  assert.deepEqual(imageParametersForModel(openai, '3:4'), { size: '1024x1536' });
  assert.deepEqual(imageParametersForModel(openai, '16:9'), { size: '1536x864' });
  assert.deepEqual(imageParametersForModel({ id: 'unknown' }, '3:4'), {});
});

test('image requests split only when effective model parameters differ', () => {
  const gemini = {
    id: 'gemini',
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  };
  const requests = [
    { aspect: '3:4', prompt: 'cover', globalIndex: 0 },
    { aspect: '3:4', prompt: 'body-a', globalIndex: 1 },
    { aspect: '4:3', prompt: 'body-b', globalIndex: 2 },
  ];
  const groups = groupImageRequests(requests, gemini);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].parameters, { ratio: '3:4' });
  assert.deepEqual(groups[0].items.map(item => item.prompt), ['cover', 'body-a']);
  assert.deepEqual(groups[1].parameters, { ratio: '4:3' });
  assert.deepEqual(groups[1].items.map(item => item.prompt), ['body-b']);

  const unsupportedGroups = groupImageRequests(requests, { id: 'unknown' });
  assert.equal(unsupportedGroups.length, 1);
  assert.deepEqual(unsupportedGroups[0].parameters, {});
  assert.equal(unsupportedGroups[0].items.length, 3);
});
