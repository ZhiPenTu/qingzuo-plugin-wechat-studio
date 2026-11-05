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
    const altOf = item => String(item?.alt ?? '');
    const savedBySlot = new Map();
    const savedByAlt = new Map();
    for (const [savedIndex, item] of savedItems.entries()) {
      const relative = mapping[item?.index];
      if (!relative) continue;
      const entry = { savedIndex, relative };
      const slots = savedBySlot.get(keyOf(item)) || [];
      slots.push(entry);
      savedBySlot.set(keyOf(item), slots);
      const list = savedByAlt.get(altOf(item)) || [];
      list.push(entry);
      savedByAlt.set(altOf(item), list);
    }
    const used = new Set();
    const transferred = {};
    for (const item of currentItems) {
      const exact = (savedBySlot.get(keyOf(item)) || []).find(entry => !used.has(entry.savedIndex));
      if (exact) {
        transferred[item.index] = exact.relative;
        used.add(exact.savedIndex);
      }
    }
    for (const item of currentItems) {
      if (transferred[item.index]) continue;
      const fallback = (savedByAlt.get(altOf(item)) || []).find(entry => !used.has(entry.savedIndex));
      if (!fallback) continue;
      transferred[item.index] = fallback.relative;
      used.add(fallback.savedIndex);
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
