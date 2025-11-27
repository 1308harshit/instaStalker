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
    },
    alert: {
      title: "",
      badge: "",
      copy: "",
    },
    addicted: {
      title: "",
      tiles: [],
    },
    table: {
      columns: [],
      rows: [],
    },
    ctas: {
      primary: "",
      secondary: "",
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
  if (sliderHeading) {
    const headingText = clean(sliderHeading.textContent || "");
    const colonIndex = headingText.indexOf(":");
    const beforeColon =
      colonIndex >= 0 ? headingText.slice(0, colonIndex + 1) : headingText;
    const sanitized = beforeColon.split("🔒")[0].trim();
    analysis.slider.heading = sanitized || beforeColon || headingText;
  }

  analysis.slider.cards = queryAll(
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

  const chatWrapper = doc.querySelector("div.space-y-\\[3px\\]");
  if (chatWrapper) {
    analysis.screenshots.chat = queryAll(chatWrapper, "span").map((span) => ({
      text: clean(span.textContent || ""),
      blurred: span.className.includes("blur"),
    }));
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

  return analysis;
}

