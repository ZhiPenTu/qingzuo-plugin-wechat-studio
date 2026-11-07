import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, isMissingError, readOptional } from './client';
import { Button, Empty } from './common';
import { callWorker, disposeWorker } from './worker-client';
import { Workbench } from './Workbench';
import { ProjectsPage } from './ProjectsPage';
import { ConfigPage } from './ConfigPage';
import { AssetsPage } from './AssetsPage';
import { StickerPage } from './StickerPage';
import { EMPTY_PREFERENCES, loadPreferences, type StudioPreferences } from './preferences';
import { loadProject, listProjects } from '../lib/project.mjs';
import { parseYamlObject } from '../lib/config.mjs';
import { mergeImageModels } from '../lib/image-models.mjs';
import { THEME_SUMMARY } from '../presets/index.mjs';
import type {
  ArticleProject,
  ImageModel,
  McpServer,
  ProjectSummary,
  TextModel,
  Toast,
  WechatAccount,
  WorkspaceStatus,
} from './types';

type Page = 'workbench' | 'projects' | 'config' | 'assets' | 'stickers';

const PAGES: Array<{ id: Page; label: string; short: string }> = [
  { id: 'workbench', label: '创作工作台', short: '创作' },
  { id: 'projects', label: '文章项目', short: '项目' },
  { id: 'config', label: '配置中心', short: '配置' },
  { id: 'assets', label: '业务素材库', short: '素材' },
  { id: 'stickers', label: '贴图工作流', short: '贴图' },
];

export function App() {
  const [page, setPage] = useState<Page>('workbench');
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [writingSpec, setWritingSpec] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ArticleProject | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [accounts, setAccounts] = useState<WechatAccount[]>([]);
  const [textModels, setTextModels] = useState<TextModel[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [preferences, setPreferences] = useState<StudioPreferences>(EMPTY_PREFERENCES);
  const [themeSummaries, setThemeSummaries] = useState<any[]>(THEME_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const toastId = useRef(0);
  const workspaceEpochRef = useRef(0);

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts(current => [...current.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), tone === 'danger' ? 7000 : 4200);
  }, []);

  const refreshConfig = useCallback(async (epoch = workspaceEpochRef.current) => {
    const configText = await readOptional('.aws-article/config.yaml');
    const nextWritingSpec = await readOptional('.aws-article/writing-spec.md');
    if (epoch !== workspaceEpochRef.current) return null;
    if (!configText.trim()) {
      setConfig({});
      setWritingSpec(nextWritingSpec);
      return {};
    }
    const next = parseYamlObject(configText, 'config.yaml');
    setConfig(next);
    setWritingSpec(nextWritingSpec);
    return next;
  }, [notify]);

  const refreshProjects = useCallback(async (epoch = workspaceEpochRef.current, draftsRoot = config.drafts_root || 'drafts') => {
    const values = await listProjects(api, draftsRoot);
    if (epoch === workspaceEpochRef.current) setProjects(values);
  }, [config.drafts_root]);

  const refreshProjectList = useCallback(async () => {
    try {
      await refreshProjects();
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }, [notify, refreshProjects]);

  const refreshPresets = useCallback(async (epoch = workspaceEpochRef.current) => {
    const readDirectory = async (path: string) => {
      const entries = await api.workspace.list({ path, recursive: true }).catch((error: unknown) => {
        if (isMissingError(error)) return [];
        throw error;
      });
      const files = [];
      for (const entry of entries) {
        if (entry.kind !== 'file' || !/\.ya?ml$/i.test(entry.path)) continue;
        files.push(await api.workspace.readText({ path: entry.path, maxBytes: 2 * 1024 * 1024 }));
      }
      return files;
    };
    const [themes, components] = await Promise.all([
      readDirectory('.aws-article/presets/formatting'),
      readDirectory('.aws-article/presets/components'),
    ]);
    if (epoch !== workspaceEpochRef.current) return;
    await callWorker('loadPresets', { themes, components });
    const catalog = await callWorker<any>('presets', {});
    const values = Object.values(catalog.themes || {}).map((theme: any) => ({
      name: theme.name,
      description: theme.description || '',
      whenToUse: theme.when_to_use || '',
      whenNotToUse: theme.when_not_to_use || '',
      defaultScheme: theme.default_scheme || '',
      schemes: (theme.schemes || []).map((scheme: any) => ({
        name: scheme.name,
        color: scheme.variables?.['primary-color'] || '',
        description: scheme.description || '',
      })),
      sortOrder: Number(theme.sort_order || 99),
    })).sort((left, right) => left.sortOrder - right.sortOrder);
    if (values.length && epoch === workspaceEpochRef.current) setThemeSummaries(values);
  }, []);

  const refreshCapabilities = useCallback(async (epoch = workspaceEpochRef.current) => {
    const [serverValue, accountValue, textValue, officialImageValue, proxyImageValue] = await Promise.all([
      api.mcp.servers().catch(() => []),
      api.wechat.accounts().catch(() => []),
      api.ai.textModels().catch(() => ({ models: [] })),
      api.ai.models().catch(() => []),
      api.ai.models({ source: 'proxy' }).catch(() => []),
    ]);
    const nextServers = Array.isArray(serverValue) ? serverValue : [];
    const nextAccounts = Array.isArray(accountValue) ? accountValue : [];
    const nextTextModels = Array.isArray(textValue?.models) ? textValue.models : [];
    const nextImageModels = mergeImageModels(
      Array.isArray(officialImageValue) ? officialImageValue : [],
      Array.isArray(proxyImageValue) ? proxyImageValue : [],
    );
    const nextPreferences = await loadPreferences(nextTextModels, nextImageModels, nextAccounts);
    if (epoch !== workspaceEpochRef.current) return;
    setServers(nextServers);
    setAccounts(nextAccounts);
    setTextModels(nextTextModels);
    setImageModels(nextImageModels);
    setPreferences(nextPreferences);
  }, []);

  const initialize = useCallback(async () => {
    const epoch = workspaceEpochRef.current;
    setLoading(true);
    setDataError('');
    try {
      const status = await api.workspace.status();
      if (epoch !== workspaceEpochRef.current) return;
      setWorkspace(status);
      if (status.available) {
        const nextConfig = await refreshConfig(epoch);
        if (epoch !== workspaceEpochRef.current || !nextConfig) return;
        await Promise.all([
          refreshProjects(epoch, nextConfig.drafts_root || 'drafts'),
          refreshCapabilities(epoch),
          refreshPresets(epoch),
        ]);
      }
    } catch (error) {
      if (epoch !== workspaceEpochRef.current) return;
      setDataError(errorText(error));
      notify(errorText(error), 'danger');
    } finally {
      if (epoch === workspaceEpochRef.current) setLoading(false);
    }
  }, [notify, refreshCapabilities, refreshConfig, refreshPresets, refreshProjects]);

  useEffect(() => {
    void initialize();
    const dispose = api.onDispose?.(disposeWorker);
    return () => {
      dispose?.();
      disposeWorker();
    };
  }, [initialize]);

  function clearWorkspaceSession() {
    setProject(null);
    setPage('workbench');
  }

  function startWorkspaceEpoch() {
    workspaceEpochRef.current += 1;
    setWorkspaceEpoch(workspaceEpochRef.current);
  }

  async function pickWorkspace() {
    if (workspace?.available) {
      const confirmed = window.confirm('切换工作文件夹会关闭当前项目，并清空未完成的写稿与贴图状态。确认切换？');
      if (!confirmed) return;
    }
    try {
      const value = await api.workspace.pick();
      if (!value) return;
      // 切换前先关闭旧项目，切换后再次确认页面不再指向旧工作区。
      clearWorkspaceSession();
      startWorkspaceEpoch();
      await initialize();
      clearWorkspaceSession();
      notify('已连接工作文件夹「' + value.name + '」。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  async function openProject(next: ArticleProject | null, directory?: string) {
    if (next) {
      setProject(next);
      setPage('projects');
      return;
    }
    if (directory) {
      const epoch = workspaceEpochRef.current;
      try {
        const loaded = await loadProject(api, directory) as unknown as ArticleProject;
        if (epoch !== workspaceEpochRef.current) return;
        setProject(loaded);
        setPage('projects');
      } catch (error) {
        notify(errorText(error), 'danger');
      }
    }
  }

  const reloadProject = useCallback(async () => {
    if (!project) return;
    const epoch = workspaceEpochRef.current;
    try {
      const loaded = await loadProject(api, project.directory) as unknown as ArticleProject;
      if (epoch !== workspaceEpochRef.current) return;
      setProject(loaded);
      await refreshProjects();
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }, [notify, project, refreshProjects]);

  // 项目页 props 统一收集：列表刷新只走 onRefresh，不会顺带重新加载当前项目。
  const projectsPageProps = {
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
    onOpen: (directory: string) => void openProject(null, directory),
    onClose: () => setProject(null),
    onReload: reloadProject,
    onRefresh: refreshProjectList,
    onChanged: async () => {
      try {
        await Promise.all([refreshProjects(), refreshConfig(), refreshPresets()]);
      } catch (error) {
        setDataError(errorText(error));
        notify(errorText(error), 'danger');
      }
    },
    onGoConfig: () => setPage('config'),
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="product-mark">
          <span className="mark-dot" aria-hidden="true" />
          <div>
            <strong>公众号 AI 工作台</strong>
            <small>本地工作区驱动</small>
          </div>
        </div>
        <nav aria-label="主要功能">
          {PAGES.map(item => (
            <button
              type="button"
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <span className="nav-short" aria-hidden="true">{item.short.slice(0, 1)}</span>
              <span>{item.label}</span>
              {item.id === 'projects' && projects.length ? <em>{projects.length}</em> : null}
            </button>
          ))}
        </nav>
        <div className="workspace-card">
          <span className="eyebrow">当前工作区</span>
          <strong>{workspace?.available ? workspace.name : workspace?.reason === 'moved' ? '目录已移动' : workspace?.reason === 'missing' ? '目录不存在' : '未选择'}</strong>
          <button type="button" onClick={() => void pickWorkspace()}>
            {workspace?.available ? '更换' : '选择文件夹'}
          </button>
        </div>
      </aside>

      <main className="main-shell">
        {loading ? (
          <div className="loading-page"><span className="spinner" /> 正在读取工作区…</div>
        ) : dataError ? (
          <div className="page">
            <header className="page-header"><div><h1>工作区数据无法读取</h1><p>为避免覆盖现有配置或草稿，写作功能已暂停。</p></div></header>
            <Empty title="需要先恢复工作区" description={dataError} action={<Button type="button" variant="primary" onClick={() => void initialize()}>重试读取</Button>} />
          </div>
        ) : !workspace?.available ? (
          <div className="page">
            <header className="page-header">
              <div>
                <h1>选择工作文件夹</h1>
                <p>插件只开放 .aws-article、drafts、posts、series 四个目录，不会读取其它文件，也不会看到真实绝对路径。</p>
              </div>
            </header>
            <Empty
              title="从一个本地文件夹开始"
              description={workspace?.reason === 'moved' ? '原文件夹已被移动或替换，请重新授权。' : '配置、草稿、业务素材和历史项目都会保存在这个文件夹中。'}
              action={<Button type="button" variant="primary" onClick={() => void pickWorkspace()}>选择工作文件夹</Button>}
            />
          </div>
        ) : page === 'workbench' ? (
          <Workbench
            config={config}
            projects={projects}
            servers={servers}
            workspaceEpoch={workspaceEpoch}
            onOpenProject={(next, epoch) => {
              if (epoch !== undefined && epoch !== workspaceEpochRef.current) return;
              void openProject(next);
            }}
            onChanged={async () => {
              try {
                await Promise.all([refreshProjects(), refreshConfig(), refreshPresets()]);
              } catch (error) {
                setDataError(errorText(error));
                notify(errorText(error), 'danger');
              }
            }}
            onPickWorkspace={pickWorkspace}
            setPage={setPage}
            notify={notify}
          />
        ) : page === 'projects' ? (
          <ProjectsPage {...projectsPageProps} />
        ) : page === 'config' ? (
          <ConfigPage
            config={config}
            writingSpec={writingSpec}
            servers={servers}
            accounts={accounts}
            textModels={textModels}
            imageModels={imageModels}
            preferences={preferences}
            themeSummaries={themeSummaries}
            notify={notify}
            onChanged={async () => {
              try {
                await Promise.all([refreshConfig(), refreshCapabilities(), refreshPresets()]);
              } catch (error) {
                setDataError(errorText(error));
                notify(errorText(error), 'danger');
              }
            }}
            onWorkspace={pickWorkspace}
          />
        ) : page === 'assets' ? (
          <AssetsPage
            textModels={textModels}
            preferences={preferences}
            config={config}
            notify={notify}
          />
        ) : (
          <StickerPage
            key={workspaceEpoch}
            config={config}
            servers={servers}
            imageModels={imageModels}
            accounts={accounts}
            preferences={preferences}
            notify={notify}
            onChanged={refreshProjects}
          />
        )}
      </main>

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(toast => (
          <div key={toast.id} className={'toast toast-' + toast.tone}>
            <span aria-hidden="true">{toast.tone === 'success' ? '✓' : toast.tone === 'danger' ? '!' : toast.tone === 'warning' ? '△' : '·'}</span>
            <p>{toast.text}</p>
            <button type="button" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))} aria-label="关闭提示">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
