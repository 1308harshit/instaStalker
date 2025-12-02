import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseResultsSnapshot } from "./utils/parseSnapshot";
import { parseFullReport } from "./utils/parseFullReport";
import b1Image from "./assets/b1.jpg";
import g1Image from "./assets/g1.jpg";
import g2Image from "./assets/g2.jpg";
import printMessageBg from "./assets/print-message-new.png";
import profileNewPng from "./assets/profile-new.png";

const API_URL =
  import.meta.env.VITE_API_URL?.trim() || "http://localhost:3000/api/stalkers";
const API_BASE = (() => {
  try {
    const url = new URL(API_URL);
    return `${url.protocol}//${url.host}`;
  } catch (err) {
    return "http://localhost:3000";
  }
})();
const SNAPSHOT_BASE = import.meta.env.VITE_SNAPSHOT_BASE?.trim() || API_BASE;

const SCREEN = {
  LANDING: "landing",
  ANALYZING: "analyzing",
  PROFILE: "profile",
  PROCESSING: "processing",
  PREVIEW: "preview",
  FULL_REPORT: "full-report",
  PAYMENT: "payment",
  ERROR: "error",
};

const INITIAL_PROFILE = {
  name: "Harshit",
  username: "@harshit_1308",
  posts: 10,
  followers: 232,
  following: 427,
  avatar:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=facearea&w=400&h=400",
};

const DEFAULT_STATS = { mentions: 0, screenshots: 0, visits: 0 };
const BLUR_KEYWORD_REGEX = /bluredus/i;
const INVALID_USERNAME_REGEX = /unknown/i;
const NON_EN_SUMMARY_REGEX =
  /(seus seguidores|amoroso|vista\(o\)|você é|dos seus)/i;
const SUMMARY_EXCLUDE_REGEX = /top.*#.*stalker|stalker.*top/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ANALYZING_STAGE_HOLD_MS = 1500;
const PROFILE_STAGE_HOLD_MS = 5000;
const PROCESSING_STAGE_HOLD_MS = 2000;

const randBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const isValidUsername = (value = "") =>
  Boolean(value) && !INVALID_USERNAME_REGEX.test(value);

const createProfileStageData = (
  username = INITIAL_PROFILE.username,
  avatar = INITIAL_PROFILE.avatar,
  name = INITIAL_PROFILE.name
) => ({
  avatar,
  progressPercent: 55,
  username,
  greeting: `Hello, ${name || username.replace("@", "")}`,
  question: "Is this your profile?",
  primaryCta: "Continue, the profile is correct",
  secondaryCta: "No, I want to correct it",
});

const createProcessingStageData = (
  username = INITIAL_PROFILE.username,
  avatar = INITIAL_PROFILE.avatar
) => ({
  avatar,
  title: "Processing data",
  subtitle: "Our robots are analyzing the behavior of your followers",
  bullets: [
    `Found 10 mentions of ${username} in messages from your followers`,
    "Our AI detected a possible screenshot of someone talking about you",
    "It was detected that someone you know visited your profile 9 times yesterday",
    "2 people from your region shared one of your stories",
  ],
});

const extractInlineAvatar = (doc) => {
  const candidate = Array.from(doc.querySelectorAll("[style]")).find((node) =>
    /background-image/i.test(node.getAttribute("style") || "")
  );
  if (candidate) {
    const match = candidate
      .getAttribute("style")
      .match(/url\((['"]?)(.+?)\1\)/i);
    if (match?.[2]) {
      return match[2];
    }
  }
  const imgNode = doc.querySelector("img[src]");
  return imgNode?.getAttribute("src") || INITIAL_PROFILE.avatar;
};

const parseProfileSnapshot = (
  html,
  fallbackUsername = INITIAL_PROFILE.username
) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const avatar = extractInlineAvatar(doc);
    const usernameNode = Array.from(doc.querySelectorAll("span, div, p")).find(
      (node) => /^@/.test((node.textContent || "").trim())
    );
    const greetingNode = doc.querySelector("h1, h2");
    const questionNode = Array.from(doc.querySelectorAll("p, span")).find(
      (node) => /profile/i.test((node.textContent || "").trim())
    );
    const buttons = Array.from(doc.querySelectorAll("button"));
    const progressNode = Array.from(doc.querySelectorAll("[style]")).find(
      (node) => /width:\s*\d+%/i.test(node.getAttribute("style") || "")
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
    let cleanUsername = fallbackUsername;
    if (usernameNode) {
      const rawText = usernameNode.textContent?.trim() || "";
      // Try to extract just the @username part
      // Match @username pattern and stop before "Hello", "Is", or any capital letter that starts a new word
      const usernameMatch = rawText.match(/^(@[\w_]+)/i);
      if (usernameMatch) {
        cleanUsername = usernameMatch[1];
        // Additional cleanup: remove common concatenated words
        // If username ends with common words like "Hello", "Is", etc., remove them
        const cleaned = cleanUsername.replace(
          /(Hello|Is|Continue|the|profile|correct|No|want|correct|it)$/i,
          ""
        );
        if (cleaned.startsWith("@")) {
          cleanUsername = cleaned;
        }
      } else if (rawText.startsWith("@")) {
        // If it starts with @, extract up to first non-username character or common words
        const parts = rawText.split(
          /(Hello|Is|Continue|the|profile|correct|No|want|correct|it)/i
        );
        cleanUsername = parts[0] || fallbackUsername;
      }
    }

    return {
      avatar,
      progressPercent,
      username: cleanUsername,
      greeting: (greetingNode?.textContent || "Hello").trim(),
      question: (questionNode?.textContent || "Is this your profile?").trim(),
      primaryCta: (
        buttons[0]?.textContent || "Continue, the profile is correct"
      ).trim(),
      secondaryCta: (
        buttons[1]?.textContent || "No, I want to correct it"
      ).trim(),
    };
  } catch (err) {
    console.error("Failed to parse profile snapshot", err);
    return null;
  }
};

const parseProcessingSnapshot = (html, fallbackAvatar, fallbackUsername) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const avatar = extractInlineAvatar(doc) || fallbackAvatar;
    const titleNode = doc.querySelector("h1, h2");
    const subtitleNode = doc.querySelector("p");
    // Extract bullet points - focus on list items first, then individual paragraphs
    const bullets = [];

    // First, try to get list items (most reliable for bullet points)
    const listItems = Array.from(doc.querySelectorAll("li"));
    listItems.forEach((li) => {
      // Get direct text content, excluding nested list items
      const directText = Array.from(li.childNodes)
        .filter((node) => node.nodeType === 3) // Text nodes only
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      if (directText && directText.length > 20) {
        // Also check if it has nested elements with text
        const nestedText = li.textContent.trim();
        // Use nested text if it's reasonable length (not concatenated)
        const text = nestedText.length < 200 ? nestedText : directText;
        if (
          text &&
          /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(
            text
          )
        ) {
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
        if (
          text.length > 20 &&
          text.length < 200 &&
          /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(
            text
          )
        ) {
          bullets.push(text);
        }
      });
    }

    // Remove duplicates and filter out very long concatenated text
    const uniqueBullets = bullets
      .filter((text, index, arr) => arr.indexOf(text) === index)
      .filter((text) => text.length < 200); // Filter out concatenated long text

    return {
      avatar,
      title: titleNode?.textContent?.trim() || "Processing data",
      subtitle:
        subtitleNode?.textContent?.trim() ||
        "Our robots are analyzing the behavior of your followers",
      bullets:
        uniqueBullets.length > 0
          ? uniqueBullets
          : [
              `Found 10 mentions of ${fallbackUsername} in messages from your followers`,
              "Our AI detected a possible screenshot of someone talking about you",
              "It was detected that someone you know visited your profile 9 times yesterday",
              "2 people from your region shared one of your stories",
            ],
    };
  } catch (err) {
    console.error("Failed to parse processing snapshot", err);
    return null;
  }
};

function App() {
  const [screen, setScreen] = useState(SCREEN.LANDING);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [usernameInput, setUsernameInput] = useState("");
  const [cards, setCards] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [processingStats, setProcessingStats] = useState(DEFAULT_STATS);
  const [profileStage, setProfileStage] = useState(createProfileStageData());
  const [processingStage, setProcessingStage] = useState(
    createProcessingStageData(INITIAL_PROFILE.username, INITIAL_PROFILE.avatar)
  );
  const [canAdvanceFromProfile, setCanAdvanceFromProfile] = useState(false);
  const [canAdvanceFromProcessing, setCanAdvanceFromProcessing] =
    useState(false);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [storiesCarouselIndex, setStoriesCarouselIndex] = useState(0);
  const toastTimers = useRef({});
  const tickerRef = useRef(null);
  const profileHoldTimerRef = useRef(null);
  const processingHoldTimerRef = useRef(null);
  const analyzingTimerRef = useRef(null);
  const analyzingStartRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const [profileConfirmParsed, setProfileConfirmParsed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshotHtml, setSnapshotHtml] = useState({
    analyzing: null,
    "profile-confirm": null,
    processing: null,
  });
  const [fullReportHtml, setFullReportHtml] = useState(null);
  const [fullReportData, setFullReportData] = useState(null);
  const [fullReportLoading, setFullReportLoading] = useState(false);
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);

  // Payment page state
  const [paymentForm, setPaymentForm] = useState({
    email: "",
    fullName: "",
    phoneNumber: "",
  });
  const [paymentCountdown, setPaymentCountdown] = useState(404); // 6:44 in seconds
  const [quantity, setQuantity] = useState(1);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const activeRequestRef = useRef(0);
  const stepHtmlFetchRef = useRef({});
  const snapshotLookup = useMemo(() => {
    return snapshots.reduce((acc, step) => {
      acc[step.name] = step;
      return acc;
    }, {});
  }, [snapshots]);

  // Fetch HTML content for a snapshot
  const fetchSnapshotHtml = async (stepName, htmlPath) => {
    const url = buildSnapshotUrl(htmlPath);
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const html = await res.text();
      if (typeof DOMParser !== "undefined") {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        doc.querySelectorAll("script").forEach((node) => node.remove());
        const body = doc.querySelector("body");
        const styles = doc.querySelectorAll("style, link[rel='stylesheet']");
        const headMarkup = Array.from(styles)
          .map((node) => node.outerHTML)
          .join("");
        if (body) {
          return `${headMarkup}${body.innerHTML}`;
        }
      }
      return html;
    } catch (err) {
      console.error(`Failed to fetch snapshot HTML for ${stepName}:`, err);
      return null;
    }
  };

  // Effect to fetch HTML when snapshots become available
  useEffect(() => {
    const loadSnapshotHtml = async (stepName) => {
      const step = snapshotLookup[stepName];
      if (!step || snapshotHtml[stepName] || stepHtmlFetchRef.current[stepName])
        return;
      stepHtmlFetchRef.current[stepName] = true;
      const html = await fetchSnapshotHtml(stepName, step.htmlPath);
      if (html) {
        setSnapshotHtml((prev) => {
          if (prev[stepName]) return prev;
          return {
            ...prev,
            [stepName]: html,
          };
        });
        if (stepName === "profile-confirm") {
          const parsed = parseProfileSnapshot(html, profile.username);
          if (parsed) {
            setProfileStage(parsed);
            setProfileConfirmParsed(true); // Mark as parsed
          }
        }
        if (stepName === "processing") {
          const parsed = parseProcessingSnapshot(
            html,
            profile.avatar,
            profile.username
          );
          if (parsed) {
            setProcessingStage(parsed);
          }
        }
      }
      stepHtmlFetchRef.current[stepName] = false;
    };

    // Load HTML for each available snapshot (only if not already loaded)
    if (snapshotLookup["analyzing"]) {
      loadSnapshotHtml("analyzing");
    }
    if (snapshotLookup["profile-confirm"]) {
      loadSnapshotHtml("profile-confirm");
    }
    if (snapshotLookup["processing"]) {
      loadSnapshotHtml("processing");
    }
  }, [snapshotLookup, snapshotHtml, profile.avatar, profile.username]);

  useEffect(
    () => () => {
      Object.values(toastTimers.current).forEach(clearTimeout);
      clearInterval(tickerRef.current);
      clearTimeout(profileHoldTimerRef.current);
      clearTimeout(processingHoldTimerRef.current);
      clearInterval(analyzingTimerRef.current);
      clearTimeout(notificationTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (screen !== SCREEN.PROCESSING) {
      clearInterval(tickerRef.current);
      return;
    }
    setProcessingStats(DEFAULT_STATS);
    tickerRef.current = setInterval(() => {
      setProcessingStats((prev) => ({
        mentions: prev.mentions + randBetween(1, 3),
        screenshots: prev.screenshots + randBetween(0, 1),
        visits: prev.visits + randBetween(1, 3),
      }));
    }, 1000);
    return () => clearInterval(tickerRef.current);
  }, [screen]);

  useEffect(() => {
    if (screen === SCREEN.PREVIEW || screen === SCREEN.ERROR) {
      return;
    }

    // Transition to profile-confirm when: HTML fetched + parsed + analyzing complete
    if (
      screen === SCREEN.ANALYZING &&
      snapshotHtml["profile-confirm"] &&
      profileConfirmParsed &&
      analyzingProgress >= 100 &&
      (!analyzingStartRef.current ||
        Date.now() - analyzingStartRef.current >= ANALYZING_STAGE_HOLD_MS)
    ) {
      setScreen(SCREEN.PROFILE);
      setCanAdvanceFromProfile(false);
      clearTimeout(profileHoldTimerRef.current);
      profileHoldTimerRef.current = setTimeout(() => {
        setCanAdvanceFromProfile(true);
      }, PROFILE_STAGE_HOLD_MS);
      return;
    }

    if (
      screen === SCREEN.PROFILE &&
      snapshotHtml.processing &&
      canAdvanceFromProfile
    ) {
      setScreen(SCREEN.PROCESSING);
      setCanAdvanceFromProcessing(false);
      clearTimeout(processingHoldTimerRef.current);
      processingHoldTimerRef.current = setTimeout(() => {
        setCanAdvanceFromProcessing(true);
      }, PROCESSING_STAGE_HOLD_MS);
      return;
    }
  }, [
    screen,
    snapshotHtml["profile-confirm"],
    snapshotHtml.processing,
    canAdvanceFromProfile,
    analyzingProgress,
    profileConfirmParsed,
  ]);

  useEffect(() => {
    const filtered = cards.filter(
      (item) => item && isValidUsername(item.username)
    );
    setNotifications(filtered);
  }, [cards]);

  useEffect(() => {
    // Start analyzing immediately when screen becomes ANALYZING
    // DO NOT wait for 03-analyzing.html to arrive
    if (screen !== SCREEN.ANALYZING) return;

    analyzingStartRef.current = Date.now();
    setAnalyzingProgress(0);
    clearInterval(analyzingTimerRef.current);
    analyzingTimerRef.current = setInterval(
      () => {
        setAnalyzingProgress((prev) => {
          if (prev >= 98) {
            clearInterval(analyzingTimerRef.current);
            return 98;
          }
          return Math.min(98, prev + 1);
          // randBetween(2, 5));
        });
      },
      // 800
      120
    );
    return () => clearInterval(analyzingTimerRef.current);
  }, [screen]);

  useEffect(() => {
    // Immediately set analyzing to 100% when profile-confirm is parsed
    // DO NOT animate - set it instantly
    if (screen !== SCREEN.ANALYZING) return;
    if (!snapshotHtml["profile-confirm"]) return;
    if (!profileConfirmParsed) return; // Wait until parsing is complete

    // Force analyzing to 100% immediately
    clearInterval(analyzingTimerRef.current);
    setAnalyzingProgress(100);
  }, [screen, snapshotHtml["profile-confirm"], profileConfirmParsed]);

  useEffect(() => {
    if (screen !== SCREEN.PROCESSING) {
      return;
    }
    // Show first bullet immediately (no delay)
    setProcessingMessageIndex(0);
    setCanAdvanceFromProcessing(false); // Reset when processing starts

    // If there's only one bullet, wait 1 second then allow transition
    if (processingStage.bullets.length <= 1) {
      const singleBulletTimer = setTimeout(() => {
        setCanAdvanceFromProcessing(true);
      }, 1000);
      return () => clearTimeout(singleBulletTimer);
    }

    let bulletTimer = null;
    let finalDelayTimer = null;

    // Show remaining bullets one by one with 1.5 second delay (starting from second bullet)
    bulletTimer = setInterval(() => {
      setProcessingMessageIndex((prev) => {
        const nextIndex = prev + 1;
        // Check if all bullets are now shown (we've reached the last index)
        if (nextIndex >= processingStage.bullets.length - 1) {
          clearInterval(bulletTimer);
          // All bullets are now visible, wait 1 more second before allowing transition
          finalDelayTimer = setTimeout(() => {
            setCanAdvanceFromProcessing(true);
          }, 1000); // 1 second delay after last bullet is shown
          return processingStage.bullets.length - 1;
        }
        return nextIndex;
      });
    }, 1500); // 1.5 second delay between each bullet

    return () => {
      if (bulletTimer) {
        clearInterval(bulletTimer);
      }
      if (finalDelayTimer) {
        clearTimeout(finalDelayTimer);
      }
    };
  }, [screen, processingStage.bullets.length]);

  useEffect(() => {
    const resultsStep = snapshots.find((step) => step.name === "results");
    if (!resultsStep) return;
    const url = buildSnapshotUrl(resultsStep.htmlPath);
    if (!url) return;
    let cancelled = false;

    const loadAnalysis = async () => {
      try {
        setAnalysisLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error("Unable to download analyzer snapshot");
        const html = await res.text();
        if (cancelled) return;
        const parsed = parseResultsSnapshot(html);
        setAnalysis(parsed);
      } catch (err) {
        console.error("Failed to parse analyzer snapshot", err);
      } finally {
        if (!cancelled) {
          setAnalysisLoading(false);
        }
      }
    };

    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [snapshots]);

  useEffect(() => {
    // Wait until all processing bullets are shown before transitioning to preview
    const allBulletsShown =
      processingStage.bullets.length > 0 &&
      processingMessageIndex >= processingStage.bullets.length - 1;

    if (
      analysis &&
      screen === SCREEN.PROCESSING &&
      canAdvanceFromProcessing &&
      allBulletsShown
    ) {
      setScreen(SCREEN.PREVIEW);
    }
  }, [
    analysis,
    screen,
    canAdvanceFromProcessing,
    processingMessageIndex,
    processingStage.bullets.length,
  ]);

  useEffect(() => {
    // Reset carousel when cards or analysis changes
    setCarouselIndex(0);
    setStoriesCarouselIndex(0);
  }, [cards, analysis]);

  // Auto-scroll carousel
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;

    const allCards = analysis?.slider?.cards?.length
      ? analysis.slider.cards
      : cards;
    if (allCards.length <= 1) return;

    // Calculate filtered cards length (same logic as in render)
    // Filter out cards that come right after blurred cards (positions 6, 11, 16, etc.)
    const filteredCards = allCards.filter((card, index) => {
      const isAfterBlurredCard = (index - 1) > 0 && (index - 1) % 5 === 0;
      return !isAfterBlurredCard;
    });
    
    if (filteredCards.length <= 1) return;

    const interval = setInterval(() => {
      setCarouselIndex((prev) => {
        // Loop: if at last card, jump to first (0)
        return prev < filteredCards.length - 1 ? prev + 1 : 0;
      });
    }, 1500); // Change slide every 1.5 seconds

    return () => clearInterval(interval);
  }, [screen, cards, analysis]);

  // Auto-scroll stories carousel
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;

    const storiesSlides = analysis?.stories?.slides || [];
    if (storiesSlides.length <= 1) return;

    const interval = setInterval(() => {
      setStoriesCarouselIndex((prev) =>
        prev < storiesSlides.length - 1 ? prev + 1 : 0
      );
    }, 1500); // Change slide every 1.5 seconds

    return () => clearInterval(interval);
  }, [screen, analysis]);

  useEffect(() => {
    if (screen !== SCREEN.PREVIEW || notifications.length === 0) {
      clearTimeout(notificationTimerRef.current);
      return;
    }
    let index = 0;

    const schedule = (wait) => {
      notificationTimerRef.current = setTimeout(() => {
        let item = null;
        let attempts = 0;
        while (attempts < notifications.length && !item) {
          const candidate = notifications[index % notifications.length];
          index += 1;
          attempts += 1;
          if (isValidUsername(candidate?.username)) {
            item = candidate;
          }
        }

        if (item) {
          // Array of 4 different notification message templates
          const messageTemplates = [
            () => `${item.username} visited your profile`,
            () => `${item.username} took a screenshot of your profile`,
            () => {
              const messageCount = randBetween(1, 5);
              return `${item.username} mentioned you in ${messageCount} message${messageCount > 1 ? 's' : ''}`;
            },
            () => {
              const visitCount = randBetween(5, 10);
              const dayCount = randBetween(2, 5);
              return `${item.username} visited your profile ${visitCount} times in the last ${dayCount} days`;
            }
          ];
          
          // Randomly select one of the message templates
          const randomTemplate = messageTemplates[randBetween(0, messageTemplates.length - 1)];
          const message = randomTemplate();
          
          pushToast(message, item.image);
        }

        // Random interval between 15-20 seconds
        const nextDelay = randBetween(15000, 20000);
        schedule(nextDelay);
      }, wait);
    };

    // Start with a random delay between 15-20 seconds
    schedule(randBetween(15000, 20000));
    return () => clearTimeout(notificationTimerRef.current);
  }, [screen, notifications]);

  const buildSnapshotUrl = (htmlPath = "") => {
    if (!htmlPath) return null;
    const normalized = htmlPath.startsWith("/") ? htmlPath : `/${htmlPath}`;
    return `${SNAPSHOT_BASE}${normalized}`;
  };

  const profileStatsFromState = () => [
    { value: profile.posts, label: "posts" },
    { value: profile.followers, label: "followers" },
    { value: profile.following, label: "following" },
  ];

  const pushToast = (message, image) => {
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, image }]);
    toastTimers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      delete toastTimers.current[id];
    }, 5000);
  };

  const checkSnapshotExists = async (username, timestamp, fileName) => {
    const snapshotPath = `/snapshots/${encodeURIComponent(
      username
    )}/${timestamp}/${fileName}`;
    const url = buildSnapshotUrl(snapshotPath);
    try {
      // Try HEAD first (lighter), fallback to GET if HEAD fails
      let res = await fetch(url, {
        method: "HEAD",
        cache: "no-cache",
      });
      if (!res.ok && res.status === 405) {
        // If HEAD not supported, try GET
        res = await fetch(url, {
          method: "GET",
          cache: "no-cache",
        });
      }
      return res.ok;
    } catch {
      return false;
    }
  };

  const findSnapshotDirectory = async (username, requestId) => {
    // Try to find the snapshot directory by checking recent timestamps
    // Check timestamps from now going back 1 minute (in case scraping started slightly before)
    const now = Date.now();
    const checkRange = 60 * 1000; // 1 minute in milliseconds
    const step = 1000; // Check every 1 second

    // Check for any snapshot file (03, 04, 05, or 06) to find the directory
    const snapshotFiles = [
      "03-analyzing.html",
      "04-profile-confirm.html",
      "05-processing.html",
      "06-results.html",
    ];

    // Check files in parallel for each timestamp to speed up discovery
    for (
      let timestamp = now;
      timestamp >= now - checkRange;
      timestamp -= step
    ) {
      if (activeRequestRef.current !== requestId) {
        return null;
      }
      // Check all files in parallel for this timestamp
      const checks = await Promise.all(
        snapshotFiles.map((fileName) =>
          checkSnapshotExists(username, timestamp, fileName)
        )
      );

      // If any file exists, we found the directory
      if (checks.some((exists) => exists)) {
        return timestamp;
      }

      // Small delay to avoid hammering the server
      await delay(100);
    }
    return null;
  };

  const registerSnapshot = (
    username,
    timestamp,
    fileName,
    stepName,
    requestId
  ) => {
    if (activeRequestRef.current !== requestId) return;
    const snapshotPath = `/snapshots/${encodeURIComponent(
      username
    )}/${timestamp}/${fileName}`;
    setSnapshots((prev) => {
      const filtered = prev.filter((s) => s.name !== stepName);
      return [...filtered, { name: stepName, htmlPath: snapshotPath }];
    });
  };

  const waitForSnapshotFile = async (
    username,
    timestamp,
    fileName,
    requestId,
    maxAttempts = 600,
    interval = 500
  ) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (activeRequestRef.current !== requestId) {
        return false;
      }
      const exists = await checkSnapshotExists(username, timestamp, fileName);
      if (exists) {
        return true;
      }
      await delay(interval);
    }
    return false;
  };

  const monitorSnapshots = async (username, requestId) => {
    try {
      let timestamp = await findSnapshotDirectory(username, requestId);
      if (!timestamp) {
        const maxWait = 60000;
        const start = Date.now();
        while (!timestamp && Date.now() - start < maxWait) {
          if (activeRequestRef.current !== requestId) {
            return;
          }
          await delay(2000);
          timestamp = await findSnapshotDirectory(username, requestId);
        }
      }
      if (!timestamp || activeRequestRef.current !== requestId) {
        return;
      }

      const steps = [
        { file: "03-analyzing.html", name: "analyzing" },
        { file: "04-profile-confirm.html", name: "profile-confirm" },
        { file: "05-processing.html", name: "processing" },
        { file: "06-results.html", name: "results" },
      ];

      // Check all files in parallel - register each as soon as it's detected
      const stepPromises = steps.map(async (step) => {
        if (activeRequestRef.current !== requestId) {
          return;
        }
        const exists = await waitForSnapshotFile(
          username,
          timestamp,
          step.file,
          requestId,
          step.name === "results" ? 1200 : 600,
          step.name === "results" ? 700 : 500
        );
        if (exists && activeRequestRef.current === requestId) {
          registerSnapshot(
            username,
            timestamp,
            step.file,
            step.name,
            requestId
          );
        }
      });

      // Don't wait for all - let them run independently and register as they're found
      Promise.all(stepPromises).catch((err) => {
        if (activeRequestRef.current === requestId) {
          console.error("Error monitoring snapshots:", err);
        }
      });
    } catch (err) {
      console.error("Snapshot monitor error:", err);
    }
  };

  const handleStart = async (value) => {
    const formatted = value.startsWith("@") ? value : `@${value}`;
    setProfile((prev) => ({
      ...prev,
      username: formatted,
      name: formatted.replace("@", "") || prev.name,
    }));
    setUsernameInput("");
    setErrorMessage("");
    setSnapshots([]);
    setCards([]);
    setNotifications([]);
    setToasts([]);
    Object.values(toastTimers.current).forEach(clearTimeout);
    toastTimers.current = {};
    setAnalysis(null);
    setAnalysisLoading(false);
    setSnapshotHtml({
      analyzing: null,
      "profile-confirm": null,
      processing: null,
    });
    const friendlyName = formatted.replace("@", "") || profile.name || "friend";
    setProfileStage(
      createProfileStageData(formatted, profile.avatar, friendlyName)
    );
    setProcessingStage(createProcessingStageData(formatted, profile.avatar));
    setCanAdvanceFromProfile(false);
    setCanAdvanceFromProcessing(false);
    clearTimeout(profileHoldTimerRef.current);
    clearTimeout(processingHoldTimerRef.current);
    clearInterval(analyzingTimerRef.current);
    analyzingStartRef.current = Date.now();
    stepHtmlFetchRef.current = {};
    setProfileConfirmParsed(false); // Reset flag for new request
    setAnalyzingProgress(0);
    setProcessingMessageIndex(0);

    activeRequestRef.current += 1;
    const requestId = activeRequestRef.current;
    monitorSnapshots(formatted, requestId).catch((err) =>
      console.error("Snapshot monitor failed", err)
    );

    // Set analyzing screen immediately - don't wait for fetchCards
    setScreen(SCREEN.ANALYZING);

    // Fetch cards in background - don't block UI transitions
    fetchCards(formatted).catch((err) => {
      console.error("Failed to fetch cards:", err);
      // Don't show error screen - let the flow continue with snapshots
      // Cards are optional, snapshots are the main flow
    });
  };

  const mergeSnapshotSteps = (existing = [], incoming = []) => {
    const map = new Map(existing.map((step) => [step.name, step]));
    incoming.forEach((step) => {
      if (step?.name) {
        map.set(step.name, step);
      }
    });
    return Array.from(map.values());
  };

  const fetchCards = async (usernameValue) => {
    // Use Server-Sent Events for real-time snapshot streaming
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(
        `${API_URL}?username=${encodeURIComponent(usernameValue)}&stream=true`
      );

      eventSource.addEventListener("snapshot", (e) => {
        try {
          const step = JSON.parse(e.data);
          console.log(`📥 Received snapshot via SSE: ${step.name}`);

          // Register snapshot immediately as it arrives
          setSnapshots((prev) => {
            const filtered = prev.filter((s) => s.name !== step.name);
            return [...filtered, step];
          });

          // If this is profile-confirm, trigger immediate UI update
          if (step.name === "profile-confirm") {
            console.log(
              `✅ Profile-confirm snapshot received - UI will update immediately`
            );
          }
        } catch (err) {
          console.error("Error parsing snapshot data:", err);
        }
      });

      eventSource.addEventListener("done", (e) => {
        try {
          const finalResult = JSON.parse(e.data);
          console.log(
            `✅ Scrape completed - received ${
              finalResult.cards?.length || 0
            } cards`
          );

          // Set cards and final snapshots
          if (finalResult.cards && Array.isArray(finalResult.cards)) {
            setCards(finalResult.cards);
          }
          if (finalResult.steps && Array.isArray(finalResult.steps)) {
            setSnapshots((prev) => mergeSnapshotSteps(prev, finalResult.steps));
          }

          eventSource.close();
          resolve(finalResult);
        } catch (err) {
          console.error("Error parsing final result:", err);
          eventSource.close();
          reject(err);
        }
      });

      eventSource.addEventListener("error", (e) => {
        try {
          const errorData = JSON.parse(e.data);
          console.error(`❌ Scrape error: ${errorData.error}`);
          eventSource.close();
          reject(new Error(errorData.error || "Unknown error"));
        } catch (err) {
          console.error("Error parsing error data:", err);
          eventSource.close();
          reject(new Error("Failed to process error"));
        }
      });

      // Handle connection errors
      eventSource.onerror = (err) => {
        console.error("EventSource error:", err);
        eventSource.close();
        reject(new Error("Connection error"));
      };
    });
  };

  const scrollToFullReport = () => {
    const fullReportSection = document.getElementById("full-report-section");
    if (fullReportSection) {
      fullReportSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleViewFullReport = async () => {
    // Find the full-report snapshot
    const fullReportStep = snapshots.find(
      (step) => step.name === "full-report"
    );
    if (!fullReportStep) {
      console.error("Full report snapshot not found");
      return;
    }

    setFullReportLoading(true);
    setScreen(SCREEN.FULL_REPORT);
    setPaymentCountdown(900); // Reset to 15 minutes when entering full report

    try {
      const url = buildSnapshotUrl(fullReportStep.htmlPath);
      if (!url) {
        throw new Error("Could not build snapshot URL");
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to fetch full report");
      }

      const html = await res.text();

      // Parse the HTML to extract structured data
      const parsedData = parseFullReport(html);
      if (parsedData) {
        setFullReportData(parsedData);
        setFullReportHtml(html); // Keep raw HTML for reference
      } else {
        // Fallback: use raw HTML if parsing fails
        setFullReportHtml(html);
      }
    } catch (err) {
      console.error("Failed to load full report:", err);
      setErrorMessage("Failed to load full report. Please try again.");
      setScreen(SCREEN.ERROR);
    } finally {
      setFullReportLoading(false);
    }
  };

  const splitSensitiveSegments = (text = "") => {
    if (!text) return [];
    const regex = new RegExp(BLUR_KEYWORD_REGEX.source, "gi");
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          text: text.slice(lastIndex, match.index),
          blurred: false,
        });
      }
      segments.push({ text: match[0], blurred: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), blurred: false });
    }

    return segments.length ? segments : [{ text, blurred: false }];
  };

  const renderSensitiveText = (text = "", baseBlurred = false) => {
    if (!text) return null;
    if (baseBlurred) {
      return <span className="blurred-text">{text}</span>;
    }

    return splitSensitiveSegments(text).map((segment, index) => (
      <span
        key={`${segment.text}-${index}-${segment.blurred}`}
        className={segment.blurred ? "blurred-text" : ""}
      >
        {segment.text}
      </span>
    ));
  };

  const renderAnalyzingFallback = () => (
    <div className="stage-card analyzing-card">
      <div className="stage-progress-track">
        <div
          className="stage-progress-fill"
          // style={{ width: `${analyzingProgress}%` }}
          style={{ width: "30%" }}
        />
      </div>
      <div className="stage-spinner" />
      <h1>Analyzing...</h1>
      <p className="stage-subtitle">
        We are capturing your profile information, please wait a few seconds.
      </p>
      <div className="stage-progress-panel">
        <div className="stage-progress-labels">
          <span>Loading...</span>
          <small>{analyzingProgress}%</small>
        </div>
        <div className="stage-bar">
          <div
            className="stage-bar-fill"
            style={{ width: `${analyzingProgress}%` }}
          />
        </div>
      </div>
      <p className="stage-status">Analyzing your profile 🔎</p>
    </div>
  );

  const renderLanding = () => (
    <section className="screen hero">
      <h4>You have stalkers...</h4>
      <h1>Discover in 1 minute who loves you and who hates you</h1>
      <button className="result-btn">Result in 1 minute</button>
      <p className="hero-copy">
        We analyze your Instagram profile to identify:
      </p>
      <div className="inline-cards">
        <div className="inline-card">
          <h3>Who loves watching your life</h3>
          <p>Viewed and re-viewed your stories more than 3 times.</p>
        </div>
        <div className="inline-card">
          <h3>Who hasn't forgotten you</h3>
          <p>They moved on but visited your profile more than 3× today.</p>
        </div>
        <div className="inline-card">
          <h3>Who pretends to be your friend</h3>
          <p>Our AI searches conversations talking about you.</p>
        </div>
        <div className="inline-card">
          <h3>Who wants you 🔥</h3>
          <p>Visits daily, screenshots stories and shares your profile.</p>
        </div>
      </div>
      <form
        className="cta"
        onSubmit={(event) => {
          event.preventDefault();
          if (!usernameInput.trim()) return;
          handleStart(usernameInput.trim());
        }}
      >
        <div className="input-wrapper">
          <span>@</span>
          <input
            type="text"
            value={usernameInput}
            onChange={(event) => setUsernameInput(event.target.value)}
            placeholder="Ex.: username"
          />
        </div>
        <button type="submit">Reveal Stalkers</button>
        <small className="small-text-footer">
          Also NOT GOOGLE or FACEBOOK: This site is not a part of the Google
          website, Google Inc, Facebook/Meta website, or Meta, Inc.
          Additionally, This site is NOT endorsed by Google or Meta in any way.
        </small>
      </form>
    </section>
  );

  const renderAnalyzing = () => (
    <section className="screen snapshot-stage">
      {renderAnalyzingFallback()}
    </section>
  );

  const renderProfile = () => {
    // Extract name from greeting (e.g., "Hello, Pratik Patil" -> "Pratik Patil")
    // or use profile.name as fallback
    const nameMatch = profileStage.greeting?.match(/Hello,?\s*(.+)/i);
    const displayName =
      nameMatch?.[1]?.trim() ||
      profile.name ||
      profileStage.username?.replace("@", "") ||
      "User";

    return (
      <section className="screen snapshot-stage">
        <div className="stage-card profile-card profile-card--dynamic">
          <div className="stage-progress-track subtle">
            <div
              className="stage-progress-fill"
              style={{ width: `${profileStage.progressPercent}%` }}
            />
          </div>
          <div className="profile-avatar-ring">
            <img src={profileStage.avatar} alt={profileStage.username} />
          </div>
          <div className="profile-username-badge">{profileStage.username}</div>
          <h1 className="profile-greeting">Hello, {displayName}</h1>
          <div className="profile-message">
            <h2 className="profile-congrats">
              🎉 Congratulations, we found your account!
            </h2>
            <p className="profile-description">
              We're analyzing your profile to reveal who's checking you out,
              talking about you, and visiting your profile. Get ready to
              discover the truth!
            </p>
          </div>
        </div>
      </section>
    );
  };

  const renderProcessing = () => (
    <section className="screen snapshot-stage">
      <div className="stage-card processing-card">
        <div className="stage-progress-track subtle">
          <div className="stage-progress-fill" style={{ width: "82%" }} />
        </div>
        <div className="processing-avatar-ring">
          <div className="scanner-overlay">
            <img
              src={processingStage.avatar || profile.avatar}
              alt={profile.name}
            />
            <div className="grid-background"></div>
            <div className="scan-grid-line"></div>
          </div>
        </div>
        <h1>{processingStage.title}</h1>
        <p className="stage-subtitle">{processingStage.subtitle}</p>
        <ul className="processing-list">
          {processingStage.bullets.map((message, index) => (
            <li
              key={`${message}-${index}`}
              className={index <= processingMessageIndex ? "visible" : ""}
            >
              <span>✔</span>
              <p>{message}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  const renderPreview = () => {
    if (analysisLoading && !analysis) {
      return (
        <section className="screen processing-wrapper">
          <div className="spinner" />
          <p>Loading analyzer data...</p>
        </section>
      );
    }

    if (!analysis) {
      return (
        <section className="screen processing-wrapper">
          <p>Analyzer data is not available yet. Please retry the scan.</p>
        </section>
      );
    }

    const {
      hero,
      summary,
      slider,
      screenshots,
      stories,
      alert,
      addicted,
      ctas,
    } = analysis;
    const filteredSummaryCards = summary.cards.filter((card) => {
      const text = `${card.title} ${card.detail}`.trim();
      return (
        text &&
        !NON_EN_SUMMARY_REGEX.test(text) &&
        !SUMMARY_EXCLUDE_REGEX.test(text)
      );
    });
    // Determine which CTA is for "REVEAL STALKERS" and which is for "REVEAL PROFILES"
    const revealStalkersCta =
      ctas.primary && ctas.primary.toLowerCase().includes("stalker")
        ? ctas.primary
        : null;
    const revealProfilesCta =
      ctas.secondary &&
      (ctas.secondary.toLowerCase().includes("profile") ||
        ctas.secondary.toLowerCase().includes("uncensored"))
        ? ctas.secondary
        : null;

    const hardcodedBodies = [
      "Visited your profile <b>12 times yesterday</b>",
      "Visited your profile late at night",
      'Added <span class="red">only you to their close friends</span>',
      "Took a screenshot of your profile and stories",
    ];

    return (
      <section className="screen preview-screen">
        <div className="analyzer-shell">
          <section className="hero-panel">
            <div className="hero-top">
              <div className="hero-avatar">
                <img
                  src={hero.profileImage || profile.avatar}
                  alt={hero.name || profile.name}
                />
              </div>
              <div className="hero-meta">
                <h1>{hero.name || profile.name}</h1>
                <div className="hero-stats">
                  {(hero.stats.length
                    ? hero.stats
                    : profileStatsFromState()
                  ).map((stat) => (
                    <div key={`${stat.label}-${stat.value}`}>
                      <strong>{stat.value}</strong>
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {hero.visitorSummary && (
              <p className="hero-summary">{hero.visitorSummary}</p>
            )}
            {hero.visitors?.length > 0 && (
              <div className="hero-visitors">
                <div className="visitor-stack">
                  {hero.visitors.map((visitor, index) => (
                    <div className="visitor-item" key={`visitor-${index}-${visitor.isLocked ? 'locked' : 'visible'}`}>
                      {visitor.isLocked ? (
                        <div className="locked-circle">
                          <span className="visitor-stack-lock-icon">🔒</span>
                        </div>
                      ) : (
                        <img
                          src={visitor.image}
                          alt={visitor.alt || `visitor-${index + 1}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <small className="hero-visitors-views">
                  <strong>{hero.visitors.length} people&nbsp;</strong>visited your profile this week
                </small>
              </div>
            )}
          </section>

          <section className="preview-header">
            <div className="preview-titles">
              {/* <p>{summary.warning || "Don't leave this page."}</p>
              {summary.weekRange && <span>{summary.weekRange}</span>} */}
              <h1>Preview</h1>
              <div class="warning-pill">
                <div className="warning-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-triangle-alert mr-[8px]"
                    aria-hidden="true"
                  >
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path>
                    <path d="M12 9v4"></path>
                    <path d="M12 17h.01"></path>
                  </svg>
                </div>
                Don't leave this page.
              </div>

              <div class="arrow-separator">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="lucide lucide-arrow-big-down-dash mt-[20px]"
                  aria-hidden="true"
                >
                  <path d="M15 11a1 1 0 0 0 1 1h2.939a1 1 0 0 1 .75 1.811l-6.835 6.836a1.207 1.207 0 0 1-1.707 0L4.31 13.81a1 1 0 0 1 .75-1.811H8a1 1 0 0 0 1-1V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z"></path>
                  <path d="M9 4h6"></path>
                </svg>
              </div>

              <div class="week-section">
                <div class="week-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-clock inline-block mb-[5px] mr-[10px]"
                    aria-hidden="true"
                  >
                    <path d="M12 6v6l4 2"></path>
                    <circle cx="12" cy="12" r="10"></circle>
                  </svg>
                </div>
                <div class="week-text">
                  <h3>Last week</h3>
                </div>
              </div>
              <div className="week-range">24/11 - 30/11</div>
            </div>
            <div className="summary-grid">
              {(filteredSummaryCards.length
                ? filteredSummaryCards
                : summary.cards
              ).map((card) => (
                <article key={`${card.title}-${card.detail}`}>
                  <div className="summary-grid-title">{card.title}</div>
                  <p>{card.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="slider-section">
            <h3>
              Visited your profile this week{" "}
              <span style={{ color: "#f43f3f" }}>between 2 to 7 times:</span>
            </h3>
            {(() => {
              const allCards = slider.cards.length ? slider.cards : cards;
              
              // Check if we already have a blurred/locked card
              const hasBlurredCard = allCards.some(card => 
                card?.blurImage || (!card?.username && card?.image)
              );
              
              // If no blurred card exists, inject one at a random position
              let cardsToRender = [...allCards];
              if (!hasBlurredCard && allCards.length > 0) {
                // Filter out locked cards and cards without images
                const availableCards = allCards.filter(card => 
                  !card?.isLocked && 
                  !card?.blurImage && 
                  card?.image && 
                  card?.username // Must have a username (not already locked/blurred)
                );
                
                if (availableCards.length > 0) {
                  const randomIndex = Math.floor(Math.random() * (allCards.length + 1));
                  // Pick a random card from available (non-locked) cards
                  const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
                  const blurredCard = {
                    ...randomCard,
                    blurImage: true,
                    username: null, // Remove username to trigger blur
                    image: randomCard.image, // Use the actual image from fetched data
                  };
                  cardsToRender.splice(randomIndex, 0, blurredCard);
                }
              }
              
              // Filter out cards that come right after blurred cards (positions 6, 11, 16, etc.)
              // to prevent duplicates, while keeping track of original indices
              const filteredCardsWithIndex = cardsToRender
                .map((card, originalIndex) => ({ card, originalIndex }))
                .filter(({ originalIndex }) => {
                  const isAfterBlurredCard = (originalIndex - 1) > 0 && (originalIndex - 1) % 5 === 0;
                  return !isAfterBlurredCard;
                });
              
              const currentIndex = Math.min(
                carouselIndex,
                Math.max(0, filteredCardsWithIndex.length - 1)
              );

              return filteredCardsWithIndex.length > 0 ? (
                <div className="carousel-container">
                  <div className="carousel-wrapper">
                    <div
                      className="carousel-track"
                      style={{
                        transform: `translateX(calc(-${
                          currentIndex * (220 + 16)
                        }px))`,
                      }}
                    >
                      {filteredCardsWithIndex.map(({ card, originalIndex }, index) => {
                        const imageUrl =
                          card.image || hero.profileImage || profile.avatar;
                        
                        // Check if original position is a multiple of 5 starting from 5 (5, 10, 15, 20, etc.)
                        // If yes, render as blurred card with lock icon (no username, grey blur, lock in middle)
                        const isMultipleOf5 = originalIndex > 0 && originalIndex % 5 === 0;
                        
                        if (isMultipleOf5 && imageUrl) {
                          return (
                            <article
                              className={`slider-card slider-card--blurred ${
                                index === currentIndex ? "active" : ""
                              }`}
                              key={`blurred-multiple-5-${index}`}
                            >
                              <div
                                className="slider-image blurred-image"
                                style={{ backgroundImage: `url(${imageUrl})` }}
                              />
                              <div className="blurred-lock">
                                <span role="img" aria-label="locked">
                                  🔒
                                </span>
                              </div>
                            </article>
                          );
                        }
                        
                        const isLocked = Boolean(
                          card?.isLocked || card?.title?.includes("🔒")
                        );
                        const shouldBlurImage = Boolean(
                          card?.blurImage || (!card?.username && imageUrl)
                        );
                        const lockText =
                          card?.lockText ||
                          card?.lines?.[0]?.text ||
                          card?.title ||
                          "Profile locked";
                        const showLines =
                          !isLocked &&
                          !shouldBlurImage &&
                          Array.isArray(card?.lines) &&
                          card.lines.length > 0;

                        if (isLocked) {
                          return (
                            <article
                              className={`slider-card slider-card--locked ${
                                index === currentIndex ? "active" : ""
                              }`}
                              key={`locked-${card?.username || index}`}
                            >
                              <div className="lock-overlay">
                                <span className="lock-icon">🔒</span>
                                <p className="lock-text">
                                  {renderSensitiveText(
                                    lockText,
                                    card.lockTextBlurred
                                  )}
                                </p>
                              </div>
                            </article>
                          );
                        }

                        if (shouldBlurImage && imageUrl) {
                          return (
                            <article
                              className={`slider-card slider-card--blurred ${
                                index === currentIndex ? "active" : ""
                              }`}
                              key={`blurred-${card?.username || index}`}
                            >
                              <div
                                className="slider-image blurred-image"
                                style={{ backgroundImage: `url(${imageUrl})` }}
                              />
                              <div className="blurred-lock">
                                <span role="img" aria-label="locked">
                                  🔒
                                </span>
                              </div>
                            </article>
                          );
                        }

                        return (
                          <article
                            className={`slider-card ${
                              index === currentIndex ? "active" : ""
                            }`}
                            key={`${card.title}-${index}`}
                          >
                            <div
                              className="slider-image"
                              style={{
                                backgroundImage: imageUrl
                                  ? `url(${imageUrl})`
                                  : "none",
                                backgroundColor: imageUrl
                                  ? "transparent"
                                  : "#f5f5f5",
                              }}
                            />
                            <div className="slider-card-content">
                              {card?.username && (
                                <h4 className="username">{card.username}</h4>
                              )}
                              {showLines &&
                                card.lines.map((line, idx) => (
                                  <p
                                    key={`${line.text}-${idx}`}
                                    className={
                                      line.blurred ? "blurred-text" : ""
                                    }
                                  >
                                    {renderSensitiveText(
                                      line.text,
                                      line.blurred
                                    )}
                                  </p>
                                ))}
                              {card?.badge && (
                                <span className="slider-badge">
                                  {card.badge}
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null;
            })()}
          </section>

          {revealStalkersCta && (
            <div className="cta-inline">
              <button className="primary-btn" onClick={scrollToFullReport}>
                Reveal Stalker
              </button>
            </div>
          )}

          {stories?.slides?.length > 0 && (
            <section className="stories-section">
              <h3>{stories.heading || "Stories activity"}</h3>
              {(() => {
                const storiesSlides = stories.slides || [];
                const currentStoriesIndex = Math.min(
                  storiesCarouselIndex,
                  Math.max(0, storiesSlides.length - 1)
                );

                return storiesSlides.length > 0 ? (
                  <div className="carousel-container">
                    <div className="carousel-wrapper">
                      <div
                        className="carousel-track"
                        style={{
                          transform: `translateX(calc(-${
                            currentStoriesIndex * (220 + 16)
                          }px))`,
                        }}
                      >
                        {storiesSlides.map((story, index) => (
                          <article
                            key={`${story.caption}-${index}`}
                            className={`story-card ${
                              index === currentStoriesIndex ? "active" : ""
                            }`}
                          >
                            <div
                              className="story-cover"
                              style={{
                                backgroundImage: story.image
                                  ? `url(${story.image})`
                                  : "none",
                                backgroundColor: story.image
                                  ? "transparent"
                                  : "#000",
                              }}
                            >
                              <div className="story-hero-info">
                                <img
                                  src={hero.profileImage || profile.avatar}
                                  alt={hero.name || profile.name}
                                  className="story-hero-avatar"
                                />
                                <span className="story-hero-username">
                                  {hero.name || profile.name}
                                </span>
                              </div>
                              {(story.caption || story.meta) && (
                                <div className="story-bottom-overlay">
                                  <div className="story-bottom-text">
                                    {story.caption && (
                                      <p className="story-caption">
                                        {story.caption}
                                      </p>
                                    )}
                                    {story.meta &&
                                      (() => {
                                        // Parse meta text: "4 profilespaused" or "4 profiles paused" or "3 profiles took a screenshot" etc.
                                        const metaText = story.meta.trim();
                                        // Match pattern: number + "profiles" + rest of text
                                        const match = metaText.match(
                                          /^(\d+)\s*(profiles?)\s*(.+)?/i
                                        );
                                        if (match) {
                                          const number = match[1];
                                          const profiles = match[2];
                                          const status = match[3]
                                            ? match[3].trim()
                                            : "";
                                          return (
                                            <div className="story-meta-formatted">
                                              <div className="story-meta-line1">
                                                <svg
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  width="18"
                                                  height="18"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  strokeWidth="2"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  className="story-lock-icon"
                                                  aria-hidden="true"
                                                >
                                                  <rect
                                                    width="18"
                                                    height="11"
                                                    x="3"
                                                    y="11"
                                                    rx="2"
                                                    ry="2"
                                                  ></rect>
                                                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                                </svg>
                                                <span className="story-meta-number">
                                                  {number}
                                                </span>
                                                <span className="story-meta-profiles">
                                                  {profiles}
                                                </span>
                                              </div>
                                              {status && (
                                                <div className="story-meta-line2">
                                                  {status}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        }
                                        // Fallback: display as is
                                        return (
                                          <span className="story-meta">
                                            {story.meta}
                                          </span>
                                        );
                                      })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}
            </section>
          )}

          {stories?.slides?.length > 0 && (
            <div className="cta-inline">
              <button className="primary-btn" onClick={scrollToFullReport}>
                🔍 Reveal Profile
              </button>
            </div>
          )}

          <>
            <h3 className="screenshots-heading">
              <span style={{ color: "#f43f3f" }}>Screenshots</span> recovered
            </h3>
            <p className="screenshots-description">
              Our artificial intelligence searches{" "}
              <strong>THE ENTIRE INTERNET</strong> for any mention of you in
              leaked <strong>photos and screenshots.</strong>
            </p>
            <ul className="screenshots-list">
              <li>Among your followers</li>
              <li>Friends of your followers</li>
              <li>From those who pretend to be your friend</li>
              <li>People interested in you</li>
            </ul>
            {/* Message bubbles from screenshots.chat data */}
            {screenshots.chat && screenshots.chat.length > 0 ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  display: "block",
                  borderRadius: "1rem",
                  overflow: "hidden",
                }}
              >
                <img
                  src={printMessageBg}
                  alt="Chat background"
                  style={{
                    width: "100%",
                    height: "230px",
                    display: "block",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "4%",
                    top: "45%",
                    zIndex: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                  }}
                >
                  {screenshots.chat.map((bubble, index) => {
                    if (!bubble || !bubble.text) return null;
                    return (
                      <div
                        key={`chat-bubble-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "25px",
                            height: "25px",
                            minWidth: "25px",
                            minHeight: "25px",
                            borderRadius: "50%",
                            backgroundSize: "cover",
                            backgroundRepeat: "no-repeat",
                            backgroundImage: `url(${profileNewPng})`,
                            filter: "blur(4px)",
                            flexShrink: 0,
                            marginBottom: "8px",
                          }}
                        />
                        <div
                          style={{
                            backgroundColor: "#262626",
                            color: "#eee",
                            padding: "8px 14px",
                            borderRadius:
                              index === 0
                                ? "18px 18px 18px 4px"
                                : index === screenshots.chat.length - 1
                                ? "18px 18px 4px 18px"
                                : "18px 18px 18px 4px",
                            fontSize: "14px",
                            whiteSpace: "nowrap",
                            lineHeight: "1.4",
                            width: "fit-content",
                          }}
                        >
                          {bubble.segments ? (
                            // Render segments with individual blur status
                            bubble.segments.map((segment, segIndex) => (
                              <span
                                key={`segment-${segIndex}`}
                                style={
                                  segment.blurred ? { filter: "blur(4px)" } : {}
                                }
                              >
                                {segment.text}
                                {segIndex < bubble.segments.length - 1
                                  ? " "
                                  : ""}
                              </span>
                            ))
                          ) : bubble.blurred ? (
                            // Fallback for old format
                            <span style={{ filter: "blur(4px)" }}>
                              {bubble.text}
                            </span>
                          ) : (
                            <span>{bubble.text}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : screenshots.chatHtml ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  display: "block",
                  borderRadius: "1rem",
                  overflow: "hidden",
                }}
              >
                <img
                  src={printMessageBg}
                  alt="Chat background"
                  style={{
                    width: "100%",
                    height: "250px",
                    display: "block",
                  }}
                />
                {/* Fallback: Try to extract messages from chatHtml if chat array is empty */}
                {(() => {
                  try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(
                      screenshots.chatHtml,
                      "text/html"
                    );
                    const messagesWrapper = doc.querySelector(
                      "div.space-y-\\[3px\\], div[class*='space-y']"
                    );
                    const messages = [];

                    if (messagesWrapper) {
                      const spans = messagesWrapper.querySelectorAll("span");
                      spans.forEach((span) => {
                        const text = span.textContent?.trim();
                        if (text) {
                          const isBlurred =
                            span.className?.includes("blur") || false;
                          messages.push({
                            segments: [
                              {
                                text: text,
                                blurred: isBlurred,
                              },
                            ],
                            text: text,
                            blurred: isBlurred,
                          });
                        }
                      });
                    }

                    if (messages.length > 0) {
                      return (
                        <div
                          style={{
                            position: "absolute",
                            left: "4%",
                            top: "45%",
                            zIndex: 4,
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px",
                          }}
                        >
                          {messages.map((bubble, index) => (
                            <div
                              key={`chat-bubble-fallback-${index}`}
                              style={{
                                display: "flex",
                                alignItems: "flex-end",
                                gap: "12px",
                              }}
                            >
                              <div
                                style={{
                                  width: "25px",
                                  height: "25px",
                                  minWidth: "25px",
                                  minHeight: "25px",
                                  borderRadius: "50%",
                                  backgroundSize: "cover",
                                  backgroundRepeat: "no-repeat",
                                  backgroundImage: `url(${profileNewPng})`,
                                  filter: "blur(4px)",
                                  flexShrink: 0,
                                  marginBottom: "8px",
                                }}
                              />
                              <div
                                style={{
                                  backgroundColor: "#262626",
                                  color: "#eee",
                                  padding: "8px 14px",
                                  borderRadius:
                                    index === 0
                                      ? "18px 18px 18px 4px"
                                      : index === messages.length - 1
                                      ? "18px 18px 4px 18px"
                                      : "18px 18px 18px 4px",
                                  fontSize: "14px",
                                  whiteSpace: "nowrap",
                                  lineHeight: "1.4",
                                  width: "fit-content",
                                }}
                              >
                                {bubble.segments ? (
                                  // Render segments with individual blur status
                                  bubble.segments.map((segment, segIndex) => (
                                    <span
                                      key={`segment-fallback-${segIndex}`}
                                      style={
                                        segment.blurred
                                          ? { filter: "blur(4px)" }
                                          : {}
                                      }
                                    >
                                      {segment.text}
                                      {segIndex < bubble.segments.length - 1
                                        ? " "
                                        : ""}
                                    </span>
                                  ))
                                ) : bubble.blurred ? (
                                  // Fallback for old format
                                  <span style={{ filter: "blur(4px)" }}>
                                    {bubble.text}
                                  </span>
                                ) : (
                                  <span>{bubble.text}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                  } catch (e) {
                    console.error("Error parsing chatHtml fallback:", e);
                  }
                  return null;
                })()}
              </div>
            ) : null}
            <p className="screenshots-uncensored">
              SEE THE SCREENSHOTS <strong>UNCENSORED</strong> IN THE COMPLETE
              REPORT
            </p>
            <div className="cta-inline">
              <button
                className="uncensored-screenshots-btn"
                onClick={scrollToFullReport}
              >
                VIEW UNCENSORED SCREENSHOTS
              </button>
            </div>
            {ctas.secondary && !revealProfilesCta && (
              <div className="cta-inline">
                <button className="secondary-btn">{ctas.secondary}</button>
              </div>
            )}
          </>

          {/* {alert.title && (
            <section className="alert-panel">
              <h3 dangerouslySetInnerHTML={{ __html: alert.title }} />
              {alert.badge && (
                <span className="alert-badge">{alert.badge}</span>
              )}
              <p dangerouslySetInnerHTML={{ __html: alert.copy }} />
            </section>
          )} */}

          {addicted.tiles.length > 0 && (
            <section className="addicted-panel">
              <h3 dangerouslySetInnerHTML={{ __html: addicted.title }} />
              <div className="addicted-grid">
                {addicted.tiles.map((tile, index) => (
                  <article key={`${tile.body}-${index}`}>
                    {tile.blurred && <div className="addicted-lock">🔒</div>}
                    <div className="addicted-blur-name">
                      <strong>@</strong>
                      <h4 className={tile.blurred ? "blurred-text" : ""}>
                        {renderSensitiveText(tile.title, tile.blurred)}
                      </h4>
                    </div>
                    <p
                      dangerouslySetInnerHTML={{
                        __html: hardcodedBodies[index],
                      }}
                    />
                    {/* <p>{tile.body}</p> */}
                  </article>
                ))}
              </div>
            </section>
          )}
          {(addicted.footer || addicted.subfooter || ctas.tertiary) && (
            <section id="full-report-section" className="cta-block final">
              {addicted.footer && (
                <p className="cta-banner">{addicted.footer}</p>
              )}
              {ctas.tertiary && (
                <button className="primary-btn cta-eye-btn" onClick={handleViewFullReport}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-eye mr-[10px]"
                    aria-hidden="true"
                  >
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  {ctas.tertiary}
                </button>
              )}
              {addicted.subfooter && <small className="small-text-footer-sub">{addicted.subfooter}</small>}
            </section>
          )}

          {/* table removed per request */}
        </div>
      </section>
    );
  };

  const renderFullReport = () => {
    if (fullReportLoading) {
      return (
        <section className="screen hero">
          <div className="spinner" />
          <p>Loading full report...</p>
        </section>
      );
    }

    if (!fullReportData && !fullReportHtml) {
      return (
        <section className="screen hero">
          <h1>Full Report Not Available</h1>
          <p>The full report could not be loaded.</p>
          <button
            className="primary-btn"
            onClick={() => setScreen(SCREEN.PREVIEW)}
          >
            Back to Preview
          </button>
        </section>
      );
    }

    // Extract avatar from parsed data or use profile avatar
    const profileAvatar = fullReportData?.avatar || profile.avatar;

    // Debug: Log avatar source
    if (fullReportData?.avatar) {
      console.log("✅ Using avatar from fullReportData");
    } else if (profile.avatar) {
      console.log("⚠️ Using fallback avatar from profile");
    } else {
      console.warn("⚠️ No avatar available");
    }

    return (
      <section className="screen full-report-screen">
        <div className="full-report-container">
          {/* Progress Bar */}
          <div className="full-report-progress-bar"></div>

          {/* Header Section */}
          <div className="full-report-header">
            <div className="full-report-header-top">
              {profileAvatar && (
                <div className="full-report-avatar">
                  <img src={profileAvatar} alt="Profile" />
                </div>
              )}
              <h1 className="full-report-title">Unlock Complete Report</h1>
            </div>
            <p className="full-report-subtitle">You will have access to:</p>
          </div>

          {/* Features Grid */}
          <div className="full-report-features">
            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
              <h3>🔍Story Repeats</h3></div>
              <p>People who viewed and re-viewed your stories</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
              <h3>🔍Visit Tracking</h3></div>
              <p>Discover who is visiting your profile</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
              <h3>🔍Mention Tracking</h3></div>
              <p>Find out which followers talk about you the most</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
              <h3>🔍Who's Watching You</h3></div>
              <p>See who took SCREENSHOTS of your profile and stories</p>
            </div>
          </div>

          {/* Marketing Section */}
          <div className="full-report-marketing">
            <p className="full-report-more">And much more...</p>
            <p className="full-report-system">
              Our reporting system is the only truly functional system on the
              market.
            </p>
            <p className="full-report-emotional">
              We could charge what you've already spent on dates, clothes and
              dinners that never led to anything.
            </p>
            <p className="full-report-disappointment">
              Where you only got disappointed.
            </p>

            <div className="full-report-divider"></div>

            <p className="full-report-not-going">
              But we're not going to do that,
            </p>
            <h2 className="full-report-goal">We want you to have a goal</h2>
            <p className="full-report-direction">
              We're here giving you the only thing you're still missing,
              direction.
            </p>
            <p className="full-report-certainty">
              It's not worth humiliating yourself for someone who doesn't want
              you, <strong>this is your chance to have certainty.</strong>
            </p>
          </div>

          {/* Urgency Section */}
          <div className="full-report-urgency">
            <div className="full-report-countdown">
              <span>
                Limited time offer:{" "}
                <span className="countdown-timer">{formatCountdown(paymentCountdown)}</span>
              </span>
            </div>
            <div className="full-report-warning">
              <div className="full-report-warning-content">
                <span className="full-report-warning-icon">⚠️</span>
                <div className="full-report-warning-text">
                  <p>
                    <strong>Don't leave this page!</strong>
                  </p>
                  <p>
                    We only allow viewing the
                    <br />
                    preview <strong>ONCE</strong>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Section */}
          <div className="full-report-pricing">
            <div className="full-report-pricing-card">
              <span className="full-report-discount-badge">
                80% OFF PROMOTION
              </span>
              <div className="full-report-pricing-block">
              <div className="full-report-pricing-header">
                <div className="full-report-pricing-left">
                  <span className="full-report-lock-icon">🔓</span>
                  <h3>
                    Complete
                    <br />
                    Report
                  </h3>
                </div>
              </div>
              <div className="full-report-pricing-details">
                <p className="full-report-original-price">
                  from <span className="strikethrough">1299₹</span> for:
                </p>
                <p className="full-report-current-price">
                  <span className="price-number">199</span>{" "}
                  <span className="price-currency">₹</span>
                </p>
                <p className="full-report-payment-type">one-time payment</p>
              </div>
              </div>
            </div>

            <div className="full-report-benefits">
              <div className="full-report-benefit-card">
                <h4>Lifetime Access</h4>
                <p>No monthly fees, one-time payment</p>
              </div>
              <div className="full-report-benefit-card">
                <h4>14-Day Guarantee</h4>
                <p>Full refund if not satisfied</p>
              </div>
            </div>

            <div className="full-report-bonus">
              <h4>Bonus</h4>
              <p>Ebook: Manual for attraction and re-attraction</p>
            </div>
          </div>

          {/* CTA Button */}
          <div className="full-report-cta">
            <button
              className="full-report-cta-button"
              onClick={() => setScreen(SCREEN.PAYMENT)}
            >
              I want the complete report
            </button>
          </div>

          {/* Footer */}
          <div className="full-report-footer">
            <p>
              2025 © Cartpanda Inc. (United States) Inc. and/or its licensors.
              Review <a href="#">legal terms of use here</a> and{" "}
              <a href="#">privacy policy here</a>.{" "}
              <a href="#">Contact us here</a>.
            </p>
          </div>
        </div>
      </section>
    );

    // Fallback to raw HTML rendering
    return (
      <section className="screen full-report-screen">
        <div
          className="full-report-content"
          dangerouslySetInnerHTML={{ __html: fullReportHtml }}
        />
      </section>
    );
  };

  // Countdown timer effect for payment and full report pages
  useEffect(() => {
    if ((screen === SCREEN.PAYMENT || screen === SCREEN.FULL_REPORT) && paymentCountdown > 0) {
      const timer = setInterval(() => {
        setPaymentCountdown((prev) => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [screen, paymentCountdown]);

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setPaymentLoading(true);

    try {
      // Save user data to MongoDB
      const saveResponse = await fetch(`${API_BASE}/api/payment/save-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentForm),
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to save user data");
      }

      // Create payment session
      const amount = 199 * quantity; // 199₹ per item
      const sessionResponse = await fetch(
        `${API_BASE}/api/payment/create-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...paymentForm,
            amount,
          }),
        }
      );

      if (!sessionResponse.ok) {
        const errorData = await sessionResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("Payment session error:", errorData);
        throw new Error(
          errorData.message ||
            errorData.error ||
            "Failed to create payment session"
        );
      }

      const sessionData = await sessionResponse.json();
      console.log("Payment session created:", sessionData);

      // Check if payment session ID exists
      if (!sessionData.paymentSessionId) {
        throw new Error("Payment session ID not received from server");
      }

      // Wait a bit for Cashfree SDK to load if not already loaded
      let retries = 0;
      const maxRetries = 10;
      while (!window.Cashfree && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        retries++;
      }

      // Initialize Cashfree payment
      if (window.Cashfree) {
        try {
          const cashfree = new window.Cashfree({
            mode: "sandbox", // Test mode
          });

          console.log(
            "Initializing Cashfree checkout with session:",
            sessionData.paymentSessionId
          );

          cashfree
            .checkout({
              paymentSessionId: sessionData.paymentSessionId,
              redirectTarget: "_self",
            })
            .catch((err) => {
              console.error("Cashfree checkout error:", err);
              alert(
                `Payment initialization failed: ${
                  err.message || "Unknown error"
                }`
              );
              setPaymentLoading(false);
            });
        } catch (initErr) {
          console.error("Cashfree initialization error:", initErr);
          alert(
            `Failed to initialize payment gateway: ${
              initErr.message || "Unknown error"
            }`
          );
          setPaymentLoading(false);
        }
      } else {
        console.error("Cashfree SDK not loaded after waiting");
        console.log("Window.Cashfree:", window.Cashfree);
        alert(
          "Payment gateway SDK not loaded. Please refresh the page and try again."
        );
        setPaymentLoading(false);
      }
    } catch (err) {
      console.error("Payment error:", err);
      console.error("Error details:", err.message, err.stack);
      // Show more detailed error message
      const errorMsg =
        err.message || "Failed to process payment. Please try again.";
      alert(errorMsg);
    } finally {
      setPaymentLoading(false);
    }
  };

  const renderPayment = () => {
    const originalPrice = 1299;
    const currentPrice = 199;
    const subtotal = currentPrice * quantity;
    const total = subtotal;

    // Indian reviews/testimonials
    const reviews = [
      {
        name: "Priya Sharma",
        rating: 5,
        text: "I discovered I had 3 secret admirers lol, I loved it!",
        avatar: g1Image,
      },
      {
        name: "Rahul Patel",
        rating: 5,
        text: "Worse still, it's true lol, it showed that my ex is looking at my profile every day, and I even discovered the name of his fake account lol, whoever created this app is brilliant",
        avatar: b1Image,
      },
      {
        name: "Anjali Mehta",
        rating: 5,
        text: "This app is amazing! Found out who's been stalking my profile. Worth every rupee!",
        avatar: g2Image,
      },
    ];

    return (
      <section className="screen payment-screen">
        <div className="payment-container">
          {/* Top Banner - Countdown */}
          <div className="payment-banner">
            <span>
              Your report expires in {formatCountdown(paymentCountdown)}
            </span>
          </div>

          {/* Main Content */}
          <div className="payment-content">
            {/* Left Column */}
            <div className="payment-left">
              {/* Marketing Text */}
              <div className="payment-marketing">
                <h2>Discover the truth.</h2>
                <h2>You deserve to know.</h2>
                <h2>Unlock your full report today.</h2>
              </div>

              {/* Discount Badge */}
              <div className="payment-discount-badge">
                <span>80% OFF</span>
              </div>

              {/* Contact Form */}
              <div className="payment-form-section">
                <h3 className="payment-form-title">Contact</h3>
                <form onSubmit={handlePaymentSubmit} className="payment-form">
                  <div className="payment-form-group">
                    <label htmlFor="email">E-mail*</label>
                    <input
                      type="email"
                      id="email"
                      required
                      value={paymentForm.email}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          email: e.target.value,
                        })
                      }
                      placeholder="your.email@example.com"
                    />
                  </div>

                  <div className="payment-form-group">
                    <label htmlFor="fullName">Full name*</label>
                    <input
                      type="text"
                      id="fullName"
                      required
                      value={paymentForm.fullName}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          fullName: e.target.value,
                        })
                      }
                      placeholder="Enter your full name"
                    />
                  </div>

                  <div className="payment-form-group">
                    <label htmlFor="phoneNumber">Phone number*</label>
                    <div className="phone-input-wrapper">
                      <span className="phone-prefix">🇮🇳 +91</span>
                      <input
                        type="tel"
                        id="phoneNumber"
                        required
                        value={paymentForm.phoneNumber}
                        onChange={(e) =>
                          setPaymentForm({
                            ...paymentForm,
                            phoneNumber: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        placeholder="9876543210"
                        maxLength={10}
                      />
                    </div>
                  </div>
                </form>
              </div>

              {/* Guarantee Section */}
              <div className="payment-guarantee">
                <div className="guarantee-icon">✓</div>
                <div className="guarantee-content">
                  <h4>14-Day Money-Back Guarantee</h4>
                  <p>
                    Try it risk-free. If you're not happy within 14 days, we'll
                    refund you — no questions asked.
                  </p>
                </div>
              </div>

              {/* Urgency Countdown */}
              <div className="payment-urgency">
                <div className="urgency-icon">⚠️</div>
                <div className="urgency-content">
                  <p>Your report expires in</p>
                  <div className="urgency-timer">
                    {formatCountdown(paymentCountdown)}
                  </div>
                </div>
              </div>

              {/* Reviews */}
              <div className="payment-reviews">
                {reviews.map((review, index) => (
                  <div key={index} className="payment-review-card">
                    <img
                      src={review.avatar}
                      alt={review.name}
                      className="review-avatar"
                    />
                    <div className="review-content">
                      <div className="review-name">{review.name}</div>
                      <div className="review-stars">
                        {Array.from({ length: review.rating }).map((_, i) => (
                          <span key={i}>⭐</span>
                        ))}
                      </div>
                      <div className="review-text">{review.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column - Order Summary */}
            <div className="payment-right">
              <div className="payment-order-summary">
                <h3 className="order-summary-title">Order Summary</h3>

                {/* Product Item */}
                <div className="order-item">
                  <div className="order-item-icon">📱</div>
                  <div className="order-item-details">
                    <div className="order-item-name">
                      Unlock Insta Full Report
                    </div>
                    <div className="order-item-price">
                      ₹{currentPrice.toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="order-item-quantity">
                    <button
                      type="button"
                      className="quantity-btn"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    >
                      -
                    </button>
                    <span className="quantity-value">{quantity}</span>
                    <button
                      type="button"
                      className="quantity-btn"
                      onClick={() => setQuantity(quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Price Breakdown */}
                <div className="order-breakdown">
                  <div className="breakdown-row">
                    <span>Retail price</span>
                    <span className="strikethrough">
                      ₹{(originalPrice * quantity).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="breakdown-row">
                    <span>Subtotal</span>
                    <span>₹{subtotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="breakdown-row breakdown-total">
                    <span>Total</span>
                    <span>₹{total.toLocaleString("en-IN")}</span>
                  </div>
                </div>

                {/* Place Order Button */}
                <button
                  type="submit"
                  className="place-order-btn"
                  onClick={handlePaymentSubmit}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? "Processing..." : "PLACE ORDER"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderError = () => (
    <section className="screen hero">
      <h1>Something went wrong</h1>
      <p>{errorMessage}</p>
      <button className="primary-btn" onClick={() => setScreen(SCREEN.LANDING)}>
        Back to start
      </button>
    </section>
  );

  const renderScreen = () => {
    switch (screen) {
      case SCREEN.LANDING:
        return renderLanding();
      case SCREEN.ANALYZING:
        return renderAnalyzing();
      case SCREEN.PROFILE:
        return renderProfile();
      case SCREEN.PROCESSING:
        return renderProcessing();
      case SCREEN.PREVIEW:
        return renderPreview();
      case SCREEN.FULL_REPORT:
        return renderFullReport();
      case SCREEN.PAYMENT:
        return renderPayment();
      case SCREEN.ERROR:
        return renderError();
      default:
        return renderLanding();
    }
  };

  return (
    <div className="app">
      <div className="screen-container">{renderScreen()}</div>
      <div className="toast-container">
        {toasts.map((toast) => (
          <div className="toast" key={toast.id}>
            <div className="notification">
              {toast.image && <img src={toast.image} alt="" />}
              <div>
                <p>{toast.message}</p>
                <small>
                  {new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
