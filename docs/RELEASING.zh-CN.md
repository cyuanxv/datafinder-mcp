# 发布前核对与正式发布步骤

[English](RELEASING.en.md)

本文件是发布准备材料，不是执行发布的授权。发布前必须获得维护者明确授权。未发布分叉可设置 private=true 防止误发；正式包使用官方 registry 和 public access。

## 1. 先核对身份和范围

使用 Node.js 24+，在完整源码根目录运行：

```sh
node standalone/preflight.mjs
node standalone/preflight.mjs --check-account
```

第一条只检查本地配置，第二条额外执行官方 npm registry 的 `npm whoami`。它们不会登录、创建令牌、修改权限或发布。

拟用 npm 包名为 `@cyuanxv/datafinder-mcp`，Registry 名为 `io.github.cyuanxv/datafinder-mcp`。GitHub 账号和 npm 账号相互独立。即使 npm 公开查询返回 404，也只能说明该包当前没有公开返回，不能证明已获得命名空间权限或预留名称。

如果 npm 未登录，在你自己的终端执行以下登录动作并自行完成浏览器验证：

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org
```

不要把密码、验证码或令牌发送到聊天。登录后重新执行上面的账号预检。若 npm 用户名与拟用包名中的 scope 相同，可确认个人命名空间对应；最终发布仍可能受当前凭证的写权限、邮箱验证、2FA 或组织策略限制。若是其他账号，先核实是否有目标 scope 的组织权限，或者由作者决定更换 npm scope，不能自动沿用 GitHub 用户名。

对已存在的目标包，可只读查询：

```sh
npm access list collaborators @cyuanxv/datafinder-mcp --registry=https://registry.npmjs.org --json
```

新包尚不存在时，不能用这个查询确认新包的实际发布权限。不要执行 access set/grant/revoke、owner add 或创建自动化令牌来“测试权限”。

## 2. 固定待发布内容

1. 确认 package.template.json、实际 package.json 和 server.json 的包名、mcpName、版本完全对应；当前版本 0.2.0。
2. 执行已有独立安装验收，核对 52 工具和数据库/后台链路；保留代码回归、敏感信息扫描和压缩包摘要。
3. 构建并只看打包文件清单，不运行发布：

```sh
node standalone/build.mjs
cd standalone/package
npm pack --dry-run --json --ignore-scripts
```

`npm pack --dry-run` 只检查包的内容，不验证发布权限。只有获得公开发布授权后才可解除 private 标志。

4. MIT、第三方声明、中文和英文文档、Node.js 24+ 要求及默认只读说明应包含在产物中。
5. 真实配置、密钥、数据库、验收结果、HTTP 日志和原 Git 历史不能进入包。GitHub 简介/Topics/封面按 GITHUB-SETUP.md 的准备材料应用到新仓库。

## 3. 只有决定公开后才执行

以下是将来的操作顺序，本轮不执行：

1. 新建干净仓库 `cyuanxv/datafinder-mcp`，上传经过检查的源码；不改变原私有仓库可见性，不复制旧历史。回读仓库和所有对外文档。
2. 核实最终仓库 URL 后补充 npm repository 字段及 Registry repository 信息，避免提前声称一个未创建的地址存在。
3. 明确授权公开 npm 后，移除模板和实际包里的 private 防误发字段，设置正式 registry/access，再重新构建、扫描、冻结摘要并做发布 dry-run。修改发布元数据后产物摘要会改变，必须以新产物为准。
4. 使用有权限的 npm 账号发布到官方 registry；需要验证码时由账号所有者输入，不记录验证码。
5. 回读 `@cyuanxv/datafinder-mcp@0.2.0` 的版本、来源和 dist.integrity，并用公开包在新目录安装验收。未回读不能称为发布成功。
6. 用 GitHub 身份通过 mcp-publisher 认证，提交对应 server.json，再查询官方 Registry 记录；提交前再次检查 npm 包已公开且名称版本匹配。
7. 对外安装说明只有在公共包存在并验证后，才能改为公共 npx 安装命令。Registry 收录不等于 ChatGPT 上架。

首次正式公开前重新查 npm 同名版本是否存在；已经发布的同名版本不能覆盖。当前本地测试包不占用公共版本。

## 参考

- [npm scopes](https://docs.npmjs.com/about-scopes/)
- [npm whoami](https://docs.npmjs.com/cli/v11/commands/npm-whoami/)
- [npm publish 与 dry-run](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [官方 MCP Registry 发布流程](https://modelcontextprotocol.io/registry/quickstart)

## 已验证的发布环境

0.2.0 已于 2026-10-22 发布到 npm 和官方 MCP Registry。公共 npm 全新安装通过全部 27 项独立验收，发现 52 个工具；95 个安装文件与最终压缩包一致，npm integrity 一致。

维护者发布使用 Node.js 24+ 和新版 npm 11。本次使用 npm 11.21.1；本机 npm 10 上传超时，npm 11 成功进入官方网页验证并完成发布。不要关闭双重验证，也不要在聊天中发送凭证。

```sh
npx --yes npm@11 publish --access public --registry=https://registry.npmjs.org --ignore-scripts
```

仅在发布获批、安装包验收通过后，从准备好的 standalone/package 目录执行。网页确认在 npm 官方页面完成。npm 回读验证后，再登录 mcp-publisher 并及时提交，最后回读 Registry 的 active 记录。
