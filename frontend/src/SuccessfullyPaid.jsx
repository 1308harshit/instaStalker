import React, { useEffect, useRef } from "react";

export default function SuccessfullyPaid() {
  const purchaseTrackedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (purchaseTrackedRef.current) return;
    purchaseTrackedRef.current = true;

    const PENDING_KEY = "instaStalker_pending_purchase";

    let pending = null;
    try {
      const raw = window.localStorage.getItem(PENDING_KEY);
      pending = raw ? JSON.parse(raw) : null;
    } catch (_) {
      pending = null;
    }

    // Prevent false Purchase events if user opens success page directly.
    // Only fire if we have a pending purchase marker from the PayU redirect flow.
    if (!pending || typeof pending !== "object") return;

    const value =
      typeof pending?.value === "number" && Number.isFinite(pending.value)
        ? pending.value
        : 99;
    const currency = typeof pending?.currency === "string" ? pending.currency : "INR";
    const purchaseId =
      typeof pending?.id === "string" && pending.id.trim() ? pending.id.trim() : null;

    const firedKey = purchaseId
      ? `instaStalker_purchase_fired_${purchaseId}`
      : "instaStalker_purchase_fired_payu";

    try {
      if (window.localStorage.getItem(firedKey)) return;
      window.localStorage.setItem(firedKey, String(Date.now()));
      window.localStorage.removeItem(PENDING_KEY); // prevent duplicate firing on refresh
    } catch (_) {
      // ignore storage errors
    }

    const tryTrack = (attempts = 0) => {
      if (window.fbq && typeof window.fbq === "function") {
        try {
          window.fbq("track", "Purchase", { value, currency });
          console.log("✅ Meta Pixel: Purchase tracked", { value, currency });
        } catch (err) {
          console.error("❌ Meta Pixel tracking error for Purchase:", err);
        }
        return;
      }

      if (attempts < 10) {
        setTimeout(() => tryTrack(attempts + 1), 100);
        return;
      }

      console.warn("⚠️ Meta Pixel: fbq not available after retries for Purchase");
    };

    tryTrack();
  }, []);

  const container = {
    display: "flex",
    minHeight: "100vh",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "#f7fafc",
  };

  const card = {
    width: "100%",
    maxWidth: "720px",
    background: "white",
    borderRadius: "12px",
    padding: "28px",
    boxShadow: "0 6px 18px rgba(17,24,39,0.06)",
    textAlign: "center",
  };

  const title = {
    fontSize: "20px",
    fontWeight: 700,
    color: "#0f172a",
    margin: "10px 0 6px",
  };

  const subtitle = {
    fontSize: "14px",
    color: "#334155",
    margin: "8px 0 14px",
    lineHeight: 1.5,
  };

  const note = {
    fontSize: "13px",
    color: "#475569",
    marginTop: "14px",
    lineHeight: 1.45,
  };

  const support = {
    display: "inline-block",
    marginTop: "16px",
    color: "#0b5fff",
    textDecoration: "none",
    fontWeight: 600,
  };

  const checkWrap = {
    width: "72px",
    height: "72px",
    borderRadius: "999px",
    background: "#ecfdf5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto",
  };

  return (
    <div style={container}>
      <div style={card}>
        <div style={checkWrap} aria-hidden>
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path
              d="M20 6L9 17l-5-5"
              stroke="#16a34a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 style={title}>Payment received successfully</h1>

        <p style={subtitle}>
          Thank you — we've sent the report link to your email address. It may
          take 5–10 minutes to arrive.
        </p>

        <p style={note}>
          Please check your Spam, Promotions, or other email folders if you do
          not see the message. You do <strong>NOT</strong> need to pay again.
        </p>

        <a href="mailto:customercare@samjhona.com" style={support}>
          customercare@samjhona.com
        </a>
      </div>
    </div>
  );
}
