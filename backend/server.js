import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { scrape } from "./scraper/scrape.js";

const app = express();
app.use(cors());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOT_ROOT = path.join(__dirname, "snapshots");
app.use("/snapshots", express.static(SNAPSHOT_ROOT));

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

app.get("/api/stalkers", async (req, res) => {
  const startTime = Date.now();
  const username = req.query.username;
  
  log(`📥 New request received for username: ${username || 'MISSING'}`);
  
  if (!username) {
    log('❌ Request rejected: username required');
    return res.json({ error: "username required" });
  }

  log(`⏱️  Starting scrape process... (this may take 30-60 seconds)`);
  
  try {
    const result = await scrape(username);
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
});

app.listen(3000, () => {
  log('🚀 API server started on port 3000');
  log('📍 Endpoint: http://localhost:3000/api/stalkers?username=<instagram_username>');
  log('⏱️  Expected response time: 30-60 seconds per request');
});

