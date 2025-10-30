# mcp_adapter/server.py
# BookedAI MCP adapter:
# - Hardens sys.path to avoid user-site shadowing (fixes xxhash issues)
# - Loads .env (expected one level above the "graph" folder)
# - Makes ".../graph" (containing src/) importable
# - Imports your LangGraph Tool objects from src/agent/graph.py
# - Wraps each tool for MCP with FastMCP, forwarding args via .ainvoke(...)
# - Serves POST /mcp on 127.0.0.1:3000 using uvicorn

from __future__ import annotations

import os
import sys
import site
from pathlib import Path
from typing import Any, Dict, List, Optional

# --------------------------------------------------------------------
# 0) Safety: remove user-site from sys.path to prevent module shadowing
#    (This fixes cases where a user-site "xxhash" overrides the wheel.)
# --------------------------------------------------------------------
try:
    USER_SITE = site.getusersitepackages()
except Exception:
    USER_SITE = None

if USER_SITE:
    sys.path[:] = [p for p in sys.path if not (p and p.startswith(USER_SITE))]
os.environ.setdefault("PYTHONNOUSERSITE", "1")

# --------------------------------------------------------------------
# 1) Make .../graph (this file's parent) importable so "src/..." works
# --------------------------------------------------------------------


HERE = Path(__file__).resolve()
GRAPH_ROOT = HERE.parents[1]  # .../graph
if str(GRAPH_ROOT) not in sys.path:
    sys.path.insert(0, str(GRAPH_ROOT))

# --------------------------------------------------------------------
# 2) Load .env from one level above the graph folder
# --------------------------------------------------------------------
from dotenv import load_dotenv
load_dotenv(GRAPH_ROOT.parent / ".env")

# --------------------------------------------------------------------
# 3) Fast sanity check for xxhash (LangGraph depends on xxh3_128_hexdigest)
# --------------------------------------------------------------------
try:
    import importlib.util as _u  # noqa: F401
    import xxhash as _xx
    if not hasattr(_xx, "xxh3_128_hexdigest"):
        raise ImportError(
            "Installed 'xxhash' does not expose xxh3_128_hexdigest. "
            "Install a proper wheel inside this venv: "
            "pip install --only-binary=:all: xxhash>=3.5.0"
        )
except ModuleNotFoundError as _e:
    raise RuntimeError(
        "Missing 'xxhash'. Install inside this venv:\n"
        "  pip install --only-binary=:all: xxhash>=3.5.0"
    ) from _e

# --------------------------------------------------------------------
# 4) MCP SDK
# --------------------------------------------------------------------
from mcp.server.fastmcp import FastMCP

# --------------------------------------------------------------------
# 5) Import your LangGraph tools (names must match src/agent/graph.py)
# --------------------------------------------------------------------
from src.agent.graph import (
    # utility
    get_current_time,
    calculate_simple_math,
    validate_phone_number_tool,
    # flights
    search_flights_tool,
    fetch_flight_quote_tool,
    list_airline_initiated_changes_tool,
    update_airline_initiated_change_tool,
    accept_airline_initiated_change_tool,
    change_flight_booking_tool,
    cancel_flight_booking_tool,
    fetch_extra_baggage_options_tool,
    get_available_services_tool,
    # hotels
    search_hotels_tool,
    fetch_hotel_rates_tool,
    create_hotel_quote_tool,
    cancel_hotel_booking_tool,
    update_hotel_booking_tool,
    extend_hotel_stay_tool,
    # payments / loyalty
    flight_payment_sequence_tool,
    hotel_payment_sequence_tool,
    list_loyalty_programmes_tool,
    list_flight_loyalty_programmes_tool,
    # reviews / memory
    fetch_accommodation_reviews_tool,
    remember_tool,
    recall_tool,
)

# MCP app name (what clients see)
mcp = FastMCP("BookedAI")

from pathlib import Path
from mcp.server.fastmcp import FastMCP

# ---------- Widget resource (copy–paste) ----------
from pathlib import Path
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("BookedAI")


# ---------- end widget block ----------


# -------------------------
# Utility / sanity tools
# -------------------------
@mcp.tool(name="ping")
def ping() -> str:
    """Simple liveness check."""
    return "pong"

# IMPORTANT: call without args to match graph.py signature.
@mcp.tool(name="get_current_time")
async def get_current_time_mcp() -> str:
    return await get_current_time.ainvoke({})

@mcp.tool(name="calculate_simple_math")
async def calculate_simple_math_mcp(expression: str) -> str:
    return await calculate_simple_math.ainvoke({"expression": expression})

@mcp.tool(name="validate_phone_number_tool")
async def validate_phone_number_tool_mcp(phone: str, client_country: Optional[str] = None) -> str:
    return await validate_phone_number_tool.ainvoke(
        {"phone": phone, "client_country": client_country}
    )

# -------------------------
# Flights
# -------------------------
@mcp.tool(name="search_flights_tool")
async def search_flights_tool_mcp(
    slices: List[Dict[str, Any]],
    passengers: int = 1,
    cabin_class: str = "economy",
    max_results: int = 5,
) -> str:
    return await search_flights_tool.ainvoke(
        {
            "slices": slices,
            "passengers": passengers,
            "cabin_class": cabin_class,
            "max_results": max_results,
        }
    )

@mcp.tool(name="fetch_flight_quote_tool")
async def fetch_flight_quote_tool_mcp(offer_id: str) -> str:
    return await fetch_flight_quote_tool.ainvoke({"offer_id": offer_id})

@mcp.tool(name="list_airline_initiated_changes_tool")
async def list_airline_initiated_changes_tool_mcp() -> str:
    return await list_airline_initiated_changes_tool.ainvoke({})

@mcp.tool(name="update_airline_initiated_change_tool")
async def update_airline_initiated_change_tool_mcp(change_id: str, data: Dict[str, Any]) -> str:
    return await update_airline_initiated_change_tool.ainvoke({"change_id": change_id, "data": data})

@mcp.tool(name="accept_airline_initiated_change_tool")
async def accept_airline_initiated_change_tool_mcp(change_id: str) -> str:
    return await accept_airline_initiated_change_tool.ainvoke({"change_id": change_id})

@mcp.tool(name="change_flight_booking_tool")
async def change_flight_booking_tool_mcp(
    order_id: str,
    slices: Optional[List[Dict[str, Any]]] = None,
    type: str = "update",
    cabin_class: Optional[str] = None,
) -> str:
    return await change_flight_booking_tool.ainvoke(
        {
            "order_id": order_id,
            "slices": slices,
            "type": type,
            "cabin_class": cabin_class,
        }
    )

@mcp.tool(name="cancel_flight_booking_tool")
async def cancel_flight_booking_tool_mcp(order_id: str, proceed_despite_warnings: bool = False) -> str:
    return await cancel_flight_booking_tool.ainvoke(
        {"order_id": order_id, "proceed_despite_warnings": proceed_despite_warnings}
    )

@mcp.tool(name="fetch_extra_baggage_options_tool")
async def fetch_extra_baggage_options_tool_mcp(offer_id: str) -> str:
    return await fetch_extra_baggage_options_tool.ainvoke({"offer_id": offer_id})

@mcp.tool(name="get_available_services_tool")
async def get_available_services_tool_mcp(offer_id: str) -> str:
    return await get_available_services_tool.ainvoke({"offer_id": offer_id})

# -------------------------
# Hotels
# -------------------------
@mcp.tool(name="search_hotels_tool")
async def search_hotels_tool_mcp(
    location: str,
    check_in_date: str,
    check_out_date: str,
    adults: Optional[int] = None,
    children: Optional[int] = None,
    max_results: int = 5,
    hotel_name: Optional[str] = None,
) -> str:
    return await search_hotels_tool.ainvoke(
        {
            "location": location,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "adults": adults,
            "children": children,
            "max_results": max_results,
            "hotel_name": hotel_name,
        }
    )

@mcp.tool(name="fetch_hotel_rates_tool")
async def fetch_hotel_rates_tool_mcp(search_result_id: str) -> str:
    return await fetch_hotel_rates_tool.ainvoke({"search_result_id": search_result_id})

@mcp.tool(name="create_hotel_quote_tool")
async def create_hotel_quote_tool_mcp(rate_id: str) -> str:
    return await create_hotel_quote_tool.ainvoke({"rate_id": rate_id})

@mcp.tool(name="cancel_hotel_booking_tool")
async def cancel_hotel_booking_tool_mcp(booking_id: str) -> str:
    return await cancel_hotel_booking_tool.ainvoke({"booking_id": booking_id})

@mcp.tool(name="update_hotel_booking_tool")
async def update_hotel_booking_tool_mcp(
    booking_id: str,
    email: Optional[str] = None,
    phone_number: Optional[str] = None,
    stay_special_requests: Optional[str] = None,
) -> str:
    return await update_hotel_booking_tool.ainvoke(
        {
            "booking_id": booking_id,
            "email": email,
            "phone_number": phone_number,
            "stay_special_requests": stay_special_requests,
        }
    )

@mcp.tool(name="extend_hotel_stay_tool")
async def extend_hotel_stay_tool_mcp(
    booking_id: str,
    check_in_date: str,
    check_out_date: str,
    preferred_rate_id: Optional[str] = None,
    customer_confirmation: bool = False,
    payment: Optional[Dict[str, Any]] = None,
) -> str:
    return await extend_hotel_stay_tool.ainvoke(
        {
            "booking_id": booking_id,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "preferred_rate_id": preferred_rate_id,
            "customer_confirmation": customer_confirmation,
            "payment": payment,
        }
    )

# -------------------------
# Payments / Loyalty
# -------------------------
@mcp.tool(name="flight_payment_sequence_tool")
async def flight_payment_sequence_tool_mcp(
    offer_id: str,
    passengers: List[Dict[str, Any]],
    email: str,
    payment_method: Optional[Dict[str, Any]] = None,
    phone_number: str = "",
    include_seat_map: bool = False,
    selected_seats: Optional[List[Dict[str, Any]]] = None,
    **kwargs: Any,
) -> str:
    payload = {
        "offer_id": offer_id,
        "passengers": passengers,
        "email": email,
        "payment_method": payment_method,
        "phone_number": phone_number,
        "include_seat_map": include_seat_map,
        "selected_seats": selected_seats,
    }
    payload.update(kwargs or {})
    return await flight_payment_sequence_tool.ainvoke(payload)

@mcp.tool(name="hotel_payment_sequence_tool")
async def hotel_payment_sequence_tool_mcp(
    rate_id: str,
    guests: List[Dict[str, Any]],
    email: str,
    payment_method: Optional[Dict[str, Any]] = None,
    phone_number: str = "",
    stay_special_requests: str = "",
    **kwargs: Any,
) -> str:
    payload = {
        "rate_id": rate_id,
        "guests": guests,
        "email": email,
        "payment_method": payment_method,
        "phone_number": phone_number,
        "stay_special_requests": stay_special_requests,
    }
    payload.update(kwargs or {})
    return await hotel_payment_sequence_tool.ainvoke(payload)

@mcp.tool(name="list_loyalty_programmes_tool")
async def list_loyalty_programmes_tool_mcp() -> str:
    return await list_loyalty_programmes_tool.ainvoke({})

@mcp.tool(name="list_flight_loyalty_programmes_tool")
async def list_flight_loyalty_programmes_tool_mcp() -> str:
    return await list_flight_loyalty_programmes_tool.ainvoke({})

# -------------------------
# Reviews / Memory
# -------------------------
@mcp.tool(name="fetch_accommodation_reviews_tool")
async def fetch_accommodation_reviews_tool_mcp(accommodation_id: str, limit: int = 5) -> str:
    return await fetch_accommodation_reviews_tool.ainvoke(
        {"accommodation_id": accommodation_id, "limit": limit}
    )

@mcp.tool(name="remember_tool")
async def remember_tool_mcp(**kwargs: Any) -> str:
    return await remember_tool.ainvoke(kwargs)

@mcp.tool(name="recall_tool")
async def recall_tool_mcp(**kwargs: Any) -> str:
    return await recall_tool.ainvoke(kwargs)

@mcp.tool(name="get_seat_maps_tool")
async def get_seat_maps_tool_mcp(offer_id: str) -> str:
    return await get_seat_maps_tool.ainvoke({"offer_id": offer_id})

@mcp.tool(name="validate_offer_tool")
async def validate_offer_tool_mcp(offer_id: str) -> str:
    return await validate_offer_tool.ainvoke({"offer_id": offer_id})

@mcp.tool(name="create_flight_booking_tool")
async def create_flight_booking_tool_mcp(
    offer_id: str,
    passengers: List[Dict[str, Any]],
    payments: List[Dict[str, Any]],
    services: Optional[List[Dict[str, Any]]] = None,
    loyalty_programme_reference: str = "",
    loyalty_account_number: str = "",
    **kwargs: Any,
) -> str:
    payload = {
        "offer_id": offer_id,
        "passengers": passengers,
        "payments": payments,
        "services": services,
        "loyalty_programme_reference": loyalty_programme_reference,
        "loyalty_account_number": loyalty_account_number,
    }
    payload.update(kwargs or {})
    return await create_flight_booking_tool.ainvoke(payload)

# -------------------------
# HTTP serve (Streamable HTTP for connectors)
# -------------------------
import uvicorn

if __name__ == "__main__":
    app = mcp.streamable_http_app()  # exposes POST /mcp
    # Bind to localhost. For LAN access, use host="0.0.0.0".
    uvicorn.run(app, host="0.0.0.0", port=3000)
