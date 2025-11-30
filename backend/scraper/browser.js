import { chromium } from "playwright";

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage', // Overcome limited resource problems
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu', // Disable GPU acceleration
      '--disable-extensions', // Faster startup
      '--disable-background-networking', // Faster
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Force software rendering (no GPU/GBM required) - for Render/Railway deployment
      '--use-gl=swiftshader',
      '--disable-webgl',
      '--disable-3d-apis',
      // Additional flags for containerized environments
      '--disable-features=UseChromeOSDirectVideoDecoder',
      '--disable-features=VaapiVideoDecoder',
    ],
  });
}

