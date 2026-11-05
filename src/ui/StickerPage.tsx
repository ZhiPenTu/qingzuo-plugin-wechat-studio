import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, errorText, readOptional, shortId } from './client';
import { Badge, Button, Field } from './common';
import { IMAGE_MEDIA, chooseMedium } from '../lib/images.mjs';
import { buildStickerPrompt } from '../lib/prompts.mjs';
import { imageModelLabel, imageModelSource } from '../lib/image-models.mjs';
import { generateImagesThroughMcp, mcpBatchToken } from '../lib/mcp-images.mjs';
import { renderMarkdownDocument } from '../lib/markdown.mjs';
import {
  materializeStickerProject,
  stickerProjectArticleFingerprint,
  stickerProjectReady,
  stickerProjectRelativeFiles,
  stickerWechatPayload,
} from '../lib/sticker-project.mjs';
import {
  STICKER_LANGUAGES,
  STICKER_SESSION_PATH,
  mergeStickerFiles,
  normalizeStickerLanguage,
  parseStickerSession,
  stickerBatchBindings,
  stickerBatchHasUnknown,
  stickerBatchMatches,
  stickerBatchRetryable,
  stickerCaptionPrefix,
  stickerDocumentMarkdown,
  stickerImageItems,
  stickerPublicationFingerprintPayload,
  stickerPublishBlocked,
  stickerResetReceipt,
  stickerSessionSnapshot,
  withStickerLanguage,
} from '../lib/stickers.mjs';
import type { ImageModel, McpServer, Toast, WechatAccount } from './types';
import type { StudioPreferences } from './preferences';

type Notify = (text: string, tone?: Toast['tone']) => void;
type StickerItem = { id: string; prompt: string; caption: string };
type StickerBatchBinding = { id: string; prompt: string; modelId: string };

function stickerId() {
  return 's-' + shortId(String(Date.now()) + Math.random().toString(36));
}

function stickerStateLabel(state: string) {
  if (state === 'succeeded') return '已完成';
  if (state === 'running') return '生成中';
  if (state === 'unknown') return '结果未知';
  if (state === 'failed' || state === 'save-failed') return '失败';
  if (state === 'canceled') return '已取消';
  return state || '待生成';
}

export function StickerPage({
  config,
  servers,
  imageModels,
  accounts,
  preferences,
  notify,
  onChanged,
}: {
  config: Record<string, any>;
  servers: McpServer[];
  imageModels: ImageModel[];
  accounts: WechatAccount[];
  preferences: StudioPreferences;
  notify: Notify;
  onChanged: () => Promise<void>;
}) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(Number(config.multi_image_count) || 6);
  const [style, setStyle] = useState(String(config.custom_sticker_style?.[0] || config.default_sticker_style?.[0] || '统一手绘'));
  const [medium, setMedium] = useState(chooseMedium(config, {}, String(config.topic_direction || '')));
  const [language, setLanguage] = useState(normalizeStickerLanguage(config.sticker_language));
  const [modelId, setModelId] = useState(preferences.imageModelId || imageModels[0]?.id || '');
  const [items, setItems] = useState<StickerItem[]>([]);
  const [title, setTitle] = useState('');
  const [digest, setDigest] = useState('');
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingItemId, setGeneratingItemId] = useState('');
  const [mcpWaiting, setMcpWaiting] = useState(false);
  const [batch, setBatch] = useState<any>(null);
  const [batchBindings, setBatchBindings] = useState<StickerBatchBinding[]>([]);
  const [batchWorkspacePath, setBatchWorkspacePath] = useState('');
  const [itemStates, setItemStates] = useState<Record<string, { state: string; error?: string; taskId?: string }>>({});
  const [directory, setDirectory] = useState('');
  const [outputFiles, setOutputFiles] = useState<any[]>([]);
  const [filesByItem, setFilesByItem] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [receipt, setReceipt] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<any>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [receiptHydrated, setReceiptHydrated] = useState(false);
  const [fingerprintReady, setFingerprintReady] = useState(false);
  const mcpAbort = useRef<AbortController | null>(null);
  const receiptRef = useRef<Record<string, any>>({});
  const sessionReady = useRef(false);
  const imageGenerator = config.image_generator === 'mcp' ? 'mcp' : 'model';
  const mcpServer = servers.find(server => server.id === config.mcp_image_server);
  const mcpReady = Boolean(mcpServer && mcpServer.status === 'ready');
  const publishMethod = String(config.publish_method || 'draft');
  const draftEnabled = publishMethod !== 'none';
  const mediaId = String(receipt.mediaId || '');
  const publishId = String(receipt.publishId || '');
  const draftState = String(receipt.state || '');
  const receiptSourceFingerprint = String(receipt.sourceFingerprint || receipt.articleFingerprint || '');
  const draftBlocked = stickerPublishBlocked(draftState);
  const draftBlockedReason = draftState === 'failed'
    ? '上次发布未成功。请先核对公众号后台，再重置本地状态并重新创建草稿。'
    : '上次草稿或发布操作的结果未知。请先在公众号后台核对；确认后才能继续或明确重置。';
  const draftMatches = Boolean(
    fingerprintReady
    && mediaId
    && receipt.accountId === accountId
    && receiptSourceFingerprint
    && receiptSourceFingerprint === fingerprint,
  );
  const generatedCount = stickerImageItems(items, filesByItem).length;
  const publishReady = Boolean(title.trim() && items.length && generatedCount === items.length && accountId);
  const operationBusy = planning || generating || Boolean(generatingItemId) || savingProject || publishBusy || !receiptHydrated;

  useEffect(() => () => mcpAbort.current?.abort(), []);

  useEffect(() => {
    if (!accounts.some(account => account.id === accountId)) setAccountId(accounts[0]?.id || '');
  }, [accountId, accounts]);

  useEffect(() => {
    let active = true;
    void readOptional(STICKER_SESSION_PATH).then(async text => {
      const session = parseStickerSession(text);
      if (!active || !session) return;
      setTopic(session.topic);
      setCount(session.count);
      setStyle(session.style || style);
      setMedium(session.medium || medium);
      setLanguage(session.language);
      setTitle(session.title);
      setDigest(session.digest);
      setFingerprintReady(false);
      setItems(session.items);
      setItemStates(session.itemStates);
      setReceipt(session.receipt);
      receiptRef.current = session.receipt;
      if (session.accountId && accounts.some(account => account.id === session.accountId)) {
        setAccountId(session.accountId);
      }
      if (session.directory) {
        const restoredReceipt = await loadReceiptBundle(session.directory, session.receipt);
        setReceipt(restoredReceipt);
        receiptRef.current = restoredReceipt;
        const entries = await api.workspace.list({ path: session.directory + '/imgs', recursive: false }).catch(() => []);
        const available = new Set((Array.isArray(entries) ? entries : []).map(entry => entry?.path));
        const mapping = Object.fromEntries(Object.entries(session.filesByItem)
          .filter(([, path]) => available.has(path)));
        setDirectory(session.directory);
        setOutputFiles(Array.isArray(entries) ? entries : []);
        setFilesByItem(mapping);
      }
      setSessionRestored(true);
    }).finally(() => {
      if (active) {
        sessionReady.current = true;
        setReceiptHydrated(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady.current) return;
    const timer = window.setTimeout(() => {
      void persistStickerSession().catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [topic, count, style, medium, language, title, digest, items, filesByItem, itemStates, directory, accountId]);

  useEffect(() => {
    if (preferences.imageModelId && imageModels.some(model => model.id === preferences.imageModelId)) {
      setModelId(preferences.imageModelId);
    } else if (!imageModels.some(model => model.id === modelId)) {
      setModelId(imageModels[0]?.id || '');
    }
  }, [imageModels, modelId, preferences.imageModelId]);

  useEffect(() => {
    let active = true;
    if (!directory) {
      setReceipt({});
      receiptRef.current = {};
      setStatus(null);
      return () => {
        active = false;
      };
    }
    const current = receiptRef.current;
    const fallback = !current.stickersDirectory || current.stickersDirectory === directory ? current : {};
    void loadReceiptBundle(directory, fallback).then(value => {
      if (!active) return;
      setReceipt(value);
      receiptRef.current = value;
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [directory]);

  useLayoutEffect(() => {
    let active = true;
    setFingerprintReady(false);
    void publicationFingerprint().then(value => {
      if (active) {
        setFingerprint(value);
        setFingerprintReady(true);
      }
    }).catch(() => {
      if (active) {
        setFingerprint('');
        setFingerprintReady(false);
      }
    });
    return () => {
      active = false;
    };
  }, [
    title,
    topic,
    digest,
    language,
    items,
    filesByItem,
    outputFiles,
    directory,
    config.default_author,
    config.need_open_comment,
    config.only_fans_can_comment,
  ]);

  function generationPrompt(item: StickerItem) {
    return withStickerLanguage(item.prompt, language);
  }

  function updateItemState(id: string, state: string, error = '', taskId = '') {
    setItemStates(current => ({ ...current, [id]: { state, error, taskId } }));
  }

  async function publicationFingerprint() {
    if (!items.length) return '';
    const payload = stickerPublicationFingerprintPayload({
      title,
      topic,
      digest,
      language,
      author: config.default_author,
      needOpenComment: config.need_open_comment,
      onlyFansCanComment: config.only_fans_can_comment,
      items,
      filesByItem,
      outputFiles,
      directory,
    });
    const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function receiptTimestamp(value: Record<string, any>) {
    const time = Date.parse(String(value?.updatedAt || ''));
    return Number.isFinite(time) ? time : 0;
  }

  async function loadReceiptBundle(directory: string, fallback: Record<string, any> = {}) {
    const candidates: Array<Record<string, any>> = [];
    if (fallback && Object.keys(fallback).length) candidates.push(fallback);
    const postText = await readOptional(directory + '/publish.json').catch(() => '');
    let postReceipt: Record<string, any> = {};
    if (postText) {
      try {
        postReceipt = JSON.parse(postText);
        candidates.push(postReceipt);
      } catch {
        postReceipt = {};
      }
    }
    const projectDirectory = String(postReceipt.projectDirectory || fallback.projectDirectory || '');
    if (projectDirectory.startsWith('drafts/') && !projectDirectory.split('/').includes('..')) {
      const projectText = await readOptional(projectDirectory + '/publish.json').catch(() => '');
      if (projectText) {
        try {
          candidates.push(JSON.parse(projectText));
        } catch {
          // Ignore a malformed project receipt and keep the post receipt.
        }
      }
    }
    if (!candidates.length) return {};
    return Object.assign({}, ...candidates.sort((left, right) => receiptTimestamp(left) - receiptTimestamp(right)));
  }

  async function persistReceipt(dir: string, patch: Record<string, any>) {
    if (!dir) return;
    const next = { ...receiptRef.current, ...patch, updatedAt: new Date().toISOString() };
    await api.workspace.writeText({ path: dir + '/publish.json', text: JSON.stringify(next, null, 2), overwrite: true });
    receiptRef.current = next;
    setReceipt(next);
  }

  async function persistProjectReceipt(projectDirectory: string, patch: Record<string, any>) {
    if (!projectDirectory) return;
    if (!projectDirectory.startsWith('drafts/') || projectDirectory.split('/').includes('..')) {
      throw new Error('文章项目目录不在 drafts/ 下。');
    }
    const text = await readOptional(projectDirectory + '/publish.json');
    let current: Record<string, any> = {};
    try {
      current = text ? JSON.parse(text) : {};
    } catch {
      current = {};
    }
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await api.workspace.writeText({
      path: projectDirectory + '/publish.json',
      text: JSON.stringify(next, null, 2),
      overwrite: true,
    });
  }

  async function persistDraftReceipt(
    postDirectory: string,
    projectDirectory: string,
    patch: Record<string, any>,
  ) {
    await persistReceipt(postDirectory, patch);
    await persistProjectReceipt(projectDirectory, patch);
  }

  async function persistStickerSession(directoryOverride = directory) {
    if (!sessionReady.current) return;
    if (!items.length) {
      await api.workspace.remove({ path: STICKER_SESSION_PATH }).catch(() => {});
      return;
    }
    const snapshot = stickerSessionSnapshot({
      topic,
      count,
      style,
      medium,
      language,
      title,
      digest,
      items,
      directory: directoryOverride,
      filesByItem,
      itemStates,
      accountId,
      receipt: receiptRef.current,
    });
    await api.workspace.mkdir({ path: 'posts/stickers' }).catch(() => {});
    await api.workspace.writeText({
      path: STICKER_SESSION_PATH,
      text: JSON.stringify(snapshot, null, 2),
      overwrite: true,
    });
  }

  function localPlan() {
    return {
      title: [...String(topic || '今日分享')].slice(0, 64).join(''),
      style,
      images: Array.from({ length: count }, (_, index) => ({
        id: stickerId(),
        prompt: '统一风格贴图第 ' + (index + 1) + ' 张。主题：' + (topic || '今日分享') + '。风格：' + style + '。媒介：' + medium + '。画面只承载一个清楚的小观点，不要 emoji。',
        caption: stickerCaptionPrefix(language, index + 1) + (topic || '今日分享'),
      })),
    };
  }

  async function plan() {
    if (!topic.trim()) {
      notify('请填写贴图主题。', 'warning');
      return;
    }
    setPlanning(true);
    setSessionRestored(false);
    setFingerprintReady(false);
    try {
      const prompt = buildStickerPrompt(config, { topic, count, language });
      const result = await api.ai.complete({
        model: typeof config.writing_model === 'object' ? config.writing_model?.id : undefined,
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0.7,
        maxTokens: 3000,
        responseFormat: { type: 'json_object' },
      });
      const raw = String(result.content || '').replace(/^```(?:json)?|```$/g, '').trim();
      const value = JSON.parse(raw);
      if (!Array.isArray(value.images) || value.images.length !== count) throw new Error('模型返回的图片数量不一致。');
      setTitle([...String(value.title || topic)].slice(0, 64).join(''));
      setItems(value.images.map((item: any) => ({ id: stickerId(), prompt: String(item.prompt || ''), caption: String(item.caption || '') })));
      setBatch(null);
      setBatchBindings([]);
      setBatchWorkspacePath('');
      setDirectory('');
      setOutputFiles([]);
      setFilesByItem({});
      setItemStates({});
      setDigest(String(value.images[0]?.caption || '').slice(0, 120));
      if (result.finishReason === 'length') notify('方案达到输出上限，请缩短主题或减少图片。', 'warning');
    } catch (error) {
      const fallback = localPlan();
      setTitle(fallback.title);
      setItems(fallback.images);
      setBatch(null);
      setBatchBindings([]);
      setBatchWorkspacePath('');
      setDirectory('');
      setOutputFiles([]);
      setFilesByItem({});
      setItemStates({});
      setDigest('');
      notify('AI 方案生成失败，已使用本地规划，可逐张修改。' + errorText(error), 'warning');
    } finally {
      setPlanning(false);
    }
  }

  function move(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    clearBatchBinding();
    setItems(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function clearBatchBinding() {
    setBatch(null);
    setBatchBindings([]);
    setBatchWorkspacePath('');
  }

  async function waitBatch(id: string, updateState = true) {
    let value = batch;
    for (let index = 0; index < 600; index += 1) {
      value = await api.ai.batch.get({ id });
      if (updateState) setBatch(value);
      if (['finished', 'interrupted', 'canceled'].includes(value.state)) return value;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('等待贴图生成超时。批次仍在宿主中，可稍后刷新状态，不会自动重发。');
  }

  async function generate(action: 'new' | 'retry' = 'new') {
    if (!items.length || (imageGenerator !== 'mcp' && !modelId)) {
      notify(imageGenerator === 'mcp' ? '请先生成方案并完成 MCP 生图配置。' : '请先生成方案并选择图片模型。', 'warning');
      return;
    }
    if (items.some(item => !item.prompt.trim())) {
      notify('还有贴图缺少画面提示词，请补齐后再批量生成。', 'warning');
      return;
    }
    if (imageGenerator === 'mcp') {
      if (!config.mcp_image_server || !config.mcp_image_tool || !mcpReady) {
        notify('请先在配置中心选择当前可用的 MCP 服务和生图工具。', 'warning');
        return;
      }
      setGenerating(true);
      const date = new Date();
      const stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
      const slug = (title || topic).replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'stickers';
      const runToken = mcpBatchToken();
      const dir = 'posts/stickers/' + stamp + '-' + slug + '-' + runToken;
      const outputDirectory = dir + '/imgs';
      const controller = new AbortController();
      mcpAbort.current = controller;
      let producedFiles = 0;
      setItemStates({});
      try {
        await api.workspace.mkdir({ path: dir });
        await api.workspace.mkdir({ path: outputDirectory });
        setMcpWaiting(true);
        const result = await generateImagesThroughMcp({
          api,
          serverId: config.mcp_image_server,
          toolName: config.mcp_image_tool,
          argsTemplate: config.mcp_image_args,
          prompts: items.map(item => generationPrompt(item)),
          directory: outputDirectory,
          sizeFor: () => '1:1',
          signal: controller.signal,
        });
        producedFiles = result.files.length;
        setMcpWaiting(false);
        const issueByIndex = new Map([...result.failures, ...result.unknowns].map(item => [item.index, item]));
        const errorByIndex = new Map([...issueByIndex].map(([index, issue]) => [index, issue.error]));
        const unknownIndexes = new Set(result.unknowns.map(item => item.index));
        if (result.abortedIndex) unknownIndexes.add(result.abortedIndex);
        const succeeded = new Set(result.files.map(file => file.index));
        const value = {
          id: 'mcp-' + runToken,
          revision: 1,
          state: result.aborted || result.fatal ? 'interrupted' : 'finished',
          items: items.map((item, index) => ({
            id: 'mcp-' + (index + 1),
            name: '生成图-' + (index + 1),
            state: succeeded.has(index + 1)
              ? 'succeeded'
              : unknownIndexes.has(index + 1)
                ? 'unknown'
                : result.aborted || result.fatal
                  ? 'canceled'
                  : 'failed',
            error: errorByIndex.get(index + 1) || null,
            taskId: issueByIndex.get(index + 1)?.taskId || (result.abortedIndex === index + 1 ? result.abortedTaskId : '') || null,
            prompt: item.prompt,
          })),
        };
        setBatch(value);
        setItemStates(Object.fromEntries(value.items.map((item: any) => {
          const source = items[Number(String(item.id).replace('mcp-', '')) - 1];
          return source ? [source.id, { state: item.state, error: item.error || '', taskId: item.taskId || '' }] : null;
        }).filter(Boolean) as Array<[string, { state: string; error: string; taskId: string }]>));
        setDirectory(dir);
        const hasRecovery = producedFiles > 0 || result.unknowns.length > 0 || Boolean(result.abortedTaskId);
        if (result.fatal && !result.files.length && !hasRecovery) {
          await api.workspace.remove({ path: dir, recursive: true }).catch(() => {});
          setDirectory('');
          notify(result.fatal, 'danger');
          return;
        }
        if (result.aborted && !result.files.length && !hasRecovery) {
          await api.workspace.remove({ path: dir, recursive: true }).catch(() => {});
          setDirectory('');
          notify('已停止等待，当前没有已写入的贴图；任务可能仍在 MCP 服务端进行。', 'warning');
          return;
        }
        if (!result.files.length) {
          if (result.unknowns.length) {
            notify('MCP 没有生成可用贴图；结果未知，任务 ID 已写入 ' + dir + '/mcp-generation.json。', 'warning');
            return;
          }
          if (result.fatal) {
            notify(result.fatal, 'danger');
            return;
          }
          if (result.aborted) {
            notify('已停止等待，当前没有已写入的贴图；任务可能仍在 MCP 服务端进行。'
              + (hasRecovery ? ' 结果记录在 ' + dir + '/mcp-generation.json。' : ''), 'warning');
            return;
          }
          const first = result.failures[0]?.error;
          throw new Error('MCP 没有生成任何可用贴图。' + (first ? '首个错误：' + first : ''));
        }
        const entries = await api.workspace.list({ path: outputDirectory, recursive: false });
        const generated = entries
          .filter((entry: any) => entry.kind === 'file' && /生成图-\d+-ai-/.test(entry.path))
          .map((entry: any) => ({ ...entry, batchIndex: Number(entry.path.match(/生成图-(\d+)/)?.[1] || 0) }))
          .filter((entry: any) => entry.batchIndex > 0);
        for (const entry of generated) {
          const extension = entry.path.split('.').pop()?.toLowerCase() || 'png';
          const item = items[entry.batchIndex - 1];
          if (!item) continue;
          await api.workspace.rename({
            from: entry.path,
            to: outputDirectory + '/sticker-' + item.id + '.' + extension,
          });
        }
        const output = await api.workspace.list({ path: outputDirectory, recursive: false });
        const mapping: Record<string, string> = {};
        for (const item of items) {
          const file = output.find((entry: any) => entry.kind === 'file' && entry.name.startsWith('sticker-' + item.id + '.'));
          if (file) mapping[item.id] = file.path;
        }
        await persistPlan(dir, mapping);
        setOutputFiles(output);
        setFilesByItem(mapping);
        for (const item of items) {
          const previous = filesByItem[item.id];
          const next = mapping[item.id];
          if (previous && next && previous !== next) await api.workspace.remove({ path: previous }).catch(() => {});
        }
        await onChanged().catch(() => {});
        const missing = items.length - Object.keys(mapping).length;
        if (result.fatal) {
          notify(result.fatal + ' 已生成的 ' + producedFiles + ' 张贴图保留在 ' + dir + '。', 'danger');
        } else if (result.aborted) {
          notify('已停止等待，已生成 ' + producedFiles + ' 张贴图并保存到 ' + dir + '；后续任务可能仍在 MCP 服务端进行。', 'warning');
        } else if (missing || result.failures.length) {
          notify('贴图方案已保存，仍有 ' + Math.max(0, missing) + ' 张缺失。' + (result.failures[0]?.error ? '首个错误：' + result.failures[0].error : ''), 'warning');
        } else {
          notify('整组贴图已通过 MCP 生成并保存，可继续创建公众号草稿。', 'success');
        }
      } catch (error) {
        setMcpWaiting(false);
        const reason = errorText(error);
        if (producedFiles) {
          notify(reason + ' 已生成的 ' + producedFiles + ' 张贴图保留在 ' + dir + '。', 'danger');
        } else {
          await api.workspace.remove({ path: dir, recursive: true }).catch(() => {});
          notify(reason, 'danger');
        }
      } finally {
        mcpAbort.current = null;
        setMcpWaiting(false);
        setGenerating(false);
      }
      return;
    }
    setGenerating(true);
    setItemStates({});
    try {
      let dir = directory;
      let started;
      let activeBindings: StickerBatchBinding[] = [];
      let batchDirectory = '';
      const runToken = mcpBatchToken();
      if (action === 'retry' && batch && dir) {
        const retryable = stickerBatchRetryable(batch.items);
        if (!retryable) {
          notify('当前批次没有可重试的失败项。结果未知的图片不会自动重发。', 'warning');
          return;
        }
        if (!stickerBatchMatches(batchBindings, items, modelId, generationPrompt)) {
          clearBatchBinding();
          notify('贴图顺序、提示词或图片模型已调整，旧批次不能继续重试；请单张重做或重新生成整组。', 'warning');
          return;
        }
        batchDirectory = batchWorkspacePath || String(batch.workspacePath || '');
        if (!batchDirectory) {
          clearBatchBinding();
          notify('找不到旧批次的生成目录，请单张重做或重新生成整组。', 'warning');
          return;
        }
        activeBindings = batchBindings;
        started = await api.ai.batch.start({
          id: batch.id,
          revision: batch.revision,
          workspacePath: batchDirectory,
          retryFailed: true,
        });
      } else {
        const date = new Date();
        const stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
        const slug = (title || topic).replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'stickers';
        dir = directory || 'posts/stickers/' + stamp + '-' + slug + '-' + shortId(String(Date.now()));
        await api.workspace.mkdir({ path: dir });
        await api.workspace.mkdir({ path: dir + '/imgs' });
        batchDirectory = dir + '/imgs/.batch-' + runToken;
        await api.workspace.mkdir({ path: batchDirectory });
        activeBindings = stickerBatchBindings(items, modelId, generationPrompt);
        const created = await api.ai.batch.create({
          mode: 'generate',
          source: imageModelSource(imageModels, modelId),
          modelId,
          prompt: generationPrompt(items[0]),
          items: items.map(item => ({ prompt: generationPrompt(item) })),
          concurrency: 2,
        });
        setDirectory(dir);
        setBatchBindings(activeBindings);
        setBatchWorkspacePath(batchDirectory);
        started = await api.ai.batch.start({
          id: created.id,
          revision: created.revision,
          workspacePath: batchDirectory,
        });
      }
      setBatch(started);
      const value = await waitBatch(started.id);
      setItemStates(Object.fromEntries((value.items || []).map((batchItem: any, index: number) => {
        const binding = activeBindings[index];
        return binding ? [binding.id, {
          state: batchItem?.state || 'unknown',
          error: batchItem?.error || '',
          taskId: batchItem?.taskId || '',
        }] : null;
      }).filter(Boolean) as Array<[string, { state: string; error: string; taskId: string }]>));
      if (value.state !== 'finished') {
        notify(value.state === 'interrupted' ? '贴图生成被中断，请检查状态后明确重试。' : '贴图生成已结束。', 'warning');
        return;
      }
      const entries = await api.workspace.list({ path: batchDirectory, recursive: false });
      const generated = entries
        .filter((entry: any) => entry.kind === 'file' && /生成图-\d+-ai-/.test(entry.path))
        .map((entry: any) => ({ ...entry, batchIndex: Number(entry.path.match(/生成图-(\d+)/)?.[1] || 0) }))
        .filter((entry: any) => entry.batchIndex > 0);
      const updates: Record<string, string> = {};
      for (const entry of generated) {
        const extension = entry.path.split('.').pop()?.toLowerCase() || 'png';
        const binding = activeBindings[entry.batchIndex - 1];
        if (!binding) continue;
        const finalPath = dir + '/imgs/sticker-' + binding.id + '-' + runToken + '.' + extension;
        await api.workspace.rename({ from: entry.path, to: finalPath });
        updates[binding.id] = finalPath;
      }
      const output = await api.workspace.list({ path: dir + '/imgs', recursive: false });
      const available = new Set(output.filter((entry: any) => entry.kind === 'file').map((entry: any) => entry.path));
      const retained = Object.fromEntries(Object.entries(filesByItem)
        .filter(([, path]) => available.has(path)));
      const mapping = mergeStickerFiles(retained, items, updates);
      await persistPlan(dir, mapping);
      setOutputFiles(output.filter((entry: any) => entry.kind === 'file'));
      setFilesByItem(mapping);
      for (const item of items) {
        const previous = filesByItem[item.id];
        const next = mapping[item.id];
        if (previous && next && previous !== next) await api.workspace.remove({ path: previous }).catch(() => {});
      }
      const retryable = stickerBatchRetryable(value.items);
      const unknown = stickerBatchHasUnknown(value.items);
      if (!unknown && !retryable) await api.workspace.remove({ path: batchDirectory, recursive: true }).catch(() => {});
      await onChanged().catch(() => {});
      const missing = items.length - Object.keys(mapping).length;
      if (missing > 0 || retryable || unknown) {
        notify('贴图方案已保存，仍有 ' + Math.max(0, missing) + ' 张缺失' + (unknown ? '，其中包含结果未知项' : '') + '。请明确选择重试或重新生成。', 'warning');
      } else {
        notify('整组贴图已生成并保存，可继续创建公众号草稿。微信原生图片消息仍需在公众号后台手动发送。', 'success');
      }
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setGenerating(false);
    }
  }

  async function ensureStickerDirectory() {
    if (directory) return directory;
    const date = new Date();
    const stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
    const slug = (title || topic).replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'stickers';
    const dir = 'posts/stickers/' + stamp + '-' + slug + '-' + mcpBatchToken();
    await api.workspace.mkdir({ path: dir });
    await api.workspace.mkdir({ path: dir + '/imgs' });
    setDirectory(dir);
    return dir;
  }

  async function syncOutputs(dir: string, mapping: Record<string, string>) {
    const output = await api.workspace.list({ path: dir + '/imgs', recursive: false });
    setOutputFiles(output);
    setFilesByItem(mapping);
  }

  async function generateSingle(item: StickerItem, index: number) {
    if (!item.prompt.trim()) {
      notify('第 ' + (index + 1) + ' 张还没有画面提示词。', 'warning');
      return;
    }
    if (imageGenerator === 'mcp' && (!config.mcp_image_server || !config.mcp_image_tool || !mcpReady)) {
      notify('请先在配置中心选择当前可用的 MCP 服务和生图工具。', 'warning');
      return;
    }
    if (imageGenerator === 'model' && !modelId) {
      notify('请先选择图片模型。', 'warning');
      return;
    }
    const token = mcpBatchToken();
    let dir = '';
    let tempDir = '';
    let keepTemp = false;
    setGeneratingItemId(item.id);
    updateItemState(item.id, 'running');
    try {
      dir = await ensureStickerDirectory();
      tempDir = dir + '/imgs/.single-' + token;
      await api.workspace.mkdir({ path: tempDir });
      const prompt = generationPrompt(item);
      let generatedPath = '';
      if (imageGenerator === 'mcp') {
        const controller = new AbortController();
        const result = await generateImagesThroughMcp({
          api,
          serverId: config.mcp_image_server,
          toolName: config.mcp_image_tool,
          argsTemplate: config.mcp_image_args,
          prompts: [prompt],
          directory: tempDir,
          sizeFor: () => '1:1',
          signal: controller.signal,
        });
        if (result.files[0]) {
          generatedPath = result.files[0].path;
        } else {
          const issue = result.unknowns[0] || result.failures[0];
          const state = result.unknowns.length ? 'unknown' : 'failed';
          keepTemp = state === 'unknown';
          updateItemState(item.id, state, issue?.error || result.fatal || 'MCP 未返回图片。', issue?.taskId || '');
          notify('第 ' + (index + 1) + ' 张生成' + (state === 'unknown' ? '结果未知' : '失败') + '：'
            + (issue?.error || result.fatal || '工具未返回图片。'), 'warning');
          return;
        }
      } else {
        const created = await api.ai.batch.create({
          mode: 'generate',
          source: imageModelSource(imageModels, modelId),
          modelId,
          prompt,
          items: [{ prompt }],
          concurrency: 1,
        });
        const started = await api.ai.batch.start({ id: created.id, revision: created.revision, workspacePath: tempDir });
        const value = await waitBatch(started.id, false);
        const batchItem = value.items[0];
        if (value.state !== 'finished' || batchItem?.state !== 'succeeded') {
          const state = batchItem?.state || (value.state === 'interrupted' ? 'unknown' : 'failed');
          keepTemp = state === 'unknown';
          updateItemState(item.id, state, batchItem?.error || '单张生成未完成。', batchItem?.taskId || '');
          notify('第 ' + (index + 1) + ' 张生成未完成，请检查状态后再试。', 'warning');
          return;
        }
        const entries = await api.workspace.list({ path: tempDir, recursive: false });
        generatedPath = entries.find((entry: any) => entry.kind === 'file' && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name))?.path || '';
      }
      if (!generatedPath) throw new Error('生成结果中没有找到图片文件。');
      const extension = generatedPath.split('.').pop()?.toLowerCase() || 'png';
      const finalPath = dir + '/imgs/sticker-' + item.id + '-' + token + '.' + extension;
      await api.workspace.rename({ from: generatedPath, to: finalPath });
      const previous = filesByItem[item.id];
      const nextMapping = { ...filesByItem, [item.id]: finalPath };
      await persistPlan(dir, nextMapping);
      await syncOutputs(dir, nextMapping);
      updateItemState(item.id, 'succeeded');
      if (previous && previous !== finalPath) await api.workspace.remove({ path: previous }).catch(() => {});
      await onChanged().catch(() => {});
      notify('第 ' + (index + 1) + ' 张已单独生成并写入方案。', 'success');
    } catch (error) {
      keepTemp = true;
      updateItemState(item.id, 'failed', errorText(error));
      notify('第 ' + (index + 1) + ' 张生成失败：' + errorText(error), 'danger');
    } finally {
      if (tempDir && !keepTemp) await api.workspace.remove({ path: tempDir, recursive: true }).catch(() => {});
      setGeneratingItemId('');
    }
  }

  async function persistPlan(dir = directory, mapping = filesByItem) {
    if (!dir) return;
    const relative = Object.fromEntries(Object.entries(mapping).map(([id, path]) => [
      id,
      path ? path.slice(dir.length + 1) : '',
    ]));
    const value = {
      title: title || topic,
      style,
      medium,
      language,
      digest,
      count: items.length,
      images: items.map(item => ({
        ...item,
        file: relative[item.id] || '',
      })),
    };
    await api.workspace.writeText({ path: dir + '/plan.json', text: JSON.stringify(value, null, 2), overwrite: true });
    const markdown = stickerDocumentMarkdown({ title: value.title, digest, items, filesByItem: relative });
    await api.workspace.writeText({ path: dir + '/贴图方案.md', text: markdown, overwrite: true });
    const html = renderMarkdownDocument(markdown);
    await api.workspace.writeText({ path: dir + '/article.html', text: html, overwrite: true });
  }

  async function ensureMaterializedStickerProject({ reuse = true } = {}) {
    const postDirectory = await ensureStickerDirectory();
    const currentFingerprint = await publicationFingerprint();
    const saved = receiptRef.current;
    const savedDirectory = String(saved.projectDirectory || '');
    const savedRelativeFiles = saved.projectRelativeFiles && typeof saved.projectRelativeFiles === 'object'
      ? saved.projectRelativeFiles
      : stickerProjectRelativeFiles(items);
    const savedComplete = items.every(item => Boolean(String(savedRelativeFiles[item.id] || '').trim()));
    if (
      reuse
      && savedDirectory.startsWith('drafts/')
      && saved.projectFingerprint
      && saved.projectFingerprint === currentFingerprint
      && savedComplete
      && await stickerProjectReady(api, savedDirectory, savedRelativeFiles)
    ) {
      await persistReceipt(postDirectory, {
        projectDirectory: savedDirectory,
        stickersDirectory: postDirectory,
        projectRelativeFiles: savedRelativeFiles,
        projectFingerprint: currentFingerprint,
        projectTitle: String(saved.projectTitle || title.trim() || topic.trim() || '贴图草稿'),
        projectDigest: String(saved.projectDigest || digest || '').trim().slice(0, 120),
        source: 'sticker',
        sourceFingerprint: currentFingerprint,
      });
      await persistProjectReceipt(savedDirectory, {
        projectDirectory: savedDirectory,
        stickersDirectory: postDirectory,
        projectRelativeFiles: savedRelativeFiles,
        projectFingerprint: currentFingerprint,
        source: 'sticker',
        sourceFingerprint: currentFingerprint,
      });
      return {
        directory: savedDirectory,
        relativeFiles: savedRelativeFiles,
        title: String(saved.projectTitle || title.trim() || topic.trim() || '贴图草稿'),
        digest: String(saved.projectDigest || digest || '').trim().slice(0, 120),
        cover: String(savedRelativeFiles[items[0]?.id] || ''),
        articleFingerprint: await stickerProjectArticleFingerprint(api, savedDirectory),
        reused: true,
        fingerprint: currentFingerprint,
      };
    }
    const project = await materializeStickerProject(api, {
      title: title.trim() || topic.trim() || '贴图草稿',
      digest,
      items,
      filesByItem,
      medium,
      language,
      config,
      draftsRoot: config.drafts_root || 'drafts',
    });
    try {
      await persistReceipt(postDirectory, {
        projectDirectory: project.directory,
        stickersDirectory: postDirectory,
        projectRelativeFiles: project.relativeFiles,
        projectFingerprint: currentFingerprint,
        projectTitle: project.title,
        projectDigest: project.digest,
        source: 'sticker',
        sourceFingerprint: currentFingerprint,
      });
      await persistProjectReceipt(project.directory, {
        projectDirectory: project.directory,
        stickersDirectory: postDirectory,
        projectRelativeFiles: project.relativeFiles,
        projectFingerprint: currentFingerprint,
        source: 'sticker',
        sourceFingerprint: currentFingerprint,
        articleFingerprint: project.articleFingerprint,
      });
    } catch (error) {
      await api.workspace.remove({ path: project.directory, recursive: true }).catch(() => {});
      throw error;
    }
    return { ...project, reused: false, fingerprint: currentFingerprint };
  }

  async function createDraft() {
    if (!receiptHydrated) {
      notify('正在恢复上次贴图草稿状态，请稍候。', 'warning');
      return;
    }
    if (!fingerprintReady) {
      notify('正在核对当前贴图方案，请稍候再创建草稿。', 'warning');
      return;
    }
    if (mediaId && draftMatches) {
      notify('当前贴图方案已有公众号草稿，无需重复创建。', 'warning');
      return;
    }
    if (!publishReady) {
      notify('请先补齐标题，并确保每一张贴图都已生成。', 'warning');
      return;
    }
    if (!draftEnabled) {
      notify('当前配置为只保存到本地，不会创建公众号草稿。', 'warning');
      return;
    }
    if (draftBlocked) {
      notify(draftBlockedReason, 'warning');
      return;
    }
    setPublishBusy(true);
    let dir = '';
    let projectDirectory = '';
    let hostCalled = false;
    try {
      dir = await ensureStickerDirectory();
      await persistPlan(dir, filesByItem);
      await persistStickerSession(dir);
      const project = await ensureMaterializedStickerProject({ reuse: true });
      projectDirectory = project.directory;
      if (!project.reused) await onChanged().catch(() => {});
      const payload = stickerWechatPayload({
        accountId,
        directory: project.directory,
        relativeFiles: project.relativeFiles,
        items,
        title: project.title,
        digest: project.digest,
        config,
      });
      await persistDraftReceipt(dir, project.directory, {
        accountId,
        title: project.title,
        mediaId: null,
        publishId: null,
        state: 'creating-draft',
        articleFingerprint: project.articleFingerprint,
        sourceFingerprint: project.fingerprint,
        source: 'sticker',
        projectDirectory: project.directory,
        stickersDirectory: dir,
        projectRelativeFiles: project.relativeFiles,
        projectFingerprint: project.fingerprint,
        projectTitle: project.title,
        projectDigest: project.digest,
        error: null,
      });
      await persistStickerSession(dir);
      hostCalled = true;
      const result = await api.wechat.createDraft(payload);
      await persistDraftReceipt(dir, project.directory, {
        accountId,
        mediaId: result.mediaId,
        publishId: null,
        state: 'draft',
        title: project.title,
        articleFingerprint: project.articleFingerprint,
        sourceFingerprint: project.fingerprint,
        source: 'sticker',
        error: null,
      });
      notify('整组贴图已保存为文章项目并创建公众号草稿。请先在后台核对，再决定是否发布。', 'success');
    } catch (error) {
      const uncertain = hostCalled;
      const nextState = uncertain ? 'draft-unknown' : 'draft-failed';
      if (dir) await persistDraftReceipt(dir, projectDirectory, { state: nextState, error: errorText(error) }).catch(() => {});
      notify(
        uncertain
          ? '草稿创建结果不确定：' + errorText(error) + '。请先在公众号后台核对，避免重复创建。'
          : '创建草稿前检查失败：' + errorText(error) + '。已保留贴图方案和文章项目，可修正后重试。',
        'danger',
      );
    } finally {
      setPublishBusy(false);
    }
  }

  async function publish() {
    if (!receiptHydrated) {
      notify('正在恢复上次贴图草稿状态，请稍候。', 'warning');
      return;
    }
    if (!mediaId) {
      notify('请先创建并核对公众号草稿。', 'warning');
      return;
    }
    if (publishMethod !== 'published') {
      notify('当前配置为仅创建草稿，直接发布已关闭。', 'warning');
      return;
    }
    if (draftBlocked) {
      notify('上次发布结果未知，请先查询状态或在公众号后台核对，禁止重复提交。', 'warning');
      return;
    }
    setPublishBusy(true);
    let dir = '';
    const projectDirectory = String(receiptRef.current.projectDirectory || '');
    let hostCalled = false;
    try {
      const currentFingerprint = await publicationFingerprint();
      if (!draftMatches || receiptSourceFingerprint !== currentFingerprint) {
        notify('草稿创建后贴图、标题或配文已变化，请重新创建草稿并核对。', 'danger');
        return;
      }
      dir = directory;
      if (!dir) return;
      await persistStickerSession(dir);
      await persistDraftReceipt(dir, projectDirectory, {
        accountId,
        mediaId,
        state: 'submitting',
        publishId: null,
        error: null,
      });
      hostCalled = true;
      const result = await api.wechat.publish({ accountId, mediaId });
      await persistDraftReceipt(dir, projectDirectory, {
        accountId,
        mediaId,
        publishId: result.publishId,
        state: 'submitted',
      });
      notify('发布已提交，正在查询状态。', 'success');
      await queryStatus(result.publishId);
    } catch (error) {
      const message = errorText(error);
      if (!hostCalled) {
        await persistDraftReceipt(dir, projectDirectory, { accountId, mediaId, state: 'draft', error: message }).catch(() => {});
        notify('发布前检查失败：' + message + '。草稿仍保留。', 'danger');
      } else if (/取消|cancel/i.test(message)) {
        await persistDraftReceipt(dir, projectDirectory, { accountId, mediaId, state: 'draft', error: null }).catch(() => {});
        notify('发布已取消，草稿仍保留。', 'info');
      } else {
        await persistDraftReceipt(dir, projectDirectory, { accountId, mediaId, state: 'unknown', error: message }).catch(() => {});
        notify('发布结果未知：' + message + '。请先查询状态，不要重复提交。', 'danger');
      }
    } finally {
      setPublishBusy(false);
    }
  }

  async function queryStatus(id = publishId) {
    const dir = directory;
    if (!dir || (!id && !mediaId)) return;
    const receiptAccountId = String(receipt.accountId || accountId);
    const projectDirectory = String(receipt.projectDirectory || '');
    setPublishBusy(true);
    try {
      const value = await api.wechat.publishStatus({
        accountId: receiptAccountId,
        ...(id ? { publishId: id } : { mediaId }),
      });
      setStatus(value);
      await persistDraftReceipt(dir, projectDirectory, {
        accountId: receiptAccountId,
        mediaId,
        publishId: value.publishId || id || null,
        state: value.status,
        articleUrl: value.articleUrl,
        error: value.error || null,
      });
      notify(value.status === 'success' ? '贴图图文已发布。' : value.status === 'pending' ? '贴图图文仍在发布队列中。' : '发布未成功，请查看状态。', value.status === 'failed' ? 'danger' : 'info');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setPublishBusy(false);
    }
  }

  async function resetUnknownState() {
    if (!draftBlocked || !directory) return;
    if (!window.confirm('请确认已在公众号后台核对草稿或发布状态。重置后再次操作仍可能造成重复，是否继续？')) return;
    setPublishBusy(true);
    try {
      await persistDraftReceipt(directory, String(receiptRef.current.projectDirectory || ''), stickerResetReceipt());
      setStatus(null);
      notify('本地草稿/发布状态已重置。请重新创建草稿并核对。', 'warning');
    } catch (error) {
      notify('重置本地状态失败：' + errorText(error), 'danger');
    } finally {
      setPublishBusy(false);
    }
  }

  async function saveToArticleProject() {
    const images = stickerImageItems(items, filesByItem);
    if (!images.length) {
      notify('请至少生成一张贴图，再保存为文章项目。', 'warning');
      return;
    }
    if (images.length !== items.length) {
      notify('还有贴图未生成，请补齐后再保存为文章项目。', 'warning');
      return;
    }
    setSavingProject(true);
    try {
      const postDirectory = await ensureStickerDirectory();
      await persistPlan(postDirectory, filesByItem);
      await persistStickerSession(postDirectory);
      const project = await ensureMaterializedStickerProject({ reuse: true });
      notify(
        project.reused
          ? '当前贴图方案已保存为文章项目：' + project.directory
          : '贴图草稿已保存为文章项目：' + project.directory,
        'success',
      );
      await onChanged().catch(error => notify('项目已保存，但列表刷新失败：' + errorText(error), 'warning'));
    } catch (error) {
      notify('保存为文章项目失败：' + errorText(error), 'danger');
    } finally {
      setSavingProject(false);
    }
  }

  async function copyCaptions() {
    await navigator.clipboard.writeText(items.map((item, index) => (index + 1) + '. ' + item.caption).join('\n'));
    notify('逐图配文已复制。', 'success');
  }

  return (
    <div className="page sticker-page">
      <header className="page-header">
        <div>
          <h1>贴图工作流</h1>
          <p>1–9 张统一风格、主题语言与媒介；可单张生成或重做，完成后可直接创建公众号草稿并发布常规图文。</p>
        </div>
        <Badge tone="success">草稿 / 发布已接入</Badge>
      </header>
      {sessionRestored ? <div className="notice info">已恢复上次贴图方案；若上次草稿状态未决，请先核对后台再继续。</div> : null}
      <section className="panel">
        <div className="form-grid form-grid-3">
          <Field label="主题"><input value={topic} onChange={event => { clearBatchBinding(); setTopic(event.target.value); }} placeholder="今天想讲清什么？" disabled={operationBusy} /></Field>
          <Field label="图片数量">
            <select value={count} onChange={event => setCount(Number(event.target.value))} disabled={operationBusy}>
              {Array.from({ length: 9 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} 张</option>)}
            </select>
          </Field>
          <Field label="统一风格"><input value={style} onChange={event => { clearBatchBinding(); setStyle(event.target.value); }} disabled={operationBusy} /></Field>
          <Field label="主题语言" hint="统一控制画面内可见文字与逐图配文。">
            <select value={language} onChange={event => { clearBatchBinding(); setLanguage(normalizeStickerLanguage(event.target.value)); }} disabled={operationBusy}>
              {STICKER_LANGUAGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="统一媒介">
            <select value={medium} onChange={event => { clearBatchBinding(); setMedium(event.target.value); }} disabled={operationBusy}>
              {IMAGE_MEDIA.map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
        {imageGenerator === 'mcp' ? (
          <Field label="MCP 生图">
            <input readOnly value={(mcpServer?.name || '未选择服务') + ' · ' + (config.mcp_image_tool || '未选择工具')} />
          </Field>
        ) : (
          <Field label="图片模型">
            <select value={modelId} onChange={event => { clearBatchBinding(); setModelId(event.target.value); }} disabled={operationBusy}>
              {imageModels.map(model => <option key={model.id} value={model.id}>{imageModelLabel(model)}</option>)}
            </select>
          </Field>
        )}
        </div>
        <div className="toolbar toolbar-end">
          <Button type="button" variant="primary" onClick={() => void plan()} busy={planning} disabled={operationBusy && !planning}>生成方案与配文</Button>
        </div>
        {imageGenerator === 'mcp' && !mcpReady ? <div className="notice warning">配置中的 MCP 服务当前不可用，请到配置中心重新选择并确认连接状态。</div> : null}
        {imageGenerator === 'mcp' ? <div className="notice info">整组贴图将通过 MCP 工具生成。首次调用会请求你单独授权该工具；工具可能产生费用。</div> : null}
      </section>

      {items.length ? (
        <section className="panel">
          <div className="section-heading">
            <div><h2>{title || topic}</h2><p>{items.length} 张 · {style} · {medium} · {language}</p></div>
            <div className="toolbar">
              <Button type="button" onClick={() => { clearBatchBinding(); setItems(current => [...current, { id: stickerId(), prompt: '', caption: '' }]); }} disabled={items.length >= 9 || operationBusy}>加一张</Button>
              <Button type="button" onClick={() => void copyCaptions()}>复制配文</Button>
            </div>
          </div>
          <div className="sticker-plan">
            {items.map((item, index) => {
              const file = filesByItem[item.id];
              const itemState = itemStates[item.id];
              const itemBusy = generatingItemId === item.id;
              return (
                <article key={item.id} className={'sticker-item' + (file ? ' has-media' : '')}>
                  <header>
                    <div className="sticker-item-title">
                      <strong>第 {index + 1} 张</strong>
                      {itemState ? (
                        <Badge tone={itemState.state === 'succeeded' ? 'success' : ['failed', 'unknown'].includes(itemState.state) ? 'danger' : 'neutral'}>
                          {stickerStateLabel(itemState.state)}
                        </Badge>
                      ) : null}
                    </div>
                    <div>
                      <button type="button" onClick={() => move(index, -1)} aria-label="上移" disabled={index === 0 || operationBusy}>↑</button>
                      <button type="button" onClick={() => move(index, 1)} aria-label="下移" disabled={index === items.length - 1 || operationBusy}>↓</button>
                      <button type="button" onClick={() => { clearBatchBinding(); setItems(current => current.filter(entry => entry.id !== item.id)); }} aria-label="删除" disabled={operationBusy}>×</button>
                    </div>
                  </header>
                  <div className="sticker-item-content">
                    <Field label="画面提示词" hint={'统一主题语言：' + language}>
                      <textarea value={item.prompt} onChange={event => { clearBatchBinding(); setItems(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, prompt: event.target.value } : entry)); }} rows={5} disabled={operationBusy} />
                    </Field>
                    <Field label="配文">
                      <textarea value={item.caption} onChange={event => setItems(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, caption: event.target.value } : entry))} rows={3} disabled={operationBusy} />
                    </Field>
                  </div>
                  {file ? (
                    <div className="sticker-item-media">
                      <StickerPreview path={file} caption={(index + 1) + '. ' + item.caption} />
                    </div>
                  ) : null}
                  <footer className="sticker-item-footer">
                    <small>
                      {itemState?.error
                        ? itemState.error + (itemState.taskId ? ' · 任务 ID：' + itemState.taskId : '')
                        : file ? '已写入方案，可单独重做' : '尚未生成'}
                    </small>
                    <Button
                      type="button"
                      variant={file ? 'secondary' : 'primary'}
                      busy={itemBusy}
                      disabled={operationBusy || (imageGenerator === 'model' ? !modelId : (!mcpReady || !config.mcp_image_tool))}
                      onClick={() => void generateSingle(item, index)}
                    >
                      {file ? '重新生成这张' : '单独生成这张'}
                    </Button>
                  </footer>
                </article>
              );
            })}
          </div>
          {stickerBatchHasUnknown(batch?.items) ? (
            <div className="notice warning">有图片生成结果未知，不会自动重发。贴图目录的 mcp-generation.json 已记录任务 ID，请先检查后台，确认后再重新生成。</div>
          ) : null}
          {imageGenerator === 'mcp' && stickerBatchRetryable(batch?.items) ? (
            <div className="notice warning">失败项可在对应卡片单独重试；“重新生成整组”仍会再次调用已成功项并可能重复计费。</div>
          ) : null}
          <div className="toolbar toolbar-end">
            {imageGenerator === 'model' && stickerBatchRetryable(batch?.items) ? (
              <Button type="button" variant="danger" onClick={() => void generate('retry')} busy={generating} disabled={operationBusy && !generating}>明确重试失败项</Button>
            ) : null}
            {imageGenerator === 'mcp' && mcpWaiting ? <Button type="button" variant="danger" onClick={() => mcpAbort.current?.abort()}>停止等待</Button> : null}
            <Button type="button" onClick={() => void persistPlan()} disabled={!directory || operationBusy}>仅保存方案</Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void generate('new')}
              busy={generating}
              disabled={operationBusy || (imageGenerator === 'model' ? !modelId : (!mcpReady || !config.mcp_image_tool))}
            >
              {batch ? (imageGenerator === 'mcp' ? '重新生成整组（会再次调用成功项）' : '重新生成整组') : '确认方案并批量生成'}
            </Button>
          </div>
        </section>
      ) : null}
      {items.length ? (
        <section className="panel sticker-publish-panel">
          <div className="section-heading">
            <div>
              <h2>草稿与发布</h2>
              <p>把整组贴图整理为常规图文，创建公众号草稿后可核对并提交发布。微信原生“图片消息”仍需在公众号后台手动发送。</p>
            </div>
            <Badge tone={publishReady ? 'success' : generatedCount ? 'warning' : 'neutral'}>
              {publishReady ? '可创建草稿' : generatedCount + '/' + items.length + ' 张已完成'}
            </Badge>
          </div>
          <div className="form-grid">
            <Field label="公众号账号">
              <select value={accountId} onChange={event => setAccountId(event.target.value)} disabled={operationBusy}>
                {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.appIdMasked}</option>)}
              </select>
            </Field>
            <Field label="发布方式">
              <div className="static-field">
                {publishMethod === 'published' ? '创建草稿后可提交直接发布' : publishMethod === 'none' ? '仅保存到本地' : '仅创建草稿'}
              </div>
            </Field>
            <Field label="草稿标题">
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="公众号草稿标题" maxLength={64} disabled={operationBusy} />
            </Field>
            <Field label="摘要" hint="最多 120 字，使用生成的首张配文作为默认摘要。">
              <textarea className="lines-input" value={digest} onChange={event => setDigest(event.target.value)} rows={3} maxLength={120} disabled={operationBusy} />
            </Field>
          </div>
          {!accounts.length ? (
            <div className="notice warning">请在底座「设置 → 能力连接 → 公众号」录入账号。插件只看到名称和掩码 AppID。</div>
          ) : null}
          {mediaId ? <div className="receipt"><span>草稿 mediaId</span><code>{mediaId}</code></div> : null}
          {publishId ? <div className="receipt"><span>发布标识</span><code>{publishId}</code></div> : null}
          {receipt.error ? <div className="notice warning">{String(receipt.error)}</div> : null}
          {mediaId && fingerprintReady && !draftMatches && receipt.articleFingerprint ? <div className="notice warning">草稿创建后贴图、标题、摘要或配文已变化，请重新创建草稿。</div> : null}
          {draftBlocked ? (
            <div className="notice warning">
              {draftBlockedReason}插件不会自动重发。
              <Button type="button" busy={publishBusy} disabled={operationBusy && !publishBusy} onClick={() => void resetUnknownState()}>
                {draftState === 'failed' ? '我已核对，重置失败状态' : '我已核对，重置未知状态'}
              </Button>
            </div>
          ) : null}
          {status ? (
            <div className="receipt">
              <span>状态</span><strong>{status.status}</strong>
              {status.articleUrl ? <a href={status.articleUrl} target="_blank" rel="noreferrer">查看文章</a> : null}
            </div>
          ) : null}
          <div className="notice info">“保存到文章项目”会在 drafts/ 下创建一份可编辑副本，并复制全部贴图；原贴图方案仍保留在 posts/stickers/。</div>
          <div className="publish-actions">
            <Button type="button" onClick={() => void saveToArticleProject()} busy={savingProject} disabled={!items.length || generatedCount !== items.length || operationBusy}>
              保存到文章项目
            </Button>
            <Button type="button" variant="primary" onClick={() => void createDraft()} busy={publishBusy} disabled={!publishReady || !accountId || draftBlocked || !draftEnabled || !fingerprintReady || operationBusy || Boolean(mediaId && draftMatches)}>
              {!fingerprintReady ? '正在核对方案' : mediaId && draftMatches ? '当前方案已有草稿' : '创建公众号草稿'}
            </Button>
            <Button type="button" onClick={() => void publish()} busy={publishBusy} disabled={!mediaId || Boolean(publishId) || draftBlocked || !draftMatches || publishMethod !== 'published' || operationBusy}>
              提交直接发布
            </Button>
            <Button type="button" onClick={() => void queryStatus()} busy={publishBusy} disabled={(!publishId && !(mediaId && ['submitting', 'unknown', 'submitted', 'pending', 'failed'].includes(draftState))) || operationBusy}>
              查询发布状态
            </Button>
          </div>
          {publishMethod !== 'published' ? <div className="notice info">当前为仅创建草稿模式。需要直接发布时，请先在配置中心把发布方式改为“提交直接发布”。</div> : null}
        </section>
      ) : null}
    </div>
  );
}

function StickerPreview({ path, caption }: { path: string; caption: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    void api.workspace.url({ path }).then(setUrl).catch(() => {});
  }, [path]);
  return (
    <figure>
      {url ? <img src={url} alt={path} loading="lazy" /> : <span className="image-placeholder" />}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
