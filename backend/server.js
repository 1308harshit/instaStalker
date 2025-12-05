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
import Razorpay from "razorpay";
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

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

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
app.post("/api/payment/create-session", async (req, res) => {
  try {
    const { amount, email, fullName, phoneNumber } = req.body;
    
    log(`📥 Create session request: amount=${amount}, email=${email}`);
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount is required and must be greater than 0" });
    }

    // Verify Razorpay instance is initialized correctly
    if (!razorpay) {
      throw new Error("Razorpay instance not initialized");
    }
    
    const amountInPaise = Math.round(amount * 100);
    log(`💰 Creating order: ${amountInPaise} paise (₹${amount})`);
    log(`🔑 Using Key ID: ${RAZORPAY_KEY_ID ? RAZORPAY_KEY_ID.substring(0, 12) + '...' : 'MISSING'}`);
    log(`🔑 Key ID full length: ${RAZORPAY_KEY_ID?.length || 0}`);
    log(`🔑 Key Secret length: ${RAZORPAY_KEY_SECRET?.length || 0}`);
    log(`🔑 Key Secret first 8 chars: ${RAZORPAY_KEY_SECRET ? RAZORPAY_KEY_SECRET.substring(0, 8) + '...' : 'MISSING'}`);
    
    // Log Razorpay instance details
    log(`🔍 Razorpay instance check: ${razorpay ? 'Initialized' : 'NOT INITIALIZED'}`);
    if (razorpay && razorpay.key_id) {
      log(`🔍 Razorpay SDK Key ID: ${razorpay.key_id.substring(0, 12)}...`);
    }

    // Create Razorpay order using SDK
    // Generate a unique receipt ID
    const receiptId = `receipt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    log(`📤 Calling Razorpay API: orders.create({ amount: ${amountInPaise}, currency: INR, receipt: ${receiptId} })`);
    
    const order = await razorpay.orders.create({
      amount: amountInPaise, // Convert to paise (199 → 19900)
      currency: "INR",
      receipt: receiptId, // Add receipt ID (sometimes required)
    });

    log(`✅ Razorpay order created: ${order.id}`);
    log(`📡 Amount: ${order.amount} paise (₹${amount})`);
    
    // Save order to MongoDB (optional, don't fail if DB is unavailable)
    if (email && fullName && phoneNumber) {
      try {
        const database = await connectDB();
        if (database) {
          const collection = database.collection(COLLECTION_NAME);
          // Format phone number
          let phone = phoneNumber.replace(/[^0-9]/g, '');
          if (phone.length > 10) {
            phone = phone.slice(-10);
          }
          
          await collection.insertOne({
            orderId: order.id,
            email,
            fullName,
            phoneNumber: phone,
            amount: amount,
            amountPaise: order.amount,
            status: "created",
            createdAt: new Date(),
          });
          log(`✅ Order saved to MongoDB: ${order.id}`);
        }
      } catch (dbErr) {
        log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
      }
    }
    
    // Return order with keyId for frontend
    res.json({
      ...order,
      keyId: RAZORPAY_KEY_ID, // Include keyId for frontend
    });
  } catch (err) {
    log('❌ Error creating Razorpay order:', err.message);
    console.error('Full Razorpay error:', err);
    
    // Check if it's an authentication error
    if (err.statusCode === 401 || err.error?.code === 'BAD_REQUEST_ERROR') {
      log('⚠️ Razorpay authentication failed. Please check your API keys.');
      log(`🔑 Key ID present: ${RAZORPAY_KEY_ID ? 'Yes (starts with ' + RAZORPAY_KEY_ID.substring(0, 8) + '...)' : 'No'}`);
      log(`🔑 Key Secret present: ${RAZORPAY_KEY_SECRET ? 'Yes (length: ' + RAZORPAY_KEY_SECRET.length + ')' : 'No'}`);
    }
    
    res.status(500).json({ 
      error: "Failed to create Razorpay order", 
      details: err.message,
      statusCode: err.statusCode || err.status,
      razorpayError: err.error || null
    });
  }
});

// Test Razorpay credentials endpoint (for debugging)
app.get("/api/payment/test-credentials", async (req, res) => {
  try {
    log('🧪 Testing Razorpay credentials...');
    
    // Try to create a minimal test order
    const testOrder = await razorpay.orders.create({
      amount: 100, // 1 rupee in paise
      currency: "INR",
      receipt: `test_${Date.now()}`,
    });
    
    log(`✅ Test order created successfully: ${testOrder.id}`);
    
    res.json({
      success: true,
      message: "Razorpay credentials are valid",
      testOrderId: testOrder.id,
      keyIdLength: RAZORPAY_KEY_ID?.length || 0,
      keySecretLength: RAZORPAY_KEY_SECRET?.length || 0,
    });
  } catch (err) {
    log('❌ Test order failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      statusCode: err.statusCode,
      razorpayError: err.error,
      keyIdLength: RAZORPAY_KEY_ID?.length || 0,
      keySecretLength: RAZORPAY_KEY_SECRET?.length || 0,
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

