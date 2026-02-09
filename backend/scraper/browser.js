import { chromium } from "playwright";

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage', // Overcome limited resource problems
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu', // Faster on headless
      '--disable-extensions', // Faster startup
      '--disable-background-networking', // Faster
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
}

