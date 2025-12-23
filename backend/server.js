// Load environment variables FIRST (before any other imports that need them)
// Use dynamic import to load dotenv synchronously
// Always load .env file, regardless of NODE_ENV (needed for PM2 production)
try {
  // Use import() with await at top level (ES modules support this)
  const dotenvModule = await import('dotenv');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Explicitly specify .env file path
  const envPath = path.join(__dirname, '.env');
  const result = dotenvModule.default.config({ path: envPath });
  if (result.error) {
    console.warn('⚠️  Error loading .env file:', result.error.message);
  } else {
    console.log('✅ Loaded .env file from:', envPath);
  }
} catch (e) {
  // dotenv not installed, continue without it
  console.warn('⚠️  dotenv not available, using environment variables from system:', e.message);
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
  closeDB 
} from "./utils/mongodb.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors({
  origin: ["https://whoviewedmyprofile.in", "http://localhost:5173", "http://localhost:3000"],
  credentials: true
}));
// For parsing JSON request bodies (pageState can be large)
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Always return JSON for body parse errors (prevents HTML responses that break frontend JSON parsing)
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Payload too large",
      code: "PAYLOAD_TOO_LARGE",
    });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON payload",
      code: "INVALID_JSON",
    });
  }
  return next(err);
});
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

// Razorpay configuration

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Validate required environment variables
if (!RAZORPAY_KEY_ID) {
  throw new Error("❌ RAZORPAY_KEY_ID environment variable is required. Please set it in .env file or Railway environment variables.");
}

if (!RAZORPAY_KEY_SECRET) {
  throw new Error("❌ RAZORPAY_KEY_SECRET environment variable is required. Please set it in .env file or Railway environment variables.");
}

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// Meta Conversions API configuration (optional but recommended for accurate tracking)
const META_PIXEL_ID = process.env.META_PIXEL_ID || '1752528628790870'; // Your pixel ID
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN; // Get from Meta Business Settings

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const BASE_URL = process.env.BASE_URL || 'https://whoviewedmyprofile.in';

// Create email transporter
const emailTransporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_PORT === 465,
  auth: EMAIL_USER && EMAIL_PASS ? {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  } : undefined,
});

// Verify transporter ONCE at startup (not per email)
if (EMAIL_USER && EMAIL_PASS) {
  emailTransporter.verify()
    .then(() => {
      log("✅ Email transporter ready and verified");
    })
    .catch((err) => {
      log(`❌ Email transporter verification failed at startup: ${err.message}`);
      log(`⚠️ Emails may not send. Check EMAIL_USER and EMAIL_PASS in .env`);
    });
} else {
  log(`⚠️ Email not configured - EMAIL_USER: ${EMAIL_USER ? 'SET' : 'NOT SET'}, EMAIL_PASS: ${EMAIL_PASS ? 'SET' : 'NOT SET'}`);
}

// Helper function to send post-purchase email
async function sendPostPurchaseEmail(email, fullName, postPurchaseLink) {
  if (!EMAIL_USER || !EMAIL_PASS) {
    log(`⚠️ Email not configured - EMAIL_USER: ${EMAIL_USER ? 'SET' : 'NOT SET'}, EMAIL_PASS: ${EMAIL_PASS ? 'SET' : 'NOT SET'}`);
    return null;
  }

  if (!emailTransporter) {
    log(`❌ Email transporter not initialized`);
    return null;
  }

  try {
    log(`📧 Preparing to send email to ${email} from ${EMAIL_USER}`);
    log(`📧 Post-purchase link: ${postPurchaseLink}`);

    const mailOptions = {
      from: `"Insta Reports" <${EMAIL_USER}>`,
      to: email,
      subject: 'Your report link',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f43f3f;">Thank you for your purchase!</h2>
          <p>Hi ${fullName || 'there'},</p>
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
            Support: <a href="mailto:velarlunera@gmail.com" style="color: #f43f3f;">velarlunera@gmail.com</a>
          </p>
        </div>
      `,
    };

    log(`📧 Sending email...`);
    const info = await emailTransporter.sendMail(mailOptions);
    log(`✅ Post-purchase email sent successfully to ${email}: ${info.messageId}`);
    log(`✅ Email response: ${JSON.stringify(info.response)}`);
    return info;
  } catch (err) {
    log(`❌ Error sending email to ${email}: ${err.message}`);
    log(`❌ Email error stack: ${err.stack}`);
    if (err.response) {
      log(`❌ Email error response: ${JSON.stringify(err.response)}`);
    }
    return null;
  }
}

// Helper function to send Meta Conversions API (CAPI) event
async function sendMetaCAPIEvent(eventName, eventData, userData = {}) {
  if (!META_ACCESS_TOKEN) {
    log('⚠️ META_ACCESS_TOKEN not configured - skipping server-side event tracking');
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events`;
    
    const payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventData.event_id, // Must match frontend eventID for deduplication
        event_source_url: eventData.event_source_url || 'https://whoviewedmyprofile.in',
        action_source: 'website',
        user_data: {
          em: userData.email ? crypto.createHash('sha256').update(userData.email.toLowerCase().trim()).digest('hex') : undefined,
          ph: userData.phone ? crypto.createHash('sha256').update(userData.phone.replace(/\D/g, '')).digest('hex') : undefined,
          client_ip_address: userData.ip,
          client_user_agent: userData.userAgent,
        },
        custom_data: {
          currency: eventData.currency,
          value: eventData.value,
          content_name: eventData.content_name,
          content_type: eventData.content_type,
          num_items: eventData.num_items,
          order_id: eventData.order_id,
          transaction_id: eventData.transaction_id,
        },
      }],
      access_token: META_ACCESS_TOKEN,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    
    if (response.ok && result.events_received > 0) {
      log(`✅ Meta CAPI: ${eventName} event sent successfully (${result.events_received} events received)`);
      return result;
    } else {
      log(`⚠️ Meta CAPI: ${eventName} event failed:`, result);
      return null;
    }
  } catch (err) {
    log(`❌ Meta CAPI error:`, err.message);
    return null;
  }
}

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

// Log credentials at startup to verify environment configuration
log(`🚀 Razorpay credentials loaded:`);
log(`   Key ID: ${RAZORPAY_KEY_ID ? RAZORPAY_KEY_ID.substring(0, 12) + '...' : 'MISSING'}`);
log(`   Key Secret length: ${RAZORPAY_KEY_SECRET ? RAZORPAY_KEY_SECRET.length : 0}`);
log(`   Key Secret (first 20 chars): ${RAZORPAY_KEY_SECRET ? RAZORPAY_KEY_SECRET.substring(0, 20) + '...' : 'MISSING'}`);

log(`📧 Email configuration:`);
log(`   EMAIL_USER: ${EMAIL_USER ? EMAIL_USER : '❌ NOT SET - EMAILS WILL NOT BE SENT!'}`);
log(`   EMAIL_PASS: ${EMAIL_PASS ? '✅ SET' : '❌ NOT SET - EMAILS WILL NOT BE SENT!'}`);
log(`   BASE_URL: ${BASE_URL}`);

// Save user data to MongoDB
app.post("/api/payment/save-user", async (req, res) => {
  try {
    const { email, fullName, phoneNumber } = req.body;
    
    if (!email || !fullName || !phoneNumber) {
      return res.status(400).json({ error: "Email, full name, and phone number are required" });
    }

    const database = await connectDB();
    if (!database) {
      log('⚠️ MongoDB not available, skipping save');
      // Still return success so payment flow can continue
      return res.json({ 
        success: true, 
        message: "User data received (MongoDB unavailable)" 
      });
    }

    const collection = database.collection(COLLECTION_NAME);
    
    const userData = {
      email,
      fullName,
      phoneNumber,
      createdAt: new Date(),
      status: "pending"
    };

    const result = await collection.insertOne(userData);
    log(`✅ User data saved: ${email}`);
    
    res.json({ 
      success: true, 
      userId: result.insertedId,
      message: "User data saved successfully" 
    });
  } catch (err) {
    log('❌ Error saving user data:', err.message);
    // Still return success so payment flow can continue even if DB fails
    res.json({ 
      success: true, 
      message: "User data received (save may have failed)" 
    });
  }
});

// Create Razorpay order
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes, email, fullName, phoneNumber } = req.body;
    
    // Hardcode amount to 99 INR if not provided or invalid
    const orderAmount = (amount && amount > 0) ? amount : 99; // Default to 99 INR
    
    log(`📥 Create order request: amount=${orderAmount}, email=${email}`);

    // Verify Razorpay is configured correctly
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay not configured properly");
    }
    
    // Format phone number
    let phone = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : '';
    if (phone.length > 10) {
      phone = phone.slice(-10);
    }
    
    // Generate unique receipt ID if not provided
    const receiptId = receipt || `receipt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Prepare notes with customer info
    const orderNotes = {
      ...notes,
      customer_email: email || "",
      customer_name: fullName || "",
      customer_phone: phone || "",
    };
    
    log(`💰 Creating Razorpay order: ₹${orderAmount} (Receipt: ${receiptId})`);
    
    // Create Razorpay order
    // Amount should be in paise (smallest currency unit)
    const options = {
      amount: Math.round(orderAmount * 100), // Convert rupees to paise
      currency: currency,
      receipt: receiptId,
      notes: orderNotes,
    };
    
    log(`📤 Creating Razorpay order with options: ${JSON.stringify(options)}`);
    
    const order = await razorpay.orders.create(options);
    
    log(`✅ Razorpay order created: ${order.id}`);
    log(`📡 Order ID: ${order.id}, Amount: ₹${orderAmount} (${order.amount} paise)`);
    
    // Save order to MongoDB (optional, don't fail if DB is unavailable)
    if (email && fullName && phoneNumber) {
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          
          await collection.insertOne({
            orderId: order.id,
            email,
            fullName,
            phoneNumber: phone,
            amount: orderAmount,
            razorpayOrderId: order.id,
            status: "created",
            createdAt: new Date(),
          });
          log(`✅ Order saved to MongoDB: ${order.id}`);
        }
      } catch (dbErr) {
        log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
      }
    }
    
    // Return order data for frontend
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: RAZORPAY_KEY_ID,
      receipt: order.receipt,
    });
  } catch (err) {
    log('❌ Error creating Razorpay order:', err.message);
    console.error('Full Razorpay error:', err);
    
    res.status(500).json({ 
      success: false,
      error: "Failed to create Razorpay order", 
      details: err.message,
      statusCode: err.statusCode || err.status,
    });
  }
});

// Verify payment signature endpoint - DOES EVERYTHING (verify + save + email) in ONE call
app.post("/api/payment/verify-payment", async (req, res) => {
  log(`🔔 Payment verification endpoint called`);
  // Don't log full body (pageState can be huge); log only a safe summary
  try {
    const body = req.body || {};
    log(`📦 Request body summary:`, {
      hasOrderId: !!body.orderId,
      hasPaymentId: !!body.paymentId,
      hasSignature: !!body.signature,
      hasPageState: !!body.pageState,
      pageStateKeys:
        body.pageState && typeof body.pageState === "object"
          ? Object.keys(body.pageState).slice(0, 25)
          : [],
    });
  } catch (e) {
    // ignore logging errors
  }
  
  // Ensure we always return JSON, even on errors
  try {
    const { orderId, paymentId, signature } = req.body;

    if (!orderId || !paymentId || !signature) {
      log(`❌ Missing parameters: orderId=${!!orderId}, paymentId=${!!paymentId}, signature=${!!signature}`);
      return res.status(400).json({ 
        success: false,
        error: 'Missing required payment verification parameters' 
      });
    }

    log(`🔍 Verifying payment: orderId=${orderId}, paymentId=${paymentId}`);

    // Create the signature string
    const text = `${orderId}|${paymentId}`;
    
    // Generate the expected signature
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');

    // Compare signatures
    if (expectedSignature === signature) {
      log(`✅ Payment verified successfully: ${paymentId}`);
      
      // Get user data from database for Meta CAPI
      let userData = {};
      let orderAmount = 99; // Default amount
      let userEmail = '';
      let userFullName = '';
      
      // Generate unique post-purchase link (token + order)
      const accessToken = crypto.randomBytes(32).toString('hex');
      const postPurchaseLink = `${BASE_URL}/post-purchase?token=${accessToken}&order=${orderId}`;
      
      // Update database after successful verification
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          
          // FIRST: Retrieve user data BEFORE updating (to get email)
          const order = await collection.findOne({ razorpayOrderId: orderId });
          if (order) {
            userData = {
              email: order.email,
              phone: order.phoneNumber,
              ip: req.ip || req.connection.remoteAddress,
              userAgent: req.headers['user-agent'],
            };
            userEmail = order.email;
            userFullName = order.fullName || 'Customer';
            orderAmount = order.amount ? order.amount / 100 : 99; // Convert paise to rupees
            log(`✅ Retrieved user data from database: email=${userEmail}, name=${userFullName}`);
          } else {
            log(`⚠️ Order ${orderId} not found in database`);
          }
          
          // Get complete page state from request body (frontend will send it)
          const { 
            username, 
            cards, 
            profile,
            pageState // Complete page state object
          } = req.body;
          
          const updateData = {
            status: "paid",
            paymentId: paymentId,
            verifiedAt: new Date(),
            postPurchaseLink: postPurchaseLink,
            accessToken: accessToken,
            emailSent: false,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year expiry
          };
          
          // Store complete page state if provided (preferred method)
          if (pageState && typeof pageState === 'object') {
            updateData.pageState = pageState;
            log(`📝 Saving complete pageState:`, {
              hasCards: Array.isArray(pageState.cards),
              cardsCount: pageState.cards?.length || 0,
              hasProfile: !!pageState.profile,
              hasPaymentSuccessCards: Array.isArray(pageState.paymentSuccessCards),
              hasPaymentSuccessLast7Summary: !!pageState.paymentSuccessLast7Summary,
              hasPaymentSuccessLast7Rows: Array.isArray(pageState.paymentSuccessLast7Rows),
              hasPaymentSuccess90DayVisits: typeof pageState.paymentSuccess90DayVisits === 'number',
              hasAnalysis: !!pageState.analysis
            });
          } else {
            // Fallback: store individual fields for backward compatibility
            if (username) {
              updateData.username = username;
              log(`📝 Saving username: ${username}`);
            }
            if (cards && Array.isArray(cards)) {
              updateData.cards = cards;
              log(`📝 Saving cards: ${cards.length} cards`);
            }
            if (profile) {
              updateData.profile = profile;
              log(`📝 Saving profile: ${profile.username || 'no username'}`);
            }
          }
          
          log(`💾 Updating order ${orderId} with page state data`);
          
          await collection.updateOne(
            { razorpayOrderId: orderId },
            { $set: updateData }
          );
          
          log(`✅ Database updated: Order ${orderId} marked as paid with profile data`);
        } else {
          log(`⚠️ MongoDB not available, skipping database update`);
        }
      } catch (dbErr) {
        log(`⚠️ Failed to update database (payment still verified): ${dbErr.message}`);
        // Don't fail the verification if DB update fails
      }
      
      // Send report email IMMEDIATELY after payment verification
      let emailSent = false;
      if (userEmail && postPurchaseLink) {
        log(`📧 Sending email immediately to: ${userEmail}`);
        log(`📧 Post-purchase link: ${postPurchaseLink}`);
        
        try {
          // Send email and wait for it to complete
          const emailResult = await sendPostPurchaseEmail(userEmail, userFullName, postPurchaseLink);
          
          if (emailResult) {
            log(`✅ Email sent successfully to ${userEmail}: ${emailResult.messageId}`);
            emailSent = true;
            
            // Update emailSent flag in database
            try {
              const database = await connectDB();
              if (database) {
                const collection = database.collection(COLLECTION_NAME);
                await collection.updateOne(
                  { razorpayOrderId: orderId },
                  { $set: { emailSent: true, emailSentAt: new Date() } }
                );
                log(`✅ Email sent flag updated in database for order ${orderId}`);
              }
            } catch (dbErr) {
              log(`⚠️ Failed to update emailSent flag: ${dbErr.message}`);
            }
          } else {
            log(`❌ Email sending returned null - EMAIL NOT CONFIGURED!`);
            log(`❌ Set EMAIL_USER and EMAIL_PASS in .env file!`);
          }
        } catch (emailErr) {
          log(`❌ Email sending failed (payment still verified): ${emailErr.message}`);
          log(`❌ Email error stack: ${emailErr.stack}`);
        }
      } else {
        log(`❌ Cannot send email - userEmail: ${userEmail ? 'SET' : 'NOT SET'}, postPurchaseLink: ${postPurchaseLink ? 'SET' : 'NOT SET'}`);
        log(`⚠️ Order ID: ${orderId}`);
      }
      
      // Meta Pixel tracking handled by browser on success page load (instant, no backend delay)
      
      // Always send JSON response, even if email fails
      res.json({
        success: true,
        message: 'Payment verified successfully',
        orderId,
        paymentId,
        postPurchaseLink, // Return link in response (optional, for frontend use)
        emailSent, // Let frontend know if email was sent
      });
    } else {
      log(`❌ Payment verification failed - Invalid signature`);
      res.status(400).json({
        success: false,
        error: 'Payment verification failed - Invalid signature',
      });
    }
  } catch (error) {
    log(`❌ Error verifying payment: ${error.message}`);
    log(`❌ Error stack: ${error.stack}`);
    // Always return JSON, never HTML - ensure proper error handling
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to verify payment',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// NEW: Get report by access token (clean URL approach)
app.get("/api/report/:token", async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token || token.length < 32) {
      return res.status(400).json({ error: "Invalid token" });
    }
    
    log(`🔍 Fetching report for token: ${token.substring(0, 10)}...`);
    
    const database = await connectDB();
    if (!database) {
      return res.status(503).json({ error: "Database unavailable" });
    }
    
    const collection = database.collection(COLLECTION_NAME);
    const order = await collection.findOne({ 
      accessToken: token,
      status: "paid"
    });
    
    if (!order) {
      return res.status(404).json({ error: "Report not found" });
    }
    
    // Check if expired
    if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
      return res.status(410).json({ error: "Report has expired" });
    }
    
    log(`✅ Report found for ${order.email}`);
    
    // Update last accessed time
    await collection.updateOne(
      { accessToken: token },
      { $set: { lastAccessedAt: new Date() } }
    );
    
    res.json({
      success: true,
      reportData: order.pageState || {
        profile: order.profile,
        cards: order.cards,
        username: order.username
      },
      purchaseDate: order.verifiedAt,
      customerName: order.fullName
    });
    
  } catch (error) {
    log(`❌ Error fetching report: ${error.message}`);
    res.status(500).json({ 
      error: "Failed to fetch report" 
    });
  }
});

// LEGACY: Validate post-purchase link endpoint (kept for backward compatibility)
app.get("/api/payment/post-purchase", async (req, res) => {
  try {
    const { token, order } = req.query;
    
    if (!token || !order) {
      return res.status(400).json({
        success: false,
        error: 'Missing token or order parameter'
      });
    }
    
    log(`🔍 Validating post-purchase link: order=${order}`);
    
    try {
      const database = await connectDB();
      if (!database) {
        return res.status(500).json({
          success: false,
          error: 'Database not available'
        });
      }
      
      const collection = database.collection(COLLECTION_NAME);
      const orderDoc = await collection.findOne({
        razorpayOrderId: order,
        accessToken: token,
        status: 'paid'
      });
      
      if (!orderDoc) {
        log(`❌ Invalid post-purchase link: order=${order}, token=${token.substring(0, 10)}...`);
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired link'
        });
      }
      
      log(`✅ Post-purchase link validated: order=${order}`);

      // Expiry check (if expiresAt exists)
      if (orderDoc.expiresAt && new Date(orderDoc.expiresAt) < new Date()) {
        return res.status(410).json({
          success: false,
          error: "This report has expired"
        });
      }

      // Best-effort lastAccessedAt update
      try {
        await collection.updateOne(
          { razorpayOrderId: order, accessToken: token },
          { $set: { lastAccessedAt: new Date() } }
        );
      } catch (updateErr) {
        log(`⚠️ Failed to update lastAccessedAt: ${updateErr.message}`);
      }
      
      // Return complete page state if available (preferred)
      if (orderDoc.pageState && typeof orderDoc.pageState === 'object') {
        log(`📋 Returning complete pageState from MongoDB`);
        res.json({
          success: true,
          orderId: orderDoc.razorpayOrderId,
          email: orderDoc.email,
          fullName: orderDoc.fullName,
          pageState: orderDoc.pageState // Return complete page state
        });
      } else {
        // Fallback: return individual fields for backward compatibility
        log(`📋 Returning individual fields (backward compatibility): username=${orderDoc.username || 'none'}, cards=${orderDoc.cards?.length || 0}, hasProfile=${!!orderDoc.profile}`);
        res.json({
          success: true,
          orderId: orderDoc.razorpayOrderId,
          email: orderDoc.email,
          fullName: orderDoc.fullName,
          username: orderDoc.username || null,
          cards: orderDoc.cards || [],
          profile: orderDoc.profile || null
        });
      }
    } catch (dbErr) {
      log(`❌ Database error validating post-purchase link: ${dbErr.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to validate link'
      });
    }
  } catch (error) {
    log(`❌ Error validating post-purchase link: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate link'
    });
  }
});

// Get payment details endpoint
app.get("/api/payment/payment/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    log(`🔍 Fetching payment details: ${paymentId}`);
    
    const payment = await razorpay.payments.fetch(paymentId);
    
    log(`✅ Payment details fetched: ${paymentId}`);
    res.json({
      success: true,
      payment,
    });
  } catch (error) {
    log(`❌ Error fetching payment: ${error.message}`);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to fetch payment details' 
    });
  }
});

// Get order details endpoint
app.get("/api/payment/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    log(`🔍 Fetching order details: ${orderId}`);
    
    const order = await razorpay.orders.fetch(orderId);
    
    log(`✅ Order details fetched: ${orderId}`);
    res.json({
      success: true,
      order,
    });
  } catch (error) {
    log(`❌ Error fetching order: ${error.message}`);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to fetch order details' 
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
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    log(`❌ Error serving snapshot: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve snapshot" });
  }
});

app.get("/api/stalkers", async (req, res) => {
  const startTime = Date.now();
  const username = req.query.username;
  
  log(`📥 New request received for username: ${username || 'MISSING'}`);
  
  if (!username) {
    log('❌ Request rejected: username required');
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
  const acceptHeader = req.headers.accept || '';
  const wantsSSE = acceptHeader.includes('text/event-stream') || req.query.stream === 'true';
  
  if (wantsSSE) {
    // Server-Sent Events streaming mode
    log(`📡 Starting SSE streaming for username: ${username}`);
    
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
      "X-Accel-Buffering": "no", // Disable NGINX buffering
    });

    // Send initial connection message
    res.write(`: connected\n\n`);
    
    // Flush headers immediately
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const send = (event, data) => {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(message);
        // Force flush to ensure real-time delivery
        if (typeof res.flush === 'function') {
          res.flush();
        }
        log(`📤 SSE event sent: ${event} (${event === 'snapshot' ? data.name : 'final'})`);
      } catch (err) {
        log(`⚠️ Error sending SSE event: ${err.message}`);
      }
    };

    // Use queue to handle concurrent requests
    scrapeQueue.enqueue(username, async (username) => {
      return await scrape(username, (step) => {
        log(`📤 Emitting snapshot via SSE: ${step.name}`);
        send("snapshot", step);
      });
    })
    .then((finalResult) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      log(`✅ Scrape completed successfully in ${duration}s`);
      log(`📊 Sending final result with ${finalResult.cards?.length || 0} cards`);
      send("done", finalResult);
      res.end();
    })
    .catch((err) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const errorMessage = err?.message || err?.toString() || 'Unknown error occurred';
      log(`❌ Scrape failed after ${duration}s:`, errorMessage);
      send("error", { error: errorMessage });
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
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
      log(`📊 Returning ${result.cards?.length || 0} cards and ${result.steps?.length || 0} snapshots`);
      res.json(result);
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const errorMessage = err?.message || err?.toString() || 'Unknown error occurred';
      log(`❌ Scrape failed after ${duration}s:`, errorMessage);
      log(`📋 Error details:`, err?.stack || 'No stack trace available');
      log(`📋 Full error object:`, JSON.stringify(err, Object.getOwnPropertyNames(err)));
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
      activeTabs = Number(await redis.get("active_tabs") || 0);
      activeBrowsers = Number(await redis.get("active_browsers") || 0);
    } catch (err) {
      log(`⚠️ Redis error reading stats (returning 0): ${err.message}`);
      // Continue with 0 values if Redis fails
    }
    
    res.json({
      browsers: {
        max: 4, // MAX_BROWSERS
        active: activeBrowsers
      },
      tabs: {
        active: activeTabs
      },
      users: {
        active: activeTabs, // Each tab = one active user request
        total: activeTabs
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    log(`❌ Error getting stats: ${err.message}`);
    res.status(500).json({ 
      error: "Failed to get stats", 
      details: err.message 
    });
  }
});

// Initialize MongoDB on server start (non-blocking)
connectDB().catch((err) => {
  log('⚠️ MongoDB connection failed on startup (will retry on first use):', err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log('🛑 SIGTERM received, closing connections...');
  await browserPool.close();
  await closeDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('🛑 SIGINT received, closing connections...');
  await browserPool.close();
  await closeDB();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 API server started on port ${PORT}`);
  log(`📍 Endpoint: http://localhost:${PORT}/api/stalkers?username=<instagram_username>`);
  log(`📍 Snapshot Endpoint: http://localhost:${PORT}/api/snapshots/:snapshotId/:stepName`);
  log(`📍 Payment Endpoint: http://localhost:${PORT}/api/payment/create-order`);
  log('⏱️  Expected response time: 30-60 seconds per request');
  log('🗄️  Snapshots stored in MongoDB (auto-deleted after 10 minutes)');
});

