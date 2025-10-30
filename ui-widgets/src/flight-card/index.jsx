// ui-widgets/src/flight-card/index.jsx
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/** Subscribe to host globals (window.openai.*) */
const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";
function useOpenAiGlobal(key) {
    return useSyncExternalStore(
        (onChange) => {
            const h = (ev) => {
                if (ev?.detail?.globals?.[key] !== undefined) onChange();
            };
            window.addEventListener(SET_GLOBALS_EVENT_TYPE, h, { passive: true });
            return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, h);
        },
        () => (window.openai ? window.openai[key] : undefined),
        () => undefined
    );
}

/** Convert any supported toolOutput shape -> flat rows for rendering */
function coerceToRows(output) {
    // Preferred: already-normalized from the server
    if (output && Array.isArray(output.flights) && output.flights.length) {
        const f0 = output.flights[0];
        if (f0.airlineShort || f0.depart || f0.route) {
            // Already flat row shape
            return output.flights;
        }

        // Fallback: Duffel-like "flights" -> flatten minimally in the iframe
        return output.flights.map((item, i) => {
            const sl = (item.slices || [])[0] || {};
            const segs = sl.segments || [];
            const a = segs[0] || {};
            const b = segs[segs.length - 1] || {};
            const toTime = (iso) =>
                iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
            const d0 = a.departure_time || a.departing_at || b.arrival_time || b.arriving_at || "";
            const wday = d0 ? new Date(d0).toLocaleDateString([], { weekday: "short" }) + "," : "";
            const date = d0 ? new Date(d0).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "";
            const org = a.origin?.iata_code || a.origin || "";
            const dst = b.destination?.iata_code || b.destination || "";

            return {
                id: item.offer_id || item.id || `offer_${i}`,
                airlineShort: item.airline || item.airline_code || "Airline",
                airlineLogo: item.airline_logo || null,
                weekday: wday,
                date,
                depart: toTime(a.departure_time || a.departing_at),
                arrive: toTime(b.arrival_time || b.arriving_at),
                route: org && dst ? `${org}–${dst}` : "",
                duration: item.total_journey_duration || item.total_duration || "—",
                price: item.price || undefined,
                highlight: !!item.highlight || i === 0,
            };
        });
    }
    return [];
}

function FlightHeader({ meta }) {
    if (!meta) return null;
    const { origin, destination, date } = meta;
    if (!origin && !destination && !date) return null;
    return (
        <div className="fc-header" style={{ marginBottom: 8 }}>
            <div className="fc-header-route" style={{ fontWeight: 700 }}>
                {origin && destination ? `${origin} → ${destination}` : origin || destination || ""}
            </div>
            {date ? <div className="fc-header-date" style={{ color: "#6b7280", fontSize: 13 }}>{date}</div> : null}
        </div>
    );
}

function Row({ f }) {
    return (
        <div className={`fc-row ${f.highlight ? "fc-row--highlight" : ""}`}>
            <div className="fc-airline">
                {f.airlineLogo ? (
                    <img
                        className="fc-airline-logo"
                        src={f.airlineLogo}
                        alt={f.airlineShort || "Airline"}
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <span className="fc-airline-badge">{f.airlineShort || "Airline"}</span>
                )}
            </div>

            <div className="fc-main">
                <div className="fc-date">
                    <span className="fc-wday">{f.weekday || ""}</span>{" "}
                    <span className="fc-date-text">{f.date || ""}</span>
                    <span className="fc-sub">Departure</span>
                </div>
                <div className="fc-times">
                    <span className="fc-time">{f.depart || ""}</span>
                    <span className="fc-dash">–</span>
                    <span className="fc-time">{f.arrive || ""}</span>
                    <span className="fc-dur">
                        {f.route || ""}{f.duration ? ` ${f.duration}` : ""}
                    </span>
                </div>
            </div>

            <div className="fc-right">
                {f.price ? <div className="fc-price" title="Price">{f.price}</div> : <div className="fc-pill" />}
                <button className="fc-icon-btn" title="Details">i</button>
            </div>
        </div>
    );
}

function App() {
    const toolOutput = useOpenAiGlobal("toolOutput");
    const flights = useMemo(() => coerceToRows(toolOutput || {}), [toolOutput]);
    const meta = (toolOutput && toolOutput.meta) || null;

    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? flights : flights.slice(0, 2);

    return (
        <div className="fc-wrap">
            <FlightHeader meta={meta} />

            {visible.map((f) => <Row key={f.id} f={f} />)}

            {flights.length > 2 && (
                <button
                    className="fc-showall"
                    onClick={() => setExpanded((v) => !v)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setExpanded((v) => !v)}
                >
                    {expanded ? "Collapse flights" : `Show all ${flights.length} Flights!`}
                </button>
            )}

            {!flights.length && <div className="fc-empty">Waiting for results…</div>}
        </div>
    );
}

const mount = document.getElementById("flight-card-root");
if (mount) createRoot(mount).render(<App />);
