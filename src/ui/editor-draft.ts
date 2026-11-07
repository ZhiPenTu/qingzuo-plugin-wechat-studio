import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';

type DraftRecord = {
  version: 1;
  base: string;
  text: string;
  updatedAt: number;
};

export type EditorDraftStatus = {
  phase: 'idle' | 'restored' | 'saving' | 'saved' | 'error';
  updatedAt?: number;
  error?: string;
};

function draftPath(directory: string, stage: string) {
  return directory + '/.qz-draft-' + stage + '.json';
}

async function readDraft(directory: string, stage: string): Promise<DraftRecord | null> {
  try {
    const text = await api.workspace.readText({ path: draftPath(directory, stage) });
    const value = JSON.parse(text);
    return value?.version === 1 && typeof value.base === 'string' && typeof value.text === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

async function writeDraft(directory: string, stage: string, base: string, text: string) {
  const record: DraftRecord = { version: 1, base, text, updatedAt: Date.now() };
  await api.workspace.writeText({
    path: draftPath(directory, stage),
    text: JSON.stringify(record),
    overwrite: true,
  });
  return record;
}

async function removeDraft(directory: string, stage: string) {
  await api.workspace.remove({ path: draftPath(directory, stage) }).catch(() => {});
}

export function editorDraftLabel(status: EditorDraftStatus) {
  if (status.phase === 'restored') return '已恢复上次未保存的草稿';
  if (status.phase === 'saving') return '正在保存本地草稿…';
  if (status.phase === 'saved') return '本地草稿已保存';
  if (status.phase === 'error') return '本地草稿保存失败：' + (status.error || '请稍后重试');
  return '';
}

export function useEditorDraft({
  directory,
  stage,
  initialValue,
  baseline = initialValue,
}: {
  directory: string;
  stage: string;
  initialValue: string;
  baseline?: string;
}) {
  const [value, setValueState] = useState(initialValue);
  const [status, setStatus] = useState<EditorDraftStatus>({ phase: 'idle' });
  const [hydrated, setHydrated] = useState(false);
  const valueRef = useRef(initialValue);
  const baselineRef = useRef(baseline);
  const suppressed = useRef(false);
  const alive = useRef(true);
  const editRevision = useRef(0);
  const writeRevision = useRef(0);
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());

  baselineRef.current = baseline;
  valueRef.current = value;

  useEffect(() => {
    let active = true;
    const hydrationEditRevision = editRevision.current;
    writeRevision.current += 1;
    alive.current = true;
    suppressed.current = false;
    setHydrated(false);
    setValueState(initialValue);
    setStatus({ phase: 'idle' });
    void writeChain.current
      .catch(() => {})
      .then(() => readDraft(directory, stage))
      .then(record => {
        if (!active) return;
        if (
          record?.base === baseline
          && record.text !== initialValue
          && editRevision.current === hydrationEditRevision
          && valueRef.current === initialValue
        ) {
          setValueState(record.text);
          setStatus({ phase: 'restored', updatedAt: record.updatedAt });
        } else if (record && record.base !== baseline) {
          writeChain.current = writeChain.current
            .catch(() => {})
            .then(() => removeDraft(directory, stage));
        }
        setHydrated(true);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [directory, stage, baseline, initialValue]);

  useEffect(() => {
    if (!hydrated || suppressed.current) return;
    if (value === baseline) {
      writeRevision.current += 1;
      writeChain.current = writeChain.current
        .catch(() => {})
        .then(() => removeDraft(directory, stage));
      return;
    }
    setStatus(current => current.phase === 'restored' ? current : { phase: 'saving' });
    const timer = window.setTimeout(() => {
      if (!alive.current || suppressed.current) return;
      const revision = ++writeRevision.current;
      const write = writeChain.current
        .catch(() => {})
        .then(() => writeDraft(directory, stage, baseline, value));
      writeChain.current = write.catch(() => {});
      void write
        .then(record => {
          if (alive.current && !suppressed.current && revision === writeRevision.current) {
            setStatus({ phase: 'saved', updatedAt: record.updatedAt });
          }
        })
        .catch(error => {
          if (alive.current && revision === writeRevision.current) {
            setStatus({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
          }
        });
    }, 420);
    return () => window.clearTimeout(timer);
  }, [baseline, directory, hydrated, stage, value]);

  useEffect(() => {
    return () => {
      if (hydrated && !suppressed.current && valueRef.current !== baselineRef.current) {
        writeChain.current = writeChain.current
          .catch(() => {})
          .then(() => writeDraft(directory, stage, baselineRef.current, valueRef.current))
          .catch(() => {});
      }
    };
  }, [directory, hydrated, stage]);

  const setValue = useCallback((next: string | ((current: string) => string)) => {
    const resolved = typeof next === 'function' ? next(valueRef.current) : next;
    suppressed.current = false;
    if (resolved !== valueRef.current) editRevision.current += 1;
    valueRef.current = resolved;
    setValueState(resolved);
    setStatus(resolved === baselineRef.current ? { phase: 'idle' } : { phase: 'saving' });
  }, []);

  const markSaved = useCallback(async () => {
    suppressed.current = true;
    writeRevision.current += 1;
    setStatus({ phase: 'idle' });
    await writeChain.current.catch(() => {});
    await removeDraft(directory, stage);
  }, [directory, stage]);

  const discard = useCallback(async () => {
    suppressed.current = true;
    editRevision.current += 1;
    writeRevision.current += 1;
    setValueState(baseline);
    setStatus({ phase: 'idle' });
    await writeChain.current.catch(() => {});
    await removeDraft(directory, stage);
  }, [baseline, directory, stage]);

  return { value, setValue, status, hydrated, markSaved, discard };
}
