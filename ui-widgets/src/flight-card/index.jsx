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

  try {
    if (oa?.sendFollowUpMessage) {
      await oa.sendFollowUpMessage({ prompt });
      return;
    }
  } catch (e) {
    console.warn("sendFollowUpMessage failed", e);
  }

  try {
    if (oa?.appendUserMessage) {
      await oa.appendUserMessage(prompt);
      return;
    }
  } catch (e) {
    console.warn("appendUserMessage failed", e);
  }

  try {
    if (oa?.sendMessage) {
      await oa.sendMessage({ role: "user", content: prompt });
      return;
    }
  } catch (e) {
    console.warn("sendMessage failed", e);
  }

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
      // Return leg
      returnDepart:
        f.returnDepart ||
        f.return_depart ||
        f.return_departure_time ||
        "",
      returnArrive:
        f.returnArrive ||
        f.return_arrive ||
        f.return_arrival_time ||
        "",
      returnRoute: f.returnRoute || f.return_route || "",
      returnDate:
        f.returnDate ||
        f.return_date ||
        f.return_date_str ||
        f.return_date_text ||
        "",
      returnWeekday: f.returnWeekday || f.return_weekday || "",
      route: f.route || "",
      duration: f.duration || "",
      highlight: !!f.highlight || i === 0,
      price: f.price || "",
      tax: f.tax || "",
      flightNumber: f.flightNumber || f.flight_number || "",
      stops: f.stops || "Non-stop",
      cabin: f.cabin || "Economy",
      baggage: f.baggage || "0 checked, 1 carry_on",
      refunds: f.refunds || "Changeable",
    };
  });
}

/* -----------------------------------------
   Formatting helpers to match TARGET
------------------------------------------ */
const ARROW = "→";

function normalizeLegRoute(route) {
  if (!route) return "";
  let t = String(route).trim();

  // normalize separators to arrow
  t = t.replace(/\s*(→|->|—|–|-)\s*/g, ` ${ARROW} `);

  // clean double spaces
  t = t.replace(/\s+/g, " ").trim();

  return t.toUpperCase();
}

/* --------------- UI bits --------------- */

function DurationPill({ text, highlight, index }) {
  if (!text) return null;
  const isGreen = index === 0 || highlight;
  return (
    <span className={"fc-pill " + (isGreen ? "fc-pill--time" : "fc-pill--time-slow")}>
      {String(text).trim()}
    </span>
  );
}

function AirlineBlock({ airline, logo }) {
  return (
    <>
      {logo ? (
        <img
          src={logo}
          alt={airline || "Airline"}
          className="fc-airline-logo"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="fc-airline-logo fc-airline-logo--placeholder" />
      )}
    </>
  );
}

function DateBlock({ weekday, date }) {
  const stripYear = (str) =>
    str ? str.replace(/(\s|,)*\d{4}\s*$/, "") : str;

  let dateText = stripYear(date || "");

  // If weekday not provided, try to infer from "Mon, Dec 22"
  let wk = weekday || "";
  if (!wk && typeof dateText === "string" && dateText.includes(",")) {
    const maybe = dateText.split(",")[0].trim();
    if (maybe && maybe.length <= 4) wk = maybe;
  }

  // If we have a weekday, remove it from the dateText (so it can render separately)
  if (wk && dateText) {
    const escaped = wk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("^" + escaped + ",?\\s*");
    dateText = dateText.replace(re, "");
  }

  return (
    <div className="fc-date-line" title={(wk ? wk + ", " : "") + (dateText || "")}>
      {wk && <span className="fc-weekday">{wk}</span>}
      {wk && dateText && <span>, </span>}
      {dateText && <span className="fc-date">{dateText}</span>}
    </div>
  );
}

/** Convert h:mm AM/PM → 24-hour HH:MM, or return cleaned string */
function formatTimeTo24Hour(timeStr) {
  if (!timeStr) return "";
  const s = String(timeStr).trim();

  if (s.includes("-")) {
    const [start, end] = s.split("-").map((p) => p.trim());
    const fs = formatTimeTo24Hour(start);
    const fe = formatTimeTo24Hour(end);
    if (fs && fe) return `${fs} - ${fe}`;
    return s.replace(/\s*(AM|PM|am|pm)\s*$/, "");
  }

  const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?$/);
  if (!m) return s.replace(/\s*(AM|PM|am|pm)\s*$/, "");

  let [, hStr, mStr, ampm] = m;
  let h = parseInt(hStr, 10);

  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === "AM") {
      if (h === 12) h = 0;
    } else if (upper === "PM") {
      if (h !== 12) h += 12;
    }
  }

  const hh = String(h).padStart(2, "0");
  return `${hh}:${mStr}`;
}

function TimesBlock({ depart, arrive }) {
  const d = formatTimeTo24Hour(depart);
  const a = formatTimeTo24Hour(arrive);
  const range = d && a ? `${d} - ${a}` : d || a || "—";
  return <span className="fc-time-range">{range}</span>;
}

function MoreInfoButton({ open, onToggle }) {
  return (
    <button className="fc-more-info" onClick={onToggle} type="button">
      {open ? "Less Info" : "More Info"}{" "}
      <span className={`fc-chevron ${open ? "fc-chevron--open" : ""}`}>▼</span>
    </button>
  );
}

function PriceBlock({ price, tax, onSelect, disabled }) {
  const displayPrice = price || "$161";
  const displayTax = tax || "incl. $15 tax";

  return (
    <div className="fc-price-row">
      <div className="fc-price-info">
        <div className="fc-price-amount">{displayPrice}</div>
        <div className="fc-price-tax">{displayTax}</div>
      </div>
      <button
        type="button"
        className="fc-select-btn"
        onClick={onSelect}
        disabled={disabled}
      >
        Select
      </button>
    </div>
  );
}

function DetailsSection({ flight }) {
  return (
    <div className="fc-details-box">
      <div className="fc-details">
        <span className="fc-details-label">Airline:</span>
        <span className="fc-details-value">{flight.airlineShort || "—"}</span>

        <span className="fc-details-label">Flight Number:</span>
        <span className="fc-details-value">{flight.flightNumber || "—"}</span>

        <span className="fc-details-label">Stops:</span>
        <span className="fc-details-value">{flight.stops || "Non-stop"}</span>

        <span className="fc-details-label">Cabin:</span>
        <span className="fc-details-value">{flight.cabin || "Economy"}</span>

        <span className="fc-details-label">Baggage:</span>
        <span className="fc-details-value">
          {flight.baggage || "0 checked, 1 carry_on"}
        </span>

        <span className="fc-details-label">Refunds:</span>
        <span className="fc-details-value">
          {flight.refunds || "Changeable"}
        </span>

        <span className="fc-details-label">Duration:</span>
        <span className="fc-details-value">{flight.duration || "—"}</span>
      </div>
    </div>
  );
}

/* ------------ Flight card ------------ */

function FlightCard({ f, index, onSelect, disabled }) {
  // ✅ both expandable independently
  const [showDepartureDetails, setShowDepartureDetails] = useState(false);
  const [showReturnDetails, setShowReturnDetails] = useState(false);

  const isBest = !!f.highlight || index === 0;

  const hasReturnLeg = useMemo(() => {
    const hasExplicit = !!(f.returnDepart || f.returnArrive || f.returnRoute || f.returnDate);
    const hasRouteReturn = typeof f.route === "string" && f.route.includes("/");
    const hasDateReturn = typeof f.date === "string" && f.date.includes("→");
    return hasExplicit || hasRouteReturn || hasDateReturn;
  }, [f.returnDepart, f.returnArrive, f.returnRoute, f.returnDate, f.route, f.date]);

  const { outboundDateRaw, returnDateRaw } = useMemo(() => {
    const stripYear = (str) => (str ? str.replace(/\s*\d{4}\s*$/, "") : "");
    const raw = f.date || "";
    if (raw.includes("→")) {
      const [out, ret] = raw.split("→").map((s) => stripYear(s.trim()));
      return { outboundDateRaw: out, returnDateRaw: ret };
    }
    return { outboundDateRaw: stripYear(raw), returnDateRaw: stripYear(f.returnDate || "") };
  }, [f.date, f.returnDate]);

  const { outWeekday, outDate, retWeekday, retDate } = useMemo(() => {
    const outW = f.weekday || "";
    const outD = outboundDateRaw || "";

    const rW = f.returnWeekday || "";
    const rD = returnDateRaw || "";

    return {
      outWeekday: outW,
      outDate: outD,
      retWeekday: rW,
      retDate: rD,
    };
  }, [f.weekday, outboundDateRaw, f.returnWeekday, returnDateRaw]);

  const { outboundRouteDisplay, returnRouteDisplay } = useMemo(() => {
    const full = (f.route || "").trim();
    const explicitRet = (f.returnRoute || "").trim();

    let out = full;
    let retFromSlash = "";

    if (full.includes("/")) {
      const parts = full.split("/").map((s) => s.trim());
      out = parts[0] || "";
      retFromSlash = parts[1] || "";
    }

    const ret = explicitRet || retFromSlash;

    return {
      outboundRouteDisplay: normalizeLegRoute(out),
      returnRouteDisplay: normalizeLegRoute(ret),
    };
  }, [f.route, f.returnRoute]);

  const handleSelect = (e) => {
    e.stopPropagation();
    onSelect(f, index);
  };

  return (
    <div className={"fc-card " + (isBest ? "fc-card--highlight" : "fc-card--normal")}>
      <div className="fc-card-inner">
        <div className="fc-card-header">
          <DurationPill text={f.duration} highlight={isBest} index={index} />
          {isBest && <span className="fc-best-pill">Best</span>}
        </div>

        {/* logo only */}
        <div className="fc-airline-row">
          <AirlineBlock airline={f.airlineShort} logo={f.airlineLogo} />
        </div>

        <div className="fc-divider" />

        <div className="fc-legs">
          {/* Departure row */}
          <div className="fc-leg-row">
            <div className="fc-leg-cell fc-leg-cell--date">
              <DateBlock weekday={outWeekday} date={outDate} />
              <div className="fc-leg-label">DEPARTURE</div>
            </div>

            <div className="fc-leg-cell fc-leg-cell--time">
              <TimesBlock depart={f.depart} arrive={f.arrive} />
              {outboundRouteDisplay && (
                <div className="fc-leg-route">{outboundRouteDisplay}</div>
              )}
            </div>

            <div className="fc-leg-cell fc-leg-cell--more">
              <MoreInfoButton
                open={showDepartureDetails}
                onToggle={(e) => {
                  e.stopPropagation();
                  setShowDepartureDetails((v) => !v);
                }}
              />
            </div>
          </div>

          {showDepartureDetails && (
            <div className="fc-leg-details">
              <DetailsSection flight={f} />
            </div>
          )}

          {/* Return row */}
          {hasReturnLeg && (
            <>
              <div className="fc-leg-row fc-leg-row--return">
                <div className="fc-leg-cell fc-leg-cell--date">
                  <DateBlock weekday={retWeekday} date={retDate} />
                  <div className="fc-leg-label">RETURN</div>
                </div>

                <div className="fc-leg-cell fc-leg-cell--time">
                  <TimesBlock
                    depart={f.returnDepart || ""}
                    arrive={f.returnArrive || ""}
                  />
                  {returnRouteDisplay && (
                    <div className="fc-leg-route">{returnRouteDisplay}</div>
                  )}
                </div>

                <div className="fc-leg-cell fc-leg-cell--more">
                  <MoreInfoButton
                    open={showReturnDetails}
                    onToggle={(e) => {
                      e.stopPropagation();
                      setShowReturnDetails((v) => !v);
                    }}
                  />
                </div>
              </div>

              {showReturnDetails && (
                <div className="fc-leg-details">
                  <DetailsSection flight={f} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="fc-price-section">
          <PriceBlock
            price={f.price}
            tax={f.tax}
            onSelect={handleSelect}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------- App ----------- */

function App() {
  const toolOutput = useOpenAiGlobal("toolOutput");
  const toolMeta =
    useOpenAiGlobal("toolResponseMetadata") || toolOutput?.meta || {};

  const [frozenFlights, setFrozenFlights] = useState(null);
  const [picked, setPicked] = useState(null);
  const [sending, setSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [sendError, setSendError] = useState(null);

  const scrollRef = React.useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const flights = useMemo(() => {
    if (frozenFlights) return frozenFlights;
    return mapFlights(toolOutput || {});
  }, [toolOutput, frozenFlights]);

  const caps = hostCaps();

  const updateScrollButtons = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  };

  useEffect(() => {
    updateScrollButtons();
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", updateScrollButtons);
      window.addEventListener("resize", updateScrollButtons);
      return () => {
        scrollEl.removeEventListener("scroll", updateScrollButtons);
        window.removeEventListener("resize", updateScrollButtons);
      };
    }
  }, [flights]);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const scrollAmount = 496; // unchanged
    const newScrollLeft =
      scrollRef.current.scrollLeft +
      (direction === "left" ? -scrollAmount : scrollAmount);
    scrollRef.current.scrollTo({ left: newScrollLeft, behavior: "smooth" });
  };

  // Reset frozen state when we get a completely new set of flights
  useEffect(() => {
    if (!frozenFlights || !toolOutput) return;

    const newFlights = mapFlights(toolOutput);
    if (newFlights.length === 0) return;

    const newIds = new Set(newFlights.map((f) => f.id));
    const oldIds = new Set(frozenFlights.map((f) => f.id));

    const isDifferent =
      newIds.size !== oldIds.size ||
      ![...newIds].every((id) => oldIds.has(id));

    if (isDifferent) {
      console.log("✅ Flight card: Unfreezing - New flight results detected");
      setFrozenFlights(null);
      setPicked(null);
      setSending(false);
      setSentOnce(false);
      setSendError(null);
    }
  }, [toolOutput, frozenFlights]);

  async function onSelectFlight(f, index) {
    if (sending) return;

    await blockNextFlightSearchOnServer();
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
      flightInfo.duration ? `- Duration: ${flightInfo.duration || "-"}` : null,
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

      {!flights.length && (
        <div className="fc-empty">Waiting for flight results…</div>
      )}

      {flights.length > 0 && (
        <div className="fc-scroll-container">
          {canScrollLeft && (
            <button
              className="fc-scroll-arrow fc-scroll-arrow--left"
              onClick={() => scroll("left")}
              aria-label="Scroll left"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          <div className="fc-scroll-wrapper" ref={scrollRef}>
            <div className="fc-list" aria-label="Flight results">
              {flights.map((f, idx) => (
                <FlightCard
                  key={f.id || idx}
                  f={f}
                  index={idx}
                  onSelect={onSelectFlight}
                  disabled={sending}
                />
              ))}
            </div>
          </div>

          {canScrollRight && (
            <button
              className="fc-scroll-arrow fc-scroll-arrow--right"
              onClick={() => scroll("right")}
              aria-label="Scroll right"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      )}

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
