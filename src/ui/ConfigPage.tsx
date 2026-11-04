import { useEffect, useMemo, useRef, useState } from 'react';
import { api, csv, errorText, parseCsv } from './client';
import { Badge, Button, Field, Modal } from './common';
import { DEFAULT_CONFIG, deepMerge, serializeConfig, splitSummarySetting, validateConfig } from '../lib/config.mjs';
import { exportBundle, saveBundle } from '../lib/bundle.mjs';
import type { ImageModel, McpServer, McpTool, TextModel, Toast, WechatAccount } from './types';
import { imageModelLabel } from '../lib/image-models.mjs';
import { mcpServerStatusLabel } from '../lib/mcp-images.mjs';
import { normalizeConfigForSave } from '../lib/config.mjs';
import type { StudioPreferences } from './preferences';

type Notify = (text: string, tone?: Toast['tone']) => void;

const STEPS = [
  ['account', '账号与读者'],
  ['strategy', '内容策略'],
  ['writing', '写作规范'],
  ['visual', '视觉呈现'],
  ['publish', '发布设置'],
] as const;

function configDraft(config: Record<string, any>) {
  const base = { ...DEFAULT_CONFIG, ...config };
  const { range, guidance } = splitSummarySetting(base.summary_length);
  return {
    ...base,
    summary_length: range || base.summary_length || '',
    summary_guidance: String(base.summary_guidance ?? '').trim() ? base.summary_guidance : guidance,
  };
}

export function ConfigPage({
  config,
  writingSpec,
  servers,
  accounts,
  textModels,
  imageModels,
  preferences,
  themeSummaries,
  notify,
  onChanged,
  onWorkspace,
}: {
  config: Record<string, any>;
  writingSpec: string;
  servers: McpServer[];
  accounts: WechatAccount[];
  textModels: TextModel[];
  imageModels: ImageModel[];
  preferences: StudioPreferences;
  themeSummaries: any[];
  notify: Notify;
  onChanged: () => Promise<void>;
  onWorkspace: () => Promise<void>;
}) {
  const [step, setStep] = useState<(typeof STEPS)[number][0]>('account');
  const [draft, setDraft] = useState<Record<string, any>>(() => configDraft(config));
  const [spec, setSpec] = useState(writingSpec);
  const [busy, setBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importSource, setImportSource] = useState<{ fileToken?: string } | null>(null);
  const [benchmark, setBenchmark] = useState('');
  const [modelTextId, setModelTextId] = useState('');
  const [modelImageId, setModelImageId] = useState('');
  const [imageMcpTools, setImageMcpTools] = useState<McpTool[]>([]);
  const [imageMcpError, setImageMcpError] = useState('');
  const [accountId, setAccountId] = useState('');
  const [embedsText, setEmbedsText] = useState('');
  const importToken = useRef('');

  useEffect(() => {
    setDraft(configDraft(config));
  }, [config]);
  useEffect(() => setSpec(writingSpec), [writingSpec]);
  useEffect(() => {
    setModelTextId(preferences.textModelId || textModels[0]?.id || '');
    setModelImageId(preferences.imageModelId || imageModels[0]?.id || '');
    setAccountId(preferences.wechatAccountId || accounts[0]?.id || '');
  }, [accounts, imageModels, preferences, textModels]);
  useEffect(() => {
    setEmbedsText(JSON.stringify(draft.embeds || DEFAULT_CONFIG.embeds, null, 2));
  }, [draft.embeds]);
  useEffect(() => {
    const serverId = String(draft.mcp_image_server || '');
    if (!serverId) {
      setImageMcpTools([]);
      setImageMcpError('');
      return;
    }
    let alive = true;
    setImageMcpError('');
    api.mcp.tools({ serverId })
      .then((value: McpTool[]) => {
        if (!alive) return;
        const tools = Array.isArray(value) ? value : [];
        setImageMcpTools(tools);
        setDraft(current => current.mcp_image_tool && !tools.some(tool => tool.name === current.mcp_image_tool)
          ? { ...current, mcp_image_tool: '' }
          : current);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setImageMcpTools([]);
        setImageMcpError(errorText(error));
      });
    return () => { alive = false; };
  }, [draft.mcp_image_server]);

  const validation = useMemo(() => validateConfig(draft), [draft]);
  const selectedMcpTool = imageMcpTools.find(tool => tool.name === draft.mcp_image_tool);

  function update(key: string, value: unknown) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  function updateNested(key: string, child: string, value: unknown) {
    setDraft(current => ({ ...current, [key]: { ...(current[key] || {}), [child]: value } }));
  }

  async function save() {
    if (validation.length) {
      notify(validation[0], 'warning');
      return;
    }
    setBusy(true);
    try {
      const normalized = normalizeConfigForSave(draft);
      let embeds = normalized.embeds;
      try {
        embeds = JSON.parse(embedsText || '{}');
      } catch {
        throw new Error('嵌入配置不是有效的 JSON。');
      }
      if (!embeds || typeof embeds !== 'object' || Array.isArray(embeds)) {
        throw new Error('嵌入配置必须是 JSON 对象。');
      }
      embeds = deepMerge(DEFAULT_CONFIG.embeds, embeds);
      const value = { ...normalized, embeds };
      await api.workspace.writeText({ path: '.aws-article/config.yaml', text: serializeConfig(value), overwrite: true });
      await api.workspace.writeText({ path: '.aws-article/writing-spec.md', text: spec, overwrite: true });
      await Promise.all([
        api.storage.set('text-model-id', modelTextId),
        api.storage.set('image-model-id', modelImageId),
        api.storage.set('wechat-account-id', accountId),
      ]);
      await onChanged();
      notify('配置已保存。未知字段保持原样。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function extractBenchmark() {
    if (!benchmark.trim()) return;
    setBusy(true);
    try {
      const result = await api.ai.complete({
        model: modelTextId || undefined,
        messages: [
          { role: 'system', content: '你是公众号账号策划。只输出 JSON，不要代码围栏。字段：article_category, target_reader, tone, writing_style, paragraph_preference, heading_density, title_style, summary_length, default_structure。default_structure 是字符串数组。' },
          { role: 'user', content: '从以下对标文章提炼账号配置：\n\n' + benchmark.slice(0, 20000) },
        ],
        temperature: 0.2,
        maxTokens: 1800,
        responseFormat: { type: 'json_object' },
      });
      const text = String(result.content || '').replace(/^```(?:json)?|```$/g, '').trim();
      const value = JSON.parse(text);
      const summary = splitSummarySetting(value.summary_length);
      const patch: Record<string, any> = Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && key in DEFAULT_CONFIG));
      if (summary.range) patch.summary_length = summary.range;
      if (summary.guidance && !String(patch.summary_guidance ?? '').trim()) patch.summary_guidance = summary.guidance;
      setDraft(current => ({
        ...current,
        ...patch,
        ...(Array.isArray(value.default_structure) ? { custom_structure: value.default_structure } : {}),
      }));
      notify('已提炼并填入可识别的配置项。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function inferStructure() {
    let article = benchmark.trim();
    if (!article) {
      const drafts = await api.workspace.list({ path: 'drafts', recursive: false }).catch(() => []);
      const recent = (Array.isArray(drafts) ? drafts : [])
        .filter((entry: any) => entry.kind === 'directory')
        .sort((left: any, right: any) => Number(right.mtime || 0) - Number(left.mtime || 0))
        .slice(0, 12);
      for (const entry of recent) {
        article = await api.workspace.readText({ path: entry.path + '/article.md' }).catch(() => '');
        if (!article.trim()) article = await api.workspace.readText({ path: entry.path + '/draft.md' }).catch(() => '');
        if (article.trim()) break;
      }
    }
    if (!article) {
      notify('请先粘贴一篇对标文章，或在工作区 drafts/ 中保存过正文。', 'warning');
      return;
    }
    setBusy(true);
    try {
      const result = await api.ai.complete({
        model: modelTextId || undefined,
        messages: [
          {
            role: 'system',
            content: '你是公众号结构编辑。分析文章的组织方式，只输出 JSON：{"structures":[{"name":"结构名","outline":["第一段职责","第二段职责"]}]}。给 1–3 个可复用结构，不要照抄标题，不要输出代码围栏。',
          },
          { role: 'user', content: article.slice(0, 24000) },
        ],
        temperature: 0.2,
        maxTokens: 1400,
        responseFormat: { type: 'json_object' },
      });
      const text = String(result.content || '').replace(/^```(?:json)?|```$/g, '').trim();
      const value = JSON.parse(text);
      const structures = Array.isArray(value.structures)
        ? value.structures.map((item: any) => {
          const name = String(item?.name || '文章结构').trim();
          const outline = Array.isArray(item?.outline) ? item.outline.map(String).map((item: string) => item.trim()).filter(Boolean) : [];
          return name + (outline.length ? '：' + outline.join(' → ') : '');
        }).filter(Boolean)
        : [];
      if (!structures.length) throw new Error('没有推导出可用的文章结构。');
      update('custom_structure', structures.slice(0, 3));
      notify(result.finishReason === 'length' ? '结构已达到输出上限，已保留可识别部分。' : '已从文章推导结构，保存配置后生效。', result.finishReason === 'length' ? 'warning' : 'success');
    } catch (error) {
      const headings = String(article).match(/^#{2,4}\s+(.+)$/gm)?.map(item => item.replace(/^#{2,4}\s+/, '').trim()).filter(Boolean) || [];
      if (!headings.length) {
        notify(errorText(error), 'danger');
        return;
      }
      update('custom_structure', ['文章结构：标题 → 导语 → ' + headings.join(' → ')]);
      notify('AI 推导失败，已按现有小标题生成结构；请人工核对。' + errorText(error), 'warning');
    } finally {
      setBusy(false);
    }
  }

  async function previewImport(source: { fileToken?: string }) {
    setBusy(true);
    try {
      const value = await api.workspace.importBundle({ ...source, dryRun: true });
      setImportPreview(value);
      setImportSource(source);
    } catch (error) {
      if (source.fileToken) await api.files.release(source.fileToken).catch(() => {});
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  function closeImport() {
    if (importSource?.fileToken) void api.files.release(importSource.fileToken).catch(() => {});
    setImportPreview(null);
    setImportSource(null);
    importToken.current = '';
  }

  async function applyImport() {
    if (!importSource) return;
    setBusy(true);
    try {
      await api.workspace.importBundle({ ...importSource, dryRun: false, confirmSecrets: true });
      if (importSource.fileToken) await api.files.release(importSource.fileToken).catch(() => {});
      setImportPreview(null);
      setImportSource(null);
      importToken.current = '';
      await onChanged();
      notify('预设包已导入。已有 config.yaml 保持原样。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function chooseBundle() {
    try {
      const file = await api.files.pick({ extensions: ['aws', 'zip'] });
      if (!file) return;
      importToken.current = file.token;
      await previewImport({ fileToken: file.token });
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  async function exportConfig() {
    setBusy(true);
    try {
      const value = await exportBundle(api);
      const saved = await saveBundle(api, value);
      if (saved) notify('预设包已导出，已自动剔除全部密钥和模型端点。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page config-page">
      <header className="page-header">
        <div>
          <h1>配置中心</h1>
          <p>五步配置严格沿用上游字段。优先级：article.yaml &gt; custom_* &gt; default_*。</p>
        </div>
        <div className="toolbar">
          <Button type="button" onClick={() => void chooseBundle()}>导入 .aws</Button>
          <Button type="button" onClick={() => void exportConfig()} busy={busy}>导出 .aws</Button>
          <Button type="button" variant="primary" onClick={() => void save()} busy={busy}>保存配置</Button>
        </div>
      </header>

      <div className="config-layout">
        <nav className="config-steps" aria-label="配置步骤">
          {STEPS.map(([id, label], index) => (
            <button type="button" key={id} className={step === id ? 'active' : ''} onClick={() => setStep(id)}>
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </button>
          ))}
          <button type="button" onClick={() => void onWorkspace()} className="workspace-link">工作文件夹</button>
        </nav>

        <section className="config-panel">
          {step === 'account' ? (
            <ConfigSection title="账号与读者" description="这些信息会进入选题、写作和审稿提示词。">
              <div className="form-grid">
                <Field label="账号类型 / 领域"><input value={draft.article_category || ''} onChange={event => update('article_category', event.target.value)} placeholder="例如：AI 工具与效率" /></Field>
                <Field label="目标读者"><input value={draft.target_reader || ''} onChange={event => update('target_reader', event.target.value)} placeholder="例如：独立开发者、内容运营" /></Field>
                <Field label="语气调性">
                  <select value={draft.tone || '口语化'} onChange={event => update('tone', event.target.value)}>
                    {['口语化', '轻松幽默', '专业克制', '正式严谨', '温暖陪伴'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="默认作者"><input value={draft.default_author || ''} onChange={event => update('default_author', event.target.value)} /></Field>
                <Field label="更新频率"><input value={draft.update_frequency || ''} onChange={event => update('update_frequency', event.target.value)} placeholder="例如：每周二、周四" /></Field>
              </div>
              <Field label="对标文章提炼" hint="粘贴一篇或多篇对标文章，提炼账号定位、语气、结构与标题风格。">
                <textarea value={benchmark} onChange={event => setBenchmark(event.target.value)} rows={10} />
              </Field>
              <div className="toolbar toolbar-end">
                <Button type="button" onClick={() => void extractBenchmark()} busy={busy}>提炼为配置</Button>
              </div>
            </ConfigSection>
          ) : step === 'strategy' ? (
            <ConfigSection title="内容策略" description="选题方向、标题、摘要和文章结构按本篇可覆盖。">
              <div className="form-grid">
                <Field label="选题方向"><input value={draft.topic_direction || ''} onChange={event => update('topic_direction', event.target.value)} /></Field>
                <Field label="标题风格">
                  <select value={draft.title_style || '干货型'} onChange={event => update('title_style', event.target.value)}>
                    {['干货型', '故事型', '观点型', '悬念型', '清单型', '对话型'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="标题长度上限"><input type="number" min={1} max={80} value={draft.title_max_length || 25} onChange={event => update('title_max_length', Number(event.target.value))} /></Field>
                <Field label="摘要字数范围"><input value={draft.summary_length || '80-128'} onChange={event => update('summary_length', event.target.value)} placeholder="80-128" /></Field>
                <Field label="摘要写法" hint="会进入选题/写作提示词。"><input value={draft.summary_guidance || ''} onChange={event => update('summary_guidance', event.target.value)} placeholder="例如：2-3句；先给事件由头，再抛出反常识问题" /></Field>
                <Field label="标题禁用词"><input value={csv(draft.forbidden_title_phrases)} onChange={event => update('forbidden_title_phrases', parseCsv(event.target.value))} placeholder="用顿号或逗号分隔" /></Field>
              </div>
              <Field label="文章结构候选池" hint="每行一个结构。写作时本篇会收敛为单元素列表。">
                <textarea className="lines-input" value={(draft.custom_structure || []).join('\n')} onChange={event => update('custom_structure', event.target.value.split('\n').map(item => item.trim()).filter(Boolean))} rows={8} />
              </Field>
              <div className="toolbar">
                <Button type="button" onClick={() => void inferStructure()}>从已有文章推导结构</Button>
              </div>
            </ConfigSection>
          ) : step === 'writing' ? (
            <ConfigSection title="写作规范" description="共享文本模型只保存模型 ID，不保存任何密钥。">
              <div className="form-grid form-grid-3">
                <Field label="写作风格">
                  <select value={draft.writing_style || '口语化'} onChange={event => update('writing_style', event.target.value)}>
                    {['口语化', '故事化', '专业分析', '清单式', '访谈式'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="段落偏好">
                  <select value={draft.paragraph_preference || '短段为主'} onChange={event => update('paragraph_preference', event.target.value)}>
                    {['短段为主', '自然段为主', '一句一段', '列表与段落混合'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="标题密度">
                  <select value={draft.heading_density || '每节必有小标题'} onChange={event => update('heading_density', event.target.value)}>
                    {['每节必有小标题', '少量小标题', '只用自然段'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="目标字数"><input value={draft.target_word_count || '1800-2500'} onChange={event => update('target_word_count', event.target.value)} /></Field>
                <Field label="原创标注"><input value={draft.original_attribution || ''} onChange={event => update('original_attribution', event.target.value)} placeholder="仅作为发布元数据，不写入正文" /></Field>
                <Field label="共享文本模型">
                  <select value={modelTextId} onChange={event => setModelTextId(event.target.value)}>
                    {textModels.map(model => <option key={model.id} value={model.id}>{model.title}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="禁用词"><input value={csv(draft.forbidden_words)} onChange={event => update('forbidden_words', parseCsv(event.target.value))} /></Field>
              <fieldset className="checks">
                <legend>审稿规则</legend>
                {['敏感词', '错别字', '链接', '原创标注', '写作规范', 'AI 味'].map(item => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={(draft.review_required || []).includes(item)}
                      onChange={event => {
                        const values = new Set(draft.review_required || []);
                        event.target.checked ? values.add(item) : values.delete(item);
                        update('review_required', [...values]);
                      }}
                    />
                    {item}
                  </label>
                ))}
              </fieldset>
              <Field label="writing-spec.md" hint="会覆盖工作区 .aws-article/writing-spec.md。">
                <textarea className="article-input" value={spec} onChange={event => setSpec(event.target.value)} rows={18} spellCheck={false} />
              </Field>
            </ConfigSection>
          ) : step === 'visual' ? (
            <ConfigSection title="视觉呈现" description="8 套主题 × 3 套配色；图片可来自底座共享模型，也可调用经授权的 MCP 生图工具。">
              <div className="form-grid form-grid-3">
                <Field label="排版主题">
                  <select
                    value={draft.custom_format_preset?.[0] || draft.default_format_preset?.[0] || '亲和'}
                    onChange={event => {
                      update('custom_format_preset', [event.target.value]);
                      const theme = themeSummaries.find((item: any) => item.name === event.target.value);
                      if (theme?.defaultScheme) update('custom_format_scheme', [theme.defaultScheme]);
                    }}
                  >
                    {themeSummaries.map((theme: any) => <option key={theme.name} value={theme.name}>{theme.name}</option>)}
                  </select>
                </Field>
                <Field label="主题配色">
                  <select
                    value={draft.custom_format_scheme?.[0] || draft.default_format_scheme?.[0] || ''}
                    onChange={event => update('custom_format_scheme', event.target.value ? [event.target.value] : [])}
                  >
                    {(themeSummaries.find((theme: any) => theme.name === (draft.custom_format_preset?.[0] || draft.default_format_preset?.[0] || '亲和'))?.schemes || []).map((scheme: any) => (
                      <option key={scheme.name} value={scheme.name}>{scheme.name} · {scheme.color}</option>
                    ))}
                  </select>
                </Field>
                <Field label="封面比例">
                  <select value={draft.cover_aspect || '2.35:1'} onChange={event => update('cover_aspect', event.target.value)}>
                    {['2.35:1', '16:9', '1:1', '1.91:1'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="封面形态"><input value={csv(draft.custom_cover_image_style)} onChange={event => update('custom_cover_image_style', parseCsv(event.target.value))} placeholder="留空则由文章内容自动选择" /></Field>
                <Field label="正文配图形态"><input value={csv(draft.custom_article_image_style)} onChange={event => update('custom_article_image_style', parseCsv(event.target.value))} /></Field>
                <Field label="贴图形态"><input value={csv(draft.custom_sticker_style)} onChange={event => update('custom_sticker_style', parseCsv(event.target.value))} /></Field>
                <Field label="配图密度">
                  <select value={draft.image_density || '每节一图'} onChange={event => update('image_density', event.target.value)}>
                    {['每节一图', '按需配图', '少图', '多图'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="图注规则">
                  <select value={draft.caption_style || '有图注'} onChange={event => update('caption_style', event.target.value)}>
                    {['有图注', '无图注', '关键图有'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="多图数量"><input type="number" min={1} max={9} value={draft.multi_image_count || 6} onChange={event => update('multi_image_count', Number(event.target.value))} /></Field>
                <Field label="生图方式">
                  <select value={draft.image_generator === 'mcp' ? 'mcp' : 'model'} onChange={event => update('image_generator', event.target.value)}>
                    <option value="model">共享 AI 图片模型</option>
                    <option value="mcp">MCP 生图工具</option>
                  </select>
                </Field>
                {draft.image_generator === 'mcp' ? (
                  <Field label="MCP 服务">
                    <select
                      value={draft.mcp_image_server || ''}
                      onChange={event => {
                        update('mcp_image_server', event.target.value);
                        update('mcp_image_tool', '');
                      }}
                    >
                      <option value="">选择 MCP 服务</option>
                      {servers.map(server => <option key={server.id} value={server.id}>{server.name} · {mcpServerStatusLabel(server.status)}</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label="共享图片模型">
                    <select value={modelImageId} onChange={event => setModelImageId(event.target.value)}>
                      {imageModels.map(model => <option key={model.id} value={model.id}>{imageModelLabel(model)}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="图片来源">
                  <select value={draft.image_source || 'generated'} onChange={event => update('image_source', event.target.value)}>
                    <option value="generated">AI 生成（模型或 MCP）</option>
                    <option value="user">使用我提供的图片</option>
                  </select>
                </Field>
              </div>
              {draft.image_generator === 'mcp' ? (
                <>
                  <Field label="生图工具" hint="首次调用时轻作会要求你单独授权该工具；生图工具可能产生费用或修改外部数据。">
                    <select value={draft.mcp_image_tool || ''} onChange={event => update('mcp_image_tool', event.target.value)} disabled={!draft.mcp_image_server}>
                      <option value="">{draft.mcp_image_server ? '选择生图工具' : '请先选择 MCP 服务'}</option>
                      {imageMcpTools.map(tool => (
                        <option key={tool.name} value={tool.name}>
                          {tool.title || tool.name}{tool.readOnly ? ' · 服务声明只读' : ' · 会执行操作'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="工具参数模板" hint="JSON 对象，可填 {{prompt}}、{{size}}、{{count}} 占位符；模型名等工具参数直接写在模板里。">
                    <textarea className="code-input" value={draft.mcp_image_args || ''} onChange={event => update('mcp_image_args', event.target.value)} rows={6} spellCheck={false} />
                  </Field>
                  {selectedMcpTool?.description ? <div className="notice info"><strong>工具说明</strong><p>{selectedMcpTool.description}</p></div> : null}
                  {!servers.length ? <div className="notice warning">尚未配置 MCP 服务。请先在「设置 → 能力连接」添加并测试生图服务。</div> : null}
                  {draft.mcp_image_server && !imageMcpTools.length ? <div className="notice warning">{imageMcpError ? '读取工具失败：' + imageMcpError : '没有读取到该服务的工具。请检查服务状态，或升级到支持调用 MCP 工具的轻作版本。'}</div> : null}
                </>
              ) : null}
              <div className="theme-preview-grid">
                {themeSummaries.map((theme: any) => (
                  <button
                    type="button"
                    key={theme.name}
                    className={'theme-chip' + ((draft.custom_format_preset?.[0] || draft.default_format_preset?.[0]) === theme.name ? ' active' : '')}
                    onClick={() => update('custom_format_preset', [theme.name])}
                  >
                    <span style={{ background: theme.schemes[0]?.color || '#28654a' }} />
                    <strong>{theme.name}</strong>
                    <small>{theme.description}</small>
                  </button>
                ))}
              </div>
            </ConfigSection>
          ) : (
            <ConfigSection title="发布设置" description="公众号账号和 MCP 工具由宿主提供，插件不读取 URL 或令牌。">
              <div className="form-grid">
                <Field label="敏感词"><input value={csv(draft.custom_sensitive_words)} onChange={event => update('custom_sensitive_words', parseCsv(event.target.value))} /></Field>
                <Field label="审稿输出">
                  <select value={draft.review_output_format || '分块详细'} onChange={event => update('review_output_format', event.target.value)}>
                    {['分块详细', '精简清单', '仅阻断项'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="公众号账号">
                  <select value={accountId} onChange={event => setAccountId(event.target.value)}>
                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.appIdMasked}</option>)}
                  </select>
                </Field>
                <Field label="默认发布方式">
                  <select value={draft.publish_method || 'draft'} onChange={event => update('publish_method', event.target.value)}>
                    <option value="draft">仅创建草稿</option>
                    <option value="published">提交直接发布</option>
                    <option value="none">只保存到本地</option>
                  </select>
                </Field>
                <Field label="评论设置">
                  <select value={draft.need_open_comment ? 'open' : 'closed'} onChange={event => update('need_open_comment', event.target.value === 'open' ? 1 : 0)}>
                    <option value="open">允许评论</option>
                    <option value="closed">关闭评论</option>
                  </select>
                </Field>
                <Field label="仅粉丝可评论">
                  <select value={draft.only_fans_can_comment ? 'yes' : 'no'} onChange={event => update('only_fans_can_comment', event.target.value === 'yes' ? 1 : 0)}>
                    <option value="no">所有人可评论</option>
                    <option value="yes">仅粉丝可评论</option>
                  </select>
                </Field>
                <Field label="草稿目录"><input value={draft.drafts_root || 'drafts/'} onChange={event => update('drafts_root', event.target.value)} /></Field>
                <Field label="归档目录"><input value={draft.published_root || 'posts/published/'} onChange={event => update('published_root', event.target.value)} /></Field>
              </div>
              <McpPreferences servers={servers} notify={notify} />
              <Field label="公众号名片、小程序与往期文章嵌入" hint="JSON 对象，字段沿用上游 embeds：profiles、miniprograms、miniprogram_cards、related_articles。">
                <textarea className="code-input" value={embedsText} onChange={event => setEmbedsText(event.target.value)} rows={14} spellCheck={false} />
              </Field>
            </ConfigSection>
          )}

          {validation.length ? <div className="notice warning">{validation.map(item => <p key={item}>{item}</p>)}</div> : null}
          <div className="config-savebar">
            <span>{step === 'publish' ? '最后一步' : '配置会写入 .aws-article/config.yaml'}</span>
            <Button type="button" variant="primary" onClick={() => void save()} busy={busy}>保存全部配置</Button>
          </div>
        </section>
      </div>

      {importPreview ? (
        <Modal
          title="预览预设包"
          onClose={() => {
            closeImport();
          }}
          footer={
            <>
              <Button type="button" onClick={closeImport}>取消</Button>
              <Button type="button" variant="primary" onClick={() => void applyImport()} busy={busy}>确认导入</Button>
            </>
          }
        >
          <ImportPreview value={importPreview} />
        </Modal>
      ) : null}
    </div>
  );
}

function ConfigSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="section-heading">
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      <div className="config-fields">{children}</div>
    </section>
  );
}

function McpPreferences({ servers, notify }: { servers: McpServer[]; notify: Notify }) {
  const [serverId, setServerId] = useState(servers[0]?.id || '');
  const [tools, setTools] = useState<McpTool[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<any[]>([]);

  useEffect(() => {
    void api.storage.get('mcp-tools').then((value: unknown) => setSaved(Array.isArray(value) ? value : []));
  }, []);
  useEffect(() => {
    if (!serverId && servers[0]) setServerId(servers[0].id);
  }, [serverId, servers]);
  useEffect(() => {
    if (!serverId) return;
    api.mcp.tools({ serverId })
      .then((value: McpTool[]) => setTools(Array.isArray(value) ? value.filter(item => item.readOnly) : []))
      .catch((error: unknown) => notify(errorText(error), 'danger'));
  }, [serverId, notify]);

  async function savePreferences() {
    const server = servers.find(item => item.id === serverId);
    const next = [
      ...saved.filter(item => item.serverId !== serverId),
      ...(selected.length && server ? [{ serverId, serverName: server.name, toolNames: selected }] : []),
    ];
    await api.storage.set('mcp-tools', next);
    setSaved(next);
    notify('MCP 工具偏好已保存。调用时仍需逐次授权。', 'success');
  }

  return (
    <section className="panel-inset">
      <div className="section-heading">
        <div><h3>MCP 搜索与网页读取</h3><p>只列出带只读注解的工具。插件看不到服务器 URL、鉴权头或令牌。</p></div>
      </div>
      {!servers.length ? <div className="inline-empty">尚未配置 MCP 服务。</div> : (
        <>
          <div className="form-grid">
            <Field label="MCP 服务">
              <select value={serverId} onChange={event => { setServerId(event.target.value); setSelected([]); }}>
                {servers.map(server => <option key={server.id} value={server.id}>{server.name} · {server.status}</option>)}
              </select>
            </Field>
          </div>
          <div className="check-grid">
            {tools.map(tool => (
              <label key={tool.name}>
                <input
                  type="checkbox"
                  checked={selected.includes(tool.name)}
                  onChange={event => {
                    const values = new Set(selected);
                    event.target.checked ? values.add(tool.name) : values.delete(tool.name);
                    setSelected([...values]);
                  }}
                />
                <span><strong>{tool.title || tool.name}</strong><small>{tool.description || tool.name}</small></span>
              </label>
            ))}
          </div>
          <Button type="button" onClick={() => void savePreferences()}>保存工具偏好</Button>
        </>
      )}
    </section>
  );
}

function ImportPreview({ value }: { value: any }) {
  return (
    <div className="import-preview">
      <div className="preview-summary">
        <Badge tone="accent">{value.presets.length} 组预设</Badge>
        <Badge tone={value.config.action === 'preserve-local' ? 'warning' : 'success'}>
          {value.config.action === 'preserve-local' ? '保留本地 config.yaml' : '将写入 config.yaml'}
        </Badge>
        <Badge tone="neutral">写作规范：{value.writingSpec === 'replace' ? '覆盖' : '新增'}</Badge>
      </div>
      <h3>预设替换项</h3>
      {value.presets.length ? (
        <ul>{value.presets.map((item: any) => <li key={item.path}><strong>{item.path}</strong> · {item.action === 'replace' ? '替换' : '新增'} · {item.files.length} 个文件</li>)}</ul>
      ) : <p>无</p>}
      <h3>配置差异</h3>
      <p>新增 {value.config.added.length} 项，变化 {value.config.changed.length} 项。已有 config.yaml 永远不会被覆盖。</p>
      {value.accounts.length ? <><h3>公众号账号</h3><ul>{value.accounts.map((item: any) => <li key={item.appIdMasked}>{item.name} · {item.appIdMasked} · {item.action}</li>)}</ul></> : null}
      {value.ignored.length ? <><h3>忽略项</h3><p>{value.ignored.join('、')}</p></> : null}
      {value.warnings.length ? <div className="notice warning">{value.warnings.map((item: string) => <p key={item}>{item}</p>)}</div> : null}
    </div>
  );
}
