// backend/scraper/browserPool.js
import { launchBrowser } from "./browser.js";

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

class BrowserPool {
  constructor() {
    this.browser = null;
    this.isLaunching = false;
    this.launchPromise = null;
    this.lastActivityTime = Date.now();
    this.watchdogInterval = null;
    this.keepAliveInterval = null;
    this.isCheckingHealth = false;
    
    // Start watchdog and keep-alive on initialization
    this.startWatchdog();
    this.startKeepAlive();
  }

  /**
   * Get or create browser instance
   * Reuses existing browser, creates new one if needed
   */
  async getBrowser() {
    // Update activity time
    this.lastActivityTime = Date.now();
    
    // If browser exists and is connected, return it
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    // If browser is launching, wait for it
    if (this.isLaunching && this.launchPromise) {
      log("⏳ Browser is launching, waiting...");
      return await this.launchPromise;
    }

    // Launch new browser
    this.isLaunching = true;
    log("🚀 Launching new browser instance...");
    
    this.launchPromise = launchBrowser()
      .then((browser) => {
        this.browser = browser;
        this.isLaunching = false;
        this.launchPromise = null;
        this.lastActivityTime = Date.now();
        
        log("✅ Browser instance ready and connected");
        return browser;
      })
      .catch((err) => {
        this.isLaunching = false;
        this.launchPromise = null;
        log("❌ Failed to launch browser:", err.message);
        throw err;
      });

    return await this.launchPromise;
  }

  /**
   * Create a new page (context) for scraping
   * Each request gets its own isolated page
   */
  async createPage() {
    this.lastActivityTime = Date.now();
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    log("✅ New page created from shared browser");
    return page;
  }

  /**
   * Check if browser is healthy (not frozen)
   */
  async checkBrowserHealth() {
    if (!this.browser || !this.browser.isConnected()) {
      return false;
    }

    try {
      // Try to get browser version - if browser is frozen, this will timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Browser health check timeout')), 5000)
      );
      
      const healthCheck = this.browser.version();
      
      await Promise.race([healthCheck, timeoutPromise]);
      return true;
    } catch (err) {
      log("⚠️ Browser health check failed:", err.message);
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
      const isHealthy = await this.checkBrowserHealth();
      
      if (!isHealthy) {
        log("🔄 Browser appears frozen, restarting...");
        await this.forceRestart();
      }
    } catch (err) {
      log("❌ Error checking browser health:", err.message);
      // If health check itself fails, restart browser
      await this.forceRestart();
    } finally {
      this.isCheckingHealth = false;
    }
  }

  /**
   * Force restart browser
   */
  async forceRestart() {
    try {
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
      }
    } catch (err) {
      log("⚠️ Error closing old browser:", err.message);
    }
    
    this.browser = null;
    this.isLaunching = false;
    this.launchPromise = null;
    
    // Pre-warm browser for next request
    log("🔥 Pre-warming browser after restart...");
    try {
      await this.getBrowser();
    } catch (err) {
      log("⚠️ Failed to pre-warm browser:", err.message);
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

    log("🔥 Keep-alive: Warming up browser (5 min idle detected)");

    try {
      if (!this.browser || !this.browser.isConnected()) {
        // Browser not running, pre-warm it
        await this.getBrowser();
        log("✅ Browser warmed up");
        return;
      }

      // Browser is running, test it with a simple page
      const testPage = await this.browser.newPage();
      await testPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
      await testPage.close();
      
      log("✅ Keep-alive: Browser is warm and responsive");
      this.lastActivityTime = Date.now(); // Update activity time
    } catch (err) {
      log("⚠️ Keep-alive failed, restarting browser:", err.message);
      await this.forceRestart();
    }
  }

  /**
   * Start watchdog timer (checks every 1 minute)
   */
  startWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }

    this.watchdogInterval = setInterval(() => {
      if (this.browser && this.browser.isConnected()) {
        this.restartBrowserIfFrozen();
      }
    }, 60 * 1000); // Check every 1 minute

    log("🐕 Watchdog started (checks every 1 minute)");
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
   * Close browser instance (for graceful shutdown)
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

    if (this.browser && this.browser.isConnected()) {
      log("🛑 Closing browser instance...");
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Check if browser is available
   */
  isAvailable() {
    return this.browser !== null && this.browser.isConnected();
  }
}

// Export singleton instance
export const browserPool = new BrowserPool();

