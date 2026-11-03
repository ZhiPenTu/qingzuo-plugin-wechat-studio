import { createHash } from 'node:crypto';

export const REPOSITORY = 'ZhiPenTu/qingzuo-plugin-wechat-studio';

export function currentPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return platform + '-' + arch;
  if (platform === 'win32' && arch === 'x64') return platform + '-' + arch;
  throw new Error('不支持的发布平台：' + platform + '-' + arch);
}

export const SUPPORTED_PLATFORMS = new Set([currentPlatform('darwin', 'arm64'), currentPlatform('win32', 'x64')]);

export function resolvePlatform(value) {
  const platform = value || currentPlatform();
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error('发布平台必须为 darwin-arm64 或 win32-x64。');
  }
  return platform;
}

export function artifactName(pkg, platform) {
  return pkg.commerce.id + '-' + pkg.version + '-' + resolvePlatform(platform) + '.ecplugin';
}

export function catalogFor(pkg, platform, bytes) {
  const target = resolvePlatform(platform);
  const name = artifactName(pkg, target);
  const metadata = {};
  for (const field of ['id', 'title', 'description', 'category', 'api', 'releaseNotes', 'icon']) {
    if (pkg.commerce[field] !== undefined) metadata[field] = pkg.commerce[field];
  }
  return {
    schemaVersion: 1,
    plugins: [{
      ...metadata,
      id: pkg.commerce.id,
      version: pkg.version,
      artifacts: {
        [target]: {
          url: 'https://github.com/' + REPOSITORY + '/releases/download/v' + pkg.version + '/' + name,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
    }],
  };
}
