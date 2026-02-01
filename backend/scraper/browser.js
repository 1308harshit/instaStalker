import { chromium } from "playwright";

// Stealth: Realistic Chrome user agent (avoids "HeadlessChrome" detection)
const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const STEALTH_CONTEXT_OPTIONS = {
  userAgent: STEALTH_USER_AGENT,
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
  timezoneId: "America/New_York",
  permissions: [],
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
  },
};

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--window-size=1920,1080",
    ],
  });
}

