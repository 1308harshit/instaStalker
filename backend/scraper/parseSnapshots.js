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
    const usernameNode = Array.from(doc.querySelectorAll("span, div, p")).find(
      (node) => /^@/.test((node.textContent || "").trim())
    );

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

    return {
      avatar: avatar || null,
      progressPercent,
      username: (usernameNode?.textContent?.trim() || "").trim(),
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

    // Find bullet points - be more inclusive to catch all processing messages
    const allTextNodes = Array.from(doc.querySelectorAll("p, li, span, div"));
    const bullets = allTextNodes
      .map((node) => node.textContent.trim())
      .filter((text) => {
        // More inclusive filter - look for processing-related content
        return text.length > 15 && (
          /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers/i.test(text) ||
          /found.*\d+|detected.*\d+|visited.*\d+|people.*\d+/i.test(text)
        );
      })
      .filter((text, index, arr) => arr.indexOf(text) === index); // Remove duplicates

    return {
      avatar: avatar || null,
      title: titleNode?.textContent?.trim() || "Processing data",
      subtitle:
        subtitleNode?.textContent?.trim() ||
        "Our robots are analyzing the behavior of your followers",
      bullets: bullets.length > 0 ? bullets : [],
    };
  } catch (err) {
    console.error("Failed to parse processing snapshot:", err.message);
    return null;
  }
}

