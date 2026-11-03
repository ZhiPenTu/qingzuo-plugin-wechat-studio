const DEFAULT_VARIABLES = {
  'primary-color': '#0F4C81',
  'primary-fill': '#0F4C81',
  'primary-ink': '#0F4C81',
  'bg-accent-soft': '#F7F9FB',
  'bg-accent-color': '#F0F4F8',
  'highlight-pen': '#C6D6E6',
  'highlight-soft': '#DCE6F0',
  'secondary-soft': '#EEF2F6',
  'secondary-color': '#C9A45C',
  'secondary-on-fill': '#C9A45C',
  'text-color': '#333333',
  'text-light': '#666666',
  'text-muted': '#999999',
  'bg-light': '#F7F7F7',
  'border-color': '#EEEEEE',
  'link-color': '#576B95',
  'font-size': '16px',
  'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'line-height': '1.8',
  'paragraph-spacing': '1.5em',
};

const DEFAULT_STYLES = {
  h1: 'text-align:center; font-size:22px; font-weight:bold; margin-bottom:24px;',
  h2: 'font-size:18px; font-weight:bold; margin-top:2em; margin-bottom:1em;',
  h3: 'font-size:16px; font-weight:bold; margin-top:1.5em; margin-bottom:0.8em;',
  h4: '',
  p: '',
  strong: '',
  em: '',
  a: '',
  blockquote: 'border-left:3px solid #DDD; padding:8px 16px; margin:1em 0;',
  ul: '',
  ol: '',
  li: '',
  hr: 'border:none; border-top:1px solid #EEE; margin:2em 0;',
  img: '',
  figcaption: '',
  code: '',
  pre: '',
  table: 'width:100%; border-collapse:collapse; margin:1em 0; font-size:14px;',
  th: 'background:#f5f5f5; padding:8px 14px; text-align:center; font-weight:bold;',
  td: 'padding:8px 14px; border:1px solid #EEE; text-align:center;',
};

const DERIVED = [
  'primary-fill',
  'primary-ink',
  'bg-accent-soft',
  'bg-accent-color',
  'highlight-pen',
  'highlight-soft',
  'secondary-on-fill',
  'secondary-soft',
];

const COMPONENT_VARS = [
  'primary-ink',
  'primary-fill',
  'primary-color',
  'bg-accent-soft',
  'bg-accent-color',
  'highlight-soft',
  'highlight-pen',
  'secondary-on-fill',
  'secondary-soft',
  'secondary-color',
  'text-color',
  'text-light',
  'text-muted',
  'border-color',
  'link-color',
  'font-size',
  'line-height',
];

function normalizeHex(value) {
  let hex = String(value || '').trim().replace(/^#/, '');
  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map(char => char + char).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return '#' + hex.toUpperCase();
}

function luminance(hex) {
  const value = normalizeHex(hex) || '#000000';
  const channel = offset => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastOnWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function darkenToReadable(hex, target = 4.5) {
  let value = normalizeHex(hex) || '#0F4C81';
  let channels = [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  for (let index = 0; index < 40; index += 1) {
    value = '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (contrastOnWhite(value) >= target) break;
    channels = channels.map(channel => Math.max(0, Math.round(channel * 0.94)));
  }
  return value;
}

function mixToWhite(hex, ratio) {
  const value = normalizeHex(hex) || '#0F4C81';
  const channels = [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  return '#' + channels.map(channel => Math.round(channel + (255 - channel) * ratio).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function derivePalette(accent, secondary) {
  const primary = normalizeHex(accent) || DEFAULT_VARIABLES['primary-color'];
  const fill = contrastOnWhite(primary) >= 3 ? primary : darkenToReadable(primary, 3);
  return {
    'primary-fill': fill,
    'primary-ink': darkenToReadable(primary),
    'bg-accent-soft': mixToWhite(primary, 0.96),
    'bg-accent-color': mixToWhite(primary, 0.92),
    'highlight-pen': mixToWhite(primary, 0.74),
    'highlight-soft': mixToWhite(primary, 0.84),
    'secondary-on-fill': secondary && contrast(secondary, fill) >= 3 ? secondary : '#FFFFFF',
    'secondary-soft': mixToWhite(normalizeHex(secondary) || primary, 0.9),
  };
}

function resolveVars(template, variables) {
  let result = String(template ?? '');
  for (let round = 0; round < 3; round += 1) {
    for (const [key, value] of Object.entries(variables)) result = result.split('{' + key + '}').join(String(value));
  }
  return result;
}

export function applyScheme(theme, schemeName) {
  if (!schemeName) return structuredClone(theme);
  const scheme = (theme.schemes || []).find(item => String(item.name).trim() === String(schemeName).trim());
  if (!scheme) throw new Error('主题「' + theme.name + '」没有配色「' + schemeName + '」。');
  return {
    ...structuredClone(theme),
    variables: { ...(theme.variables || {}), ...(scheme.variables || {}) },
    selected_scheme: scheme.name,
  };
}

export function buildStyles(theme, overrides = {}) {
  const variables = { ...DEFAULT_VARIABLES, ...(theme.variables || {}), ...overrides };
  const pinned = new Set(Object.keys(theme.variables || {}));
  if (overrides['primary-color']) for (const key of DERIVED) pinned.delete(key);
  const derived = derivePalette(variables['primary-color'], variables['secondary-color']);
  for (const [key, value] of Object.entries(derived)) if (!pinned.has(key)) variables[key] = value;
  const resolved = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, resolveVars(value, variables)]));
  const styles = { ...DEFAULT_STYLES, ...(theme.styles || {}) };
  for (const [key, value] of Object.entries(styles)) resolved[key] = resolveVars(value, resolved);
  if (overrides['font-size']) {
    for (const key of ['p', 'li']) {
      if (resolved[key]) resolved[key] = resolved[key].replace(/font-size:\s*[^;]+;?/g, 'font-size:' + overrides['font-size'] + ';');
    }
  }
  return resolved;
}

export function substituteTheme(html, styles) {
  let result = String(html ?? '');
  for (const key of COMPONENT_VARS) result = result.split('{' + key + '}').join(String(styles[key] ?? ''));
  return result;
}

export function themeCatalog(themes) {
  return Object.values(themes)
    .sort((left, right) => Number(left.sort_order || 99) - Number(right.sort_order || 99))
    .map(theme => ({
      name: theme.name,
      description: theme.description || '',
      whenToUse: theme.when_to_use || '',
      whenNotToUse: theme.when_not_to_use || '',
      defaultScheme: theme.default_scheme || '',
      schemes: (theme.schemes || []).map(item => ({
        name: item.name,
        color: item.variables?.['primary-color'] || '',
        description: item.description || '',
      })),
    }));
}
