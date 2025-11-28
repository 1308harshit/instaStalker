/**
 * Parse full report HTML (07-full-report.html) and extract structured data
 */
export function parseFullReport(html) {
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract profile picture - try multiple methods
    let avatar = null;
    
    // Method 1: Look for img tags with src (including base64)
    const imgTags = doc.querySelectorAll("img");
    for (const img of imgTags) {
      const src = img.getAttribute("src");
      if (src && (src.startsWith("data:image") || src.includes("base64") || src.includes("profile") || src.includes("avatar"))) {
        avatar = src;
        break;
      }
    }
    
    // Method 2: Look for background-image in style attributes (base64)
    if (!avatar) {
      const elementsWithBg = doc.querySelectorAll("[style*='background-image'], [style*='backgroundImage']");
      for (const el of elementsWithBg) {
        const style = el.getAttribute("style") || "";
        const bgMatch = style.match(/url\(["']?(data:image[^"']+)["']?\)/);
        if (bgMatch && bgMatch[1]) {
          avatar = bgMatch[1].replace(/&quot;/g, '"');
          break;
        }
      }
    }
    
    // Method 3: Look for any div with circular styling that might contain avatar
    if (!avatar) {
      const circularDivs = doc.querySelectorAll("div[class*='rounded-full'], div[class*='circle']");
      for (const div of circularDivs) {
        const style = div.getAttribute("style") || "";
        const bgMatch = style.match(/url\(["']?(data:image[^"']+)["']?\)/);
        if (bgMatch && bgMatch[1]) {
          avatar = bgMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          break;
        }
      }
    }
    
    // Method 4: Search HTML string directly for base64 images
    if (!avatar && html.includes("data:image")) {
      const base64Match = html.match(/data:image\/[^;]+;base64,[^"'\s)]+/);
      if (base64Match && base64Match[0].length > 100) { // Ensure it's a real image, not a small icon
        avatar = base64Match[0];
      }
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

