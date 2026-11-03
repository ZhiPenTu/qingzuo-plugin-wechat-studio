import YAML from 'yaml';
import { BUILTIN_COMPONENTS, BUILTIN_THEMES } from '../presets/index.mjs';
import { applyScheme, buildStyles } from './styles.mjs';
import { renderMarkdownDocument } from './markdown.mjs';
import { checkDraft, stripCitations } from './writing.mjs';
import { reviewArticle, formatReviewMarkdown } from './review.mjs';
import { planImages, rewriteImageMarkers } from './images.mjs';
import { parseYamlObject, mergedConfig, serializeConfig, validateConfig } from './config.mjs';

const customThemes = {};
const customComponents = {};

function themes() {
  return { ...BUILTIN_THEMES, ...customThemes };
}

function components() {
  return { ...BUILTIN_COMPONENTS, ...customComponents };
}

function loadCustom(rawThemes = [], rawComponents = []) {
  for (const raw of rawThemes) {
    try {
      const value = YAML.parse(raw);
      if (value?.name && value?.styles) customThemes[value.name] = value;
    } catch {
      continue;
    }
  }
  for (const raw of rawComponents) {
    try {
      const value = YAML.parse(raw);
      if (value?.name && value?.template) customComponents[value.name] = value;
    } catch {
      continue;
    }
  }
}

function render(input = {}) {
  const catalog = themes();
  const theme = catalog[input.theme || '亲和'];
  if (!theme) throw new Error('主题「' + input.theme + '」不存在。');
  const themed = applyScheme(theme, input.scheme || theme.default_scheme);
  const styles = buildStyles(themed, {
    ...(input.color ? { 'primary-color': input.color } : {}),
    ...(input.fontSize ? { 'font-size': input.fontSize } : {}),
  });
  const rendered = renderMarkdownDocument(input.markdown || '', {
    styles,
    components: components(),
    embeds: input.embeds || {},
    captionStyle: input.captionStyle || '有图注',
  });
  return {
    html: rendered,
    styles,
    theme: themed.name,
    scheme: themed.selected_scheme || themed.default_scheme || '',
  };
}

export function execute(action, payload = {}) {
  if (action === 'presets') return { themes: themes(), components: components() };
  if (action === 'loadPresets') {
    for (const key of Object.keys(customThemes)) delete customThemes[key];
    for (const key of Object.keys(customComponents)) delete customComponents[key];
    loadCustom(payload.themes, payload.components);
    return { themes: Object.keys(themes()), components: Object.keys(components()) };
  }
  if (action === 'render') return render(payload);
  if (action === 'check') return checkDraft(payload.markdown, payload.config);
  if (action === 'review') return reviewArticle(payload.markdown, payload.config, { html: payload.html });
  if (action === 'reviewMarkdown') return { markdown: formatReviewMarkdown(payload.review) };
  if (action === 'stripCitations') return { markdown: stripCitations(payload.markdown) };
  if (action === 'planImages') return planImages(payload.markdown, payload.config, payload.article);
  if (action === 'rewriteImageMarkers') return { markdown: rewriteImageMarkers(payload.markdown, payload.plan) };
  if (action === 'parseYaml') return parseYamlObject(payload.text, payload.label);
  if (action === 'mergeConfig') return mergedConfig(payload.config, payload.article);
  if (action === 'serializeConfig') return { text: serializeConfig(payload.config) };
  if (action === 'validateConfig') return { errors: validateConfig(payload.config) };
  throw new Error('未知处理任务。');
}
