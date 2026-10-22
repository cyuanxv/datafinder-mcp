# DataFinder MCP: installation and troubleshooting

Standalone version 0.2.0 · Checked October 22, 2026

[简体中文](TROUBLESHOOTING.zh-CN.md) · [Project home](../README.en.md) · [Watch the demo](https://github.com/user-attachments/assets/e4e3d4c6-b403-4118-82ea-9fa7db66e3ad)

Start with the offline fixture. Connect your own DataFinder account after the sample query works.

## 1. Choose the right connection

| What you want | What you need |
|---|---|
| A local MCP client | Node.js 24+, the npm package, and a client that supports stdio |
| ChatGPT on the web | A separately deployed, authenticated remote MCP service |
| The browser demo shown in the video | The source repository's demo; fictional data and preset questions, no credentials |

The standalone package does not include a cloud management UI or free hosting. Background jobs require your own running worker. To continue after your computer shuts down, run it on an always-on host.

## 2. Check Node.js and install

```sh
node --version
npm --version
mkdir datafinder-mcp-demo
cd datafinder-mcp-demo
npm init -y
npm install @cyuanxv/datafinder-mcp@0.2.0
npm ls @cyuanxv/datafinder-mcp
```

Use Node.js **24 or later**. A terminal and a desktop client may find different Node.js installations. Find the correct executable with `command -v node` on macOS/Linux, or `(Get-Command node).Source` in Windows PowerShell. Public package installation does not require npm publisher permissions.

## 3. Connect with fictional data first

Add this configuration in a stdio-compatible MCP client. Replace **all three absolute paths** with real paths on your computer:

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

On Windows, forward slashes such as `C:/Users/your-name/...` avoid JSON escaping mistakes. Remove comments and trailing commas. Reconnect the server or restart the client after saving. Complete tool discovery should return **52 tools**; clients may display only a selection at a time.

You can also configure the client to launch `npx -y @cyuanxv/datafinder-mcp@0.2.0` with the same environment. The first launch needs registry access. An installed package with absolute paths is easier to troubleshoot.

A stdio server waiting silently in a terminal is not necessarily broken: it expects protocol requests from an MCP client, not ordinary chat text.

## 4. Run the installation sample

Ask the client to call `run_analysis` with:

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

Expect two days with **100 events each**, marked as synthetic. Discovery checks connectivity; this query checks the offline analysis path. Demo mode supports a limited fixture, rejects unsupported requests, and never falls back to a real tenant.

## 5. Connect your own DataFinder

Set `DATAFINDER_DEMO=false` and configure your own credentials in the client's secure environment settings:

```text
DATAFINDER_AK
DATAFINDER_SK
DATAFINDER_PROJECT_ID
DATAFINDER_APP_ID
DATAFINDER_SUBJECT_ID
```

Use your actual project, application, and subject identifiers. Keep `DATAFINDER_DB_PATH` set to a writable local path. Do not copy the author's IDs or production endpoint. Never commit credentials or include them in public screenshots.

Start with a known event and date range. Compare identity, counts versus unique users, timezone, filters, and window settings with the DataFinder console.

## 6. Troubleshooting

| Symptom | Check first | What to do |
|---|---|---|
| `ENOENT` or Node.js not found | The client's executable path | Use the absolute path to the verified Node.js installation and reconnect |
| SQLite or runtime error | The Node.js version actually launched by the client | Use Node.js 24+; checking only your terminal's default version is insufficient |
| npm download times out | Registry connectivity and proxy settings | Try `npm ping --registry=https://registry.npmjs.org/`; do not disable TLS verification or repeatedly log in |
| No tools after configuration | JSON, paths, client reconnection | Remove comments/trailing commas and inspect the client's MCP logs |
| `EACCES` or `SQLITE_CANTOPEN` | Writable database location | Use a file in your own directory; do not use sudo or chmod 777 |
| Unsupported demo request | Fixture coverage | Use the sample above; arbitrary business queries require real mode |
| Real query fails despite valid-looking settings | Credentials, project/App/subject, upstream permissions | Read the business error code and message; HTTP 200 alone is not success |
| Successful query returns no data | Dates, timezone, event, filters | Start with an unfiltered period known to contain data |
| Numbers differ from the console | Identity, aggregation, dates, filters, conversion window | Align definitions before comparing; event totals are not unique users |
| Save or job submission is blocked as read-only | Default local write gate | Enable `DATAFINDER_ALLOW_LOCAL_WRITES=true` only when needed; preview and confirmation still apply |
| Upstream metadata change is blocked | Separate upstream gate and vendor permissions | Also requires `DATAFINDER_ALLOW_UPSTREAM_WRITES=true` and upstream authorization |
| Job stays queued | Separate worker and matching configuration | Use the same database, owner, and project; queued does not mean completed |
| Export download stops working | Frontend process and connection lifetime | Open it on the host running the service; regenerate after restarting; never post token-bearing links publicly |
| CSV characters look corrupted | Spreadsheet import encoding | Import as UTF-8 rather than editing the source data repeatedly |

Local writes and upstream metadata writes are **disabled by default**. Enabling local writes does not enable upstream writes. Enabled operations still require preview and confirmation.

For background execution, use the same secure environment and run:

```sh
/absolute/path/to/node /absolute/path/to/install/node_modules/@cyuanxv/datafinder-mcp/server.mjs --worker
```

The worker needs local writes enabled and previously confirmed tasks. Closing the MCP client does not prove that the separate worker remains running.

## 7. Why do the video and installation sample show different numbers?

The video shows the browser demo for January 1–7, 2020: **9,912 events** across all platforms, **4,746 events** after filtering to iOS, and **21 exported data rows** (7 days × 3 channels).

The installation sample uses a smaller fixture: two days, 100 events per day. These are separate examples and their totals should not be compared.

The 43-second video has Chinese captions, no audio, and uses edited screenshots of actual local demo interactions. It contains preset questions and fictional data; it is not a live ChatGPT session. To run the browser demo from source:

```sh
git clone https://github.com/cyuanxv/datafinder-mcp.git
cd datafinder-mcp/site
npm ci
npm run demo
```

Open `http://127.0.0.1:4178/?lang=en`. This is not a production management UI.

## 8. Permissions and support

All 52 tool interfaces do not automatically grant every vendor capability. Real queries require your own DataFinder access, and features such as user tags depend on the relevant CDP entitlement. The package does not provide upstream report editing or data deletion.

When reporting an issue, include your OS, Node.js and package versions, client, demo/real mode, tool, redacted error, and minimal reproduction. Never attach AK/SK, cookies, databases, customer-level exports, or token-bearing download URLs.

- [Full English installation guide](../standalone/README.en.md)
- [中文安装教程](../standalone/README.md)
- [npm package](https://www.npmjs.com/package/@cyuanxv/datafinder-mcp)
- [Report an issue](https://github.com/cyuanxv/datafinder-mcp/issues)
