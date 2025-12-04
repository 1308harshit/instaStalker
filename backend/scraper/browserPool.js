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
  }

  /**
   * Get or create browser instance
   * Reuses existing browser, creates new one if needed
   */
  async getBrowser() {
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
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    log("✅ New page created from shared browser");
    return page;
  }

  /**
   * Close browser instance (for graceful shutdown)
   */
  async close() {
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

