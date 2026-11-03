import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactName, currentPlatform } from '../scripts/release-utils.mjs';
import { launchPluginTestHost } from './launch-host.mjs';

const executablePath = process.env.QINGZUO_HOST_EXECUTABLE;
if (!executablePath) throw new Error('指定固定底座 QINGZUO_HOST_EXECUTABLE。');

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const platform = currentPlatform();
const artifact = path.resolve('release', artifactName(pkg, platform));
const expectedVersion = (process.env.QINGZUO_HOST_VERSION || 'v0.7.0').replace(/^v/, '');
const applicationRoot = process.platform === 'darwin' ? path.resolve(executablePath, '../../..') : path.dirname(executablePath);
const archive = path.join(applicationRoot, process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
const evidence = process.env.QINGZUO_UI_EVIDENCE_DIR || path.resolve('output', 'host-' + platform);
const host = await launchPluginTestHost({ executablePath, artifactPath: artifact, pluginId: pkg.commerce.id });
const pageErrors = [];
host.plugin.on('pageerror', error => pageErrors.push(error.message));

try {
  const status = await host.page.evaluate(() => window.commerceDesktop.invoke('status'));
  expect(status.version).toBe(expectedVersion);
  const installed = status.plugins.find(plugin => plugin.id === pkg.commerce.id);
  expect(installed).toMatchObject({ version: pkg.version, enabled: true, source: 'local' });
  expect(installed.permissions).toEqual(pkg.commerce.permissions);

  const workspace = path.join(host.temporary, 'workspace');
  await mkdir(workspace);
  await host.app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, workspace);

  await expect(host.plugin.getByRole('heading', { name: '选择工作文件夹', exact: true })).toBeVisible();
  await host.plugin.getByRole('button', { name: '选择工作文件夹', exact: true }).click();
  await expect(host.plugin.getByRole('heading', { name: '创作工作台', exact: true })).toBeVisible();
  await expect(host.plugin.getByRole('navigation', { name: '主要功能' }).getByRole('button')).toHaveCount(5);
  await expect(host.plugin.getByRole('radiogroup', { name: '创作入口' }).getByRole('radio')).toHaveCount(6);

  await host.plugin.getByRole('button', { name: '配置中心', exact: true }).click();
  await expect(host.plugin.getByRole('heading', { name: '配置中心', exact: true })).toBeVisible();
  for (const step of ['账号与读者', '内容策略', '写作规范', '视觉呈现', '发布设置']) {
    await host.plugin.getByRole('navigation', { name: '配置步骤' }).getByRole('button', { name: new RegExp(step) }).click();
    await expect(host.plugin.getByRole('heading', { name: step, exact: true })).toBeVisible();
  }

  await host.plugin.getByRole('button', { name: '创作工作台', exact: true }).click();
  await host.plugin.getByLabel('文章标题').fill('发布验收文章');
  await host.plugin.getByLabel('主题或既定方向').fill('本地工作区发布验收');
  await host.plugin.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(host.plugin.getByRole('heading', { name: '发布验收文章', exact: true })).toBeVisible();
  await expect(host.plugin.getByLabel('创作阶段')).toBeVisible();

  const drafts = await host.plugin.evaluate(() => window.commercePlugin.invoke('workspace.list', { path: 'drafts', recursive: false }));
  expect(drafts.some(entry => entry.kind === 'directory')).toBe(true);

  await mkdir(evidence, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await host.plugin.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 700, 940, 1440]) {
      await host.plugin.setViewportSize({ width, height: 900 });
      await expect.poll(() => host.plugin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await host.plugin.screenshot({ path: path.join(evidence, scheme + '-' + width + '.png') });
    }
  }

  expect(createHash('sha256').update(await readFile(archive)).digest('hex')).toBe(digest);
  expect(pageErrors).toEqual([]);
  console.log('公众号 AI 工作台安装验收通过：工作区授权、五步配置、项目创建、四种宽度与深浅色均通过；底座文件未修改。');
} finally {
  await host.close();
}
