import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from './client';
import { Button, Field } from './common';
import type { McpServer, McpTool } from './types';

export function McpPanel({
  servers,
  defaultArgs = '{}',
  onResult,
  notify,
  compact = false,
}: {
  servers: McpServer[];
  defaultArgs?: string;
  onResult: (content: unknown, tool: McpTool) => void;
  notify: (text: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void;
  compact?: boolean;
}) {
  const [serverId, setServerId] = useState(servers[0]?.id || '');
  const [tools, setTools] = useState<McpTool[]>([]);
  const [toolName, setToolName] = useState('');
  const [args, setArgs] = useState(defaultArgs);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const selectedServer = useMemo(() => servers.find(server => server.id === serverId), [serverId, servers]);

  useEffect(() => {
    if (!serverId && servers[0]) setServerId(servers[0].id);
  }, [serverId, servers]);

  useEffect(() => {
    setArgs(defaultArgs);
  }, [defaultArgs]);

  useEffect(() => {
    if (!serverId) {
      setTools([]);
      setToolName('');
      return;
    }
    let canceled = false;
    setBusy(true);
    api.mcp.tools({ serverId })
      .then((value: McpTool[]) => {
        if (canceled) return;
        const available = Array.isArray(value) ? value.filter(item => item.readOnly) : [];
        setTools(available);
        setToolName(available[0]?.name || '');
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setTools([]);
          setToolName('');
          notify(errorText(error), 'danger');
        }
      })
      .finally(() => {
        if (!canceled) setBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [serverId, notify]);

  async function call() {
    if (!serverId || !toolName) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || '{}');
    } catch {
      notify('工具参数必须是 JSON。', 'danger');
      return;
    }
    setBusy(true);
    setResult('');
    try {
      await api.mcp.grant({ serverId, toolNames: [toolName] });
      const value = await api.mcp.call({ serverId, toolName, args: parsed });
      const tool = tools.find(item => item.name === toolName) || tools[0];
      const text = typeof value.content === 'string' ? value.content : JSON.stringify(value.content, null, 2);
      setResult(text);
      onResult(value.content, tool);
      notify(value.isError ? '工具返回错误，请检查参数或服务状态。' : '已读取远程资料。', value.isError ? 'warning' : 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!servers.length) {
    return (
      <div className="inline-empty">
        尚未配置远程 MCP。请到「设置 → 能力连接」添加搜索或网页读取工具；也可以跳过调研或手工粘贴资料。
      </div>
    );
  }

  return (
    <div className={'mcp-panel' + (compact ? ' compact' : '')}>
      <div className="form-grid">
        <Field label="MCP 服务">
          <select value={serverId} onChange={event => setServerId(event.target.value)}>
            {servers.map(server => (
              <option key={server.id} value={server.id}>
                {server.name} · {server.status === 'ready' ? server.toolCount + ' 个工具' : server.status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="只读工具">
          <select value={toolName} onChange={event => setToolName(event.target.value)} disabled={!tools.length}>
            {tools.map(tool => <option key={tool.name} value={tool.name}>{tool.title || tool.name}</option>)}
          </select>
        </Field>
      </div>
      {!compact ? (
        <Field label="工具参数 JSON" hint="插件看不到服务器列表之外的地址和令牌。调用前会按「服务器 + 工具」单独授权。">
          <textarea className="code-input" value={args} onChange={event => setArgs(event.target.value)} rows={4} spellCheck={false} />
        </Field>
      ) : null}
      <div className="toolbar">
        <Button type="button" variant="primary" onClick={call} busy={busy} disabled={!toolName}>
          调用只读工具
        </Button>
        {selectedServer && selectedServer.status !== 'ready' ? <span className="hint">服务状态：{selectedServer.status}</span> : null}
      </div>
      {result ? <pre className="tool-result" tabIndex={0}>{result}</pre> : null}
    </div>
  );
}
