import { useEffect, useState } from 'react';
import { api, errorText, isMissingError } from './client';
import { Badge, Button, Empty, Field, Modal } from './common';
import type { TextModel, Toast } from './types';
import type { StudioPreferences } from './preferences';

type Notify = (text: string, tone?: Toast['tone']) => void;
type Entry = { path: string; name: string; kind: 'file' | 'directory'; size?: number; mtime: number };

export function AssetsPage({
  textModels,
  preferences,
  config,
  notify,
}: {
  textModels: TextModel[];
  preferences: StudioPreferences;
  config: Record<string, any>;
  notify: Notify;
}) {
  const [products, setProducts] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [description, setDescription] = useState('');
  const [selectedDocumentPath, setSelectedDocumentPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [productName, setProductName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null);

  async function refreshProducts() {
    try {
      const value = await api.workspace.list({ path: '.aws-article/products', recursive: false });
      setProducts(Array.isArray(value) ? value.filter((entry: Entry) => entry.kind === 'directory') : []);
    } catch (error) {
      if (isMissingError(error)) {
        setProducts([]);
        return;
      }
      notify(errorText(error), 'danger');
      setProducts([]);
    }
  }

  async function loadProduct(directory: string) {
    try {
      const value = await api.workspace.list({ path: directory, recursive: true });
      const intro = value.find((entry: Entry) => entry.kind === 'file' && /\.md$/i.test(entry.path) && !/^images\//i.test(entry.path));
      const text = intro ? await api.workspace.readText({ path: intro.path }) : '';
      setSelected(directory);
      setEntries(value);
      setSelectedDocumentPath(intro?.path || directory + '/产品介绍.md');
      setDescription(text);
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  async function openDocument(document: Entry) {
    try {
      const text = await api.workspace.readText({ path: document.path });
      setSelectedDocumentPath(document.path);
      setDescription(text);
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  useEffect(() => {
    void refreshProducts();
  }, []);

  async function createProduct() {
    const name = productName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const directory = '.aws-article/products/' + name.replace(/[\\/:*?"<>|]/g, '-');
      await api.workspace.mkdir({ path: directory });
      await api.workspace.mkdir({ path: directory + '/images' });
      await api.workspace.writeText({ path: directory + '/产品介绍.md', text: '# ' + name + '\n\n', overwrite: false });
      await api.workspace.writeText({ path: directory + '/images/说明.md', text: '# 图片说明\n\n每张图片可在同一目录下放置同名 .md 说明。\n', overwrite: false });
      setNewProduct(false);
      setProductName('');
      await refreshProducts();
      await loadProduct(directory);
      notify('已创建产品素材目录。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    const target = selectedDocumentPath || entries.find(entry => entry.kind === 'file' && /\.md$/i.test(entry.path))?.path || selected + '/产品介绍.md';
    setBusy(true);
    try {
      await api.workspace.writeText({ path: target, text: description, overwrite: true });
      const value = await api.workspace.list({ path: selected, recursive: false });
      setEntries(value);
      setSelectedDocumentPath(target);
      notify('产品介绍已保存。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function importImages() {
    if (!selected) return;
    setBusy(true);
    try {
      const files = await api.files.pickMany({ extensions: ['png', 'jpg', 'jpeg', 'webp'] });
      for (const file of files) {
        try {
          const target = selected + '/images/' + file.name.replace(/[\\:*?"<>|]/g, '-');
          await api.workspace.writeFile({ path: target, token: file.token, overwrite: false });
        } finally {
          await api.files.release(file.token).catch(() => {});
        }
      }
      await loadProduct(selected);
      if (files.length) notify('已导入 ' + files.length + ' 张产品图片。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function previewImage(entry: Entry) {
    try {
      const url = await api.workspace.url({ path: entry.path });
      setPreview({ path: entry.path, url });
    } catch (error) {
      notify(errorText(error), 'danger');
    }
  }

  async function generateCaption(entry: Entry) {
    setBusy(true);
    try {
      const file = await api.workspace.readFile({ path: entry.path, maxBytes: 12 * 1024 * 1024 });
      const result = await api.ai.complete({
        model: preferences.textModelId || textModels[0]?.id || undefined,
        messages: [
          {
            role: 'system',
            content: '你是产品素材编辑。根据图片写一段 60–120 字的客观说明，只描述可见内容和产品用途，不编造参数、客户或认证。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '产品：' + selected.split('/').pop() + '\n已有介绍：\n' + description.slice(0, 6000) },
              { type: 'image_url', image_url: { url: 'data:' + file.mime + ';base64,' + file.data } },
            ],
          },
        ],
        maxTokens: 500,
      });
      const target = selected + '/images/' + entry.name.replace(/\.[^.]+$/, '') + '.md';
      const existing = entries.some(item => item.path === target) || await api.workspace.readText({ path: target }).then(() => true).catch((error: unknown) => {
        if (/ENOENT|不存在|未找到|no such file/i.test(errorText(error))) return false;
        throw error;
      });
      if (existing && !window.confirm('这张图片已有说明，是否覆盖现有内容？')) {
        notify('已保留现有图片说明。', 'warning');
        return;
      }
      await api.workspace.writeText({ path: target, text: '# ' + entry.name + '\n\n' + result.content + '\n', overwrite: true });
      await loadProduct(selected);
      notify('图片说明已生成。请核对可见事实。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.workspace.remove({ path: deleteTarget.path, recursive: deleteTarget.kind === 'directory' });
      setDeleteTarget(null);
      if (deleteTarget.path === selected) {
        setSelected('');
        setEntries([]);
        setDescription('');
        await refreshProducts();
      } else {
        await loadProduct(selected);
      }
      notify('已删除所选内容。', 'success');
    } catch (error) {
      notify(errorText(error), 'danger');
    } finally {
      setBusy(false);
    }
  }

  const images = entries.filter(entry => entry.kind === 'file' && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.path));
  const documents = entries.filter(entry => entry.kind === 'file' && /\.md$/i.test(entry.path) && !entry.path.includes('/images/'));

  return (
    <div className="page assets-page">
      <header className="page-header">
        <div>
          <h1>业务素材库</h1>
          <p>按 .aws-article/products/产品名/ 管理产品介绍、图片和同名说明。写作前会自动检索相关产品资料。</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setNewProduct(true)}>新建产品</Button>
      </header>
      <div className="assets-layout">
        <aside className="product-list">
          {products.map(product => (
            <button type="button" key={product.path} className={selected === product.path ? 'active' : ''} onClick={() => void loadProduct(product.path)}>
              <strong>{product.name}</strong>
              <small>{product.path}</small>
            </button>
          ))}
          {!products.length ? <p className="quiet">还没有产品素材。</p> : null}
        </aside>
        <section className="product-panel">
          {!selected ? (
            <Empty title="选择一个产品" description="产品介绍会作为写作参考资料全文注入，每篇最多使用 5 份。" />
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selected.split('/').pop()}</h2>
                  <p>{documents.length} 份说明 · {images.length} 张图片</p>
                </div>
                <div className="toolbar">
                  <Button type="button" onClick={() => void importImages()} busy={busy}>导入图片</Button>
                  <Button type="button" variant="ghost" onClick={() => setDeleteTarget({ path: selected, name: selected.split('/').pop() || selected, kind: 'directory', mtime: Date.now() })}>删除产品</Button>
                </div>
              </div>
              <Field label="产品介绍" hint="直接挂在产品根目录，写作时可被引用。">
                <textarea value={description} onChange={event => setDescription(event.target.value)} rows={12} />
              </Field>
              <div className="toolbar toolbar-end">
                <Button type="button" variant="primary" onClick={() => void saveDescription()} busy={busy}>保存介绍</Button>
              </div>
              <div className="asset-image-grid">
                {images.map(image => (
                  <article key={image.path} className="asset-image">
                    <button type="button" className="image-preview-button" onClick={() => void previewImage(image)}>
                      <ImagePreview path={image.path} />
                    </button>
                    <div>
                      <strong>{image.name}</strong>
                      <small>{formatBytes(image.size)}</small>
                    </div>
                    <div className="asset-actions">
                      <Button type="button" onClick={() => void generateCaption(image)} busy={busy}>AI 说明</Button>
                      <Button type="button" variant="ghost" onClick={() => setDeleteTarget(image)}>删除</Button>
                    </div>
                  </article>
                ))}
              </div>
              {documents.length ? (
                <div className="asset-docs">
                  {documents.map(document => (
                    <button
                      type="button"
                      key={document.path}
                      className={selectedDocumentPath === document.path ? 'active' : ''}
                      onClick={() => void openDocument(document)}
                    >
                      <span>{document.name}</span>
                      <Badge tone="neutral">{formatBytes(document.size)}</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {newProduct ? (
        <Modal
          title="新建产品素材"
          onClose={() => setNewProduct(false)}
          footer={<><Button type="button" onClick={() => setNewProduct(false)}>取消</Button><Button type="button" variant="primary" onClick={() => void createProduct()} busy={busy}>创建</Button></>}
        >
          <Field label="产品名"><input autoFocus value={productName} onChange={event => setProductName(event.target.value)} placeholder="例如：轻作 Qingzuo" /></Field>
        </Modal>
      ) : null}

      {preview ? (
        <Modal title={preview.path.split('/').pop() || '图片预览'} onClose={() => setPreview(null)}>
          <div className="media-stage"><img src={preview.url} alt={preview.path} /></div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title="确认删除"
          onClose={() => setDeleteTarget(null)}
          footer={<><Button type="button" onClick={() => setDeleteTarget(null)}>取消</Button><Button type="button" variant="danger" onClick={() => void removeEntry()} busy={busy}>删除</Button></>}
        >
          <p>将删除 <code>{deleteTarget.path}</code>{deleteTarget.kind === 'directory' ? ' 及其中全部文件' : ''}。该操作不可撤销。</p>
        </Modal>
      ) : null}
    </div>
  );
}

function ImagePreview({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    void api.workspace.url({ path }).then(setUrl).catch(() => {});
  }, [path]);
  return url ? <img src={url} alt={path.split('/').pop()} loading="lazy" /> : <span className="image-placeholder" />;
}

function formatBytes(value?: number) {
  if (!value) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 ** 2) return (value / 1024).toFixed(1) + ' KB';
  return (value / 1024 ** 2).toFixed(1) + ' MB';
}
