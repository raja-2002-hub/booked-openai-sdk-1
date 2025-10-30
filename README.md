# booked-openai-sdk-1
OpenAI-SDK Implementation
Minimal ChatGPT MCP + React widgets (flight card demo) for BookedAI.

## Structure
- `ui-widgets/` – React widgets built with Vite (one folder per widget).
- `graph/mcp_adapter/server.py` – MCP server that returns widgets as `text/html+skybridge` and exposes:
  - `GET/POST /mcp`

## Prereqs
- Node 18+ with pnpm or npm
- Python 3.11+
- Use `.env` locally; see `.env.example`.

## Install & Build (UI)
```bash
cd ui-widgets
pnpm install   # or: npm install
pnpm run build # or: npm run build
# Artifacts in ui-widgets/dist/assets

## Folder Structure

mini_bookedai/
├── graph/                                  # ✅ LangGraph implementation + MCP adapter
│   ├── pyproject.toml                      # uv/poetry config for LangGraph project (if you use it)
│   ├── .python-version                     # Python 3.11
│   ├── langgraph.json                      # LangGraph server config (if applicable)
│   ├── env.example                         # DUFFEL_API_TOKEN, OPENAI_API_KEY placeholders (no secrets)
│   ├── mcp_adapter/                        # 👈 **MCP server lives here**
│   │   └── server.py                       # - Exposes /mcp and /mcp/messages
│   │                                       # - Registers UI widgets (hello, flight-card)
│   │                                       # - Calls LangGraph tools via .ainvoke(...)
│   └── src/
│       ├── agent/
│       │   ├── __init__.py
│       │   └── graph.py                    # Defines LangGraph workflow + Tools:
│       │                                   #   search_flights_tool, search_hotels_tool, etc.
│       ├── duffel_client/
│       │   ├── client.py                   # Duffel HTTP client (auth, base requests)
│       │   ├── endpoints/
│       │   │   ├── flights.py              # Flight search/booking calls
│       │   │   └── stays.py                # Hotel/stays calls
│       │   └── models/
│       │       ├── flights.py              # Pydantic models for flights
│       │       └── stays.py                # Pydantic models for stays
│       └── config.py                       # Config & settings helpers
│
├── ui-widgets/                             # 👈 **React widgets (built with Vite)**
│   ├── package.json
│   ├── build-all.mjs                       # Finds src/*/index.* and builds each widget
│   ├── src/
│   │   ├── flight-card/                    # Flight list widget
│   │   │   ├── index.jsx                   # Uses window.openai.toolOutput for data
│   │   │   └── styles.css
│   │   └── hello-widget/                   # Minimal test widget
│   │       ├── index.jsx
│   │       └── styles.css
│   └── dist/
│       └── assets/                         # ⚙️ Build output
│           ├── flight-card-<hash>.html     # Self-contained (CSS+JS inlined)
│           ├── hello-widget-<hash>.html
│           └── ...                         # (Also .js/.css if you keep external assets)
│
├── ui/                                     # (PLANNED — separate Agent Chat UI, optional)
│   └── (to be implemented)
│
├── README.md                               # Root README: how to build widgets & run MCP
├── .env.example                            # Repo-wide placeholders (no secrets)
├── .gitignore                              # Ignore .env, node_modules, dist, .venv, etc.
└── requirements.txt                        # Minimal deps for the MCP server (uvicorn, mcp, dotenv, xxhash, etc.)
