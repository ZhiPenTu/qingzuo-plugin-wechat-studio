/**
 * @typedef {{ path: string, name?: string, kind?: string, size?: number, mtime?: number }} PreviewEntry
 * @param {{
 *   directory?: string,
 *   article?: Record<string, any>,
 *   files?: Record<string, any>,
 *   entries?: PreviewEntry[],
 * }} project
 * @returns {Array<{ path: string, title: string, kind: 'cover' | 'body' }>}
 */
export function projectImagePreviews({ directory = '', article = {}, files = {}, entries = [] } = {}) {
  let plan = null;
  try {
    plan = JSON.parse(files.imagePlan || '{}');
  } catch {
    plan = null;
  }
  const mapping = plan?.generated && typeof plan.generated === 'object' ? plan.generated : {};
  const available = new Set((entries || []).map(entry => entry.path));
  const previews = [];
  const cover = String(article.cover_image || '').trim();
  if (cover) {
    const path = directory + '/' + cover;
    if (available.has(path)) previews.push({ path, title: '封面', kind: 'cover' });
  }
  const items = Array.isArray(plan?.items) ? plan.items : [];
  items.forEach((item, position) => {
    const relative = mapping[item.index];
    if (!relative) return;
    const path = directory + '/' + relative;
    if (available.has(path)) previews.push({ path, title: '配图 ' + (position + 1), kind: 'body' });
  });
  return previews;
}
