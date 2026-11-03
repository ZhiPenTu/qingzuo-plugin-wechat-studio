import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(root, 'presets', 'themes');

export const BUILTIN_THEMES = Object.fromEntries(
  readdirSync(directory)
    .filter(name => name.endsWith('.yaml'))
    .map(name => {
      const value = YAML.parse(readFileSync(path.join(directory, name), 'utf8'));
      return [value.name, value];
    }),
);
