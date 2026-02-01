import Redis from "ioredis";

export const redis = new Redis({
  host: "127.0.0.1",
  port: 6379,
  retryStrategy: (times) => {
    // Retry with exponential backoff
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

// Handle connection events
redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

// Initialize counters to 0 if they don't exist
redis.get("active_tabs").then((val) => {
  if (val === null) {
    redis.set("active_tabs", "0");
  }
}).catch(() => {
  // Ignore if Redis is not available
});

redis.get("active_browsers").then((val) => {
  const n = parseInt(val, 10);
  if (val === null || isNaN(n) || n > 20) {
    redis.set("active_browsers", "0");
    if (n > 20) {
      console.log(`⚠️ Reset active_browsers from ${n} to 0 (stale/drifted counter)`);
    }
  }
}).catch(() => {
  // Ignore if Redis is not available
});

