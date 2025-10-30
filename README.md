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

booked-openai-sdk-1/
├─ README.md
├─ requirements.txt
├─ .env.example
├─ .gitignore
├─ ui-widgets/ # React widgets (Vite)
│ ├─ package.json
│ ├─ pnpm-lock.yaml # if you use pnpm; else npm lockfile
│ ├─ src/
│ │ ├─ flight-card/...
│ │ └─ hello-widget/...
│ └─ dist/ # (build output; ignored by git)
└─ graph/
└─ mcp_adapter/
├─ server.py # tools only
└─ server_UI.py # tools + UI (text/html+skybridge)


> **.env location:** place `.env` in the **project root**, one level above `graph/`.

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** and a package manager:
  - Recommended: **pnpm** (`npm i -g pnpm`)
  - Works with `npm` too (swap commands accordingly)
- (Optional) **Cloudflare Tunnel** (`cloudflared`) or **ngrok** for public HTTPS demo

---

## Environment Variables

Create `.env` at the project root using the template below.

> The **critical** variable is `ASSETS_BASE_URL` — it must point to the `/assets` folder inside `ui-widgets/dist` **over HTTP/HTTPS**.

```bash
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




py -3.11 -m venv .venv

.venv\Scripts\activate
pip install -r requirements.txt

## UI implementation 

cd ui-widgets
pnpm install
pnpm run build

# Serve the built assets with CORS so ChatGPT can fetch them
npx http-server dist -p 4444 --cors
# Confirm: http://localhost:4444/assets shows hashed *.js / *.css

# Run MCP servers (choose one)

server (ui implemetation)

cd graph\mcp_adapter
call .venv\Scripts\activate.bat
set PYTHONNOUSERSITE=1
set ASSETS_BASE_URL=http://localhost:4444/assets
python graph\mcp_adapter\Server_UI.py - runs on port 8000


server (only tool implemetation)-runs  independently no ui 

python graph\mcp_adapter\Server.py - runs on port 3000


host in the public link 
https://<random>.ngrok.io

# connecting the server to the chatgpt 

In Settings → App Connectors, scroll to the bottom and turn on Developer Mode. Then, click the Create button, paste the MCP server URL[public link created by ngrok], and set Authentication to None. You will then see two tools: hello_widgets and search_flight_ui. 
