# DataFinder MCP — 52 tools, independent storage and background jobs


[简体中文](README.md) | **English**

The standalone **0.2.3** package exposes the same **52 MCP tool names** as the cloud workbench: analytics, metric dictionaries, mappings, templates, follow-up conditions, jobs, inspections, archives, and confirmed metadata changes. It uses your own SQLite database and DataFinder account. No connection to the author's private service is required.

[View all 52 tools](TOOLS.md). Vendor subscriptions and API permissions still apply. For example, user-tag APIs require the relevant CDP entitlement. Unsupported upstream operations are rejected. The standalone package does not include the cloud management website.

Saved SQL supports existing event-date bindings with a fixed preview. Re-preview after the Shanghai date or saved definition changes. Temporary argument overrides are unsupported. Cloud deployments can run independently of your personal computer; a locally installed npm worker requires its host to stay running.

## Install and connect

Use **Node.js 24+**, which provides the built-in SQLite runtime. In a new directory, install the package:

```sh
npm init -y
npm install @cyuanxv/datafinder-mcp@0.2.3
```

For an MCP client that launches stdio servers, replace the example paths below with absolute paths on your computer:

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

Alternatively, launch with `npx -y @cyuanxv/datafinder-mcp@0.2.3`. A stdio client starts this executable locally. ChatGPT web requires a separately deployed authenticated remote server; local protocol acceptance is not ChatGPT web acceptance.

## Try fictional data first

With `DATAFINDER_DEMO=true`, the process only uses the bundled fictional fixture. Unsupported fixture requests fail without a live network fallback. All 52 tool names are discoverable, but the fixture does not implement every analysis type.

Call `run_analysis` with:

```json
{
  "kind": "event",
  "events": [{"event_name": "demo_page_view", "indicator": "events"}],
  "start_date": "2020-01-01",
  "end_date": "2020-01-02"
}
```

The result contains **100 events per day** and `synthetic=true`. Fictional metadata named `demo_property` exists only in process memory and resets when the process exits. This demo checks installation and workflow behavior, not business data.

## Connect your own DataFinder account

Disable demo mode and configure the server process through your MCP client's secure environment settings:

| Environment variable | Purpose |
|---|---|
| DATAFINDER_AK / DATAFINDER_SK | Your access and secret keys; keep them out of source and Registry metadata |
| DATAFINDER_PROJECT_ID | Your project ID |
| DATAFINDER_APP_ID | Your application ID |
| DATAFINDER_SUBJECT_ID | The actual analysis-subject ID configured in your project |
| DATAFINDER_DB_PATH | Absolute path to your independent SQLite file; explicit configuration is recommended |
| DATAFINDER_LOCAL_OWNER | Record owner scope, default local-owner; records are isolated by owner |
| DATAFINDER_ALLOW_PROJECT_WIDE | Default false; explicitly enable only for authorized aggregation across apps in the configured project |

Connection status verifies configuration only. A successful `run_analysis` or `query_report` call is needed to establish live query access. Interpret results using their selected events, dates, definitions, pagination and quality status.

The default database is `~/.local/share/datafinder-mcp/workbench.sqlite`. Startup applies checksum-verified migrations without resetting existing data. WAL supports foreground and worker access. Database permissions are 0600; newly created directories use 0700. For backups, stop both processes normally before copying the database; do not copy only the main file while ignoring an active WAL. Historical records are not automatically deleted.

## Read-only defaults and confirmed changes

`DATAFINDER_ALLOW_LOCAL_WRITES` defaults to `false`. You can read records, query data and export results. Business saves, job submissions and processing are blocked. Temporary installation-confirmation records may still be stored locally; this does not save the requested business change.

To enable local changes, explicitly set `DATAFINDER_ALLOW_LOCAL_WRITES=true`:

1. Send the tool's complete arguments. If its existing schema requires `confirmed=true`, include that field. The outer installation layer first returns `status=installation_preview`.
2. Show the exact tool name and all arguments to the user.
3. After approval, resend the same arguments with `installation_confirmed=true` and the returned `installation_confirmation`.
4. Continue any existing tool-specific preview_hash, revision, or change_id/confirmation steps, then read back the result.

Installation confirmation expires after 15 minutes and is tied to one owner, tool and exact argument set. It can be used only once. Changed, expired or replayed requests need a fresh preview. Existing version checks still apply.

Upstream metadata changes also require the separate `DATAFINDER_ALLOW_UPSTREAM_WRITES=true` switch, which defaults to false. Enabling local storage does not enable DataFinder writes. Upstream changes retain their original difference preview and confirmation flow. The tools do not edit upstream saved reports or delete data.

## Run background jobs

The foreground MCP connection may close while a separate worker continues, but the worker needs your own always-on computer or server. To run after your personal computer is off, host the worker on your own server. This package does not provide hosted compute.

Use the same database path, owner, project and secure credentials as the foreground process, and enable local writes. With that environment configured, run:

```sh
node /absolute/path/to/install/node_modules/@cyuanxv/datafinder-mcp/server.mjs --worker
```

The default interval is 60 seconds. Each tick dispatches due inspection plans and processes one queued subtask. `DATAFINDER_WORKER_INTERVAL_MS` may change the interval, with a 1000 ms minimum. Add `--once` for a single tick. Your service manager may supervise this command; the package does not install a system daemon automatically.

Saving a plan or submitting a job still needs preview and confirmation. An approved queued job or enabled plan can then run without repeated approval for every tick. Persistent leases and request keys protect against duplicate processing. Failure is not success; pause, resume, retry and archive retain their existing rules. Normal shutdown preserves the queue.

Use `read_operations` for dispatch and local worker history, and `cloud_query_jobs` for job state and results. Submission does not mean execution has finished.

## Download results

`export_aggregate_result` creates a download URL for a stored inspection batch or job. The server binds only to 127.0.0.1 and uses a random per-connection access token. Missing tokens and forged Host headers are rejected. Download URLs contain that token; do not put them in public documents.

Keep the foreground process running for downloads. Restart invalidates old URLs, but the persisted results remain available; generate a fresh URL. The port is assigned automatically unless `DATAFINDER_EXPORT_PORT` is set. Tools that return HTML reports or paginated CSV content directly still rely on the client to save that content. Excel exports use Excel 2003 XML, not xlsx.

## Build and validate

From the full source root:

```sh
node standalone/build.mjs
cd standalone/package
npm install --ignore-scripts
npm pack
```

The package is generated from the same tool implementation as the cloud edition. npm pack only creates a local archive; publication requires maintainer credentials and two-factor authentication.

From the source root, test a separately installed copy:

```sh
node standalone/acceptance.mjs /absolute/path/to/installed/server.mjs /absolute/path/to/review/result.json
```

The harness creates a separate test directory beside the result file. It checks 52-tool discovery and parameter dispatch, database persistence, read-only enforcement, confirmation tampering/replay/expiry, background execution, queue deduplication, authenticated downloads and owner isolation. The business suite covers the underlying logic. Limited fictional fixtures do not validate every vendor endpoint or permission.

## MCP Registry

`server.json` identifies `io.github.cyuanxv/datafinder-mcp` version 0.2.3 and contains no private remote-service URL. The entry uses the npm package. Registry inclusion does not automatically list the project in ChatGPT.

[Official Registry quickstart](https://modelcontextprotocol.io/registry/quickstart)
