import { launchBrowser } from "./browser.js";
import { elements } from "./selectors.js";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";

const DEBUG_SCRAPE = process.env.DEBUG_SCRAPE === "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOT_DIR = path.join(__dirname, "..", "snapshots");

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

export async function scrape(username) {
  const startTime = Date.now();
  log(`🚀 Starting scrape for username: ${username}`);
  
  const browser = await launchBrowser();
  log('✅ Browser launched');
  
  const page = await browser.newPage();
  log('✅ New page created');

  const runId = `${Date.now()}`;
  const snapshotBaseDir = path.join(SNAPSHOT_DIR, username || "unknown", runId);
  const steps = [];
  let stepIndex = 0;

  const captureStep = async (name, meta = {}) => {
    try {
      stepIndex += 1;
      const html = await page.content();
      await mkdir(snapshotBaseDir, { recursive: true });
      const fileName = `${String(stepIndex).padStart(2, "0")}-${name}.html`;
      const filePath = path.join(snapshotBaseDir, fileName);
      await writeFile(filePath, html, "utf8");
      const relativePath = path
        .relative(path.join(__dirname, ".."), filePath)
        .replace(/\\/g, "/");
      const entry = {
        name,
        htmlPath: `/${relativePath}`,
        meta: { ...meta, capturedAt: new Date().toISOString() },
      };
      steps.push(entry);
      log(`📝 Snapshot saved for "${name}" -> ${relativePath}`);
      return entry;
    } catch (snapshotErr) {
      log(`⚠️  Failed to capture snapshot for "${name}"`, snapshotErr.message);
      return null;
    }
  };

  try {
    // Step 1: Navigate to page - use domcontentloaded for faster load
    log('📍 Navigating to page...');
    await page.goto("https://oseguidorsecreto.com/pv-en", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    log('✅ Page loaded');
    await captureStep("landing", { url: page.url() });

    // Step 2: Find and click "Reveal Stalkers" button immediately (no start button exists)
    log('🔍 Looking for "Reveal Stalkers" button...');
    const revealButtonSelector = "button:has-text('Reveal Stalkers')";
    
    try {
      // Wait for button with shorter timeout
      await page.waitForSelector(revealButtonSelector, { 
        timeout: 10000,
        state: 'visible' 
      });
      log('✅ "Reveal Stalkers" button found');
      
      // Click immediately
      await page.click(revealButtonSelector);
      log('✅ Clicked "Reveal Stalkers" button');
    } catch (err) {
      log('❌ Error finding "Reveal Stalkers" button:', err.message);
      const buttons = await page.$$eval('button', buttons => 
        buttons.map(b => b.textContent?.trim()).filter(Boolean)
      );
      log('📋 Available buttons on page:', buttons);
      throw new Error(`Could not find "Reveal Stalkers" button. Available buttons: ${buttons.join(', ')}`);
    }

    // Step 3: Wait for input field and enter username
    log(`⌨️  Waiting for username input field...`);
    try {
      // Wait for input field to appear (after clicking Reveal Stalkers)
      const input = await page.waitForSelector('input[type="text"], input', { 
        timeout: 8000,
        state: 'visible' 
      });
      log('✅ Username input found');
      
      // Fill username immediately
      await input.fill(username);
      log(`✅ Username "${username}" entered`);
      await captureStep("username-entry", { username });
    } catch (err) {
      log('❌ Error finding username input:', err.message);
      const inputs = await page.$$eval('input, textarea', inputs => 
        inputs.map(inp => ({
          type: inp.type,
          placeholder: inp.placeholder,
          name: inp.name,
          id: inp.id,
          className: inp.className
        }))
      );
      log('📋 Available inputs on page:', inputs);
      throw new Error(`Could not find username input. Available inputs: ${JSON.stringify(inputs)}`);
    }

    // Step 4: Click first "Continue" button
    log('🔍 Looking for Continue button...');
    try {
      const continueBtn = await page.waitForSelector(elements.continueBtn, { 
        timeout: 8000,
        state: 'visible' 
      });
      log('✅ Continue button found');
      
      // Click immediately - no wait
      await continueBtn.click();
      log('✅ Clicked Continue button');
      
      // Minimal wait for page to update (just 100ms)
      await page.waitForTimeout(100);
      log("⏳ Waiting for analyzing view...");
      try {
        await page.waitForSelector("text=Analyzing", { timeout: 8000 });
        await captureStep("analyzing");
      } catch (waitErr) {
        log("⚠️  Could not capture analyzing view:", waitErr.message);
      }
    } catch (err) {
      log('❌ Error finding Continue button:', err.message);
      throw new Error(`Could not find Continue button: ${err.message}`);
    }

    // Step 5: Click "Continue, the profile is correct" button
    log('🔍 Looking for profile confirmation button...');
    try {
      // Try specific text first, then fallback to generic Continue button
      let confirmButton = null;
      try {
        confirmButton = await page.waitForSelector(elements.profileConfirmBtn, { 
          timeout: 3000,
          state: 'visible' 
        });
        log('✅ Profile confirmation button found (specific text)');
      } catch (e) {
        // Fallback to generic Continue button
        confirmButton = await page.waitForSelector(elements.continueBtn, { 
          timeout: 5000,
          state: 'visible' 
        });
        log('✅ Profile confirmation button found (generic Continue)');
      }
      
      try {
        const displayedHandle = await page
          .locator("text=/^@/i")
          .first()
          .textContent();
        await captureStep("profile-confirm", {
          displayedHandle: displayedHandle?.trim() || null,
        });
      } catch (handleErr) {
        await captureStep("profile-confirm");
        log("⚠️  Unable to capture profile confirm metadata:", handleErr.message);
      }

      // Click immediately - no wait
      await confirmButton.click();
      log('✅ Clicked "Continue, the profile is correct" button');
      
      // Minimal wait for analysis to start (just 200ms)
      await page.waitForTimeout(200);
    } catch (err) {
      log('❌ Error finding profile confirmation button:', err.message);
      throw new Error(`Could not find profile confirmation button: ${err.message}`);
    }

    try {
      log("⏳ Waiting for processing view...");
      await page.waitForSelector("text=Processing data", { timeout: 10000 });
      await captureStep("processing");
    } catch (procErr) {
      log("⚠️  Could not capture processing view:", procErr.message);
    }

    // Step 6: Wait for analysis to complete and cards to appear (~35 seconds)
    // Use ultra-aggressive polling - check every 100ms for fastest detection
    log('⏳ Waiting for analysis to complete (this takes ~35 seconds)...');
    
    const analysisStartTime = Date.now();
    const maxWaitTime = 60000; // Max 60 seconds
    const pollInterval = 100; // Check every 100ms - ultra fast!
    let cardsFound = false;
    let lastLogTime = 0;
    
    // Use aggressive polling with minimal overhead
    while (!cardsFound && (Date.now() - analysisStartTime) < maxWaitTime) {
      try {
        // Ultra-fast check using evaluate - single DOM query
        const result = await page.evaluate((selector) => {
          const cards = document.querySelectorAll(selector);
          if (cards.length === 0) return false;
          
          // Check if at least one card is visible
          for (const card of cards) {
            const rect = card.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return true;
            }
          }
          return false;
        }, elements.finalCard);
        
        if (result) {
          cardsFound = true;
          const elapsed = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
          log(`✅ Cards appeared after ${elapsed} seconds!`);
          break;
        }
      } catch (e) {
        // Continue polling
      }
      
      // Log progress every 3 seconds (less frequent logging = faster)
      const elapsed = Date.now() - analysisStartTime;
      if (elapsed - lastLogTime > 3000) {
        log(`⏳ Still waiting... ${(elapsed / 1000).toFixed(1)}s elapsed`);
        lastLogTime = elapsed;
      }
      
      // Very short wait before next poll
      await page.waitForTimeout(pollInterval);
    }
    
    if (!cardsFound) {
      throw new Error('Cards did not appear within timeout period');
    }

    await captureStep("results");

    // Cards are already verified in step 6 polling, proceed to extraction

    log('📦 Extracting card data...');
    const data = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("div[role='group']")];

      return cards.map((el, index) => {
        const imageDiv = el.querySelector("div[style*='background-image']");
        const name = el.querySelector("h4")?.textContent.trim();

        return {
          username: name,
          image: imageDiv?.style.backgroundImage
            .replace(/url\(["']?(.*?)["']?\)/, "$1") || null
        };
      });
    });
    
    log(`📊 Found ${data.length} cards in DOM`);

    log(`✅ Successfully extracted ${data.length} cards`);
    log('📊 Card data:', data);

    try {
      const viewFullReportBtn = await page.waitForSelector(
        'button:has-text("View Full Report")',
        { timeout: 5000 }
      );
      await viewFullReportBtn.click();
      await page.waitForTimeout(500);
      await captureStep("full-report");
      log("📸 Captured full report snapshot");
    } catch (reportErr) {
      log("ℹ️ View Full Report button not available:", reportErr.message);
    }

    if (DEBUG_SCRAPE) {
      const html = await page.content();
      await writeFile('debug-latest.html', html, 'utf8');
      log('📝 Debug HTML saved to debug-latest.html');
    }

    await browser.close();
    log('✅ Browser closed');
    
    // Calculate and log total time
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`⏱️  Total scraping time: ${totalTime} seconds`);
    
    return {
      runId,
      steps,
      cards: data,
      totalTime,
    };
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log('❌ Scraping failed:', error.message);
    log('📋 Error stack:', error.stack);
    log(`⏱️  Time before failure: ${totalTime} seconds`);
    
    // Try to take a screenshot for debugging
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      log('📸 Error screenshot saved to error-screenshot.png');
    } catch (screenshotErr) {
      log('⚠️  Could not take screenshot:', screenshotErr.message);
    }
    
    await browser.close();
    throw error;
  }
}

