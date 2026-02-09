/**
 * Request Queue for handling concurrent scraping requests
 * Prevents duplicate scrapes for the same username
 */

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

class ScrapeQueue {
  constructor() {
    // Track usernames currently being processed
    this.processing = new Map(); // username -> Promise<result>
    // Track waiting requests for same username
    this.waiting = new Map(); // username -> [resolve functions]
  }

  /**
   * Enqueue a scraping request
   * If same username is already being processed, wait for that result
   */
  async enqueue(username, scrapeFunction) {
    // Check if already processing this username
    if (this.processing.has(username)) {
      log(`⏳ Username ${username} already being processed, waiting for result...`);
      
      // Wait for the existing scrape to complete
      const existingPromise = this.processing.get(username);
      
      // Add this request to waiting list (for logging)
      if (!this.waiting.has(username)) {
        this.waiting.set(username, []);
      }
      this.waiting.get(username).push(() => {
        log(`✅ Waiting request for ${username} will receive result`);
      });
      
      try {
        const result = await existingPromise;
        log(`✅ Waiting request for ${username} received result`);
        return result;
      } catch (err) {
        log(`❌ Waiting request for ${username} received error: ${err.message}`);
        throw err;
      }
    }

    // Start new scrape
    log(`🚀 Starting new scrape for username: ${username}`);
    
    const scrapePromise = scrapeFunction(username)
      .then((result) => {
        // Notify waiting requests
        const waiters = this.waiting.get(username);
        if (waiters) {
          waiters.forEach(notify => notify());
          this.waiting.delete(username);
        }
        return result;
      })
      .catch((err) => {
        // Notify waiting requests of error
        const waiters = this.waiting.get(username);
        if (waiters) {
          waiters.forEach(notify => notify());
          this.waiting.delete(username);
        }
        throw err;
      })
      .finally(() => {
        // Remove from processing map
        this.processing.delete(username);
        log(`✅ Completed scrape for username: ${username}`);
      });

    // Add to processing map
    this.processing.set(username, scrapePromise);

    return scrapePromise;
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      processing: Array.from(this.processing.keys()),
      waiting: Array.from(this.waiting.keys()).map(username => ({
        username,
        count: this.waiting.get(username)?.length || 0
      }))
    };
  }
}

// Export singleton instance
export const scrapeQueue = new ScrapeQueue();

