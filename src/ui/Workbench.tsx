import { useMemo, useState } from 'react';
import { api, errorText } from './client';
import { Button, Empty, Field } from './common';
import { McpPanel } from './McpPanel';
import { createProject, loadProject, saveStage } from '../lib/project.mjs';
import type { ArticleProject, McpServer, ProjectSummary } from './types';

type EntryMode = 'full' | 'rewrite' | 'new' | 'paste' | 'wechat' | 'continue';
type SourceId = 'idea' | 'existing' | 'continue';

type ModeChoice = { value: EntryMode; title: string; description: string };
type SourceChoice = { id: SourceId; title: string; description: string; defaultMode: EntryMode };

const SOURCES: SourceChoice[] = [
  { id: 'idea', title: '从想法开始', description: '给一个题目或方向，从选题一路写到可发布。', defaultMode: 'full' },
  { id: 'existing', title: '导入或粘贴已有正文', description: '已经有稿子：粘贴正文、从文件导入，或读取公众号链接后改写。', defaultMode: 'paste' },
  { id: 'continue', title: '继续作品', description: '从本地 drafts/ 恢复未完成的项目，接着上次的阶段继续。', defaultMode: 'continue' },
];

const IDEA_MODES: ModeChoice[] = [
  { value: 'full', title: '完整流程', description: '选题、调研、写稿、内容审、排版、配图与发布，每一步确认后进入下一阶段。' },
  { value: 'new', title: '直接写正文', description: '只给题目和方向，直接按当前写作规范生成完整文章。' },
];

const EXISTING_MODES: ModeChoice[] = [
  { value: 'paste', title: '粘贴正文', description: '手工粘贴或从文件导入正文，再从写稿或内容审开始。' },
  { value: 'rewrite', title: '改写已有文章', description: '导入 Markdown 或纯文本，按账号规范和指定要求重写。' },
  { value: 'wechat', title: '公众号链接', description: '通过已授权的 MCP 网页读取工具获取正文；失败时回退到粘贴。' },
];

const SOURCE_OF_MODE: Record<EntryMode, SourceId> = {
  full: 'idea',
  new: 'idea',
  rewrite: 'existing',
  paste: 'existing',
  wechat: 'existing',
  continue: 'continue',
};

function stageName(id: string) {
  return {
    topic: '选题', research: '调研', writing: '写稿', review: '内容审',
    format: '排版', images: '配图', final: '终审', publish: '发布',
  }[id] || id;
}

function ModeCards({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: ModeChoice[];
  value: EntryMode;
  onChange: (mode: EntryMode) => void;
}) {
  return (
    <div className="entry-grid" role="radiogroup" aria-label={label}>
      {choices.map(choice => (
        <button
          type="button"
          key={choice.value}
          role="radio"
          aria-checked={value === choice.value}
          className={'entry-card' + (value === choice.value ? ' active' : '')}
          onClick={() => onChange(choice.value)}
        >
          <strong>{choice.title}</strong>
          <span>{choice.description}</span>
        </button>
      ))}
    </div>
  );
}

export function Workbench({
  config,
  projects,
  servers,
  workspaceEpoch,
  onOpenProject,
  onChanged,
  onPickWorkspace,
  setPage,
  notify,
}: {
  config: Record<string, any>;
  projects: ProjectSummary[];
  servers: McpServer[];
  workspaceEpoch: number;
  onOpenProject: (project: ArticleProject, epoch?: number) => void;
  onChanged: () => Promise<void>;
  onPickWorkspace: () => Promise<void>;
  setPage: (page: 'projects' | 'config' | 'assets' | 'stickers') => void;
  notify: (text: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void;
}) {
  const [mode, setMode] = useState<EntryMode>('full');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [source, setSource] = useState('');
  const [instruction, setInstruction] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkText, setLinkText] = useState('');

  const sourceId = SOURCE_OF_MODE[mode];
  const selectedSource = useMemo(
    () => SOURCES.find(item => item.id === sourceId) || SOURCES[0],
    [sourceId],
  );

  function selectSource(id: SourceId) {
    setMode(current => {
      if (SOURCE_OF_MODE[current] === id) return current;
      const target = SOURCES.find(item => item.id === id);
      return target ? target.defaultMode : current;
    });
  }

  async function start() {
    const derivedTitle = title.trim() || topic.trim().slice(0, 40) || (mode === 'wechat' ? '公众号文章改写' : '');
    if (!derivedTitle) {
      notify('请填写文章标题或主题。', 'warning');
      return;
    }
    if ((mode === 'rewrite' || mode === 'paste' || mode === 'wechat') && !source.trim() && !linkText.trim()) {
      notify('请提供要处理的正文字本。', 'warning');
      return;
    }
    setBusy(true);
    try {
      const initialStage = mode === 'full' ? 'topic' : 'writing';
      const options = {
        title: derivedTitle,
        mode,
        source: source || linkText || url,
        topic: topic.trim(),
        initialStage,
        draftsRoot: config.drafts_root || 'drafts',
      };
      const created = await createProject(api, options);
      const initialSource = mode === 'wechat' ? linkText : source;
      if (initialSource.trim()) {
        await api.workspace.writeText({
          path: created.directory + '/draft.md',
          text: initialSource.trim(),
          overwrite: true,
        });
        await saveStage(api, created.directory, 'writing', initialSource.trim(), { complete: false, next: false });
      }
      if (mode === 'rewrite' && instruction.trim()) {
        await api.workspace.writeText({
          path: created.directory + '/rewrite-instruction.md',
          text: instruction.trim(),
          overwrite: false,
        });
      }
      const project = await loadProject(api, created.directory);
      await onChanged();
      onOpenProject(project as unknown as ArticleProject, workspaceEpoch);
      notify(mode === 'full' ? '项目已创建，从选题开始。' : '素材已保存，可继续生成或编辑。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page workbench-page">
      <header className="page-header">
        <div>
          <h1>创作工作台</h1>
          <p>从本地工作区开始，草稿、预设和历史都由你保管。</p>
        </div>
        <Button type="button" onClick={onPickWorkspace}>更换工作文件夹</Button>
      </header>

      <section className="entry-section">
        <div className="section-heading">
          <div>
            <h2>文章</h2>
            <p>先选内容来源，再决定是新建一篇还是接着上次写。</p>
          </div>
        </div>
        <div className="entry-grid" role="radiogroup" aria-label="创作入口">
          {SOURCES.map(item => (
            <button
              type="button"
              key={item.id}
              role="radio"
              aria-checked={sourceId === item.id}
              className={'entry-card' + (sourceId === item.id ? ' active' : '')}
              onClick={() => selectSource(item.id)}
            >
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      {sourceId === 'continue' ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>继续作品</h2>
              <p>从工作区的 drafts/ 目录读取。外部修改后可在项目页重新加载。</p>
            </div>
            <Button type="button" onClick={() => void onChanged()}>刷新列表</Button>
          </div>
          {projects.length ? (
            <div className="project-list">
              {projects.slice(0, 8).map(project => (
                <button
                  type="button"
                  className="project-row"
                  key={project.directory}
                  onClick={async () => {
                    try {
                      const loaded = await loadProject(api, project.directory) as unknown as ArticleProject;
                      onOpenProject(loaded, workspaceEpoch);
                    } catch (error) {
                      notify(errorText(error), 'danger');
                    }
                  }}
                >
                  <span>
                    <strong>{project.title}</strong>
                    <small>{project.directory}</small>
                  </span>
                  <span className="project-stage">{stageName(project.stage)}</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty title="还没有本地草稿" description="新建一篇后，项目会出现在 drafts/ 中。" />
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>{selectedSource.title}</h2>
              <p>{selectedSource.description}</p>
            </div>
          </div>
          <ModeCards
            label={sourceId === 'idea' ? '创作方式' : '内容来源方式'}
            choices={sourceId === 'idea' ? IDEA_MODES : EXISTING_MODES}
            value={mode}
            onChange={setMode}
          />
          <div className="form-grid">
            <Field label="文章标题" hint="会用于创建 drafts/YYYYMMDD-slug/。">
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：公众号配置一次就够" />
            </Field>
            {sourceId === 'idea' ? (
              <Field label="主题或既定方向">
                <input value={topic} onChange={event => setTopic(event.target.value)} placeholder="例如：用自动化减少重复排版" />
              </Field>
            ) : null}
          </div>
          {mode === 'rewrite' || mode === 'paste' ? (
            <>
              <Field label="已有正文" hint="支持 Markdown 或纯文本。内容只写入当前文章目录。">
                <textarea value={source} onChange={event => setSource(event.target.value)} rows={10} placeholder="把文章粘贴到这里…" />
              </Field>
              {mode === 'rewrite' ? (
                <Field label="改写要求" hint="例如：保留事实，改成口语化，缩短到 1800 字。">
                  <input value={instruction} onChange={event => setInstruction(event.target.value)} />
                </Field>
              ) : null}
              <div className="toolbar">
                <Button
                  type="button"
                  onClick={async () => {
                    let token = '';
                    try {
                      const file = await api.files.pick({ extensions: ['md', 'markdown', 'txt'] });
                      if (!file) return;
                      token = file.token;
                      const value = await api.files.read(file.token);
                      const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0));
                      const text = new TextDecoder().decode(bytes);
                      setSource(text);
                      if (!title.trim()) setTitle(file.name.replace(/\.(?:md|markdown|txt)$/i, ''));
                    } catch (error) {
                      notify(errorText(error), 'danger');
                    } finally {
                      if (token) await api.files.release(token).catch(() => {});
                    }
                  }}
                >
                  从文件导入
                </Button>
              </div>
            </>
          ) : null}
          {mode === 'wechat' ? (
            <>
              <Field label="公众号文章链接" hint="只读取公开可见内容，不实现微信扫码登录或绕过登录抓取。">
                <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://mp.weixin.qq.com/s/…" />
              </Field>
              <div className="panel-inset">
                <div className="section-heading">
                  <div>
                    <h3>链接读取</h3>
                    <p>选择一个已授权的 MCP 只读工具。默认参数为 URL；工具参数不同可在项目调研页调整。</p>
                  </div>
                </div>
                <McpPanel
                  servers={servers}
                  compact
                  notify={notify}
                  onResult={content => {
                    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    setLinkText(text);
                    if (!title.trim()) setTitle(text.match(/^#\s+(.+)$/m)?.[1]?.trim() || '公众号文章改写');
                  }}
                  defaultArgs={JSON.stringify({ url }, null, 2)}
                />
              </div>
              <Field label="读取失败时手工粘贴正文" hint="不会使用第三方代理或绕过登录。">
                <textarea value={linkText} onChange={event => setLinkText(event.target.value)} rows={8} />
              </Field>
            </>
          ) : null}
          <div className="toolbar toolbar-end">
            <Button type="button" variant="primary" busy={busy} onClick={() => void start()}>
              创建项目
            </Button>
          </div>
        </section>
      )}

      <section className="entry-section">
        <div className="section-heading">
          <div>
            <h2>贴图</h2>
            <p>把一组图片做成统一风格的多图内容，并逐图配文。</p>
          </div>
        </div>
        <button type="button" className="quick-card" onClick={() => setPage('stickers')}>
          <strong>进入贴图工作流</strong>
          <span>1–9 张统一风格的图片和逐图配文，可保存为文章项目或发送到公众号。</span>
        </button>
      </section>

      <section className="entry-section">
        <div className="section-heading">
          <div>
            <h2>常用入口</h2>
            <p>管理已有项目、账号规范和业务素材。</p>
          </div>
        </div>
        <div className="entry-grid">
          <button type="button" className="quick-card" onClick={() => setPage('projects')}>
            <strong>文章项目</strong>
            <span>{projects.length ? projects.length + ' 个本地项目' : '还没有项目'}</span>
          </button>
          <button type="button" className="quick-card" onClick={() => setPage('config')}>
            <strong>配置中心</strong>
            <span>账号、写作规范、主题与发布设置</span>
          </button>
          <button type="button" className="quick-card" onClick={() => setPage('assets')}>
            <strong>业务素材库</strong>
            <span>产品介绍、图片来源与说明</span>
          </button>
        </div>
      </section>
    </div>
  );
}
