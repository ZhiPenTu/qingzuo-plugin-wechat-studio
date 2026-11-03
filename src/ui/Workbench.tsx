import { useMemo, useState } from 'react';
import { api, errorText } from './client';
import { Button, Empty, Field } from './common';
import { McpPanel } from './McpPanel';
import { createProject, loadProject, saveStage } from '../lib/project.mjs';
import type { ArticleProject, McpServer, Notice, ProjectSummary } from './types';

type EntryMode = 'full' | 'rewrite' | 'new' | 'paste' | 'wechat' | 'continue';

const ENTRIES: Array<{ value: EntryMode; title: string; description: string }> = [
  { value: 'full', title: '完整流程', description: '从选题、调研到排版、配图与发布，每一步确认后进入下一阶段。' },
  { value: 'rewrite', title: '改写文章', description: '导入 Markdown 或纯文本，按账号规范和指定要求重写。' },
  { value: 'new', title: '新写文章', description: '只给一个题目，直接按配置生成完整文章。' },
  { value: 'paste', title: '粘贴文本', description: '手工提供正文素材，再从写稿或审稿开始。' },
  { value: 'wechat', title: '公众号链接', description: '通过已授权的 MCP 网页读取工具获取正文；失败时回退到粘贴。' },
  { value: 'continue', title: '继续已有草稿', description: '从本地 drafts/ 目录恢复项目，接续未完成的阶段。' },
];

export function Workbench({
  config,
  projects,
  servers,
  onOpenProject,
  onChanged,
  onPickWorkspace,
  setPage,
  notify,
}: {
  config: Record<string, any>;
  projects: ProjectSummary[];
  servers: McpServer[];
  onOpenProject: (project: ArticleProject) => void;
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

  const selectedEntry = useMemo(() => ENTRIES.find(item => item.value === mode), [mode]);

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
      const created = await createProject(api, {
        title: derivedTitle,
        mode,
        source: source || linkText || url,
        initialStage,
        draftsRoot: config.drafts_root || 'drafts',
      });
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
      onOpenProject(project as unknown as ArticleProject);
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
            <h2>选择入口</h2>
            <p>完整流程适合从零开始；改写和粘贴适合已有长文。</p>
          </div>
        </div>
        <div className="entry-grid" role="radiogroup" aria-label="创作入口">
          {ENTRIES.map(entry => (
            <button
              type="button"
              key={entry.value}
              role="radio"
              aria-checked={mode === entry.value}
              className={'entry-card' + (mode === entry.value ? ' active' : '')}
              onClick={() => setMode(entry.value)}
            >
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
            </button>
          ))}
        </div>
      </section>

      {mode === 'continue' ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>继续已有草稿</h2>
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
                      onOpenProject(await loadProject(api, project.directory) as unknown as ArticleProject);
                      setPage('projects');
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
              <h2>{selectedEntry?.title}</h2>
              <p>{selectedEntry?.description}</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="文章标题" hint="会用于创建 drafts/YYYYMMDD-slug/。">
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：公众号配置一次就够" />
            </Field>
            {mode === 'full' || mode === 'new' ? (
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

      <section className="quick-grid">
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
        <button type="button" className="quick-card" onClick={() => setPage('stickers')}>
          <strong>贴图工作流</strong>
          <span>1–9 张统一风格的图片和逐图配文</span>
        </button>
      </section>
    </div>
  );
}

function stageName(id: string) {
  return {
    topic: '选题', research: '调研', writing: '写稿', review: '内容审',
    format: '排版', images: '配图', final: '终审', publish: '发布',
  }[id] || id;
}
