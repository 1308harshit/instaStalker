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
// TEMPORARY: Hardcoded for testing (remove after fixing .env)
const CASHFREE_APP_ID = "1147729692de9b1aedf55a696b09277411";
const CASHFREE_SECRET_KEY = "cfsk_ma_prod_26bfec1cccfce1b21f9ca96bd38659d0_fa148335";

// Original (commented out for testing):
// const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
// const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

// Validate required environment variables
if (!CASHFREE_APP_ID) {
  throw new Error("❌ CASHFREE_APP_ID environment variable is required. Please set it in .env file or Railway environment variables.");
}

if (!CASHFREE_SECRET_KEY) {
  throw new Error("❌ CASHFREE_SECRET_KEY environment variable is required. Please set it in .env file or Railway environment variables.");
}

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

// Cashfree API Configuration
// Using direct HTTP requests instead of SDK (as per official documentation)
const CASHFREE_API_BASE_URL = "https://api.cashfree.com/pg";
const CASHFREE_API_VERSION = "2023-08-01";

log(`🔧 Cashfree configured for direct API calls:`);
log(`   App ID: ${CASHFREE_APP_ID ? CASHFREE_APP_ID.substring(0, 12) + '...' : 'MISSING'}`);
log(`   Secret Key: ${CASHFREE_SECRET_KEY ? 'Present (length: ' + CASHFREE_SECRET_KEY.length + ')' : 'MISSING'}`);
log(`   API Base URL: ${CASHFREE_API_BASE_URL}`);
log(`   API Version: ${CASHFREE_API_VERSION}`);

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

    // Verify Cashfree is configured correctly
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
      throw new Error("Cashfree not configured properly");
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
    
    log(`📤 Calling Cashfree API: POST ${CASHFREE_API_BASE_URL}/orders`);
    log(`📦 Order Request: ${JSON.stringify(orderRequest)}`);
    
    // Make direct HTTP request to Cashfree API (as per official documentation)
    // Headers: x-client-id, x-client-secret, x-api-version
    const apiUrl = `${CASHFREE_API_BASE_URL}/orders`;
    log(`🔍 Making POST request to: ${apiUrl}`);
    log(`📋 Headers: x-client-id, x-client-secret, x-api-version: ${CASHFREE_API_VERSION}`);
    
    // Debug: Log credentials being sent (first 20 chars of secret for security)
    log(`🔑 Credentials check:`);
    log(`   x-client-id: ${CASHFREE_APP_ID}`);
    log(`   x-client-secret (first 30 chars): ${CASHFREE_SECRET_KEY ? CASHFREE_SECRET_KEY.substring(0, 30) + '...' : 'MISSING'}`);
    log(`   x-client-secret length: ${CASHFREE_SECRET_KEY ? CASHFREE_SECRET_KEY.length : 0}`);
    log(`   x-client-secret ends with: ${CASHFREE_SECRET_KEY ? '...' + CASHFREE_SECRET_KEY.substring(CASHFREE_SECRET_KEY.length - 10) : 'MISSING'}`);
    
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
      log(`⚠️ Warning: Unexpected response structure: ${JSON.stringify(responseData)}`);
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
        log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
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
    log(`✅ Test payment session created successfully: ${responseData.payment_session_id}`);
    
    res.json({
      success: true,
      message: "Cashfree credentials are valid",
      testOrderId: testOrderId,
      testPaymentSessionId: responseData.payment_session_id,
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

