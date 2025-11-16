// src/flight-card/index.jsx
import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/* ---------------------------------
   Helpers: parsing + formatting
---------------------------------- */

function tryParseJSON(x) {
    if (typeof x !== "string") return x;
    try {
        return JSON.parse(x);
    } catch {
        return x;
    }
}

function coercePayload(p) {
    let v = tryParseJSON(p);
    // Common wrappers from hosts / tool chains
    if (v && typeof v === "object" && "result" in v) v = tryParseJSON(v.result);
    if (v && typeof v === "object" && "data" in v) v = tryParseJSON(v.data);
    return v;
}

function getInjectedPayload() {
    const w = typeof window !== "undefined" ? window : {};
    return (
        coercePayload(w.webplus?.structuredContent) ||
        coercePayload(w.webplus?.globals?.structuredContent) ||
        coercePayload(w.webplus?.globals) ||
        null
    );
}

// "2025-12-23T17:01:00" → "5:01 PM"
function fmtTime(localIso) {
    if (!localIso) return "";
    try {
        const d = new Date(localIso);
        let hh = d.getHours();
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ampm = hh >= 12 ? "PM" : "AM";
        hh = hh % 12 || 12;
        return `${hh}:${mm} ${ampm}`;
    } catch {
        return localIso.split("T")[1]?.slice(0, 5) ?? localIso;
    }
}

// "2025-12-23T17:01:00" → { weekday: "Tue", date: "Dec 23" }
function fmtWeekdayDate(localIso) {
    if (!localIso) return { weekday: "", date: "" };
    try {
        const d = new Date(localIso);
        const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
        const month = d.toLocaleDateString(undefined, { month: "short" });
        const day = d.getDate();
        return { weekday, date: `${month} ${day}` };
    } catch {
        return { weekday: "", date: "" };
    }
}

// "111.14 AUD" → 111.14
function parsePriceToNumber(priceStr) {
    if (!priceStr) return Number.POSITIVE_INFINITY;
    const n = parseFloat(String(priceStr).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

// Duffel offer → compact card shape
function mapOfferToCard(offer) {
    const slice = Array.isArray(offer?.slices) ? offer.slices[0] : undefined;
    const seg = slice?.segments?.[0];

    const departIso = seg?.departure_time;
    const arriveIso = seg?.arrival_time;
    const { weekday, date } = fmtWeekdayDate(departIso);

    return {
        id: offer.offer_id || offer.id,
        airlineShort:
            offer.airline_code || (offer.airline ? offer.airline.slice(0, 2).toUpperCase() : "??"),
        airlineName: offer.airline || "",
        logo: offer.airline_logo || null,
        price: offer.price || "",
        weekday,
        date,
        depart: fmtTime(departIso),
        arrive: fmtTime(arriveIso),
        route: seg ? `${seg.origin}–${seg.destination}` : "",
        duration: slice?.duration || "",
        raw: offer, // keep original for possible follow-ups
    };
}

/**
 * Accepts:
 *  - { type: "flight_search_results", flights: [...] }
 *  - { flights: [...] }
 *  - [ ...flights ] (direct)
 * Returns normalized cards + cheapest index.
 */
function normalizeToCards(payload) {
    const p = coercePayload(payload);

    let flights =
        (p && p.type === "flight_search_results" && p.flights) ||
        (p && p.flights) ||
        (Array.isArray(p) ? p : null);

    if (!Array.isArray(flights)) return { cards: [], bestIdx: -1 };

    const cards = flights.map(mapOfferToCard);

    let bestIdx = -1;
    let best = Number.POSITIVE_INFINITY;
    cards.forEach((c, i) => {
        const price = parsePriceToNumber(c.price);
        if (price < best) {
            best = price;
            bestIdx = i;
        }
    });

    return { cards, bestIdx };
}

/* ---------------------------------
   Optional: send ui_ack (best-effort)
---------------------------------- */

function useAckOnce() {
    const sent = useRef(new Set());
    return function sendAckIfAny(payload) {
        try {
            const deliveryId =
                payload?.delivery?.id ||
                window?.webplus?.structuredContent?.delivery?.id ||
                window?.webplus?.globals?.structuredContent?.delivery?.id;

            if (!deliveryId || sent.current.has(deliveryId)) return false;
            sent.current.add(deliveryId);

            const msg = {
                type: "call_tool", // canonical envelope
                name: "ui_ack",
                arguments: {
                    delivery_id: deliveryId,
                    widget: "flight-card",
                    info: { status: "displayed" },
                },
                server: "BookedAI", // if host supports targeting by server/app name
            };

            if (typeof window?.webplus?.callTool === "function") {
                window.webplus.callTool(msg);
            } else {
                window?.webplus?.postMessage?.(msg);
            }
            return true;
        } catch {
            return false;
        }
    };
}

/* ---------------------------
   Presentational components
---------------------------- */

function AirlineBadge({ logo, code }) {
    if (logo) {
        return (
            <img
                src={logo}
                alt={code || "Airline"}
                className="h-6 w-6 rounded-full border object-contain bg-white"
            />
        );
    }
    return (
        <div className="h-6 w-6 rounded-full border flex items-center justify-center text-[10px] font-semibold">
            {code || "??"}
        </div>
    );
}

function FlightCard({ flight, isSelected, onClick, highlight = false }) {
    return (
        <button
            type="button"
            onClick={() => onClick(flight)}
            data-offer-id={flight.id}
            className={[
                "text-left w-full rounded-2xl p-[2px]",
                "bg-gradient-to-r from-[#2B6BFF] to-[#07D3C5]",
                isSelected ? "ring-2 ring-black/10" : "ring-0",
                "focus:outline-none",
            ].join(" ")}
        >
            <div className="rounded-2xl bg-white text-black">
                <div className="relative flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4">
                    {highlight && (
                        <div className="absolute -top-2 right-3">
                            <span className="inline-flex items-center rounded-full bg-[#19E28D] text-white text-xs font-semibold px-2 py-0.5 shadow">
                                Best!
                            </span>
                        </div>
                    )}

                    <div className="shrink-0">
                        <AirlineBadge logo={flight.logo} code={flight.airlineShort} />
                    </div>

                    <div className="min-w-0">
                        <div className="text-[15px] font-semibold leading-tight">
                            {flight.weekday}
                            {flight.date ? `, ${flight.date}` : ""}
                        </div>
                        <div className="text-[12px] text-black/60 -mt-0.5">
                            {flight.airlineName || "Departure"}
                        </div>
                    </div>

                    <div className="mx-2 h-5 w-px bg-black/10 hidden sm:block" />

                    <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-semibold leading-tight">
                            {flight.depart}–{flight.arrive}
                        </div>
                        <div className="text-[12px] text-black/60 -mt-0.5">
                            {flight.route} {flight.duration ? `• ${flight.duration}` : ""}
                        </div>
                    </div>

                    <div className="shrink-0 text-right">
                        {!!flight.price && <div className="text-sm font-semibold">{flight.price}</div>}
                        <div className="text-[11px] text-black/60">per traveller</div>
                    </div>
                </div>
            </div>
        </button>
    );
}

/* ---------------------------
   App
---------------------------- */

export default function App() {
    const [displayMode, setDisplayMode] = useState(() => {
        try {
            const w = typeof window !== "undefined" ? window : {};
            return w.webplus?.globals?.displayMode || "embedded";
        } catch {
            return "embedded";
        }
    });

    const [maxHeight, setMaxHeight] = useState(
        typeof window !== "undefined" ? window.innerHeight : 480
    );

    const [selectedId, setSelectedId] = useState(null);

    // We start EMPTY. Demo is only used if absolutely nothing arrives after a short poll.
    const [flights, setFlights] = useState([]);
    const [bestIndex, setBestIndex] = useState(-1);

    const demoFlights = useMemo(
        () => [
            {
                id: "demo-best",
                airlineShort: "ZZ",
                airlineName: "Demo Airways",
                logo: null,
                weekday: "Wed",
                date: "Oct 22",
                depart: "7:30 AM",
                arrive: "9:00 AM",
                route: "MEL–SYD",
                duration: "1h 30m",
                price: "123.45 AUD",
            },
        ],
        []
    );

    const sendAckIfAny = useAckOnce();

    // 1) Immediate grab + short poll (up to ~3s) for late injection
    useEffect(() => {
        const initial = getInjectedPayload();
        const a = normalizeToCards(initial);
        if (a.cards.length) {
            setFlights(a.cards);
            setBestIndex(a.bestIdx);
            sendAckIfAny(initial);
            // eslint-disable-next-line no-console
            console.info("[flight-card] initial structuredContent:", initial);
            return;
        }

        // eslint-disable-next-line no-console
        console.info("[flight-card] no initial payload; polling for host injection…");
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            const late = getInjectedPayload();
            const b = normalizeToCards(late);
            if (b.cards.length) {
                setFlights(b.cards);
                setBestIndex(b.bestIdx);
                sendAckIfAny(late);
                clearInterval(timer);
                // eslint-disable-next-line no-console
                console.info("[flight-card] received structuredContent via poll:", late);
            } else if (tries >= 30) {
                clearInterval(timer);
                // fallback demo only if absolutely nothing arrived
                setFlights(demoFlights);
                setBestIndex(0);
                // eslint-disable-next-line no-console
                console.warn("[flight-card] no payload after poll; showing demo");
            }
        }, 100);

        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2) Listen for BOTH events and update immediately
    useEffect(() => {
        const onResize = () => setMaxHeight(window.innerHeight || 480);

        const onStructured = (e) => {
            const payload = coercePayload(e?.detail);
            const { cards, bestIdx } = normalizeToCards(payload);
            if (cards.length) {
                setFlights(cards);
                setBestIndex(bestIdx);
                sendAckIfAny(payload);
                // eslint-disable-next-line no-console
                console.info("[flight-card] openai-structured-content:", payload);
            }
        };

        const onGlobal = (e) => {
            const k = e?.detail?.key;
            const v = e?.detail?.value;

            if (k === "displayMode" && typeof v === "string") {
                setDisplayMode(v);
                return;
            }

            if (k === "structuredContent" && v) {
                const payload = coercePayload(v);
                const { cards, bestIdx } = normalizeToCards(payload);
                if (cards.length) {
                    setFlights(cards);
                    setBestIndex(bestIdx);
                    sendAckIfAny(payload);
                    // eslint-disable-next-line no-console
                    console.info("[flight-card] openai-global-change (structuredContent):", payload);
                }
                return;
            }

            if (k === "globals" && v) {
                const payload = coercePayload(v.structuredContent) ?? coercePayload(v);
                const { cards, bestIdx } = normalizeToCards(payload);
                if (cards.length) {
                    setFlights(cards);
                    setBestIndex(bestIdx);
                    sendAckIfAny(payload);
                    // eslint-disable-next-line no-console
                    console.info("[flight-card] openai-global-change (globals):", payload);
                }
                if (typeof v.displayMode === "string") setDisplayMode(v.displayMode);
            }
        };

        window.addEventListener("resize", onResize);
        window.addEventListener("openai-structured-content", onStructured);
        window.addEventListener("openai-global-change", onGlobal);
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("openai-structured-content", onStructured);
            window.removeEventListener("openai-global-change", onGlobal);
        };
    }, [sendAckIfAny]);

    // Layout tweaks
    const wrapperStyle =
        displayMode === "fullscreen" ? { minHeight: Math.max(140, maxHeight - 40) } : {};

    const handleClick = (f) => {
        setSelectedId(f.id);
        // Optional: notify host for follow-up actions like quote
        // window?.webplus?.postMessage?.({ type: "flight_click", payload: f.raw || f });
        // eslint-disable-next-line no-console
        console.log(`Flight clicked: ${f.route} ${f.depart}–${f.arrive}`);
    };

    return (
        <div
            style={wrapperStyle}
            className={
                "relative w-full bg-white " +
                (displayMode === "fullscreen"
                    ? "rounded-none border-0"
                    : "border border-black/10 dark:border-white/10 rounded-2xl sm:rounded-3xl")
            }
        >
            {/* Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
                <div className="text-sm font-medium">
                    Flights {Number.isFinite(bestIndex) && bestIndex >= 0 ? "• Best highlighted" : ""}
                </div>
                {displayMode !== "fullscreen" && (
                    <button
                        type="button"
                        className="rounded-full bg-white text-black shadow ring ring-black/5 px-3 py-1.5 text-sm"
                        onClick={() => window?.webplus?.requestDisplayMode?.({ mode: "fullscreen" })}
                    >
                        Fullscreen
                    </button>
                )}
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
                {flights.length === 0 && (
                    <div className="text-sm text-black/60">Loading flight results…</div>
                )}

                {flights.map((f, i) => (
                    <FlightCard
                        key={f.id || i}
                        flight={f}
                        highlight={i === bestIndex}
                        isSelected={selectedId === f.id}
                        onClick={handleClick}
                    />
                ))}

                {selectedId && (
                    <div className="text-xs text-black/60 pt-1">
                        Selected: <span className="font-medium">{selectedId}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// Mount into <div id="flight-card-root"></div>
const rootEl = document.getElementById("flight-card-root");
if (rootEl) createRoot(rootEl).render(<App />);
