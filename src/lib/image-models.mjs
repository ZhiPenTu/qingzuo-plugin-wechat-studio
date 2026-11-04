export function mergeImageModels(official = [], proxy = []) {
  const seen = new Set();
  return [...official, ...proxy].filter(model => {
    const id = String(model?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function imageModelSource(models = [], modelId = '') {
  return models.find(model => model?.id === modelId)?.source === 'proxy' ? 'proxy' : 'official';
}

export function imageModelLabel(model) {
  const title = String(model?.title || model?.id || '');
  return model?.source === 'proxy' ? title + '（兼容服务）' : title;
}
