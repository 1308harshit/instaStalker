import { readFile } from "fs/promises";
import { JSDOM } from "jsdom";
import path from "path";

/**
 * Extract avatar image from HTML (base64 or URL)
 */
const extractAvatar = (doc) => {
  // Try to find image in style attribute (background-image)
  const styledNode = Array.from(doc.querySelectorAll("[style]")).find((node) => {
    const style = node.getAttribute("style") || "";
    return /background-image/i.test(style);
  });

  if (styledNode) {
    const style = styledNode.getAttribute("style");
    const match = style.match(/url\((['"]?)(.+?)\1\)/i);
    if (match?.[2]) {
      return match[2].trim();
    }
  }

  // Try to find img tag
  const imgNode = doc.querySelector("img[src]");
  if (imgNode) {
    return imgNode.getAttribute("src");
  }

  return null;
};

/**
 * Parse profile confirmation snapshot (04-profile-confirm.html)
 */
export async function parseProfileSnapshot(htmlPath) {
  try {
    const html = await readFile(htmlPath, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const avatar = extractAvatar(doc);

    // Find username (usually starts with @)
    // Look for nodes that contain @username, prioritizing shorter text (to avoid concatenated text)
    const usernameNodes = Array.from(doc.querySelectorAll("span, div, p"))
      .filter((node) => {
        const text = (node.textContent || "").trim();
        return /^@/.test(text);
      })
      .sort((a, b) => {
        // Prefer shorter text (likely just the username, not concatenated)
        return (a.textContent?.trim().length || Infinity) - (b.textContent?.trim().length || Infinity);
      });
    const usernameNode = usernameNodes[0];

    // Find greeting (usually h1 or h2)
    const greetingNode = doc.querySelector("h1, h2");

    // Find question (usually contains "profile")
    const questionNode = Array.from(doc.querySelectorAll("p, span")).find((node) =>
      /profile/i.test((node.textContent || "").trim())
    );

    // Find buttons
    const buttons = Array.from(doc.querySelectorAll("button"));

    // Find progress bar
    const progressNode = Array.from(doc.querySelectorAll("[style]")).find((node) =>
      /width:\s*\d+%/i.test(node.getAttribute("style") || "")
    );

    let progressPercent = 55;
    if (progressNode) {
      const match = progressNode
        .getAttribute("style")
        .match(/width:\s*([\d.]+)%/i);
      if (match?.[1]) {
        progressPercent = Number(match[1]);
      }
    }

    // Extract clean username - only get the @username part, not any concatenated text
    let cleanUsername = "";
    if (usernameNode) {
      const rawText = usernameNode.textContent?.trim() || "";
      // Try to extract just the @username part
      // Match @username pattern and stop before "Hello", "Is", or any capital letter that starts a new word
      const usernameMatch = rawText.match(/^(@[\w_]+)/i);
      if (usernameMatch) {
        cleanUsername = usernameMatch[1];
        // Additional cleanup: remove common concatenated words
        // If username ends with common words like "Hello", "Is", etc., remove them
        const cleaned = cleanUsername.replace(/(Hello|Is|Continue|the|profile|correct|No|want|correct|it)$/i, '');
        if (cleaned.startsWith('@')) {
          cleanUsername = cleaned;
        }
      } else if (rawText.startsWith("@")) {
        // If it starts with @, extract up to first non-username character or common words
        const parts = rawText.split(/(Hello|Is|Continue|the|profile|correct|No|want|correct|it)/i);
        cleanUsername = parts[0] || "";
      }
    }

    return {
      avatar: avatar || null,
      progressPercent,
      username: cleanUsername || "",
      greeting: (greetingNode?.textContent || "Hello").trim(),
      question: (questionNode?.textContent || "Is this your profile?").trim(),
      primaryCta:
        (buttons[0]?.textContent || "Continue, the profile is correct").trim(),
      secondaryCta:
        (buttons[1]?.textContent || "No, I want to correct it").trim(),
    };
  } catch (err) {
    console.error("Failed to parse profile snapshot:", err.message);
    return null;
  }
}

/**
 * Parse processing snapshot (05-processing.html)
 */
export async function parseProcessingSnapshot(htmlPath) {
  try {
    const html = await readFile(htmlPath, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const avatar = extractAvatar(doc);

    // Find title (usually h1 or h2)
    const titleNode = doc.querySelector("h1, h2");

    // Find subtitle (usually first p)
    const subtitleNode = doc.querySelector("p");

    // Extract bullet points - focus on list items first, then individual paragraphs
    const bullets = [];
    
    // First, try to get list items (most reliable for bullet points)
    const listItems = Array.from(doc.querySelectorAll("li"));
    listItems.forEach((li) => {
      // Get direct text content, excluding nested list items
      const directText = Array.from(li.childNodes)
        .filter(node => node.nodeType === 3) // Text nodes only
        .map(node => node.textContent.trim())
        .join(" ")
        .trim();
      
      if (directText && directText.length > 20) {
        // Also check if it has nested elements with text
        const nestedText = li.textContent.trim();
        // Use nested text if it's reasonable length (not concatenated)
        const text = nestedText.length < 200 ? nestedText : directText;
        if (text && /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(text)) {
          bullets.push(text);
        }
      }
    });
    
    // If no list items found, look for individual paragraphs
    if (bullets.length === 0) {
      const paragraphs = Array.from(doc.querySelectorAll("p"));
      paragraphs.forEach((p) => {
        const text = p.textContent.trim();
        // Only include if it looks like a bullet point (not too long, contains keywords)
        if (text.length > 20 && text.length < 200 && 
            /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(text)) {
          bullets.push(text);
        }
      });
    }
    
    // Remove duplicates and filter out very long concatenated text
    const uniqueBullets = bullets
      .filter((text, index, arr) => arr.indexOf(text) === index)
      .filter(text => text.length < 200); // Filter out concatenated long text

    return {
      avatar: avatar || null,
      title: titleNode?.textContent?.trim() || "Processing data",
      subtitle:
        subtitleNode?.textContent?.trim() ||
        "Our robots are analyzing the behavior of your followers",
      bullets: uniqueBullets.length > 0 ? uniqueBullets : [],
    };
  } catch (err) {
    console.error("Failed to parse processing snapshot:", err.message);
    return null;
  }
}

