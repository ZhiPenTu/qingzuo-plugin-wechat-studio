import { isCoverImageAlt } from './markdown.mjs';
import { findImagePlaceholders } from './review.mjs';

export function hasSavedCover(project) {
  const cover = String(project.article.cover_image || '').trim();
  return Boolean(cover) && project.entries.some(entry => entry.path === project.directory + '/' + cover && entry.kind === 'file');
}

export async function articlePublicationFingerprint(project) {
  const html = project.files?.html || '';
  const localSources = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(source => !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith('//'))
    .map(source => project.directory + '/' + source.replace(/^\.\//, ''));
  const assets = [...new Set(localSources)].map(path => {
    const entry = (project.entries || []).find(item => item.path === path && item.kind === 'file');
    return entry ? { path, size: entry.size || 0, mtime: entry.mtime } : { path, missing: true };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const payload = JSON.stringify({
    title: project.article?.title || '',
    author: project.article?.author || '',
    digest: project.article?.digest || '',
    cover: project.article?.cover_image || '',
    html,
    assets,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function reviewIssueStage(category) {
  const value = String(category || '');
  if (['配图', '图片'].includes(value)) return 'images';
  if (value === 'HTML') return 'format';
  if (value === '标题规范') return 'meta-title';
  if (value === '原创标注') return 'config';
  if (['写作规范', '错别字', '敏感词', '链接', 'AI 味'].includes(value)) return 'format';
  return '';
}

export function buildPublicationGate(project, review) {
  const title = String(project.article.title || '').trim();
  const author = String(project.article.author || '').trim();
  const digest = String(project.article.digest || '').trim();
  const cover = String(project.article.cover_image || '').trim();
  const html = project.files.html || '';
  const sourceMarkdown = project.files.format || project.files.writing || '';
  const hasCover = hasSavedCover(project);
  const localImages = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]).filter(src => !/^https?:/i.test(src));
  const externalImages = [...html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)];
  const missingImages = localImages.filter(src => !project.entries.some(entry => entry.path === project.directory + '/' + src.replace(/^\.\//, '') && entry.kind === 'file'));
  const sourcePlaceholders = findImagePlaceholders(sourceMarkdown).filter(item => !(hasCover && isCoverImageAlt(item.alt)));
  const htmlPlaceholders = [...html.matchAll(/<img[^>]+src=["'](?:placeholder|placeholder-[^"']*)["']/gi)];
  const placeholderLabels = [
    ...sourcePlaceholders.map(item => item.alt || '未命名图位'),
    ...(htmlPlaceholders.length ? ['HTML 内 ' + htmlPlaceholders.length + ' 处'] : []),
  ];
  const embeds = /\{embed:\w+:[^}]+\}/.test(html);
  const firstBlock = review?.issues?.find(item => item.level === 'block');
  const blockStage = reviewIssueStage(firstBlock?.category || '') || 'format';
  const items = [
    { label: '标题', ok: Boolean(title) && [...title].length <= 64, detail: title ? [...title].length + ' 字' : '未填写', meta: 'title' },
    { label: '作者', ok: Boolean(author) && [...author].length <= 32, detail: author || '未填写', meta: 'author' },
    { label: '摘要', ok: Boolean(digest) && [...digest].length <= 120, detail: digest ? [...digest].length + ' 字' : '未填写', meta: 'digest' },
    { label: '封面', ok: hasCover, detail: cover || '未设置', stage: 'images' },
    { label: '当前 HTML', ok: Boolean(html) && html.length > 100, detail: html ? html.length + ' 字符' : '尚未排版', stage: 'format' },
    { label: '正文图片', ok: externalImages.length === 0 && missingImages.length === 0, detail: externalImages.length ? '仍有外链图片' : missingImages.length ? '缺少：' + missingImages.join('、') : localImages.length + ' 张本地图片', stage: 'images' },
    { label: '占位符', ok: placeholderLabels.length === 0, detail: placeholderLabels.length ? placeholderLabels.join('、') : '已清理', stage: sourcePlaceholders.length ? 'images' : 'format' },
    { label: '嵌入定义', ok: !embeds, detail: embeds ? '仍有未解析的 {embed:…}' : '已解析', stage: 'format' },
    { label: '阻断级审稿项', ok: review ? review.counts.block === 0 : false, detail: review ? review.counts.block + ' 项' : '尚未检查', stage: blockStage },
  ];
  return { ok: items.every(item => item.ok), items };
}
