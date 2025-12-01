// Load environment variables FIRST (before any other imports that need them)
// Use dynamic import to load dotenv synchronously
if (process.env.NODE_ENV !== 'production') {
  try {
    // Use import() with await at top level (ES modules support this)
    const dotenvModule = await import('dotenv');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Explicitly specify .env file path
    dotenvModule.default.config({ path: path.join(__dirname, '.env') });
  } catch (e) {
    // dotenv not installed, continue without it
    console.warn('⚠️  dotenv not available, using environment variables from system');
  }
}

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { scrape } from "./scraper/scrape.js";
import { scrapeQueue } from "./utils/queue.js";
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

// Cashfree configuration
const CASHFREE_API_KEY = process.env.CASHFREE_API_KEY;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
// Cashfree API base URL - sandbox for testing (default is acceptable)
const CASHFREE_API_URL = process.env.CASHFREE_API_URL;

// Validate required environment variables
if (!CASHFREE_API_KEY) {
  throw new Error("❌ CASHFREE_API_KEY environment variable is required. Please set it in .env file or Railway environment variables.");
}

if (!CASHFREE_SECRET_KEY) {
  throw new Error("❌ CASHFREE_SECRET_KEY environment variable is required. Please set it in .env file or Railway environment variables.");
} 
// Try different API versions - Cashfree supports multiple versions
const CASHFREE_API_VERSIONS = ["2023-08-01", "2022-09-01", "2021-05-21"];
const CASHFREE_API_VERSION = CASHFREE_API_VERSIONS[0]; // Start with latest

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

// Create Cashfree payment session
app.post("/api/payment/create-session", async (req, res) => {
  try {
    const { email, fullName, phoneNumber, amount } = req.body;
    
    if (!email || !fullName || !phoneNumber) {
      return res.status(400).json({ error: "Email, full name, and phone number are required" });
    }

    const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const orderAmount = amount || 199; // Default to 199₹
    
    // Create payment session with Cashfree
    // Format phone number (ensure it's 10 digits for India)
    let phone = phoneNumber.replace(/[^0-9]/g, '');
    if (phone.length === 10) {
      phone = `91${phone}`; // Add country code for India
    } else if (!phone.startsWith('91')) {
      phone = `91${phone}`;
    }

    // Generate valid customer_id (alphanumeric with underscores/hyphens only)
    // Cashfree requires customer_id to be alphanumeric and may contain underscore or hyphens
    const customerId = email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `customer_${Date.now()}`;

    const paymentData = {
      order_id: orderId,
      order_amount: orderAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: customerId,
        customer_name: fullName,
        customer_email: email,
        customer_phone: phone,
      },
      order_meta: {
        return_url: `${req.protocol}://${req.get('host')}/payment/return?order_id={order_id}`,
      }
    };

    // Call Cashfree API to create payment session
    // Cashfree PG API endpoint: /pg/orders
    const cashfreeEndpoint = `${CASHFREE_API_URL}/orders`;
    log(`📡 Calling Cashfree API: ${cashfreeEndpoint}`);
    log(`📡 Using API Key: ${CASHFREE_API_KEY.substring(0, 10)}...`);
    log(`📡 Using API Version: ${CASHFREE_API_VERSION}`);
    log(`📡 Secret Key length: ${CASHFREE_SECRET_KEY.length} chars`);
    log(`📡 Request payload:`, JSON.stringify(paymentData, null, 2));
    
    // Try with different API versions if first attempt fails
    let cashfreeResponse;
    let lastError;
    
    for (const apiVersion of CASHFREE_API_VERSIONS) {
      try {
        log(`🔄 Trying API version: ${apiVersion}`);
        cashfreeResponse = await fetch(cashfreeEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-version": apiVersion,
            "x-client-id": CASHFREE_API_KEY,
            "x-client-secret": CASHFREE_SECRET_KEY,
          },
          body: JSON.stringify(paymentData),
        });
        
        if (cashfreeResponse.ok) {
          log(`✅ Success with API version: ${apiVersion}`);
          break;
        } else if (cashfreeResponse.status !== 401) {
          // If not authentication error, break and use this response
          break;
        }
        // If 401, try next version
        const errorText = await cashfreeResponse.text();
        log(`⚠️ API version ${apiVersion} failed: ${errorText.substring(0, 200)}`);
        lastError = errorText;
      } catch (err) {
        log(`❌ Error with API version ${apiVersion}:`, err.message);
        lastError = err.message;
      }
    }
    
    if (!cashfreeResponse) {
      throw new Error("All API version attempts failed");
    }

    const responseText = await cashfreeResponse.text();
    log(`📡 Cashfree API response status: ${cashfreeResponse.status}`);
    log(`📡 Cashfree API response: ${responseText.substring(0, 500)}`);

    if (!cashfreeResponse.ok) {
      log('❌ Cashfree API error:', responseText);
      // Return more detailed error to frontend
      return res.status(cashfreeResponse.status).json({ 
        error: "Failed to create payment session",
        details: responseText,
        message: "Payment gateway error. Please check backend logs for details."
      });
    }

    let sessionData;
    try {
      sessionData = JSON.parse(responseText);
    } catch (parseErr) {
      log('❌ Failed to parse Cashfree response:', parseErr);
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
          orderId,
          email,
          fullName,
          phoneNumber,
          amount: orderAmount,
          paymentSessionId: sessionData.payment_session_id,
          status: "created",
          createdAt: new Date(),
        });
        log(`✅ Order saved to MongoDB: ${orderId}`);
      }
    } catch (dbErr) {
      log('⚠️ Failed to save order to MongoDB (continuing anyway):', dbErr.message);
    }

    // Cashfree returns payment_session_id in the response
    const paymentSessionId = sessionData.payment_session_id || sessionData.paymentSessionId || sessionData.session_id;
    
    if (!paymentSessionId) {
      log('❌ No payment session ID in response:', JSON.stringify(sessionData));
      return res.status(500).json({ 
        error: "Payment session ID not found in response",
        details: sessionData
      });
    }

    log(`✅ Payment session created: ${orderId}, Session ID: ${paymentSessionId}`);
    
    res.json({
      success: true,
      orderId,
      paymentSessionId: paymentSessionId,
      paymentData: sessionData,
    });
  } catch (err) {
    log('❌ Error creating payment session:', err.message);
    res.status(500).json({ error: "Failed to create payment session" });
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

  // Check for recent cached snapshot (within last hour)
  try {
    const recentSnapshot = await getRecentSnapshot(username, 60); // 60 minutes cache
    if (recentSnapshot) {
      log(`✅ Found cached snapshot for ${username} (created ${((Date.now() - recentSnapshot.createdAt) / 1000).toFixed(0)}s ago)`);
      
      const cachedSteps = recentSnapshot.steps.map(step => ({
        name: step.name,
        htmlPath: `/api/snapshots/${recentSnapshot._id}/${step.name}`,
        meta: step.meta
      }));
      
      return res.json({
        cards: recentSnapshot.cards || [],
        steps: cachedSteps,
        snapshotId: recentSnapshot._id.toString(),
        runId: recentSnapshot.runId,
        cached: true
      });
    }
  } catch (cacheErr) {
    log(`⚠️  Error checking cache: ${cacheErr.message}`);
    // Continue with scraping if cache check fails
  }

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
    });

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
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
  await closeDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('🛑 SIGINT received, closing connections...');
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

