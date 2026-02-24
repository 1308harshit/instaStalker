import React, { useEffect, useState, useRef } from "react";

export default function SuccessfullyPaid() {
  const [carouselIndex, setCarouselIndex] = useState(3);
  const carouselLoopingRef = useRef(false);

  // META PIXEL ID Configuration
  const META_PIXEL_ID = (() => {
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";
    if (hostname.includes("sensorahub")) {
      return import.meta.env.VITE_FB_PIXEL_ID_SENSORA || "710646615238495";
    }
    return import.meta.env.VITE_FB_PIXEL_ID || "1752528628790870";
  })();

  // Track PageView and Purchase on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("init", META_PIXEL_ID);
      window.fbq("track", "PageView");

      // Track Purchase event
      const stored = localStorage.getItem("instaStalker_pending_purchase");
      let purchaseData = { value: 99, currency: "INR" };
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          purchaseData = { value: parsed.value || 99, currency: parsed.currency || "INR" };
        } catch (e) { }
      }

      window.fbq("track", "Purchase", purchaseData);
      console.log(`✅ Meta Pixel: Purchase and PageView tracked with ID ${META_PIXEL_ID}`, purchaseData);
    }
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
