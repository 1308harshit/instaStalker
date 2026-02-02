/**
 * Diagnostic script: Visit target site and document DOM structure & flow.
 * Run locally: node backend/scraper/diagnose-landing.js
 * Uses headed mode (visible browser) - run on your machine where bot detection may be weaker.
 */

import { chromium } from "playwright";
import { writeFile } from "fs/promises";

const TARGET = "https://oseguidorsecreto.com/pv-en";

async function diagnose() {
  console.log("🔍 Launching browser (headed) to inspect target site...\n");

  const browser = await chromium.launch({
    headless: false, // Visible - helps avoid detection when run locally
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate
    console.log("1️⃣ Navigating to", TARGET);
    await page.goto(TARGET, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(5000); // Wait for React/JS

    const url = page.url();
    console.log("   URL:", url, "\n");

    // Step 2: Dump all form-related elements
    const formData = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input, textarea")).map(
        (el) => ({
          tag: el.tagName,
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          className: el.className?.slice(0, 80),
          visible: el.offsetParent !== null,
          rect: el.getBoundingClientRect()
            ? {
                x: Math.round(el.getBoundingClientRect().x),
                y: Math.round(el.getBoundingClientRect().y),
                w: Math.round(el.getBoundingClientRect().width),
                h: Math.round(el.getBoundingClientRect().height),
              }
            : null,
        })
      );

      const buttons = Array.from(document.querySelectorAll("button")).map(
        (el) => ({
          text: el.textContent?.trim().slice(0, 60),
          className: el.className?.slice(0, 80),
          visible: el.offsetParent !== null,
          disabled: el.disabled,
        })
      );

      const contentEditable = Array.from(
        document.querySelectorAll("[contenteditable='true']")
      ).map((el) => ({
        tag: el.tagName,
        className: el.className?.slice(0, 80),
        placeholder: el.getAttribute("data-placeholder") || el.placeholder,
        visible: el.offsetParent !== null,
      }));

      return { inputs, buttons, contentEditable };
    });

    console.log("2️⃣ INPUTS / TEXTAREA:");
    console.log(JSON.stringify(formData.inputs, null, 2));
    console.log("\n3️⃣ BUTTONS:");
    console.log(JSON.stringify(formData.buttons, null, 2));
    console.log("\n4️⃣ CONTENTEDITABLE:");
    console.log(JSON.stringify(formData.contentEditable, null, 2));

    // Step 3: Save full HTML
    const html = await page.content();
    const htmlPath = "diagnose-landing-output.html";
    await writeFile(htmlPath, html, "utf8");
    console.log("\n5️⃣ Full HTML saved to:", htmlPath);

    // Step 4: Generate steps document
    const stepsDoc = `# Bot steps for ${TARGET}
Generated: ${new Date().toISOString()}
Final URL: ${url}

## DOM summary

### Inputs (${formData.inputs.length})
${formData.inputs.map((i) => `- ${i.tag} type=${i.type} placeholder="${i.placeholder}" name="${i.name}" id="${i.id}" visible=${i.visible}`).join("\n")}

### Buttons (${formData.buttons.length})
${formData.buttons.map((b) => `- "${b.text}" disabled=${b.disabled} visible=${b.visible}`).join("\n")}

### Contenteditable (${formData.contentEditable.length})
${formData.contentEditable.map((c) => `- ${c.tag} ${c.className}`).join("\n")}

## Suggested bot flow
1. Navigate to ${TARGET}
2. Wait for load + 5s
3. Find input: ${formData.inputs[0] ? `placeholder="${formData.inputs[0].placeholder}" or ${formData.inputs[0].tag}[${formData.inputs[0].id ? `id="${formData.inputs[0].id}"` : ""}]` : "NONE FOUND - check HTML"}
4. Enter username
5. Wait for button to enable
6. Click: ${formData.buttons.find((b) => /get your free report|continue/i.test(b?.text || ""))?.text || "Get Your Free Report"}
7. Wait for next page
8. Click: Start My Analysis (if present)
9. Confirm profile
10. Extract cards
`;

    await writeFile("diagnose-steps.md", stepsDoc, "utf8");
    console.log("6️⃣ Steps document saved to: diagnose-steps.md");

    console.log("\n⏸️  Browser will stay open 15s for manual inspection. Close to exit early.");
    await page.waitForTimeout(15000);
  } finally {
    await browser.close();
  }
}

diagnose().catch((err) => {
  console.error("Diagnose failed:", err);
  process.exit(1);
});
