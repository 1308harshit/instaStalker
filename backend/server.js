// Load environment variables FIRST (before any other imports that need them)
// Use dynamic import to load dotenv synchronously
// Always load .env file, regardless of NODE_ENV (needed for PM2 production)
try {
  // Use import() with await at top level (ES modules support this)
  const dotenvModule = await import("dotenv");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Explicitly specify .env file path
  const envPath = path.join(__dirname, ".env");
  const result = dotenvModule.default.config({ path: envPath });
  if (result.error) {
    console.warn("⚠️  Error loading .env file:", result.error.message);
  } else {
    console.log("✅ Loaded .env file from:", envPath);
  }
} catch (e) {
  // dotenv not installed, continue without it
  console.warn(
    "⚠️  dotenv not available, using environment variables from system:",
    e.message
  );
}

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { scrape } from "./scraper/scrape.js";
import { scrapeQueue } from "./utils/queue.js";
import { browserPool } from "./scraper/browserPool.js";
import { redis } from "./utils/redis.js";
import {
  connectDB,
  getSnapshotStep,
  getRecentSnapshot,
  closeDB,
} from "./utils/mongodb.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
// Node 18+ provides global fetch; avoid node-fetch dependency

const app = express();
app.use(
  cors({
    origin: [
      "https://sensorahub.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);
// Increase body size limit (report payloads can be large)
app.use(express.json({ limit: "50mb" })); // For parsing JSON request bodies
// Vegaah "merchant receipt URL" callback is typically application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Keep static serving for backward compatibility (if files exist)
const SNAPSHOT_ROOT = path.join(__dirname, "snapshots");
app.use("/snapshots", express.static(SNAPSHOT_ROOT));

// MongoDB configuration
// Note: Make sure your IP is whitelisted in MongoDB Atlas Network Access
// Password is URL-encoded: @ becomes %40
const COLLECTION_NAME = "user_orders";
// connectDB is imported from ./utils/mongodb.js and used for both snapshots and payment data

/* ===== CASHFREE INIT (COMMENTED) =====
// Cashfree configuration from environment variables
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

// Check CASHFREE_ENV and set base URL accordingly
const CASHFREE_ENV = process.env.CASHFREE_ENV || "PRODUCTION";
const CASHFREE_API_BASE_URL =
  CASHFREE_ENV === "TEST" || CASHFREE_ENV === "SANDBOX"
    ? "https://sandbox.cashfree.com/pg" // Test environment
    : "https://api.cashfree.com/pg"; // Production environment

// Validate required environment variables
if (!CASHFREE_APP_ID) {
  throw new Error(
    "❌ CASHFREE_APP_ID environment variable is required. Please set it in .env file or Railway environment variables."
  );
}

if (!CASHFREE_SECRET_KEY) {
  throw new Error(
    "❌ CASHFREE_SECRET_KEY environment variable is required. Please set it in .env file or Railway environment variables."
  );
}

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

// Log credentials at startup to verify environment configuration
log(`🚀 Cashfree credentials loaded:`);
log(`   Environment: ${CASHFREE_ENV}`);
log(`   API Base URL: ${CASHFREE_API_BASE_URL}`);
log(`   App ID: ${CASHFREE_APP_ID}`);
log(
  `   Secret Key length: ${
    CASHFREE_SECRET_KEY ? CASHFREE_SECRET_KEY.length : 0
  }`
);
log(
  `   Secret Key (first 40 chars): ${
    CASHFREE_SECRET_KEY
      ? CASHFREE_SECRET_KEY.substring(0, 40) + "..."
      : "MISSING"
  }`
);
log(
  `   Secret Key (last 15 chars): ${
    CASHFREE_SECRET_KEY
      ? "..." + CASHFREE_SECRET_KEY.substring(CASHFREE_SECRET_KEY.length - 15)
      : "MISSING"
  }`
);

// Cashfree API Configuration
// Using direct HTTP requests instead of SDK (as per official documentation)
const CASHFREE_API_VERSION = "2023-08-01";

log(`🔧 Cashfree configured for direct API calls:`);
log(
  `   App ID: ${
    CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 12) + "..." : "MISSING"
  }`
);
log(
  `   Secret Key: ${
    CASHFREE_SECRET_KEY
      ? "Present (length: " + CASHFREE_SECRET_KEY.length + ")"
      : "MISSING"
  }`
);
log(`   API Base URL: ${CASHFREE_API_BASE_URL}`);
log(`   API Version: ${CASHFREE_API_VERSION}`);
==================================== */

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

// -------------------------------
// Stored report builder (Option A)
// -------------------------------
const normalizeUsername = (value = "") => {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.startsWith("@") ? v : `@${v}`;
};

const randIntInclusive = (min, max) => {
  // crypto.randomInt is max-exclusive
  return crypto.randomInt(min, max + 1);
};

function buildStoredReport({ cards = [], profile = null }) {
  const safeCards = Array.isArray(cards) ? cards : [];
  const heroProfile = profile && typeof profile === "object" ? profile : null;

  // Prefer usable cards (non-locked, has username)
  const usable = safeCards.filter((c) => !c?.isLocked && c?.username);

  // Carousel cards: try strict first, then relax
  const strict = usable.filter((c) => c?.image && !c?.blurImage);
  const relaxedBlur = usable.filter((c) => c?.image);
  const relaxedNoImage = usable;

  const pickUniqueByUsername = (list, max) => {
    const seen = new Set();
    const out = [];
    for (const c of list) {
      const u = normalizeUsername(c?.username);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({ ...c, username: u });
      if (out.length >= max) break;
    }
    return out;
  };

  let carouselCards = pickUniqueByUsername(strict, 6);
  if (carouselCards.length < 6) {
    const more = pickUniqueByUsername(relaxedBlur, 6);
    carouselCards = pickUniqueByUsername([...carouselCards, ...more], 6);
  }
  if (carouselCards.length < 6) {
    const more = pickUniqueByUsername(relaxedNoImage, 6);
    carouselCards = pickUniqueByUsername([...carouselCards, ...more], 6);
  }

  // "Last 7 days" summary: fixed once
  const visits = randIntInclusive(1, 5);
  let screenshots = randIntInclusive(1, 5);
  if (screenshots === visits) {
    screenshots = (screenshots % 5) + 1;
    if (screenshots === visits) screenshots = ((screenshots + 1) % 5) + 1;
  }
  const last7Summary = { profileVisits: visits, screenshots };

  // 10-row table: pick 10 unique profiles and assign fixed highlight rules
  const uniqueCards = pickUniqueByUsername(usable, 200);
  // One-time shuffle for variety (stable because stored)
  const shuffled = [...uniqueCards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randIntInclusive(0, i);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const TOTAL_ROWS = 10;
  const selected = shuffled.slice(0, Math.min(TOTAL_ROWS, shuffled.length));

  // Padding to 10 rows (should be rare if cards exist)
  while (selected.length < TOTAL_ROWS) {
    const idx = selected.length + 1;
    selected.push({
      username: `@profile${idx}`,
      title: "Instagram user",
      image: null,
    });
  }

  const rowCount = selected.length;
  // Screenshots: highlight 3 profiles among rows 2–10 (index 1–9)
  const screenshotIndices = new Set();
  if (rowCount >= 2) {
    const minIdx = 1;
    const maxIdx = Math.min(9, rowCount - 1);
    while (
      screenshotIndices.size < 3 &&
      screenshotIndices.size < maxIdx - minIdx + 1
    ) {
      screenshotIndices.add(randIntInclusive(minIdx, maxIdx));
    }
  }

  const last7Rows = selected.slice(0, TOTAL_ROWS).map((card, index) => {
    const username = normalizeUsername(card.username || "");
    const name =
      String((card.title || card.name || "") || "")
        .trim()
        .slice(0, 80) ||
      username.replace(/^@/, "") ||
      "Instagram user";
    const image = card.image || card.avatar || null;

    let rowVisits = 0;
    let rowScreenshots = 0;
    let visitsHighlighted = false;
    let screenshotsHighlighted = false;

    // Visits: highlight first 4 profiles (rows 1–4)
    if (index >= 0 && index <= 3) {
      rowVisits = 1;
      visitsHighlighted = true;
    }

    // Screenshots: highlight 3 profiles among rows 2–10
    if (screenshotIndices.has(index)) {
      rowScreenshots = 1;
      screenshotsHighlighted = true;
    }

    return {
      id: `${username || "profile"}-${index}`,
      name,
      username,
      image,
      visits: rowVisits,
      screenshots: rowScreenshots,
      visitsHighlighted,
      screenshotsHighlighted,
    };
  });

  return {
    version: 1,
    generatedAt: new Date(),
    heroProfile,
    carouselCards,
    last7Summary,
    last7Rows,
  };
}

// Vegaah signature helper function (per Vegaah_Payment_Gateway_API.pdf)
// Request signature format (SHA256, NOT HMAC):
// trackId | terminalId | password | merchantkey | amount | currency
function formatVegaahAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function generateVegaahRequestSignature({
  trackId,
  terminalId,
  password,
  merchantKey,
  amount,
  currency,
}) {
  const pipeSeparatedString = `${trackId}|${terminalId}|${password}|${merchantKey}|${amount}|${currency}`;
  return crypto.createHash("sha256").update(pipeSeparatedString).digest("hex");
}

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const BASE_URL = process.env.BASE_URL || "https://sensorahub.com";

// Create email transporter
const emailTransporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_PORT === 465,
  auth:
    EMAIL_USER && EMAIL_PASS
      ? {
          user: EMAIL_USER,
          pass: EMAIL_PASS,
        }
      : undefined,
});

// Helper function to send post-purchase email
async function sendPostPurchaseEmail(email, fullName, postPurchaseLink) {
  if (!EMAIL_USER || !EMAIL_PASS) {
    log("⚠️ Email not configured - skipping email send");
    return null;
  }

  try {
    const mailOptions = {
      from: `"Insta Reports" <${EMAIL_USER}>`,
      to: email,
      subject: "Your report link",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f43f3f;">Thank you for your purchase!</h2>
          <p>Hi ${fullName || "there"},</p>
          <p>Your payment is confirmed. Access your report anytime:</p>
          <div style="margin: 30px 0;">
            <a href="${postPurchaseLink}" 
               style="background-color: #f43f3f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Open my report
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            You can bookmark this link or keep this email.
          </p>
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
            <p style="color: #856404; font-size: 13px; margin: 0; font-weight: 600;">
              Important Notice:
            </p>
            <p style="color: #856404; font-size: 12px; margin: 8px 0 0 0; line-height: 1.5;">
              This report is generated using automated AI analysis based on public engagement signals and behavioral patterns. Instagram does not provide official data about profile visitors. Results are estimates only and may not be fully accurate or represent actual individuals.
            </p>
          </div>
          <p style="color: #666; font-size: 14px;">
            Support: <a href="mailto:robertpranav369@gmail.com" style="color: #f43f3f;">robertpranav369@gmail.com</a>
          </p>
        </div>
      `,
    };

    const info = await emailTransporter.sendMail(mailOptions);
    log(`✅ Post-purchase email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (err) {
    log(`❌ Error sending email: ${err.message}`);
    return null;
  }
}

// Save user data to MongoDB
app.post("/api/payment/save-user", async (req, res) => {
  try {
    const { email, fullName, phoneNumber } = req.body;

    if (!email || !fullName || !phoneNumber) {
      return res
        .status(400)
        .json({ error: "Email, full name, and phone number are required" });
    }

    const database = await connectDB();
    if (!database) {
      log("⚠️ MongoDB not available, skipping save");
      // Still return success so payment flow can continue
      return res.json({
        success: true,
        message: "User data received (MongoDB unavailable)",
      });
    }

    const collection = database.collection(COLLECTION_NAME);

    const userData = {
      email,
      fullName,
      phoneNumber,
      createdAt: new Date(),
      status: "pending",
    };

    const result = await collection.insertOne(userData);
    log(`✅ User data saved: ${email}`);

    res.json({
      success: true,
      userId: result.insertedId,
      message: "User data saved successfully",
    });
  } catch (err) {
    log("❌ Error saving user data:", err.message);
    // Still return success so payment flow can continue even if DB fails
    res.json({
      success: true,
      message: "User data received (save may have failed)",
    });
  }
});

// Create stored post-purchase link + email (gateway-agnostic)
// This preserves the "Place order → email → /post-purchase summary" flow even if payment gateway changes.
app.post("/api/payment/bypass", async (req, res) => {
  try {
    const { email, fullName, username, cards, profile } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!username)
      return res.status(400).json({ error: "Username is required" });
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: "Report cards are required" });
    }

    const orderId = `order_${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const token = crypto.randomBytes(32).toString("hex");
    const normalizedBase = String(BASE_URL || "").replace(/\/+$/, "");
    const postPurchaseLink = `${normalizedBase}/post-purchase?token=${encodeURIComponent(
      token
    )}&order=${encodeURIComponent(orderId)}`;

    const db = await connectDB();
    if (!db) {
      return res.status(500).json({ error: "Database not available" });
    }

    const report = buildStoredReport({ cards, profile });
    const collection = db.collection(COLLECTION_NAME);
    await collection.insertOne({
      orderId,
      accessToken: token,
      email,
      fullName: fullName || "",
      username,
      cards,
      profile: profile || null,
      report,
      status: "paid",
      createdAt: new Date(),
      verifiedAt: new Date(),
      emailSent: false,
    });

    // Send email after data is stored (small delay helps consistency)
    setTimeout(() => {
      sendPostPurchaseEmail(email, fullName || "there", postPurchaseLink)
        .then(() =>
          collection.updateOne(
            { orderId },
            { $set: { emailSent: true, emailSentAt: new Date() } }
          )
        )
        .catch(() => {});
    }, 2000);

    return res.json({ success: true, orderId });
  } catch (err) {
    log("❌ Bypass error:", err?.message || String(err));
    return res.status(500).json({ error: "Bypass failed" });
  }
});

// Validate post-purchase link endpoint (used by email link /post-purchase)
app.get("/api/payment/post-purchase", async (req, res) => {
  try {
    const { token, order } = req.query;

    if (!token || !order) {
      return res.status(400).json({
        success: false,
        error: "Missing token or order parameter",
      });
    }

    const db = await connectDB();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Database not available",
      });
    }

    const collection = db.collection(COLLECTION_NAME);
    const orderDoc = await collection.findOne({
      orderId: order,
      accessToken: token,
      status: "paid",
    });

    if (!orderDoc) {
      return res.status(404).json({
        success: false,
        error: "Invalid or expired link",
      });
    }

    // Backfill stored report if older orders don't have it
    let report = orderDoc.report || null;
    if (!report && Array.isArray(orderDoc.cards) && orderDoc.cards.length > 0) {
      report = buildStoredReport({ cards: orderDoc.cards, profile: orderDoc.profile });
      collection
        .updateOne({ orderId: order }, { $set: { report } })
        .catch(() => {});
    }

    return res.json({
      success: true,
      orderId: orderDoc.orderId,
      email: orderDoc.email,
      fullName: orderDoc.fullName,
      username: orderDoc.username || null,
      cards: orderDoc.cards || [],
      profile: orderDoc.profile || null,
      report: report,
    });
  } catch (error) {
    log("❌ Error validating post-purchase link:", error?.message || String(error));
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to validate link",
    });
  }
});

/* ===== CASHFREE ROUTES (COMMENTED) =====
// Create Cashfree payment session
app.post("/api/payment/create-session", async (req, res) => {
  try {
    const { amount, email, fullName, phoneNumber } = req.body;

    log(`📥 Create session request: amount=${amount}, email=${email}`);

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ error: "Amount is required and must be greater than 0" });
    }

    // Verify Cashfree is configured correctly
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      throw new Error("Cashfree not configured properly");
    }

    // Format phone number
    let phone = phoneNumber ? phoneNumber.replace(/[^0-9]/g, "") : "";
    if (phone.length > 10) {
      phone = phone.slice(-10);
    }

    // Generate unique order ID
    const orderId = `order_${Date.now()}_${Math.random()
      .toString(36)
      .substring(7)}`;

    // Generate safe customer ID (never use email)
    const customerId = `cust_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    log(`💰 Creating payment session: ₹${amount} (Order ID: ${orderId})`);
    log(
      `🔑 Using App ID: ${
        CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 12) + "..." : "MISSING"
      }`
    );

    // Create Cashfree payment session
    const orderRequest = {
      order_id: orderId,
      order_amount: amount, // Cashfree uses rupees, not paise
      order_currency: "INR",
      customer_details: {
        customer_id: customerId, // Safe ID, never email
        customer_name: fullName || "Customer",
        customer_email: email || "", // Email only here
        customer_phone: phone || "",
      },
      order_meta: {
        return_url: `https://sensorahub.com/payment/return?order_id={order_id}`,
        notify_url: `https://sensorahub.com/api/payment/webhook`,
      },
    };

    log(`📤 Calling Cashfree API: POST ${CASHFREE_API_BASE_URL}/orders`);
    log(`📦 Order Request: ${JSON.stringify(orderRequest)}`);

    // Make direct HTTP request to Cashfree API (as per official documentation)
    // Headers: x-client-id, x-client-secret, x-api-version
    const apiUrl = `${CASHFREE_API_BASE_URL}/orders`;
    log(`🔍 Making POST request to: ${apiUrl}`);
    log(
      `📋 Headers: x-client-id, x-client-secret, x-api-version: ${CASHFREE_API_VERSION}`
    );

    // Debug: Log credentials being sent (first 20 chars of secret for security)
    log(`🔑 Credentials check:`);
    log(`   x-client-id: ${CASHFREE_APP_ID}`);
    log(
      `   x-client-secret (first 30 chars): ${
        CASHFREE_SECRET_KEY
          ? CASHFREE_SECRET_KEY.substring(0, 30) + "..."
          : "MISSING"
      }`
    );
    log(
      `   x-client-secret length: ${
        CASHFREE_SECRET_KEY ? CASHFREE_SECRET_KEY.length : 0
      }`
    );
    log(
      `   x-client-secret ends with: ${
        CASHFREE_SECRET_KEY
          ? "..." +
            CASHFREE_SECRET_KEY.substring(CASHFREE_SECRET_KEY.length - 10)
          : "MISSING"
      }`
    );

    // Expected values from curl command (for comparison):
    // x-client-id: 1147729692de9b1aedf55a696b09277411
    // x-client-secret: cfsk_ma_prod_26bfec1cccfce1b21f9ca96bd38659d0_fa148335 (length: 67)

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": CASHFREE_API_VERSION,
      },
      body: JSON.stringify(orderRequest),
    });

    // Check if response is OK
    if (!response.ok) {
      const errorData = await response.text();
      log(`❌ API call failed with status ${response.status}`);
      log(`📋 Error response: ${errorData}`);
      throw new Error(`Cashfree API error: ${response.status} - ${errorData}`);
    }

    const responseData = await response.json();
    log(`✅ Cashfree API call successful`);
    log(`📋 Response: ${JSON.stringify(responseData)}`);

    // Extract payment session ID from response
    if (!responseData || !responseData.payment_session_id) {
      log(
        `⚠️ Warning: Unexpected response structure: ${JSON.stringify(
          responseData
        )}`
      );
      throw new Error("Payment session ID not found in response");
    }

    const paymentSessionId = responseData.payment_session_id;
    log(`✅ Cashfree payment session created: ${paymentSessionId}`);
    log(`📡 Order ID: ${orderId}, Amount: ₹${amount}`);

    // Save order to MongoDB (optional, don't fail if DB is unavailable)
    if (email && fullName && phoneNumber) {
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);

          await collection.insertOne({
            orderId: orderId,
            paymentSessionId: paymentSessionId,
            email,
            fullName,
            phoneNumber: phone,
            amount: amount,
            status: "created",
            createdAt: new Date(),
          });
          log(`✅ Order saved to MongoDB: ${orderId}`);
        }
      } catch (dbErr) {
        log(
          "⚠️ Failed to save order to MongoDB (continuing anyway):",
          dbErr.message
        );
      }
    }

    // Return payment session data for frontend
    res.json({
      order_id: orderId,
      payment_session_id: paymentSessionId,
      order_amount: amount,
      order_currency: "INR",
    });
  } catch (err) {
    log("❌ Error creating Cashfree payment session:", err.message);
    console.error("Full Cashfree error:", err);

    // Check if it's an authentication error
    if (err.statusCode === 401 || err.response?.status === 401) {
      log("⚠️ Cashfree authentication failed. Please check your API keys.");
      log(
        `🔑 App ID present: ${
          CASHFREE_APP_ID
            ? "Yes (starts with " + CASHFREE_APP_ID.substring(0, 8) + "...)"
            : "No"
        }`
      );
      log(
        `🔑 Secret Key present: ${
          CASHFREE_SECRET_KEY
            ? "Yes (length: " + CASHFREE_SECRET_KEY.length + ")"
            : "No"
        }`
      );
    }

    res.status(500).json({
      error: "Failed to create Cashfree payment session",
      details: err.message,
      statusCode: err.statusCode || err.response?.status,
      cashfreeError: err.response?.data || null,
    });
  }
});

// Get Cashfree environment (for frontend to determine which SDK to load)
app.get("/api/payment/environment", async (req, res) => {
  try {
    res.json({
      environment: CASHFREE_ENV,
      isTest: CASHFREE_ENV === "TEST" || CASHFREE_ENV === "SANDBOX",
    });
  } catch (err) {
    log(`❌ Error getting environment: ${err.message}`);
    res.status(500).json({ error: "Failed to get environment" });
  }
});

// Verify payment status endpoint (GET for backward compatibility)
app.get("/api/payment/verify", async (req, res) => {
  try {
    const { order_id } = req.query;

    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" });
    }

    log(`🔍 Verifying payment status for order: ${order_id}`);

    // Fetch order status from Cashfree
    const apiUrl = `${CASHFREE_API_BASE_URL}/orders/${order_id}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": CASHFREE_API_VERSION,
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      log(
        `❌ Payment verification failed: Status ${response.status} - ${errorData}`
      );
      return res.status(response.status).json({
        error: `Payment verification failed: ${response.status}`,
        details: errorData,
      });
    }

    const orderData = await response.json();
    log(`✅ Payment verification response: ${JSON.stringify(orderData)}`);

    // Check if payment is successful - Cashfree status values
    // order_status can be: ACTIVE, PAID, EXPIRED, CANCELLED
    // payment_status can be: SUCCESS, FAILED, PENDING, NOT_ATTEMPTED, USER_DROPPED, VOID, CANCELLED, AUTHENTICATION_FAILED, AUTHORIZATION_FAILED
    const orderStatus = orderData.order_status?.toUpperCase();
    const paymentStatus = orderData.payment_status?.toUpperCase();

    log(`🔍 Order status: ${orderStatus}, Payment status: ${paymentStatus}`);

    const isSuccessful =
      orderStatus === "PAID" ||
      paymentStatus === "SUCCESS" ||
      paymentStatus === "PAID" ||
      (orderStatus === "ACTIVE" && paymentStatus === "SUCCESS");

    log(`✅ Payment is successful: ${isSuccessful}`);

    res.json({
      order_id: orderData.order_id,
      order_status: orderData.order_status,
      payment_status: orderData.payment_status,
      is_successful: isSuccessful,
      order_amount: orderData.order_amount,
      order_currency: orderData.order_currency,
      // Include raw data for debugging
      raw_data: orderData,
    });
  } catch (err) {
    log(`❌ Error verifying payment: ${err.message}`);
    res
      .status(500)
      .json({ error: "Failed to verify payment", details: err.message });
  }
});

// Verify payment and save profile data endpoint (POST)
app.post("/api/payment/verify", async (req, res) => {
  try {
    const { order_id, username, cards, profile } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" });
    }

    log(`🔍 Verifying payment status for order: ${order_id}`);

    // Fetch order status from Cashfree
    const apiUrl = `${CASHFREE_API_BASE_URL}/orders/${order_id}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": CASHFREE_API_VERSION,
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      log(
        `❌ Payment verification failed: Status ${response.status} - ${errorData}`
      );
      return res.status(response.status).json({
        error: `Payment verification failed: ${response.status}`,
        details: errorData,
      });
    }

    const orderData = await response.json();
    log(`✅ Payment verification response: ${JSON.stringify(orderData)}`);

    // Check if payment is successful
    const orderStatus = orderData.order_status?.toUpperCase();
    const paymentStatus = orderData.payment_status?.toUpperCase();

    log(`🔍 Order status: ${orderStatus}, Payment status: ${paymentStatus}`);

    const isSuccessful =
      orderStatus === "PAID" ||
      paymentStatus === "SUCCESS" ||
      paymentStatus === "PAID" ||
      (orderStatus === "ACTIVE" && paymentStatus === "SUCCESS");

    log(`✅ Payment is successful: ${isSuccessful}`);

    // If payment is successful, save profile data and generate post-purchase link
    if (isSuccessful) {
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);

          // Generate unique post-purchase link
          const accessToken = crypto.randomBytes(32).toString("hex");
          const postPurchaseLink = `${BASE_URL}/post-purchase?token=${accessToken}&order=${order_id}`;

          const updateData = {
            status: "paid",
            verifiedAt: new Date(),
            postPurchaseLink: postPurchaseLink,
            accessToken: accessToken,
            emailSent: false,
          };

          // Add profile data if provided
          if (username) updateData.username = username;
          if (cards && Array.isArray(cards)) updateData.cards = cards;
          if (profile) updateData.profile = profile;

          const updateResult = await collection.updateOne(
            { orderId: order_id },
            { $set: updateData }
          );

          if (updateResult.matchedCount > 0) {
            log(
              `✅ Database updated: Order ${order_id} marked as paid with profile data`
            );

            // Get order details for email
            const order = await collection.findOne({ orderId: order_id });
            if (order && order.email) {
              // Send email (non-blocking)
              sendPostPurchaseEmail(
                order.email,
                order.fullName || "Customer",
                postPurchaseLink
              )
                .then(() => {
                  // Update emailSent flag
                  collection
                    .updateOne(
                      { orderId: order_id },
                      { $set: { emailSent: true, emailSentAt: new Date() } }
                    )
                    .catch(() => {});
                })
                .catch((emailErr) => {
                  log(`⚠️ Email sending failed: ${emailErr.message}`);
                });
            }
          } else {
            log(`⚠️ Order ${order_id} not found in database`);
          }
        }
      } catch (dbErr) {
        log(`⚠️ Failed to update database: ${dbErr.message}`);
        // Don't fail payment verification if DB update fails
      }
    }

    res.json({
      order_id: orderData.order_id,
      order_status: orderData.order_status,
      payment_status: orderData.payment_status,
      is_successful: isSuccessful,
      order_amount: orderData.order_amount,
      order_currency: orderData.order_currency,
    });
  } catch (err) {
    log(`❌ Error verifying payment: ${err.message}`);
    res
      .status(500)
      .json({ error: "Failed to verify payment", details: err.message });
  }
});

// Validate post-purchase link endpoint
app.get("/api/payment/post-purchase", async (req, res) => {
  try {
    const { token, order } = req.query;

    if (!token || !order) {
      return res.status(400).json({
        success: false,
        error: "Missing token or order parameter",
      });
    }

    log(`🔍 Validating post-purchase link: order=${order}`);

    try {
      const database = await connectDB();
      if (!database) {
        return res.status(500).json({
          success: false,
          error: "Database not available",
        });
      }

      const collection = database.collection(COLLECTION_NAME);
      const orderDoc = await collection.findOne({
        orderId: order,
        accessToken: token,
        status: "paid",
      });

      if (!orderDoc) {
        log(
          `❌ Invalid post-purchase link: order=${order}, token=${token.substring(
            0,
            10
          )}...`
        );
        return res.status(404).json({
          success: false,
          error: "Invalid or expired link",
        });
      }

      log(`✅ Post-purchase link validated: order=${order}`);
      res.json({
        success: true,
        orderId: orderDoc.orderId,
        email: orderDoc.email,
        fullName: orderDoc.fullName,
        // Return stored profile data
        username: orderDoc.username || null,
        cards: orderDoc.cards || [],
        profile: orderDoc.profile || null,
      });
    } catch (dbErr) {
      log(`❌ Database error validating post-purchase link: ${dbErr.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to validate link",
      });
    }
  } catch (error) {
    log(`❌ Error validating post-purchase link: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to validate link",
    });
  }
});

// Test Cashfree credentials endpoint (for debugging)
app.get("/api/payment/test-credentials", async (req, res) => {
  try {
    log("🧪 Testing Cashfree credentials...");

    // Try to create a minimal test payment session
    const testOrderId = `test_${Date.now()}`;
    // Generate safe customer ID for test (never use email)
    const testCustomerId = `cust_test_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    const testOrderRequest = {
      order_id: testOrderId,
      order_amount: 1, // 1 rupee
      order_currency: "INR",
      customer_details: {
        customer_id: testCustomerId, // Safe ID, never email
        customer_name: "Test Customer",
        customer_email: "[email protected]",
        customer_phone: "9999999999",
      },
      order_meta: {
        return_url: `https://sensorahub.com/payment/return?order_id={order_id}`,
      },
    };

    // Make direct HTTP request to Cashfree API
    const apiUrl = `${CASHFREE_API_BASE_URL}/orders`;
    log(`🔍 Test: Making POST request to: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": CASHFREE_API_VERSION,
      },
      body: JSON.stringify(testOrderRequest),
    });

    if (!response.ok) {
      const errorData = await response.text();
      log(`❌ Test order error: Status ${response.status} - ${errorData}`);
      throw new Error(`Cashfree API error: ${response.status} - ${errorData}`);
    }

    const responseData = await response.json();
    log(
      `✅ Test payment session created successfully: ${responseData.payment_session_id}`
    );

    res.json({
      success: true,
      message: "Cashfree credentials are valid",
      testOrderId: testOrderId,
      testPaymentSessionId: responseData.payment_session_id,
      appIdLength: CASHFREE_APP_ID?.length || 0,
      secretKeyLength: CASHFREE_SECRET_KEY?.length || 0,
    });
  } catch (err) {
    log("❌ Test payment session failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      statusCode: err.statusCode || err.response?.status,
      cashfreeError: err.response?.data || null,
      appIdLength: CASHFREE_APP_ID?.length || 0,
      secretKeyLength: CASHFREE_SECRET_KEY?.length || 0,
    });
  }
});
====================================== */

// New endpoint: Serve HTML snapshots from MongoDB
app.get("/api/snapshots/:snapshotId/:stepName", async (req, res) => {
  const { snapshotId, stepName } = req.params;

  try {
    const html = await getSnapshotStep(snapshotId, stepName);

    if (!html) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    log(`❌ Error serving snapshot: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve snapshot" });
  }
});

// Vegaah payment routes - Request logging middleware
app.use("/api/payment/vegaah/create", (req, res, next) => {
  log("🔥 Vegaah endpoint hit", {
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection?.remoteAddress,
    timestamp: new Date().toISOString(),
  });
  next();
});

app.post("/api/payment/vegaah/create", async (req, res) => {
  const requestId = `veg_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  
  log("🔥 ========== VEGAAH PAYMENT REQUEST START ==========", { requestId });
  log("🔥 Request headers:", {
    requestId,
    contentType: req.headers["content-type"],
    userAgent: req.headers["user-agent"]?.slice(0, 50),
  });

  try {
    log("🔥 Parsing request body...", { requestId });
    const { amount, email, phone } = req.body;
    
    log("🔥 Request body received:", {
      requestId,
      amount: amount !== undefined ? String(amount) : "MISSING",
      email: email ? String(email).slice(0, 3) + "***" : "MISSING",
      phone: phone ? String(phone).slice(0, 3) + "***" : "MISSING",
      rawBody: JSON.stringify(req.body),
    });

    // Check environment variables
    log("🔥 Checking Vegaah environment variables...", { requestId });
    const missing = [
      "VEGAAH_TERMINAL_ID",
      "VEGAAH_PASSWORD",
      "VEGAAH_MERCHANT_KEY",
      "VEGAAH_PAY_URL",
      "VEGAAH_RETURN_URL",
    ].filter((k) => !process.env[k]);

    if (missing.length) {
      log("❌ Vegaah config missing", { requestId, missing });
      return res
        .status(500)
        .json({ error: "Vegaah not configured", missing });
    }

    log("✅ All Vegaah env vars present", {
      requestId,
      terminalIdLength: process.env.VEGAAH_TERMINAL_ID?.length || 0,
      passwordLength: process.env.VEGAAH_PASSWORD?.length || 0,
      merchantKeyLength: process.env.VEGAAH_MERCHANT_KEY?.length || 0,
      payUrl: process.env.VEGAAH_PAY_URL,
      returnUrl: process.env.VEGAAH_RETURN_URL,
    });

    // Validate request body
    log("🔥 Validating request body...", { requestId });
    if (
      amount === undefined ||
      amount === null ||
      !email ||
      !phone ||
      Number.isNaN(Number(amount))
    ) {
      log("❌ Vegaah invalid request body", {
        requestId,
        hasAmount: amount !== undefined && amount !== null,
        amountValue: amount,
        amountType: typeof amount,
        hasEmail: Boolean(email),
        hasPhone: Boolean(phone),
        isAmountNaN: Number.isNaN(Number(amount)),
      });
      return res.status(400).json({ 
        error: "Invalid request",
        details: {
          amount: amount === undefined || amount === null ? "missing" : typeof amount,
          email: !email ? "missing" : "present",
          phone: !phone ? "missing" : "present",
        }
      });
    }

    log("✅ Request body validated", {
      requestId,
      amount: String(amount),
      email: String(email).slice(0, 3) + "***",
      phone: String(phone).slice(0, 3) + "***",
    });

    // Generate order ID
    const orderId = `ORD_${Date.now()}`;
    log("🧾 Order ID generated", { requestId, orderId });

    // Vegaah signature is computed from (trackId|terminalId|password|merchantkey|amount|currency)
    // Use orderId as trackId for uniqueness
    const trackId = orderId;
    const currency = "INR";
    const formattedAmount = formatVegaahAmount(amount);
    if (!formattedAmount) {
      log("❌ Invalid amount for Vegaah formatting", { requestId, amount });
      return res.status(400).json({ error: "Invalid amount" });
    }

    log("🔐 Preparing signature payload (per PDF spec)...", { requestId });
    log("🔐 Signature inputs (redacted):", {
      requestId,
      trackId,
      terminalIdPresent: Boolean(process.env.VEGAAH_TERMINAL_ID),
      passwordLength: process.env.VEGAAH_PASSWORD?.length || 0,
      merchantKeyLength: process.env.VEGAAH_MERCHANT_KEY?.length || 0,
      amount: formattedAmount,
      currency,
    });

    log("🔐 Generating request signature (SHA256)...", { requestId });
    const signature = generateVegaahRequestSignature({
      trackId,
      terminalId: process.env.VEGAAH_TERMINAL_ID,
      password: process.env.VEGAAH_PASSWORD,
      merchantKey: process.env.VEGAAH_MERCHANT_KEY,
      amount: formattedAmount,
      currency,
    });

    log("✅ Signature generated", {
      requestId,
      signatureLength: signature?.length || 0,
      signaturePreview: signature ? signature.slice(0, 10) + "..." : "MISSING",
    });

    // Prepare final payload
    log("📦 Preparing final request payload...", { requestId });
    const payload = {
      trackId,
      terminalId: process.env.VEGAAH_TERMINAL_ID,
      password: process.env.VEGAAH_PASSWORD,
      signature,
      paymentType: "1",
      amount: formattedAmount,
      currency,
      order: {
        orderId,
        description: "Insta Reports purchase",
      },
      customer: {
        customerEmail: String(email),
        mobileNumber: String(phone),
        // Vegaah validates billingAddressCountry; missing value can cause "Invalid Country" (e.g. responseCode 619)
        // Default to India as this app charges in INR
        billingAddressStreet:
          process.env.VEGAAH_BILLING_STREET || "NA",
        billingAddressCity:
          process.env.VEGAAH_BILLING_CITY || "NA",
        billingAddressState:
          process.env.VEGAAH_BILLING_STATE || "NA",
        billingAddressPostalCode:
          process.env.VEGAAH_BILLING_POSTAL_CODE || "000000",
        billingAddressCountry:
          process.env.VEGAAH_BILLING_COUNTRY || "IN",
      },
      returnUrl: process.env.VEGAAH_RETURN_URL,
    };

    log("📦 Final payload (redacted):", {
      requestId,
      terminalId: payload.terminalId ? "***" : "MISSING",
      password: payload.password ? "***" : "MISSING",
      signature: payload.signature ? payload.signature.slice(0, 10) + "..." : "MISSING",
      paymentType: payload.paymentType,
      amount: payload.amount,
      currency: payload.currency,
      orderId: payload.order.orderId,
      orderDescription: payload.order.description,
      customerEmail: payload.customer.customerEmail.slice(0, 3) + "***",
      mobileNumber: payload.customer.mobileNumber.slice(0, 3) + "***",
      billingAddressCountry: payload.customer.billingAddressCountry,
      returnUrl: payload.returnUrl,
    });

    log("📤 Sending request to Vegaah API...", {
      requestId,
      payUrl: process.env.VEGAAH_PAY_URL,
      method: "POST",
    });

    const startTime = Date.now();
    let resp;
    try {
      resp = await fetch(process.env.VEGAAH_PAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const duration = Date.now() - startTime;
      log("📥 Vegaah API responded", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        duration: `${duration}ms`,
        headers: Object.fromEntries(resp.headers.entries()),
      });
    } catch (fetchErr) {
      log("❌ Vegaah API fetch failed", {
        requestId,
        error: fetchErr?.message || String(fetchErr),
        stack: fetchErr?.stack,
        name: fetchErr?.name,
        code: fetchErr?.code,
      });
      throw fetchErr;
    }

    // Read response
    log("📖 Reading Vegaah response body...", { requestId });
    const rawText = await resp.text();
    log("📖 Raw response received", {
      requestId,
      length: rawText?.length || 0,
      preview: rawText ? rawText.slice(0, 500) : "EMPTY",
    });

    let data = null;
    try {
      data = JSON.parse(rawText);
      log("✅ Response parsed as JSON", { requestId });
    } catch (parseErr) {
      log("⚠️ Response is not JSON", {
        requestId,
        parseError: parseErr?.message,
        rawText: rawText?.slice(0, 500),
      });
    }

    log("📥 Vegaah response data:", {
      requestId,
      status: resp.status,
      ok: resp.ok,
      hasData: data !== null,
      dataKeys: data ? Object.keys(data) : [],
      fullData: data ? JSON.stringify(data) : rawText,
    });

    // Check for Vegaah failure response (they return 200 with result: "FAILURE")
    if (data && data.result === "FAILURE") {
      log("❌ Vegaah API returned FAILURE result", {
        requestId,
        result: data.result,
        responseCode: data.responseCode,
        orderDetails: data.orderDetails,
        additionalDetails: data.additionalDetails,
        fullData: JSON.stringify(data),
      });
      return res.status(502).json({
        error: "Vegaah payment creation failed",
        result: data.result,
        responseCode: data.responseCode,
        orderDetails: data.orderDetails,
        additionalDetails: data.additionalDetails,
        message: `Payment failed with response code: ${data.responseCode || "unknown"}`,
        requestId,
      });
    }

    if (!resp.ok) {
      log("❌ Vegaah API returned error status", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        data: data || rawText,
      });
      return res.status(502).json({
        error: "Vegaah create payment failed",
        status: resp.status,
        statusText: resp.statusText,
        body: data || rawText,
        requestId,
      });
    }

    // Validate response structure
    log("🔍 Validating response structure...", { requestId });
    if (!data) {
      log("❌ Vegaah response is not valid JSON", {
        requestId,
        rawText: rawText?.slice(0, 500),
      });
      return res.status(500).json({
        error: "Invalid Vegaah response format",
        details: "Response is not valid JSON",
        rawResponse: rawText?.slice(0, 500),
        requestId,
      });
    }

    // Success handling can differ by Vegaah integration mode:
    // - Some responses provide a direct link + transactionId
    // - Hosted Payment Page (HPP) flow returns paymentId + targetUrl (leg1), then merchant does form POST (leg2)
    const paymentId =
      data?.paymentId ?? data?.paymentID ?? data?.payment_id ?? null;
    const targetUrl =
      data?.targetUrl ?? data?.targetURL ?? data?.target_url ?? null;

    if (data?.paymentLink?.linkUrl && data?.transactionId) {
      const redirectUrl = `${data.paymentLink.linkUrl}${data.transactionId}`;
      log("✅ Vegaah redirect URL created", {
        requestId,
        redirectUrl,
        linkUrl: data.paymentLink.linkUrl,
        transactionId: data.transactionId,
      });

      log("🔥 ========== VEGAAH PAYMENT REQUEST SUCCESS ==========", {
        requestId,
        redirectUrl,
      });

      return res.json({
        redirectUrl,
        requestId,
      });
    }

    if (paymentId && targetUrl) {
      log("✅ Vegaah HPP init success (paymentId/targetUrl)", {
        requestId,
        trackId,
        paymentId,
        targetUrl,
      });

      return res.json({
        requestId,
        trackId,
        paymentId,
        targetUrl,
      });
    }

    log("❌ Vegaah invalid response structure", {
      requestId,
      hasPaymentLink: Boolean(data?.paymentLink),
      hasLinkUrl: Boolean(data?.paymentLink?.linkUrl),
      hasTransactionId: Boolean(data?.transactionId),
      hasPaymentId: Boolean(paymentId),
      hasTargetUrl: Boolean(targetUrl),
      fullData: JSON.stringify(data),
    });
    return res.status(500).json({
      error: "Invalid Vegaah response",
      details:
        "Expected either (paymentLink.linkUrl + transactionId) or (paymentId + targetUrl)",
      receivedData: data,
      requestId,
    });
  } catch (err) {
    log("❌ ========== VEGAAH PAYMENT REQUEST ERROR ==========", {
      requestId,
      errorName: err?.name,
      errorMessage: err?.message || String(err),
      errorStack: err?.stack,
      errorCode: err?.code,
    });
    res.status(500).json({
      error: "Vegaah init failed",
      details: err?.message || String(err),
      requestId,
    });
  }
});

app.all("/api/payment/vegaah/response", (req, res) => {
  try {
    // Vegaah can either POST encrypted data as form params, or redirect with ?data=...
    // Examples from PDF show encrypted response like: data=<base64>&termId=...
    const rawData =
      req.body?.data ?? req.query?.data ?? req.body?.encryptedResponse ?? null;

    // Fallback: if they post plain JSON (rare)
    const status = req.body?.result || req.body?.status;
    if (!rawData) {
      if (status === "SUCCESS") return res.redirect("/payment-success");
      return res.redirect("/payment-failed");
    }

    const merchantKeyHex = process.env.VEGAAH_MERCHANT_KEY;
    if (!merchantKeyHex) {
      log("❌ Vegaah response: missing VEGAAH_MERCHANT_KEY for decryption");
      return res.redirect("/payment-failed");
    }

    const normalizeEncrypted = (value) => {
      if (!value) return "";
      let s = String(value);
      // In x-www-form-urlencoded, '+' often becomes space; base64 needs '+'
      s = s.replace(/ /g, "+");
      // Sometimes the param contains 'data=' prefix
      if (s.startsWith("data=")) s = s.slice("data=".length);
      // Sometimes includes &termId=...
      const amp = s.indexOf("&");
      if (amp !== -1) s = s.slice(0, amp);
      return s;
    };

    const decryptVegaahData = (encryptedBase64, keyHex) => {
      const key = Buffer.from(String(keyHex).trim(), "hex");
      const b64 = normalizeEncrypted(encryptedBase64);
      const enc = Buffer.from(b64, "base64");

      let algo = null;
      if (key.length === 16) algo = "aes-128-ecb";
      else if (key.length === 24) algo = "aes-192-ecb";
      else if (key.length === 32) algo = "aes-256-ecb";
      else throw new Error(`Unsupported merchant key length: ${key.length}`);

      const decipher = crypto.createDecipheriv(algo, key, null);
      decipher.setAutoPadding(true);
      const decrypted = Buffer.concat([
        decipher.update(enc),
        decipher.final(),
      ]).toString("utf8");
      return decrypted;
    };

    log("📥 Vegaah response callback received", {
      hasBodyData: Boolean(req.body?.data),
      hasQueryData: Boolean(req.query?.data),
      dataLength: String(rawData).length,
    });

    const decrypted = decryptVegaahData(rawData, merchantKeyHex);
    log("🔓 Vegaah decrypted response (preview)", {
      preview: decrypted.slice(0, 500),
      length: decrypted.length,
    });

    let parsed = null;
    try {
      parsed = JSON.parse(decrypted);
    } catch (e) {
      // Some implementations wrap JSON in "data=..."
      const idx = decrypted.indexOf("{");
      if (idx !== -1) {
        parsed = JSON.parse(decrypted.slice(idx));
      } else {
        throw e;
      }
    }

    const responseCode =
      parsed?.responseCode ?? parsed?.ResponseCode ?? parsed?.response_code;
    const result = parsed?.result ?? parsed?.Result ?? null;
    const amount =
      parsed?.amountDetails?.amount ?? parsed?.amount ?? parsed?.Amount;

    // Optional: verify response signature (per PDF)
    // Format: PaymentId | merchantkey | responseCode | amount
    const paymentId =
      parsed?.paymentId ??
      parsed?.paymentID ??
      parsed?.transactionId ??
      parsed?.TranId ??
      null;
    const rspSig = parsed?.signature ?? parsed?.Signature ?? null;

    if (paymentId && responseCode && amount && rspSig) {
      const sigString = `${paymentId}|${merchantKeyHex}|${responseCode}|${amount}`;
      const expected = crypto
        .createHash("sha256")
        .update(sigString)
        .digest("hex");
      log("🔎 Vegaah response signature check", {
        responseCode,
        amount,
        signatureOk: String(expected) === String(rspSig),
      });
    }

    log("✅ Vegaah response parsed", {
      responseCode,
      result,
      amount,
      paymentIdPresent: Boolean(paymentId),
    });

    // "Transaction Approved" example uses responseCode "001" in PDF
    const isSuccess =
      String(result).toUpperCase() === "SUCCESS" || String(responseCode) === "001";

    return res.redirect(isSuccess ? "/payment-success" : "/payment-failed");
  } catch (err) {
    log("❌ Vegaah response handler error", {
      message: err?.message || String(err),
      stack: err?.stack || null,
    });
    return res.redirect("/payment-failed");
  }
});

app.get("/api/stalkers", async (req, res) => {
  const startTime = Date.now();
  const username = req.query.username;

  log(`📥 New request received for username: ${username || "MISSING"}`);

  if (!username) {
    log("❌ Request rejected: username required");
    return res.json({ error: "username required" });
  }

  // Cache check disabled - always start a new scrape for fresh data
  // Check for recent cached snapshot (within last hour)
  // try {
  //   const recentSnapshot = await getRecentSnapshot(username, 60); // 60 minutes cache
  //   if (recentSnapshot) {
  //     log(`✅ Found cached snapshot for ${username} (created ${((Date.now() - recentSnapshot.createdAt) / 1000).toFixed(0)}s ago)`);
  //
  //     const cachedSteps = recentSnapshot.steps.map(step => ({
  //       name: step.name,
  //       htmlPath: `/api/snapshots/${recentSnapshot._id}/${step.name}`,
  //       meta: step.meta
  //     }));
  //
  //     return res.json({
  //       cards: recentSnapshot.cards || [],
  //       steps: cachedSteps,
  //       snapshotId: recentSnapshot._id.toString(),
  //       runId: recentSnapshot.runId,
  //       cached: true
  //     });
  //   }
  // } catch (cacheErr) {
  //   log(`⚠️  Error checking cache: ${cacheErr.message}`);
  //   // Continue with scraping if cache check fails
  // }

  // Check if client wants SSE streaming (EventSource)
  const acceptHeader = req.headers.accept || "";
  const wantsSSE =
    acceptHeader.includes("text/event-stream") || req.query.stream === "true";

  if (wantsSSE) {
    // Server-Sent Events streaming mode
    log(`📡 Starting SSE streaming for username: ${username}`);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
      "X-Accel-Buffering": "no", // Disable NGINX buffering
    });

    // Send initial connection message
    res.write(`: connected\n\n`);

    // Flush headers immediately
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const send = (event, data) => {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(message);
        // Force flush to ensure real-time delivery
        if (typeof res.flush === "function") {
          res.flush();
        }
        log(
          `📤 SSE event sent: ${event} (${
            event === "snapshot" ? data.name : "final"
          })`
        );
      } catch (err) {
        log(`⚠️ Error sending SSE event: ${err.message}`);
      }
    };

    // Use queue to handle concurrent requests
    scrapeQueue
      .enqueue(username, async (username) => {
        return await scrape(username, (step) => {
          log(`📤 Emitting snapshot via SSE: ${step.name}`);
          send("snapshot", step);
        });
      })
      .then((finalResult) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✅ Scrape completed successfully in ${duration}s`);
        log(
          `📊 Sending final result with ${finalResult.cards?.length || 0} cards`
        );
        send("done", finalResult);
        res.end();
      })
      .catch((err) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const errorMessage =
          err?.message || err?.toString() || "Unknown error occurred";
        log(`❌ Scrape failed after ${duration}s:`, errorMessage);
        send("error", { error: errorMessage });
        res.end();
      });

    // Handle client disconnect
    req.on("close", () => {
      log(`🔌 Client disconnected for username: ${username}`);
      res.end();
    });
  } else {
    // Legacy mode: return everything at once (for backward compatibility)
    log(`⏱️  Starting scrape process... (this may take 30-60 seconds)`);

    try {
      // Use queue to handle concurrent requests
      const result = await scrapeQueue.enqueue(username, scrape);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      log(`✅ Scrape completed successfully in ${duration}s`);
      log(
        `📊 Returning ${result.cards?.length || 0} cards and ${
          result.steps?.length || 0
        } snapshots`
      );
      res.json(result);
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const errorMessage =
        err?.message || err?.toString() || "Unknown error occurred";
      log(`❌ Scrape failed after ${duration}s:`, errorMessage);
      log(`📋 Error details:`, err?.stack || "No stack trace available");
      log(
        `📋 Full error object:`,
        JSON.stringify(err, Object.getOwnPropertyNames(err))
      );
      res.json({ error: errorMessage });
    }
  }
});

// Get system stats endpoint (browsers, tabs, users)
app.get("/api/stats", async (req, res) => {
  try {
    // Get counts from Redis (shared across all PM2 processes)
    let activeTabs = 0;
    let activeBrowsers = 0;

    try {
      activeTabs = Number((await redis.get("active_tabs")) || 0);
      activeBrowsers = Number((await redis.get("active_browsers")) || 0);
    } catch (err) {
      log(`⚠️ Redis error reading stats (returning 0): ${err.message}`);
      // Continue with 0 values if Redis fails
    }

    res.json({
      browsers: {
        max: 4, // MAX_BROWSERS
        active: activeBrowsers,
      },
      tabs: {
        active: activeTabs,
      },
      users: {
        active: activeTabs, // Each tab = one active user request
        total: activeTabs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log(`❌ Error getting stats: ${err.message}`);
    res.status(500).json({
      error: "Failed to get stats",
      details: err.message,
    });
  }
});

// Initialize MongoDB on server start (non-blocking)
connectDB().catch((err) => {
  log(
    "⚠️ MongoDB connection failed on startup (will retry on first use):",
    err.message
  );
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  log("🛑 SIGTERM received, closing connections...");
  await browserPool.close();
  await closeDB();
  process.exit(0);
});

process.on("SIGINT", async () => {
  log("🛑 SIGINT received, closing connections...");
  await browserPool.close();
  await closeDB();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 API server started on port ${PORT}`);
  log(
    `📍 Endpoint: http://localhost:${PORT}/api/stalkers?username=<instagram_username>`
  );
  log(
    `📍 Snapshot Endpoint: http://localhost:${PORT}/api/snapshots/:snapshotId/:stepName`
  );
  log(
    `📍 Payment Endpoint: http://localhost:${PORT}/api/payment/create-session`
  );
  log("⏱️  Expected response time: 30-60 seconds per request");
  log("🗄️  Snapshots stored in MongoDB (auto-deleted after 10 minutes)");
});
