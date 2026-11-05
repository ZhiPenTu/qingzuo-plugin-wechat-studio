/** @typedef {{ path: string, name?: string, kind?: string, size?: number, mtime?: number }} PreviewEntry */
export function parseGeneratedMapping(text) {
  try {
    const value = JSON.parse(String(text || '{}'));
    return value?.generated && typeof value.generated === 'object' ? { ...value.generated } : {};
  } catch {
    return {};
  }
}

export function mappingForPlan(plan, text) {
  const mapping = parseGeneratedMapping(text);
  if (!plan) return mapping;
  try {
    const saved = JSON.parse(String(text || '{}'));
    const savedItems = Array.isArray(saved?.items) ? saved.items : [];
    const currentItems = Array.isArray(plan.items) ? plan.items : [];
    const keyOf = item => String(item?.slotIndex ?? '') + '\n' + String(item?.alt ?? '');
    const savedBySlot = new Map();
    for (const item of savedItems) {
      const relative = mapping[item?.index];
      if (relative) savedBySlot.set(keyOf(item), relative);
    }
    const transferred = {};
    for (const item of currentItems) {
      const relative = savedBySlot.get(keyOf(item));
      if (relative) transferred[item.index] = relative;
    }
    return transferred;
  } catch {
    return {};
  }
}

/**
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
