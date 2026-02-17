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
import connectMongoose from "./utils/db.js"; // Import Mongoose connection
import { ObjectId } from "mongodb";
import User from "./models/User.js"; // Import Mongoose User model
import { Resend } from "resend";
import crypto from "crypto";
import axios from "axios";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const PaytmChecksum = require("paytmchecksum");

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

// Paytm — temporarily hardcoded (move to .env later)
const PAYTM_MID = (process.env.PAYTM_MID || "SCINKF38676225955152").trim();
const PAYTM_MERCHANT_KEY = (process.env.PAYTM_MERCHANT_KEY || "Q22WldyyCskNM&%&").trim();
const PAYTM_WEBSITE = (process.env.PAYTM_WEBSITE || "WEBSTAGING").trim();
const PAYTM_ENV = (process.env.PAYTM_ENV || "STAGING").trim().toUpperCase();

// COMMENTED OUT: Cashfree configuration (replaced by Paytm)
// const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
// const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
// const CASHFREE_ENV = process.env.CASHFREE_ENV || "PRODUCTION";
// const CASHFREE_API_BASE_URL = CASHFREE_ENV === "TEST" || CASHFREE_ENV === "SANDBOX"
//   ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";

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

// Email configuration (also used for Paytm callback)
// Local: http://localhost:5173 (frontend; proxy /api to backend). Production: https://samjhona.com
const BASE_URL = (process.env.BASE_URL || "http://localhost:5173").replace(
  /\/+$/,
  ""
);

// Paytm API URLs (direct integration — no SDK)
const PAYTM_INITIATE_URL =
  PAYTM_ENV === "PRODUCTION"
    ? "https://securegw.paytm.in/theia/api/v1/initiateTransaction"
    : "https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction";
const PAYTM_PAYMENT_URL =
  PAYTM_ENV === "PRODUCTION"
    ? "https://securegw.paytm.in/theia/api/v1/showPaymentPage"
    : "https://securegw-stage.paytm.in/theia/api/v1/showPaymentPage";

log(`🚀 Paytm (direct API): MID=${PAYTM_MID}, website=${PAYTM_WEBSITE}, callback=${BASE_URL}/api/payment/paytm-callback`);

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

    // Optional DB save (Native)
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

        // ✅ Update Mongoose User Model
        try {
          const cleanUsername = username.replace(/^@/, "").toLowerCase().trim();
          await User.findOneAndUpdate(
            { username: cleanUsername },
            {
              $set: {
                paymentDetails: { orderId, method: "bypass" },
                isPaid: true,
                email: email,
                fullName: fullName,
                updatedAt: new Date()
              }
            },
            { upsert: true }
          );
          log(`✅ User updated in Mongoose (Bypass): ${cleanUsername}`);
        } catch (mongooseErr) {
          log(`⚠️ Failed to update User model in bypass: ${mongooseErr.message}`);
        }
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

// ============================================================================
// PAYTM PAYMENT ROUTES
// ============================================================================

// Create Paytm order — direct API (initiateTransaction) with axios + paytmchecksum
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { amount, email, fullName, phoneNumber, username, cards, profile } = req.body;

    log(`📥 Create order request: amount=${amount}, email=${email}`);

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ error: "Amount is required and must be greater than 0" });
    }

    const orderId =
      "ORDER_" +
      Date.now() +
      "_" +
      Math.random().toString(36).substring(2, 12);
    const amountStr = Number(amount).toFixed(2);
    const customerId = email || "CUST_" + Date.now();
    const callbackUrl = `${BASE_URL}/api/payment/paytm-callback`;

    // IMPORTANT: Build body keys in same order as Paytm's Node SDK does
    // (helps avoid signature mismatches that Paytm often surfaces as "System Error")
    const requestBody = {
      requestType: "Payment",
      mid: PAYTM_MID,
      orderId,
      websiteName: PAYTM_WEBSITE,
      txnAmount: { value: amountStr, currency: "INR" },
      userInfo: {
        custId: customerId,
        email: email || "",
        firstName: (fullName || email || "Customer").slice(0, 50),
        mobile: phoneNumber || "",
      },
      callbackUrl,
    };

    log(`💰 Creating Paytm txn token: ₹${amountStr}, orderId=${orderId}`);

    const signature = await PaytmChecksum.generateSignature(
      JSON.stringify(requestBody),
      PAYTM_MERCHANT_KEY
    );

    // Build head similar to SDK (Paytm may reject if required header fields missing)
    const head = {
      version: "v2",
      channelId: "WEB",
      requestTimestamp: Date.now().toString(),
      workFlow: null,
      clientId: PAYTM_MID,
      signature,
    };

    const apiUrl = `${PAYTM_INITIATE_URL}?mid=${encodeURIComponent(PAYTM_MID)}&orderId=${encodeURIComponent(orderId)}`;
    const { data } = await axios.post(
      apiUrl,
      { body: requestBody, head },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const resBody = data?.body ?? data;
    const txnToken = resBody?.txnToken;

    if (!txnToken) {
      const resultInfo = resBody?.resultInfo || {};
      const paytmMsg = resultInfo.resultMsg || resultInfo.resultCode || "";
      const details = paytmMsg
        ? `Paytm: ${paytmMsg} (code: ${resultInfo.resultCode || "—"})`
        : "No txnToken in response";
      log("❌ No txnToken in Paytm response:", JSON.stringify(data));
      return res.status(500).json({
        error: "Failed to create payment token",
        details,
      });
    }

    log(`✅ Paytm order created: ${orderId}`);

    // Save order to MongoDB
    try {
      const database = await connectDB();
      if (database) {
        const collection = database.collection(COLLECTION_NAME);
        await collection.insertOne({
          orderId,
          email: email || "",
          fullName: fullName || email || "",
          phoneNumber: phoneNumber || "",
          amount: Number(amount),
          status: "created",
          provider: "paytm",
          username: username || null,
          cards: Array.isArray(cards) ? cards : [],
          profile: profile && typeof profile === "object" ? profile : null,
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

    res.json({
      orderId,
      txnToken,
      mid: PAYTM_MID,
      paytmPaymentUrl: PAYTM_PAYMENT_URL,
      amount: Number(amount),
      currency: "INR",
    });
  } catch (err) {
    log("❌ Error creating Paytm order:", err.message);
    console.error("Paytm createTxnToken error:", err);
    res.status(500).json({
      error: "Failed to create Paytm order",
      details: err.message,
    });
  }
});

function redirectHtml(url) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url.replace(/"/g, "&quot;")}"></head><body>Redirecting…</body></html>`;
}

// Paytm callback (user's browser is redirected here after payment; Paytm POSTs form data)
app.post(
  "/api/payment/paytm-callback",
  express.urlencoded({ extended: true }),
  async (req, res) => {

// (Paytm callback body - verify route removed)
    try {
      const body = { ...req.body };
      const checksumHash = body.CHECKSUMHASH || body.checksumhash;
      const orderId = body.ORDERID || body.orderId;

      log(`📥 Paytm callback: ORDERID=${orderId}, STATUS=${body.STATUS || body.status}`);

      if (!orderId || !checksumHash) {
        return res.status(400).send(redirectHtml(`${BASE_URL}/?payment=failed&reason=invalid_callback`));
      }

      const isSignatureValid = PaytmChecksum.verifySignature(body, PAYTM_MERCHANT_KEY, checksumHash);
      if (!isSignatureValid) {
        return res.status(400).send(redirectHtml(`${BASE_URL}/?payment=failed&reason=invalid_checksum`));
      }

      const status = (body.STATUS || body.status || "").toUpperCase();
      if (status !== "TXN_SUCCESS") {
        return res.send(redirectHtml(`${BASE_URL}/?payment=failed&order=${encodeURIComponent(orderId)}`));
      }

      const txnId = body.TXNID || body.txnId || "";

      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          const existingOrder = await collection.findOne({ orderId });
          const accessToken = crypto.randomBytes(32).toString("hex");
          const postPurchaseLink = `${BASE_URL}/post-purchase?token=${encodeURIComponent(accessToken)}&order=${encodeURIComponent(orderId)}`;
          const updateData = {
            status: "paid",
            paymentId: txnId,
            verifiedAt: new Date(),
            postPurchaseLink,
            accessToken,
            emailSent: false,
          };
          if (!existingOrder?.report && Array.isArray(existingOrder?.cards) && existingOrder.cards.length > 0) {
            updateData.report = buildStoredReport({ cards: existingOrder.cards, profile: existingOrder.profile });
          }
          await collection.updateOne({ orderId }, { $set: updateData });
          log(`✅ Order ${orderId} marked as paid`);
          const order = await collection.findOne({ orderId });
          if (order?.email) {
            if (order.username) {
              try {
                const cleanUsername = order.username.replace(/^@/, "").toLowerCase().trim();
                await User.findOneAndUpdate(
                  { username: cleanUsername },
                  { $set: { paymentDetails: { orderId, paymentId: txnId }, isPaid: true, email: order.email, fullName: order.fullName || "", phoneNumber: order.phoneNumber || "", updatedAt: new Date() } },
                  { upsert: true }
                );
                log(`✅ User updated in Mongoose (Paytm): ${cleanUsername}`);
              } catch (mongooseErr) {
                log(`⚠️ Mongoose update failed: ${mongooseErr.message}`);
              }
            }
            sendPostPurchaseEmail(order.email, order.fullName || "Customer", postPurchaseLink)
              .then(() => collection.updateOne({ orderId }, { $set: { emailSent: true, emailSentAt: new Date() } }).catch(() => {}))
              .catch((emailErr) => log(`⚠️ Email failed: ${emailErr.message}`));
          }
        }
      } catch (dbErr) {
        log(`⚠️ DB error in callback: ${dbErr.message}`);
      }

      res.send(redirectHtml(postPurchaseLink));
    } catch (err) {
      log(`❌ Paytm callback error: ${err.message}`);
      res.status(500).send(redirectHtml(`${BASE_URL}/?payment=failed&reason=error`));
    }
  }
);

// (Razorpay verify route removed)
// Validate post-purchase link endpoint (kept from original - not Cashfree-specific)
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

// ============================================================================
// COMMENTED OUT: CASHFREE PAYMENT ROUTES (replaced by Razorpay above)
// ============================================================================
// app.post("/api/payment/create-session", async (req, res) => { ... });
// app.get("/api/payment/environment", async (req, res) => { ... });
// app.get("/api/payment/verify", async (req, res) => { ... });
// app.post("/api/payment/verify", async (req, res) => { ... });
// app.get("/api/payment/post-purchase", async (req, res) => { ... });
// app.get("/api/payment/test-credentials", async (req, res) => { ... });


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
// Initialize MongoDB on server start (non-blocking)
connectDB().catch((err) => {
  log(
    "⚠️ MongoDB connection failed on startup (will retry on first use):",
    err.message
  );
});

// Initialize Mongoose connection
connectMongoose();

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
