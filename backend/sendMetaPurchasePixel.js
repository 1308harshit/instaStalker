const fetch = require("node-fetch");
const crypto = require("crypto");

const META_PIXEL_ID = "1752528628790870";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// helper to sha256 hash (Meta requirement)
const sha256 = (value) =>
  crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

async function sendMetaPurchasePixel({
  eventId,
  value,
  currency = "INR",
  orderId,
  quantity = 1,
  email,
  phone,
  clientIp,
  userAgent,
  sourceUrl = "",
}) {
  if (!META_ACCESS_TOKEN) {
    throw new Error("Meta access token missing");
  }

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: sourceUrl,
        user_data: {
          em: email ? [sha256(email)] : undefined,
          ph: phone ? [sha256(phone)] : undefined,
          client_ip_address: clientIp,
          client_user_agent: userAgent,
        },
        custom_data: {
          currency,
          value,
          order_id: orderId,
          quantity,
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return response.json();
}

export default sendMetaPurchasePixel;