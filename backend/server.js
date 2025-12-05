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
app.use(cors());
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
    const { email, fullName, phoneNumber, amount } = req.body;
    
    if (!email || !fullName || !phoneNumber) {
      return res.status(400).json({ error: "Email, full name, and phone number are required" });
    }

    const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const orderAmount = Math.round((amount || 199) * 100); // Convert to paise (multiply by 100)
    
    // Format phone number for Razorpay (10 digits, no country code needed)
    let phone = phoneNumber.replace(/[^0-9]/g, '');
    if (phone.length > 10) {
      phone = phone.slice(-10); // Take last 10 digits
    }

    // Create Razorpay order
    const razorpayOrderData = {
      amount: orderAmount, // Amount in paise
      currency: "INR",
      receipt: orderId,
      notes: {
        email: email,
        fullName: fullName,
        phoneNumber: phone,
      }
    };

    log(`📡 Creating Razorpay order: ${orderId}`);
    log(`📡 Amount: ${orderAmount} paise (₹${amount || 199})`);
    log(`📡 Request payload:`, JSON.stringify(razorpayOrderData, null, 2));
    
    // Call Razorpay API to create order
    const razorpayEndpoint = "https://api.razorpay.com/v1/orders";
    const authString = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const razorpayResponse = await fetch(razorpayEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`,
      },
      body: JSON.stringify(razorpayOrderData),
    });

    const responseText = await razorpayResponse.text();
    log(`📡 Razorpay API response status: ${razorpayResponse.status}`);
    log(`📡 Razorpay API response: ${responseText.substring(0, 500)}`);

    if (!razorpayResponse.ok) {
      log('❌ Razorpay API error:', responseText);
      return res.status(razorpayResponse.status).json({ 
        error: "Failed to create payment order",
        details: responseText,
        message: "Payment gateway error. Please check backend logs for details."
      });
    }

    let orderData;
    try {
      orderData = JSON.parse(responseText);
    } catch (parseErr) {
      log('❌ Failed to parse Razorpay response:', parseErr);
      return res.status(500).json({ 
        error: "Invalid response from payment gateway",
        details: responseText
      });
    }
    
    // Save order to MongoDB (optional, don't fail if DB is unavailable)
    try {
      const database = await connectDB();
      if (database) {
        const collection = database.collection(COLLECTION_NAME);
        await collection.insertOne({
          orderId: orderData.id,
          receipt: orderId,
          email,
          fullName,
          phoneNumber: phone,
          amount: amount || 199,
          amountPaise: orderAmount,
          status: "created",
          createdAt: new Date(),
        });
        log(`✅ Order saved to MongoDB: ${orderData.id}`);
      }
    } catch (dbErr) {
      log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
    }

    if (!orderData.id) {
      log('❌ No order ID in response:', JSON.stringify(orderData));
      return res.status(500).json({ 
        error: "Order ID not found in response",
        details: orderData
      });
    }

    log(`✅ Razorpay order created: ${orderData.id}`);
    
    res.json({
      success: true,
      orderId: orderData.id,
      razorpayOrderId: orderData.id,
      amount: orderAmount,
      currency: "INR",
      keyId: RAZORPAY_KEY_ID,
      orderData: orderData,
    });
  } catch (err) {
    log('❌ Error creating Razorpay order:', err.message);
    res.status(500).json({ error: "Failed to create payment order", details: err.message });
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

