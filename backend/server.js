// import sendMetaPurchasePixel from "./sendMetaPurchasePixel.js";
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
import { Resend } from "resend";
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

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

// CRITICAL: Handle unhandled promise rejections to prevent crashes
process.on("unhandledRejection", (reason, promise) => {
  log(`❌ UNHANDLED REJECTION: ${reason}`);
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  log(`❌ UNCAUGHT EXCEPTION: ${error.message}`);
  console.error("Uncaught Exception:", error);
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

// Email configuration - Using Resend
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM =
  process.env.EMAIL_FROM || "Creative Technologies <ameerlunera@gmail.com>";
const BASE_URL = (process.env.BASE_URL || "https://samjhona.com").replace(
  /\/+$/,
  ""
);
const POST_PURCHASE_BASE_URL = BASE_URL;

// Email sending (can be disabled via env)
const EMAIL_SENDING_DISABLED = process.env.EMAIL_SENDING_DISABLED === "1";

// Instamojo configuration
const INSTAMOJO_API_KEY = process.env.INSTAMOJO_API_KEY || "";
const INSTAMOJO_AUTH_TOKEN = process.env.INSTAMOJO_AUTH_TOKEN || "";
const INSTAMOJO_SALT = process.env.INSTAMOJO_SALT || "";
const INSTAMOJO_API_BASE_URL = "https://www.instamojo.com/api/1.1";

log("🚀 Instamojo payment configured (samjhona.com)");
log(`   API Key: ${INSTAMOJO_API_KEY ? "***" + INSTAMOJO_API_KEY.slice(-4) : "NOT SET"}`);
log(`   Base URL: ${BASE_URL}`);

// Initialize Resend client
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Log Resend configuration at startup
if (RESEND_API_KEY) {
  log(
    `✅ Resend configured: API Key present (${RESEND_API_KEY.substring(
      0,
      10
    )}...)`
  );
  log(`✅ Email FROM: ${EMAIL_FROM}`);
} else {
  log(`⚠️ Resend API key not found - emails will not be sent`);
}

// Helper function to send post-purchase email using Resend
async function sendPostPurchaseEmail(email, fullName, postPurchaseLink) {
  if (EMAIL_SENDING_DISABLED) {
    // Intentionally do nothing (no outbound email).
    return null;
  }
  if (!resend || !RESEND_API_KEY) {
    log("⚠️ Resend not configured - skipping email send");
    log(`   RESEND_API_KEY: ${RESEND_API_KEY ? "SET" : "NOT SET"}`);
    return null;
  }

  if (!email) {
    log("⚠️ Email address not provided - skipping email send");
    return null;
  }

  try {
    log(`📧 Preparing to send email to ${email} from ${EMAIL_FROM}`);
    log(`📧 Post-purchase link: ${postPurchaseLink}`);

    const emailHtml = `
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
        <p><strong>WAIT FOR FEW SECONDS TO LOAD THE REPORT</strong></p>
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
          Support: <a href="mailto:ameerlunera@gmail.com" style="color: #f43f3f;">ameerlunera@gmail.com</a>
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: "Your report link",
      html: emailHtml,
    });

    if (error) {
      log(`❌ Resend error sending email to ${email}:`, error);
      log(`❌ Error details: ${JSON.stringify(error)}`);
      return null;
    }

    log(`✅ Post-purchase email sent successfully to ${email}`);
    log(`✅ Resend email ID: ${data?.id || "N/A"}`);
    return data;
  } catch (err) {
    log(`❌ Error sending email to ${email}: ${err.message}`);
    log(`❌ Error stack: ${err.stack}`);
    return null;
  }
}

// Validate Instamojo webhook MAC
function validateInstamojoWebhook(data, macProvided, salt) {
  const payload = { ...data };
  delete payload.mac;

  const message = Object.keys(payload)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => payload[key])
    .join("|");

  const macCalculated = crypto
    .createHmac("sha1", salt)
    .update(message)
    .digest("hex");
  return macCalculated === macProvided;
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
    res.json({
      success: true,
      message: "User data received (save may have failed)",
    });
  }
});

// Bypass payment — send email + redirect to Instamojo (for testing / direct order creation)
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
    const normalizedBase = String(POST_PURCHASE_BASE_URL || "").replace(
      /\/+$/,
      ""
    );
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
      // Store price details for downstream analytics (e.g., purchase pixel)
      amount: 99,
      currency: "INR",
      quantity: 1,
    });

    // Email sending temporarily disabled (per request)
    // if (!EMAIL_SENDING_DISABLED) {
    //   // Send email after data is stored (small delay helps consistency)
    //   setTimeout(() => {
    //     sendPostPurchaseEmail(email, fullName || "there", postPurchaseLink)
    //       .then(() =>
    //         collection.updateOne(
    //           { orderId },
    //           { $set: { emailSent: true, emailSentAt: new Date() } }
    //         )
    //       )
    //       .catch(() => {});
    //   }, 2000);
    // }

    return res.json({ success: true, orderId });
  } catch (err) {
    log("❌ Bypass error:", err?.message || String(err));
    return res.status(500).json({ error: "Bypass failed" });
  }
});

// ===========================
// Instamojo payment endpoints
// ===========================
app.post("/api/payment/instamojo/create", async (req, res) => {
  const requestId = `imojo_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2, 10)}`;
  log("🔥 ========== INSTAMOJO PAYMENT REQUEST START ==========", {
    requestId,
  });

  try {
    // Validate configuration
    const missingConfig = [];
    if (!INSTAMOJO_API_KEY) missingConfig.push("INSTAMOJO_API_KEY");
    if (!INSTAMOJO_AUTH_TOKEN) missingConfig.push("INSTAMOJO_AUTH_TOKEN");
    if (!INSTAMOJO_SALT) missingConfig.push("INSTAMOJO_SALT");

    if (missingConfig.length) {
      log("❌ Instamojo config missing", { requestId, missingConfig });
      return res
        .status(500)
        .json({ error: "Instamojo not configured", missing: missingConfig });
    }

    const {
      amount,
      email,
      phone,
      buyer_name,
      existingOrderId,
      cards,
      profile,
      username: usernameBody,
    } = req.body;

    log("🔥 Instamojo request body received:", {
      requestId,
      amount: amount !== undefined ? String(amount) : "MISSING",
      email: email ? String(email).slice(0, 3) + "***" : "MISSING",
      phone: phone ? String(phone).slice(0, 3) + "***" : "MISSING",
      buyer_name: buyer_name
        ? String(buyer_name).slice(0, 3) + "***"
        : "MISSING",
    });

    if (
      !amount ||
      Number.isNaN(Number(amount)) ||
      !email ||
      !phone ||
      !buyer_name
    ) {
      log("❌ Instamojo invalid request body", { requestId });
      return res.status(400).json({
        error: "Invalid request",
        details: {
          amount: !amount ? "missing" : "present",
          email: !email ? "missing" : "present",
          phone: !phone ? "missing" : "present",
          buyer_name: !buyer_name ? "missing" : "present",
        },
      });
    }

    // Generate order + access token
    const orderId =
      existingOrderId ||
      `order_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const accessToken = crypto.randomBytes(32).toString("hex");
    const normalizedBase = String(POST_PURCHASE_BASE_URL || BASE_URL).replace(
      /\/+$/,
      ""
    );
    const redirectUrl = `${normalizedBase}/api/payment/instamojo/redirect`;
    const webhookUrl = `${normalizedBase}/api/payment/instamojo/webhook`;
    const postPurchaseLink = `${normalizedBase}/post-purchase?token=${encodeURIComponent(
      accessToken
    )}&order=${encodeURIComponent(orderId)}`;

    // Persist or update order
    try {
      const db = await connectDB();
      if (db) {
        const collection = db.collection(COLLECTION_NAME);
        const update = {
          instamojoOrderId: orderId,
          paymentMethod: "instamojo",
          instamojoAmount: Number(amount),
          instamojoStatus: "pending",
          accessToken,
          postPurchaseLink,
          email,
          phoneNumber: phone,
          fullName: buyer_name,
          amount: Number(amount),
          updatedAt: new Date(),
        };

        if (existingOrderId) {
          await collection.updateOne(
            { orderId: existingOrderId },
            { $set: update }
          );
        } else {
          await collection.insertOne({
            orderId,
            status: "pending",
            createdAt: new Date(),
            ...update,
          });
        }
        log("✅ Instamojo order stored", { requestId, orderId });
      }
    } catch (dbErr) {
      log("⚠️ Failed to store Instamojo order (continuing):", dbErr.message);
    }

    // Create payment request on Instamojo
    const paymentRequestData = new URLSearchParams({
      amount: String(amount),
      purpose: orderId, // custom identifier
      buyer_name: buyer_name,
      email: email,
      phone: phone,
      redirect_url: redirectUrl,
      webhook: webhookUrl,
      send_email: "false",
      send_sms: "false",
    });

    const apiUrl = `${INSTAMOJO_API_BASE_URL}/payment-requests/`;
    log("📤 Calling Instamojo API", { requestId, apiUrl });

    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "X-Api-Key": INSTAMOJO_API_KEY,
        "X-Auth-Token": INSTAMOJO_AUTH_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: paymentRequestData.toString(),
    });

    const rawResponse = await apiResponse.text();
    log("📥 Instamojo API responded", {
      requestId,
      status: apiResponse.status,
      ok: apiResponse.ok,
      preview: rawResponse.slice(0, 400),
    });

    if (!apiResponse.ok) {
      return res.status(502).json({
        error: "Instamojo payment creation failed",
        status: apiResponse.status,
        body: rawResponse,
        requestId,
      });
    }

    let responseData = null;
    try {
      responseData = JSON.parse(rawResponse);
    } catch (parseErr) {
      log("❌ Failed to parse Instamojo response", {
        requestId,
        parseErr: parseErr.message,
      });
      return res.status(500).json({
        error: "Invalid Instamojo response format",
        body: rawResponse.slice(0, 400),
        requestId,
      });
    }

    if (!responseData?.success || !responseData?.payment_request?.longurl) {
      log("❌ Instamojo returned invalid structure", {
        requestId,
        responseData,
      });
      return res.status(500).json({
        error: "Instamojo create payment failed",
        details: responseData?.message || "Invalid response",
        requestId,
      });
    }

    const longurl = responseData.payment_request.longurl;
    const paymentRequestId = responseData.payment_request.id;

    // Log the actual URL we're getting from Instamojo
    log("🔗 Instamojo longurl received:", { longurl, paymentRequestId });

    // Save Instamojo longurl in database
    try {
      const db = await connectDB();
      if (db) {
        const collection = db.collection(COLLECTION_NAME);
        await collection.updateOne(
          { orderId },
          {
            $set: {
              instamojoLongUrl: longurl,
            },
          }
        );
      }
    } catch (dbErr) {
      log("⚠️ Failed to save instamojoLongUrl:", dbErr.message);
    }

    // Persist payment_request_id
    try {
      const db = await connectDB();
      if (db) {
        const collection = db.collection(COLLECTION_NAME);
        await collection.updateOne(
          { orderId },
          { $set: { instamojoPaymentRequestId: paymentRequestId } }
        );
      }
    } catch (dbErr) {
      log("⚠️ Failed to save instamojoPaymentRequestId:", dbErr.message);
    }

    // Update order with report (cards, profile) in background — don't block redirect
    const cardsToStore = Array.isArray(cards) ? cards : [];
    const profileToStore =
      profile && typeof profile === "object" ? profile : null;
    const usernameToStore = String(usernameBody || "").trim() || null;
    const fullNameToStore = String(buyer_name || "").trim() || null;
    if (cardsToStore.length > 0) {
      const orderIdBg = orderId;
      setImmediate(() => {
        (async () => {
          try {
            const db = await connectDB();
            if (!db) return;
            const report = buildStoredReport({
              cards: cardsToStore,
              profile: profileToStore,
            });
            await db.collection(COLLECTION_NAME).updateOne(
              { orderId: orderIdBg },
              {
                $set: {
                  cards: cardsToStore,
                  profile: profileToStore,
                  report,
                  ...(usernameToStore && { username: usernameToStore }),
                  ...(fullNameToStore && { fullName: fullNameToStore }),
                },
              }
            );
            log("✅ Background report update done", { orderId: orderIdBg });
          } catch (e) {
            log(
              "❌ Background report update failed",
              e?.message || String(e)
            );
          }
        })();
      });
    }

    log("✅ ========== INSTAMOJO PAYMENT REQUEST SUCCESS ==========", {
      requestId,
      longurl,
      orderId,
      paymentRequestId,
    });

    return res.json({
      redirectUrl: longurl,
      requestId,
      orderId,
      paymentRequestId,
    });
  } catch (err) {
    log("❌ ========== INSTAMOJO PAYMENT REQUEST ERROR ==========", {
      requestId,
      errorName: err?.name,
      errorMessage: err?.message || String(err),
      errorStack: err?.stack,
    });
    return res.status(500).json({
      error: "Instamojo init failed",
      details: err?.message || String(err),
      requestId,
    });
  }
});

// Instamojo redirect handler
app.get("/api/payment/instamojo/redirect", async (req, res) => {
  try {
    const { payment_id, payment_request_id, payment_status } = req.query;
    log("🔄 Instamojo redirect", {
      payment_id,
      payment_request_id,
      payment_status,
    });

    if (!payment_request_id) {
      return res.redirect(`${BASE_URL}/payment-failed`);
    }

    const db = await connectDB();
    if (!db) {
      return res.redirect(`${BASE_URL}/payment-failed`);
    }
    const collection = db.collection(COLLECTION_NAME);

    const order = await collection.findOne({
      instamojoPaymentRequestId: payment_request_id,
    });
    if (!order) {
      log("❌ Order not found for payment_request_id", { payment_request_id });
      return res.redirect(`${BASE_URL}/payment-failed`);
    }

    // Verify status via API (best-effort)
    let isSuccess = false;
    try {
      const verifyResp = await fetch(
        `${INSTAMOJO_API_BASE_URL}/payment-requests/${payment_request_id}/`,
        {
          method: "GET",
          headers: {
            "X-Api-Key": INSTAMOJO_API_KEY,
            "X-Auth-Token": INSTAMOJO_AUTH_TOKEN,
          },
        }
      );
      if (verifyResp.ok) {
        const verifyData = await verifyResp.json();
        isSuccess =
          verifyData?.payment_request?.status === "Completed" ||
          String(payment_status).toLowerCase() === "credit";
      }
    } catch (verifyErr) {
      log(
        "⚠️ Instamojo verify failed, falling back to query param",
        verifyErr.message
      );
      isSuccess = String(payment_status).toLowerCase() === "credit";
    }

    if (isSuccess) {
      await collection.updateOne(
        { orderId: order.orderId },
        {
          $set: {
            status: "paid",
            verifiedAt: new Date(),
            instamojoPaymentId: payment_id || order.instamojoPaymentId || null,
            instamojoPaymentStatus: payment_status || "Credit",
          },
        }
      );

      const token = order.accessToken || crypto.randomBytes(32).toString("hex");
      if (!order.accessToken) {
        await collection.updateOne(
          { orderId: order.orderId },
          { $set: { accessToken: token } }
        );
      }

      const postPurchaseUrl = `${POST_PURCHASE_BASE_URL}/post-purchase?token=${encodeURIComponent(
        token
      )}&order=${encodeURIComponent(order.orderId)}`;

      // Email sending temporarily disabled (per request)
      // Send email with Instamojo longurl instead of post-purchase link
      // Ensure we have a working link and data is stored before sending
      if (!EMAIL_SENDING_DISABLED && order.email && order.instamojoLongUrl) {
        // Double-check the order has all required data before sending email
        const updatedOrder = await collection.findOne({
          orderId: order.orderId,
        });
        if (updatedOrder && updatedOrder.instamojoLongUrl) {
          // Log what URL we're actually sending in email
          let emailUrl = updatedOrder.instamojoLongUrl;

          // If instamojoLongUrl is incomplete, construct full URL
          if (emailUrl && !emailUrl.startsWith("http")) {
            emailUrl = `https://www.instamojo.com${
              emailUrl.startsWith("/") ? "" : "/"
            }${emailUrl}`;
          }

          // Final fallback: use postPurchaseUrl if Instamojo URL seems invalid
          if (!emailUrl || emailUrl.length < 20) {
            log("⚠️ Instamojo URL seems incomplete, using post-purchase URL");
            emailUrl = postPurchaseUrl;
          }

          log("📧 Sending email with URL:", {
            originalInstamojoUrl: updatedOrder.instamojoLongUrl,
            finalEmailUrl: emailUrl,
            postPurchaseUrl: postPurchaseUrl,
          });

          sendPostPurchaseEmail(
            order.email,
            order.fullName || "Customer",
            emailUrl
          )
            .then(() => {
              collection
                .updateOne(
                  { orderId: order.orderId },
                  { $set: { emailSent: true, emailSentAt: new Date() } }
                )
                .catch(() => {});
            })
            .catch((emailErr) => {
              log(`⚠️ Email sending failed: ${emailErr.message}`);
            });
        } else {
          log("⚠️ Order data not fully stored, skipping email send");
        }
      }

      log("✅ Redirecting to post-purchase", { postPurchaseUrl });
      return res.redirect(postPurchaseUrl);
    }

    log("⚠️ Instamojo payment not successful", { payment_status });
    return res.redirect(`${BASE_URL}/payment-failed`);
  } catch (err) {
    log("❌ Instamojo redirect handler error:", err?.message || String(err));
    return res.redirect(`${BASE_URL}/payment-failed`);
  }
});

// Instamojo webhook handler
// app.post("/api/payment/instamojo/webhook", async (req, res) => {
//   try {
//     const data = req.body || {};
//     const macProvided = data.mac;

//     if (!macProvided) {
//       log("❌ Instamojo webhook missing MAC");
//       return res.status(400).send("Missing MAC");
//     }

//     if (!validateInstamojoWebhook(data, macProvided, INSTAMOJO_SALT)) {
//       log("❌ Instamojo webhook MAC invalid");
//       return res.status(400).send("Invalid MAC");
//     }

//     const {
//       payment_id,
//       payment_request_id,
//       payment_status,
//       amount,
//       buyer,
//       buyer_name,
//       buyer_phone,
//     } = data;

//     log("✅ Instamojo webhook validated", {
//       payment_id,
//       payment_request_id,
//       payment_status,
//       amount,
//     });

//     if (
//       String(payment_status).toLowerCase() === "credit" &&
//       payment_request_id
//     ) {
//       const db = await connectDB();
//       if (db) {
//         const collection = db.collection(COLLECTION_NAME);
//         const order = await collection.findOne({
//           instamojoPaymentRequestId: payment_request_id,
//         });

//         if (order) {
//           const token =
//             order.accessToken || crypto.randomBytes(32).toString("hex");
//           const normalizedBase = String(
//             POST_PURCHASE_BASE_URL || BASE_URL
//           ).replace(/\/+$/, "");
//           const postPurchaseLink = `${normalizedBase}/post-purchase?token=${encodeURIComponent(
//             token
//           )}&order=${encodeURIComponent(order.orderId)}`;

//           await collection.updateOne(
//             { orderId: order.orderId },
//             {
//               $set: {
//                 status: "paid",
//                 verifiedAt: new Date(),
//                 instamojoPaymentId: payment_id,
//                 instamojoPaymentStatus: payment_status,
//                 accessToken: token,
//                 postPurchaseLink,
//                 email: order.email || buyer || null,
//                 fullName: order.fullName || buyer_name || "",
//                 phoneNumber:
//                   order.phoneNumber || buyer_phone || order.phone || "",
//               },
//             }
//           );

//           // Fire Meta Conversions API for Purchase
//           try {
//             await sendMetaPurchasePixel({
//               pixelId: "710646615238495",
//               accessToken: process.env.META_ACCESS_TOKEN,
//               eventId: order.orderId,
//               value: order.amount || 99,
//               currency: order.currency || "INR",
//               orderId: order.orderId,
//               quantity: order.quantity || 1,
//               sourceUrl: POST_PURCHASE_BASE_URL,
//               userData: {}, // Optionally use hashed email/phone
//             });
//           } catch (e) {
//             log("⚠️ Meta Pixel backend fire failed:", e.message);
//           }

//           log("✅ Order updated via Instamojo webhook", {
//             orderId: order.orderId,
//           });
//         } else {
//           log("⚠️ Instamojo webhook: order not found", { payment_request_id });
//         }
//       }
//     }

//     return res.status(200).send("OK");
//   } catch (err) {
//     log("❌ Instamojo webhook handler error:", err?.message || String(err));
//     return res.status(500).send("Error");
//   }
// });




app.post("/api/payment/instamojo/webhook", async (req, res) => {
  try {
    const payload = req.body;
    const macProvided = payload.mac;

    // 1️⃣ Validate MAC (VERY IMPORTANT)
    if (!macProvided) {
      log("❌ Instamojo webhook missing MAC");
      return res.status(400).send("Invalid webhook");
    }

    const isValidMac = validateInstamojoWebhook(
      payload,
      macProvided,
      INSTAMOJO_SALT
    );

    if (!isValidMac) {
      log("❌ Instamojo webhook MAC validation failed");
      return res.status(400).send("Invalid MAC");
    }

    const {
      payment_id,
      payment_request_id,
      payment_status,
      buyer,
      amount,
      currency,
    } = payload;

    log("🔔 Instamojo webhook received", {
      payment_request_id,
      payment_id,
      payment_status,
    });

    // 2️⃣ We ONLY care about successful payments
    if (payment_status !== "Credit") {
      log("⚠️ Ignoring non-credit webhook", { payment_status });
      return res.status(200).send("Ignored");
    }

    const db = await connectDB();
    if (!db) {
      log("❌ DB not available in webhook");
      return res.status(500).send("DB unavailable");
    }

    const collection = db.collection(COLLECTION_NAME);

    // 3️⃣ Find order
    const order = await collection.findOne({
      instamojoPaymentRequestId: payment_request_id,
    });

    if (!order) {
      log("❌ Order not found for webhook", { payment_request_id });
      return res.status(404).send("Order not found");
    }

    // 4️⃣ Idempotency guard (CRITICAL)
    if (order.purchasePixelFired === true) {
      log("⚠️ Purchase pixel already fired, skipping", {
        orderId: order.orderId,
      });
      return res.status(200).send("Already processed");
    }

    // 5️⃣ Fire Meta Purchase (SERVER SIDE)
    // try {
    //   await sendMetaPurchasePixel({
    //     orderId: order.orderId,
    //     value: Number(order.amount || amount || 99),
    //     currency: order.currency || currency || "INR",
    //     email: order.email,
    //     phone: order.phoneNumber,
    //   });

    //   log("✅ Meta Purchase fired (server)", {
    //     orderId: order.orderId,
    //   });
    // } catch (pixelErr) {
    //   log("❌ Meta Purchase failed", pixelErr.message);
    //   // DO NOT return — payment is still valid
    // }

    // 6️⃣ Update order as PAID + mark pixel fired
    await collection.updateOne(
      { orderId: order.orderId },
      {
        $set: {
          status: "paid",
          instamojoStatus: "credit",
          instamojoPaymentId: payment_id,
          purchasePixelFired: true,
          purchasePixelFiredAt: new Date(),
          paidAt: new Date(),
        },
      }
    );

    log("✅ Order marked as PAID", { orderId: order.orderId });

    // 7️⃣ Always return 200 to Instamojo
    return res.status(200).send("OK");
  } catch (err) {
    log("❌ Instamojo webhook error", err?.message || String(err));
    return res.status(500).send("Webhook error");
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
      report = buildStoredReport({
        cards: orderDoc.cards,
        profile: orderDoc.profile,
      });
      collection
        .updateOne({ orderId: order }, { $set: { report } })
        .catch(() => {});
    }

    // Provide pricing details (with safe fallbacks) for accurate pixel tracking
    const quantity = Number(orderDoc.quantity || 1) || 1;
    const amount =
      Number(
        orderDoc.amount ||
          orderDoc.order_amount ||
          orderDoc.instamojoAmount ||
          (orderDoc.amountDetails && orderDoc.amountDetails.amount)
      ) || 99;
    const currency =
      orderDoc.currency ||
      orderDoc.order_currency ||
      orderDoc.instamojoCurrency ||
      "INR";

    return res.json({
      success: true,
      orderId: orderDoc.orderId,
      email: orderDoc.email,
      fullName: orderDoc.fullName,
      username: orderDoc.username || null,
      cards: orderDoc.cards || [],
      profile: orderDoc.profile || null,
      report: report,
      amount,
      currency,
      quantity,
    });
  } catch (error) {
    log(
      "❌ Error validating post-purchase link:",
      error?.message || String(error)
    );
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to validate link",
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
    `📍 Payment Endpoint: http://localhost:${PORT}/api/payment/instamojo/create`
  );
  log("⏱️  Expected response time: 30-60 seconds per request");
  log("🗄️  Snapshots stored in MongoDB (auto-deleted after 10 minutes)");
});
