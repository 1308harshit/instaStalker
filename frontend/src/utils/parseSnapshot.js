const clean = (value = "") => value.replace(/\s+/g, " ").trim();

const extractBackgroundImage = (element) => {
  if (!element) return null;
  const style = element.getAttribute("style") || "";
  const match = style.match(/url\((.*?)\)/i);
  if (!match) return null;
  let url = match[1].replace(/['"]/g, "");
  return url.replace(/&amp;/g, "&");
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

    // Parse visitor stack - find the container that holds all visitor circles
    // Strategy: Find the text "visited your profile" and look for the visitor stack nearby
    const visitors = [];
    
    // First, try to find visitor stack by looking for the text "visited your profile"
    const visitorText = findByText(heroWrapper, "small, p, span", (text) => 
      /visited.*profile/i.test(text)
    );
    
    let visitorStack = null;
    if (visitorText) {
      // Look for a flex container near this text (usually a sibling or parent)
      let parent = visitorText.parentElement;
      while (parent && parent !== heroWrapper) {
        const flexContainer = parent.querySelector('div[class*="flex"]:not([class*="grid"])');
        if (flexContainer) {
          // Check if this container has multiple children that look like visitors
          const children = Array.from(flexContainer.children);
          const hasVisitorElements = children.some(child => 
            child.tagName === 'IMG' || 
            (child.tagName === 'DIV' && (
              child.textContent?.includes("🔒") ||
              child.querySelector('img') ||
              child.className?.includes("circle") ||
              child.className?.includes("visitor")
            ))
          );
          if (hasVisitorElements) {
            visitorStack = flexContainer;
            break;
          }
        }
        parent = parent.parentElement;
      }
    }
    
    // Fallback: look for visitor-stack class or flex containers with visitor items
    if (!visitorStack) {
      visitorStack = heroWrapper.querySelector(
        'div[class*="visitor-stack"], div[class*="stack"][class*="flex"]'
      ) || heroWrapper.querySelector('div.flex');
    }
    
    if (visitorStack) {
      // Get all direct children of the visitor stack to maintain order
      const visitorElements = Array.from(visitorStack.children);
      
      visitorElements.forEach((element) => {
        // Check if it's an image (visible visitor)
        if (element.tagName === 'IMG') {
          const src = element.getAttribute("src") || "";
          const alt = element.getAttribute("alt") || "";
          if (src) {
            visitors.push({
              alt: alt || `Visitor ${visitors.length + 1}`,
              image: src,
              isLocked: false,
            });
          }
        }
        // Check if it's a div (could be locked visitor or container)
        else if (element.tagName === 'DIV') {
          // Check if this div contains a lock icon
          const lockSpan = element.querySelector('span');
          const hasLockIcon = element.textContent?.includes("🔒") || 
                             (lockSpan && lockSpan.textContent?.includes("🔒")) ||
                             element.querySelector('svg[class*="lock"]') ||
                             element.querySelector('[class*="lock-icon"]');
          
          // Check for locked circle styling (black background, circular)
          const style = element.getAttribute("style") || "";
          const className = element.className || "";
          const hasBlackBg = style.includes("background") && 
                            (style.includes("black") || style.includes("#000") || style.includes("rgb(0,0,0)"));
          const isCircular = className.includes("circle") || 
                            className.includes("rounded-full") ||
                            style.includes("border-radius: 50%") ||
                            style.includes("border-radius:50%");
          
          // If it has lock icon or looks like a locked circle, it's a locked visitor
          if (hasLockIcon || (hasBlackBg && isCircular)) {
            visitors.push({
              alt: `Locked Visitor ${visitors.length + 1}`,
              image: null,
              isLocked: true,
            });
          }
          // Otherwise, check if it contains an image (nested structure like visitor-item)
          else {
            const nestedImg = element.querySelector("img");
            if (nestedImg) {
              const src = nestedImg.getAttribute("src") || "";
              const alt = nestedImg.getAttribute("alt") || "";
              if (src) {
                visitors.push({
                  alt: alt || `Visitor ${visitors.length + 1}`,
                  image: src,
                  isLocked: false,
                });
              }
            }
          }
        }
      });
    }
    
    // Fallback: if no visitor stack found, try to find visitors by searching the entire hero section
    if (visitors.length === 0) {
      // Find all potential visitor elements in order
      const heroProfileImage = analysis.hero.profileImage || "";
      
      // Look for a container that might hold visitors (usually before or after the visitor summary text)
      const potentialContainers = queryAll(heroWrapper, 'div.flex, div[class*="flex"]');
      
      for (const container of potentialContainers) {
        const children = Array.from(container.children);
        // If this container has multiple circular elements (images or divs), it might be the visitor stack
        const circularElements = children.filter(child => {
          const isImg = child.tagName === 'IMG';
          const isDiv = child.tagName === 'DIV';
          if (isImg) return true;
          if (isDiv) {
            const style = child.getAttribute("style") || "";
            const className = child.className || "";
            return className.includes("circle") || 
                   className.includes("rounded-full") ||
                   style.includes("border-radius: 50%");
          }
          return false;
        });
        
        // If we found a container with multiple circular elements, parse it
        if (circularElements.length >= 3) {
          children.forEach((element) => {
            if (element.tagName === 'IMG') {
              const src = element.getAttribute("src") || "";
              if (src && src !== heroProfileImage) {
                visitors.push({
                  alt: element.getAttribute("alt") || `Visitor ${visitors.length + 1}`,
                  image: src,
                  isLocked: false,
                });
              }
            } else if (element.tagName === 'DIV') {
              const hasLock = element.textContent?.includes("🔒") || 
                             element.querySelector('span')?.textContent?.includes("🔒");
              const style = element.getAttribute("style") || "";
              const className = element.className || "";
              const isCircular = className.includes("circle") || 
                                className.includes("rounded-full") ||
                                style.includes("border-radius: 50%");
              const hasBlackBg = style.includes("background") && 
                                (style.includes("black") || style.includes("#000"));
              
              if (hasLock && isCircular && hasBlackBg) {
                visitors.push({
                  alt: `Locked Visitor ${visitors.length + 1}`,
                  image: null,
                  isLocked: true,
                });
              } else {
                // Check for nested image
                const nestedImg = element.querySelector("img");
                if (nestedImg) {
                  const src = nestedImg.getAttribute("src") || "";
                  if (src && src !== heroProfileImage) {
                    visitors.push({
                      alt: nestedImg.getAttribute("alt") || `Visitor ${visitors.length + 1}`,
                      image: src,
                      isLocked: false,
                    });
                  }
                }
              }
            }
          });
          
          // If we found visitors in this container, stop searching
          if (visitors.length > 0) break;
        }
      }
    }
    
    analysis.hero.visitors = visitors;
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

