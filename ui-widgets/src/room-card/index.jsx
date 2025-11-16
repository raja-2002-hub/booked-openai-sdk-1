// ui-widgets/src/room-card/index.jsx
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

/* -------------------- Helpers -------------------- */
function coerceRooms(output) {
  const src =
    (output && (output.rooms || output.rates || (output.data || {}).rates)) || [];
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

// "AUD 1,361.50" -> "1361.50"
function parseAmount(label) {
  if (!label) return null;
  const m = String(label).match(/^[A-Z]{3}\s*([\d.,]+)/);
  return m ? m[1].replace(/,/g, "") : null;
}

// "AUD 1,361.50" -> "AUD"
function parseCurrency(label, fallback = "AUD") {
  const m = String(label || "").match(/^([A-Z]{3})/);
  return m ? m[1].toUpperCase() : fallback;
}

// Always open Stripe in a NEW TAB from the user's click
function openInNewTab(url) {
  // Try programmatic new-tab first (counts as user gesture inside click handler)
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w && !w.closed) return;

  // Fallback for popup blockers: synthesize a user-gesture anchor and click it
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.position = "fixed";
  a.style.left = "-9999px";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

/* -------------------- MEDIA (Click-to-zoom rail) -------------------- */
function HoverZoomStrip({ photos = [] }) {
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!show) return;
    const onKey = (e) => { if (e.key === "Escape") setShow(false); };
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
      <div className={`rc-zoomrail__preview ${show ? "is-visible" : ""}`} aria-hidden={!show}>
        <img
          src={photos[idx]}
          alt=""
          loading="eager"
          referrerPolicy="no-referrer"
          onClick={() => setShow(false)}
        />
        <div className="rc-zoomrail__count">{idx + 1} / {photos.length}</div>
        <button className="rc-zoomrail__close" aria-label="Close" onClick={() => setShow(false)}>✕</button>
      </div>
      <div className="rc-zoomrail__scroller" role="list" aria-label="Room photos">
        {photos.map((p, i) => (
          <button
            key={i}
            role="listitem"
            className={`rc-zoomrail__thumb ${show && i === idx ? "is-active" : ""}`}
            onClick={() => { setIdx(i); setShow(true); }}
            aria-label={`Preview photo ${i + 1}`}
            title="Click to enlarge"
          >
            <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------- Primitives -------------------- */
function Chip({ children, kind = "neutral", title }) {
  return <span className={`rc-chip rc-chip--${kind}`} title={title}>{children}</span>;
}

/* -------------------- Room Card -------------------- */
function RoomCard({ r, onBookClick }) {
  const isRefundable = /refund|free|cancell/i.test(r.cancellation || "");
  return (
    <article className={`rc-card ${r.highlight ? "rc-card--highlight" : ""}`}>
      {r.highlight && <div className="rc-ribbon" aria-hidden="true">Best value</div>}

      <div className="rc-card__top">
        <div className="rc-title" title={r.name}>{r.name}</div>
        <div className="rc-price" aria-label="Price">
          <span className="rc-price__amt">{r.price || "—"}</span>
          {r.quantity != null && <span className="rc-price__qty">{r.quantity} left</span>}
        </div>
      </div>

      <HoverZoomStrip photos={r.photos} />

      <div className="rc-chips">
        {r.bed && <Chip kind="bed" title="Bed">{r.bed}</Chip>}
        {r.board && <Chip kind="board" title="Board type">{r.board}</Chip>}
        {r.cancellation && (
          <Chip kind={isRefundable ? "good" : "warn"} title="Cancellation policy">
            {r.cancellation}
          </Chip>
        )}
      </div>

      <div className="rc-cta">
        <button className="rc-btn rc-btn--ghost" type="button">View details</button>
        <button
          className="rc-btn rc-btn--primary"
          type="button"
          onClick={() => onBookClick(r)}
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
  const rooms = useMemo(() => coerceRooms(toolOutput || {}), [toolOutput]);
  const meta = (toolOutput && toolOutput.meta) || {};

  const railRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

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

  const scrollByOneCard = (dir) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.querySelector(".rc-card");
    const styles = getComputedStyle(el);
    const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const cardWidth = card ? card.getBoundingClientRect().width : el.clientWidth * 0.8;
    el.scrollBy({ left: (cardWidth + gap) * dir, behavior: "smooth" });
  };

  // Redirect-based checkout (Stripe-hosted) — opens in NEW TAB
  async function handleBookClick(rate) {
    // Prefer numeric values from server; otherwise parse from label
    const amount =
      rate.price_amount != null ? String(rate.price_amount) : parseAmount(rate.price) || "";
    const currency = rate.currency || parseCurrency(rate.price || "AUD");

    if (!amount || !currency) {
      alert("Missing price or currency for checkout.");
      return;
    }

    const email = window.openai?.userEmail || "";
    const desc = `${meta?.hotelName || "Hotel"} • ${rate.name || "Room"}`;

    const params = new URLSearchParams({
      amount,            // e.g. "1361.50"
      currency,          // e.g. "AUD"
      rate_id: rate.id,
      email,
      desc,
    });

    // IMPORTANT: use the MCP server's public base URL if the widget is sandboxed
    const base = (window.openai && window.openai.publicBaseUrl) || "http://localhost:8000";
    const url = `${String(base).replace(/\/+$/, "")}/checkout?${params.toString()}`;

    // NEW TAB navigation so the iframe/sandbox won't block it
    openInNewTab(url);
  }

  return (
    <div className="rc-wrap">
      {meta?.message && (
        <div className="rc-bubble">
          {meta.message.split("\n").map((l, i) => <div key={i}>{l}</div>)}
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
            <path d="M15.5 19 8.5 12l7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div ref={railRef} className="rc-scroll" aria-label="Room rate options">
          {rooms.map((r) => (<RoomCard key={r.id} r={r} onBookClick={handleBookClick} />))}
        </div>

        <button
          className="rc-nav rc-nav--right"
          aria-label="Scroll right"
          onClick={() => scrollByOneCard(1)}
          disabled={!canRight}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.5 5 15.5 12l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
    </div>
  );
}

/* Mount */
const mount = document.getElementById("room-card-root");
if (mount) createRoot(mount).render(<App />);
