// ui-widgets/src/flight-card/index.jsx
import React, {
  useMemo,
  useState,
  useSyncExternalStore,
  useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/* -----------------------------
   Host globals (window.openai.*)
------------------------------ */
const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

function useOpenAiGlobal(key) {
  return useSyncExternalStore(
    (onChange) => {
      const handler = (ev) => {
        if (ev?.detail?.globals?.[key] !== undefined) onChange();
      };
      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler, {
        passive: true,
      });
      return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
    },
    () => (window.openai ? window.openai[key] : undefined),
    () => undefined
  );
}

/* -----------------------------------------
   Capabilities (for diagnostics only)
------------------------------------------ */
function hostCaps() {
  const oa = window.openai;
  return {
    hasFollowUp: !!oa?.sendFollowUpMessage,
    hasAppendUser: !!oa?.appendUserMessage,
    hasSendMessage: !!oa?.sendMessage,
  };
}

/* -------- send follow-up (aligned with HotelCard) -------- */

async function sendFollowUpMessage(prompt) {
  const oa = window.openai;

  // 1) Preferred: sendFollowUpMessage
  try {
    if (oa?.sendFollowUpMessage) {
      await oa.sendFollowUpMessage({ prompt });
      return;
    }
  } catch (e) {
    console.warn("sendFollowUpMessage failed", e);
  }

  // 2) Fallback: appendUserMessage
  try {
    if (oa?.appendUserMessage) {
      await oa.appendUserMessage(prompt);
      return;
    }
  } catch (e) {
    console.warn("appendUserMessage failed", e);
  }

  // 3) Fallback: sendMessage
  try {
    if (oa?.sendMessage) {
      await oa.sendMessage({ role: "user", content: prompt });
      return;
    }
  } catch (e) {
    console.warn("sendMessage failed", e);
  }

  // 4) Dev fallbacks (outside ChatGPT)
  try {
    window.dispatchEvent(
      new CustomEvent("openai:append_user_message", {
        detail: { text: prompt },
      })
    );
    return;
  } catch (e) {
    console.warn("dispatchEvent fallback failed", e);
  }

  try {
    window.parent?.postMessage(
      { type: "openai:append_user_message", text: prompt },
      "*"
    );
    return;
  } catch (e) {
    console.warn("postMessage fallback failed", e);
  }

  console.log("[fallback] would send follow-up message:", prompt);
}

/* -----------------------------------------
   Backend helper: one-shot block flag
   (skip NEXT search_flights_ui after widget click)
------------------------------------------ */

async function blockNextFlightSearchOnServer() {
  try {
    await fetch("http://localhost:8000/widget/flight/block_next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (e) {
    console.warn("Failed to block next flight search:", e);
  }
}

/* -----------------------------------------
   Helpers: map flights
------------------------------------------ */

function mapFlights(output) {
  const src =
    (output && (output.flights || output.results)) ||
    (Array.isArray(output?.data) ? output.data : []);

  if (!Array.isArray(src)) return [];

  return src.map((f, i) => {
    return {
      id: f.id || f.offer_id || `flight_${i}`,
      airlineShort: f.airlineShort || f.airline || f.owner || "",
      airlineLogo:
        f.airlineLogo ||
        f.logo ||
        (f.marketing_carrier &&
          (f.marketing_carrier.logo || f.marketing_carrier.logo_url)) ||
        "",
      weekday: f.weekday || "",
      date: f.date || "",
      depart: f.depart || f.departure_time || "",
      arrive: f.arrive || f.arrival_time || "",
      route: f.route || "",
      duration: f.duration || "",
      highlight: !!f.highlight || i === 0,
    };
  });
}

/* --------------- UI bits --------------- */

function DurationPill({ text, highlight }) {
  if (!text) return null;
  return (
    <span
      className={
        "fc-pill fc-pill--time " + (highlight ? "fc-pill--time-best" : "")
      }
    >
      {text}
    </span>
  );
}

function BestPill({ show }) {
  if (!show) return null;
  return <span className="fc-pill fc-pill--best">Best</span>;
}

function AirlineBlock({ airline, logo }) {
  return (
    <div className="fc-col fc-col-airline">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="fc-airline-logo"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="fc-airline-logo fc-airline-logo--placeholder" />
      )}
      <span className="fc-airline-name">{airline || "Airline"}</span>
    </div>
  );
}

function DateBlock({ weekday, date }) {
  return (
    <div className="fc-col fc-col-date">
      <div className="fc-date-line">
        {weekday && <span className="fc-weekday">{weekday}</span>}
        {date && <span className="fc-date">{date}</span>}
      </div>
      <div className="fc-departure-label">Departure</div>
    </div>
  );
}

function TimesBlock({ depart, arrive, route }) {
  const range =
    depart && arrive ? `${depart} – ${arrive}` : depart || arrive || "—";
  return (
    <div className="fc-col fc-col-times">
      <div className="fc-time-range">{range}</div>
      {route && <div className="fc-route">{route}</div>}
    </div>
  );
}

function FlightCard({ f, index, onSelect, disabled }) {
  const isBest = !!f.highlight || index === 0;

  return (
    <button
      type="button"
      className={
        "fc-card " + (isBest ? "fc-card--highlight" : "fc-card--normal")
      }
      onClick={() => onSelect(f, index)}
      title={disabled ? "Selection already sent" : "Select this flight"}
      disabled={disabled}
    >
      <div className="fc-card-top">
        <DurationPill text={f.duration} highlight={isBest} />
        <BestPill show={isBest} />
      </div>

      <div className="fc-main">
        <AirlineBlock airline={f.airlineShort} logo={f.airlineLogo} />
        <DateBlock weekday={f.weekday} date={f.date} />
        <TimesBlock depart={f.depart} arrive={f.arrive} route={f.route} />
        <div className="fc-info">
          <div className="fc-info-icon">i</div>
        </div>
      </div>
    </button>
  );
}

/* ----------- App ----------- */

function App() {
  const toolOutput = useOpenAiGlobal("toolOutput");
  const toolMeta =
    useOpenAiGlobal("toolResponseMetadata") || toolOutput?.meta || {};

  // 🔹 Freeze flights after selection (like frozenHotels in the hotel widget)
  const [frozenFlights, setFrozenFlights] = useState(null);

  const flights = useMemo(() => {
    if (frozenFlights) return frozenFlights;
    return mapFlights(toolOutput || {});
  }, [toolOutput, frozenFlights]);

  const [picked, setPicked] = useState(null);
  const [sending, setSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const caps = hostCaps();

  // 🔹 Reset frozen state when we get a *completely new* set of flights
  // CRITICAL: This effect MUST match hotel card behavior exactly
  useEffect(() => {
    // Only check if we have frozen flights AND new toolOutput
    if (!frozenFlights || !toolOutput) return;

    const newFlights = mapFlights(toolOutput);
    
    // Must have new flights to compare
    if (newFlights.length === 0) return;

    const newIds = new Set(newFlights.map((f) => f.id));
    const oldIds = new Set(frozenFlights.map((f) => f.id));
    
    // Check if sets are different (same logic as hotel card)
    const isDifferent =
      newIds.size !== oldIds.size ||
      ![...newIds].every((id) => oldIds.has(id));

    if (isDifferent) {
      console.log('✅ Flight card: Unfreezing - New flight results detected', {
        oldIds: Array.from(oldIds),
        newIds: Array.from(newIds),
        oldCount: oldIds.size,
        newCount: newIds.size
      });
      
      // Reset ALL state (exactly like hotel card)
      setFrozenFlights(null);
      setPicked(null);
      setSending(false);
      setSentOnce(false);
      setSendError(null);
      setShowAll(false);
    } else {
      console.log('⏸️ Flight card: Same flights, keeping frozen state');
    }
  }, [toolOutput, frozenFlights]);

  const VISIBLE_INITIAL = 2;
  const visibleFlights = showAll ? flights : flights.slice(0, VISIBLE_INITIAL);

  async function onSelectFlight(f, index) {
    // prevent double-click spam - BUT allow new selections after reset
    if (sending) return;

    console.log('🛫 Flight selected', {
      flightId: f.id,
      isFrozen: !!frozenFlights,
      sentOnce: sentOnce
    });

    // 1) Tell backend to block the *next* search_flights_ui (one-shot)
    await blockNextFlightSearchOnServer();

    // 2) Freeze the current flights list BEFORE sending anything
    setFrozenFlights(flights);

    const payload = {
      offer_id: f.id,
      airline: f.airlineShort || "",
      route: f.route || "",
      date: f.date || "",
      departure_time: f.depart || "",
      arrival_time: f.arrive || "",
      index,
    };

    const flightInfo = {
      ...payload,
      duration: f.duration || "",
    };

    setPicked(flightInfo);
    setSending(true);
    setSendError(null);

    const promptLines = [
      "I have just clicked and selected this flight in the flights widget.",
      "",
      "Selected flight details:",
      `- Offer ID: ${flightInfo.offer_id || "-"}`,
      `- Airline: ${flightInfo.airline || "-"}`,
      `- Route: ${flightInfo.route || "-"}`,
      `- Date: ${flightInfo.date || "-"}`,
      `- Departure time: ${flightInfo.departure_time || "-"}`,
      `- Arrival time: ${flightInfo.arrival_time || "-"}`,
      flightInfo.duration
        ? `- Duration: ${flightInfo.duration || "-"}`
        : null,
      "",
      "Please do the following:",
      '1. In your reply, say something like: "You have selected this flight, I will proceed with booking steps now."',
      "2. Call the `select_flight_offer` tool using these same details (do NOT call `search_flights_ui` again for this selection).",
      "3. Then ask me for seat preference (aisle/window/middle/none).",
      "4. Collect passenger details (full name, date of birth), email, and phone number.",
      "5. Use `start_flight_checkout` to start payment once everything is confirmed.",
    ].filter(Boolean);

    const prompt = promptLines.join("\n");

    try {
      await sendFollowUpMessage(prompt);
      setSentOnce(true);
      console.log('✅ Flight selection sent to assistant');
    } catch (e) {
      console.error("Error sending follow-up message", e);
      setSendError("Could not notify the assistant about this selection.");
    } finally {
      setSending(false);
    }
  }

  const routeSummary =
    toolMeta && (toolMeta.origin || toolMeta.destination || toolMeta.date)
      ? `${toolMeta.origin || ""} → ${toolMeta.destination || ""} · ${
          toolMeta.date || ""
        }`
      : "";

  return (
    <div className="fc-wrap">
      <div className="fc-header">
        <div className="fc-route-summary">{routeSummary || "Flights"}</div>
        <div className="fc-count">
          {flights.length
            ? `${flights.length} option${flights.length === 1 ? "" : "s"}`
            : ""}
        </div>
      </div>

      <div className="fc-list" aria-label="Flight results">
        {visibleFlights.map((f, idx) => (
          <FlightCard
            key={f.id || idx}
            f={f}
            index={idx}
            onSelect={onSelectFlight}
            disabled={sending}
          />
        ))}
      </div>

      {!flights.length && (
        <div className="fc-empty">Waiting for flight results…</div>
      )}

      {/* Show-all widget */}
      {!showAll && flights.length > VISIBLE_INITIAL && (
        <div className="fc-show-all-wrap">
          <button
            type="button"
            className="fc-show-all-btn"
            onClick={() => setShowAll(true)}
          >
            Show all {flights.length} Flights!
          </button>
        </div>
      )}

      {/* Selection bubble (like in hotels) */}
      {picked && (
        <div
          className={
            "fc-bubble " +
            (sending ? "is-sending " : "") +
            (sentOnce ? "is-sent " : "")
          }
        >
          <div>I'd like to book this flight:</div>
          <div>
            <b>Offer ID:</b> {picked.offer_id}
          </div>
          <div>
            <b>Airline:</b> {picked.airline || "-"}
          </div>
          <div>
            <b>Date:</b> {picked.date || "-"}
          </div>
          <div>
            <b>Route:</b> {picked.route || "-"}
          </div>
          <div>
            <b>Time:</b> {picked.departure_time || "-"} –{" "}
            {picked.arrival_time || "-"}
          </div>
          {picked.duration && (
            <div>
              <b>Duration:</b> {picked.duration}
            </div>
          )}
          <div className="fc-bubble-cta">
            {sending
              ? "Sending selection…"
              : sentOnce
              ? "Selection sent ✓"
              : "Ready to send selection"}
          </div>
          {sendError && <div className="fc-error">{sendError}</div>}
        </div>
      )}

      {/* Diagnostics badge (dev only) */}
      <div className="fc-diagnostics" aria-hidden="true">
        caps:
        {caps.hasFollowUp ? " sendFollowUpMessage" : ""}
        {caps.hasAppendUser ? " appendUserMessage" : ""}
        {caps.hasSendMessage ? " sendMessage" : ""}
        {!caps.hasFollowUp && !caps.hasAppendUser && !caps.hasSendMessage
          ? " none"
          : ""}
        {frozenFlights ? " [FROZEN]" : ""}
      </div>
    </div>
  );
}

const mount = document.getElementById("flight-card-root");
if (mount) {
  const root = createRoot(mount);
  root.render(<App />);
}