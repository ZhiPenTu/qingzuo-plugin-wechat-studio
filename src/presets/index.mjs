import YAML from 'yaml';

const themeModules = import.meta.glob('./themes/*.yaml', { query: '?raw', import: 'default', eager: true });
const componentModules = import.meta.glob('./components/*.yaml', { query: '?raw', import: 'default', eager: true });

function parse(raw) {
  return YAML.parse(raw);
}

export const BUILTIN_THEMES = Object.fromEntries(
  Object.values(themeModules).map(raw => {
    const value = parse(raw);
    return [value.name, value];
  }),
);

export const BUILTIN_COMPONENTS = Object.fromEntries(
  Object.values(componentModules).map(raw => {
    const value = parse(raw);
    return [value.name, value];
  }),
);

export const THEME_NAMES = Object.keys(BUILTIN_THEMES).sort((left, right) =>
  Number(BUILTIN_THEMES[left].sort_order || 99) - Number(BUILTIN_THEMES[right].sort_order || 99),
);

export const THEME_SUMMARY = THEME_NAMES.map(name => {
  const theme = BUILTIN_THEMES[name];
  return {
    name,
    description: theme.description || '',
    whenToUse: theme.when_to_use || '',
    whenNotToUse: theme.when_not_to_use || '',
    defaultScheme: theme.default_scheme || '',
    schemes: (theme.schemes || []).map(item => ({
      name: item.name,
      color: item.variables?.['primary-color'] || '',
      description: item.description || '',
    })),
  };
});

export function parseThemeYaml(raw) {
  const value = YAML.parse(raw);
  if (!value?.name || !value?.styles) throw new Error('主题文件缺少 name 或 styles。');
  return value;
}

export function parseComponentYaml(raw) {
  const value = YAML.parse(raw);
  if (!value?.name || !value?.template) throw new Error('组件文件缺少 name 或 template。');
  return value;
}
