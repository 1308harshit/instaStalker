// backend/scraper/browserPool.js
import { launchBrowser } from "./browser.js";
import { redis } from "../utils/redis.js";

const MAX_BROWSERS = 4; // Controlled concurrency for 8 vCPU

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

class BrowserPool {
  constructor() {
    // Array to hold MAX_BROWSERS browser instances
    this.browsers = new Array(MAX_BROWSERS).fill(null);
    this.isLaunching = new Array(MAX_BROWSERS).fill(false);
    this.launchPromises = new Array(MAX_BROWSERS).fill(null);
    this.lastActivityTime = Date.now();
    this.watchdogInterval = null;
    this.keepAliveInterval = null;
    this.isCheckingHealth = false;
    // Round-robin counter for alternating between browsers
    this.currentBrowserIndex = 0;
    
    // Start watchdog and keep-alive on initialization
    this.startWatchdog();
    this.startKeepAlive();
  }

  /**
   * Get or create browser instance at specified index
   * Reuses existing browser, creates new one if needed
   */
  async getBrowser(index) {
    // Update activity time
    this.lastActivityTime = Date.now();
    
    // If browser exists and is connected, return it (already counted)
    if (this.browsers[index] && this.browsers[index].isConnected()) {
      return this.browsers[index];
    }

    // If browser is launching, wait for it
    if (this.isLaunching[index] && this.launchPromises[index]) {
      log(`⏳ Browser ${index} is launching, waiting...`);
      return await this.launchPromises[index];
    }

    // Launch new browser
    this.isLaunching[index] = true;
    log(`🚀 Launching new browser instance ${index}...`);
    
    this.launchPromises[index] = launchBrowser()
      .then(async (browser) => {
        this.browsers[index] = browser;
        this.isLaunching[index] = false;
        this.launchPromises[index] = null;
        this.lastActivityTime = Date.now();
        
        // Track browser launch in Redis
        try {
          await redis.incr("active_browsers");
          const browserCount = await redis.get("active_browsers");
          log(`✅ Browser instance ${index} ready and connected (total browsers: ${browserCount})`);
        } catch (err) {
          log(`⚠️ Redis error tracking browser (scraping continues): ${err.message}`);
        }
        
        // Track browser disconnect
        browser.on('disconnected', async () => {
          try {
            await redis.decr("active_browsers");
            const browserCount = await redis.get("active_browsers");
            log(`📉 Browser ${index} disconnected, total browsers: ${browserCount}`);
          } catch (err) {
            log(`⚠️ Redis error tracking browser disconnect (scraping continues): ${err.message}`);
          }
        });
        
        return browser;
      })
      .catch((err) => {
        this.isLaunching[index] = false;
        this.launchPromises[index] = null;
        log(`❌ Failed to launch browser ${index}:`, err.message);
        throw err;
      });

    return await this.launchPromises[index];
  }

  /**
   * Get next browser index using round-robin
   */
  getNextBrowserIndex() {
    const index = this.currentBrowserIndex;
    // Round-robin across all browsers
    this.currentBrowserIndex = (this.currentBrowserIndex + 1) % MAX_BROWSERS;
    return index;
  }

  /**
   * Create a new page (context) for scraping
   * Each request gets its own isolated page from alternating browsers
   */
  async createPage() {
    this.lastActivityTime = Date.now();
    // Get next browser index (round-robin)
    const browserIndex = this.getNextBrowserIndex();
    const browser = await this.getBrowser(browserIndex);
    const page = await browser.newPage();
    
    // Track tab creation in Redis
    let tabCount = "?";
    try {
      await redis.incr("active_tabs");
      tabCount = await redis.get("active_tabs");
      log(`📈 Page created, active tabs: ${tabCount}`);
    } catch (err) {
      log(`⚠️ Redis error tracking tab (scraping continues): ${err.message}`);
    }
    
    // Track tab closure
    page.on('close', async () => {
      try {
        await redis.decr("active_tabs");
        const tabCount = await redis.get("active_tabs");
        log(`📉 Page closed, active tabs: ${tabCount}`);
      } catch (err) {
        log(`⚠️ Redis error tracking tab close (scraping continues): ${err.message}`);
      }
    });
    
    log(`✅ New page created from browser ${browserIndex} (active tabs: ${tabCount})`);
    return page;
  }

  /**
   * Check if browser is healthy (not frozen)
   */
  async checkBrowserHealth(index) {
    if (!this.browsers[index] || !this.browsers[index].isConnected()) {
      return false;
    }

    try {
      // Try to get browser version - if browser is frozen, this will timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Browser health check timeout')), 5000)
      );
      
      const healthCheck = this.browsers[index].version();
      
      await Promise.race([healthCheck, timeoutPromise]);
      return true;
    } catch (err) {
      log(`⚠️ Browser ${index} health check failed:`, err.message);
      return false;
    }
  }

  /**
   * Restart browser if it's frozen
   */
  async restartBrowserIfFrozen() {
    if (this.isCheckingHealth) {
      return; // Already checking
    }

    this.isCheckingHealth = true;
    
    try {
      // Check all browsers
      for (let i = 0; i < MAX_BROWSERS; i++) {
        const isHealthy = await this.checkBrowserHealth(i);
        
        if (!isHealthy) {
          log(`🔄 Browser ${i} appears frozen, restarting...`);
          await this.forceRestart(i);
        }
      }
    } catch (err) {
      log("❌ Error checking browser health:", err.message);
      // If health check itself fails, restart all browsers
      for (let i = 0; i < MAX_BROWSERS; i++) {
        await this.forceRestart(i);
      }
    } finally {
      this.isCheckingHealth = false;
    }
  }

  /**
   * Force restart browser at specific index
   */
  async forceRestart(index) {
    try {
      if (this.browsers[index] && this.browsers[index].isConnected()) {
        // Browser close will trigger 'disconnected' event which decrements counter
        await this.browsers[index].close();
      }
    } catch (err) {
      log(`⚠️ Error closing old browser ${index}:`, err.message);
    }
    
    this.browsers[index] = null;
    this.isLaunching[index] = false;
    this.launchPromises[index] = null;
    
    // Pre-warm browser for next request
    log(`🔥 Pre-warming browser ${index} after restart...`);
    try {
      await this.getBrowser(index);
    } catch (err) {
      log(`⚠️ Failed to pre-warm browser ${index}:`, err.message);
    }
  }

  /**
   * Keep browser warm by creating and closing a test page
   */
  async keepAlive() {
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds

    // Only keep-alive if no activity in last 5 minutes
    if (timeSinceLastActivity < fiveMinutes) {
      return; // Server is active, no need to keep-alive
    }

    log("🔥 Keep-alive: Warming up browsers (5 min idle detected)");

    try {
      // Keep all browsers alive
      for (let i = 0; i < MAX_BROWSERS; i++) {
        if (!this.browsers[i] || !this.browsers[i].isConnected()) {
          // Browser not running, pre-warm it
          await this.getBrowser(i);
          log(`✅ Browser ${i} warmed up`);
        } else {
          // Browser is running, test it with a simple page
          const testPage = await this.browsers[i].newPage();
          // Don't track keep-alive test pages in stats (they're temporary)
          await testPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
          await testPage.close();
          log(`✅ Keep-alive: Browser ${i} is warm and responsive`);
        }
      }
      this.lastActivityTime = Date.now(); // Update activity time
    } catch (err) {
      log("⚠️ Keep-alive failed, restarting browsers:", err.message);
      for (let i = 0; i < MAX_BROWSERS; i++) {
        await this.forceRestart(i);
      }
    }
  }

  /**
   * Start watchdog timer (checks every 5 minutes)
   */
  startWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }

    this.watchdogInterval = setInterval(() => {
      for (let i = 0; i < MAX_BROWSERS; i++) {
        if (this.browsers[i] && this.browsers[i].isConnected()) {
          this.restartBrowserIfFrozen();
          break; // Check once for all browsers
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    log("🐕 Watchdog started (checks every 5 minutes)");
  }

  /**
   * Start keep-alive timer (runs every 5 minutes)
   */
  startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      this.keepAlive();
    }, 5 * 60 * 1000); // Every 5 minutes

    log("🔥 Keep-alive started (runs every 5 minutes when idle)");
  }

  /**
   * Close browser instances (for graceful shutdown)
   */
  async close() {
    // Stop intervals
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    // Close all browsers
    for (let i = 0; i < MAX_BROWSERS; i++) {
      if (this.browsers[i] && this.browsers[i].isConnected()) {
        log(`🛑 Closing browser instance ${i}...`);
        // Browser close will trigger 'disconnected' event which decrements counter
        await this.browsers[i].close();
        this.browsers[i] = null;
      }
    }
  }

  /**
   * Check if any browser is available
   */
  isAvailable() {
    for (let i = 0; i < MAX_BROWSERS; i++) {
      if (this.browsers[i] !== null && this.browsers[i].isConnected()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get statistics about browsers and pages
   */
  async getStats() {
    let activeBrowsers = 0;
    let totalPages = 0;
    const browserDetails = [];

    for (let i = 0; i < MAX_BROWSERS; i++) {
      const browser = this.browsers[i];
      if (browser && browser.isConnected()) {
        activeBrowsers++;
        try {
          const pages = browser.pages();
          const pageCount = pages.length;
          totalPages += pageCount;
          browserDetails.push({
            index: i,
            connected: true,
            pages: pageCount
          });
        } catch (err) {
          browserDetails.push({
            index: i,
            connected: true,
            pages: 0,
            error: err.message
          });
        }
      } else {
        browserDetails.push({
          index: i,
          connected: false,
          pages: 0
        });
      }
    }

    return {
      maxBrowsers: MAX_BROWSERS,
      activeBrowsers,
      totalPages,
      browserDetails
    };
  }
}

// Export singleton instance
export const browserPool = new BrowserPool();

