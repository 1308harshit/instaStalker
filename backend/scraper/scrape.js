import { launchBrowser } from "./browser.js";
import { elements } from "./selectors.js";

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
};

export async function scrape(username) {
  log(`🚀 Starting scrape for username: ${username}`);
  
  const browser = await launchBrowser();
  log('✅ Browser launched');
  
  const page = await browser.newPage();
  log('✅ New page created');

  try {
    // Step 1: Navigate to page
    log('📍 Navigating to page...');
    await page.goto("https://oseguidorsecreto.com/pv-en", {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    log('✅ Page loaded');
    
    // Wait a bit for page to fully render
    await page.waitForTimeout(2000);
    log('⏳ Waited 2s for page render');

    // Step 2: Find and click "Reveal Stalkers" button
    log('🔍 Looking for "Reveal Stalkers" button...');
    const startButtonSelector = "button:has-text('Reveal Stalkers')";
    
    try {
      await page.waitForSelector(startButtonSelector, { 
        timeout: 60000,
        state: 'visible' 
      });
      log('✅ Start button found');
      
      // Take screenshot for debugging (optional)
      // await page.screenshot({ path: 'debug-step1.png' });
      
      await page.click(startButtonSelector);
      log('✅ Clicked "Reveal Stalkers" button');
    } catch (err) {
      log('❌ Error finding start button:', err.message);
      // Try to see what buttons are available
      const buttons = await page.$$eval('button', buttons => 
        buttons.map(b => b.textContent?.trim()).filter(Boolean)
      );
      log('📋 Available buttons on page:', buttons);
      throw new Error(`Could not find start button. Available buttons: ${buttons.join(', ')}`);
    }

    // Wait for next screen
    await page.waitForTimeout(2000);
    log('⏳ Waited 2s after start button click');

    // Step 3: Enter username
    log(`⌨️  Looking for username input field...`);
    try {
      // Try multiple selectors for username input
      const inputSelectors = [
        'input[type="text"]',
        'input[type="search"]',
        'input[placeholder*="username" i]',
        'input[placeholder*="instagram" i]',
        'input[placeholder*="@" i]',
        'input',
        'textarea'
      ];
      
      let inputFound = false;
      for (const selector of inputSelectors) {
        try {
          await page.waitForSelector(selector, { 
            timeout: 5000,
            state: 'visible' 
          });
          log(`✅ Username input found with selector: ${selector}`);
          await page.fill(selector, username);
          log(`✅ Username "${username}" entered`);
          inputFound = true;
          break;
        } catch (e) {
          // Try next selector
          continue;
        }
      }
      
      if (!inputFound) {
        // Debug: show what inputs are available
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
    } catch (err) {
      log('❌ Error finding username input:', err.message);
      throw new Error(`Could not find username input: ${err.message}`);
    }

    // Step 4: Click continue button
    log('🔍 Looking for continue button...');
    try {
      await page.waitForSelector(elements.continueBtn, { 
        timeout: 30000,
        state: 'visible' 
      });
      log('✅ Continue button found');
      
      await page.click(elements.continueBtn);
      log('✅ Clicked continue button');
    } catch (err) {
      log('❌ Error finding continue button:', err.message);
      throw new Error(`Could not find continue button: ${err.message}`);
    }

    await page.waitForTimeout(2000);
    log('⏳ Waited 2s after first continue');

    // Step 5: Confirm username screen
    log('🔍 Looking for profile confirmation button...');
    try {
      await page.waitForSelector(elements.continueBtn, { 
        timeout: 30000,
        state: 'visible' 
      });
      log('✅ Profile confirmation button found');
      
      await page.click(elements.continueBtn);
      log('✅ Clicked profile confirmation button');
    } catch (err) {
      log('❌ Error finding profile confirmation button:', err.message);
      throw new Error(`Could not find profile confirmation button: ${err.message}`);
    }

    // Step 6: Wait for analysis to complete and cards to appear
    log('⏳ Waiting for analysis to complete (15 seconds)...');
    await page.waitForTimeout(15000);
    log('✅ Analysis wait complete');

    // Step 7: Extract cards
    log('🔍 Looking for stalker cards...');
    try {
      await page.waitForSelector(elements.finalCard, { 
        timeout: 30000,
        state: 'visible' 
      });
      log('✅ Cards container found');
    } catch (err) {
      log('❌ Error finding cards:', err.message);
      // Try to see what's on the page
      const pageContent = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          bodyText: document.body.innerText.substring(0, 500)
        };
      });
      log('📄 Current page info:', pageContent);
      throw new Error(`Could not find cards: ${err.message}`);
    }

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

    await browser.close();
    log('✅ Browser closed');
    
    return data;
  } catch (error) {
    log('❌ Scraping failed:', error.message);
    log('📋 Error stack:', error.stack);
    
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

