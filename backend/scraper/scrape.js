import { browserPool } from "./browserPool.js";
import { elements } from "./selectors.js";
import { saveSnapshotStep, saveSnapshotResult } from "../utils/mongodb.js";
import { writeFile } from "fs/promises";

const DEBUG_SCRAPE = process.env.DEBUG_SCRAPE === "1";

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

export async function scrape(username, onStep = null) {
  const startTime = Date.now();
  log(`🚀 Starting scrape for username: ${username}`);
  
  // Use shared browser pool - creates new page from existing browser instance
  let page = await browserPool.createPage();
  log('✅ New page created from shared browser');

  const runId = `${Date.now()}`;
  const steps = [];
  let stepIndex = 0;
  let snapshotId = null; // Will be set after first save

  const captureStep = async (name, meta = {}) => {
    try {
      stepIndex += 1;
      const html = await page.content();
      
      // Save to MongoDB
      const result = await saveSnapshotStep(username, runId, name, html, meta);
      
      if (!result || !result.snapshotId) {
        log(`⚠️  Failed to save snapshot step "${name}" to MongoDB`);
        return null;
      }

      // Update snapshotId if we got it from first save
      if (!snapshotId && result.snapshotId) {
        snapshotId = result.snapshotId;
      }

      const entry = {
        name,
        htmlPath: `/api/snapshots/${result.snapshotId}/${name}`, // API endpoint
        meta: { ...meta, capturedAt: new Date().toISOString() },
      };
      steps.push(entry);
      log(`📝 Snapshot saved for "${name}" to MongoDB (ID: ${result.snapshotId})`);
      
      // Emit step immediately if callback provided (for SSE streaming)
      if (onStep) {
        onStep(entry);
      }
      
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

    // Step 2: Wait for username input field on landing and enter username
    log(`⌨️  Waiting for username input field on landing...`);
    try {
      const input = await page.waitForSelector('input[type="text"], input', { 
        timeout: 10000,
        state: 'visible' 
      });
      log('✅ Username input found');
      
      // Fill username immediately
      await input.fill(username);
      log(`✅ Username "${username}" entered`);
      await captureStep("username-entry", { username });
      
      // Wait 1 second for button to become enabled
      log('⏳ Waiting 1 second for button to become enabled...');
      await page.waitForTimeout(1000);
    } catch (err) {
      log('❌ Error finding username input on landing:', err.message);
      const inputs = await page.$$eval('input, textarea', inputs => 
        inputs.map(inp => ({
          type: inp.type,
          placeholder: inp.placeholder,
          name: inp.name,
          id: inp.id,
          className: inp.className
        }))
      );
      log('📋 Available inputs on landing page:', inputs);
      throw new Error(`Could not find username input on landing. Available inputs: ${JSON.stringify(inputs)}`);
    }

    // Step 3: Click "Get Your Free Report" button (enabled after username)
    log('🔍 Looking for "Get Your Free Report" button...');
    try {
      const continueBtn = await page.waitForSelector(elements.continueBtn, { 
        timeout: 8000,
        state: 'visible' 
      });
      log('✅ "Get Your Free Report" button found');
      
      // Click the button
      await continueBtn.click();
      log('✅ Clicked "Get Your Free Report" button');
      
      // Wait for page to update/navigate
      await page.waitForTimeout(500);
    } catch (err) {
      log('❌ Error finding "Get Your Free Report" button:', err.message);
      throw new Error(`Could not find "Get Your Free Report" button: ${err.message}`);
    }

    // Step 4.5: Click "Start My Analysis" button
    log('🔍 Looking for "Start My Analysis" button...');
    try {
      const startAnalysisBtn = await page.waitForSelector(elements.startAnalysisBtn, {
        timeout: 10000,
        state: 'visible'
      });
      log('✅ "Start My Analysis" button found');
      
      await startAnalysisBtn.click();
      log('✅ Clicked "Start My Analysis" button');
      
      await page.waitForTimeout(500);
    } catch (err) {
      log('❌ Error finding "Start My Analysis" button:', err.message);
      try {
        log('🔍 Trying alternative selectors for "Start My Analysis"...');
        const altSelectors = [
          'button:has-text("Start")',
          'button[class*="start"]',
          'button[class*="analysis"]',
        ];
        let found = false;
        for (const selector of altSelectors) {
          try {
            const btn = await page.waitForSelector(selector, { timeout: 3000, state: 'visible' });
            const text = await btn.textContent();
            if (text && /start.*analysis/i.test(text)) {
              await btn.click();
              log(`✅ Clicked "Start My Analysis" button using alternative selector: ${selector}`);
              found = true;
              await page.waitForTimeout(500);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        if (!found) {
          throw new Error(`Could not find "Start My Analysis" button with any selector`);
        }
      } catch (altErr) {
        log('❌ Could not find "Start My Analysis" button:', altErr.message);
        throw new Error(`Could not find "Start My Analysis" button: ${err.message}`);
      }
    }

    // Step 5: Wait for analyzing view (after clicking Start My Analysis)
    log("⏳ Waiting for analyzing view...");
    try {
      await page.waitForSelector("text=Analyzing", { timeout: 8000 });
      await captureStep("analyzing");
    } catch (waitErr) {
      log("⚠️  Could not capture analyzing view:", waitErr.message);
    }

    // Step 5: Click "Continue, the profile is correct" button
    log('🔍 Looking for profile confirmation button...');
    try {
      // Wait for page to update after clicking Continue
      await page.waitForTimeout(2000);
      
      // First, capture the profile-confirm snapshot (we're already on that page)
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
      
      // Try to find button using locator API (more flexible)
      let confirmButton = null;
      const buttonTexts = [
        "Continue, the profile is correct",
        "profile is correct",
        "Continue",
      ];
      
      for (const buttonText of buttonTexts) {
        try {
          log(`🔍 Trying to find button with text: "${buttonText}"`);
          const locator = page.locator(`button:has-text("${buttonText}")`).first();
          
          // Wait for button to be visible
          await locator.waitFor({ state: 'visible', timeout: 3000 });
          
          // Check if it's actually visible
          const isVisible = await locator.isVisible();
          if (isVisible) {
            confirmButton = locator;
            log(`✅ Profile confirmation button found with text: "${buttonText}"`);
            break;
          }
        } catch (e) {
          log(`⚠️  Button with text "${buttonText}" not found, trying next...`);
          continue;
        }
      }
      
      // If still not found, try to find any visible button
      if (!confirmButton) {
        log('🔍 Trying to find any visible button...');
        try {
          const allButtons = await page.locator('button').all();
          for (const btn of allButtons) {
            const isVisible = await btn.isVisible();
            if (isVisible) {
              const text = await btn.textContent();
              log(`📋 Found visible button with text: "${text?.trim()}"`);
              confirmButton = btn;
              break;
            }
          }
        } catch (e) {
          log('⚠️  Could not find any visible buttons');
        }
      }
      
      if (!confirmButton) {
        // Log all buttons for debugging
        const allButtons = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.map(b => ({
            text: b.textContent?.trim(),
            visible: b.offsetParent !== null,
            className: b.className,
            id: b.id,
            type: b.type
          }));
        });
        log('📋 All buttons on page:', JSON.stringify(allButtons, null, 2));
        throw new Error('No profile confirmation button found');
      }

      // Click the button
      await confirmButton.click();
      log('✅ Clicked profile confirmation button');
      
      // Wait for page to update
      await page.waitForTimeout(500);
    } catch (err) {
      log('❌ Error finding profile confirmation button:', err.message);
      // Try to capture the current state for debugging
      try {
        await captureStep("profile-confirm-error");
        log('📸 Captured error state snapshot');
      } catch (snapshotErr) {
        log('⚠️  Could not capture error snapshot:', snapshotErr.message);
      }
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

    await page.close();
    log('✅ Page closed (browser instance kept alive)');
    
    // Save final result to MongoDB with cards
    await saveSnapshotResult(username, runId, data, steps);
    
    // snapshotId should already be set from captureStep, but verify
    if (!snapshotId) {
      const { getSnapshotByRunId } = await import("../utils/mongodb.js");
      const savedSnapshot = await getSnapshotByRunId(username, runId);
      snapshotId = savedSnapshot?._id?.toString() || null;
    }
    
    // Calculate and log total time
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`⏱️  Total scraping time: ${totalTime} seconds`);
    
    return {
      runId,
      snapshotId, // Include snapshot ID for frontend
      steps, // Steps already have correct htmlPath
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
    
    await page.close();
    throw error;
  }
}

