# DataFinder MCP — 52 tools, independent storage and background jobs

SQL 指标现可在字典中绑定明确的表和列，统一完成预览、查询和条数追问。沿用已保存日期，不临时覆盖日期或筛选；旧指标需先补绑定并确认，导入仍先预览。


**简体中文** | [English](README.en.md)

独立安装版现已接入与云端版相同名称的 **52 个 MCP 工具**，包括分析、指标字典、映射、查询模板、连续追问、任务、巡检、归档、元数据预览和确认。使用自己的 SQLite 数据库，不需要原作者的服务、数据库或密钥。

工具齐全不代表火山接口或商业权限自动开通：用户标签等能力仍取决于账户购买权限；不支持的上游字段继续明确拒绝。独立版不包含云端管理网页。

[查看完整 52 工具清单](TOOLS.md)

支持查询已保存 SQL 中的事件日期参数：先预览预计日期，再执行原有报表；跨天或保存配置变化后需要重新预览。暂不支持临时覆盖参数。云端部署可在个人电脑离线时运行；本机 npm 安装的后台进程需要运行主机保持开机。

## 安装和连接

需要 **Node.js 24 或更高版本**（使用内置 SQLite）。在新目录里安装：

```sh
npm init -y
npm install @cyuanxv/datafinder-mcp@0.2.4
```

支持 stdio 的 MCP 客户端可按下面配置。将两处示例路径替换为本机真实路径：

```json
{
  "mcpServers": {
    "datafinder": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/install/node_modules/@cyuanxv/datafinder-mcp/server.mjs"],
      "env": {
        "DATAFINDER_DEMO": "true",
        "DATAFINDER_DB_PATH": "/absolute/path/to/your-data/workbench.sqlite"
      }
    }
  }
}
```

也可使用 `npx -y @cyuanxv/datafinder-mcp@0.2.4` 启动。stdio 是客户端在本机启动的连接方式；ChatGPT 网页需要单独部署的远程服务，本次本地验收不等于 ChatGPT 网页原生连接验收。

## 先用虚构数据试用

`DATAFINDER_DEMO=true` 时只使用内置虚构数据，不会回退到真实网络。52 个工具均可被发现，但演示接口只实现指定样例，不会伪造任意分析结果。

调用 `run_analysis`：

```json
{
  "kind": "event",
  "events": [{"event_name": "demo_page_view", "indicator": "events"}],
  "start_date": "2020-01-01",
  "end_date": "2020-01-02"
}
```

返回两天各 100 次事件，并标记 `synthetic=true`。演示元数据 `demo_property` 仅存在进程内存中，关闭后重置。演示模式用于安装和流程验收，不代表真实业务数据。

## 连接自己的 DataFinder

关闭 `DATAFINDER_DEMO`，在客户端的安全环境配置中设置：

| 配置 | 用途 |
|---|---|
| DATAFINDER_AK / DATAFINDER_SK | 自己的访问密钥，不写进源码或登记文件 |
| DATAFINDER_PROJECT_ID | 自己的项目 ID |
| DATAFINDER_APP_ID | 自己的应用 ID |
| DATAFINDER_SUBJECT_ID | 项目实际分析主体 ID |
| DATAFINDER_DB_PATH | 独立 SQLite 文件的绝对路径，建议显式设置 |
| DATAFINDER_LOCAL_OWNER | 本地记录身份，默认 local-owner；不同身份的记录相互隔离 |
| DATAFINDER_ALLOW_PROJECT_WIDE | 默认 false；已保存报表确需统计同项目多个应用时显式开启 |

连接状态工具只确认配置，成功查询后才证明接口可用。结果的业务含义仍以所选事件、日期、口径和质量状态为准。

数据库默认位于 `~/.local/share/datafinder-mcp/workbench.sqlite`。启动时自动执行带摘要校验的迁移，不重置旧库；使用 WAL 支持前台与后台进程协作。数据库文件权限为 0600，新建目录为 0700。备份时先正常停止前台和 worker，再复制数据库文件；不要在运行时只复制主文件而遗漏 WAL。此包不自动删除历史记录。

## 默认只读与修改确认

默认 `DATAFINDER_ALLOW_LOCAL_WRITES=false`：可读取记录、分析和导出；真正保存、入队、处理任务等操作会被拦住。用于展示修改内容的临时确认记录仍保存在本地，不等于业务保存。

确需本地保存时，显式设置 `DATAFINDER_ALLOW_LOCAL_WRITES=true`。修改调用流程：

1. 提供工具的完整参数（原工具若要求 `confirmed=true`，仍需提供），先收到 `status=installation_preview`。
2. 将返回的工具名和全部参数展示给用户。
3. 用户确认后，以完全相同参数，加 `installation_confirmed=true` 和返回的 `installation_confirmation` 再调用。
4. 继续遵守原工具自身的 preview_hash、版本号或 change_id/confirmation 流程，最后回读。

安装版确认码有效期 15 分钟，仅用于该身份、该工具、该份参数；一次使用后失效。内容改变、过期或重复提交需要重新预览。内层原有版本校验仍然生效。

上游元数据修改还需要单独启用 `DATAFINDER_ALLOW_UPSTREAM_WRITES=true`；默认关闭。只启用本地保存不会打开火山修改权限。修改上游时仍需原有差异预览和确认。不提供修改上游报表或删除数据的功能。

## 后台任务

MCP 前台连接可以关闭，但后台 worker 必须持续运行在你自己的电脑或服务器上。要在个人电脑关机后继续运行，需要把 worker 部署在持续在线的服务器；安装包本身不会提供免费托管。

worker 和前台必须使用同一个 `DATAFINDER_DB_PATH`、身份与项目配置，并启用本地写入。使用客户端里同一套安全环境变量运行：

```sh
node /absolute/path/to/install/node_modules/@cyuanxv/datafinder-mcp/server.mjs --worker
```

worker 默认每 60 秒触发一次巡检调度并处理一个任务子项。`DATAFINDER_WORKER_INTERVAL_MS` 可调整，最小 1000 毫秒。仅处理一次可加 `--once`。服务管理器可直接托管此命令；包不会自行安装系统常驻项。

保存计划或提交任务仍需预览和确认；已确认入队/启用的任务由 worker 后续执行，无需每轮再次确认。已有任务使用持久租约和 request_key 防重复，失败不当作成功；暂停、恢复、重试与归档沿用原有规则。正常停止 worker 不清空队列，重开后继续。

通过 `read_operations` 查看执行记录，`cloud_query_jobs` 回读状态与结果。排队成功不等于查询完成。安装版会将运行说明标注为本地 worker，以免误认为原平台自动调度。

## 下载和导出

`export_aggregate_result` 为已保存批次或任务生成本机下载地址。服务仅监听 127.0.0.1，使用每次连接生成的随机访问令牌；没有令牌或伪造 Host 的请求被拒绝。链接包含令牌，只给有权访问该数据的人，不贴进公开文档。

前台进程需保持运行才能下载。重启后旧链接失效，但数据库里的任务和结果仍在，重新生成链接即可。端口默认自动分配，可用 `DATAFINDER_EXPORT_PORT` 指定。报告 HTML、分页 CSV 等工具原本返回的内容仍由客户端保存。Excel 导出为 Excel 2003 XML，不是 xlsx。

## 构建和验收

从完整源码根目录运行：

```sh
node standalone/build.mjs
cd standalone/package
npm install --ignore-scripts
npm pack
```

独立包使用从同一源码生成的工具实现，没有另写一套 52 工具业务逻辑。npm pack 仅生成本地 tgz；正式发布需要维护者身份和双重验证。

全新安装后的协议与持久化验收：

```sh
node standalone/acceptance.mjs /absolute/path/to/installed/server.mjs /absolute/path/to/review/result.json
```

运行时会在结果文件旁新建独立测试目录。包含 52 工具发现和参数分发、真实本地数据库、重启保留、只读拦截、确认防篡改与重放、后台执行、任务去重、下载及身份隔离检查。业务算法继续由项目测试集覆盖；演示接口范围有限，不能代替所有真实火山接口的逐项验收。

## Registry 登记

`server.json` 对应 `io.github.cyuanxv/datafinder-mcp` 0.2.4，不包含私人远程服务地址。登记使用 npm 安装包，收录不等于自动上架 ChatGPT。

官方流程：https://modelcontextprotocol.io/registry/quickstart

## English summary

This standalone package exposes all **52 tool names** from the cloud workbench over stdio. It includes an independent SQLite database, checksum-verified migrations, persistent jobs, a separate background worker, owner-scoped records, and token-protected loopback downloads. Node.js 24+ is required.

Local writes and upstream metadata writes are **disabled by default**. A mutating request first returns an installation preview. Show the exact arguments to the user, then resend them with the one-use installation confirmation; existing tool-specific confirmation hashes and revision checks still apply. Enabling local writes does not enable upstream writes. There are no upstream report editing or data-deletion operations.

The worker runs separately using the same database, owner and credentials. Keep it running on your own always-on host for unattended jobs. No hosted service or management web UI is included. ChatGPT web requires a separate authenticated remote deployment.

Demo mode is fully offline and explicitly fictional. Unsupported fixture requests fail rather than inventing results or reaching live APIs. A limited demo cannot validate every vendor endpoint. Package and Registry identifiers are documented above.
