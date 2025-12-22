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

const app = express();
app.use(cors({
  origin: ["https://whoviewedmyprofile.in", "http://localhost:5173", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json()); // For parsing JSON request bodies
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

// Verify payment signature endpoint
app.post("/api/payment/verify-payment", async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    if (!orderId || !paymentId || !signature) {
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
      
      // Update database after successful verification
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          
          const updateResult = await collection.updateOne(
            { razorpayOrderId: orderId },
            { 
              $set: { 
                status: "paid", 
                paymentId: paymentId,
                verifiedAt: new Date()
              } 
            }
          );
          
          if (updateResult.matchedCount > 0) {
            log(`✅ Database updated: Order ${orderId} marked as paid`);
            
            // Retrieve user data for Meta CAPI
            const order = await collection.findOne({ razorpayOrderId: orderId });
            if (order) {
              userData = {
                email: order.email,
                phone: order.phoneNumber,
                ip: req.ip || req.connection.remoteAddress,
                userAgent: req.headers['user-agent'],
              };
              orderAmount = order.amount ? order.amount / 100 : 99; // Convert paise to rupees
            }
          } else {
            log(`⚠️ Order ${orderId} not found in database (may have been created without user data)`);
          }
        } else {
          log(`⚠️ MongoDB not available, skipping database update`);
        }
      } catch (dbErr) {
        log(`⚠️ Failed to update database (payment still verified): ${dbErr.message}`);
        // Don't fail the verification if DB update fails
      }
      
      // Send Meta Conversions API (CAPI) Purchase event - Server-side tracking
      // This is CRITICAL for UPI flows where users may close browser before client-side pixel fires
      try {
        const metaEventId = `purchase_${orderId}_${Date.now()}`; // Must match frontend eventID for deduplication
        await sendMetaCAPIEvent('Purchase', {
          event_id: metaEventId,
          currency: 'INR',
          value: orderAmount,
          content_name: 'Instagram Stalker Report',
          content_type: 'product',
          num_items: 1,
          order_id: orderId,
          transaction_id: paymentId,
          event_source_url: 'https://whoviewedmyprofile.in',
        }, userData);
        log(`✅ Meta CAPI Purchase event sent for order: ${orderId}`);
      } catch (metaErr) {
        log(`⚠️ Meta CAPI event failed (payment still verified):`, metaErr.message);
        // Don't fail payment verification if Meta tracking fails
      }
      
      res.json({
        success: true,
        message: 'Payment verified successfully',
        orderId,
        paymentId,
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
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to verify payment' 
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

