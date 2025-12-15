// ui-widgets/src/hotel-card/index.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

/* -----------------------------------------
   Capabilities (diagnostics only)
------------------------------------------ */

function hostCaps() {
  const oa = window.openai;
  return {
    hasFollowUp: !!oa?.sendFollowUpMessage,
    hasAppend: !!oa?.appendUserMessage,
    hasSend: !!oa?.sendMessage,
  };
}

/* -------- send follow-up (same pattern as FlightCard) -------- */

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
      new CustomEvent("openai:append_user_message", { detail: { text: prompt } })
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

async function blockNextHotelSearchOnServer() {
  try {
    await fetch("http://localhost:8000/widget/hotel/block_next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (e) {
    console.warn("Failed to block next hotel search:", e);
  }
}

/* -----------------------------------------
   Helpers: SRR extraction + hotel mapping
------------------------------------------ */

function extractSrr(raw) {
  const candidates = [
    raw?.search_result_id,
    raw?.srr,
    raw?.hotel?.search_result_id,
    raw?.hotel?.srr,
    typeof raw?.id === "string" && raw.id.startsWith("srr_") ? raw.id : null,
    typeof raw?.hotel?.id === "string" && raw.hotel.id.startsWith("srr_")
      ? raw.hotel.id
      : null,
  ].filter(Boolean);
  const v = candidates[0];
  return typeof v === "string" && v.startsWith("srr_") ? v : "";
}

function mapHotels(output) {
  const src =
    (output && (output.hotels || output.results || output.stays)) ||
    (Array.isArray(output?.data) ? output.data : []);
  if (!Array.isArray(src)) return [];

  return src.map((it, i) => {
    const hotel = it.hotel || it;

    const price =
      typeof it.price === "string"
        ? it.price
        : it.price && it.price.amount && it.price.currency
        ? `${it.price.currency} ${Number(it.price.amount).toFixed(2)}`
        : "";

    const photo =
      it.photo ||
      it.image ||
      (Array.isArray(it.images) ? it.images[0]?.url || it.images[0] : "") ||
      (Array.isArray(hotel.photos) ? hotel.photos[0]?.url : "") ||
      "";

    const srr = extractSrr(it);

    const city =
      hotel.city ||
      it.city ||
      hotel?.location?.address?.city_name ||
      hotel?.location?.address?.line_one ||
      it.location ||
      "";

    return {
      id: hotel.id || it.id || `hotel_${i}`,
      name: hotel.name || it.name || "Hotel",
      city,
      rating:
        hotel.rating ??
        it.rating ??
        hotel.star_rating ??
        it.star_rating ??
        null,
      price,
      photo,
      amenities: it.amenities || hotel.amenities || [],
      highlight: !!it.highlight,
      srr,
      search_result_id: srr,
    };
  });
}

/* -----------------------------------------
   UI helpers (formatting)
------------------------------------------ */

const CURRENCY_SYMBOL = {
  USD: "$",
  AUD: "$",
  NZD: "$",
  CAD: "$",
  SGD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
};

function formatHotelPrice(priceStr) {
  if (!priceStr) return "—";
  const s = String(priceStr).trim();

  // "AUD 1095.14"
  const m = s.match(/^([A-Za-z]{3})\s*([0-9,]+(?:\.[0-9]+)?)$/);
  if (m) {
    const ccy = m[1].toUpperCase();
    const num = Number(String(m[2]).replace(/,/g, ""));
    if (!Number.isFinite(num)) return s;
    const sym = CURRENCY_SYMBOL[ccy] || `${ccy} `;
    const rounded = Math.round(num);
    return `${sym}${rounded.toLocaleString("en-US")}`;
  }

  // "$1095.14" or "1095.14"
  const num2 = Number(s.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(num2) && num2 > 0) {
    const rounded = Math.round(num2);
    // default to "$" for display like target
    return `$${rounded.toLocaleString("en-US")}`;
  }

  return s;
}

/* --------------- UI bits --------------- */

function StarBadge({ value }) {
  if (!value) return null;
  return (
    <div className="hc-rating" title={`${value} star rating`}>
      <span className="hc-rating-star" aria-hidden="true">
        ★
      </span>
      <span className="hc-rating-value">{value}</span>
    </div>
  );
}

function AmenityChips({ list }) {
  if (!list?.length) return null;
  const shown = list.slice(0, 2);
  const rest = Math.max(0, list.length - shown.length);
  return (
    <div className="hc-chips">
      {shown.map((a, i) => (
        <span key={i} className="hc-chip">
          {String(a)}
        </span>
      ))}
      {rest > 0 && (
        <span className="hc-chip hc-chip--more">+{rest} more</span>
      )}
    </div>
  );
}

function LocationRow({ city }) {
  return (
    <div className="hc-location">
      <svg
        className="hc-location-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="12"
          cy="10"
          r="2.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
      <span className="hc-location-text">{city || "Location"}</span>
    </div>
  );
}

function HotelCard({ h, onSelect }) {
  const disabled = !h.srr && !h.search_result_id;
  const displayPrice = formatHotelPrice(h.price);

  return (
    <button
      className={
        "hc-card " +
        (h.highlight ? "hc-card--highlight " : "") +
        (disabled ? "hc-card--disabled" : "")
      }
      onClick={() => !disabled && onSelect(h)}
      aria-disabled={disabled}
      title={disabled ? "No room rates available for this result" : h.name}
      type="button"
    >
      {h.photo ? (
        <img
          className="hc-img"
          src={h.photo}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="hc-img hc-img--placeholder" aria-hidden="true" />
      )}

      <div className="hc-body">
        <div className="hc-title-row">
          <div className="hc-title-block">
            <div className="hc-title" title={h.name}>
              {h.name}
            </div>
            <LocationRow city={h.city} />
          </div>
          <StarBadge value={h.rating} />
        </div>

        <AmenityChips list={h.amenities} />

        <div className="hc-footer-row">
          <div className="hc-price-block">
            <div className="hc-price">{displayPrice}</div>
            <div className="hc-price-sub">per night</div>
          </div>
          <span className="hc-select-pill">Select</span>
        </div>
      </div>
    </button>
  );
}

/* ----------- App ----------- */

function App() {
  const toolOutput = useOpenAiGlobal("toolOutput");

  const [frozenHotels, setFrozenHotels] = useState(null);

  const hotels = useMemo(() => {
    if (frozenHotels) return frozenHotels;
    return mapHotels(toolOutput || {});
  }, [toolOutput, frozenHotels]);

  const railRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const [picked, setPicked] = useState(null);
  const [sending, setSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const [sendError, setSendError] = useState(null);

  const caps = hostCaps();

  const updateNavState = () => {
    const el = railRef.current;
    if (!el) return;
    const maxLeft = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft < maxLeft - 1);
  };

  useEffect(() => {
    updateNavState();
    const el = railRef.current;
    if (!el) return;
    const onScroll = () => updateNavState();
    const onResize = () => updateNavState();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [hotels.length]);

  useEffect(() => {
    if (frozenHotels && toolOutput) {
      const newHotels = mapHotels(toolOutput);
      if (newHotels.length > 0) {
        const newIds = new Set(newHotels.map((h) => h.id));
        const oldIds = new Set(frozenHotels.map((h) => h.id));
        const isDifferent =
          newIds.size !== oldIds.size ||
          ![...newIds].every((id) => oldIds.has(id));
        if (isDifferent) {
          setFrozenHotels(null);
          setPicked(null);
          setSending(false);
          setSentOnce(false);
          setSendError(null);
        }
      }
    }
  }, [toolOutput, frozenHotels]);

  const scrollByOneCard = (dir) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.querySelector(".hc-card");
    const styles = getComputedStyle(el);
    const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const cardWidth = card
      ? card.getBoundingClientRect().width
      : el.clientWidth * 0.8;
    el.scrollBy({ left: (cardWidth + gap) * dir, behavior: "smooth" });
  };

  async function onSelectHotel(h) {
    await blockNextHotelSearchOnServer();
    setFrozenHotels(hotels);

    const srr = h.search_result_id || h.srr || "";

    const hotelInfo = {
      search_result_id: srr,
      hotel_id: h.id,
      hotel_name: h.name,
      location: h.city || "",
      rating: h.rating ?? null,
      price: h.price || "",
      amenities: h.amenities || [],
    };

    const promptLines = [
      "I have just clicked and selected this hotel in the hotels widget.",
      "",
      "Selected hotel details:",
      `- search_result_id: ${hotelInfo.search_result_id || "-"}`,
      `- hotel_id: ${hotelInfo.hotel_id || "-"}`,
      `- Hotel name: ${hotelInfo.hotel_name || "-"}`,
      `- Location: ${hotelInfo.location || "-"}`,
      `- Rating: ${hotelInfo.rating ?? "-"}`,
      `- Price: ${hotelInfo.price || "-"}`,
      hotelInfo.amenities.length
        ? `- Amenities: ${hotelInfo.amenities.join(", ")}`
        : null,
      "",
      "Please do the following:",
      '1. In your reply, say something like: "You have selected this hotel, I will show you the rooms available in this hotel now."',
      "2. Call the `select_hotel_result` tool using these same details (do NOT call `search_hotels_ui` again for this selection).",
      "3. Then call `fetch_hotel_rates_ui` with this search_result_id to show room options and prices for this hotel.",
      "4. After you show the rooms, ask me which room I want, then collect guest names, email and phone number.",
      "5. Use `start_hotel_checkout` to start payment once everything is confirmed.",
    ].filter(Boolean);

    const prompt = promptLines.join("\n");

    setPicked(hotelInfo);
    setSending(true);
    setSendError(null);

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

  return (
    <div className="hc-wrap">
      <div className="hc-rail">
        <button
          className="hc-nav hc-nav--left"
          aria-label="Scroll left"
          onClick={() => scrollByOneCard(-1)}
          disabled={!canLeft}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15.5 19 8.5 12l7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div ref={railRef} className="hc-scroll" aria-label="Hotel results">
          {hotels.map((h) => (
            <HotelCard key={h.id} h={h} onSelect={onSelectHotel} />
          ))}
        </div>

        <button
          className="hc-nav hc-nav--right"
          aria-label="Scroll right"
          onClick={() => scrollByOneCard(1)}
          disabled={!canRight}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8.5 5 15.5 12l-7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {!hotels.length && (
        <div className="hc-empty">Waiting for hotel results…</div>
      )}

      {picked && (
        <div
          className={
            "hc-bubble " +
            (sending ? "is-sending " : "") +
            (sentOnce ? "is-sent " : "")
          }
        >
          <div>
            <b>Selected hotel:</b>
          </div>
          <div>
            <b>Hotel Name:</b> {picked.hotel_name}
          </div>
          <div>
            <b>Location:</b> {picked.location || "-"}
          </div>
          <div>
            <b>Rating:</b> {picked.rating ?? "-"} stars
          </div>
          <div>
            <b>Price:</b> {picked.price || "-"}
          </div>
          {picked.amenities?.length ? (
            <div>
              <b>Amenities:</b> {picked.amenities.join(", ")}
            </div>
          ) : null}
          <div>
            <b>search_result_id:</b> {picked.search_result_id || "—"}
          </div>
          <div className="hc-bubble-cta">
            {sending
              ? "Sending selection…"
              : sentOnce
              ? "Selection sent ✓"
              : "Ready to send selection"}
          </div>
          {sendError && <div className="hc-error">{sendError}</div>}
        </div>
      )}

      <div className="hc-diagnostics" aria-hidden="true">
        caps:
        {caps.hasFollowUp ? " sendFollowUpMessage" : ""}
        {caps.hasAppend ? " appendUserMessage" : ""}
        {caps.hasSend ? " sendMessage" : ""}
        {!caps.hasFollowUp && !caps.hasAppend && !caps.hasSend ? " none" : ""}
        {frozenHotels ? " [FROZEN]" : ""}
      </div>
    </div>
  );
}

const mount = document.getElementById("hotel-card-root");
if (mount) {
  const root = createRoot(mount);
  root.render(<App />);
}
