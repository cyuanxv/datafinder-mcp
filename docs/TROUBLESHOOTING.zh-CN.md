# DataFinder MCP：新手安装与排错指南

适用：独立安装版 0.2.1｜核对日期：2026-10-22

[English](TROUBLESHOOTING.en.md) · [返回项目首页](../README.md) · [观看演示视频](https://github.com/user-attachments/assets/9ee2402d-c30d-40fc-82c7-02d2f36ef238)

第一次使用，建议先跑虚构数据样例。看到正确结果后，再连接自己的 DataFinder。

## 1. 先选对安装方式

| 你想怎么用 | 需要准备什么 |
|---|---|
| 在支持本地 MCP 的 AI 客户端里使用 | Node.js 24+、安装包、客户端配置；连接方式通常叫 stdio |
| 在 ChatGPT 网页版里连接 | 需要另行部署带认证的远程 MCP 服务；只安装 npm 包还不能连接 |
| 先看视频里的浏览器演示 | 从源码运行 demo；不需要真实密钥，只有预设虚构样例 |

独立安装包不包含云端管理网页，也不提供免费托管。电脑关机后任务不会自行运行，除非你把后台进程放到持续在线的服务器。

## 2. 检查 Node.js

打开终端，执行：

```sh
node --version
npm --version
```

Node.js 的结果应是 `v24...` 或更高版本。看到 `v22...`、`v20...`，先安装或切换到 Node.js 24+。下载入口：[Node.js 官网](https://nodejs.org/)。

**注意：终端里的 Node.js 和 AI 客户端找到的 Node.js 可能不是同一个。** 配置绝对路径可以减少这类问题。

macOS / Linux 查看路径：

```sh
command -v node
```

Windows PowerShell 查看路径：

```powershell
(Get-Command node).Source
```

确认这个路径对应的 Node.js 版本满足要求。

## 3. 在新目录安装

```sh
mkdir datafinder-mcp-demo
cd datafinder-mcp-demo
npm init -y
npm install @cyuanxv/datafinder-mcp@0.2.1
npm ls @cyuanxv/datafinder-mcp
```

最后一条命令应显示 `@cyuanxv/datafinder-mcp@0.2.1`。只安装和运行这个公开包，不需要 npm 发布权限，也不需要作者的账号或密钥。

## 4. 配置客户端，先开演示模式

在支持 stdio 的 MCP 客户端中，按该客户端的配置入口加入以下内容。两处程序路径和数据库路径都要换成你自己的**绝对路径**，不要原样保留 `/absolute/path/`。

```json
{
  "mcpServers": {
    "datafinder": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/datafinder-mcp-demo/node_modules/@cyuanxv/datafinder-mcp/server.mjs"
      ],
      "env": {
        "DATAFINDER_DEMO": "true",
        "DATAFINDER_DB_PATH": "/absolute/path/to/datafinder-mcp-demo/workbench.sqlite"
      }
    }
  }
}
```

Windows 路径可以使用正斜杠，例如 `C:/Users/your-name/datafinder-mcp-demo/...`。JSON 不支持注释和末尾多余逗号。

保存后，断开并重新连接 MCP 服务；必要时退出并重新打开客户端。应能发现 **52 个工具**。客户端可能只展示部分常用工具，以完整工具发现结果为准。

也可以把客户端启动命令配置成 `npx -y @cyuanxv/datafinder-mcp@0.2.1`，同时保留演示模式和数据库环境变量。首次使用 npx 需要下载依赖；新手排错时，优先使用上面已安装包的绝对路径。

不要把“在终端运行命令后没有输出”直接当作失败：stdio 服务本来就在等客户端发请求。不要随意向它的输入窗口粘贴聊天内容。

## 5. 发起第一条演示查询

可以让 AI：

> 使用 run_analysis 查询事件 demo_page_view，统计事件次数，日期为 2020-01-01 至 2020-01-02。

参数如下：

```json
{
  "kind": "event",
  "events": [
    {"event_name": "demo_page_view", "indicator": "events"}
  ],
  "start_date": "2020-01-01",
  "end_date": "2020-01-02"
}
```

预期结果：成功返回两天数据，每天 100 次事件，带有虚构数据标记。工具发现成功只证明连上了服务；这条查询成功才证明演示查询可用。

演示模式只实现指定样例，不支持任意提问，也不会自动切换到真实接口。样例不支持时返回错误是正常边界。

## 6. 连接自己的 DataFinder

演示查询通过后，将 `DATAFINDER_DEMO` 改成 `false`。在客户端的安全环境配置中加入自己的：

```text
DATAFINDER_AK
DATAFINDER_SK
DATAFINDER_PROJECT_ID
DATAFINDER_APP_ID
DATAFINDER_SUBJECT_ID
```

分别对应访问密钥、密钥、项目 ID、应用 ID、分析主体 ID。继续使用自己可写的数据库绝对路径。不要复制作者的项目 ID 或生产地址，也不要将密钥写进源码、公开文档或截图。

“主体”是项目配置的分析对象，例如用户、设备或其他业务实体；需要使用自己项目实际存在的主体 ID。先查询一段已知有数据的日期，再核对事件名、统计口径、时区和筛选条件。

默认关闭本地业务保存和上游元数据修改。只查数据时，保持默认即可。

## 7. 常见问题：看到什么，就检查什么

| 现象 | 优先检查 | 下一步 |
|---|---|---|
| 提示找不到 node、ENOENT | 客户端使用的 Node.js 路径 | 改用已确认版本的绝对路径，再重新连接 |
| 提示不支持 SQLite / Node 版本不符 | 客户端实际启动的是不是 Node.js 24+ | 不要只看终端默认版本；检查配置中的程序路径 |
| npm 安装超时 | 本机能否访问 npm、是否有代理错误 | 先运行 `npm ping --registry=https://registry.npmjs.org/`；不要关闭证书校验，也不必反复登录 npm |
| 配置后没有工具 | JSON 格式、路径、客户端是否重连 | 去掉注释和末尾逗号；查看客户端 MCP 日志 |
| EACCES / SQLITE_CANTOPEN / 数据库无法打开 | 数据库目录是否存在且当前账户可写 | 使用自己目录下的新文件路径；不要用 sudo 或把目录权限改成 777 |
| 演示样例报不支持 | 演示模式只覆盖固定样例 | 原样运行第 5 节参数；真实业务问题需切换真实模式 |
| 配置看起来正常，真实查询却失败 | AK/SK、项目/App/主体是否匹配，火山权限是否齐全 | 查看业务错误码和消息；HTTP 200 本身不代表查询成功 |
| 查询成功但没数据 | 日期、时区、事件名、筛选条件 | 先移除额外筛选，查询控制台已知有数据的时间段 |
| 和控制台结果不同 | 人数还是次数、用户还是设备、日期边界和转化窗口 | 逐项对齐口径后再比较；不要把事件次数当成去重用户数 |
| 保存指标或提交任务提示只读 | 默认不允许本地业务写入 | 只有确需保存时才启用 `DATAFINDER_ALLOW_LOCAL_WRITES=true`，仍需预览和确认 |
| 元数据修改仍被拒绝 | 本地保存权限不等于火山修改权限 | 另需启用 `DATAFINDER_ALLOW_UPSTREAM_WRITES=true` 并具备火山侧权限；不需要修改时保持关闭 |
| 任务已排队但没结果 | 是否启动独立 worker，且配置一致 | 前台、worker 使用同一数据库、身份和项目；排队不等于执行成功 |
| 导出链接打不开 | 前台是否仍在运行，链接是否来自当前连接 | 在运行服务的电脑上打开；重启后重新生成链接，不公开分享含令牌链接 |
| CSV 打开后中文乱码 | 表格软件导入编码 | 使用“从文本/CSV 导入”，选择 UTF-8；不要反复改原文件内容 |

需要后台任务时，用同一套安全环境变量启动：

```sh
/absolute/path/to/node /absolute/path/to/install/node_modules/@cyuanxv/datafinder-mcp/server.mjs --worker
```

后台任务还需本地写入开关和用户确认。关闭前台不等于 worker 仍在运行；重启电脑后需要重新启动 worker 或自行配置服务管理。

## 8. 视频、浏览器演示与安装样例为什么数字不同？

视频里的浏览器演示固定使用 **2020-01-01 至 2020-01-07**，全部平台为 **9,912 次事件**；筛选 iOS 后为 **4,746 次事件**。导出为 **21 行数据**，即 7 天 × 3 个渠道。

第 5 节的独立包安装样例是另一个更小的虚构样例：两天，每天 100 次事件。两者用途不同，数字不应直接比较。

视频是现有本地演示页的实际操作画面剪辑，包含预设问题，不是真实 ChatGPT 对话。可以从项目完整源码运行浏览器演示：

```sh
git clone https://github.com/cyuanxv/datafinder-mcp.git
cd datafinder-mcp/site
npm ci
npm run demo
```

然后访问 `http://127.0.0.1:4178/?lang=zh`。这不是连接生产账户的管理后台。

## 9. 哪些事情需要火山侧权限？

真实查询需要有效的 DataFinder 凭证和项目权限。52 个工具不等于自动获得所有火山产品权限，例如用户标签需要对应 CDP 权益。这个安装包不提供修改上游报表或删除数据的功能。

## 10. 仍有问题，怎么反馈？

提交 Issue 时写清：系统、Node.js 版本、安装包版本、使用的客户端、演示还是真实模式、出错工具、脱敏后的错误码/消息、复现步骤。可以提供不含业务数据的最小样例。

不要提交 AK/SK、Cookie、数据库文件、用户明细或带令牌的下载链接。先确认日志里没有这些内容。

- [GitHub 项目](https://github.com/cyuanxv/datafinder-mcp)
- [npm 安装包](https://www.npmjs.com/package/@cyuanxv/datafinder-mcp)
- [完整中文安装文档](https://github.com/cyuanxv/datafinder-mcp/blob/main/standalone/README.md)
- [英文安装文档](https://github.com/cyuanxv/datafinder-mcp/blob/main/standalone/README.en.md)
- [问题反馈](https://github.com/cyuanxv/datafinder-mcp/issues)
