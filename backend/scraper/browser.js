import { chromium } from "playwright";

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
  });
}

