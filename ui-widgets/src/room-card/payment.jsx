// room-card/payment.jsx
import React, { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
    Elements,
    CardNumberElement,
    CardExpiryElement,
    CardCvcElement,
    useStripe,
    useElements
} from "@stripe/react-stripe-js";

function getGlobal(key) {
    try { return window.openai?.[key]; } catch { return undefined; }
}

const stripePromiseCache = {};
function getStripePromise(pk) {
    if (!pk) return null;
    if (!stripePromiseCache[pk]) stripePromiseCache[pk] = loadStripe(pk);
    return stripePromiseCache[pk];
}

function InnerPaymentForm({ spec, ctx, onClose, onSuccess }) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const title = spec?.title || "Complete Payment";
    const amount = spec?.amount;
    const currency = spec?.currency;

    async function submit(e) {
        e.preventDefault();
        setErr("");
        if (!stripe || !elements) return;

        setBusy(true);
        try {
            const cardNumber = elements.getElement(CardNumberElement);
            if (!cardNumber) throw new Error("Payment form not ready.");

            // 1) Create a PaymentMethod on the client
            const { paymentMethod, error } = await stripe.createPaymentMethod({
                type: "card",
                card: cardNumber,
                billing_details: {
                    name: ctx.cardholderName || ctx.email || "Guest",
                    email: ctx.email || undefined,
                },
            });
            if (error) throw error;
            if (!paymentMethod?.id) throw new Error("Failed to create payment method.");

            // 2) Ask MCP to complete payment + booking (SECOND CALL: with payment_method)
            const res2 = await window.mcp.callTool("hotel_payment_sequence_ui", {
                rate_id: ctx.rate_id,
                guests: ctx.guests,
                email: ctx.email,
                phone_number: ctx.phone_number || "",
                stay_special_requests: ctx.stay_special_requests || "",
                payment_method: {
                    stripe_payment_method_id: paymentMethod.id
                }
            });

            const payload = res2?.structuredContent || {};
            if (payload.error) throw new Error(payload.error);

            // Optional: handle SCA if your server returns requires_action & client_secret
            if (payload.requires_action && payload.client_secret) {
                const conf = await stripe.confirmCardPayment(payload.client_secret);
                if (conf.error) throw conf.error;
                // You may call the tool again to finalize if your server uses a two-step confirm path.
            }

            onSuccess?.(payload);
        } catch (e) {
            setErr(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="paym-modal">
            <div className="paym-overlay" onClick={busy ? undefined : onClose} />
            <div className="paym-dialog" role="dialog" aria-modal="true" aria-labelledby="paym-title">
                <div className="paym-head">
                    <div id="paym-title" className="paym-title">{title}</div>
                    <button className="paym-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
                </div>

                <div className="paym-amount">
                    {currency ? `${currency} ` : ""}{amount ?? ""}
                </div>

                <form className="paym-form" onSubmit={submit}>
                    <label className="paym-field">
                        <span>Card number</span>
                        <div className="paym-input"><CardNumberElement options={{ showIcon: true }} /></div>
                    </label>

                    <div className="paym-row">
                        <label className="paym-field">
                            <span>Expiry</span>
                            <div className="paym-input"><CardExpiryElement /></div>
                        </label>
                        <label className="paym-field">
                            <span>CVC</span>
                            <div className="paym-input"><CardCvcElement /></div>
                        </label>
                    </div>

                    {err ? <div className="paym-error" role="alert">{err}</div> : null}

                    <button className="paym-pay" type="submit" disabled={!stripe || busy}>
                        {busy ? "Processing…" : "Pay"}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function PaymentModal({ spec, ctx, onClose, onSuccess }) {
    const pk = ctx?.stripePublishableKey || getGlobal("stripePublishableKey");
    const stripePromise = useMemo(() => getStripePromise(pk), [pk]);

    if (!pk) {
        return (
            <div className="paym-modal">
                <div className="paym-overlay" onClick={onClose} />
                <div className="paym-dialog">
                    <div className="paym-head">
                        <div className="paym-title">Payment unavailable</div>
                        <button className="paym-x" onClick={onClose}>×</button>
                    </div>
                    <div style={{ padding: 8 }}>
                        Missing Stripe publishable key. Supply <code>window.openai.stripePublishableKey</code> or pass <code>ctx.stripePublishableKey</code>.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Elements stripe={stripePromise}>
            <InnerPaymentForm spec={spec} ctx={ctx} onClose={onClose} onSuccess={onSuccess} />
        </Elements>
    );
}
