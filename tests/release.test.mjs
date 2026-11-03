import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { catalogFor, currentPlatform, resolvePlatform } from '../scripts/release-utils.mjs';

const pkg = {
  name: '@qingzuo/plugin-wechat-studio',
  version: '0.1.0',
  commerce: {
    id: 'official.wechat-studio',
    title: '公众号 AI 工作台',
    description: '说明',
    category: '内容创作',
    api: '^1.9.0',
    releaseNotes: '首个版本',
    icon: 'data:image/png;base64,AAAA',
  },
};

test('release platform and catalog fragments match the market contract', () => {
  assert.equal(currentPlatform('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(currentPlatform('win32', 'x64'), 'win32-x64');
  assert.throws(() => currentPlatform('linux', 'x64'), /不支持/);
  assert.throws(() => resolvePlatform('linux-x64'), /发布平台必须/);
  const bytes = Buffer.from('plugin');
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const catalog = catalogFor(pkg, platform, bytes);
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.plugins.length, 1);
    assert.deepEqual(
      Object.keys(catalog.plugins[0]).sort(),
      ['api', 'artifacts', 'category', 'description', 'icon', 'id', 'releaseNotes', 'title', 'version'],
    );
    assert.deepEqual(catalog.plugins[0].artifacts[platform], {
      url: 'https://github.com/ZhiPenTu/qingzuo-plugin-wechat-studio/releases/download/v0.1.0/official.wechat-studio-0.1.0-' + platform + '.ecplugin',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
});
