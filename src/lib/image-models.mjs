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

function ratioValue(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(value || ''));
  if (!match) return 0;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 0;
}

function sizeValue(value) {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(value || ''));
  if (!match) return 0;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 0;
}

function closest(value, candidates, read) {
  const target = ratioValue(value);
  if (!target) return '';
  let selected = '';
  let distance = Infinity;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const ratio = read(candidate);
    if (!ratio) continue;
    const next = Math.abs(Math.log(ratio / target));
    if (next < distance) {
      selected = String(candidate);
      distance = next;
    }
  }
  return selected;
}

export function imageParametersForModel(model, aspect) {
  if (!model || !ratioValue(aspect)) return {};
  const ratio = closest(aspect, model.ratios, ratioValue);
  if (ratio) return { ratio };
  const size = closest(aspect, model.sizes, sizeValue);
  return size ? { size } : {};
}

export function groupImageRequests(requests, model) {
  const groups = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    const parameters = imageParametersForModel(model, request?.aspect);
    const key = JSON.stringify(parameters);
    const group = groups.get(key) || { parameters, items: [] };
    group.items.push(request);
    groups.set(key, group);
  }
  return [...groups.values()];
}
