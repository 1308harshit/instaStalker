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
import { ObjectId } from "mongodb";
import { Resend } from "resend";
import crypto from "crypto";

const app = express();
app.use(
  cors({
    origin: [
      "https://samjhona.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);
// Increase body size limit (needed for report payloads)
app.use(express.json({ limit: "50mb" })); // For parsing JSON request bodies
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

// Cashfree configuration
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

// CRITICAL: Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  log(`❌ UNHANDLED REJECTION: ${reason}`);
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let PM2 handle restarts
});

process.on('uncaughtException', (error) => {
  log(`❌ UNCAUGHT EXCEPTION: ${error.message}`);
  console.error('Uncaught Exception:', error);
  // Exit gracefully - PM2 will restart
  process.exit(1);
});

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

  // 7-row table: pick 7 unique profiles and assign fixed highlight rules
  const uniqueCards = pickUniqueByUsername(usable, 200);
  // One-time shuffle for variety (stable because stored)
  const shuffled = [...uniqueCards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randIntInclusive(0, i);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const TOTAL_ROWS = 7;
  const selected = shuffled.slice(0, Math.min(TOTAL_ROWS, shuffled.length));

  // Padding to 7 rows (should be rare if cards exist)
  while (selected.length < TOTAL_ROWS) {
    const idx = selected.length + 1;
    selected.push({
      username: `@profile${idx}`,
      title: "Instagram user",
      image: null,
    });
  }

  const rowCount = selected.length;
  const screenshotRowIndex =
    rowCount >= 3 ? randIntInclusive(2, Math.min(6, rowCount - 1)) : null;
  const secondRowHasScreenshot = rowCount >= 2 && randIntInclusive(1, 100) <= 30;

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

    // First two profiles always have visits = 1 highlighted
    if (index === 0 || index === 1) {
      rowVisits = 1;
      visitsHighlighted = true;
    }

    // Exactly one of the rows 3–7 has screenshots = 1 highlighted
    if (screenshotRowIndex !== null && index === screenshotRowIndex) {
      rowScreenshots = 1;
      screenshotsHighlighted = true;
    }

    // 30% chance that row 2 also has screenshots = 1 highlighted
    if (index === 1 && secondRowHasScreenshot) {
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

// Email configuration
const BASE_URL = (process.env.BASE_URL || "https://samjhona.com").replace(
  /\/+$/,
  ""
);

// Create Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to send post-purchase email
async function sendPostPurchaseEmail(email, fullName, postPurchaseLink) {
  try {
    const label = email || fullName || "there";
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your report link",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2>Thank you for your purchase!</h2>
          <p>Hi ${label},</p>
          <p>Access your report using the link below:</p>
          <p>
            <a href="${postPurchaseLink}" 
               style="background:#ef4444;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">
              Open my report
            </a>
          </p>
          <p style="font-size:12px;color:#666">
            If you don't see it, check spam.
          </p>
        </div>
      `,
    });

    console.log("✅ Email sent via Resend:", result.id);
    return result;
  } catch (err) {
    console.error("❌ Resend email failed:", err);
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

//  BYPASS PAYMENT — SEND EMAIL + REDIRECT TO PAYU
app.post("/api/payment/bypass", async (req, res) => {
  try {
    const { email, fullName, username, cards, profile } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: "Report cards are required" });
    }

    const orderId = `order_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}`;
    const token = crypto.randomBytes(32).toString("hex");

    const postPurchaseLink = `${BASE_URL}/post-purchase?token=${encodeURIComponent(
      token
    )}&order=${encodeURIComponent(orderId)}`;

    // Optional DB save
    try {
      const db = await connectDB();
      if (db) {
        const report = buildStoredReport({ cards, profile });
        await db.collection("user_orders").insertOne({
          orderId,
          accessToken: token, // ✅ IMPORTANT
          email,
          fullName,
          username,
          cards,
          profile: profile || null,
          report,
          status: "paid", // IMPORTANT
          createdAt: new Date(),
          verifiedAt: new Date(),
          emailSent: false,
        });
      }
    } catch (_) {}

    // Send email after data is stored (small delay helps consistency)
    setTimeout(() => {
      sendPostPurchaseEmail(email, fullName, postPurchaseLink)
        .then(async () => {
          try {
            const db = await connectDB();
            if (!db) return;
            await db
              .collection("user_orders")
              .updateOne(
                { orderId },
                { $set: { emailSent: true, emailSentAt: new Date() } }
              );
          } catch (_) {}
        })
        .catch((err) => {
          console.error("Email failed (non-blocking):", err.message);
        });
    }, 5000);

    // Respond immediately so redirect is not blocked
    return res.json({ success: true });
  } catch (err) {
    console.error("Bypass error:", err);
    res.status(500).json({ error: "Bypass failed" });
  }
});

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
        return_url: `https://samjhona.com/payment/return?order_id={order_id}`,
        notify_url: `https://samjhona.com/api/payment/webhook`,
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

          // If report already exists for this order, do not regenerate it.
          const existingOrder = await collection.findOne({ orderId: order_id });

          // Generate unique post-purchase link
          const accessToken = crypto.randomBytes(32).toString("hex");
          const postPurchaseLink = `${BASE_URL}/post-purchase?token=${encodeURIComponent(
            accessToken
          )}&order=${encodeURIComponent(order_id)}`;

          const updateData = {
            status: "paid",
            verifiedAt: new Date(),
            postPurchaseLink: postPurchaseLink,
            accessToken: accessToken,
            emailSent: false,
          };

          // Add profile data if provided
          if (username) updateData.username = username;
          if (Array.isArray(cards) && cards.length > 0) updateData.cards = cards;
          // Avoid overwriting good data with empty/default objects
          if (profile && typeof profile === "object" && Object.keys(profile).length > 0) {
            updateData.profile = profile;
          }
          if (!existingOrder?.report && Array.isArray(cards) && cards.length > 0) {
            updateData.report = buildStoredReport({ cards, profile });
          }

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
        report: orderDoc.report || null,
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
        return_url: `https://samjhona.com/payment/return?order_id={order_id}`,
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

// New endpoint: Get snapshot metadata (including profileData)
app.get("/api/snapshots/:snapshotId/:stepName/meta", async (req, res) => {
  const { snapshotId, stepName } = req.params;

  try {
    const database = await connectDB();
    if (!database) {
      return res.status(500).json({ error: "Database not available" });
    }

    const collection = database.collection("snapshots");
    const snapshot = await collection.findOne({
      _id: new ObjectId(snapshotId)
    });

    if (!snapshot) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    const step = snapshot.steps?.find(s => s.name === stepName);
    if (!step) {
      return res.status(404).json({ error: "Step not found" });
    }

    // Return metadata including profileData
    res.json({
      name: step.name,
      meta: step.meta || {},
      capturedAt: step.capturedAt || snapshot.createdAt
    });
  } catch (err) {
    log(`❌ Error serving snapshot metadata: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve snapshot metadata" });
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
