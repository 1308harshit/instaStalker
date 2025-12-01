const clean = (value = "") => value.replace(/\s+/g, " ").trim();

const extractBackgroundImage = (element) => {
  if (!element) return null;
  const style = element.getAttribute("style") || "";
  const match = style.match(/url\((.*?)\)/i);
  if (!match) return null;
  return match[1].replace(/['"&]/g, "");
};

const hasBlurClass = (node) => {
  if (!node) return false;
  const className = node.className || "";
  return /\bblur\b|\bblur-/.test(className);
};

const isElementBlurred = (element) => {
  if (!element) return false;
  if (hasBlurClass(element)) return true;
  return queryAll(element, "[class*='blur']").length > 0;
};

const extractUsername = (raw = "") => {
  const text = clean(raw);
  if (!text) return "";
  if (text.startsWith("@")) return text;
  const match = text.match(/@\S+/);
  return match ? match[0] : "";
};

const queryAll = (root, selector) =>
  root ? Array.from(root.querySelectorAll(selector)) : [];

const findByText = (root, selector, predicate) =>
  queryAll(root, selector).find((el) =>
    predicate(el.textContent ? el.textContent.trim() : "")
  );

export function parseResultsSnapshot(html) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const analysis = {
    hero: {
      name: "",
      stats: [],
      visitors: [],
      visitorSummary: "",
      profileImage: "",
    },
    summary: {
      warning: "",
      weekRange: "",
      cards: [],
    },
    slider: {
      heading: "",
      cards: [],
    },
    screenshots: {
      heading: "",
      description: "",
      bullets: [],
      chat: [],
      chatHtml: "",
      chatStyles: "",
      footer: "",
    },
    stories: {
      heading: "",
      slides: [],
    },
    alert: {
      title: "",
      badge: "",
      copy: "",
    },
    addicted: {
      title: "",
      tiles: [],
      footer: "",
      subfooter: "",
    },
    table: {
      columns: [],
      rows: [],
    },
    ctas: {
      primary: "",
      secondary: "",
      tertiary: "",
    },
  };

  const heroWrapper = doc.querySelector("div.mt-\\[25px\\].w-full");
  if (heroWrapper) {
    const heroImg = heroWrapper.querySelector("img");
    if (heroImg) {
      analysis.hero.profileImage = heroImg.getAttribute("src") || "";
    }
    const heroName = heroWrapper.querySelector("h1");
    analysis.hero.name = clean(heroName?.textContent || "");

    const statBlocks = queryAll(heroWrapper, "div.inline-flex");
    analysis.hero.stats = statBlocks
      .map((block) => {
        const spans = block.querySelectorAll("span");
        const value = clean(spans[0]?.textContent || "");
        const label = clean(spans[1]?.textContent || "");
        if (!value || !label) return null;
        return { value, label };
      })
      .filter(Boolean);

    analysis.hero.visitorSummary = clean(
      heroWrapper.querySelector("p")?.textContent || ""
    );

    analysis.hero.visitors = queryAll(heroWrapper, 'img[alt^="Visitor"]').map(
      (img) => ({
        alt: img.alt,
        image: img.getAttribute("src") || "",
      })
    );
  }

  const warningBanner = findByText(
    doc,
    "div",
    (text) => text.includes("Don't leave this page")
  );
  if (warningBanner) {
    analysis.summary.warning = clean(warningBanner.textContent || "");
  }

  const weekLine = findByText(doc, "p", (text) => text.includes("Last week"));
  if (weekLine) {
    analysis.summary.weekRange = clean(weekLine.textContent || "");
  }

  const summaryGrid = doc.querySelector("div.grid.mt-\\[30px\\]");
  if (summaryGrid) {
    analysis.summary.cards = queryAll(
      summaryGrid,
      ".text-card-foreground"
    ).map((card) => ({
      title: clean(card.querySelector("h3, h4")?.textContent || ""),
      detail: clean(card.querySelector("p")?.textContent || ""),
    }));
  }

  const sliderHeading = findByText(doc, "h3", (text) =>
    text.includes("Visited your profile this week")
  );
  const storiesHeading = findByText(doc, "h3", (text) =>
    text.toLowerCase().includes("stories activity")
  );
  if (storiesHeading) {
    analysis.stories.heading = clean(storiesHeading.textContent || "");
    // Find the stories wrapper - could be nextElementSibling or within a parent container
    let storiesWrapper = storiesHeading.nextElementSibling;
    if (!storiesWrapper || !storiesWrapper.querySelector) {
      // Try finding a parent container with carousel or grid
      const parent = storiesHeading.parentElement;
      if (parent) {
        storiesWrapper = parent.querySelector('div[role="region"][aria-roledescription="carousel"], div[class*="carousel"], div[class*="grid"]');
      }
    }
    
    if (storiesWrapper) {
      let storyElements = queryAll(
        storiesWrapper,
        'div[role="group"][aria-roledescription="slide"]'
      );
      // Fallback: try other selectors if no slides found
      if (storyElements.length === 0) {
        storyElements = queryAll(storiesWrapper, "div[class*='flex'] > div[class*='basis'], div[class*='grid'] > div, article, div[class*='card']");
      }
      
      // Get hero profile image to exclude it from story images
      const heroProfileImage = analysis.hero.profileImage || "";
      
      analysis.stories.slides = storyElements.map((slide) => {
        let image = null;
        
        // Method 1: Check for img tag first (most reliable) - exclude hero image
        const imgTags = queryAll(slide, "img");
        for (const imgTag of imgTags) {
          const src = imgTag.getAttribute("src") || "";
          if (src && src !== heroProfileImage && !src.includes("data:image/svg")) {
            image = src;
            break;
          }
        }
        
        // Method 2: Check div.relative with nested div
        if (!image) {
          const cover = slide.querySelector("div.relative");
          if (cover) {
            const imgDiv = cover.querySelector("div[style*='background-image'], img");
            if (imgDiv) {
              const bgImg = extractBackgroundImage(imgDiv);
              if (bgImg && bgImg !== heroProfileImage && bgImg !== "none" && !bgImg.includes("data:image/svg")) {
                image = bgImg;
              } else if (imgDiv.tagName === "IMG") {
                const src = imgDiv.getAttribute("src") || "";
                if (src && src !== heroProfileImage) {
                  image = src;
                }
              }
            }
          }
        }
        
        // Method 3: Check for any div with background-image directly in slide
        if (!image) {
          const bgDivs = queryAll(slide, "div[style*='background-image']");
          for (const bgDiv of bgDivs) {
            const bgImg = extractBackgroundImage(bgDiv);
            if (bgImg && bgImg !== heroProfileImage && bgImg !== "none" && !bgImg.includes("data:image/svg")) {
              image = bgImg;
              break;
            }
          }
        }
        
        // Method 4: Check if slide itself has background-image
        if (!image) {
          const slideStyle = slide.getAttribute("style") || "";
          if (slideStyle.includes("background-image")) {
            const bgImg = extractBackgroundImage(slide);
            if (bgImg && bgImg !== heroProfileImage && bgImg !== "none" && !bgImg.includes("data:image/svg")) {
              image = bgImg;
            }
          }
        }
        
        // Method 5: Check all divs recursively for background-image (excluding hero image)
        if (!image) {
          const allDivs = queryAll(slide, "div");
          for (const div of allDivs) {
            const bgImg = extractBackgroundImage(div);
            if (bgImg && bgImg !== heroProfileImage && bgImg !== "none" && !bgImg.includes("data:image/svg")) {
              image = bgImg;
              break;
            }
          }
        }
        
        const caption = slide.querySelector("p, h4, h5, .caption, [class*='caption']");
        const meta = slide.querySelector("span, small, .meta, [class*='meta']");
        
        return {
          image,
          caption: clean(caption?.textContent || ""),
          meta: clean(meta?.textContent || ""),
        };
      });
      
      console.log("Parsed stories:", analysis.stories.slides.length, "slides");
      analysis.stories.slides.forEach((slide, idx) => {
        console.log(`Story ${idx}:`, { 
          hasImage: !!slide.image, 
          imagePreview: slide.image?.substring(0, 50),
          caption: slide.caption,
          meta: slide.meta 
        });
      });
    }
  }
  // Hardcode the slider heading
  analysis.slider.heading = "Visited your profile this week between 2 to 7 times:";

  const rawSliderCards = queryAll(
    doc,
    'div[role="group"][aria-roledescription="slide"]'
  ).map((slide) => {
    const titleNode = slide.querySelector("h4");
    const art = slide.querySelector('div[style*="background-image"]');
    const textNodes = queryAll(slide, "p, h2, h5, span.text-sm, span.text-base");
    const badgeNode = slide.querySelector(
      ".text-sm.badge, .text-base.badge, span.font-medium.badge"
    );
    const lockTextNode =
      slide.querySelector("h2") ||
      textNodes.find((node) => node.textContent?.includes("visited"));

    const lines = textNodes
      .map((node) => ({
        text: clean(node.textContent || ""),
        blurred: false,
      }))
      .filter((line) => Boolean(line.text));

    const image = extractBackgroundImage(art);
    const username = extractUsername(titleNode?.textContent);
    const cardHasUsername = Boolean(username);
    const lockIcon = slide.querySelector("h1");
    const isLocked =
      lockIcon?.textContent?.includes("🔒") ||
      slide.className?.toLowerCase().includes("locked");

    let lockText = clean(lockTextNode?.textContent || "");
    if (!lockText && lines.length) {
      lockText = lines[0].text;
    }
    const lockTextBlurred = false;

    return {
      title: clean(titleNode?.textContent || ""),
      username,
      lines: isLocked ? [] : lines,
      badge: clean(badgeNode?.textContent || ""),
      image,
      isLocked,
      lockText,
      lockTextBlurred,
      blurImage: (!cardHasUsername && Boolean(image)) || hasBlurClass(art),
    };
  });

  const deduped = [];
  const seen = new Set();

  rawSliderCards.forEach((card) => {
    const key = card.isLocked
      ? `locked::${card.lockText}`
      : `user::${card.username || card.title}`;
    if (!card.username && !card.isLocked) return;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(card);
  });

  analysis.slider.cards = deduped;

  const screenshotHeading = findByText(doc, "h3", (text) =>
    text.includes("Screenshots")
  );
  if (screenshotHeading) {
    analysis.screenshots.heading = clean(
      screenshotHeading.textContent || ""
    );
    const description = screenshotHeading.nextElementSibling;
    analysis.screenshots.description = clean(description?.textContent || "");

    const bulletWrapper = description?.nextElementSibling;
    analysis.screenshots.bullets = queryAll(bulletWrapper, "span").map((span) =>
      clean(span.textContent || "")
    );
  }

  // Extract chat messages from the messages container
  const messagesContainer = doc.querySelector("div.itens.space-x-3, div[class*='itens'][class*='space-x-3'], div[class*='space-x'][class*='flex'][class*='items-end']");
  
  if (messagesContainer) {
    // Find the messages wrapper (div.space-y-[3px] or similar)
    const messagesWrapper = messagesContainer.querySelector("div.space-y-\\[3px\\], div[class*='space-y']");
    
    if (messagesWrapper) {
      // Extract all message divs (bubbles)
      const messageBubbles = queryAll(messagesWrapper, "div[class*='bg-'], div[class*='rounded']");
      
      if (messageBubbles.length > 0) {
        analysis.screenshots.chat = messageBubbles.map((bubble) => {
          // Find all spans with text - extract segments with individual blur status
          const spans = queryAll(bubble, "span");
          const segments = [];
          
          if (spans.length > 0) {
            spans.forEach(span => {
              const text = clean(span.textContent || "");
              if (text && text.trim()) {
                const spanClass = span.className || "";
                const isBlurred = spanClass.includes("blur") || spanClass.includes("blur-sm");
                segments.push({
                  text: text.trim(),
                  blurred: isBlurred
                });
              }
            });
          }
          
          // If no spans found, get direct text content
          if (segments.length === 0) {
            const fullText = clean(bubble.textContent || "");
            if (fullText) {
              const isBlurred = bubble.className && bubble.className.includes("blur");
              segments.push({
                text: fullText.trim(),
                blurred: isBlurred
              });
            }
          }
          
          // Return segments array for this message
          return {
            segments: segments.filter(s => s.text && s.text.length > 0),
            // For backward compatibility, also provide full text and blur status
            text: segments.map(s => s.text).join(" "),
            blurred: segments.length > 0 && segments.every(s => s.blurred)
          };
        }).filter(bubble => bubble.segments && bubble.segments.length > 0);
      } else {
        // Fallback: try to find spans directly in messagesWrapper
        const spans = queryAll(messagesWrapper, "span");
        if (spans.length > 0) {
          analysis.screenshots.chat = spans.map((span) => {
            const text = clean(span.textContent || "");
            const spanClass = span.className || "";
            const isBlurred = spanClass.includes("blur") || spanClass.includes("blur-sm");
            return {
              segments: [{
                text: text.trim(),
                blurred: isBlurred
              }],
              text: text.trim(),
              blurred: isBlurred
            };
          }).filter(bubble => bubble.text && bubble.text.length > 0);
        }
      }
    } else {
      // If no messagesWrapper, try to find message bubbles directly in messagesContainer
      const messageBubbles = queryAll(messagesContainer, "div[class*='bg-\\[#262626\\]'], div[class*='bg-\\[#2'], div[class*='rounded']");
      if (messageBubbles.length > 0) {
        analysis.screenshots.chat = messageBubbles.map((bubble) => {
          const spans = queryAll(bubble, "span");
          const segments = [];
          
          if (spans.length > 0) {
            spans.forEach(span => {
              const text = clean(span.textContent || "");
              if (text && text.trim()) {
                const spanClass = span.className || "";
                const isBlurred = spanClass.includes("blur") || spanClass.includes("blur-sm");
                segments.push({
                  text: text.trim(),
                  blurred: isBlurred
                });
              }
            });
          }
          
          if (segments.length === 0) {
            const fullText = clean(bubble.textContent || "");
            if (fullText) {
              const isBlurred = bubble.className && bubble.className.includes("blur");
              segments.push({
                text: fullText.trim(),
                blurred: isBlurred
              });
            }
          }
          
          return {
            segments: segments.filter(s => s.text && s.text.length > 0),
            text: segments.map(s => s.text).join(" "),
            blurred: segments.length > 0 && segments.every(s => s.blurred)
          };
        }).filter(bubble => bubble.segments && bubble.segments.length > 0);
      }
    }
  }
  
  // Final fallback: try to find messages in space-y container anywhere in the document
  if (!analysis.screenshots.chat || analysis.screenshots.chat.length === 0) {
    const chatWrapper = doc.querySelector("div.space-y-\\[3px\\], div[class*='space-y-\\[3px\\]']");
    if (chatWrapper) {
        const spans = queryAll(chatWrapper, "span");
        if (spans.length > 0) {
          analysis.screenshots.chat = spans.map((span) => {
            const text = clean(span.textContent || "");
            const spanClass = span.className || "";
            const isBlurred = spanClass.includes("blur") || spanClass.includes("blur-sm");
            return {
              segments: [{
                text: text.trim(),
                blurred: isBlurred
              }],
              text: text.trim(),
              blurred: isBlurred
            };
          }).filter(bubble => bubble.text && bubble.text.length > 0);
        }
    }
  }

  // Find the container with background image (print-message-new.png)
  const backgroundDiv = doc.querySelector("div[style*='print-message-new.png']");
  
  // Find parent container that wraps both background and messages
  let chatParent = null;
  
  if (backgroundDiv) {
    // Start from background div and find parent that contains messages
    let parent = backgroundDiv.parentElement;
    while (parent && parent !== doc.body) {
      // Check if this parent contains both background and messages
      const hasBg = parent.contains(backgroundDiv) || parent === backgroundDiv;
      const hasMsg = messagesContainer && parent.contains(messagesContainer);
      
      if (hasBg && hasMsg) {
        chatParent = parent;
        break;
      }
      
      // Also check for relative/absolute positioning containers
      const hasRelativeClass = parent.classList.contains("relative") || 
                               parent.classList.contains("absolute");
      const hasRelativeStyle = (parent.getAttribute("style") || "").includes("position");
      
      if (hasRelativeClass || hasRelativeStyle) {
        const bgInParent = parent.querySelector("div[style*='print-message-new.png'], div[style*='background-image']");
        const msgInParent = parent.querySelector("div.itens, div[class*='space-x-3']");
        if (bgInParent && msgInParent) {
          chatParent = parent;
          break;
        }
      }
      
      parent = parent.parentElement;
    }
    
    // If no parent found, try to find by looking for relative container
    if (!chatParent) {
      const relativeContainer = backgroundDiv.closest("div[class*='relative'], div[class*='absolute'], div[style*='position']");
      if (relativeContainer) {
        chatParent = relativeContainer;
      } else if (backgroundDiv.parentElement) {
        chatParent = backgroundDiv.parentElement;
      }
    }
  } else if (messagesContainer) {
    // If only messages found, find its parent with relative positioning or background
    let parent = messagesContainer.parentElement;
    while (parent && parent !== doc.body) {
      const hasRelative = parent.classList.contains("relative") || 
                         parent.classList.contains("absolute") ||
                         (parent.getAttribute("style") || "").includes("position");
      const hasBg = parent.querySelector("div[style*='background-image']");
      
      if (hasRelative || hasBg) {
        chatParent = parent;
        break;
      }
      parent = parent.parentElement;
    }
    if (!chatParent && messagesContainer.parentElement) {
      chatParent = messagesContainer.parentElement;
    }
  }
  
  if (chatParent) {
    // Extract the HTML with all styles, classes, and inline styles
    // Keep original paths - we'll replace them in the renderer
    analysis.screenshots.chatHtml = chatParent.outerHTML;
    
    // Extract any relevant CSS from style tags that might affect this container
    const styleTags = doc.querySelectorAll("style");
    const relevantStyles = Array.from(styleTags)
      .map(style => style.textContent || "")
      .filter(styleText => {
        // Check if style contains classes used in chat container
        return styleText.includes("itens") || 
               styleText.includes("space-x-3") || 
               styleText.includes("print-message") ||
               styleText.includes("messages") ||
               styleText.includes("rounded-2xl");
      })
      .join("\n");
    
    if (relevantStyles) {
      analysis.screenshots.chatStyles = relevantStyles;
    }
  } else if (backgroundDiv) {
    analysis.screenshots.chatHtml = backgroundDiv.outerHTML;
  } else if (messagesContainer) {
    analysis.screenshots.chatHtml = messagesContainer.outerHTML;
  }
  
  if (!analysis.screenshots.footer) {
    const footerCandidate = findByText(
      doc,
      "p",
      (text) => /uncensored|relat[óo]rio/i.test(text)
    );
    analysis.screenshots.footer = clean(
      footerCandidate?.textContent || ""
    );
  }

  const alertHeading = findByText(doc, "h3", (text) =>
    text.includes("Tem amigos querendo se")
  );
  if (alertHeading) {
    analysis.alert.title = clean(alertHeading.textContent || "");
    const badge = alertHeading.nextElementSibling;
    const copy = badge?.nextElementSibling;
    analysis.alert.badge = clean(badge?.textContent || "");
    analysis.alert.copy = clean(copy?.textContent || "");
  }

  const addictedHeading = findByText(doc, "h3", (text) =>
    text.includes("addicted")
  );
  if (addictedHeading) {
    analysis.addicted.title = clean(addictedHeading.textContent || "");
    const addictedGrid = addictedHeading.nextElementSibling;
    analysis.addicted.tiles = queryAll(
      addictedGrid,
      ".text-card-foreground"
    ).map((tile) => {
      const handle = tile.querySelector("h4");
      const body = tile.querySelector("p");
      return {
        title: clean(handle?.textContent || ""),
        blurred: Boolean(tile.querySelector(".blur-sm")),
        body: clean(body?.textContent || ""),
      };
    });
    const addictedFooter = findByText(
      addictedHeading.parentElement,
      "p",
      (text) => /full report/i.test(text)
    );
    const addictedSubfooter = findByText(
      addictedHeading.parentElement,
      "p",
      (text) => /limited time/i.test(text)
    );
    analysis.addicted.footer = clean(addictedFooter?.textContent || "");
    analysis.addicted.subfooter = clean(
      addictedSubfooter?.textContent || ""
    );
  }

  const table = doc.querySelector("table");
  if (table) {
    const columns = queryAll(table, "thead th")
      .map((th) => clean(th.textContent || ""))
      .filter(Boolean);
    const rows = queryAll(table, "tbody tr").map((row) =>
      queryAll(row, "td").map((cell) => ({
        text: clean(cell.textContent || ""),
        blurred: Boolean(cell.querySelector(".blur-sm")),
      }))
    );
    analysis.table.columns = columns;
    analysis.table.rows = rows;
  }

  const buttons = queryAll(doc, "button").map((btn) =>
    clean(btn.textContent || "")
  );
  analysis.ctas.primary =
    buttons.find((text) => text.toLowerCase().includes("stalker")) || "";
  analysis.ctas.secondary =
    buttons.find((text) => text.toLowerCase().includes("uncensored")) || "";
  analysis.ctas.tertiary =
    buttons.find((text) =>
      text.toLowerCase().includes("full report") ||
      text.toLowerCase().includes("relatório")
    ) || "";

  return analysis;
}

