import { chromium, firefox } from "playwright";

const USE_FIREFOX = process.env.USE_FIREFOX === "1";
const USE_MOBILE = process.env.USE_MOBILE !== "0"; // default: mobile (set USE_MOBILE=0 for desktop)

// Stealth: Realistic user agents (avoids "HeadlessChrome" detection)
// --- DESKTOP (used when USE_MOBILE=0) ---
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
// --- MOBILE (used when USE_MOBILE=1 or default) ---
const CHROME_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const FIREFOX_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15";

const userAgent = USE_MOBILE
  ? (USE_FIREFOX ? FIREFOX_MOBILE_UA : CHROME_MOBILE_UA)
  : (USE_FIREFOX ? FIREFOX_UA : CHROME_UA);

// viewport: desktop 1920x1080, mobile iPhone 14
const viewport = USE_MOBILE
  ? { width: 390, height: 844 }
  : { width: 1920, height: 1080 };

export const STEALTH_CONTEXT_OPTIONS = {
  userAgent,
  viewport,
  locale: "en-US",
  timezoneId: "America/New_York",
  permissions: [],
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
  },
  isMobile: USE_MOBILE,
  hasTouch: USE_MOBILE,
  isLandscape: false,
};

export async function launchBrowser() {
  const engine = USE_FIREFOX ? firefox : chromium;
  if (USE_FIREFOX) {
    console.log("[browser] Using Firefox (USE_FIREFOX=1) - may bypass Chromium-specific bot detection");
  }
  if (USE_MOBILE) {
    console.log("[browser] Using mobile viewport (390x844) - set USE_MOBILE=0 for desktop");
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
      USE_MOBILE ? "--window-size=390,844" : "--window-size=1920,1080",  // mobile vs desktop
    ];
  }
  return engine.launch(launchOpts);
}

