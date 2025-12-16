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
import { Cashfree } from "cashfree-pg";
import { scrape } from "./scraper/scrape.js";
import { scrapeQueue } from "./utils/queue.js";
import { browserPool } from "./scraper/browserPool.js";
import { 
  connectDB, 
  getSnapshotStep, 
  getRecentSnapshot,
  closeDB 
} from "./utils/mongodb.js";

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

// Cashfree configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

// Validate required environment variables
if (!CASHFREE_APP_ID) {
  throw new Error("❌ CASHFREE_APP_ID environment variable is required. Please set it in .env file or Railway environment variables.");
}

if (!CASHFREE_SECRET_KEY) {
  throw new Error("❌ CASHFREE_SECRET_KEY environment variable is required. Please set it in .env file or Railway environment variables.");
}

// Initialize Cashfree instance
// Use explicit 'PRODUCTION' string to ensure correct endpoint (api.cashfree.com)
// Check available constants first, but fallback to string
let CASHFREE_ENV;
if (typeof Cashfree !== 'undefined') {
  if (Cashfree.PRODUCTION !== undefined) {
    CASHFREE_ENV = Cashfree.PRODUCTION;
  } else if (Cashfree.ENV_PRODUCTION !== undefined) {
    CASHFREE_ENV = Cashfree.ENV_PRODUCTION;
  } else {
    CASHFREE_ENV = 'PRODUCTION'; // Use string as fallback
  }
} else {
  CASHFREE_ENV = 'PRODUCTION';
}

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

const cashfree = new Cashfree(
  CASHFREE_ENV,
  CASHFREE_APP_ID,
  CASHFREE_SECRET_KEY
);

log(`🔧 Cashfree initialized with environment: ${CASHFREE_ENV}`);
log(`🔧 Environment type: ${typeof CASHFREE_ENV}, value: ${CASHFREE_ENV}`);
log(`🔧 Cashfree instance created, checking available methods...`);

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

// Create Cashfree payment session
app.post("/api/payment/create-session", async (req, res) => {
  try {
    const { amount, email, fullName, phoneNumber } = req.body;
    
    log(`📥 Create session request: amount=${amount}, email=${email}`);
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount is required and must be greater than 0" });
    }

    // Verify Cashfree instance is initialized correctly
    if (!cashfree) {
      throw new Error("Cashfree instance not initialized");
    }
    
    // Format phone number
    let phone = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : '';
    if (phone.length > 10) {
      phone = phone.slice(-10);
    }
    
    // Generate unique order ID
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    log(`💰 Creating payment session: ₹${amount} (Order ID: ${orderId})`);
    log(`🔑 Using App ID: ${CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 12) + '...' : 'MISSING'}`);
    
    // Create Cashfree payment session
    const orderRequest = {
      order_id: orderId,
      order_amount: amount, // Cashfree uses rupees, not paise
      order_currency: "INR",
      customer_details: {
        customer_id: email || `customer_${Date.now()}`,
        customer_name: fullName || "Customer",
        customer_email: email || "",
        customer_phone: phone || "",
      },
      order_meta: {
        return_url: `https://whoviewedmyprofile.in/payment/return?order_id={order_id}`,
        notify_url: `https://whoviewedmyprofile.in/api/payment/webhook`,
      },
    };
    
    log(`📤 Calling Cashfree API: PGCreateOrder`);
    log(`📦 Order Request: ${JSON.stringify(orderRequest)}`);
    
    // Cashfree SDK v5 - Try with explicit API version first (correct signature per docs)
    // Method signature: PGCreateOrder(apiVersion, orderRequest)
    // This ensures:
    // 1. Correct API version header (2023-08-01, not 2025-01-01)
    // 2. Correct endpoint (api.cashfree.com for PROD, not sandbox)
    // 3. Correct body (orderRequest JSON, not API version string)
    let response;
    
    try {
      // Try with explicit API version first
      if (typeof cashfree.PGCreateOrder === 'function') {
        log(`🔍 Attempting: cashfree.PGCreateOrder("2023-08-01", orderRequest)`);
        response = await cashfree.PGCreateOrder("2023-08-01", orderRequest);
      } else if (typeof cashfree.PG?.createOrder === 'function') {
        log(`🔍 Attempting: cashfree.PG.createOrder("2023-08-01", orderRequest)`);
        response = await cashfree.PG.createOrder("2023-08-01", orderRequest);
      } else {
        // Log available methods for debugging
        const availableMethods = Object.keys(cashfree).filter(key => typeof cashfree[key] === 'function');
        throw new Error(`Cashfree PGCreateOrder method not found. Available methods: ${availableMethods.join(', ')}`);
      }
    } catch (apiErr) {
      // Enhanced error logging to verify URL and body
      log(`❌ API call error: ${apiErr.message}`);
      if (apiErr.config) {
        log(`🌐 Request URL: ${apiErr.config.url}`);
        log(`📋 Request method: ${apiErr.config.method}`);
        const requestData = apiErr.config.data;
        if (typeof requestData === 'string') {
          log(`📋 Request data (string): ${requestData}`);
          log(`⚠️ WARNING: Request body is a string, not JSON object!`);
        } else {
          log(`📋 Request data (object): ${JSON.stringify(requestData)}`);
        }
        log(`📋 Request headers: ${JSON.stringify(apiErr.config.headers || {})}`);
      }
      if (apiErr.response) {
        log(`📋 Response status: ${apiErr.response.status}`);
        log(`📋 Response data: ${JSON.stringify(apiErr.response.data)}`);
      }
      
      // If error suggests wrong body format or authentication issue, try without API version
      const errorMsg = apiErr.message?.toLowerCase() || '';
      const responseData = apiErr.response?.data || {};
      const responseStr = JSON.stringify(responseData).toLowerCase();
      const requestDataStr = apiErr.config?.data || '';
      
      // Check if body is wrong (version string instead of order JSON) or authentication failed
      if (errorMsg.includes('authentication') || 
          errorMsg.includes('unauthorized') ||
          responseStr.includes('authentication') ||
          (typeof requestDataStr === 'string' && requestDataStr === '"2023-08-01"') ||
          (typeof requestDataStr === 'string' && requestDataStr.includes('2023-08-01') && !requestDataStr.includes('order_id'))) {
        log(`⚠️ First attempt failed, trying without explicit API version (SDK may handle it internally)`);
        try {
          if (typeof cashfree.PGCreateOrder === 'function') {
            log(`🔍 Attempting fallback: cashfree.PGCreateOrder(orderRequest)`);
            response = await cashfree.PGCreateOrder(orderRequest);
          } else if (typeof cashfree.PG?.createOrder === 'function') {
            log(`🔍 Attempting fallback: cashfree.PG.createOrder(orderRequest)`);
            response = await cashfree.PG.createOrder(orderRequest);
          }
        } catch (fallbackErr) {
          log(`❌ Fallback also failed: ${fallbackErr.message}`);
          if (fallbackErr.config) {
            log(`🌐 Fallback URL: ${fallbackErr.config.url}`);
            const fallbackData = fallbackErr.config.data;
            if (typeof fallbackData === 'string') {
              log(`📋 Fallback data (string): ${fallbackData}`);
            } else {
              log(`📋 Fallback data (object): ${JSON.stringify(fallbackData)}`);
            }
            log(`📋 Fallback headers: ${JSON.stringify(fallbackErr.config.headers || {})}`);
          }
          throw fallbackErr;
        }
      } else {
        throw apiErr;
      }
    }
    
    if (!response) {
      throw new Error("Invalid response from Cashfree API");
    }
    
    // Response might be direct or wrapped in .data
    const paymentSession = response.data || response;
    
    if (!paymentSession || !paymentSession.payment_session_id) {
      log(`⚠️ Warning: Unexpected response structure: ${JSON.stringify(response)}`);
      throw new Error("Payment session ID not found in response");
    }
    log(`✅ Cashfree payment session created: ${paymentSession.payment_session_id}`);
    log(`📡 Order ID: ${orderId}, Amount: ₹${amount}`);
    
    // Save order to MongoDB (optional, don't fail if DB is unavailable)
    if (email && fullName && phoneNumber) {
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          
          await collection.insertOne({
            orderId: orderId,
            paymentSessionId: paymentSession.payment_session_id,
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
        log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
      }
    }
    
    // Return payment session data for frontend
    // payment_session_id might be in different locations depending on SDK version
    const sessionId = paymentSession.payment_session_id || paymentSession.paymentSessionId || paymentSession.payment_sessionId;
    
    if (!sessionId) {
      log('⚠️ Warning: payment_session_id not found in response:', JSON.stringify(paymentSession));
      throw new Error("Payment session ID not found in response");
    }
    
    res.json({
      order_id: orderId,
      payment_session_id: sessionId,
      order_amount: amount,
      order_currency: "INR",
    });
  } catch (err) {
    log('❌ Error creating Cashfree payment session:', err.message);
    console.error('Full Cashfree error:', err);
    
    // Check if it's an authentication error
    if (err.statusCode === 401 || err.response?.status === 401) {
      log('⚠️ Cashfree authentication failed. Please check your API keys.');
      log(`🔑 App ID present: ${CASHFREE_APP_ID ? 'Yes (starts with ' + CASHFREE_APP_ID.substring(0, 8) + '...)' : 'No'}`);
      log(`🔑 Secret Key present: ${CASHFREE_SECRET_KEY ? 'Yes (length: ' + CASHFREE_SECRET_KEY.length + ')' : 'No'}`);
    }
    
    res.status(500).json({ 
      error: "Failed to create Cashfree payment session", 
      details: err.message,
      statusCode: err.statusCode || err.response?.status,
      cashfreeError: err.response?.data || null
    });
  }
});

// Test Cashfree credentials endpoint (for debugging)
app.get("/api/payment/test-credentials", async (req, res) => {
  try {
    log('🧪 Testing Cashfree credentials...');
    
    // Try to create a minimal test payment session
    const testOrderId = `test_${Date.now()}`;
    const testOrderRequest = {
      order_id: testOrderId,
      order_amount: 1, // 1 rupee
      order_currency: "INR",
      customer_details: {
        customer_id: "test_customer",
        customer_name: "Test Customer",
        customer_email: "[email protected]",
        customer_phone: "9999999999",
      },
      order_meta: {
        return_url: `https://whoviewedmyprofile.in/payment/return?order_id={order_id}`,
      },
    };
    
    // Use correct API version "2023-08-01" for production
    let response;
    try {
      log(`🔍 Test: Attempting cashfree.PGCreateOrder("2023-08-01", testOrderRequest)`);
      if (typeof cashfree.PGCreateOrder === 'function') {
        response = await cashfree.PGCreateOrder("2023-08-01", testOrderRequest);
      } else if (typeof cashfree.PG?.createOrder === 'function') {
        response = await cashfree.PG.createOrder("2023-08-01", testOrderRequest);
      } else {
        throw new Error("PGCreateOrder method not found");
      }
    } catch (err) {
      log(`❌ Test order error: ${err.message}`);
      if (err.config) {
        log(`🌐 Test URL: ${err.config.url}`);
        log(`📋 Test request data: ${typeof err.config.data === 'string' ? err.config.data : JSON.stringify(err.config.data)}`);
        log(`📋 Test headers: ${JSON.stringify(err.config.headers || {})}`);
      }
      // Try fallback without API version
      if (err.response?.status === 401 || err.message?.includes('authentication')) {
        log(`⚠️ Test: Trying fallback without API version`);
        try {
          if (typeof cashfree.PGCreateOrder === 'function') {
            response = await cashfree.PGCreateOrder(testOrderRequest);
          } else if (typeof cashfree.PG?.createOrder === 'function') {
            response = await cashfree.PG.createOrder(testOrderRequest);
          }
        } catch (fallbackErr) {
          log(`❌ Test fallback also failed: ${fallbackErr.message}`);
          throw fallbackErr;
        }
      } else {
        throw err;
      }
    }
    
    const paymentSession = response.data || response;
    log(`✅ Test payment session created successfully: ${paymentSession.payment_session_id}`);
    
    res.json({
      success: true,
      message: "Cashfree credentials are valid",
      testOrderId: testOrderId,
      testPaymentSessionId: paymentSession.payment_session_id,
      appIdLength: CASHFREE_APP_ID?.length || 0,
      secretKeyLength: CASHFREE_SECRET_KEY?.length || 0,
    });
  } catch (err) {
    log('❌ Test payment session failed:', err.message);
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
  log(`📍 Payment Endpoint: http://localhost:${PORT}/api/payment/create-session`);
  log('⏱️  Expected response time: 30-60 seconds per request');
  log('🗄️  Snapshots stored in MongoDB (auto-deleted after 10 minutes)');
});

