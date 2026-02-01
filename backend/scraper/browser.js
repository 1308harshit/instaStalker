import { chromium, firefox } from "playwright";

const USE_FIREFOX = process.env.USE_FIREFOX === "1";

// Stealth: Realistic user agents (avoids "HeadlessChrome" detection)
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

export const STEALTH_CONTEXT_OPTIONS = {
  userAgent: USE_FIREFOX ? FIREFOX_UA : CHROME_UA,
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
  timezoneId: "America/New_York",
  permissions: [],
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
  },
};

export async function launchBrowser() {
  const engine = USE_FIREFOX ? firefox : chromium;
  if (USE_FIREFOX) {
    console.log("[browser] Using Firefox (USE_FIREFOX=1) - may bypass Chromium-specific bot detection");
  }
  const launchOpts = {
    headless: true,
  };
  if (!USE_FIREFOX) {
    launchOpts.args = [
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
    ];
  }
  return engine.launch(launchOpts);
}

