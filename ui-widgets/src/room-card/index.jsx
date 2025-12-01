// ui-widgets/src/room-card/index.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

/* -------------------- OpenAI widget globals -------------------- */
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

/* -------------------- Capabilities (diagnostics) -------------------- */
function hostCaps() {
  const oa = window.openai;
  return {
    hasFollowUp: !!oa?.sendFollowUpMessage,
    hasAppendUser: !!oa?.appendUserMessage,
    hasSendMessage: !!oa?.sendMessage,
  };
}

/* -------------------- sendFollowUp (with error bubbling) -------------------- */
async function sendFollowUpMessage(prompt) {
  const oa = window.openai;
  let lastError = null;

  // 1) Preferred: sendFollowUpMessage
  try {
    if (oa?.sendFollowUpMessage) {
      await oa.sendFollowUpMessage({ prompt });
      return;
    }
  } catch (e) {
    console.warn("sendFollowUpMessage failed", e);
    lastError = e;
  }

  // 2) Fallback: appendUserMessage
  try {
    if (oa?.appendUserMessage) {
      await oa.appendUserMessage(prompt);
      return;
    }
  } catch (e) {
    console.warn("appendUserMessage failed", e);
    lastError = e;
  }

  // 3) Fallback: sendMessage
  try {
    if (oa?.sendMessage) {
      await oa.sendMessage({ role: "user", content: prompt });
      return;
    }
  } catch (e) {
    console.warn("sendMessage failed", e);
    lastError = e;
  }

  // 4) Dev fallbacks (outside of ChatGPT)
  try {
    window.dispatchEvent(
      new CustomEvent("openai:append_user_message", { detail: { text: prompt } })
    );
    return;
  } catch (e) {
    console.warn("dispatchEvent fallback failed", e);
    lastError = e;
  }

  try {
    window.parent?.postMessage(
      { type: "openai:append_user_message", text: prompt },
      "*"
    );
    return;
  } catch (e) {
    console.warn("postMessage fallback failed", e);
    lastError = e;
  }

  console.log("[fallback] would send follow-up message:", prompt);

  if (lastError) {
    throw lastError;
  }
}

/* -------------------- One-shot server block for next fetch_hotel_rates_ui -------------------- */
async function blockNextRoomRatesOnServer() {
  try {
    await fetch("http://localhost:8000/widget/room/block_next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (e) {
    console.warn("Failed to block next room rates fetch:", e);
  }
}

/* -------------------- Helpers -------------------- */
function coerceRooms(output) {
  const src =
    (output && (output.rooms || output.rates || (output.data || {}).rates)) ||
    [];
  if (!Array.isArray(src)) return [];
  return src.map((r, i) => ({
    id: r.id || `rat_${i}`,
    name: r.name || r.room_name || r.room_type || `Room ${i + 1}`,
    price: r.price || "",
    price_amount: r.price_amount ?? null,
    currency: r.currency || null,
    bed: r.bed || "",
    board: r.board || "",
    cancellation: r.cancellation || "",
    quantity: r.quantity ?? null,
    photos: Array.isArray(r.photos) ? r.photos : [],
    highlight: !!r.highlight,
  }));
}

/* -------------------- MEDIA (Click-to-zoom rail) -------------------- */
function HoverZoomStrip({ photos = [] }) {
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!show) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!photos.length) return null;

  return (
    <div className="rc-zoomrail">
      <button
        className={`rc-zoomrail__backdrop ${show ? "is-visible" : ""}`}
        aria-hidden={!show}
        tabIndex={-1}
        onClick={() => setShow(false)}
      />
      <div
        className={`rc-zoomrail__preview ${show ? "is-visible" : ""}`}
        aria-hidden={!show}
      >
        <img
          src={photos[idx]}
          alt=""
          loading="eager"
          referrerPolicy="no-referrer"
          onClick={() => setShow(false)}
        />
        <div className="rc-zoomrail__count">
          {idx + 1} / {photos.length}
        </div>
        <button
          className="rc-zoomrail__close"
          aria-label="Close"
          onClick={() => setShow(false)}
        >
          ✕
        </button>
      </div>
      <div
        className="rc-zoomrail__scroller"
        role="list"
        aria-label="Room photos"
      >
        {photos.map((p, i) => (
          <button
            key={i}
            role="listitem"
            className={`rc-zoomrail__thumb ${
              show && i === idx ? "is-active" : ""
            }`}
            onClick={() => {
              setIdx(i);
              setShow(true);
            }}
            aria-label={`Preview photo ${i + 1}`}
            title="Click to enlarge"
          >
            <img
              src={p}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------- Primitives -------------------- */
function Chip({ children, kind = "neutral", title }) {
  return (
    <span className={`rc-chip rc-chip--${kind}`} title={title}>
      {children}
    </span>
  );
}

/* -------------------- Room Card -------------------- */
/**
 * UI: card-style, similar to hotel card.
 * Behaviour:
 *  - clicking anywhere on the card calls onBookClick(r)
 *  - clicking the "booking with Stripe" button also calls onBookClick(r)
 */
function RoomCard({ r, onBookClick, disabled }) {
  const isRefundable = /refund|free|cancell/i.test(r.cancellation || "");

  const handleCardClick = () => {
    if (disabled) return;
    onBookClick(r);
  };

  const handlePrimaryClick = (e) => {
    e.stopPropagation(); // avoid double-trigger (card + button)
    if (disabled) return;
    onBookClick(r);
  };

  return (
    <article
      className={`rc-card ${r.highlight ? "rc-card--highlight" : ""} ${
        disabled ? "rc-card--disabled" : ""
      }`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      title={disabled ? "Selection already sent" : "Select this room"}
    >
      {r.highlight && (
        <div className="rc-ribbon" aria-hidden="true">
          Best value
        </div>
      )}

      <div className="rc-card__top">
        <div className="rc-title" title={r.name}>
          {r.name}
        </div>
        <div className="rc-price" aria-label="Price">
          <span className="rc-price__amt">{r.price || "—"}</span>
          {r.quantity != null && (
            <span className="rc-price__qty">{r.quantity} left</span>
          )}
        </div>
      </div>

      {/* Media rail – visually similar to a rich image area like the hotel card hero */}
      <HoverZoomStrip photos={r.photos} />

      <div className="rc-chips">
        {r.bed && (
          <Chip kind="bed" title="Bed">
            {r.bed}
          </Chip>
        )}
        {r.board && (
          <Chip kind="board" title="Board type">
            {r.board}
          </Chip>
        )}
        {r.cancellation && (
          <Chip
            kind={isRefundable ? "good" : "warn"}
            title="Cancellation policy"
          >
            {r.cancellation}
          </Chip>
        )}
      </div>

      <div className="rc-cta">
        <button
          className="rc-btn rc-btn--ghost"
          type="button"
          disabled={disabled}
        >
          View details
        </button>
        <button
          className="rc-btn rc-btn--primary"
          type="button"
          onClick={handlePrimaryClick}
          disabled={disabled}
        >
          booking with Stripe
        </button>
      </div>
    </article>
  );
}

/* -------------------- Shell -------------------- */
function App() {
  const toolOutput = useOpenAiGlobal("toolOutput");

  // 🔹 Freeze rooms after selection (like frozenFlights in FlightCard)
  const [frozenRooms, setFrozenRooms] = useState(null);

  const rooms = useMemo(() => {
    if (frozenRooms) return frozenRooms;
    return coerceRooms(toolOutput || {});
  }, [toolOutput, frozenRooms]);

  const meta = (toolOutput && toolOutput.meta) || {};

  const hotelName = meta.hotelName || "Hotel";
  const hotelLocation = meta.location || "";
  const srr =
    meta.search_result_id ||
    meta.srr ||
    meta.searchResultId ||
    meta.srr_id ||
    "";

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
  }, [rooms.length]);

  // 🔹 Reset frozen state when we get a *completely new* set of rooms (different IDs)
  useEffect(() => {
    if (frozenRooms && toolOutput) {
      const newRooms = coerceRooms(toolOutput || {});
      if (newRooms.length > 0) {
        const newIds = new Set(newRooms.map((r) => r.id));
        const oldIds = new Set(frozenRooms.map((r) => r.id));
        const isDifferent =
          newIds.size !== oldIds.size ||
          [...newIds].some((id) => !oldIds.has(id));

        if (isDifferent) {
          setFrozenRooms(null);
          setPicked(null);
          setSending(false);
          setSentOnce(false);
          setSendError(null);
        }
      }
    }
  }, [toolOutput, frozenRooms]);

  const scrollByOneCard = (dir) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.querySelector(".rc-card");
    const styles = getComputedStyle(el);
    const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const cardWidth = card
      ? card.getBoundingClientRect().width
      : el.clientWidth * 0.8;
    el.scrollBy({ left: (cardWidth + gap) * dir, behavior: "smooth" });
  };

  // Click handler: send follow-up to ChatGPT, similar to FlightCard
  async function handleBookClick(rate) {
    // prevent double-click spam
    if (sending || sentOnce) return;

    const roomInfo = {
      rate_id: rate.id,
      room_name: rate.name,
      price_label: rate.price || "",
      price_amount: rate.price_amount,
      currency: rate.currency,
      bed: rate.bed || "",
      board: rate.board || "",
      cancellation: rate.cancellation || "",
      quantity: rate.quantity,
      hotel_name: hotelName,
      hotel_location: hotelLocation,
      search_result_id: srr,
    };

      const promptLines = [
    "I just selected this specific room in the RoomCard widget and I want to book it.",
    "",
    "Selected room / hotel details:",
    `- Hotel name: ${roomInfo.hotel_name || "-"}`,
    `- Location: ${roomInfo.hotel_location || "-"}`,
    `- Room name: ${roomInfo.room_name || "-"}`,
    `- Rate ID (rate_id): ${roomInfo.rate_id || "-"}`,
    `- Price: ${roomInfo.price_label || "-"}`,
    roomInfo.bed ? `- Bed: ${roomInfo.bed}` : null,
    roomInfo.board ? `- Board: ${roomInfo.board}` : null,
    roomInfo.cancellation
      ? `- Cancellation: ${roomInfo.cancellation}`
      : null,
    roomInfo.search_result_id
      ? `- search_result_id: ${roomInfo.search_result_id}`
      : null,
    "",
    "Please do the following, step by step:",
    "",
    "1) First, call the `select_hotel_room_rate` tool with exactly this payload:",
    "```json",
    JSON.stringify(
      {
        rate_id: roomInfo.rate_id,
        hotel_name: roomInfo.hotel_name,
        hotel_location: roomInfo.hotel_location,
        room_name: roomInfo.room_name,
        search_result_id: roomInfo.search_result_id,
        price_label: roomInfo.price_label,
        price_amount: roomInfo.price_amount,
        currency: roomInfo.currency,
        bed: roomInfo.bed,
        board: roomInfo.board,
        cancellation: roomInfo.cancellation,
        quantity: roomInfo.quantity,
      },
      null,
      2
    ),
    "```",
    "",
    "2) After `select_hotel_room_rate` succeeds, in your reply confirm my selection in natural language and ask me for:",
    "   - Guest names (given_name and family_name for each guest)",
    "   - Contact email",
    "   - Contact phone number",
    "   - Any special requests for the stay",
    "",
    "3) Once you have these details from me, call the `start_hotel_checkout` tool with:",
    `   - rate_id: ${roomInfo.rate_id || "(this room's rate_id)"}`,
    `   - search_result_id: ${roomInfo.search_result_id || "(if available)"}`,
    `   - hotel_name: ${roomInfo.hotel_name || "Hotel"}`,
    `   - room_name: ${roomInfo.room_name || "Room"}`,
    "   - guests: the guest objects you collected (with given_name and family_name)",
    "   - email: the email I provided",
    "   - phone_number: the phone number I provided",
    "   - stay_special_requests: whatever special requests I provided (if any)",
    "",
    "4) After `start_hotel_checkout` returns, give me the Stripe Checkout link so I can finish payment in the browser.",
  ].filter(Boolean);

    const prompt = promptLines.join("\n");

    // 🔹 Freeze the current rooms list BEFORE sending anything
    setFrozenRooms(rooms);

    setPicked(roomInfo);
    setSending(true);
    setSendError(null);

    try {
      // Tell backend to block the *next* fetch_hotel_rates_ui, so the model
      // doesn’t immediately re-call it for this same selection.
      await blockNextRoomRatesOnServer();

      await sendFollowUpMessage(prompt);
      setSentOnce(true);
    } catch (e) {
      console.error("Error sending follow-up message", e);
      setSendError("Could not notify the assistant about this room selection.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rc-wrap">
      {meta?.message && (
        <div className="rc-bubble">
          {meta.message.split("\n").map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <div className="rc-rail">
        <button
          className="rc-nav rc-nav--left"
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

        <div
          ref={railRef}
          className="rc-scroll"
          aria-label="Room rate options"
        >
          {rooms.map((r) => (
            <RoomCard
              key={r.id}
              r={r}
              onBookClick={handleBookClick}
              disabled={sending || sentOnce}
            />
          ))}
        </div>

        <button
          className="rc-nav rc-nav--right"
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

      {!rooms.length && (
        <div className="rc-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rc-skeleton__card">
              <div className="rc-skeleton__media" />
              <div className="rc-skeleton__line" />
              <div className="rc-skeleton__line rc-skeleton__line--short" />
            </div>
          ))}
        </div>
      )}

      {picked && (
        <div
          className={
            "rc-select-bubble " +
            (sending ? "is-sending " : "") +
            (sentOnce ? "is-sent " : "")
          }
        >
          <div>
            <b>Selected room:</b>
          </div>
          <div>
            <b>Hotel:</b> {picked.hotel_name || "-"}
          </div>
          <div>
            <b>Location:</b> {picked.hotel_location || "-"}
          </div>
          <div>
            <b>Room:</b> {picked.room_name || "-"}
          </div>
          <div>
            <b>Rate ID:</b> {picked.rate_id || "-"}
          </div>
          <div>
            <b>Price:</b> {picked.price_label || "-"}
          </div>
          {picked.cancellation && (
            <div>
              <b>Cancellation:</b> {picked.cancellation}
            </div>
          )}
          {picked.search_result_id && (
            <div>
              <b>search_result_id:</b> {picked.search_result_id}
            </div>
          )}
          <div className="rc-select-bubble__cta">
            {sending
              ? "Sending selection…"
              : sentOnce
              ? "Selection sent ✓"
              : "Ready to send selection"}
          </div>
          {sendError && <div className="rc-error">{sendError}</div>}
        </div>
      )}

      {/* Diagnostics badge (dev only) */}
      <div className="rc-diagnostics" aria-hidden="true">
        caps:
        {caps.hasFollowUp ? " sendFollowUpMessage" : ""}
        {caps.hasAppendUser ? " appendUserMessage" : ""}
        {caps.hasSendMessage ? " sendMessage" : ""}
        {!caps.hasFollowUp && !caps.hasAppendUser && !caps.hasSendMessage
          ? " none"
          : ""}
        {frozenRooms ? " [FROZEN]" : ""}
      </div>
    </div>
  );
}

/* Mount */
const mount = document.getElementById("room-card-root");
if (mount) createRoot(mount).render(<App />);
