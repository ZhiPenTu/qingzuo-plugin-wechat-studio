import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MCP_IMAGE_ARGS,
  extractMcpImages,
  generateMcpImage,
  generateImagesThroughMcp,
  mcpBatchToken,
  mcpCoverSize,
  pendingMcpGenerationId,
  renderMcpArguments,
} from '../src/lib/mcp-images.mjs';

test('MCP argument templates preserve JSON escaping for prompts', () => {
  const value = renderMcpArguments('{"prompt":"{{prompt}}","size":"{{size}}","n":{{count}}}', {
    prompt: '含 "引号"\n和换行',
    size: '2.35:1',
    count: 2,
  });
  assert.deepEqual(value, { prompt: '含 "引号"\n和换行', size: '2.35:1', n: 2 });
  assert.deepEqual(renderMcpArguments('{"prompt":"{{prompt}}"}', { prompt: '价格 $& 与 $` 保持原样' }), {
    prompt: '价格 $& 与 $` 保持原样',
  });
  assert.deepEqual(renderMcpArguments(DEFAULT_MCP_IMAGE_ARGS, { prompt: '测试' }), { prompt: '测试', size: '' });
  assert.throws(() => renderMcpArguments('[]'), /JSON 对象/);
  assert.throws(() => renderMcpArguments('{oops'), /有效 JSON/);
});

test('MCP image content supports base64, data URLs and nested sources', () => {
  const png = Buffer.from('png-data').toString('base64');
  const jpg = Buffer.from('jpg-data').toString('base64');
  const webp = Buffer.from('webp-data').toString('base64');
  const gif = Buffer.from('gif-data').toString('base64');
  const resourcePng = Buffer.from('resource-png-data').toString('base64');
  const structuredJpg = Buffer.from('structured-jpg-data').toString('base64');
  const images = extractMcpImages({
    content: [
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpg } },
      { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: webp } },
      { type: 'image', data: gif, mimeType: 'image/gif' },
      { type: 'resource', resource: { uri: 'file:///generated.png', mimeType: 'image/png', blob: resourcePng } },
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'text', text: '示例 data:image/png;base64,' + png },
    ],
    structuredContent: { result: { image: { data: structuredJpg, mimeType: 'image/jpeg' } } },
  });
  assert.deepEqual(images.map(image => image.mimeType), ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/png', 'image/jpeg']);
  assert.ok(images.some(image => image.data === resourcePng));
  assert.ok(images.some(image => image.data === structuredJpg));
});

test('MCP pending generation ids are detected without resubmitting', () => {
  const pending = pendingMcpGenerationId({
    content: [{ type: 'text', text: 'still being made. call generation_result with id "img_abc12345" to wait for it' }],
  });
  assert.equal(pending, 'img_abc12345');
  assert.equal(pendingMcpGenerationId({
    content: [{ type: 'text', text: JSON.stringify({ status: 'pending', task_id: 'task_abc12345' }) }],
  }), 'task_abc12345');
  assert.equal(pendingMcpGenerationId({
    content: [],
    structuredContent: { job: { state: 'running', id: 'task_structured1' } },
  }), 'task_structured1');
  assert.equal(pendingMcpGenerationId({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }), null);
  assert.equal(pendingMcpGenerationId({ content: [{ type: 'text', text: 'done' }] }), null);
});

test('MCP image batches keep stable generated filenames and preserve unknown results', async () => {
  const png = Buffer.from('png-data').toString('base64');
  const written = [];
  const callOptions = [];
  let call = 0;
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64(options) { written.push(options); },
    },
    mcp: {
      async call(options) {
        callOptions.push(options);
        call += 1;
        if (call === 3) throw new Error('服务暂时不可用');
        return { content: [{ type: 'image', data: png, mimeType: 'image/png' }] };
      },
      async grant() {},
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}","n":1}',
    prompts: ['封面', '正文一', '正文二'],
    directory: 'drafts/demo/imgs',
    sizeFor: index => index === 0 ? '2.35:1' : '1:1',
  });
  assert.equal(result.files.length, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(result.unknowns.length, 1);
  assert.match(written[0].path, /^drafts\/demo\/imgs\/生成图-1-ai-[a-f0-9]+-\d+\.png$/);
  assert.match(written[1].path, /^drafts\/demo\/imgs\/生成图-2-ai-[a-f0-9]+-\d+\.png$/);
  assert.equal(written[0].mime, 'image/png');
  assert.equal(result.unknowns[0].error, '服务暂时不可用');
  assert.equal(callOptions.every(options => options.inlineImages === true), true);
});

test('MCP image batches stop polling on abort and retain completed images', async () => {
  const png = Buffer.from('png-data').toString('base64');
  const controller = new AbortController();
  const written = [];
  let call = 0;
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64(options) { written.push(options); },
    },
    mcp: {
      async call() {
        call += 1;
        controller.abort();
        return { content: [{ type: 'image', data: png, mimeType: 'image/png' }] };
      },
      async grant() {},
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompts: ['第一张', '第二张'],
    directory: 'drafts/demo/imgs',
    signal: controller.signal,
  });
  assert.equal(call, 1);
  assert.equal(result.files.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.aborted, true);
  assert.equal(written.length, 1);
  assert.match(written[0].path, /生成图-1-ai-/);
});

test('MCP batch tokens remain unique within the same millisecond', () => {
  const first = mcpBatchToken(1700000000000);
  const second = mcpBatchToken(1700000000000);
  assert.match(first, /^1700000000000-[a-f0-9]{16}$/);
  assert.notEqual(first, second);
});

test('MCP cover sizes use provider-compatible common aspect ratios', () => {
  assert.equal(mcpCoverSize('1:1'), '1:1');
  assert.equal(mcpCoverSize('2.35:1'), '16:9');
  assert.equal(mcpCoverSize('1.91:1'), '16:9');
  assert.equal(mcpCoverSize(''), '16:9');
});

test('side-effect drift re-authorizes before retrying an MCP image call', async () => {
  const png = Buffer.from('png-data').toString('base64');
  let calls = 0;
  const grants = [];
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64() {},
    },
    mcp: {
      async call() {
        calls += 1;
        if (calls === 1) throw new Error('MCP 工具权限已变化，请重新授权。');
        return { content: [{ type: 'image', data: png, mimeType: 'image/png' }] };
      },
      async grant(options) { grants.push(options); },
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompts: ['一张图'],
    directory: 'drafts/demo/imgs',
  });
  assert.equal(result.files.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(grants, [{ serverId: 's1', toolNames: ['generate_image'] }]);
});

test('MCP image batches preserve earlier files when a later call cancels authorization', async () => {
  const png = Buffer.from('png-data').toString('base64');
  const written = [];
  let call = 0;
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64(options) { written.push(options); },
    },
    mcp: {
      async call() {
        call += 1;
        if (call === 2) throw new Error('MCP 工具授权已取消。');
        return { content: [{ type: 'image', data: png, mimeType: 'image/png' }] };
      },
      async grant() {},
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompts: ['第一张', '第二张'],
    directory: 'drafts/demo/imgs',
  });
  assert.equal(result.files.length, 1);
  assert.equal(written.length, 1);
  assert.match(result.fatal, /授权已取消/);
  assert.equal(result.aborted, false);
});

test('MCP call timeouts are recorded as unknown instead of retryable failures', async () => {
  const reports = [];
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64() {},
      async writeText(options) { reports.push(options); },
    },
    mcp: {
      async call() { throw new Error('MCP 工具调用超时。'); },
      async grant() {},
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompts: ['第一张'],
    directory: 'drafts/demo/imgs',
    timeoutMs: 0,
  });
  assert.equal(result.failures.length, 0);
  assert.equal(result.unknowns.length, 1);
  assert.match(result.unknowns[0].error, /超时/);
  assert.match(reports[0].text, /"unknowns"/);
});

test('MCP pending task ids survive timeouts and are written to the batch report', async () => {
  const reports = [];
  const api = {
    workspace: {
      async mkdir() {},
      async writeBase64() {},
      async writeText(options) { reports.push(JSON.parse(options.text)); },
    },
    mcp: {
      async call() {
        return { content: [{ type: 'text', text: 'still being made. call generation_result with id "img_abc12345"' }] };
      },
      async grant() {},
    },
  };
  const result = await generateImagesThroughMcp({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompts: ['第一张'],
    directory: 'drafts/demo/imgs',
    timeoutMs: 0,
  });
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.unknowns[0].taskId, 'img_abc12345');
  assert.match(result.unknowns[0].error, /任务 ID：img_abc12345/);
  assert.equal(reports[0].unknowns[0].taskId, 'img_abc12345');
});

test('MCP polling stops immediately when the caller aborts during a wait', async () => {
  const controller = new AbortController();
  let resolveFirst;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  let calls = 0;
  const api = {
    mcp: {
      async call() {
        calls += 1;
        resolveFirst();
        return { content: [{ type: 'text', text: 'still being made. call generation_result with id "img_abc12345"' }] };
      },
      async grant() {},
    },
  };
  const pending = assert.rejects(generateMcpImage({
    api,
    serverId: 's1',
    toolName: 'generate_image',
    argsTemplate: '{"prompt":"{{prompt}}"}',
    prompt: '测试',
    intervalMs: 1000,
    signal: controller.signal,
  }), /已停止等待/);
  await first;
  controller.abort();
  await pending;
  assert.equal(calls, 1);
});
