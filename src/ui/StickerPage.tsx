import { useEffect, useRef, useState } from 'react';
import { api, errorText, shortId } from './client';
import { Badge, Button, Field } from './common';
import { IMAGE_MEDIA, chooseMedium } from '../lib/images.mjs';
import { buildStickerPrompt } from '../lib/prompts.mjs';
import { imageModelLabel, imageModelSource } from '../lib/image-models.mjs';
import { generateImagesThroughMcp, mcpBatchToken } from '../lib/mcp-images.mjs';
import type { ImageModel, McpServer, Toast } from './types';
import type { StudioPreferences } from './preferences';

type Notify = (text: string, tone?: Toast['tone']) => void;
type StickerItem = { id: string; prompt: string; caption: string };

function stickerId() {
  return 's-' + shortId(String(Date.now()) + Math.random().toString(36));
}

export function StickerPage({
  config,
  servers,
  imageModels,
  preferences,
  notify,
  onChanged,
}: {
  config: Record<string, any>;
  servers: McpServer[];
  imageModels: ImageModel[];
  preferences: StudioPreferences;
  notify: Notify;
  onChanged: () => Promise<void>;
}) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(Number(config.multi_image_count) || 6);
  const [style, setStyle] = useState(String(config.custom_sticker_style?.[0] || config.default_sticker_style?.[0] || '统一手绘'));
  const [medium, setMedium] = useState(chooseMedium(config, {}, String(config.topic_direction || '')));
  const [modelId, setModelId] = useState(preferences.imageModelId || imageModels[0]?.id || '');
  const [items, setItems] = useState<StickerItem[]>([]);
  const [title, setTitle] = useState('');
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mcpWaiting, setMcpWaiting] = useState(false);
  const [batch, setBatch] = useState<any>(null);
  const [directory, setDirectory] = useState('');
  const [outputFiles, setOutputFiles] = useState<any[]>([]);
  const [filesByItem, setFilesByItem] = useState<Record<string, string>>({});
  const mcpAbort = useRef<AbortController | null>(null);
  const imageGenerator = config.image_generator === 'mcp' ? 'mcp' : 'model';
  const mcpServer = servers.find(server => server.id === config.mcp_image_server);
  const mcpReady = Boolean(mcpServer && mcpServer.status === 'ready');

  useEffect(() => () => mcpAbort.current?.abort(), []);

  useEffect(() => {
    if (preferences.imageModelId && imageModels.some(model => model.id === preferences.imageModelId)) {
      setModelId(preferences.imageModelId);
    } else if (!imageModels.some(model => model.id === modelId)) {
      setModelId(imageModels[0]?.id || '');
    }
  }, [imageModels, modelId, preferences.imageModelId]);

  function localPlan() {
    return {
      title: topic || '今日分享',
      style,
      images: Array.from({ length: count }, (_, index) => ({
        id: stickerId(),
        prompt: '统一风格贴图第 ' + (index + 1) + ' 张。主题：' + (topic || '今日分享') + '。风格：' + style + '。媒介：' + medium + '。画面只承载一个清楚的小观点，不要 emoji 和多余英文。',
        caption: '第 ' + (index + 1) + ' 张配文：' + (topic || '今日分享'),
      })),
    };
  }

  async function plan() {
    if (!topic.trim()) {
      notify('请填写贴图主题。', 'warning');
      return;
    }
    setPlanning(true);
    try {
      const prompt = buildStickerPrompt(config, { topic, count });
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
      setTitle(String(value.title || topic));
      setItems(value.images.map((item: any) => ({ id: stickerId(), prompt: String(item.prompt || ''), caption: String(item.caption || '') })));
      setBatch(null);
      setDirectory('');
      setOutputFiles([]);
      setFilesByItem({});
      if (result.finishReason === 'length') notify('方案达到输出上限，请缩短主题或减少图片。', 'warning');
    } catch (error) {
      const fallback = localPlan();
      setTitle(fallback.title);
      setItems(fallback.images);
      setBatch(null);
      setDirectory('');
      setOutputFiles([]);
      setFilesByItem({});
      notify('AI 方案生成失败，已使用本地规划，可逐张修改。' + errorText(error), 'warning');
    } finally {
      setPlanning(false);
    }
  }

  function move(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function waitBatch(id: string) {
    let value = batch;
    for (let index = 0; index < 600; index += 1) {
      value = await api.ai.batch.get({ id });
      setBatch(value);
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
      try {
        await api.workspace.mkdir({ path: dir });
        await api.workspace.mkdir({ path: outputDirectory });
        setMcpWaiting(true);
        const result = await generateImagesThroughMcp({
          api,
          serverId: config.mcp_image_server,
          toolName: config.mcp_image_tool,
          argsTemplate: config.mcp_image_args,
          prompts: items.map(item => item.prompt),
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
        setOutputFiles(output);
        setFilesByItem(mapping);
        await persistPlan(dir, mapping);
        await onChanged();
        const missing = items.length - Object.keys(mapping).length;
        if (result.fatal) {
          notify(result.fatal + ' 已生成的 ' + producedFiles + ' 张贴图保留在 ' + dir + '。', 'danger');
        } else if (result.aborted) {
          notify('已停止等待，已生成 ' + producedFiles + ' 张贴图并保存到 ' + dir + '；后续任务可能仍在 MCP 服务端进行。', 'warning');
        } else if (missing || result.failures.length) {
          notify('贴图方案已保存，仍有 ' + Math.max(0, missing) + ' 张缺失。' + (result.failures[0]?.error ? '首个错误：' + result.failures[0].error : ''), 'warning');
        } else {
          notify('整组贴图已通过 MCP 生成并保存到 ' + dir + '。', 'success');
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
    try {
      let dir = directory;
      let started;
      if (action === 'retry' && batch && dir) {
        const retryable = batch.items.some((item: any) => ['failed', 'save-failed'].includes(item.state));
        if (!retryable) {
          notify('当前批次没有可重试的失败项。结果未知的图片不会自动重发。', 'warning');
          return;
        }
        started = await api.ai.batch.start({
          id: batch.id,
          revision: batch.revision,
          workspacePath: dir + '/imgs',
          retryFailed: true,
        });
      } else {
        const date = new Date();
        const stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
        const slug = (title || topic).replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'stickers';
        dir = 'posts/stickers/' + stamp + '-' + slug + '-' + shortId(String(Date.now()));
        await api.workspace.mkdir({ path: dir });
        await api.workspace.mkdir({ path: dir + '/imgs' });
        const created = await api.ai.batch.create({
          mode: 'generate',
          source: imageModelSource(imageModels, modelId),
          modelId,
          prompt: items[0].prompt,
          items: items.map(item => ({ prompt: item.prompt })),
          concurrency: 2,
        });
        setDirectory(dir);
        started = await api.ai.batch.start({ id: created.id, revision: created.revision, workspacePath: dir + '/imgs' });
      }
      setBatch(started);
      const value = await waitBatch(started.id);
      if (value.state !== 'finished') {
        notify(value.state === 'interrupted' ? '贴图生成被中断，请检查状态后明确重试。' : '贴图生成已结束。', 'warning');
        return;
      }
      const entries = await api.workspace.list({ path: dir + '/imgs', recursive: false });
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
          to: dir + '/imgs/sticker-' + item.id + '.' + extension,
        });
      }
      const output = await api.workspace.list({ path: dir + '/imgs', recursive: false });
      const mapping: Record<string, string> = {};
      for (const item of items) {
        const file = output.find((entry: any) => entry.kind === 'file' && entry.name.startsWith('sticker-' + item.id + '.'));
        if (file) mapping[item.id] = file.path;
      }
      setOutputFiles(output);
      setFilesByItem(mapping);
      await persistPlan(dir, mapping);
      await onChanged();
      const missing = items.length - Object.keys(mapping).length;
      const retryable = value.items.some((item: any) => ['failed', 'save-failed'].includes(item.state));
      const unknown = value.items.some((item: any) => item.state === 'unknown');
      if (missing > 0 || retryable || unknown) {
        notify('贴图方案已保存，仍有 ' + Math.max(0, missing) + ' 张缺失' + (unknown ? '，其中包含结果未知项' : '') + '。请明确选择重试或重新生成。', 'warning');
      } else {
        notify('整组贴图已生成并保存到 ' + dir + '。微信原生图片消息仍需在公众号后台手动发送。', 'success');
      }
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setGenerating(false);
    }
  }

  async function persistPlan(dir = directory, mapping = filesByItem) {
    if (!dir) return;
    const value = {
      title: title || topic,
      style,
      medium,
      count: items.length,
      images: items.map(item => ({
        ...item,
        file: mapping[item.id] ? mapping[item.id].slice(dir.length + 1) : '',
      })),
    };
    await api.workspace.writeText({ path: dir + '/plan.json', text: JSON.stringify(value, null, 2), overwrite: true });
    const markdown = '# ' + value.title + '\n\n' + items.map((item, index) => {
      const image = mapping[item.id]?.slice(dir.length + 1);
      return '## ' + (index + 1) + '\n\n' + (image ? '![' + title + '：第 ' + (index + 1) + ' 张](' + image + ')\n\n' : '') + item.caption + '\n';
    }).join('\n');
    await api.workspace.writeText({ path: dir + '/贴图方案.md', text: markdown, overwrite: true });
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
          <p>1–9 张统一风格和媒介，先确认方案，再逐图配文与批量生成。图片消息仍由公众号后台手动发送。</p>
        </div>
        <Badge tone="neutral">常规图文链路</Badge>
      </header>
      <section className="panel">
        <div className="form-grid form-grid-3">
          <Field label="主题"><input value={topic} onChange={event => setTopic(event.target.value)} placeholder="今天想讲清什么？" /></Field>
          <Field label="图片数量">
            <select value={count} onChange={event => setCount(Number(event.target.value))}>
              {Array.from({ length: 9 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} 张</option>)}
            </select>
          </Field>
          <Field label="统一风格"><input value={style} onChange={event => setStyle(event.target.value)} /></Field>
          <Field label="统一媒介">
            <select value={medium} onChange={event => setMedium(event.target.value)}>
              {IMAGE_MEDIA.map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
        {imageGenerator === 'mcp' ? (
          <Field label="MCP 生图">
            <input readOnly value={(mcpServer?.name || '未选择服务') + ' · ' + (config.mcp_image_tool || '未选择工具')} />
          </Field>
        ) : (
          <Field label="图片模型">
            <select value={modelId} onChange={event => setModelId(event.target.value)}>
              {imageModels.map(model => <option key={model.id} value={model.id}>{imageModelLabel(model)}</option>)}
            </select>
          </Field>
        )}
        </div>
        <div className="toolbar toolbar-end">
          <Button type="button" variant="primary" onClick={() => void plan()} busy={planning}>生成方案与配文</Button>
        </div>
        {imageGenerator === 'mcp' && !mcpReady ? <div className="notice warning">配置中的 MCP 服务当前不可用，请到配置中心重新选择并确认连接状态。</div> : null}
        {imageGenerator === 'mcp' ? <div className="notice info">整组贴图将通过 MCP 工具生成。首次调用会请求你单独授权该工具；工具可能产生费用。</div> : null}
      </section>

      {items.length ? (
        <section className="panel">
          <div className="section-heading">
            <div><h2>{title || topic}</h2><p>{count} 张 · {style} · {medium}</p></div>
            <div className="toolbar">
              <Button type="button" onClick={() => setItems(current => [...current, { id: stickerId(), prompt: '', caption: '' }])} disabled={items.length >= 9 || generating}>加一张</Button>
              <Button type="button" onClick={() => void copyCaptions()}>复制配文</Button>
            </div>
          </div>
          <div className="sticker-plan">
            {items.map((item, index) => (
              <article key={item.id} className="sticker-item">
                <header>
                  <strong>第 {index + 1} 张</strong>
                  <div>
                    <button type="button" onClick={() => move(index, -1)} aria-label="上移" disabled={index === 0 || generating}>↑</button>
                    <button type="button" onClick={() => move(index, 1)} aria-label="下移" disabled={index === items.length - 1 || generating}>↓</button>
                    <button type="button" onClick={() => setItems(current => current.filter(entry => entry.id !== item.id))} aria-label="删除" disabled={generating}>×</button>
                  </div>
                </header>
                <Field label="画面提示词">
                  <textarea value={item.prompt} onChange={event => setItems(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, prompt: event.target.value } : entry))} rows={5} disabled={generating} />
                </Field>
                <Field label="配文">
                  <textarea value={item.caption} onChange={event => setItems(current => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, caption: event.target.value } : entry))} rows={3} disabled={generating} />
                </Field>
              </article>
            ))}
          </div>
          {batch?.items?.length ? (
            <div className="batch-list compact">
              {batch.items.map((item: any) => (
                <div key={item.id}>
                  <strong>{item.name}</strong>
                  <Badge tone={item.state === 'succeeded' ? 'success' : ['failed', 'unknown'].includes(item.state) ? 'danger' : 'neutral'}>{item.state}</Badge>
                  {item.error ? <small>{item.error}{item.taskId ? ' · 任务 ID：' + item.taskId : ''}</small> : null}
                </div>
              ))}
            </div>
          ) : null}
          {batch?.items?.some((item: any) => item.state === 'unknown') ? (
            <div className="notice warning">有图片生成结果未知，不会自动重发。贴图目录的 mcp-generation.json 已记录任务 ID，请先检查后台，确认后再重新生成。</div>
          ) : null}
          {imageGenerator === 'mcp' && batch?.items?.some((item: any) => ['failed', 'save-failed'].includes(item.state)) ? (
            <div className="notice warning">MCP 模式暂不支持只重试失败项；重新生成会再次调用已成功项并可能重复计费。</div>
          ) : null}
          {outputFiles.length ? (
            <div className="output-strip">
              {items.filter(item => filesByItem[item.id]).map((item, index) => (
                <StickerPreview key={item.id} path={filesByItem[item.id]} caption={(index + 1) + '. ' + item.caption} />
              ))}
            </div>
          ) : null}
          <div className="toolbar toolbar-end">
            {imageGenerator === 'model' && batch?.items?.some((item: any) => ['failed', 'save-failed'].includes(item.state)) ? (
              <Button type="button" variant="danger" onClick={() => void generate('retry')} busy={generating}>明确重试失败项</Button>
            ) : null}
            {imageGenerator === 'mcp' && mcpWaiting ? <Button type="button" variant="danger" onClick={() => mcpAbort.current?.abort()}>停止等待</Button> : null}
            <Button type="button" onClick={() => void persistPlan()} disabled={!directory}>仅保存方案</Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void generate('new')}
              busy={generating}
              disabled={imageGenerator === 'model' ? !modelId : (!mcpReady || !config.mcp_image_tool)}
            >
              {batch ? (imageGenerator === 'mcp' ? '重新生成整组（会再次调用成功项）' : '重新生成整组') : '确认方案并批量生成'}
            </Button>
          </div>
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
