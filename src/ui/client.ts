import { createPluginClient } from '../../vendor/plugin-sdk-1.11.0/index.mjs';

export type PluginClient = ReturnType<typeof createPluginClient>;
export const api: PluginClient = createPluginClient();

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || '操作失败。');
}

export function isMissingError(error: unknown) {
  return /ENOENT|no such file|not found|不存在|未找到/i.test(errorText(error));
}

export async function readOptional(path: string): Promise<string> {
  try {
    return await api.workspace.readText({ path });
  } catch (error) {
    if (isMissingError(error)) return '';
    throw error;
  }
}

export function formatTime(value: number) {
  if (!Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function csv(value: unknown) {
  return Array.isArray(value) ? value.join('、') : String(value ?? '');
}

export function parseCsv(value: string) {
  return [...new Set(String(value || '').split(/[、,\n]/).map(item => item.trim()).filter(Boolean))];
}

export function shortId(value: string) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').slice(-8) || Date.now().toString(36);
}
