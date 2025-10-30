# graph/mcp_adapter/server.py
from __future__ import annotations

import os, sys, site, logging, json, re, traceback
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Dict, List
from datetime import datetime

# --- harden sys.path (avoid user-site shadowing) ---
try:
    USER_SITE = site.getusersitepackages()
except Exception:
    USER_SITE = None
if USER_SITE:
    sys.path[:] = [p for p in sys.path if not (p and p.startswith(USER_SITE))]
os.environ.setdefault("PYTHONNOUSERSITE", "1")

# --- import roots / .env ---
HERE = Path(__file__).resolve()
GRAPH_ROOT = HERE.parents[1]
if str(GRAPH_ROOT) not in sys.path:
    sys.path.insert(0, str(GRAPH_ROOT))

from dotenv import load_dotenv
load_dotenv(GRAPH_ROOT.parent / ".env")

# --- logging ---
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mcp_adapter")

# --- xxhash sanity (LangGraph likes this impl) ---
try:
    import xxhash as _xx
    assert hasattr(_xx, "xxh3_128_hexdigest")
except Exception:
    raise RuntimeError("Install xxhash wheel: pip install --only-binary=:all: xxhash>=3.5.0")

# --- MCP types ---
from mcp.server.fastmcp import FastMCP
from mcp import types

# --- import your LangGraph tool(s) ---
from src.agent.graph import search_flights_tool

# ---------- constants ----------
MIME_TYPE = "text/html+skybridge"
ASSETS_DIR = GRAPH_ROOT.parent / "ui-widgets" / "dist" / "assets"
ASSETS_BASE_URL = os.environ.get("ASSETS_BASE_URL", "http://localhost:4444/assets")

# ---------- helpers ----------
def _pick_hashed_asset(assets_dir: Path, prefix: str, ext: str) -> str:
    """
    WHY:
        build-all.mjs outputs hashed artifact files like:
          flight-card-<hash>.html / .css / .js
        We need to pick the *latest* one so the server always serves the
        freshest build without hardcoding the hash.

    WHEN:
        - Resolving the exact filename to serve for a widget (html/js/css).
        - Used by resolve_widget_html() to find either the self-contained *.html
          or the external *.css/*.js pair.

    HOW (example):
        name = _pick_hashed_asset(ASSETS_DIR, "flight-card", "html")
        # => "flight-card-a1b2c3.html"

    Returns:
        The filename (not full path) of the newest matching asset.
    """
    files = sorted(assets_dir.glob(f"{prefix}-*.{ext}"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise FileNotFoundError(f"No {prefix}-*.{ext} in {assets_dir}")
    return files[-1].name

def _widget_html(root_id: str, css_url: str, js_url: str) -> str:
    """
    WHY:
        If we *don’t* have the self-contained HTML (some builds only emit css/js),
        we still need an embeddable snippet that:
          1) provides a mount point <div id="<root_id>"> for React,
          2) links the compiled CSS,
          3) loads the compiled JS (type="module").

    WHEN:
        - Fallback path in resolve_widget_html() if no hashed *.html exists.
        - Also useful for debugging or custom hosting layouts.

    HOW (example):
        html = _widget_html("flight-card-root",
                            f"{ASSETS_BASE_URL}/flight-card-<hash>.css",
                            f"{ASSETS_BASE_URL}/flight-card-<hash>.js")

    Returns:
        A small HTML string suitable to embed as a text/html+skybridge resource.
    """

    return (
        f'<div id="{root_id}"></div>\n'
        f'<link rel="stylesheet" href="{css_url}">\n'
        f'<script type="module" src="{js_url}"></script>'
    )

def resolve_widget_html(name: str, root_id: str) -> str:
    """
    WHY:
        ChatGPT Apps prefer a *single* HTML resource (text/html+skybridge).
        Our build often emits a self-contained {name}-<hash>.html with CSS+JS inlined.
        If that exists, serve it directly (best UX).
        If not, fall back to a minimal <div+link+script> snippet built by _widget_html().

        This function also rewrites '/assets/' paths inside the inlined HTML
        to point at ASSETS_BASE_URL (so it works behind tunnels/CDNs).

    WHEN:
        - Every time we need to embed a widget in a tool response.
        - Used by _embedded_widget_resource() to provide the exact HTML text.

    HOW (examples):
        # Prefer the inlined HTML if present:
        html_text = resolve_widget_html("flight-card", "flight-card-root")

        # If only css/js exist, it returns:
        #   <div id="flight-card-root"></div>
        #   <link rel="stylesheet" href="https://.../assets/flight-card-<hash>.css">
        #   <script type="module" src="https://.../assets/flight-card-<hash>.js"></script>

    Returns:
        The final HTML string to send to the client (self-contained or fallback).
    """
    try:
        html_name = _pick_hashed_asset(ASSETS_DIR, name, "html")
        raw_html = (ASSETS_DIR / html_name).read_text(encoding="utf-8")
        return (
            raw_html
            .replace('src="/assets/', f'src="{ASSETS_BASE_URL}/')
            .replace('href="/assets/', f'href="{ASSETS_BASE_URL}/')
        )
    except FileNotFoundError:
        css = _pick_hashed_asset(ASSETS_DIR, name, "css")
        js  = _pick_hashed_asset(ASSETS_DIR, name, "js")
        return _widget_html(f"{name}-root", f"{ASSETS_BASE_URL}/{css}", f"{ASSETS_BASE_URL}/{js}")
    except Exception as e:
        return (
            f'<div style="padding:12px;font-family:system-ui">'
            f'<b>{name} assets not found.</b> {e}</div>'
        )
# -----------------------------------------------------------------------------
# Widget metadata used to:
#  - keep a single source of truth for each UI widget
#  - generate the resource payload (text/html+skybridge) for ChatGPT to render
#  - provide OpenAI "_meta" hints (outputTemplate, invoking/invoked strings, etc.)
# Fields:
#   tool_name:     The name you expose in list_tools() / call_tool (unique)
#   title:         Human-friendly label shown in the UI panel title
#   template_uri:  "ui://widget/<name>.html" identifier; MUST match outputTemplate
#   root_id:       <div id="..."> React mount point used by the built HTML
#   html:          The actual HTML string to embed (from resolve_widget_html)
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class Widget:
    tool_name: str
    title: str
    template_uri: str
    root_id: str
    html: str

# -----------------------------------------------------------------------------
# HELLO widget definition
# WHY:  Simple hello/demo widget to verify embedding works end-to-end.
# WHEN: Use it to smoke-test your rendering pipeline quickly.
# HOW:  The HTML is resolved from the latest hashed build artifacts.
# -----------------------------------------------------------------------------

HELLO = Widget(
    tool_name="hello-widget",
    title="Show Hello Widget",
    template_uri="ui://widget/hello-widget.html",
    root_id="hello-widget-root",
    html=resolve_widget_html("hello-widget", "hello-widget-root"),
)
# -----------------------------------------------------------------------------
# FLIGHT widget definition
# WHY:  Main Flight Card list UI used by the "search_flights_ui" tool.
# WHEN: Embed this when you have flight search structuredContent available.
# HOW:  Same pattern as above; points at flight-card build artifacts.
# -----------------------------------------------------------------------------
FLIGHT = Widget(
    tool_name="flight-card",
    title="Show Flight Card",
    template_uri="ui://widget/flight-card.html",
    root_id="flight-card-root",
    html=resolve_widget_html("flight-card", "flight-card-root"),
)

# -----------------------------------------------------------------------------
# Lookups for convenience:
#  - WIDGETS: map tool_name -> Widget (used when you know the tool by name)
#  - URI_TO_WIDGET: map template_uri -> Widget (used by ReadResource to fetch HTML)
# -----------------------------------------------------------------------------

WIDGETS = {w.tool_name: w for w in (HELLO, FLIGHT)}
URI_TO_WIDGET = {w.template_uri: w for w in WIDGETS.values()}

def _tool_meta(w: Widget) -> Dict[str, Any]:
    """
    WHY:
        Provide OpenAI/Apps "hints" so the client knows how to render the widget
        and what to show as progress text while the tool is running.

    WHEN:
        - In list_tools(): attach _meta to declare outputTemplate and capabilities.
        - In call_tool(): include the same hints in the response _meta.

    HOW:
        - openai/outputTemplate MUST equal the widget's template_uri string.
        - openai/widgetAccessible and openai/resultCanProduceWidget should be True
          to allow rendering within the ChatGPT UI panel.
        - 'invoking'/'invoked' strings appear in the UI as status text.
    """
    return {
        "openai/outputTemplate": w.template_uri,
        "openai/toolInvocation/invoking": f"Rendering {w.title}…",
        "openai/toolInvocation/invoked": f"{w.title} rendered.",
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
        "annotations": {"destructiveHint": False, "openWorldHint": False, "readOnlyHint": True},
    }

def _embedded_widget_resource(w: Widget) -> types.EmbeddedResource:
    """
    WHY:
        Package the widget's HTML as a "resource" (text/html+skybridge) that the
        ChatGPT Apps client can mount and display inline.

    WHEN:
        - In call_tool(): include this in the 'content' list so the UI can render.
        - In ReadResource handler: return the same content for direct URI reads.

    HOW:
        - 'uri' MUST equal w.template_uri and also match openai/outputTemplate.
        - 'mimeType' MUST be text/html+skybridge for ChatGPT to treat it as a widget.
        - 'text' is the HTML string produced by resolve_widget_html(...).
    """
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=w.template_uri,
            mimeType=MIME_TYPE,
            text=w.html,
            title=w.title,
        ),
    )

# ---------- normalize ANY Duffel/Graph output -> flights[] row shape ----------
def _iso_to_local_hm(iso_str: str) -> str:
    try:
        d = datetime.fromisoformat(iso_str.replace("Z", "+00:00")) if iso_str else None
        if not d: return ""
        try:
            return d.strftime("%-I:%M %p")
        except ValueError:
            return d.strftime("%#I:%M %p")  # Windows
    except Exception:
        m = re.search(r"T(\d{2}:\d{2})", iso_str or "")
        return m.group(1) if m else (iso_str or "")

def _weekday_date_from_iso(iso_str: str) -> tuple[str, str]:
    try:
        d = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return d.strftime("%a") + ",", d.strftime("%d %b %Y")
    except Exception:
        return "", ""

def _duration_label(total_minutes: int | None, fallback="—") -> str:
    if not isinstance(total_minutes, int) or total_minutes <= 0:
        return fallback
    h, m = divmod(total_minutes, 60)
    return f"{h}h {m}m" if m else f"{h}h"

def _normalize_any_to_flights(data: dict) -> dict:
    """
    Accepts:
      A) already-flat rows: {"flights":[{airlineShort,...}]}
      B) Duffel offers: {"offers":[...]}
      C) Duffel-like flights: {"flights":[{"offer_id":...,"slices":[...]}]}
    Returns:
      {"flights":[{id,airlineShort,airlineLogo,weekday,date,depart,arrive,route,duration,highlight}], "meta":{...}}
    """
    # A) already-flat?
    if isinstance(data, dict) and isinstance(data.get("flights"), list):
        rows = data["flights"]
        # If rows have flat fields, just ensure highlight
        if rows and (rows[0].get("airlineShort") or rows[0].get("depart") or rows[0].get("route")):
            if not any(bool(r.get("highlight")) for r in rows):
                rows[0]["highlight"] = True
            return {"flights": rows, "meta": data.get("meta") or {}}
        # else treat as Duffel-like flights[]
        src = rows
    elif isinstance(data, dict) and isinstance(data.get("offers"), list):
        # B) offers[]
        src = data["offers"]
    else:
        return {"flights": [], "meta": {"total": 0}}

    norm = []
    origin = destination = date_str = ""

    for i, item in enumerate(src):
        offer_id = item.get("id") or item.get("offer_id") or f"offer_{i}"

        # Airline & logo
        airline = (
            item.get("airline")              # your Duffel-shape sample
            or item.get("owner")
            or item.get("airline_code")
            or "Airline"
        )
        airline_logo = (
            item.get("airline_logo")
            or (item.get("marketing_carrier") or {}).get("logo")
            or (item.get("marketing_carrier") or {}).get("logo_url")
            or None
        )

        # Slices/segments
        sl = (item.get("slices") or [None])[0] or {}
        segs = sl.get("segments") or []
        first, last = (segs[0] if segs else {}), (segs[-1] if segs else {})

        dep_iso = (
            first.get("departing_at") or
            first.get("depart_at") or
            first.get("departure_time") or
            ""
        )
        arr_iso = (
            last.get("arriving_at") or
            last.get("arrive_at") or
            last.get("arrival_time") or
            ""
        )

        depart = _iso_to_local_hm(dep_iso) if dep_iso else ""
        arrive = _iso_to_local_hm(arr_iso) if arr_iso else ""
        weekday, date_label = _weekday_date_from_iso(dep_iso or arr_iso or "")

        org = (
            (first.get("origin") or {}).get("iata_code")
            if isinstance(first.get("origin"), dict)
            else first.get("origin")
        ) or ""
        dst = (
            (last.get("destination") or {}).get("iata_code")
            if isinstance(last.get("destination"), dict)
            else last.get("destination")
        ) or ""

        if not origin and org: origin = org
        if not destination and dst: destination = dst
        if not date_str and date_label: date_str = date_label

        route = f"{org}–{dst}" if org and dst else ""

        # duration -> numeric minutes if present, else parse strings like "1h 31m" or "PT1H31M"
        total_mins = (
            item.get("total_journey_duration_minutes")
            or item.get("total_duration_minutes")
        )
        if total_mins is None:
            dur_txt = (
                item.get("total_journey_duration")
                or item.get("total_duration")
                or sl.get("duration")
                or ""
            )
            m1 = re.search(r"(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?", (dur_txt or "").lower())
            if m1 and (m1.group(1) or m1.group(2)):
                h = int(m1.group(1) or 0); m = int(m1.group(2) or 0)
                total_mins = h * 60 + m
            else:
                hh = re.search(r"(\d+)H", dur_txt); mm = re.search(r"(\d+)M", dur_txt)
                total_mins = (int(hh.group(1)) * 60 if hh else 0) + (int(mm.group(1)) if mm else 0)
                if total_mins == 0: total_mins = None

        norm.append({
            "id": offer_id,
            "airlineShort": airline,
            "airlineLogo": airline_logo,      # <-- logo support
            "weekday": weekday,
            "date": date_label,
            "depart": depart,
            "arrive": arrive,
            "route": route,
            "duration": _duration_label(total_mins),
            "highlight": bool(item.get("highlight")) or (i == 0),
        })

    return {
        "flights": norm,
        "meta": {
            "total": len(norm),
            "origin": origin,
            "destination": destination,
            "date": date_str,
        },
    }

# ---------- MCP app ----------
mcp = FastMCP(
    name="BookedAI",
    sse_path="/mcp",
    message_path="/mcp/messages",
    stateless_http=True,
)

# ---------- list tools ----------
@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name=HELLO.tool_name,
            title=HELLO.title,
            description="Render hello-widget (accepts optional message).",
            inputSchema={"type": "object", "properties": {"message": {"type": "string"}}, "additionalProperties": True},
            _meta=_tool_meta(HELLO),
        ),
        types.Tool(
            name="search_flights_ui",
            title="Search Flights (render FlightCard)",
            description="Calls LangGraph search_flights_tool and renders a FlightCard list.",
            inputSchema={
                "type": "object",
                "properties": {
                    "slices": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "origin": {"type": "string"},
                                "destination": {"type": "string"},
                                "departure_date": {"type": "string"},
                            },
                            "required": ["origin", "destination", "departure_date"],
                        },
                    },
                    "passengers": {"type": "integer", "default": 1},
                    "cabin_class": {"type": "string", "default": "economy"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["slices"],
                "additionalProperties": False,
            },
            _meta={
                "openai/resultCanProduceWidget": True,
                "openai/widgetAccessible": True,
                "openai/toolInvocation/invoking": "Searching flights…",
                "openai/toolInvocation/invoked": "Flights ready.",
                "openai/outputTemplate": FLIGHT.template_uri,  # hint
            },
        ),
    ]

# ---------- list resources / templates ----------
@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [types.Resource(
        name=w.title, title=w.title, uri=w.template_uri,
        description=f"{w.title} UI template", mimeType=MIME_TYPE, _meta=_tool_meta(w)
    ) for w in WIDGETS.values()]

@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [types.ResourceTemplate(
        name=w.title, title=w.title, uriTemplate=w.template_uri,
        description=f"{w.title} UI template", mimeType=MIME_TYPE, _meta=_tool_meta(w)
    ) for w in WIDGETS.values()]

async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    raw = str(req.params.uri)
    base = raw.split("?", 1)[0].split("#", 1)[0]
    w = URI_TO_WIDGET.get(base)
    if not w:
        return types.ServerResult(types.ReadResourceResult(contents=[], _meta={"error": "Unknown resource"}))
    return types.ServerResult(types.ReadResourceResult(contents=[
        types.TextResourceContents(uri=raw, mimeType=MIME_TYPE, text=w.html, _meta=_tool_meta(w))
    ]))

# ---------- call tool ----------
async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    try:
        name = getattr(req.params, "name", "")
        args = getattr(req.params, "arguments", {}) or {}

        if name == HELLO.tool_name:
            message = args.get("message") or "👋 Hello from the MCP server via structuredContent!"
            w = HELLO
            res = _embedded_widget_resource(w)
            meta = {
                "openai.com/widget": res.model_dump(mode="json"),
                "openai/outputTemplate": w.template_uri,
                "openai/toolInvocation/invoking": "Rendering hello…",
                "openai/toolInvocation/invoked": "Hello rendered.",
                "openai/widgetAccessible": True,
                "openai/resultCanProduceWidget": True,
            }
            return types.ServerResult(types.CallToolResult(
                content=[res, types.TextContent(type="text", text="Rendered hello widget!")],
                structuredContent={"message": message},
                _meta=meta,
            ))
        # After the tools we are upating the ui with the tool data 
        if name == "search_flights_ui":
            slices = args.get("slices") or []
            passengers = int(args.get("passengers", 1))
            cabin_class = args.get("cabin_class", "economy")
            max_results = int(args.get("max_results", 5))

            # from the our Graph invoking the search_flight_tool

            raw = await search_flights_tool.ainvoke({
                "slices": slices,
                "passengers": passengers,
                "cabin_class": cabin_class,
                "max_results": max_results,
            })

            # could be error text or JSON string
            try:
                data = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except Exception:
                return types.ServerResult(types.CallToolResult(
                    content=[types.TextContent(type="text", text=str(raw))],
                    isError=True,
                ))

            normalized = _normalize_any_to_flights(data)

            w = FLIGHT
            res = _embedded_widget_resource(w)
            meta = {
                "openai.com/widget": res.model_dump(mode="json"),
                "openai/outputTemplate": w.template_uri,   # exact match with resource uri
                "openai/toolInvocation/invoking": "Searching flights…",
                "openai/toolInvocation/invoked": "Flights ready.",
                "openai/widgetAccessible": True,
                "openai/resultCanProduceWidget": True,
            }
            return types.ServerResult(types.CallToolResult(
                content=[res, types.TextContent(type="text", text=f"Found {normalized['meta'].get('total', 0)} flights.")],
                structuredContent=normalized,   # -> window.openai.toolOutput
                _meta=meta,
            ))

        return types.ServerResult(types.CallToolResult(
            content=[types.TextContent(type="text", text=f"Unknown tool: {name}")],
            isError=True,
        ))

    except Exception as e:
        tb = traceback.format_exc()
        log.error("call_tool failed: %s\n%s", e, tb)
        return types.ServerResult(types.CallToolResult(
            content=[types.TextContent(type="text", text=f"Internal error: {e}")],
            isError=True,
            _meta={"traceback": tb},
        ))

# register handlers
mcp._mcp_server.request_handlers[types.CallToolRequest] = _call_tool_request
mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _handle_read_resource

# at top-level (module scope), define app once
app = mcp.streamable_http_app()

if __name__ == "__main__":
    import uvicorn
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host=HOST, port=PORT, log_level="info", reload=False)
