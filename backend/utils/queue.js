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

    // Concurrency limiting (Optimization for 1.5h delay)
    this.maxConcurrentScrapes = 5;
    this.activeScrapeCount = 0;
    this.pendingTasks = []; // Queue for tasks waiting for a slot
  }

  /**
   * Internal method to process the next task in the pending queue
   */
  _processNext() {
    if (this.pendingTasks.length > 0 && this.activeScrapeCount < this.maxConcurrentScrapes) {
      const { resolve } = this.pendingTasks.shift();
      resolve();
    }
  }

  /**
   * Internal method to wait for a slot if at max concurrency
   */
  async _waitForSlot() {
    if (this.activeScrapeCount < this.maxConcurrentScrapes) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.pendingTasks.push({ resolve });
    });
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

    // Wait for a concurrency slot before starting a NEW scrape
    await this._waitForSlot();

    // Check if another request for the SAME username finished while we were waiting for a slot
    if (this.processing.has(username)) {
      this._processNext(); // Hand off slot since we won't use it
      return await this.processing.get(username);
    }

    // Start new scrape
    this.activeScrapeCount++;
    log(`🚀 Starting new scrape for username: ${username} (Active: ${this.activeScrapeCount}/${this.maxConcurrentScrapes})`);

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
        this.activeScrapeCount--;
        log(`✅ Completed scrape for username: ${username} (Active: ${this.activeScrapeCount}/${this.maxConcurrentScrapes})`);

        // Trigger next pending task
        this._processNext();
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

