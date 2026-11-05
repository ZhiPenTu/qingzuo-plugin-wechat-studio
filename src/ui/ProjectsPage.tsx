import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, isMissingError, readOptional, shortId } from './client';
import { Badge, Button, CopyButton, Empty, Field, Modal, Tabs } from './common';
import { callWorker } from './worker-client';
import { McpPanel } from './McpPanel';
import { buildReviewPrompt, buildTopicPrompt, buildWritingPrompt } from '../lib/prompts.mjs';
import { checkDraft, extractBoldOutline, stripCitations } from '../lib/writing.mjs';
import {
  aiReviewSupplement,
  formatReviewMarkdown,
  mergeReviewMarkdown,
  reviewArticle,
} from '../lib/review.mjs';
import { buildPublicationGate, hasSavedCover, reviewIssueStage } from '../lib/publication.mjs';
import {
  BODY_STYLES,
  COVER_STYLES,
  IMAGE_MEDIA,
  chooseMedium,
  mapGeneratedFiles,
  planImages,
  rewriteCoverImageMarker,
  rewriteImageMarkersWithMapping,
} from '../lib/images.mjs';
import { compressBodyImageBytes, cropImageBytes, base64Bytes, bytesBase64 } from '../lib/crop.mjs';
import { imageModelLabel, imageModelSource } from '../lib/image-models.mjs';
import { mappingForPlan, parseGeneratedMapping, projectImagePreviews } from '../lib/image-previews.mjs';
import { generateImagesThroughMcp, mcpBatchToken, mcpCoverSize } from '../lib/mcp-images.mjs';
import { resolveFormatOptions } from '../lib/config.mjs';
import {
  appendLog,
  loadProject,
  nextStage,
  previousStage,
  saveArticle,
  saveStage,
  stageProgress,
} from '../lib/project.mjs';
import type {
  ArticleProject,
  ImageModel,
  McpServer,
  ProjectSummary,
  TextModel,
  Toast,
  WechatAccount,
} from './types';
import type { StudioPreferences } from './preferences';

type Notify = (text: string, tone?: Toast['tone']) => void;
type PreviewImage = { path: string; title: string; kind: 'cover' | 'body' };
type ImageTarget = { kind: 'cover' } | { kind: 'body'; index: number };
type ImageTargetStatus = { state: string; error?: string | null; taskId?: string | null };

function imageTargetKey(target: ImageTarget) {
  return target.kind === 'cover' ? 'cover' : 'body:' + target.index;
}

const STAGE_LABELS: Record<string, string> = {
  topic: '选题', research: '调研', writing: '写稿', review: '内容审',
  format: '排版', images: '配图', final: '终审', publish: '草稿/发布',
};

export function ProjectsPage({
  project,
  projects,
  config,
  servers,
  accounts,
  textModels,
  imageModels,
  preferences,
  themeSummaries,
  notify,
  onOpen,
  onClose,
  onReload,
  onChanged,
  onGoConfig,
}: {
  project: ArticleProject | null;
  projects: ProjectSummary[];
  config: Record<string, any>;
  servers: McpServer[];
  accounts: WechatAccount[];
  textModels: TextModel[];
  imageModels: ImageModel[];
  preferences: StudioPreferences;
  themeSummaries: any[];
  notify: Notify;
  onOpen: (directory: string) => void;
  onClose: () => void;
  onReload: () => Promise<void>;
  onChanged: () => Promise<void>;
  onGoConfig: () => void;
}) {
  if (!project) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>文章项目</h1>
            <p>每个项目对应 drafts/ 下的一个目录，外部修改后可以重新加载。</p>
          </div>
          <Button type="button" onClick={() => void onReload()}>刷新</Button>
        </header>
        {projects.length ? (
          <div className="project-grid">
            {projects.map(item => (
              <button type="button" className="project-card" key={item.directory} onClick={() => onOpen(item.directory)}>
                <span className="project-card-top">
                  <Badge tone={item.stage === 'publish' ? 'success' : 'accent'}>{STAGE_LABELS[item.stage] || item.stage}</Badge>
                  <small>{formatTime(item.updatedAt)}</small>
                </span>
                <strong>{item.title}</strong>
                <code>{item.directory}</code>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="还没有文章项目" description="从创作工作台新建或继续一篇草稿。" />
        )}
      </div>
    );
  }
  return (
    <ProjectWorkspace
      project={project}
      config={config}
      servers={servers}
      accounts={accounts}
      textModels={textModels}
      imageModels={imageModels}
      preferences={preferences}
      themeSummaries={themeSummaries}
      notify={notify}
      onClose={onClose}
      onReload={onReload}
      onChanged={onChanged}
      onGoConfig={onGoConfig}
    />
  );
}

function ProjectWorkspace({
  project,
  config,
  servers,
  accounts,
  textModels,
  imageModels,
  preferences,
  themeSummaries,
  notify,
  onClose,
  onReload,
  onChanged,
  onGoConfig,
}: {
  project: ArticleProject;
  config: Record<string, any>;
  servers: McpServer[];
  accounts: WechatAccount[];
  textModels: TextModel[];
  imageModels: ImageModel[];
  preferences: StudioPreferences;
  themeSummaries: any[];
  notify: Notify;
  onClose: () => void;
  onReload: () => Promise<void>;
  onChanged: () => Promise<void>;
  onGoConfig: () => void;
}) {
  const [active, setActive] = useState(project.stage.id);
  useEffect(() => {
    setActive(project.stage.id);
  }, [project.directory, project.stage.id]);

  const progress = stageProgress(project.pipeline);
  const wordCount = checkDraft(project.files.writing || project.files.format || '', config).metrics.words;

  async function advance(stage: string, options: { next?: boolean } = {}) {
    try {
      await saveStage(api, project.directory, stage, undefined, options);
      await onChanged();
      await onReload();
      const target = options.next === false ? stage : nextStage(stage);
      setActive(target);
      notify('已保存「' + STAGE_LABELS[stage] + '」。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  function focusMeta(field: 'title' | 'author' | 'digest') {
    const target = document.querySelector<HTMLElement>('[data-meta-field="' + field + '"]');
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => target.focus(), 250);
  }

  return (
    <div className="page project-page">
      <header className="page-header project-header">
        <div>
          <button type="button" className="back-link" onClick={onClose}>← 所有项目</button>
          <h1>{String(project.article.title || '未命名文章')}</h1>
          <p><code>{project.directory}</code> · 约 {wordCount} 字</p>
        </div>
        <div className="toolbar">
          <Button type="button" onClick={() => void onReload()}>重新加载</Button>
          <Button type="button" variant="ghost" onClick={onGoConfig}>写作配置</Button>
        </div>
      </header>

      <div className="stage-rail" aria-label="创作阶段">
        {progress.map((stage, index) => (
          <button
            type="button"
            key={stage.id}
            className={['stage-step', stage.current ? 'current' : '', stage.completed ? 'completed' : '', active === stage.id ? 'viewing' : ''].filter(Boolean).join(' ')}
            onClick={() => setActive(stage.id)}
          >
            <span>{stage.completed ? '✓' : index + 1}</span>
            <strong>{stage.label}</strong>
          </button>
        ))}
      </div>

      <div className="project-layout">
        <section className="stage-workspace">
          {active === 'topic' ? (
            <TopicStage project={project} config={config} servers={servers} modelId={preferences.textModelId} notify={notify} onSaved={() => void advance('topic', { next: false })} onNext={() => void advance('topic')} />
          ) : active === 'research' ? (
            <ResearchStage project={project} config={config} servers={servers} modelId={preferences.textModelId} notify={notify} onSaved={() => void advance('research', { next: false })} onNext={() => void advance('research')} />
          ) : active === 'writing' ? (
            <WritingStage project={project} config={config} modelId={preferences.textModelId} notify={notify} onSaved={() => void advance('writing', { next: false })} onNext={() => void advance('writing')} />
          ) : active === 'review' ? (
            <ReviewStage project={project} config={config} modelId={preferences.textModelId} notify={notify} onSaved={() => void advance('review', { next: false })} onNext={() => void advance('review')} />
          ) : active === 'format' ? (
            <FormatStage project={project} config={config} themeSummaries={themeSummaries} notify={notify} onSaved={() => void advance('format', { next: false })} onNext={() => void advance('format')} />
          ) : active === 'images' ? (
            <ImagesStage key={project.directory} project={project} config={config} servers={servers} imageModels={imageModels} modelId={preferences.imageModelId} notify={notify} onSaved={() => void advance('images', { next: false })} onNext={() => void advance('images')} onReload={onReload} />
          ) : active === 'final' ? (
            <FinalStage
              project={project}
              config={config}
              accounts={accounts}
              notify={notify}
              onSaved={() => void advance('final', { next: false })}
              onNext={() => void advance('final')}
              onGoStage={setActive}
              onEditMeta={focusMeta}
              onGoConfig={onGoConfig}
            />
          ) : (
            <PublishStage project={project} config={config} accounts={accounts} accountId={preferences.wechatAccountId} notify={notify} onSaved={() => void advance('publish', { next: false })} />
          )}
        </section>

        <aside className="project-aside">
          <section>
            <span className="eyebrow">本篇元数据</span>
            <MetaEditor project={project} notify={notify} onChanged={onChanged} onReload={onReload} />
          </section>
          <section>
            <span className="eyebrow">文件事实源</span>
            <ul className="file-facts">
              {['article.yaml', 'topic-card.md', 'research.md', 'draft.md', 'review.md', 'article.md', 'article.html', 'stage-log.md'].map(file => (
                <li key={file}>
                  <span>{file}</span>
                  <Badge tone={project.entries.some(entry => entry.path === project.directory + '/' + file) ? 'success' : 'neutral'}>
                    {project.entries.some(entry => entry.path === project.directory + '/' + file) ? '已保存' : '待生成'}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
          <NavActions active={active} onBack={() => setActive(previousStage(active))} onNext={() => setActive(nextStage(active))} />
        </aside>
      </div>
    </div>
  );
}

function NavActions({ active, onBack, onNext }: { active: string; onBack: () => void; onNext: () => void }) {
  return (
    <section className="aside-nav">
      <Button type="button" onClick={onBack} disabled={active === 'topic'}>上一步</Button>
      <Button type="button" onClick={onNext} disabled={active === 'publish'}>查看下一步</Button>
    </section>
  );
}

function MetaEditor({
  project, notify, onChanged, onReload,
}: {
  project: ArticleProject; notify: Notify; onChanged: () => Promise<void>; onReload: () => Promise<void>;
}) {
  const [title, setTitle] = useState(String(project.article.title || ''));
  const [author, setAuthor] = useState(String(project.article.author || ''));
  const [digest, setDigest] = useState(String(project.article.digest || ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTitle(String(project.article.title || ''));
    setAuthor(String(project.article.author || ''));
    setDigest(String(project.article.digest || ''));
  }, [project.directory, project.article.title, project.article.author, project.article.digest]);
  async function save() {
    setBusy(true);
    try {
      await saveArticle(api, project.directory, { title, author, digest });
      await onChanged();
      await onReload();
      notify('文章元数据已保存。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="meta-form">
      <Field label="标题"><input data-meta-field="title" value={title} maxLength={64} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label="作者"><input data-meta-field="author" value={author} maxLength={32} onChange={event => setAuthor(event.target.value)} /></Field>
      <Field label="摘要" hint="最多 120 字，显示在分享卡片和列表页。">
        <textarea data-meta-field="digest" value={digest} maxLength={120} rows={3} onChange={event => setDigest(event.target.value)} />
      </Field>
      <Button type="button" variant="primary" onClick={() => void save()} busy={busy}>保存元数据</Button>
    </div>
  );
}

function StageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="section-heading stage-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      {children}
    </div>
  );
}

function ResultEditor({ value, onChange, rows = 14, label = '生成结果' }: { value: string; onChange: (value: string) => void; rows?: number; label?: string }) {
  return (
    <Field label={label} hint="先预览或编辑，再确认写入工作区文件。">
      <textarea className="article-input" value={value} onChange={event => onChange(event.target.value)} rows={rows} spellCheck={false} />
    </Field>
  );
}

function isTimeoutError(error: unknown) {
  return /timeout|timed out|operation was aborted|超时|AbortError/i.test(errorText(error))
    || ['TimeoutError', 'AbortError'].includes(String((error as any)?.name || ''));
}

async function completeTextResult(system: string, user: string, modelId: string, maxTokens: number) {
  const result = await api.ai.complete({
    model: modelId || undefined,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.7,
    maxTokens,
  });
  return {
    content: String(result.content || ''),
    truncated: result.finishReason === 'length' || result.finishReason === 'max_tokens',
  };
}

async function completeText(system: string, user: string, modelId: string, maxTokens: number, notify: Notify) {
  const result = await completeTextResult(system, user, modelId, maxTokens);
  if (result.truncated) {
    notify('模型输出达到长度上限。可以继续生成、缩短要求，或分段补全。', 'warning');
  }
  return result.content;
}

function TopicStage({
  project, config, servers, modelId, notify, onSaved, onNext,
}: {
  project: ArticleProject; config: Record<string, any>; servers: McpServer[]; modelId: string; notify: Notify;
  onSaved: () => void; onNext: () => void;
}) {
  const [value, setValue] = useState(project.files.topic || '');
  const [notes, setNotes] = useState('');
  const [topic, setTopic] = useState(String(project.pipeline.source || project.article.title || ''));
  const [series, setSeries] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(project.files.topic || ''), [project.directory, project.files.topic]);

  async function generate() {
    setBusy(true);
    try {
      const prompt = buildTopicPrompt(config, project.article, { topic: topic + (notes ? '\n\n已读取资料：\n' + notes : ''), series });
      setValue(await completeText(prompt.system, prompt.user, modelId, 4000, notify));
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function save(next: boolean) {
    setBusy(true);
    try {
      await api.workspace.writeText({ path: project.directory + '/topic-card.md', text: value, overwrite: true });
      if (series) {
        const slug = String(topic || project.article.title || 'series').replace(/[^\u3400-\u9fffA-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'series';
        await api.workspace.writeText({ path: 'series/' + slug + '/plan.md', text: value, overwrite: true });
      }
      next ? onNext() : onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="选题" description="默认需要 4–6 次搜索和 2–3 篇深读。没有可用 MCP 时可跳过调研或手工提供资料。" />
      <div className="form-grid">
        <Field label="方向或既定话题"><input value={topic} onChange={event => setTopic(event.target.value)} /></Field>
        <Field label="系列模式">
          <select value={series ? 'yes' : 'no'} onChange={event => setSeries(event.target.value === 'yes')}>
            <option value="no">单篇选题</option>
            <option value="yes">系列策划，写入 series/</option>
          </select>
        </Field>
      </div>
      <McpPanel
        servers={servers}
        notify={notify}
        defaultArgs={JSON.stringify({ query: topic, max_results: 5 }, null, 2)}
        onResult={content => setNotes(current => current + '\n\n' + (typeof content === 'string' ? content : JSON.stringify(content, null, 2)))}
      />
      <div className="toolbar toolbar-end">
        <Button type="button" variant="primary" onClick={() => void generate()} busy={busy}>生成 3–5 个选题卡</Button>
      </div>
      <ResultEditor value={value} onChange={setValue} rows={22} label="选题卡" />
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy}>确认选题，进入调研</Button>
      </div>
    </div>
  );
}

function ResearchStage({
  project, config, servers, modelId, notify, onSaved, onNext,
}: {
  project: ArticleProject; config: Record<string, any>; servers: McpServer[]; modelId: string; notify: Notify;
  onSaved: () => void; onNext: () => void;
}) {
  const [topic, setTopic] = useState(project.files.topic || '');
  const [value, setValue] = useState(project.files.research || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTopic(project.files.topic || '');
    setValue(project.files.research || '');
  }, [project.directory, project.files.topic, project.files.research]);

  async function save(next: boolean) {
    setBusy(true);
    try {
      await api.workspace.writeText({ path: project.directory + '/research.md', text: value, overwrite: true });
      next ? onNext() : onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="调研" description="记录来源 URL、可用事实和争议点。没有工具时可以跳过，或把已有资料粘贴到下面的编辑器。" />
      <Field label="已确认的选题"><textarea value={topic} onChange={event => setTopic(event.target.value)} rows={5} /></Field>
      <McpPanel
        servers={servers}
        notify={notify}
        defaultArgs={JSON.stringify({ query: topic.slice(0, 200), max_results: 5 }, null, 2)}
        onResult={content => setValue(current => current + '\n\n' + (typeof content === 'string' ? content : JSON.stringify(content, null, 2)))}
      />
      <ResultEditor value={value} onChange={setValue} rows={24} label="research.md" />
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy}>确认调研，进入写稿</Button>
      </div>
    </div>
  );
}

function referenceTerms(value: string) {
  const text = String(value || '').toLowerCase();
  const terms = new Set(text.match(/[a-z0-9][a-z0-9_-]{1,}/g) || []);
  const chinese = text.replace(/[^\u3400-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) terms.add(chinese.slice(index, index + 2));
  return terms;
}

function referenceScore(query: Set<string>, name: string, text: string) {
  if (!query.size) return 0;
  const nameTerms = referenceTerms(name);
  const textTerms = referenceTerms(name + '\n' + text);
  let score = 0;
  for (const term of query) {
    if (nameTerms.has(term)) score += 6;
    else if (textTerms.has(term)) score += 1;
  }
  return score;
}

async function loadReferences(title: string, topic: string) {
  const products = await api.workspace.list({ path: '.aws-article/products', recursive: false }).catch((error: unknown) => {
    if (isMissingError(error)) return [];
    throw error;
  });
  const directories = products.filter((entry: any) => entry.kind === 'directory').slice(0, 20);
  const query = referenceTerms(title + '\n' + topic);
  const candidates: Array<{ path: string; text: string; score: number; mtime: number }> = [];
  for (const entry of directories) {
    const files = await api.workspace.list({ path: entry.path, recursive: false }).catch((error: unknown) => {
      if (isMissingError(error)) return [];
      throw error;
    });
    for (const file of files) {
      if (file.kind !== 'file' || !/\.md$/i.test(file.path)) continue;
      const text = await readOptional(file.path);
      if (!text.trim()) continue;
      candidates.push({
        path: file.path,
        text,
        score: referenceScore(query, String(entry.name || ''), text),
        mtime: Number(file.mtime || 0),
      });
    }
  }
  const relevant = candidates
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
    .slice(0, 5);
  return relevant.map(item => '### ' + item.path + '\n\n' + item.text + '\n\n资料路径：`' + item.path + '`');
}

function WritingStage({
  project, config, modelId, notify, onSaved, onNext,
}: {
  project: ArticleProject; config: Record<string, any>; modelId: string; notify: Notify;
  onSaved: () => void; onNext: () => void;
}) {
  const [value, setValue] = useState(project.files.writing || project.files.format || '');
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState('');
  const [check, setCheck] = useState<any>(null);
  useEffect(() => {
    setValue(project.files.writing || project.files.format || '');
    void readOptional('.aws-article/writing-spec.md').then(setSpec);
    void callWorker('check', { markdown: project.files.writing || project.files.format || '', config }).then(setCheck).catch(() => {});
  }, [project.directory, project.files.writing, project.files.format, config]);

  async function generate() {
    setBusy(true);
    try {
      const mode = ['rewrite', 'paste', 'wechat'].includes(project.pipeline.mode)
        ? 'rewrite'
        : project.pipeline.mode === 'continue'
          ? 'continue'
          : project.files.topic
            ? 'draft'
            : 'new';
      const instruction = await readOptional(project.directory + '/rewrite-instruction.md');
      const closingBlock = await readOptional(project.directory + '/closing.md');
      const references = await loadReferences(String(project.article.title || ''), project.files.topic || '');
      const prompt = buildWritingPrompt(config, project.article, {
        mode,
        topic: String(project.article.title || ''),
        topicCard: project.files.topic,
        research: project.files.research,
        source: value || project.files.writing,
        instruction,
        writingSpec: spec,
        closingBlock,
        references,
      });
      setValue(await completeText(prompt.system, prompt.user, modelId, 8000, notify));
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function save(next: boolean) {
    setBusy(true);
    try {
      const result = await callWorker<any>('check', { markdown: value, config });
      setCheck(result);
      await api.workspace.writeText({ path: project.directory + '/draft.md', text: value, overwrite: true });
      if (next) onNext(); else onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="写稿" description="复刻上游提示词、结构配额、摘要导语、加粗落点、金句卡和引用标注。" />
      <div className="toolbar toolbar-end">
        <Button type="button" variant="primary" onClick={() => void generate()} busy={busy}>按配置生成 / 改写</Button>
      </div>
      <ResultEditor value={value} onChange={setValue} rows={28} label="draft.md" />
      {check ? <WritingCheck check={check} /> : null}
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy}>确认初稿，进入内容审</Button>
      </div>
    </div>
  );
}

function WritingCheck({ check }: { check: any }) {
  return (
    <div className={'check-card ' + (check.ok ? 'ok' : 'warning')}>
      <div className="check-stats">
        <span><strong>{check.metrics.words}</strong> 字</span>
        <span><strong>{check.metrics.headings}</strong> 节</span>
        <span><strong>{check.metrics.bolds}</strong> 处加粗</span>
        <span><strong>{check.metrics.quoteCards}</strong> 金句卡</span>
      </div>
      {check.issues.length ? <ul>{check.issues.map((item: string) => <li key={item}>{item}</li>)}</ul> : <p>结构硬性项已通过。</p>}
      {check.warnings.length ? <details><summary>提醒事项</summary><ul>{check.warnings.map((item: string) => <li key={item}>{item}</li>)}</ul></details> : null}
      {check.outline.length ? <details><summary>只读加粗提要</summary><p>{check.outline.join(' / ')}</p></details> : null}
    </div>
  );
}

function ReviewStage({
  project, config, modelId, notify, onSaved, onNext,
}: {
  project: ArticleProject; config: Record<string, any>; modelId: string; notify: Notify;
  onSaved: () => void; onNext: () => void;
}) {
  const [result, setResult] = useState<any>(null);
  const [aiValue, setAiValue] = useState(project.files.review || '');
  const [busy, setBusy] = useState(false);

  const reviewDirectory = useRef(project.directory);
  const reviewSource = useRef(project.files.writing || project.files.format || '');

  function runLocal() {
    const source = project.files.writing || project.files.format || '';
    const changed = reviewDirectory.current !== project.directory || reviewSource.current !== source;
    reviewDirectory.current = project.directory;
    reviewSource.current = source;
    const review = reviewArticle(source, config, { title: project.article.title });
    setResult(review);
    setAiValue(current => mergeReviewMarkdown(formatReviewMarkdown(review), changed ? '' : aiReviewSupplement(current)));
    return review;
  }
  useEffect(() => {
    runLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.directory, project.files.writing, config]);

  async function aiReview() {
    setBusy(true);
    try {
      const local = result || runLocal();
      const labels = { block: '阻断', warning: '警告', suggestion: '建议' } as Record<string, string>;
      const rank = { block: 0, warning: 1, suggestion: 2 } as Record<string, number>;
      const localIssues = [...(local.issues || [])]
        .sort((left: any, right: any) => (rank[left.level] ?? 3) - (rank[right.level] ?? 3))
        .slice(0, 20)
        .map((item: any) => (labels[item.level] || '问题') + ' · ' + item.category + '：' + item.message);
      const prompt = buildReviewPrompt(config, project.article, project.files.writing || project.files.format, {
        localIssues,
      });
      const supplement = await completeTextResult(prompt.system, prompt.user, modelId, 2500);
      if (supplement.truncated) {
        notify('AI 补充意见被截断，未写入 review.md。请重试或换用更快的文本模型。', 'warning');
        return;
      }
      if (!supplement.content.trim()) {
        notify('AI 没有返回补充意见。', 'warning');
        return;
      }
      setAiValue(current => mergeReviewMarkdown(current || formatReviewMarkdown(local), supplement.content));
    } catch (error) {
      notify(isTimeoutError(error) ? 'AI 补充审稿超时，本地检测结果已保留。可以换用更快的文本模型后重试。' : errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }
  async function save(next: boolean) {
    setBusy(true);
    try {
      const review = result || runLocal();
      if (next && !review.ok) {
        notify('仍有阻断级问题，先处理后再进入排版。', 'warning');
        return;
      }
      await api.workspace.writeText({ path: project.directory + '/review.md', text: aiValue || formatReviewMarkdown(review), overwrite: true });
      next ? onNext() : onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <StageHeader title="内容审" description="分为阻断、警告、建议。AI 味 15 类指纹只作为建议，不阻断定稿。">
        <Button type="button" onClick={() => runLocal()}>重新检测</Button>
      </StageHeader>
      {result ? <ReviewSummary review={result} /> : null}
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void aiReview()} busy={busy}>补充 AI 审稿意见</Button>
      </div>
      <ResultEditor value={aiValue} onChange={setAiValue} rows={22} label="review.md" />
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy} disabled={result ? !result.ok : false}>处理阻断项，进入排版</Button>
      </div>
    </div>
  );
}

function ReviewSummary({ review, fixFor }: {
  review: any;
  fixFor?: (issue: any) => { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="review-summary">
      <div className="review-stats">
        <Badge tone={review.counts.block ? 'danger' : 'success'}>阻断 {review.counts.block}</Badge>
        <Badge tone={review.counts.warning ? 'warning' : 'neutral'}>警告 {review.counts.warning}</Badge>
        <Badge tone="neutral">建议 {review.counts.suggestion}</Badge>
      </div>
      {review.issues.length ? (
        <div className="issue-list">
          {review.issues.map((item: any, index: number) => {
            const fix = item.level === 'suggestion' ? null : fixFor?.(item) || null;
            return (
              <article key={index} className={'issue issue-' + item.level}>
                <span>{item.level === 'block' ? '阻断' : item.level === 'warning' ? '警告' : '建议'}</span>
                <div>
                  <strong>{item.category}</strong>
                  <p>{item.message}</p>
                  {item.excerpt ? <blockquote>{item.excerpt}</blockquote> : null}
                  {fix ? <Button type="button" variant="ghost" className="fix-button" onClick={fix.onClick}>{fix.label}</Button> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="quiet">未发现需要修改的问题。</p>}
    </div>
  );
}

function FormatStage({
  project, config, themeSummaries, notify, onSaved, onNext,
}: {
  project: ArticleProject; config: Record<string, any>; themeSummaries: any[]; notify: Notify;
  onSaved: () => void; onNext: () => void;
}) {
  const initialFormat = resolveFormatOptions(config, project.article);
  const coverImage = hasSavedCover(project) ? String(project.article.cover_image || '').trim() : '';
  const withCover = (value: string) => rewriteCoverImageMarker(value, coverImage, { insert: true, invalid: 'placeholder' });
  const [markdown, setMarkdown] = useState(() => withCover(
    project.files.format || project.files.writing || project.files.research || '',
  ));
  const [theme, setTheme] = useState(initialFormat.theme);
  const [scheme, setScheme] = useState(initialFormat.scheme);
  const [html, setHtml] = useState(project.files.html || '');
  const [previewHtml, setPreviewHtml] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const themeInfo = themeSummaries.find((item: any) => item.name === theme) || themeSummaries[0];

  useEffect(() => {
    if (!coverImage) return;
    setMarkdown(current => withCover(current));
  }, [coverImage]);

  useEffect(() => {
    const themeValue = themeSummaries.find((item: any) => item.name === theme);
    if (!scheme && themeValue?.defaultScheme) setScheme(themeValue.defaultScheme);
  }, [theme, scheme, themeSummaries]);
  useEffect(() => {
    let active = true;
    void hydratePreview(html).then(value => {
      if (active) setPreviewHtml(value);
    }).catch(() => {
      if (active) setPreviewHtml(html);
    });
    return () => {
      active = false;
    };
  }, [html]);

  async function hydratePreview(value: string) {
    if (!value) return '';
    const sources = [...value.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
    const replacements = new Map<string, string>();
    for (const source of new Set(sources)) {
      if (/^(?:https?:|data:|commerce-plugin:)/i.test(source) || source.startsWith('//')) continue;
      const relative = source.replace(/^\.\//, '');
      try {
        replacements.set(source, await api.workspace.url({ path: project.directory + '/' + relative }));
      } catch {
        continue;
      }
    }
    let output = value;
    for (const [source, url] of replacements) {
      output = output.split('src="' + source + '"').join('src="' + url + '"');
      output = output.split("src='" + source + "'").join("src='" + url + "'");
    }
    return output;
  }

  async function render(notifySuccess = false) {
    setBusy(true);
    const source = withCover(markdown);
    if (source !== markdown) setMarkdown(source);
    try {
      const value = await callWorker<any>('render', {
        markdown: source,
        theme,
        scheme,
        color: initialFormat.color,
        fontSize: initialFormat.fontSize,
        embeds: config.embeds || {},
        captionStyle: config.caption_style || '有图注',
      });
      setHtml(value.html);
      setWarnings(Array.isArray(value.warnings) ? value.warnings : []);
      if (notifySuccess) notify('预览已更新。', 'success');
      return { ...value, markdown: source };
    } catch (error) {
      notify(errorText(error), 'danger');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(next: boolean) {
    setBusy(true);
    try {
      const value = await render(false);
      if (!value) return;
      await saveArticle(api, project.directory, {
        default_format_preset: [theme],
        default_format_scheme: scheme ? [scheme] : [],
      });
      await api.workspace.writeText({ path: project.directory + '/article.md', text: value.markdown, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/article.html', text: value.html, overwrite: true });
      next ? onNext() : onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="排版" description="8 套主题 × 3 套配色、9 个组件与 ::: 语法；输出全部内联样式，可直接粘贴到微信编辑器。" />
      <div className="form-grid form-grid-3">
        <Field label="主题">
          <select value={theme} onChange={event => { setTheme(event.target.value); setScheme(''); }}>
            {themeSummaries.map((item: any) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="配色">
          <select value={scheme} onChange={event => setScheme(event.target.value)}>
            {themeInfo?.schemes.map((item: any) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="主题说明"><div className="static-field">{themeInfo?.description || '—'}</div></Field>
      </div>
      <div className="format-layout">
        <div>
          <Field label="article.md"><textarea className="article-input" value={markdown} onChange={event => setMarkdown(event.target.value)} rows={24} spellCheck={false} /></Field>
          <div className="toolbar toolbar-end">
            <Button type="button" onClick={() => void render(true)} busy={busy}>更新预览</Button>
            <CopyButton text={html} label="复制 HTML" />
            <Button type="button" variant="primary" onClick={() => void save(false)} busy={busy}>保存排版</Button>
          </div>
        </div>
        <div className="phone-preview">
          <div className="phone-top" aria-hidden="true" />
          {previewHtml ? <iframe title="公众号手机预览" srcDoc={previewHtml} sandbox="" /> : <div className="preview-empty">更新预览后在这里检查手机排版。</div>}
        </div>
      </div>
      {warnings.length ? <div className="notice warning">{warnings.map(item => <p key={item}>{item}</p>)}</div> : null}
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy}>保存排版，进入配图</Button>
      </div>
    </div>
  );
}

function ImagesStage({
  project, config, servers, imageModels, modelId: preferredModelId, notify, onSaved, onNext, onReload,
}: {
  project: ArticleProject; config: Record<string, any>; servers: McpServer[]; imageModels: ImageModel[]; modelId: string; notify: Notify;
  onSaved: () => void; onNext: () => void; onReload: () => Promise<void>;
}) {
  const baseMarkdown = project.files.format || project.files.writing || '';
  const savedCover = hasSavedCover(project) ? String(project.article.cover_image || '').trim() : '';
  const [plan, setPlan] = useState<any>(null);
  const [modelId, setModelId] = useState(preferredModelId || imageModels[0]?.id || '');
  const [batch, setBatch] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mcpWaiting, setMcpWaiting] = useState(false);
  const initialCoverImageStyle = String(project.article.cover_image_style || '').trim();
  const initialMedium = String(project.article.image_medium || '').trim();
  const [coverImageStyle, setCoverImageStyle] = useState(COVER_STYLES.includes(initialCoverImageStyle) ? initialCoverImageStyle : '');
  const [medium, setMedium] = useState(IMAGE_MEDIA.includes(initialMedium) ? initialMedium : '');
  const [planning, setPlanning] = useState(true);
  const [batchPath, setBatchPath] = useState('');
  const [previews, setPreviews] = useState<PreviewImage[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ImageTargetStatus>>({});
  const [generatingKey, setGeneratingKey] = useState('');
  const [preview, setPreview] = useState<(PreviewImage & { url: string }) | null>(null);
  const mcpAbort = useRef<AbortController | null>(null);
  const generatedMapping = useRef<Record<number, string>>({});
  const syncedCoverImageStyle = useRef(initialCoverImageStyle);
  const syncedMedium = useRef(initialMedium);
  const imageSource = String(project.article.image_source || config.image_source || 'generated');
  const imageGenerator = config.image_generator === 'mcp' ? 'mcp' : 'model';
  const mcpServer = servers.find(server => server.id === config.mcp_image_server);
  const mcpReady = Boolean(mcpServer && mcpServer.status === 'ready');
  const promptTargets = useMemo<ImageTarget[]>(() => {
    if (!plan) return [];
    const targets: ImageTarget[] = [];
    if (plan.cover?.generate) targets.push({ kind: 'cover' });
    for (const item of plan.items || []) {
      if (item.generate) targets.push({ kind: 'body', index: item.index });
    }
    return targets;
  }, [plan]);

  useEffect(() => () => mcpAbort.current?.abort(), []);

  useEffect(() => {
    const value = String(project.article.cover_image_style || '').trim();
    if (value === syncedCoverImageStyle.current) return;
    syncedCoverImageStyle.current = value;
    setCoverImageStyle(COVER_STYLES.includes(value) ? value : '');
  }, [project.article.cover_image_style]);

  useEffect(() => {
    const value = String(project.article.image_medium || '').trim();
    if (value === syncedMedium.current) return;
    syncedMedium.current = value;
    setMedium(IMAGE_MEDIA.includes(value) ? value : '');
  }, [project.article.image_medium]);

  useEffect(() => {
    if (!imageModels.some(model => model.id === modelId)) setModelId(imageModels[0]?.id || '');
  }, [imageModels, modelId]);

  useEffect(() => {
    const mapping = plan ? mappingForPlan(plan, project.files.imagePlan) : parseGeneratedMapping(project.files.imagePlan);
    generatedMapping.current = mapping;
    setPreviews(plan ? previewsFromMapping(mapping) : projectImagePreviews(project));
  }, [plan, project.directory, project.files.imagePlan, project.article.cover_image, project.entries]);

  useEffect(() => {
    let cancelled = false;
    setPlanning(true);
    void callWorker<any>('planImages', {
      markdown: baseMarkdown,
      config,
      article: {
        ...project.article,
        ...(coverImageStyle ? { cover_image_style: coverImageStyle } : {}),
        ...(medium ? { image_medium: medium } : {}),
      },
    }).then(value => {
      if (!cancelled) setPlan(value);
    }).catch(error => {
      if (!cancelled) notify(errorText(error), 'danger');
    }).finally(() => {
      if (!cancelled) setPlanning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [baseMarkdown, config, project.article, coverImageStyle, medium, notify]);

  async function waitBatch(id: string, updateState = true) {
    for (let index = 0; index < 600; index += 1) {
      const value = await api.ai.batch.get({ id });
      if (updateState) {
        setBatch(value);
        setStatuses(statusMapFromBatch(value));
      }
      if (['finished', 'interrupted', 'canceled'].includes(value.state)) return value;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('等待图片生成超时。批次仍在宿主中，可稍后刷新状态，不会自动重发。');
  }

  async function openPreview(image: PreviewImage) {
    try {
      setPreview({ ...image, url: await api.workspace.url({ path: image.path }) });
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  function previewsFromMapping(mapping: Record<number, string>, cover = ''): PreviewImage[] {
    const previews: PreviewImage[] = [];
    const coverValue = String(cover || project.article.cover_image || '').trim();
    if (coverValue) {
      const path = coverValue.startsWith(project.directory + '/') ? coverValue : project.directory + '/' + coverValue;
      if (path === coverValue || project.entries.some(entry => entry.path === path)) {
        previews.push({ path, title: '封面', kind: 'cover' });
      }
    }
    for (const [position, item] of (plan?.items || []).entries()) {
      const relative = mapping[item.index];
      if (!relative) continue;
      previews.push({ path: project.directory + '/' + relative, title: '配图 ' + (position + 1), kind: 'body' });
    }
    return previews;
  }

  function statusMapFromBatch(value: any): Record<string, ImageTargetStatus> {
    const next: Record<string, ImageTargetStatus> = {};
    promptTargets.forEach((target, index) => {
      const item = value?.items?.[index];
      if (!item) return;
      next[imageTargetKey(target)] = {
        state: String(item.state || ''),
        error: item.error || null,
        taskId: item.taskId || null,
      };
    });
    return next;
  }

  function updateBatchTarget(target: ImageTarget, state: string, error: string | null = null) {
    const key = imageTargetKey(target);
    const position = promptTargets.findIndex(item => imageTargetKey(item) === key);
    if (position < 0) return;
    setBatch((current: any) => {
      if (!current?.items?.[position]) return current;
      return {
        ...current,
        items: current.items.map((item: any, index: number) => index === position ? { ...item, state, error } : item),
      };
    });
  }

  function targetPrompt(target: ImageTarget) {
    if (!plan) return '';
    if (target.kind === 'cover') return String(plan.cover?.prompt || '');
    return String(plan.items.find((item: any) => item.index === target.index)?.prompt || '');
  }

  function targetLabel(target: ImageTarget) {
    if (target.kind === 'cover') return '封面';
    const position = (plan?.items || []).findIndex((item: any) => item.index === target.index);
    return '配图 ' + (position + 1);
  }

  function previewForTarget(target: ImageTarget) {
    if (target.kind === 'cover') return previews.find(image => image.kind === 'cover') || null;
    const title = targetLabel(target);
    return previews.find(image => image.kind === 'body' && image.title === title) || null;
  }

  function renderArticle(source: string) {
    const format = resolveFormatOptions(config, project.article);
    return callWorker<any>('render', {
      markdown: source,
      theme: format.theme,
      scheme: format.scheme,
      color: format.color,
      fontSize: format.fontSize,
      embeds: config.embeds || {},
      captionStyle: config.caption_style || '有图注',
    });
  }

  async function applySingleImage(target: ImageTarget, sourcePath: string) {
    if (!plan) throw new Error('配图方案尚未加载。');
    const token = shortId(String(Date.now()));
    const previousMapping = { ...generatedMapping.current };
    const mapping = { ...previousMapping };
    const createdFiles: string[] = [];
    let coverPath = '';
    let cover235Path = '';
    let cover11Path = '';
    const previousMarkdown = await readOptional(project.directory + '/article.md');
    const previousHtml = await readOptional(project.directory + '/article.html');
    const previousPlan = await readOptional(project.directory + '/img-plan.json');
    const previousArticle = await readOptional(project.directory + '/article.yaml');
    const previousBatchId = (() => {
      try {
        return JSON.parse(previousPlan || '{}')?.batchId || null;
      } catch {
        return null;
      }
    })();
    try {
      const sourceFile = await api.workspace.readFile({ path: sourcePath });
      const sourceBytes = base64Bytes(sourceFile.data);
      if (target.kind === 'cover') {
        const coverAspect = String(config.cover_aspect || '2.35:1');
        const cover = await cropImageBytes(sourceBytes, sourceFile.mime, coverAspect, 0.9);
        const cover235 = await cropImageBytes(sourceBytes, sourceFile.mime, '2.35:1', 0.9);
        const cover11 = await cropImageBytes(sourceBytes, sourceFile.mime, '1:1', 0.9);
        coverPath = project.directory + '/cover-' + token + '.jpg';
        cover235Path = project.directory + '/cover-235-' + token + '.jpg';
        cover11Path = project.directory + '/cover-11-' + token + '.jpg';
        await api.workspace.writeBase64({ path: coverPath, data: bytesBase64(cover), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(coverPath);
        await api.workspace.writeBase64({ path: cover235Path, data: bytesBase64(cover235), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(cover235Path);
        await api.workspace.writeBase64({ path: cover11Path, data: bytesBase64(cover11), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(cover11Path);
      } else {
        const compressed = await compressBodyImageBytes(sourceBytes, sourceFile.mime);
        const targetPath = project.directory + '/imgs/body-' + String(target.index + 1).padStart(2, '0') + '-' + token + '.jpg';
        await api.workspace.writeBase64({ path: targetPath, data: bytesBase64(compressed), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(targetPath);
        mapping[target.index] = targetPath.slice(project.directory.length + 1);
      }
      const coverRelative = coverPath ? coverPath.slice(project.directory.length + 1) : savedCover;
      const rewritten = rewriteImageMarkersWithMapping(baseMarkdown, plan, mapping, { cover: coverRelative, invalidCover: 'placeholder' });
      const rendered = await renderArticle(rewritten);
      await api.workspace.writeText({ path: project.directory + '/article.md', text: rewritten, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/article.html', text: rendered.html, overwrite: true });
      await api.workspace.writeText({
        path: project.directory + '/img-plan.json',
        text: JSON.stringify({ ...plan, generated: mapping, batchId: previousBatchId }, null, 2),
        overwrite: true,
      });
      await saveArticle(api, project.directory, {
        ...(coverPath ? {
          cover_image: coverPath.slice(project.directory.length + 1),
          pic_crop_235_1: cover235Path.slice(project.directory.length + 1),
          pic_crop_1_1: cover11Path.slice(project.directory.length + 1),
        } : {}),
        image_medium: plan.medium,
        cover_image_style: plan.cover.style,
      });
    } catch (error) {
      if (previousMarkdown) await api.workspace.writeText({ path: project.directory + '/article.md', text: previousMarkdown, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/article.md' }).catch(() => {});
      if (previousHtml) await api.workspace.writeText({ path: project.directory + '/article.html', text: previousHtml, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/article.html' }).catch(() => {});
      if (previousPlan) await api.workspace.writeText({ path: project.directory + '/img-plan.json', text: previousPlan, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/img-plan.json' }).catch(() => {});
      if (previousArticle) await api.workspace.writeText({ path: project.directory + '/article.yaml', text: previousArticle, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/article.yaml' }).catch(() => {});
      for (const path of createdFiles.reverse()) await api.workspace.remove({ path }).catch(() => {});
      throw error;
    }

    generatedMapping.current = mapping;
    const nextPreviews = previewsFromMapping(mapping, coverPath || project.article.cover_image);
    setPreviews(nextPreviews);
    await onReload().catch(() => {});
    return nextPreviews;
  }

  async function generate(action: 'new' | 'retry' = 'new') {
    if (!plan || (imageGenerator !== 'mcp' && !modelId)) {
      notify(imageGenerator === 'mcp' ? '请先完成 MCP 生图配置。' : '请选择图片模型。', 'warning');
      return;
    }
    setStatuses({});
    if (imageGenerator === 'mcp') {
      if (!config.mcp_image_server || !config.mcp_image_tool || !mcpReady) {
        notify('请先在配置中心选择当前可用的 MCP 服务和生图工具。', 'warning');
        return;
      }
      setBusy(true);
      const runToken = mcpBatchToken();
      const outputPath = project.directory + '/imgs/batches/mcp-' + runToken;
      const controller = new AbortController();
      mcpAbort.current = controller;
      let producedFiles = 0;
      setBatchPath(outputPath);
      setMessage('正在通过 MCP 生成图片…');
      try {
        setMcpWaiting(true);
        const result = await generateImagesThroughMcp({
          api,
          serverId: config.mcp_image_server,
          toolName: config.mcp_image_tool,
          argsTemplate: config.mcp_image_args,
          prompts: plan.prompts,
          directory: outputPath,
          sizeFor: (index: number) => index === 0 ? mcpCoverSize(plan.cover?.aspect || config.cover_aspect) : '16:9',
          onProgress: (current: number, total: number) => setMessage('正在通过 MCP 生成第 ' + current + '/' + total + ' 张…'),
          signal: controller.signal,
        });
        producedFiles = result.files.length;
        setMcpWaiting(false);
        const issueByIndex = new Map([...result.failures, ...result.unknowns].map(item => [item.index, item]));
        const errorByIndex = new Map([...issueByIndex].map(([index, issue]) => [index, issue.error]));
        const unknownIndexes = new Set(result.unknowns.map(item => item.index));
        if (result.abortedIndex) unknownIndexes.add(result.abortedIndex);
        const succeeded = new Set(result.files.map(item => item.index));
        const value = {
          id: 'mcp-' + runToken,
          revision: 1,
          state: result.aborted || result.fatal ? 'interrupted' : 'finished',
          workspacePath: outputPath,
          items: plan.prompts.map((prompt: string, index: number) => ({
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
            prompt,
          })),
        };
        setBatch(value);
        setStatuses(statusMapFromBatch(value));
        const hasRecovery = producedFiles > 0 || result.unknowns.length > 0 || Boolean(result.abortedTaskId);
        if (result.fatal) {
          const note = (producedFiles
            ? result.fatal + ' 已生成的 ' + producedFiles + ' 张图片保留在 ' + outputPath + '。'
            : result.fatal)
            + (hasRecovery && !producedFiles ? ' 结果记录在 ' + outputPath + '/mcp-generation.json。' : '');
          if (!hasRecovery) await api.workspace.remove({ path: outputPath, recursive: true }).catch(() => {});
          setMessage(note);
          notify(note, 'danger');
          return;
        }
        if (result.aborted) {
          const note = producedFiles
            ? '已停止等待，已生成 ' + producedFiles + ' 张图片并保留在 ' + outputPath + '；后续任务可能仍在 MCP 服务端进行。'
            : '已停止等待，当前没有已写入的图片；任务可能仍在 MCP 服务端进行。'
              + (hasRecovery ? ' 结果记录在 ' + outputPath + '/mcp-generation.json。' : '');
          if (!hasRecovery) await api.workspace.remove({ path: outputPath, recursive: true }).catch(() => {});
          setMessage(note);
          notify(note, 'warning');
          return;
        }
        if (!result.files.length) {
          if (result.unknowns.length) {
            const note = 'MCP 没有生成可用图片；结果未知，任务 ID 已写入 ' + outputPath + '/mcp-generation.json。';
            setMessage(note);
            notify(note, 'warning');
            return;
          }
          const first = result.failures[0]?.error;
          throw new Error('MCP 没有生成任何可用图片。' + (first ? '首个错误：' + first : ''));
        }
        const applied = await applyBatch(value, outputPath);
        if (applied.missing || result.failures.length) {
          const notes = [
            applied.missing ? '仍有 ' + applied.missing + ' 个图位缺少图片' : '',
            result.failures.length ? result.failures.length + ' 张生成失败' : '',
          ].filter(Boolean);
          setMessage(notes.join('；') + '。');
          notify(notes.join('；') + '。已保留可用图片。', 'warning');
        } else {
          await api.workspace.remove({ path: outputPath, recursive: true }).catch(() => {});
          notify('图片已通过 MCP 生成并整理完成。请逐张检查中文和信息位内容。', 'success');
        }
      } catch (error) {
        setMcpWaiting(false);
        const reason = errorText(error);
        if (producedFiles) {
          const note = reason + ' 已生成的 ' + producedFiles + ' 张图片保留在 ' + outputPath + '。';
          setMessage(note);
          notify(note, 'danger');
        } else {
          await api.workspace.remove({ path: outputPath, recursive: true }).catch(() => {});
          notify(reason, 'danger');
          setMessage(reason);
        }
      } finally {
        mcpAbort.current = null;
        setMcpWaiting(false);
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setMessage('正在提交图片批次…');
    try {
      let value;
      if (action === 'retry' && batch) {
        const retryable = batch.items.some((item: any) => ['failed', 'save-failed'].includes(item.state));
        if (!retryable) {
          setMessage('当前批次没有可重试的失败项。结果未知的图片不会自动重发，请确认后重新生成全部。');
          return;
        }
        value = await api.ai.batch.start({
          id: batch.id,
          revision: batch.revision,
          workspacePath: batchPath || batch.workspacePath,
          retryFailed: true,
        });
      } else {
        const created = await api.ai.batch.create({
          mode: 'generate',
          source: imageModelSource(imageModels, modelId),
          modelId,
          prompt: plan.prompts[0],
          items: plan.prompts.map((prompt: string) => ({ prompt })),
          concurrency: 2,
        });
        const outputPath = project.directory + '/imgs/batches/' + created.id;
        await api.workspace.mkdir({ path: outputPath });
        setBatchPath(outputPath);
        value = await api.ai.batch.start({
          id: created.id,
          revision: created.revision,
          workspacePath: outputPath,
        });
      }
      setBatch(value);
      setStatuses(statusMapFromBatch(value));
      if (value.workspacePath) setBatchPath(value.workspacePath);
      setMessage('正在生成 ' + value.items.length + ' 张图片。失败或未知状态不会自动重发。');
      value = await waitBatch(value.id);
      if (value.state !== 'finished') {
        setMessage(value.state === 'interrupted' ? '生成被中断。请检查逐项状态后明确选择重试。' : '生成已结束。');
        return;
      }
      const result = await applyBatch(value, value.workspacePath || batchPath);
      const retryable = value.items.some((item: any) => ['failed', 'save-failed'].includes(item.state));
      const unknown = value.items.some((item: any) => item.state === 'unknown');
      if (result.missing || retryable || unknown) {
        const notes = [
          result.missing ? '仍有 ' + result.missing + ' 个图位缺少图片' : '',
          retryable ? '存在可重试失败项' : '',
          unknown ? '存在结果未知项，不会自动重发' : '',
        ].filter(Boolean);
        setMessage(notes.join('；') + '。已保留占位符，请确认后重试或重新生成。');
        notify(notes.join('；') + '。', 'warning');
      } else {
        await api.workspace.remove({ path: value.workspacePath || batchPath, recursive: true }).catch(() => {});
        notify('图片已整理完成。请逐张检查中文和信息位内容。', 'success');
      }
    } catch (error) {
      notify(errorText(error), 'danger');
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateSingle(target: ImageTarget) {
    if (!plan || busy) return;
    if (imageGenerator !== 'mcp' && !modelId) {
      notify('请选择图片模型。', 'warning');
      return;
    }
    if (imageGenerator === 'mcp' && (!config.mcp_image_server || !config.mcp_image_tool || !mcpReady)) {
      notify('请先在配置中心选择当前可用的 MCP 服务和生图工具。', 'warning');
      return;
    }
    const prompt = targetPrompt(target);
    if (!prompt) {
      notify('这个图位没有可用的生成提示词。', 'warning');
      return;
    }
    const key = imageTargetKey(target);
    const label = targetLabel(target);
    const controller = new AbortController();
    let outputPath = '';
    let keepOutput = false;
    let unknown = false;
    let submitted = false;
    let confirmedFailure = false;
    let sourceReady = false;
    let failureState = '';
    setBusy(true);
    setGeneratingKey(key);
    setStatuses(current => ({ ...current, [key]: { state: 'running', error: null } }));
    setMessage('正在生成' + label + '…');
    try {
      let sourcePath = '';
      if (imageGenerator === 'mcp') {
        outputPath = project.directory + '/imgs/batches/mcp-' + mcpBatchToken();
        mcpAbort.current = controller;
        setMcpWaiting(true);
        submitted = true;
        const result = await generateImagesThroughMcp({
          api,
          serverId: config.mcp_image_server,
          toolName: config.mcp_image_tool,
          argsTemplate: config.mcp_image_args,
          prompts: [prompt],
          directory: outputPath,
          sizeFor: () => target.kind === 'cover' ? mcpCoverSize(plan.cover?.aspect || config.cover_aspect) : '16:9',
          signal: controller.signal,
        });
        if (result.fatal) {
          confirmedFailure = true;
          throw new Error(result.fatal);
        }
        if (result.files.length) {
          sourcePath = result.files[0].path;
          sourceReady = true;
        } else if (result.unknowns.length || result.abortedTaskId) {
          unknown = true;
          keepOutput = true;
          const taskId = result.unknowns[0]?.taskId || result.abortedTaskId || '';
          const note = label + '结果未知，不会自动重发。' + (taskId ? '任务 ID：' + taskId + '。' : '')
            + '请先检查 MCP 服务端，再在这里单独重新生成。记录：' + outputPath + '/mcp-generation.json';
          setStatuses(current => ({ ...current, [key]: { state: 'unknown', error: note, taskId } }));
          updateBatchTarget(target, 'unknown', note);
          setMessage(note);
          notify(note, 'warning');
          return;
        } else if (result.aborted) {
          const note = '已停止等待' + label + '生成；任务可能仍在 MCP 服务端进行。';
          setStatuses(current => ({ ...current, [key]: { state: 'canceled', error: note } }));
          setMessage(note);
          notify(note, 'warning');
          keepOutput = true;
          return;
        } else {
          confirmedFailure = true;
          failureState = 'failed';
          throw new Error(result.failures[0]?.error || 'MCP 没有生成可用图片。');
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
        outputPath = project.directory + '/imgs/batches/' + created.id;
        await api.workspace.mkdir({ path: outputPath });
        submitted = true;
        let value = await api.ai.batch.start({
          id: created.id,
          revision: created.revision,
          workspacePath: outputPath,
        });
        value = await waitBatch(value.id, false);
        const item = value.items?.[0];
        if (item?.state === 'unknown') {
          unknown = true;
          keepOutput = true;
          const note = label + '结果未知，不会自动重发。请先检查宿主后台任务，再单独重新生成。'
            + (item.error ? ' ' + item.error : '');
          setStatuses(current => ({ ...current, [key]: { state: 'unknown', error: note } }));
          updateBatchTarget(target, 'unknown', note);
          setMessage(note);
          notify(note, 'warning');
          return;
        }
        if (item && ['failed', 'save-failed'].includes(item.state)) {
          confirmedFailure = true;
          failureState = 'failed';
          throw new Error(item.error || label + '生成失败。');
        }
        if (item?.state !== 'succeeded') {
          confirmedFailure = true;
          failureState = value.state === 'interrupted' || value.state === 'canceled' ? value.state : 'failed';
          throw new Error(value.state === 'interrupted'
            ? '生成被中断，未写入这张图片。'
            : value.state === 'canceled'
              ? '生成已取消，未写入这张图片。'
              : '生成没有成功完成。');
        }
        const entries = await api.workspace.list({ path: outputPath, recursive: false });
        const generated = mapGeneratedFiles({ prompts: [prompt] }, entries);
        if (!generated.length) throw new Error('没有找到生成的图片文件。');
        sourcePath = generated[0].path;
        sourceReady = true;
      }
      await applySingleImage(target, sourcePath);
      setStatuses(current => ({ ...current, [key]: { state: 'succeeded', error: null, taskId: null } }));
      setBatch(null);
      setBatchPath('');
      setMessage(label + '已单独更新，其他图片保持不变。');
      notify(label + '已单独更新。请检查中文和信息位内容。', 'success');
    } catch (error) {
      const reason = errorText(error);
      if (submitted && !confirmedFailure && !sourceReady) {
        unknown = true;
        keepOutput = true;
      } else if (sourceReady) {
        keepOutput = true;
      }
      const state = unknown ? 'unknown' : sourceReady ? 'save-failed' : (failureState || 'failed');
      const note = reason + (sourceReady && outputPath ? ' 已生成的源图保留在 ' + outputPath + '。' : '');
      setStatuses(current => ({ ...current, [key]: { state, error: note } }));
      if (unknown) updateBatchTarget(target, 'unknown', note);
      setMessage(note);
      notify(note, unknown || state === 'save-failed' ? 'warning' : 'danger');
    } finally {
      mcpAbort.current = null;
      setMcpWaiting(false);
      setBusy(false);
      setGeneratingKey('');
      if (outputPath && !keepOutput) {
        await api.workspace.remove({ path: outputPath, recursive: true }).catch(() => {});
      }
    }
  }

  async function importUserCover() {
    const file = await api.files.pick({ extensions: ['png', 'jpg', 'jpeg', 'webp'] });
    if (!file) return;
    setBusy(true);
    setMessage('正在整理你提供的封面…');
    const createdFiles: string[] = [];
    const sourcePath = project.directory + '/imgs/user-cover-' + shortId(file.name + Date.now()) + '.' + file.name.split('.').pop()?.toLowerCase();
    let previousMarkdown = '';
    let previousHtml = '';
    let previousArticle = '';
    let snapshotsReady = false;
    try {
      previousMarkdown = await readOptional(project.directory + '/article.md');
      previousHtml = await readOptional(project.directory + '/article.html');
      previousArticle = await readOptional(project.directory + '/article.yaml');
      snapshotsReady = true;
      await api.workspace.writeFile({ path: sourcePath, token: file.token, overwrite: false });
      const source = await api.workspace.readFile({ path: sourcePath });
      const sourceBytes = base64Bytes(source.data);
      const token = shortId(String(Date.now()));
      const cover235 = await cropImageBytes(sourceBytes, source.mime, '2.35:1', 0.9);
      const cover11 = await cropImageBytes(sourceBytes, source.mime, '1:1', 0.9);
      const cover = await cropImageBytes(sourceBytes, source.mime, String(config.cover_aspect || '2.35:1'), 0.9);
      const coverPath = project.directory + '/cover-user-' + token + '.jpg';
      const cover235Path = project.directory + '/cover-235-user-' + token + '.jpg';
      const cover11Path = project.directory + '/cover-11-user-' + token + '.jpg';
      await api.workspace.writeBase64({ path: coverPath, data: bytesBase64(cover), mime: 'image/jpeg', overwrite: false });
      createdFiles.push(coverPath);
      await api.workspace.writeBase64({ path: cover235Path, data: bytesBase64(cover235), mime: 'image/jpeg', overwrite: false });
      createdFiles.push(cover235Path);
      await api.workspace.writeBase64({ path: cover11Path, data: bytesBase64(cover11), mime: 'image/jpeg', overwrite: false });
      createdFiles.push(cover11Path);
      const coverRelative = coverPath.slice(project.directory.length + 1);
      const rewritten = rewriteImageMarkersWithMapping(baseMarkdown, plan, generatedMapping.current, { cover: coverRelative, invalidCover: 'placeholder' });
      const rendered = await renderArticle(rewritten);
      await saveArticle(api, project.directory, {
        cover_image: coverRelative,
        pic_crop_235_1: cover235Path.slice(project.directory.length + 1),
        pic_crop_1_1: cover11Path.slice(project.directory.length + 1),
      });
      await api.workspace.writeText({ path: project.directory + '/article.md', text: rewritten, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/article.html', text: rendered.html, overwrite: true });
      setPreviews(current => [{ path: coverPath, title: '封面', kind: 'cover' }, ...current.filter(item => item.kind !== 'cover')]);
      await onReload().catch(() => {});
      setMessage('封面已保存。请检查手机预览中的裁切效果。');
      notify('已使用你提供的封面。', 'success');
    } catch (error) {
      if (snapshotsReady) {
        if (previousMarkdown) await api.workspace.writeText({ path: project.directory + '/article.md', text: previousMarkdown, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/article.md' }).catch(() => {});
        if (previousHtml) await api.workspace.writeText({ path: project.directory + '/article.html', text: previousHtml, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/article.html' }).catch(() => {});
        if (previousArticle) await api.workspace.writeText({ path: project.directory + '/article.yaml', text: previousArticle, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/article.yaml' }).catch(() => {});
      }
      for (const path of createdFiles.reverse()) await api.workspace.remove({ path }).catch(() => {});
      notify(errorText(error), 'danger');
      setMessage(errorText(error));
    } finally {
      await api.files.release(file.token).catch(() => {});
      await api.workspace.remove({ path: sourcePath }).catch(() => {});
      setBusy(false);
    }
  }

  async function importUserBodyImages() {
    if (!plan) return;
    const files = await api.files.pickMany({ extensions: ['png', 'jpg', 'jpeg', 'webp'] });
    if (!files.length) return;
    setBusy(true);
    setMessage('正在整理你提供的正文图片…');
    const token = shortId(String(Date.now()));
    const createdFiles: string[] = [];
    const sourceFiles: string[] = [];
    const mapping: Record<number, string> = { ...generatedMapping.current };
    let previousMarkdown = '';
    let previousHtml = '';
    let previousPlan = '';
    let snapshotsReady = false;
    try {
      previousMarkdown = await readOptional(project.directory + '/article.md');
      previousHtml = await readOptional(project.directory + '/article.html');
      previousPlan = await readOptional(project.directory + '/img-plan.json');
      snapshotsReady = true;
      const items = plan.items.slice(0, files.length);
      for (const [index, file] of files.entries()) {
        const item = items[index];
        if (!item) break;
        const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
        const sourcePath = project.directory + '/imgs/user-body-' + token + '-' + String(index + 1).padStart(2, '0') + '.' + extension;
        sourceFiles.push(sourcePath);
        await api.workspace.writeFile({ path: sourcePath, token: file.token, overwrite: false });
        const source = await api.workspace.readFile({ path: sourcePath });
        const compressed = await compressBodyImageBytes(base64Bytes(source.data), source.mime);
        const target = project.directory + '/imgs/body-' + String(index + 1).padStart(2, '0') + '-user-' + token + '.jpg';
        await api.workspace.writeBase64({ path: target, data: bytesBase64(compressed), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(target);
        mapping[item.index] = target.slice(project.directory.length + 1);
      }
      const rewritten = rewriteImageMarkersWithMapping(baseMarkdown, plan, mapping, {
        cover: savedCover,
        invalidCover: 'placeholder',
      });
      const rendered = await renderArticle(rewritten);
      await api.workspace.writeText({ path: project.directory + '/article.md', text: rewritten, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/article.html', text: rendered.html, overwrite: true });
      await api.workspace.writeText({
        path: project.directory + '/img-plan.json',
        text: JSON.stringify({ ...plan, generated: mapping, source: 'user', batchId: null }, null, 2),
        overwrite: true,
      });
      generatedMapping.current = mapping;
      setPreviews(previewsFromMapping(mapping));
      await onReload().catch(() => {});
      const missing = Math.max(0, plan.items.length - Object.keys(mapping).length);
      setMessage(missing ? '已导入 ' + files.length + ' 张，仍有 ' + missing + ' 个图位缺少图片。' : '正文图片已写入并更新文章。');
      notify(missing ? '部分图位仍缺少图片，请补充后再进入终审。' : '已使用你提供的正文图片。', missing ? 'warning' : 'success');
    } catch (error) {
      if (snapshotsReady) {
        if (previousMarkdown) await api.workspace.writeText({ path: project.directory + '/article.md', text: previousMarkdown, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/article.md' }).catch(() => {});
        if (previousHtml) await api.workspace.writeText({ path: project.directory + '/article.html', text: previousHtml, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/article.html' }).catch(() => {});
        if (previousPlan) await api.workspace.writeText({ path: project.directory + '/img-plan.json', text: previousPlan, overwrite: true }).catch(() => {});
        else await api.workspace.remove({ path: project.directory + '/img-plan.json' }).catch(() => {});
      }
      for (const path of createdFiles.reverse()) await api.workspace.remove({ path }).catch(() => {});
      notify(errorText(error), 'danger');
      setMessage(errorText(error));
    } finally {
      for (const file of files) await api.files.release(file.token).catch(() => {});
      for (const path of sourceFiles) await api.workspace.remove({ path }).catch(() => {});
      setBusy(false);
    }
  }

  async function applyBatch(value: any, outputPath: string) {
    setMessage('正在整理图片文件…');
    if (!outputPath) throw new Error('图片批次输出目录缺失。');
    const entries = await api.workspace.list({ path: outputPath, recursive: false });
    const generated = mapGeneratedFiles(plan, entries);
    if (!generated.length) throw new Error('没有找到可用的生成图片。请检查批次逐项状态。');
    const createdFiles: string[] = [];
    const previousMarkdown = await readOptional(project.directory + '/article.md');
    const previousHtml = await readOptional(project.directory + '/article.html');
    const previousPlan = await readOptional(project.directory + '/img-plan.json');
    const previousArticle = await readOptional(project.directory + '/article.yaml');
    const token = shortId(value.id);
    const mapping: Record<number, string> = { ...generatedMapping.current };
    const generatedItems = plan.items.filter((item: any) => item.generate);
    const coverEntry = generated.find((entry: any) => entry.batchIndex === 1);
    let coverPath = '';
    let cover235Path = '';
    let cover11Path = '';
    try {
      if (coverEntry) {
        const coverFile = await api.workspace.readFile({ path: coverEntry.path });
        const coverBytes = base64Bytes(coverFile.data);
        const coverAspect = String(config.cover_aspect || '2.35:1');
        const coverBytesJpeg = await cropImageBytes(coverBytes, coverFile.mime, coverAspect, 0.9);
        coverPath = project.directory + '/cover-' + token + '.jpg';
        await api.workspace.writeBase64({ path: coverPath, data: bytesBase64(coverBytesJpeg), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(coverPath);
        const crop235 = await cropImageBytes(coverBytes, coverFile.mime, '2.35:1', 0.9);
        const crop11 = await cropImageBytes(coverBytes, coverFile.mime, '1:1', 0.9);
        cover235Path = project.directory + '/cover-235-' + token + '.jpg';
        cover11Path = project.directory + '/cover-11-' + token + '.jpg';
        await api.workspace.writeBase64({ path: cover235Path, data: bytesBase64(crop235), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(cover235Path);
        await api.workspace.writeBase64({ path: cover11Path, data: bytesBase64(crop11), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(cover11Path);
      }
      for (let index = 0; index < generatedItems.length; index += 1) {
        const item = generatedItems[index];
        const entry = generated.find((candidate: any) => candidate.batchIndex === index + 2);
        if (!entry) continue;
        const bodyFile = await api.workspace.readFile({ path: entry.path });
        const compressed = await compressBodyImageBytes(base64Bytes(bodyFile.data), bodyFile.mime);
        const target = project.directory + '/imgs/body-' + String(index + 1).padStart(2, '0') + '-' + token + '.jpg';
        await api.workspace.writeBase64({ path: target, data: bytesBase64(compressed), mime: 'image/jpeg', overwrite: false });
        createdFiles.push(target);
        mapping[item.index] = target.slice(project.directory.length + 1);
      }
      const coverRelative = coverPath ? coverPath.slice(project.directory.length + 1) : savedCover;
      const rewritten = rewriteImageMarkersWithMapping(baseMarkdown, plan, mapping, { cover: coverRelative, invalidCover: 'placeholder' });
      const rendered = await renderArticle(rewritten);
      await api.workspace.writeText({ path: project.directory + '/article.md', text: rewritten, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/article.html', text: rendered.html, overwrite: true });
      await api.workspace.writeText({ path: project.directory + '/img-plan.json', text: JSON.stringify({ ...plan, generated: mapping, batchId: value.id }, null, 2), overwrite: true });
      await saveArticle(api, project.directory, {
        ...(coverPath ? {
          cover_image: coverPath.slice(project.directory.length + 1),
          pic_crop_235_1: cover235Path.slice(project.directory.length + 1),
          pic_crop_1_1: cover11Path.slice(project.directory.length + 1),
        } : {}),
        image_medium: plan.medium,
        cover_image_style: plan.cover.style,
      });
      for (const entry of generated) await api.workspace.remove({ path: entry.path }).catch(() => {});
    } catch (error) {
      if (previousMarkdown) await api.workspace.writeText({ path: project.directory + '/article.md', text: previousMarkdown, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/article.md' }).catch(() => {});
      if (previousHtml) await api.workspace.writeText({ path: project.directory + '/article.html', text: previousHtml, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/article.html' }).catch(() => {});
      if (previousPlan) await api.workspace.writeText({ path: project.directory + '/img-plan.json', text: previousPlan, overwrite: true }).catch(() => {});
      else await api.workspace.remove({ path: project.directory + '/img-plan.json' }).catch(() => {});
      if (previousArticle) await api.workspace.writeText({ path: project.directory + '/article.yaml', text: previousArticle, overwrite: true }).catch(() => {});
      for (const path of createdFiles.reverse()) {
        await api.workspace.remove({ path }).catch(() => {});
      }
      throw error;
    }
    const missing = (coverEntry || savedCover ? 0 : 1) + generatedItems.filter((item: any) => !mapping[item.index]).length;
    generatedMapping.current = mapping;
    await onReload().catch(() => {});
    setPreviews(previewsFromMapping(mapping, coverPath));
    setMessage('图片已写入文章目录并更新正文。');
    return { missing };
  }

  const retryable = batch?.items?.filter((item: any) => ['failed', 'save-failed'].includes(item.state)) || [];
  const unknown = batch?.items?.filter((item: any) => item.state === 'unknown') || [];
  const unknownCount = Object.values(statuses).filter(item => item.state === 'unknown').length || unknown.length;
  const pendingSlots = (plan?.items || []).filter((item: any) => /^placeholder(?:-|$)/i.test(String(item.src || '')));

  async function saveSelection() {
    const patch: Record<string, string> = {};
    if (coverImageStyle && coverImageStyle !== String(project.article.cover_image_style || '').trim()) {
      patch.cover_image_style = coverImageStyle;
    }
    if (medium && medium !== String(project.article.image_medium || '').trim()) {
      patch.image_medium = medium;
    }
    if (Object.keys(patch).length) await saveArticle(api, project.directory, patch);
  }

  async function saveAndContinue(next: boolean) {
    try {
      await saveSelection();
    } catch (error) {
      notify(errorText(error), 'danger');
      return;
    }
    if (next) onNext();
    else onSaved();
  }

  const coverTarget: ImageTarget = { kind: 'cover' };
  const coverPreview = previewForTarget(coverTarget);
  const coverHasMedia = Boolean(plan?.cover?.generate || coverPreview) || imageSource === 'user';
  const singleDisabled = !plan || planning || busy
    || (imageGenerator === 'model' ? !modelId : (!mcpReady || !config.mcp_image_tool));

  return (
    <div>
      <StageHeader title="配图" description="12 种封面、8 种正文形态、8 种统一媒介。信息位必须使用文章真实内容，实证图必须由你提供。" />
      <div className="form-grid form-grid-3">
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
        <Field label="封面形态">
          <select value={coverImageStyle || plan?.cover?.style || ''} onChange={event => setCoverImageStyle(event.target.value)}>
            {COVER_STYLES.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="本篇统一媒介">
          <select value={medium || plan?.medium || ''} onChange={event => setMedium(event.target.value)}>
            {IMAGE_MEDIA.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
      </div>
      {imageGenerator === 'model' && !imageModels.length ? <div className="notice warning">没有读取到图片模型。请先在「设置 → AI」配置共享图片 Key，或在兼容服务中提供生图模型。</div> : null}
      {imageGenerator === 'mcp' && !mcpReady ? <div className="notice warning">配置中的 MCP 服务当前不可用，请到配置中心重新选择并确认连接状态。</div> : null}
      {imageGenerator === 'mcp' && imageSource !== 'user' ? <div className="notice info">本篇通过 MCP 工具生图。首次调用会请求你单独授权该工具；工具可能产生费用，请确认后再继续。</div> : null}
      {plan ? (
        <>
          <div className="image-plan">
            <article className={'plan-card cover-plan' + (coverHasMedia ? ' has-media' : '')}>
              <div className="plan-card-body">
                <Badge tone="accent">封面</Badge>
                <strong>{plan.cover.style}</strong>
                <p>文案：{plan.cover.copy} · {plan.cover.aspect}</p>
                <details><summary>提示词</summary><pre>{plan.cover.prompt}</pre></details>
              </div>
              {coverHasMedia ? (
                <div className="plan-card-media">
                  <TargetStatusBadge status={statuses[imageTargetKey(coverTarget)]} hasImage={Boolean(coverPreview)} generated={Boolean(plan.cover.generate)} />
                  <PlanThumb image={coverPreview} onOpen={openPreview} />
                  {plan.cover.generate ? (
                    <Button
                      type="button"
                      variant={coverPreview ? 'secondary' : 'primary'}
                      busy={generatingKey === imageTargetKey(coverTarget)}
                      disabled={singleDisabled}
                      aria-label={(coverPreview ? '重新生成封面' : '生成封面')}
                      onClick={() => void generateSingle(coverTarget)}
                    >
                      {coverPreview ? '重新生成' : '生成'}
                    </Button>
                  ) : coverPreview ? <small className="plan-card-source-note">你提供的封面</small> : null}
                  <TargetError status={statuses[imageTargetKey(coverTarget)]} />
                </div>
              ) : null}
            </article>
            {plan.items.map((item: any) => {
              const target: ImageTarget = { kind: 'body', index: item.index };
              const key = imageTargetKey(target);
              const image = previewForTarget(target);
              const hasMedia = Boolean(item.generate || image) || imageSource === 'user';
              return (
                <article
                  className={'plan-card'
                    + (hasMedia ? ' has-media' : '')
                    + (/^placeholder(?:-|$)/i.test(String(item.src || '')) ? ' plan-card-pending' : '')}
                  key={item.index}
                >
                  <div className="plan-card-body">
                    <span className="plan-card-top">
                      <Badge tone={item.role === '信息位' ? 'warning' : 'neutral'}>{item.role}</Badge>
                      <Badge tone="neutral">{item.style}</Badge>
                      {/^placeholder(?:-|$)/i.test(String(item.src || '')) ? <Badge tone="warning">待补图</Badge> : null}
                    </span>
                    <strong>{item.alt}</strong>
                    <p>{item.generate ? (image ? '已生成，可单独重做' : '将生成') : (image ? '已导入你提供的图片' : '需要你提供真实截图或照片')}</p>
                    <details><summary>提示词</summary><pre>{item.prompt}</pre></details>
                  </div>
                  {hasMedia ? (
                    <div className="plan-card-media">
                      <TargetStatusBadge status={statuses[key]} hasImage={Boolean(image)} generated={Boolean(item.generate)} />
                      <PlanThumb image={image} onOpen={openPreview} />
                      {item.generate ? (
                        <Button
                          type="button"
                          variant={image ? 'secondary' : 'primary'}
                          busy={generatingKey === key}
                          disabled={singleDisabled}
                          aria-label={(image ? '重新生成' : '生成') + targetLabel(target)}
                          onClick={() => void generateSingle(target)}
                        >
                          {image ? '重新生成' : '生成'}
                        </Button>
                      ) : image ? <small className="plan-card-source-note">你提供的图片</small> : null}
                      <TargetError status={statuses[key]} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {plan.warnings.length ? <div className="notice warning">{plan.warnings.map((item: string) => <p key={item}>{item}</p>)}</div> : null}
          {pendingSlots.length ? (
            <div className="notice warning">
              <p>还有 {pendingSlots.length} 个正文图位没有图片，进入终审后会被标记为未通过：</p>
              <ul>{pendingSlots.map((item: any) => <li key={item.index}>{item.alt}</li>)}</ul>
              <p>可以在对应卡片单独生成，或到排版阶段删除不需要的图位。</p>
            </div>
          ) : null}
        </>
      ) : <div className="loading-inline"><span className="spinner" /> 正在规划图片…</div>}
      {message ? <div className="notice info">{message}</div> : null}
      <div className="toolbar toolbar-end">
        {imageSource === 'user' ? (
          <>
            <Button type="button" onClick={() => void importUserCover()} busy={busy} disabled={!plan || planning}>导入封面</Button>
            <Button type="button" variant="primary" onClick={() => void importUserBodyImages()} busy={busy} disabled={!plan || !plan.items.length || planning}>导入正文图片</Button>
          </>
        ) : (
          <>
            {imageGenerator === 'mcp' && mcpWaiting ? <Button type="button" variant="danger" onClick={() => mcpAbort.current?.abort()}>停止等待</Button> : null}
            {imageGenerator === 'model' && retryable.length ? <Button type="button" variant="danger" onClick={() => void generate('retry')} busy={busy} disabled={planning}>明确重试失败项</Button> : null}
            <Button
              type="button"
              variant="primary"
              onClick={() => void generate('new')}
              busy={busy}
              disabled={!plan || planning || (imageGenerator === 'model' ? !modelId : (!mcpReady || !config.mcp_image_tool)) || batch?.state === 'running' || batch?.state === 'canceling'}
            >
              {batch || previews.length ? (imageGenerator === 'mcp' ? '重新生成全部图片（会再次调用成功项）' : '重新生成全部图片') : '生成封面与正文配图'}
            </Button>
          </>
        )}
      </div>
      {imageSource === 'user' ? <div className="notice info">本篇使用你提供的图片，不会调用生图模型。封面先导入一张，正文图片按图位顺序批量导入。</div> : null}
      {imageSource !== 'user' ? <div className="notice info">每张卡片都可以单独生成或重做，只调用该图，不会重发其他成功项。</div> : null}
      {unknownCount ? <div className="notice warning">有 {unknownCount} 张图结果未知，不会自动重发。请先检查宿主后台任务（MCP 模式的记录在批次目录 mcp-generation.json），再在对应卡片单独生成。</div> : null}
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => void saveAndContinue(false)} disabled={busy}>仅保存状态</Button>
        <Button type="button" variant="primary" onClick={() => void saveAndContinue(true)} disabled={busy}>确认配图，进入终审</Button>
      </div>
      {preview ? (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <div className="media-stage"><img src={preview.url} alt={preview.title} /></div>
        </Modal>
      ) : null}
    </div>
  );
}

function PlanThumb({ image, onOpen }: { image: PreviewImage | null; onOpen: (image: PreviewImage) => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!image) {
      setUrl('');
      return () => {
        cancelled = true;
      };
    }
    void api.workspace.url({ path: image.path }).then((value: string) => {
      if (!cancelled) setUrl(String(value));
    }).catch(() => {
      if (!cancelled) setUrl('');
    });
    return () => {
      cancelled = true;
    };
  }, [image?.path]);
  if (!image) {
    return <div className="plan-thumb-empty" aria-label="还没有生成图片">图</div>;
  }
  return (
    <button
      type="button"
      className="plan-thumb"
      onClick={() => onOpen(image)}
      title="点击查看大图"
      aria-label={'查看' + image.title + '大图'}
    >
      {url ? <img src={url} alt={image.title} loading="lazy" /> : <span className="image-placeholder" />}
    </button>
  );
}

function TargetStatusBadge({ status, hasImage, generated = true }: { status?: ImageTargetStatus; hasImage: boolean; generated?: boolean }) {
  if (!generated) return <Badge tone={hasImage ? 'success' : 'neutral'}>{hasImage ? '已导入' : '待导入'}</Badge>;
  const state = status?.state || (hasImage ? 'succeeded' : '');
  if (!state) return <Badge tone="neutral">待生成</Badge>;
  const tone = state === 'succeeded'
    ? 'success'
    : ['failed', 'save-failed', 'unknown'].includes(state)
      ? 'danger'
      : state === 'running'
        ? 'accent'
        : 'neutral';
  return <Badge tone={tone}>{batchState(state)}</Badge>;
}

function TargetError({ status }: { status?: ImageTargetStatus }) {
  if (!status?.error || status.state === 'succeeded') return null;
  return (
    <small className="plan-card-error" title={status.error}>
      {status.error}{status.taskId ? ' · 任务 ID：' + status.taskId : ''}
    </small>
  );
}

function batchState(state: string) {
  return {
    pending: '等待', running: '生成中', succeeded: '已生成', failed: '生成失败',
    'save-failed': '保存失败', unknown: '结果未知', interrupted: '已中断',
    canceled: '已停止',
  }[state] || state;
}

function FinalStage({
  project, config, accounts, notify, onSaved, onNext, onGoStage, onEditMeta, onGoConfig,
}: {
  project: ArticleProject; config: Record<string, any>; accounts: WechatAccount[]; notify: Notify;
  onSaved: () => void; onNext: () => void;
  onGoStage: (stage: string) => void;
  onEditMeta: (field: 'title' | 'author' | 'digest') => void;
  onGoConfig: () => void;
}) {
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const gate = buildPublicationGate(project, review);
  useEffect(() => {
    setReview(reviewArticle(project.files.format || project.files.writing, config, {
      html: project.files.html,
      title: project.article.title,
      cover: hasSavedCover(project) ? project.article.cover_image : '',
    }));
  }, [project.directory, project.files.format, project.files.html, project.article.title, project.article.cover_image, project.entries, config]);

  function gateFix(item: any) {
    if (item.ok) return null;
    if (item.meta) {
      return { label: '编辑' + item.label, onClick: () => onEditMeta(item.meta) };
    }
    if (item.stage === 'meta-title') {
      return { label: '编辑标题', onClick: () => onEditMeta('title') };
    }
    if (item.stage === 'config') {
      return { label: '去配置中心', onClick: onGoConfig };
    }
    if (item.stage) {
      return { label: '去' + STAGE_LABELS[item.stage] + '处理', onClick: () => onGoStage(item.stage) };
    }
    return null;
  }

  function issueFix(item: any) {
    const stage = reviewIssueStage(item.category);
    if (stage === 'meta-title') return { label: '编辑标题', onClick: () => onEditMeta('title') };
    if (stage === 'config') return { label: '去配置中心', onClick: onGoConfig };
    return stage ? { label: '去' + STAGE_LABELS[stage] + '处理', onClick: () => onGoStage(stage) } : null;
  }

  async function save(next: boolean) {
    setBusy(true);
    try {
      const report = '# 终审门禁\n\n' + gate.items.map(item => '- [' + (item.ok ? '通过' : '未通过') + '] ' + item.label + (item.detail ? '：' + item.detail : '')).join('\n') + '\n';
      await api.workspace.writeText({ path: project.directory + '/final-review.md', text: report, overwrite: true });
      if (next && !gate.ok) {
        notify('终审还有未通过项，请处理后继续。', 'warning');
        return;
      }
      next ? onNext() : onSaved();
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="终审" description="检查标题、作者、摘要、封面、HTML、正文图片、占位符、嵌入定义和阻断级审稿项。" />
      <div className="gate-list">
        {gate.items.map(item => {
          const fix = gateFix(item);
          return (
            <div key={item.label} className={item.ok ? 'gate-ok' : 'gate-block'}>
              <span aria-hidden="true">{item.ok ? '✓' : '!'}</span>
              <div>
                <strong>{item.label}</strong>
                {item.detail ? <small>{item.detail}</small> : null}
                {fix ? <Button type="button" variant="ghost" className="fix-button" onClick={fix.onClick}>{fix.label}</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {review ? <ReviewSummary review={review} fixFor={issueFix} /> : null}
      {!accounts.length ? <div className="notice warning">尚未在底座设置中添加公众号账号。终审仍可完成，但无法创建草稿。</div> : null}
      <div className="toolbar toolbar-end">
        <Button type="button" onClick={() => setReview(reviewArticle(project.files.format || project.files.writing, config, {
          html: project.files.html,
          title: project.article.title,
          cover: hasSavedCover(project) ? project.article.cover_image : '',
        }))}>重新检查</Button>
        <Button type="button" onClick={() => void save(false)} busy={busy}>仅保存终审</Button>
        <Button type="button" variant="primary" onClick={() => void save(true)} busy={busy}>通过终审，进入发布</Button>
      </div>
    </div>
  );
}

async function publicationFingerprint(project: ArticleProject) {
  const html = project.files.html || '';
  const localSources = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(source => !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith('//'))
    .map(source => project.directory + '/' + source.replace(/^\.\//, ''));
  const assets = [...new Set(localSources)].map(path => {
    const entry = project.entries.find(item => item.path === path && item.kind === 'file');
    return entry ? { path, size: entry.size || 0, mtime: entry.mtime } : { path, missing: true };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const payload = JSON.stringify({
    title: project.article.title || '',
    author: project.article.author || '',
    digest: project.article.digest || '',
    cover: project.article.cover_image || '',
    html,
    assets,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function PublishStage({
  project, config, accounts, accountId: preferredAccountId, notify, onSaved,
}: {
  project: ArticleProject; config: Record<string, any>; accounts: WechatAccount[]; accountId: string; notify: Notify;
  onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(preferredAccountId || accounts[0]?.id || '');
  const initialReceipt: Record<string, any> = (() => {
    try {
      return JSON.parse(project.files.publish || '{}');
    } catch {
      return {};
    }
  })();
  const [receipt, setReceipt] = useState<Record<string, any>>(initialReceipt);
  const receiptRef = useRef<Record<string, any>>(initialReceipt);
  const [mediaId, setMediaId] = useState(String(initialReceipt.mediaId || ''));
  const [publishId, setPublishId] = useState(String(initialReceipt.publishId || ''));
  const [fingerprint, setFingerprint] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState(false);
  const review = reviewArticle(project.files.format || project.files.writing, config, {
    html: project.files.html,
    title: project.article.title,
    cover: hasSavedCover(project) ? project.article.cover_image : '',
  });
  const gate = buildPublicationGate(project, review);
  const publishMethod = String(project.article.publish_method || config.publish_method || 'draft');
  const draftEnabled = publishMethod !== 'none';
  const draftState = String(receipt.state || '');
  const draftBlocked = ['creating-draft', 'draft-unknown', 'submitting', 'unknown'].includes(draftState);
  const draftMatches = Boolean(
    mediaId
    && receipt.mediaId === mediaId
    && receipt.accountId === accountId
    && receipt.articleFingerprint
    && receipt.articleFingerprint === fingerprint,
  );

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accountId, accounts]);
  useEffect(() => {
    let next: Record<string, any> = {};
    try {
      next = JSON.parse(project.files.publish || '{}');
    } catch {
      next = {};
    }
    setReceipt(next);
    receiptRef.current = next;
    setMediaId(String(next.mediaId || ''));
    setPublishId(String(next.publishId || ''));
  }, [project.files.publish]);
  useEffect(() => {
    let active = true;
    void publicationFingerprint(project).then(value => {
      if (active) setFingerprint(value);
    }).catch(error => {
      if (active) {
        setFingerprint('');
        notify('无法计算文章指纹：' + errorText(error), 'danger');
      }
    });
    return () => {
      active = false;
    };
  }, [project, notify]);

  async function persist(patch: Record<string, any>) {
    const next: Record<string, any> = { ...receiptRef.current, ...patch, updatedAt: new Date().toISOString() };
    const text = JSON.stringify(next, null, 2);
    await api.workspace.writeText({ path: project.directory + '/publish.json', text, overwrite: true });
    receiptRef.current = next;
    setReceipt(next);
    if (next.mediaId !== undefined) setMediaId(String(next.mediaId || ''));
    if (next.publishId !== undefined) setPublishId(String(next.publishId || ''));
  }

  function wechatPayload() {
    const html = project.files.html;
    const assets: Array<{ placeholder: string; path: string }> = [];
    let counter = 0;
    const content = html.replace(/<img([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>/gi, (_match, before, src, after) => {
      if (/^https?:/i.test(src)) throw new Error('正文不能包含外链图片。');
      const assetPath = project.directory + '/' + src.replace(/^\.\//, '');
      const placeholder = 'asset-' + (++counter);
      assets.push({ placeholder, path: assetPath });
      return '<img' + before + ' src="qingzuo-asset:' + placeholder + '"' + after + '>';
    });
    return {
      accountId,
      article: {
        articleDir: project.directory,
        title: String(project.article.title || ''),
        author: String(project.article.author || ''),
        digest: String(project.article.digest || ''),
        html: content,
        cover: { placeholder: 'cover', path: project.directory + '/' + project.article.cover_image },
        assets,
        needOpenComment: Boolean(project.article.need_open_comment ?? config.need_open_comment),
        onlyFansCanComment: Boolean(project.article.only_fans_can_comment ?? config.only_fans_can_comment),
      },
    };
  }

  async function createDraft() {
    if (!gate.ok) {
      notify('发布前门禁未通过，请回到终审检查。', 'warning');
      return;
    }
    if (!accountId) {
      notify('请选择公众号账号。', 'warning');
      return;
    }
    if (!draftEnabled) {
      notify('当前配置为只保存到本地，不会创建公众号草稿。', 'warning');
      return;
    }
    if (draftBlocked) {
      notify('上次草稿或发布状态未知，请先在公众号后台核对，再明确重置状态。', 'warning');
      return;
    }
    setBusy(true);
    const currentFingerprint = fingerprint || await publicationFingerprint(project);
    try {
      await persist({
        accountId,
        title: project.article.title,
        mediaId: null,
        publishId: null,
        state: 'creating-draft',
        articleFingerprint: currentFingerprint,
        error: null,
      });
      const result = await api.wechat.createDraft(wechatPayload());
      setMediaId(result.mediaId);
      await persist({
        accountId,
        mediaId: result.mediaId,
        publishId: null,
        state: 'draft',
        title: project.article.title,
        articleFingerprint: currentFingerprint,
        error: null,
      });
      await onSaved();
      notify('公众号草稿已创建。请先在后台核对，再决定是否发布。', 'success');
    } catch (error) {
      await persist({ state: 'draft-unknown', error: errorText(error) }).catch(() => {});
      notify('草稿创建结果不确定或失败：' + errorText(error) + '。请先在公众号后台核对，避免重复创建。', 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
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
    const latestReview = reviewArticle(project.files.format || project.files.writing, config, {
      html: project.files.html,
      title: project.article.title,
      cover: hasSavedCover(project) ? project.article.cover_image : '',
    });
    const latestGate = buildPublicationGate(project, latestReview);
    if (!latestGate.ok) {
      notify('发布前门禁未通过，请重新检查文章、封面和审稿问题。', 'warning');
      return;
    }
    const currentFingerprint = await publicationFingerprint(project);
    if (!draftMatches || receipt.articleFingerprint !== currentFingerprint) {
      notify('草稿创建后文章内容已变化，或草稿不属于当前账号。请重新创建草稿并核对。', 'danger');
      return;
    }
    setBusy(true);
    try {
      await persist({ accountId, mediaId, state: 'submitting', publishId: null, error: null });
      const result = await api.wechat.publish({ accountId, mediaId });
      setPublishId(result.publishId);
      await persist({ accountId, mediaId, publishId: result.publishId, state: 'submitted' });
      notify('发布已提交，正在查询状态。', 'success');
      await queryStatus(result.publishId);
    } catch (error) {
      const message = errorText(error);
      if (/取消|cancel/i.test(message)) {
        await persist({ accountId, mediaId, state: 'draft', error: null }).catch(() => {});
        notify('发布已取消，草稿仍保留。', 'info');
      } else {
        await persist({ accountId, mediaId, state: 'unknown', error: message }).catch(() => {});
        notify('发布结果未知：' + message + '。请先查询状态，不要重复提交。', 'danger');
      }
    } finally {
      setBusy(false);
    }
  }

  async function queryStatus(id = publishId) {
    if (!id && !mediaId) return;
    setBusy(true);
    try {
      const value = await api.wechat.publishStatus({ accountId, ...(id ? { publishId: id } : { mediaId }) });
      setStatus(value);
      if (value.publishId) setPublishId(value.publishId);
      await persist({
        accountId,
        mediaId,
        publishId: value.publishId || id || null,
        state: value.status,
        articleUrl: value.articleUrl,
        error: value.error || null,
      });
      notify(value.status === 'success' ? '文章已发布。' : value.status === 'pending' ? '文章仍在发布队列中。' : '发布未成功，请查看状态。', value.status === 'failed' ? 'danger' : 'info');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function resetUnknownState() {
    if (!draftBlocked) return;
    if (!window.confirm('请确认已在公众号后台核对草稿或发布状态。重置后再次操作仍可能造成重复，是否继续？')) return;
    await persist({ state: 'draft-reset', error: null, articleFingerprint: '', publishId: null }).catch(error => {
      notify(errorText(error), 'danger');
    });
    setMediaId('');
    setPublishId('');
    notify('本地未知状态已重置。请重新创建草稿并核对。', 'warning');
  }

  async function archiveProject() {
    const publishedRoot = String(config.published_root || 'posts/published').replace(/\/+$/, '');
    const name = project.directory.split('/').pop();
    const target = publishedRoot + '/' + name;
    if (!window.confirm('归档会移动当前文章目录到 ' + target + '。确认继续？')) return;
    if (project.entries.some(entry => entry.path === target)) {
      notify('归档目录已存在，不会覆盖。', 'danger');
      return;
    }
    setBusy(true);
    try {
      await api.workspace.rename({ from: project.directory, to: target });
      notify('项目已归档到 ' + target + '。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StageHeader title="草稿与发布" description="草稿默认调用 draft/add；直接发布由宿主原生确认，结果未知时先查询，不重复提交。" />
      <div className="form-grid">
        <Field label="公众号账号">
          <select value={accountId} onChange={event => setAccountId(event.target.value)}>
            {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.appIdMasked}</option>)}
          </select>
        </Field>
        <Field label="发布方式">
          <div className="static-field">{String(project.article.publish_method || config.publish_method) === 'published' ? '提交直接发布' : '仅创建草稿'}</div>
        </Field>
      </div>
      {!accounts.length ? (
        <div className="notice warning">请在底座「设置 → 能力连接 → 公众号」录入账号。插件只看到名称和掩码 AppID。</div>
      ) : null}
      {mediaId ? <div className="receipt"><span>草稿 mediaId</span><code>{mediaId}</code></div> : null}
      {publishId ? <div className="receipt"><span>发布标识</span><code>{publishId}</code></div> : null}
      {receipt.error ? <div className="notice warning">{String(receipt.error)}</div> : null}
      {mediaId && !draftMatches && receipt.articleFingerprint ? <div className="notice warning">草稿创建后文章内容或账号已变化，请重新创建草稿。</div> : null}
      {draftBlocked ? (
        <div className="notice warning">
          上次操作的结果未知。请先在公众号后台核对；确认后才能查询状态或明确重置。插件不会自动重发。
          <Button type="button" onClick={() => void resetUnknownState()}>我已核对，重置未知状态</Button>
        </div>
      ) : null}
      {status ? <div className="receipt"><span>状态</span><strong>{status.status}</strong>{status.articleUrl ? <a href={status.articleUrl} target="_blank" rel="noreferrer">查看文章</a> : null}</div> : null}
      <div className="publish-actions">
        <Button type="button" variant="primary" onClick={() => void createDraft()} busy={busy} disabled={!gate.ok || !accountId || draftBlocked || !draftEnabled}>
          创建公众号草稿
        </Button>
        <Button type="button" onClick={() => void publish()} busy={busy} disabled={!mediaId || Boolean(publishId) || draftBlocked || !draftMatches || publishMethod !== 'published'}>
          提交直接发布
        </Button>
        <Button type="button" onClick={() => void queryStatus()} busy={busy} disabled={!publishId && !(mediaId && ['submitting', 'unknown', 'submitted'].includes(draftState))}>查询发布状态</Button>
      </div>
      {publishMethod !== 'published' ? <div className="notice info">当前发布方式为仅创建草稿。需要直接发布时，请先在配置中心改为“提交直接发布”。</div> : null}
      <div className="archive-box">
        <label><input type="checkbox" checked={archive} onChange={event => setArchive(event.target.checked)} /> 发布成功后手动归档到 {String(config.published_root || 'posts/published')}</label>
        <Button type="button" onClick={() => void archiveProject()} disabled={!archive || status?.status !== 'success' || busy}>归档当前项目</Button>
      </div>
      <details className="danger-zone">
        <summary>发布前门禁明细</summary>
        <div className="gate-list compact">
          {gate.items.map(item => (
            <div key={item.label} className={item.ok ? 'gate-ok' : 'gate-block'}>
              <span>{item.ok ? '✓' : '!'}</span><div><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function formatTime(value: number) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
