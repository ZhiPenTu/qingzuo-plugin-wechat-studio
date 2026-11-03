# 公众号 AI 工作台

轻作 Qingzuo 的独立插件，覆盖公众号文章从选题、调研、写稿、内容审、排版、配图、终审到草稿/发布的完整流程，并提供五步配置中心、业务素材库和贴图工作流。

## 能力

- 完整流程、改写、新写、粘贴正文、公众号链接读取和继续已有草稿。
- 五步配置台：账号与读者、内容策略、写作规范、视觉呈现、发布设置。
- 8 套排版主题 × 3 套配色、9 个版式组件、图注和公众号嵌入。
- 12 种封面形态、8 种正文形态、8 种统一媒介，共享轻作图片模型生成。
- `.aws-article/products/` 业务素材库和 `posts/stickers/` 贴图工作流。
- 宿主托管的远程 MCP 只读工具、公众号草稿和发布能力。
- `.aws` 预设包导入预览与白名单导出；配置、写作规范和预设可迁移，密钥不会写入导出包。

## 安全边界

- 插件只访问宿主授权的一个工作区，且仅开放 `.aws-article/`、`drafts/`、`posts/`、`series/`。
- 插件看不到工作区真实绝对路径、MCP 服务 URL/令牌或公众号 AppSecret/access token。
- 微信发布每次都由宿主原生确认；结果未知时先查询状态，不会自动重复提交。
- 插件不包含任意网络权限、模型密钥、微信凭证或本机后端。

## 开发

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run validate
npm run pack
npm run verify:package
```

`npm run pack` 在当前平台生成对应平台的 `.ecplugin` 和 `catalog-<平台>.json`。发布流水线分别在 macOS arm64 与 Windows x64 构建，校验制品的 URL、大小与 SHA-256，再用固定底座 `v0.7.0` 完成安装验收。插件为纯前端包，生产环境不执行包内脚本，也不需要 `node_modules`。

推送到 `ZhiPenTu/qingzuo-plugin-wechat-studio` 后，创建与 `package.json` 版本一致的 `vX.Y.Z` 标签即可构建并发布 GitHub Release。正式发布日志保存在 `docs/releases/`。

## 许可证

Apache-2.0。行为基准与预设来源见 `NOTICE`。

