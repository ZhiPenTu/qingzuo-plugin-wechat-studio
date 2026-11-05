const PROMPT_TOKEN = '__QZ_PROMPT__';
const SIZE_TOKEN = '__QZ_SIZE__';
const COUNT_TOKEN = '__QZ_COUNT_TEXT__';
const COUNT_VALUE = 987654321012345;

export const DEFAULT_MCP_IMAGE_ARGS = '{\n  "prompt": "{{prompt}}",\n  "size": "{{size}}"\n}';

const SUPPORTED_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

export function mcpServerStatusLabel(status) {
  if (status === 'ready') return '可用';
  if (status === 'auth-required') return '需要授权';
  if (status === 'error') return '连接异常';
  if (status === 'disabled') return '已停用';
  return '状态未知';
}

function textOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map(item => item && item.type === 'text' && typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n');
}

export function renderMcpArguments(template, { prompt = '', size = '', count = 1 } = {}) {
  const source = String(template ?? '').trim() || DEFAULT_MCP_IMAGE_ARGS;
  const marked = source
    .replaceAll('{{prompt}}', () => PROMPT_TOKEN)
    .replaceAll('{{size}}', () => SIZE_TOKEN)
    .replaceAll('"{{count}}"', () => COUNT_TOKEN)
    .replaceAll('{{count}}', () => String(COUNT_VALUE));
  let value;
  try {
    value = JSON.parse(marked);
  } catch {
    throw new Error('MCP 工具参数模板不是有效 JSON。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP 工具参数模板必须是 JSON 对象。');
  }
  const replace = input => {
    if (typeof input === 'string') {
      return input
        .replaceAll(PROMPT_TOKEN, () => String(prompt ?? ''))
        .replaceAll(SIZE_TOKEN, () => String(size ?? ''))
        .replaceAll(COUNT_TOKEN, () => String(count ?? 1));
    }
    if (input === COUNT_VALUE) return Number(count ?? 1);
    if (Array.isArray(input)) return input.map(replace);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, replace(child)]));
    }
    return input;
  };
  return replace(value);
}

function dataUrlImage(value) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  return { data: match[2].replace(/\s+/g, ''), mimeType: match[1].toLowerCase() };
}

function imageItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'image' && typeof item.data === 'string' && item.data) {
    const source = item.source && typeof item.source === 'object' ? item.source : null;
    return {
      data: item.data,
      mimeType: String(item.mimeType || item.mime || source?.media_type || 'image/png').toLowerCase(),
    };
  }
  if (item.type === 'image' && item.source && typeof item.source === 'object' && typeof item.source.data === 'string') {
    return {
      data: item.source.data,
      mimeType: String(item.source.media_type || item.source.mimeType || 'image/png').toLowerCase(),
    };
  }
  if (item.type === 'image_url') {
    const url = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url;
    return dataUrlImage(url);
  }
  if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
    const mimeType = String(item.resource.mimeType || item.resource.media_type || '').toLowerCase();
    if (mimeType.startsWith('image/')) {
      if (typeof item.resource.blob === 'string' && item.resource.blob) {
        return { data: item.resource.blob, mimeType };
      }
      if (typeof item.resource.uri === 'string') return dataUrlImage(item.resource.uri);
    }
  }
  if (item.type === 'resource_link' && typeof item.uri === 'string') return dataUrlImage(item.uri);
  if (typeof item.data === 'string' && item.data && typeof item.mimeType === 'string' && item.mimeType.startsWith('image/')) {
    return { data: item.data, mimeType: item.mimeType };
  }
  return null;
}

export function extractMcpImages(result) {
  const images = [];
  const seenData = new Set();
  const seenObjects = new WeakSet();
  const add = image => {
    if (!image?.data) return;
    const mimeType = String(image.mimeType || '').toLowerCase();
    if (!SUPPORTED_MIME.has(mimeType)) return;
    if (seenData.has(image.data)) return;
    seenData.add(image.data);
    images.push({ data: image.data, mimeType });
  };
  const visit = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const dataImage = dataUrlImage(value);
      if (dataImage) add(dataImage);
      return;
    }
    if (typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);
    if (!Array.isArray(value)) add(imageItem(value));
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, depth + 1);
  };
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    add(imageItem(item));
    if (item && item.type === 'text' && typeof item.text === 'string') {
      for (const match of item.text.matchAll(/data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+/gi)) {
        add(dataUrlImage(match[0]));
      }
      const trimmed = item.text.trim();
      if (trimmed.startsWith('{')) {
        try {
          add(imageItem(JSON.parse(trimmed)));
        } catch {
          // Text from a tool is untrusted; only parse it when it is complete JSON.
        }
      }
    }
  }
  if (result?.structuredContent !== undefined) visit(result.structuredContent);
  return images;
}

export function pendingMcpGenerationId(result) {
  if (extractMcpImages(result).length) return null;
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (!item || item.type !== 'text' || typeof item.text !== 'string') continue;
    const trimmed = item.text.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const value = JSON.parse(trimmed);
      const status = String(value?.status || value?.state || '').toLowerCase();
      const id = value?.task_id || value?.taskId || value?.id;
      if (id && /pending|queued|processing|running|生成中|等待/.test(status)) return String(id);
    } catch {
      // Ignore partial or non-JSON text.
    }
  }
  const structured = result?.structuredContent;
  if (structured && typeof structured === 'object') {
    const queue = [structured];
    const seen = new WeakSet();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (!Array.isArray(value)) {
        const status = String(value.status || value.state || '').toLowerCase();
        const id = value.task_id || value.taskId || value.id;
        if (id && /pending|queued|processing|running|生成中|等待/.test(status)) return String(id);
      }
      queue.push(...(Array.isArray(value) ? value : Object.values(value)));
    }
  }
  const text = textOf(result);
  if (!text) return null;
  const explicit = /generation_result[^"“]*["“]([A-Za-z0-9_.:-]{4,})["”]/i.exec(text);
  if (explicit) return explicit[1];
  if (/(?:still being made|生成中|还在生成|稍后|pending)/i.test(text)) {
    const id = /["“](?:id|task_id|taskId)["”]\s*[:=]\s*["“]([A-Za-z0-9_.:-]{4,})["”]/i.exec(text)
      || /id\s*[:=]\s*["“]([A-Za-z0-9_.:-]{4,})["”]/i.exec(text);
    if (id) return id[1];
  }
  return null;
}

function resultText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map(item => item && item.type === 'text' && typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function mcpErrorText(error) {
  return error instanceof Error ? error.message : String(error || 'MCP 调用失败。');
}

function abortError(taskId = '') {
  const error = new Error('已停止等待 MCP 生图。任务可能仍在服务端进行。' + (taskId ? '任务 ID：' + taskId : ''));
  error.name = 'AbortError';
  error.taskId = taskId;
  return error;
}

function throwIfAborted(signal, taskId = '') {
  if (signal?.aborted) throw abortError(taskId);
}

function sleep(ms, signal, taskId = '') {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  throwIfAborted(signal, taskId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(taskId));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function unknownError(message, taskId = '', cause) {
  const error = new Error(message + (taskId ? ' 任务 ID：' + taskId : ''), cause ? { cause } : undefined);
  error.unknown = true;
  error.taskId = taskId;
  return error;
}

function failureError(message) {
  const error = new Error(message);
  error.confirmedFailure = true;
  return error;
}

function definitelyNotSubmitted(message) {
  return /尚未授权|权限已变化|能力未授权|只读|不可调用|授权已取消|授权已撤销|请升级|服务不存在|服务已停用|工具无效|未选择 MCP|请选择 MCP|参数模板|服务未配置/.test(message);
}

async function callTool(api, { serverId, toolName, args }, signal) {
  throwIfAborted(signal);
  const invoke = () => api.mcp.call({ serverId, toolName, args, inlineImages: true });
  try {
    return await invoke();
  } catch (error) {
    const text = mcpErrorText(error);
    if (/尚未授权|权限已变化/.test(text)) {
      try {
        await api.mcp.grant({ serverId, toolNames: [toolName] });
      } catch (grantError) {
        if (/只读|不可调用/.test(mcpErrorText(grantError))) {
          throw new Error('当前轻作版本只允许 MCP 只读工具，请升级到支持 MCP 生图的版本。');
        }
        throw grantError;
      }
      throwIfAborted(signal);
      return invoke();
    }
    if (/只读|不可调用/.test(text)) {
      throw new Error('当前轻作版本只允许 MCP 只读工具，请升级到支持 MCP 生图的版本。');
    }
    throw error;
  }
}

export async function generateMcpImage({
  api, serverId, toolName, argsTemplate, prompt, size = '', count = 1,
  pollTool = 'generation_result', timeoutMs = 300000, intervalMs = 5000, signal,
} = {}) {
  if (!serverId || !toolName) throw new Error('请选择 MCP 服务和生图工具。');
  throwIfAborted(signal);
  const args = renderMcpArguments(argsTemplate, { prompt, size, count });
  let result;
  try {
    result = await callTool(api, { serverId, toolName, args }, signal);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    const message = mcpErrorText(error);
    if (definitelyNotSubmitted(message) || /授权已取消|授权已撤销|请升级到支持 MCP 生图/.test(message)) throw error;
    throw unknownError(message, '', error);
  }
  let images = extractMcpImages(result);
  if (images.length) return [...images].sort((left, right) => right.data.length - left.data.length).slice(0, count);
  throwIfAborted(signal);
  if (result?.isError) throw new Error(resultText(result) || 'MCP 生图任务失败。');
  const pending = pendingMcpGenerationId(result);
  if (!pending) {
    const detail = resultText(result);
    throw new Error('MCP 工具没有返回图片。' + (detail ? '工具返回：' + detail.slice(0, 300) : '请检查参数模板，或确认该工具会返回图片内容。'));
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await sleep(intervalMs, signal, pending);
      throwIfAborted(signal, pending);
      try {
        result = await callTool(api, { serverId, toolName: pollTool, args: { id: pending } }, signal);
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        throw unknownError(mcpErrorText(error), pending, error);
      }
      if (result?.isError) throw failureError(resultText(result) || 'MCP 生图任务失败。');
      images = extractMcpImages(result);
      if (images.length) return [...images].sort((left, right) => right.data.length - left.data.length).slice(0, count);
      throwIfAborted(signal, pending);
      const next = pendingMcpGenerationId(result);
      if (!next) {
        const detail = resultText(result);
        if (/fail|error|失败|无法|couldn't/i.test(detail)) throw failureError(detail.slice(0, 500));
      }
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw abortError(pending);
    if (error?.confirmedFailure) throw error;
    if (error?.unknown || error?.taskId) throw error;
    throw unknownError(mcpErrorText(error), pending, error);
  }
  throw unknownError('等待 MCP 生图超时。任务可能仍在服务端进行，请到该服务确认后再重试。', pending);
}

function hexToken(byteLength = 6) {
  const bytes = new Uint8Array(byteLength);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

export function mcpBatchToken(now = Date.now()) {
  return String(now) + '-' + hexToken(8);
}

export function mcpImageSize(aspect) {
  const value = String(aspect || '').trim();
  if (value === '3:4' || value === '4:3' || value === '1:1' || value === '16:9') return value;
  if (value === '1.91:1' || value === '2.35:1') return '16:9';
  return '3:4';
}

export function mcpCoverSize(aspect) {
  return mcpImageSize(aspect);
}

/**
 * @param {{
 *   api: any,
 *   serverId: string,
 *   toolName: string,
 *   argsTemplate?: string,
 *   prompts: string[],
 *   directory: string,
 *   sizeFor?: (index: number) => string,
 *   onProgress?: (current: number, total: number, prompt: string) => void,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 * }} options
 */
export async function generateImagesThroughMcp(options = {}) {
  const {
    api, serverId, toolName, argsTemplate, prompts, directory, sizeFor, onProgress, signal, timeoutMs = 300000,
  } = options;
  if (!Array.isArray(prompts) || !prompts.length) throw new Error('没有可生成的图片提示词。');
  if (!directory) throw new Error('图片输出目录缺失。');
  throwIfAborted(signal);
  await api.workspace.mkdir({ path: directory });
  const files = [];
  const failures = [];
  const unknowns = [];
  let aborted = false;
  let abortedIndex = null;
  let abortedTaskId = '';
  let fatal = null;
  for (const [index, prompt] of prompts.entries()) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    let submitted = false;
    onProgress?.(index + 1, prompts.length, prompt);
    try {
      submitted = true;
      const images = await generateMcpImage({
        api,
        serverId,
        toolName,
        argsTemplate,
        prompt,
        size: sizeFor?.(index) || '',
        count: 1,
        timeoutMs,
        signal,
      });
      const image = images[0];
      const extension = SUPPORTED_MIME.get(image.mimeType);
      if (!extension) throw new Error('MCP 返回了不支持的图片格式：' + image.mimeType);
      const path = directory + '/生成图-' + (index + 1) + '-ai-' + hexToken() + '-' + Date.now() + '.' + extension;
      await api.workspace.writeBase64({
        path,
        data: image.data,
        mime: image.mimeType,
        overwrite: false,
      });
      files.push({ index: index + 1, path, mimeType: image.mimeType });
      submitted = false;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        aborted = true;
        abortedIndex = submitted ? index + 1 : null;
        abortedTaskId = String(error?.taskId || '');
        break;
      }
      const message = mcpErrorText(error);
      if (/授权已取消|授权已撤销|请升级到支持 MCP 生图/.test(message)) {
        fatal = message;
        break;
      }
      if (error?.unknown || /超时|timeout|网络|连接失败|unknown|aborted|响应过大/i.test(message)) {
        unknowns.push({ index: index + 1, error: mcpErrorText(error), taskId: String(error?.taskId || '') });
      } else {
        failures.push({ index: index + 1, error: mcpErrorText(error), taskId: String(error?.taskId || '') });
      }
    }
    if (signal?.aborted) {
      aborted = true;
      break;
    }
  }
  const report = {
    schemaVersion: 1,
    tool: { serverId, toolName },
    generatedAt: new Date().toISOString(),
    files,
    failures,
    unknowns,
    aborted,
    abortedIndex,
    abortedTaskId: abortedTaskId || null,
    fatal,
  };
  if (typeof api.workspace.writeText === 'function') {
    await api.workspace.writeText({
      path: directory + '/mcp-generation.json',
      text: JSON.stringify(report, null, 2),
      overwrite: true,
    }).catch(() => {});
  }
  return { ...report };
}
