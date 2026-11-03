export type Notice = { text: string; tone: 'info' | 'success' | 'warning' | 'danger' } | null;

export type WorkspaceStatus = {
  name: string;
  available: boolean;
  reason?: 'not-picked' | 'missing' | 'moved' | 'denied';
};

export type ArticleProject = {
  directory: string;
  article: Record<string, any>;
  pipeline: Record<string, any>;
  files: Record<string, string>;
  entries: Array<{ path: string; name: string; kind: 'file' | 'directory'; size?: number; mtime: number }>;
  stage: { id: string; label: string };
};

export type ProjectSummary = {
  directory: string;
  title: string;
  stage: string;
  updatedAt: number;
};

export type McpServer = {
  id: string;
  name: string;
  status: 'ready' | 'auth-required' | 'error' | 'disabled';
  toolCount: number;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
};

export type WechatAccount = {
  id: string;
  name: string;
  appIdMasked: string;
  verified: boolean;
};

export type TextModel = { id: string; title: string };
export type ImageModel = { id: string; title: string; provider: string; source?: string; sizes: string[]; ratios?: string[] };

export type Toast = {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
};
