/**
 * Parse full report HTML (07-full-report.html) and extract structured data
 */
export function parseFullReport(html) {
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract profile picture - prioritize background-image in rounded-full divs
    let avatar = null;
    
    // Method 1: Look for div with rounded-full class and background-image (most reliable for avatar)
    const roundedFullDivs = doc.querySelectorAll("div[class*='rounded-full']");
    for (const div of roundedFullDivs) {
      const style = div.getAttribute("style") || "";
      if (style.includes("background-image") && style.includes("data:image")) {
        // Extract base64 from style attribute
        // Pattern: style="background-image: url(&quot;data:image/png;base64,...&quot;)"
        // Match the entire url() content including base64
        const bgMatch = style.match(/background-image:\s*url\([^)]+\)/);
        if (bgMatch) {
          // Extract the content inside url()
          let urlContent = bgMatch[0]
            .replace(/background-image:\s*url\(/, '')
            .replace(/\)$/, '')
            .replace(/^["']/, '')
            .replace(/["']$/, '')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .trim();
          
          // Ensure it's a complete base64 string
          if (urlContent.startsWith("data:image") && urlContent.includes("base64,") && urlContent.length > 200) {
            avatar = urlContent;
            console.log("✅ Avatar extracted from rounded-full div, length:", avatar.length);
            break;
          }
        }
      }
    }
    
    // Method 2: Look for any element with background-image containing base64
    if (!avatar) {
      const elementsWithBg = doc.querySelectorAll("[style*='background-image']");
      for (const el of elementsWithBg) {
        const style = el.getAttribute("style") || "";
        if (style.includes("data:image")) {
          // Try multiple patterns to extract base64
          const patterns = [
            /url\(["']?(&quot;)?(data:image\/[^"')]+)["')]?/,
            /background-image:\s*url\(["']?(data:image[^"')]+)["')]?/,
            /url\(&quot;(data:image[^&]+)&quot;\)/
          ];
          
          for (const pattern of patterns) {
            const match = style.match(pattern);
            if (match) {
              let base64Url = (match[2] || match[1] || match[0])
                .replace(/&quot;/g, '')
                .replace(/&amp;/g, '&')
                .replace(/^url\(/, '')
                .replace(/\)$/, '')
                .replace(/^["']/, '')
                .replace(/["']$/, '');
              
              if (base64Url.startsWith("data:image") && base64Url.includes("base64,") && base64Url.length > 200) {
                avatar = base64Url;
                console.log("✅ Avatar extracted from background-image:", avatar.substring(0, 50) + "...");
                break;
              }
            }
          }
          if (avatar) break;
        }
      }
    }
    
    // Method 3: Search HTML string directly for large base64 images (profile pictures are usually large)
    if (!avatar && html.includes("data:image")) {
      // Look for base64 images that are likely profile pictures (longer strings)
      const base64Matches = html.matchAll(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{200,}/g);
      for (const match of base64Matches) {
        if (match[0].length > 500) { // Profile pictures are usually larger than icons
          avatar = match[0];
          console.log("✅ Avatar extracted from HTML string:", avatar.substring(0, 50) + "...");
          break;
        }
      }
    }
    
    if (avatar) {
      console.log("✅ Avatar found, length:", avatar.length);
    } else {
      console.warn("⚠️ Avatar not found in HTML");
    }

    // Extract heading
    const heading = doc.querySelector("h1, h2, [class*='heading'], [class*='title']");
    const headingText = heading?.textContent?.trim() || "Unlock Complete Report";

    // Extract feature cards - look for cards with specific text patterns
    const allCards = Array.from(doc.querySelectorAll("div, section, article"));
    const features = [];
    
    const featurePatterns = [
      { title: "Story Repeats", desc: /viewed.*re-viewed|re-viewed.*stories/i },
      { title: "Visit Tracking", desc: /visiting.*profile|who.*visiting/i },
      { title: "Mention Tracking", desc: /followers.*talk|talk.*about.*you/i },
      { title: "Who's Watching You", desc: /screenshots|screenshot.*profile/i },
    ];

    featurePatterns.forEach((pattern) => {
      const card = allCards.find((el) => {
        const text = el.textContent || "";
        return pattern.desc.test(text) || text.includes(pattern.title);
      });
      
      if (card) {
        const title = card.querySelector("h3, h4, strong, b, [class*='title']")?.textContent?.trim() || pattern.title;
        const desc = card.textContent?.replace(title, "").trim() || "";
        features.push({ title, description: desc });
      }
    });

    // Extract pricing information
    const priceText = doc.body.textContent || "";
    const priceMatch = priceText.match(/(\d+)\s*USD/i);
    const originalPriceMatch = priceText.match(/from\s*(\d+)\s*USD/i);
    const discountMatch = priceText.match(/(\d+)%\s*off/i);
    
    const price = priceMatch ? parseInt(priceMatch[1]) : 17;
    const originalPrice = originalPriceMatch ? parseInt(originalPriceMatch[1]) : 90;
    const discount = discountMatch ? parseInt(discountMatch[1]) : 80;

    // Extract countdown timer
    const timerMatch = priceText.match(/(\d{1,2}):(\d{2})/);
    const countdown = timerMatch ? `${timerMatch[1]}:${timerMatch[2]}` : "14:59";

    // Extract CTA button text
    const ctaButton = doc.querySelector("button, a[class*='button'], [class*='cta']");
    const ctaText = ctaButton?.textContent?.trim() || "I want the complete report";

    // Extract marketing copy
    const marketingCopy = {
      systemMessage: "Our reporting system is the only truly functional system on the market.",
      emotionalAppeal: "We could charge what you've already spent on dates, clothes and dinners that never led to anything.",
      disappointment: "Where you only got disappointed.",
      goalMessage: "We want you to have a goal",
      directionMessage: "We're here giving you the only thing you're still missing, direction.",
      certaintyMessage: "It's not worth humiliating yourself for someone who doesn't want you, this is your chance to have certainty.",
    };

    // Try to extract actual marketing text from HTML
    const bodyText = doc.body.textContent || "";
    if (bodyText.includes("only truly functional")) {
      const match = bodyText.match(/Our reporting system[^.]*\./);
      if (match) marketingCopy.systemMessage = match[0];
    }

    // Extract bonus/guarantee information
    const bonusMatch = bodyText.match(/[Bb]onus[^:]*:\s*([^.!?]+)/);
    const guaranteeMatch = bodyText.match(/(\d+)[-\s]*[Dd]ay[^.!?]*[Gg]uarantee/);
    
    const bonus = bonusMatch ? bonusMatch[1].trim() : "Ebook: Manual for attraction and re-attraction";
    const guarantee = guaranteeMatch ? `${guaranteeMatch[1]}-Day Guarantee` : "14-Day Guarantee";

    return {
      avatar,
      heading: headingText,
      features: features.length > 0 ? features : [
        { title: "Story Repeats", description: "People who viewed and re-viewed your stories" },
        { title: "Visit Tracking", description: "Discover who is visiting your profile" },
        { title: "Mention Tracking", description: "Find out which followers talk about you the most" },
        { title: "Who's Watching You", description: "See who took SCREENSHOTS of your profile and stories" },
      ],
      marketing: marketingCopy,
      pricing: {
        original: originalPrice,
        current: price,
        discount,
        countdown,
      },
      cta: ctaText,
      bonus,
      guarantee,
    };
  } catch (err) {
    console.error("Failed to parse full report:", err);
    return null;
  }
}

