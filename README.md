# booked-openai-sdk-1

End-to-end demo of **BookedAI + OpenAI Apps SDK** with:

- **MCP adapter (FastMCP + Uvicorn)** under `graph/mcp_adapter`
  - `server.py` → tools only (no UI rendering)
  - `server_UI.py` → tools that render **text/html+skybridge** widgets (e.g., `hello-widget`, `flight-card`)
- **UI Widgets (React + Vite)** under `ui-widgets`
  - Built into hashed assets in `ui-widgets/dist/assets`
  - Loaded by ChatGPT via `ASSETS_BASE_URL`

This repo is ready for Daryl to import into the `mini-booked` monorepo when appropriate.

---

## Folder Structure

```text
mini_bookedai-master/
├─ README.md
├─ .env                    # (not committed; create from .env.example)
├─ .env.example            # template for environment variables
├─ .gitignore
├─ requirements.txt
├─ ui-widgets/             # React widgets (Vite)
│  ├─ package.json
│  ├─ pnpm-lock.yaml       # if you use pnpm
│  ├─ src/
│  │  ├─ flight-card/      # Flight card widget
│  │  └─ hello-widget/     # Hello demo widget
│  └─ dist/                # build output: dist/assets/* (gitignored)
└─ graph/
   └─ mcp_adapter/
      ├─ server.py         # tools only
      └─ server_UI.py      # tools + UI (text/html+skybridge)
```

> **.env location:** place `.env` in the **project root**, one level above `graph/`.

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** and a package manager:
  - Recommended: **pnpm** (`npm i -g pnpm`)
  - Works with **npm** too (swap commands accordingly)
- (Optional) **Cloudflare Tunnel** (`cloudflared`) or **ngrok** for public HTTPS demos

---

## Environment Variables

Create `.env` at the project root using the template below.

> The **critical** variable is `ASSETS_BASE_URL` — it must point to the `/assets` folder inside `ui-widgets/dist` **over HTTP/HTTPS** and it must **end with `/assets`**.

```dotenv
# --- Required ---
OPENAI_API_KEY=sk-your-openai-key
DUFFEL_API_KEY=duffel_test_your-key

# Where the built widget assets are served from (must end with /assets)
# Local dev (served by http-server on port 4444):
ASSETS_BASE_URL=http://localhost:4444/assets

# If tunneling via Cloudflare or ngrok, replace with the public HTTPS URL:
# ASSETS_BASE_URL=https://<your-subdomain>.trycloudflare.com/assets
# ASSETS_BASE_URL=https://<random>.ngrok.io/assets

# Mapbox (only if your widget uses maps)
MAPBOX_TOKEN=pk.your-mapbox-token

# MCP server host/port
MCP_HOST=127.0.0.1
MCP_PORT=3000
```

---

## Install & Build

Run these from the **project root** (`mini_bookedai-master`).

### 1) Python (MCP adapter)
```bat
py -3.11 -m venv .venv
call .venv\Scripts\activate.bat
pip install -r requirements.txt
```

### 2) UI (widgets)
```bat
cd ui-widgets
pnpm install
pnpm run build
```

---

## Serve Widget Assets (required for UI widgets)

Serve the built assets with CORS so ChatGPT can fetch them:

```bat
cd ui-widgets
npx http-server dist -p 4444 --cors
```

- Confirm: open `http://localhost:4444/assets` and verify hashed `*.js` / `*.css`.
- Ensure your `.env` has `ASSETS_BASE_URL=http://localhost:4444/assets` **or** set it inline before starting the server:
  ```bat
  set ASSETS_BASE_URL=http://localhost:4444/assets
  ```

Keep this terminal running.

---

## Run the MCP Servers

Open a **new** terminal (keep the assets server running).

### A) Tools-only server (no UI)
Recommended via **uvicorn**:
```bat
cd mini_bookedai-master
call .venv\Scripts\activate.bat
set PYTHONNOUSERSITE=1
uvicorn graph.mcp_adapter.server:app --host %MCP_HOST% --port %MCP_PORT% --reload
# -> http://127.0.0.1:3000
```

### B) UI-enabled server (renders widgets)
Recommended via **uvicorn**:
```bat
cd mini_bookedai-master
call .venv\Scripts\activate.bat
set PYTHONNOUSERSITE=1
set ASSETS_BASE_URL=http://localhost:4444/assets
uvicorn graph.mcp_adapter.server_UI:app --host 127.0.0.1 --port 3000 --reload
# -> http://127.0.0.1:3000
```

**Alternative (only if `Server_UI.py` has a `__main__` block that runs uvicorn):**
```bat
cd mini_bookedai-master
call .venv\Scripts\activate.bat
set PYTHONNOUSERSITE=1
set ASSETS_BASE_URL=http://localhost:4444/assets
python graph\mcp_adapter\Server_UI.py
# default uvicorn port is usually 8000 if started inside the script
```

**Tools-only via script (only if it has a `__main__`):**
```bat
python graph\mcp_adapter\Server.py
# runs on the port defined in the script or via uvicorn if used there
```

> **Ports summary**
> - Assets server: `http://localhost:4444/assets`
> - Tools-only server: `http://127.0.0.1:3000` (uvicorn example)
> - UI server: `http://127.0.0.1:3001` (uvicorn example) or `http://127.0.0.1:8000` if your script launches uvicorn internally

---

## Hosting a Public Link (for reviewers)

### ngrok
```bat
ngrok http 4444
```
Set:
```
ASSETS_BASE_URL=https://<random>.ngrok.io/assets
```

### Cloudflare Tunnel
```bat
cloudflared tunnel --url http://localhost:4444
```
Set:
```
ASSETS_BASE_URL=https://<your-subdomain>.trycloudflare.com/assets
```

Restart the **UI** MCP server after changing `ASSETS_BASE_URL`.

---

## Connecting the MCP Server to ChatGPT

1) In **ChatGPT** → **Settings** → **App Connectors**, turn on **Developer Mode**.  
2) Click **Create** and paste your MCP server URL (e.g., the UI server: `http://127.0.0.1:3001/mcp` or your **public** URL if you exposed it).  
3) **Authentication**: None.  
4) You should see your tools appear (e.g., `hello_widgets`, `search_flight_ui` — exact names depend on your server code).

---



## Commit Style

Use Conventional Commits for clarity:
- `feat(mcp): add demo_search_flight tool`
- `fix(ui): bind widget to window.openai.toolOutput`
- `docs: add tunnel instructions`

---

#
