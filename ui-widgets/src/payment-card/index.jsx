// ui-widgets/src/payment-card/index.jsx
import React, {
  useEffect,
  useMemo,
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
   Capabilities + follow-up helpers
------------------------------------------ */

function hostCaps() {
  const oa = window.openai;
  return {
    hasFollowUp: !!oa?.sendFollowUpMessage,
    hasAppend: !!oa?.appendUserMessage,
    hasSend: !!oa?.sendMessage,
    hasCallTool: !!oa?.callTool,
  };
}

async function sendFollowUpMessage(prompt) {
  const oa = window.openai;

  // 1) Preferred: sendFollowUpMessage
  try {
    if (oa?.sendFollowUpMessage) {
      await oa.sendFollowUpMessage({ prompt });
      return;
    }
  } catch (e) {
    console.warn("payment-card: sendFollowUpMessage failed", e);
  }

  // 2) Fallback: appendUserMessage
  try {
    if (oa?.appendUserMessage) {
      await oa.appendUserMessage(prompt);
      return;
    }
  } catch (e) {
    console.warn("payment-card: appendUserMessage failed", e);
  }

  // 3) Fallback: sendMessage
  try {
    if (oa?.sendMessage) {
      await oa.sendMessage({ role: "user", content: prompt });
      return;
    }
  } catch (e) {
    console.warn("payment-card: sendMessage failed", e);
  }

  // 4) Dev fallbacks (local demo / playground)
  try {
    window.dispatchEvent(
      new CustomEvent("openai:append_user_message", { detail: { text: prompt } })
    );
    return;
  } catch (e) {
    console.warn("payment-card: dispatchEvent fallback failed", e);
  }

  try {
    window.parent?.postMessage(
      { type: "openai:append_user_message", text: prompt },
      "*"
    );
  } catch (e) {
    console.warn("payment-card: postMessage fallback failed", e);
  }

  console.log("[payment-card fallback] would send follow-up message:", prompt);
}

/* -----------------------------------------
   Direct tool call helper (kept for future)
------------------------------------------ */

async function callToolDirectly(toolName, args) {
  try {
    if (window.openai?.callTool) {
      console.log(`🔧 Calling tool directly: ${toolName}`, args);
      const result = await window.openai.callTool(toolName, args);
      console.log(`✅ Tool ${toolName} called successfully:`, result);
      return { success: true, result };
    }
  } catch (e) {
    console.warn(`callTool (${toolName}) failed:`, e);
    return { success: false, error: e };
  }

  return { success: false, error: new Error("callTool not available") };
}

/* -----------------------------------------
   Backend helper: one-shot block flags
------------------------------------------ */

async function blockNextHotelCheckoutOnServer(ctxId) {
  try {
    await fetch("http://localhost:8000/widget/hotel_checkout/block_next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // backend ignores body, but ctx_id is useful for logs/debug
      body: JSON.stringify({ ctx_id: ctxId || "" }),
    });
    console.log(
      "payment-card: notified backend to block the next start_hotel_checkout"
    );
  } catch (e) {
    console.warn(
      "payment-card: failed to notify backend block_next_hotel_checkout",
      e
    );
  }
}

// 🔹 NEW: same idea, but for flight checkout flows
async function blockNextFlightCheckoutOnServer(ctxId) {
  try {
    await fetch("http://localhost:8000/widget/flight_checkout/block_next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ctx_id: ctxId || "" }),
    });
    console.log(
      "payment-card: notified backend to block the next start_flight_checkout"
    );
  } catch (e) {
    console.warn(
      "payment-card: failed to notify backend block_next_flight_checkout",
      e
    );
  }
}

/* ----------- Helpers ----------- */

function normalizeToolOutput(raw) {
  if (!raw || typeof raw !== "object") return {};

  const status = raw.status || {};
  const payment = raw.payment || {};

  return {
    status: status.status || "pending",
    type: status.type || raw.type || "hotel",
    ctx_id: status.ctx_id || payment.ctx_id || raw.ctx_id || "",
    rawStatus: status,
    rawPayment: payment,
    raw,
  };
}

/* ----------- App ----------- */

function App() {
  const toolOutput = useOpenAiGlobal("toolOutput");

  const initial = useMemo(
    () => normalizeToolOutput(toolOutput || {}),
    [toolOutput]
  );

  const [status, setStatus] = useState(initial.status || "pending");
  const [kind, setKind] = useState(initial.type || "hotel");
  const [ctxId, setCtxId] = useState(initial.ctx_id || "");
  const [details, setDetails] = useState(initial.rawStatus || {});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!initial.status);

  // Dialog + follow-up state
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmSending, setConfirmSending] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const caps = hostCaps();

  // Keep original payment payload around for checkout URL
  const initialPayment = initial.rawPayment || {};
  const checkoutUrl =
    initialPayment.stripe_checkout_url || details.stripe_checkout_url || "";

  // Sync when toolOutput changes (e.g. brand-new checkout ctx)
  useEffect(() => {
    const norm = normalizeToolOutput(toolOutput || {});
    setStatus(norm.status || "pending");
    setKind(norm.type || "hotel");
    setCtxId(norm.ctx_id || "");
    setDetails(norm.rawStatus || {});
    setError(null);
    setLoading(!norm.status);

    // reset confirm state for a fresh checkout
    setConfirmDialogOpen(false);
    setConfirmSending(false);
    setConfirmSent(false);
    setConfirmError(null);
  }, [toolOutput]);

  // Poll backend /widget/checkout/status?ctx_id=...
  useEffect(() => {
    if (!ctxId) return;

    let cancelled = false;
    let timerId = null;

    async function fetchOnce() {
      if (cancelled) return;
      try {
        setLoading(true);
        const res = await fetch(
          `http://localhost:8000/widget/checkout/status?ctx_id=${encodeURIComponent(
            ctxId
          )}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (cancelled) return;

        setDetails(json);
        setStatus(json.status || "unknown");
        setKind(json.type || kind);
        setError(null);
        setLoading(false);

        // Stop polling once paid
        if (json.status === "paid" && timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("payment-card: status fetch failed", e);
        setError("Could not fetch payment status.");
        setLoading(false);
      }
    }

    // Initial fetch
    fetchOnce();

    // Poll every 3s until paid or unmounted
    timerId = setInterval(fetchOnce, 3000);

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
  }, [ctxId, kind]);

  // When payment is PAID, open the confirm dialog (modal)
  useEffect(() => {
    if (ctxId && status === "paid" && !confirmSent) {
      setConfirmDialogOpen(true);
    } else if (status !== "paid") {
      // if status goes away from paid, close
      setConfirmDialogOpen(false);
    }
  }, [status, ctxId, confirmSent]);

  // Derived flags
  const isPaid = status === "paid";
  const isPending = status === "pending";
  const isErrorStatus = status === "error";
  const isUnknown = !isPaid && !isPending && !isErrorStatus;

  const amount =
    typeof details.amount === "number" ? details.amount.toFixed(2) : null;
  const currency = details.currency || details.ccy;
  const receiptUrl = details.receipt_url;
  const booking = details.booking;
  const email =
    details.email ||
    details.customer_email ||
    (booking?.data && (booking.data.email || booking.data.contact_email));

  function handleCheckoutClick() {
    if (!checkoutUrl) return;
    try {
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    } catch {
      window.location.href = checkoutUrl;
    }
  }

  // CLICK HANDLER: user confirms booking in the dialog (popup)
  async function handleConfirmClick() {
    if (!ctxId) return;
    setConfirmSending(true);
    setConfirmError(null);

    try {
      // 🔹 Tell the backend to block the *next* start_*_checkout call
      if (kind === "hotel") {
        await blockNextHotelCheckoutOnServer(ctxId);
      } else if (kind === "flight") {
        await blockNextFlightCheckoutOnServer(ctxId);
      }

      const b = booking || {};
      const bData = b.data || b;

      const bookingRef =
        bData.booking_reference || bData.reference || bData.id || "";
      const hotelName =
        details.hotel_name ||
        bData.hotel_name ||
        (bData.accommodation && bData.accommodation.name) ||
        "";
      const roomName =
        details.room_name || bData.room_name || bData.room_type || "";
      const typeLabel = kind === "flight" ? "flight" : "hotel";

      const promptLines = [
        `I have completed the ${typeLabel} payment using the payment widget and clicked the "Confirm booking" button in the popup dialog.`,
        "",
        "Please confirm my booking now using the checkout context ID below.",
        "",
        "Checkout / booking details:",
        `- Context ID: ${ctxId}`,
        `- Type: ${typeLabel}`,
        amount && currency ? `- Amount paid: ${currency} ${amount}` : null,
        bookingRef ? `- Booking reference: ${bookingRef}` : null,
        hotelName ? `- Hotel: ${hotelName}` : null,
        roomName ? `- Room: ${roomName}` : null,
        email ? `- Email: ${email}` : null,
        "",
        "What you should do:",
        `1. Call the tool "confirm_booking_from_ctx" with this parameter: {"ctx_id": "${ctxId}"}.`,
        "2. Use the tool result to confirm my booking in your reply.",
        "3. Then send a short final message thanking me and saying the booking is confirmed.",
        `4. Do NOT start a new checkout or search for new ${typeLabel}s for this same booking.`,
      ].filter(Boolean);

      const prompt = promptLines.join("\n");
      console.log("📤 Sending confirm-booking follow-up:", prompt);
      await sendFollowUpMessage(prompt);

      setConfirmSent(true);
      setConfirmDialogOpen(false);
    } catch (e) {
      console.error("payment-card: failed to send confirm prompt", e);
      setConfirmError(
        "Payment received, but I couldn't notify the assistant automatically. Please say in the chat: “Confirm my booking for context ID " +
          ctxId +
          "”."
      );
    } finally {
      setConfirmSending(false);
    }
  }

  function handleDialogClose() {
    if (confirmSending) return;
    setConfirmDialogOpen(false);
  }

  return (
    <div className="pc-wrap">
      <div className="pc-card">
        <div className="pc-header">
          <div className="pc-title">
            {kind === "flight" ? "✈️ Flight payment" : "🏨 Hotel payment"}
          </div>
          <div className={`pc-status pc-status--${status || "unknown"}`}>
            {isPaid && "✅ Paid"}
            {isPending && "⏳ Waiting for payment"}
            {isErrorStatus && "❌ Error"}
            {isUnknown && `Status: ${status || "unknown"}`}
          </div>
        </div>

        <div className="pc-body">
          <div className="pc-row">
            <span className="pc-label">Checkout ID:</span>
            <span className="pc-value pc-value--mono">
              {ctxId || "—"}
            </span>
          </div>

          {/* Checkout button (only before paid and when we have a URL) */}
          {checkoutUrl && !isPaid && (
            <div className="pc-row pc-row--action">
              <button
                type="button"
                className="pc-btn pc-btn--primary"
                onClick={handleCheckoutClick}
              >
                🔒 Open secure checkout
              </button>
              <div className="pc-hint">Opens Stripe in a new tab</div>
            </div>
          )}

          {loading && (
            <div className="pc-row pc-row--info">
              <span className="pc-spinner" aria-hidden="true" />
              <span>Checking payment status…</span>
            </div>
          )}

          {error && (
            <div className="pc-row pc-row--error">{error}</div>
          )}

          {isPending && !loading && !error && (
            <div className="pc-row pc-row--info">
              <span className="pc-spinner" aria-hidden="true" />
              <span>
                Please complete the Stripe checkout in the other tab. This card
                will update automatically once payment is confirmed.
              </span>
            </div>
          )}

          {isPaid && (
            <>
              {amount && currency && (
                <div className="pc-row">
                  <span className="pc-label">💰 Paid amount:</span>
                  <span className="pc-value">
                    {currency} {amount}
                  </span>
                </div>
              )}

              {booking && (
                <div className="pc-row">
                  <span className="pc-label">📋 Booking reference:</span>
                  <span className="pc-value">
                    {booking.data?.id ||
                      booking.booking_reference ||
                      booking.id ||
                      "Confirmed"}
                  </span>
                </div>
              )}

              {email && (
                <div className="pc-row">
                  <span className="pc-label">📧 Confirmation sent to:</span>
                  <span className="pc-value">{email}</span>
                </div>
              )}

              {receiptUrl && (
                <div className="pc-row">
                  <a
                    href={receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pc-link"
                  >
                    🧾 View Stripe receipt
                  </a>
                </div>
              )}

              <div className="pc-row pc-row--success">
                ✅ Payment confirmed! Your{" "}
                {kind === "flight" ? "flight" : "hotel"} booking is complete.
              </div>

              {confirmSent && !confirmError && (
                <div className="pc-row pc-row--info">
                  🤖 I’ve notified the assistant to confirm your booking and send
                  a final thank-you message.
                </div>
              )}

              {confirmError && (
                <div className="pc-row pc-row--warning">
                  ℹ️ {confirmError}
                </div>
              )}
            </>
          )}

          {isUnknown && !loading && !error && (
            <div className="pc-row pc-row--info">
              Status is unknown. If you just paid, wait a few seconds and it
              should update automatically.
            </div>
          )}
        </div>

        {/* Diagnostics (dev only) */}
        <div className="pc-footer" aria-hidden="true">
          <span className="pc-brand">BookedAI</span>
          <span className="pc-diag">
            caps:
            {caps.hasCallTool ? " callTool" : ""}
            {caps.hasFollowUp ? " followUp" : ""}
            {caps.hasAppend ? " append" : ""}
            {caps.hasSend ? " send" : ""}
            {confirmSent ? " [CONFIRM_SENT]" : ""}
          </span>
        </div>
      </div>

      {/* 🔔 Modal dialog that pops up when status becomes PAID */}
      {isPaid && confirmDialogOpen && !confirmSent && (
        <div className="pc-modal-backdrop">
          <div className="pc-modal" role="dialog" aria-modal="true">
            <div className="pc-modal-title">Payment completed</div>
            <div className="pc-modal-body">
              <p>
                Your {kind === "flight" ? "flight" : "hotel"} payment has been
                confirmed.
              </p>
              <p>
                Do you want me to notify the assistant now so it can confirm
                your booking and send a final thank-you message?
              </p>
              {amount && currency && (
                <p className="pc-modal-summary">
                  <strong>
                    {currency} {amount}
                  </strong>{" "}
                  · ctx_id <code>{ctxId}</code>
                </p>
              )}
            </div>
            <div className="pc-modal-actions">
              <button
                type="button"
                className="pc-btn pc-btn--primary"
                onClick={handleConfirmClick}
                disabled={confirmSending}
              >
                {confirmSending ? "Confirming…" : "Confirm booking"}
              </button>
              <button
                type="button"
                className="pc-btn pc-btn--ghost"
                onClick={handleDialogClose}
                disabled={confirmSending}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const mount = document.getElementById("payment-card-root");
if (mount) {
  const root = createRoot(mount);
  root.render(<App />);
}
