import { chromium } from 'playwright';

(async () => {
  console.log('🚀 Launching browser...\n');
  
  const browser = await chromium.launch({
    headless: false, // Show the browser so we can see what's happening
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Capture ALL console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    const location = msg.location();
    
    consoleMessages.push({
      type,
      text,
      location
    });
    
    // Print in real-time
    const typeLabel = type.toUpperCase().padEnd(7);
    console.log(`[${typeLabel}] ${text}`);
    if (location && location.url) {
      console.log(`          ↳ ${location.url}:${location.lineNumber || '?'}`);
    }
  });
  
  // Capture page errors
  page.on('pageerror', error => {
    console.log(`\n❌ PAGE ERROR: ${error.message}`);
    console.log(`   Stack: ${error.stack}\n`);
  });
  
  // Capture failed requests
  page.on('requestfailed', request => {
    console.log(`\n❌ REQUEST FAILED: ${request.url()}`);
    console.log(`   Error: ${request.failure()?.errorText}\n`);
  });
  
  console.log('🌐 Navigating to http://localhost:5173/...\n');
  
  try {
    await page.goto('http://localhost:5173/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('\n✅ Page loaded successfully!\n');
    
    // Wait a bit for any delayed console messages
    await page.waitForTimeout(2000);
    
    // Check if page is blank
    const bodyText = await page.evaluate(() => {
      return document.body.innerText;
    });
    
    const hasContent = bodyText.trim().length > 0;
    
    console.log('\n=== PAGE CONTENT CHECK ===');
    console.log(`Page has content: ${hasContent ? 'YES' : 'NO (BLANK PAGE)'}`);
    if (hasContent) {
      console.log(`Content preview (first 200 chars): ${bodyText.substring(0, 200).trim()}`);
    }
    
    // Get page title
    const title = await page.title();
    console.log(`Page title: "${title}"`);
    
    // Summary
    console.log('\n=== CONSOLE SUMMARY ===');
    console.log(`Total console messages: ${consoleMessages.length}`);
    
    const byType = consoleMessages.reduce((acc, msg) => {
      acc[msg.type] = (acc[msg.type] || 0) + 1;
      return acc;
    }, {});
    
    console.log('Messages by type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // List all errors and warnings
    const errors = consoleMessages.filter(m => m.type === 'error');
    const warnings = consoleMessages.filter(m => m.type === 'warning');
    
    if (errors.length > 0) {
      console.log('\n=== ALL ERRORS ===');
      errors.forEach((err, i) => {
        console.log(`${i + 1}. ${err.text}`);
        if (err.location?.url) {
          console.log(`   at ${err.location.url}:${err.location.lineNumber || '?'}`);
        }
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n=== ALL WARNINGS ===');
      warnings.forEach((warn, i) => {
        console.log(`${i + 1}. ${warn.text}`);
        if (warn.location?.url) {
          console.log(`   at ${warn.location.url}:${warn.location.lineNumber || '?'}`);
        }
      });
    }
    
    if (errors.length === 0 && warnings.length === 0) {
      console.log('\n✅ No errors or warnings found!');
    }
    
    // Keep browser open for 5 seconds so user can see it
    console.log('\n⏳ Keeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('\n❌ Failed to load page:');
    console.error(error.message);
    console.error(error.stack);
  }
  
  await browser.close();
  console.log('\n✅ Browser closed.');
})();
