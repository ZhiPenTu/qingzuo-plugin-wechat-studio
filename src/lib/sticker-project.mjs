import { base64Bytes, bytesBase64, compressBodyImageBytes } from './crop.mjs';
import { renderMarkdownDocument } from './markdown.mjs';
import { appendLog, createProject, loadProject, saveArticle } from './project.mjs';
import { articlePublicationFingerprint } from './publication.mjs';
import { stickerProjectMarkdown } from './stickers.mjs';

const MAX_WECHAT_BODY_IMAGE = 1024 * 1024;
const enabled = (value, fallback) => {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  return !(raw === false || raw === 0 || raw === '0');
};

export function stickerProjectRelativeFiles(items) {
  return Object.fromEntries((Array.isArray(items) ? items : []).map((item, index) => [
    item.id,
    'imgs/sticker-' + String(index + 1).padStart(2, '0') + '.jpg',
  ]));
}

export async function stickerProjectReady(api, directory, relativeFiles) {
  const root = String(directory || '');
  const files = Object.values(relativeFiles || {}).filter(Boolean);
  if (!root || !files.length) return false;
  try {
    const entries = await api.workspace.list({ path: root, recursive: true });
    const paths = new Set((Array.isArray(entries) ? entries : [])
      .filter(entry => entry?.kind === 'file')
      .map(entry => entry.path));
    const projectFilesReady = ['article.md', 'article.html', 'img-plan.json', 'article.yaml']
      .every(file => paths.has(root + '/' + file))
      && files.every(file => paths.has(root + '/' + file));
    if (!projectFilesReady) return false;
    for (const file of files) {
      const value = await api.workspace.readFile({ path: root + '/' + file });
      if (
        String(value?.mime || '').toLowerCase() !== 'image/jpeg'
        || Number(value?.size) > MAX_WECHAT_BODY_IMAGE
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function defaultConvertImage(sourceFile) {
  const compressed = await compressBodyImageBytes(
    base64Bytes(sourceFile.data),
    sourceFile.mime,
    '1:1',
    960 * 1024,
  );
  return {
    data: bytesBase64(compressed),
    mime: 'image/jpeg',
    size: compressed.byteLength,
  };
}

export async function materializeStickerProject(api, {
  title,
  digest = '',
  items,
  filesByItem = {},
  medium = '',
  language = '简体中文',
  config = {},
  draftsRoot = 'drafts',
}, options = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) throw new Error('请至少生成一张贴图，再保存为文章项目。');
  const missing = sourceItems.filter(item => !String(filesByItem[item.id] || '').trim());
  if (missing.length) {
    throw new Error('还有 ' + missing.length + ' 张贴图未生成，请补齐后再保存为文章项目。');
  }
  const projectTitle = [...String(title || '').trim()].slice(0, 64).join('') || '贴图草稿';
  const projectDigest = String(digest || '').trim().slice(0, 120)
    || ('本组贴图围绕「' + projectTitle + '」展开，共 ' + sourceItems.length + ' 张。');
  const relativeFiles = stickerProjectRelativeFiles(sourceItems);
  const convertImage = options.convertImage || defaultConvertImage;
  const created = await createProject(api, {
    title: projectTitle,
    mode: 'paste',
    source: '贴图工作流',
    initialStage: 'format',
    draftsRoot,
  });
  const directory = created.directory;
  try {
    for (const item of sourceItems) {
      const sourceFile = await api.workspace.readFile({ path: filesByItem[item.id] });
      const converted = await convertImage(sourceFile, item);
      if (String(converted?.mime || '').toLowerCase() !== 'image/jpeg') {
        throw new Error('微信公众号图片必须统一转换为 JPEG。');
      }
      const written = await api.workspace.writeBase64({
        path: directory + '/' + relativeFiles[item.id],
        data: converted.data,
        mime: 'image/jpeg',
        overwrite: false,
      });
      if (Number(written?.size) > MAX_WECHAT_BODY_IMAGE) {
        throw new Error('贴图「第 ' + (sourceItems.indexOf(item) + 1) + ' 张」转换后仍超过微信 1 MB 限制。');
      }
    }

    const markdown = stickerProjectMarkdown({
      title: projectTitle,
      digest: projectDigest,
      items: sourceItems,
      filesByItem: relativeFiles,
    });
    const html = renderMarkdownDocument(markdown);
    const cover = relativeFiles[sourceItems[0].id];
    const bodyItems = sourceItems.slice(1).map((item, index) => ({
      slotIndex: index + 1,
      index,
      originalAlt: '贴图：第 ' + (index + 2) + ' 张',
      alt: '贴图：第 ' + (index + 2) + ' 张',
      src: 'user',
      type: '氛围',
      caption: item.caption || '',
      context: '',
      style: '场景还原',
      aspect: '1:1',
      role: '节奏位',
      generate: false,
      file: relativeFiles[item.id],
      prompt: '',
    }));
    await api.workspace.writeText({ path: directory + '/article.md', text: markdown, overwrite: true });
    await api.workspace.writeText({ path: directory + '/article.html', text: html, overwrite: true });
    await api.workspace.writeText({
      path: directory + '/img-plan.json',
      text: JSON.stringify({
        title: projectTitle,
        brief: projectDigest,
        medium,
        source: 'sticker',
        cover: {
          style: '贴图',
          aspect: '1:1',
          copy: sourceItems[0].caption || projectTitle,
          defaultCopy: projectTitle,
          prompt: '',
          file: cover,
          generate: false,
        },
        items: bodyItems,
        prompts: [],
        warnings: [],
        generated: Object.fromEntries(bodyItems.map(item => [item.index, item.file])),
      }, null, 2),
      overwrite: true,
    });
    await saveArticle(api, directory, {
      title: projectTitle,
      author: String(config.default_author || ''),
      digest: projectDigest,
      cover_image: cover,
      content_source: 'article.html',
      image_source: 'user',
      image_medium: medium,
      need_open_comment: enabled(config.need_open_comment, true) ? 1 : 0,
      only_fans_can_comment: enabled(config.only_fans_can_comment, false) ? 1 : 0,
    });
    await appendLog(api, directory, '从贴图工作流保存 ' + sourceItems.length + ' 张贴图（' + language + '）并进入排版。');
    const project = await loadProject(api, directory);
    return {
      directory,
      relativeFiles,
      markdown,
      html,
      cover,
      title: projectTitle,
      digest: projectDigest,
      articleFingerprint: await articlePublicationFingerprint(project),
    };
  } catch (error) {
    await api.workspace.remove({ path: directory, recursive: true }).catch(() => {});
    throw error;
  }
}

export async function stickerProjectArticleFingerprint(api, directory) {
  if (!String(directory || '').startsWith('drafts/')) {
    throw new Error('贴图文章项目必须位于 drafts/ 下。');
  }
  return articlePublicationFingerprint(await loadProject(api, directory));
}

function stickerAssetPath(directory, source) {
  const relative = String(source || '').trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (!relative
    || relative.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(relative)
    || relative.split('/').includes('..')) {
    throw new Error('贴图正文包含无效的本地图片路径。');
  }
  return {
    relative,
    path: directory + '/' + relative,
  };
}

export function stickerWechatPayload({
  accountId,
  directory,
  relativeFiles,
  items,
  title,
  digest = '',
  config = {},
}) {
  const root = String(directory || '').trim();
  if (!/^drafts(?:\/[^\\:*?"<>|]+)+$/.test(root) || root.split('/').includes('..')) {
    throw new Error('贴图公众号草稿必须物化到 drafts/ 文章目录。');
  }
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) throw new Error('请先生成至少一张贴图，再创建公众号草稿。');
  const missing = sourceItems.filter(item => !String(relativeFiles?.[item.id] || '').trim());
  if (missing.length) throw new Error('还有 ' + missing.length + ' 张贴图没有物化到文章项目。');
  const cover = String(relativeFiles?.[sourceItems[0].id] || '');
  if (!cover) throw new Error('请先生成封面贴图，再创建公众号草稿。');
  const articleTitle = String(title || '').trim();
  if (!articleTitle) throw new Error('公众号草稿标题不能为空。');
  if ([...articleTitle].length > 64) throw new Error('公众号草稿标题不能超过 64 个字符。');
  const author = String(config.default_author || '').trim();
  if ([...author].length > 32) throw new Error('公众号作者不能超过 32 个字符。');
  if (!String(accountId || '').trim()) throw new Error('请先选择公众号账号。');
  const markdown = stickerProjectMarkdown({
    title: articleTitle,
    digest,
    items: sourceItems,
    filesByItem: relativeFiles,
  });
  const fullHtml = renderMarkdownDocument(markdown);
  const assets = [];
  let counter = 0;
  const html = fullHtml.replace(/<img([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>/gi, (_match, before, src, after) => {
    const asset = stickerAssetPath(root, src);
    const placeholder = 'asset-' + (++counter);
    assets.push({ placeholder, path: asset.path });
    return '<img' + before + ' src="qingzuo-asset:' + placeholder + '"' + after + '>';
  });
  if (!assets.length) throw new Error('贴图正文没有可发布的图片。');
  return {
    accountId,
    article: {
      articleDir: root,
      title: articleTitle,
      author,
      digest: String(digest || '').trim().slice(0, 120),
      html,
      cover: { placeholder: 'cover', path: root + '/' + cover },
      assets,
      needOpenComment: enabled(config.need_open_comment, true),
      onlyFansCanComment: enabled(config.only_fans_can_comment, false),
    },
  };
}
