#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
const icon = 'data:image/png;base64,' + (await readFile(path.join(root, 'assets', 'icon.png'))).toString('base64');

if (pkg.commerce?.icon === icon) {
  console.log('插件图标已与 assets/icon.png 同步。');
} else {
  pkg.commerce.icon = icon;
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('已从 assets/icon.png 同步插件图标。');
}
