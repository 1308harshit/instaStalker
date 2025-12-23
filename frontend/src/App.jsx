import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseResultsSnapshot } from "./utils/parseSnapshot";
import { parseFullReport } from "./utils/parseFullReport";
import b1Image from "./assets/b1.jpg";
import g1Image from "./assets/g1.jpg";
import g2Image from "./assets/g2.jpg";
import printMessageBg from "./assets/print-message-new.png";
import profileNewPng from "./assets/profile-new.png";
import instaLogo from "./assets/insta-logo.jpeg";
import paymentHeader from "./assets/payment-header.jpeg";

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
  PAYMENT_SUCCESS: "payment-success",
  CONTACT_US: "contact-us",
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
const QUEUE_MESSAGE = "You are in the queue";
const LAST_RUN_KEY = "stalker-last-run";

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
  // Check for post-purchase link on initial mount (before setting screen state)
  const getInitialScreen = () => {
    if (typeof window === "undefined") return SCREEN.LANDING;
    
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const order = urlParams.get('order');
    
    // If we're on post-purchase route with token and order, start with LANDING
    // but useEffect will handle validation and switch to PAYMENT_SUCCESS
    if (token && order && window.location.pathname === '/post-purchase') {
      return SCREEN.LANDING; // Start with LANDING, useEffect will change it
    }
    
    return SCREEN.LANDING;
  };
  
  const [screen, setScreen] = useState(getInitialScreen);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [usernameInput, setUsernameInput] = useState("");
  const [cards, setCards] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [paymentSuccessCards, setPaymentSuccessCards] = useState([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [paymentSuccessLast7Summary, setPaymentSuccessLast7Summary] =
    useState({ profileVisits: null, screenshots: null });
  const [paymentSuccessLast7Rows, setPaymentSuccessLast7Rows] = useState([]);
  const [paymentSuccess90DayVisits, setPaymentSuccess90DayVisits] =
    useState(null);
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
  const [paymentSuccessCarouselIndex, setPaymentSuccessCarouselIndex] = useState(0);
  const [paymentSuccessAdditionalUsernames, setPaymentSuccessAdditionalUsernames] = useState([]);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  const toastTimers = useRef({});
  const tickerRef = useRef(null);
  const profileHoldTimerRef = useRef(null);
  const processingHoldTimerRef = useRef(null);
  const analyzingTimerRef = useRef(null);
  const analyzingStartRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const carouselLoopingRef = useRef(false);
  const storiesCarouselLoopingRef = useRef(false);
  const paymentSuccessCarouselResetRef = useRef(false);
  const purchaseEventFiredRef = useRef(new Set()); // Track fired order IDs to prevent duplicates
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
  const [isInQueue, setIsInQueue] = useState(false);
  // Razorpay SDK is loaded via script tag in index.html - no need for state management

  const isNarrowLayout = viewportWidth < 768;

  // Payment page state
  const [paymentForm, setPaymentForm] = useState({
    email: "",
    fullName: "",
    phoneNumber: "",
  });
  const [paymentCountdown, setPaymentCountdown] = useState(404); // 6:44 in seconds
  const [quantity, setQuantity] = useState(1);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [showDisclaimers, setShowDisclaimers] = useState(false);
  const activeRequestRef = useRef(0);
  const stepHtmlFetchRef = useRef({});
  const paymentSessionRef = useRef(null);
  const snapshotLookup = useMemo(() => {
    return snapshots.reduce((acc, step) => {
      acc[step.name] = step;
      return acc;
    }, {});
  }, [snapshots]);

  const saveLastRun = (data) => {
    try {
      localStorage.setItem(LAST_RUN_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("⚠️ Failed to save last run to storage", err);
    }
  };

  const loadLastRun = () => {
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      console.warn("⚠️ Failed to load last run from storage", err);
      return null;
    }
  };

  // Track viewport width for responsive layout (stack sections on mobile)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle post-purchase link access FIRST - check URL params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const order = urlParams.get('order');
    
    // If we have token and order params, load from backend (skip localStorage)
    if (token && order) {
      console.log('🔍 Post-purchase link detected, loading from MongoDB...');
      
      const loadOrderData = async () => {
        try {
          const apiUrl = `/api/payment/post-purchase?token=${encodeURIComponent(token)}&order=${encodeURIComponent(order)}`;
          console.log('📡 Fetching order data from:', apiUrl);
          
          const validateResponse = await fetch(apiUrl);
          
          if (!validateResponse.ok) {
            console.error('❌ Failed to fetch order data:', validateResponse.status);
            return;
          }
          
          const validateData = await validateResponse.json();
          console.log('📋 Order data received:', {
            success: validateData.success,
            hasPageState: !!validateData.pageState,
            hasCards: Array.isArray(validateData.cards) && validateData.cards.length > 0,
            hasProfile: !!validateData.profile,
            username: validateData.username,
            cardsCount: validateData.cards?.length || 0,
            pageStateCardsCount: validateData.pageState?.cards?.length || 0
          });
          
          if (validateData.success) {
            // Clear any existing localStorage data first
            try {
              localStorage.removeItem(LAST_RUN_KEY);
            } catch (e) {}
            
            // Restore complete page state from MongoDB
            if (validateData.pageState && typeof validateData.pageState === 'object') {
              console.log('✅ Loading complete pageState from MongoDB');
              const pageState = validateData.pageState;
              
              // Restore core data
              if (pageState.cards && Array.isArray(pageState.cards)) {
                console.log(`📋 Restoring ${pageState.cards.length} cards`);
                setCards(pageState.cards);
              }
              
              if (pageState.profile) {
                console.log(`📋 Restoring profile: ${pageState.profile.username}`);
                setProfile((prev) => ({ ...prev, ...pageState.profile }));
              }
              
              if (pageState.username) {
                setUsernameInput(pageState.username.replace('@', ''));
              }
              
              // Restore payment success page specific state
              if (pageState.paymentSuccessCards && Array.isArray(pageState.paymentSuccessCards)) {
                console.log(`📋 Restoring ${pageState.paymentSuccessCards.length} payment success cards`);
                setPaymentSuccessCards(pageState.paymentSuccessCards);
              }
              
              if (pageState.paymentSuccessLast7Summary) {
                console.log(`📋 Restoring last 7 summary:`, pageState.paymentSuccessLast7Summary);
                setPaymentSuccessLast7Summary(pageState.paymentSuccessLast7Summary);
              }
              
              if (pageState.paymentSuccessLast7Rows && Array.isArray(pageState.paymentSuccessLast7Rows)) {
                console.log(`📋 Restoring ${pageState.paymentSuccessLast7Rows.length} last 7 rows`);
                setPaymentSuccessLast7Rows(pageState.paymentSuccessLast7Rows);
              }
              
              if (typeof pageState.paymentSuccess90DayVisits === 'number') {
                console.log(`📋 Restoring 90-day visits: ${pageState.paymentSuccess90DayVisits}`);
                setPaymentSuccess90DayVisits(pageState.paymentSuccess90DayVisits);
              }
              
              if (pageState.paymentSuccessAdditionalUsernames && Array.isArray(pageState.paymentSuccessAdditionalUsernames)) {
                console.log(`📋 Restoring ${pageState.paymentSuccessAdditionalUsernames.length} additional usernames`);
                setPaymentSuccessAdditionalUsernames(pageState.paymentSuccessAdditionalUsernames);
              }
              
              if (pageState.analysis) {
                console.log(`📋 Restoring analysis data`);
                setAnalysis(pageState.analysis);
              }
              
              if (pageState.snapshots && Array.isArray(pageState.snapshots)) {
                console.log(`📋 Restoring ${pageState.snapshots.length} snapshots`);
                setSnapshots(pageState.snapshots);
              }
              
              console.log('✅ Complete pageState restored from MongoDB');
            } else {
              // Fallback: backward compatibility with old format
              console.log('⚠️ Using backward compatibility mode (individual fields)');
              
              if (validateData.cards && Array.isArray(validateData.cards) && validateData.cards.length > 0) {
                console.log('✅ Loading cards from MongoDB:', validateData.cards.length);
                setCards(validateData.cards);
                setPaymentSuccessCards(validateData.cards);
              } else {
                console.warn('⚠️ No cards found in order data');
              }
              
              if (validateData.profile) {
                console.log('✅ Loading profile from MongoDB:', validateData.profile.username);
                setProfile((prev) => ({ ...prev, ...validateData.profile }));
              } else {
                console.warn('⚠️ No profile found in order data');
              }
              
              if (validateData.username) {
                setUsernameInput(validateData.username.replace('@', ''));
              }
            }
            
            // Show payment success screen
            setScreen(SCREEN.PAYMENT_SUCCESS);
            
            // Clean URL but keep /post-purchase path
            window.history.replaceState({}, '', '/post-purchase');
          } else {
            console.error('❌ Order validation failed:', validateData);
          }
        } catch (err) {
          console.error('❌ Error loading order data:', err);
        }
      };
      
      loadOrderData();
      return; // Exit early, don't load from localStorage
    }
  }, []);

  // Restore last successful scrape when returning from payment (only if NOT post-purchase link)
  useEffect(() => {
    // Skip if we're on post-purchase link (already handled above)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const order = urlParams.get('order');
    
    if (token && order) {
      // Post-purchase link will load data from backend, skip localStorage
      return;
    }
    
    const restored = loadLastRun();
    if (!restored) return;

    if (Array.isArray(restored.cards) && restored.cards.length > 0) {
      setCards(restored.cards);
    }

    if (Array.isArray(restored.steps) && restored.steps.length > 0) {
      setSnapshots(restored.steps);
    }

    if (restored.profile) {
      setProfile((prev) => ({ ...prev, ...restored.profile }));
    }
  }, []);

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
      setIsInQueue(false); // No longer in queue, results are ready
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
    // Both carousels start at offset 3 (after duplicated items at start)
    setCarouselIndex(3);
    setStoriesCarouselIndex(3);
  }, [cards, analysis]);

  // Auto-scroll carousel - Infinite loop with duplicates
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;

    const allCards = analysis?.slider?.cards?.length
      ? analysis.slider.cards
      : cards;
    if (allCards.length <= 1) return;

    // Calculate filtered cards length (same logic as in render)
    // Filter out cards that come right after blurred cards (positions 6, 11, 16, etc.)
    const filteredCards = allCards.filter((card, index) => {
      const isAfterBlurredCard = index - 1 > 0 && (index - 1) % 5 === 0;
      return !isAfterBlurredCard;
    });

    if (filteredCards.length <= 1) return;

    // Initialize carousel at offset (after duplicated items at start)
    const offset = 3;
    if (carouselIndex < offset && filteredCards.length > 0) {
      setCarouselIndex(offset);
    }

    const interval = setInterval(() => {
      setCarouselIndex((prev) => {
        const nextIndex = prev + 1;
        // When we reach duplicated end items, jump to real first items
        if (nextIndex >= offset + filteredCards.length) {
          carouselLoopingRef.current = true;
          setTimeout(() => {
            carouselLoopingRef.current = false;
          }, 50);
          return offset; // Jump to start of second copy
        }
        carouselLoopingRef.current = false;
        return nextIndex;
      });
    }, 1500); // Change slide every 1.5 seconds

    return () => clearInterval(interval);
  }, [screen, cards, analysis]);

  // Auto-scroll stories carousel - Infinite loop with duplicates
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;

    const storiesSlides = analysis?.stories?.slides || [];
    if (storiesSlides.length <= 1) return;

    // Initialize stories carousel at offset 3 (after duplicated items at start)
    const offset = 3;
    if (storiesCarouselIndex < offset && storiesSlides.length > 0) {
      setStoriesCarouselIndex(offset);
    }

    const interval = setInterval(() => {
      setStoriesCarouselIndex((prev) => {
        const nextIndex = prev + 1;
        // When we reach 2x the length, reset to length (seamless jump to second copy)
        if (nextIndex >= offset + storiesSlides.length) {
          storiesCarouselLoopingRef.current = true;
          setTimeout(() => {
            storiesCarouselLoopingRef.current = false;
          }, 50);
          return offset; // Jump to start of second copy
        }
        storiesCarouselLoopingRef.current = false;
        return nextIndex;
      });
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
              return `${
                item.username
              } mentioned you in ${messageCount} message${
                messageCount > 1 ? "s" : ""
              }`;
            },
            () => {
              const visitCount = randBetween(5, 10);
              const dayCount = randBetween(2, 5);
              return `${item.username} visited your profile ${visitCount} times in the last ${dayCount} days`;
            },
          ];

          // Randomly select one of the message templates
          const randomTemplate =
            messageTemplates[randBetween(0, messageTemplates.length - 1)];
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
    
    // If htmlPath already starts with /api/, use it as-is (relative to current domain)
    // This handles snapshot URLs from backend like /api/snapshots/${id}/${name}
    if (normalized.startsWith("/api/")) {
      return normalized;
    }
    
    // Otherwise, prepend SNAPSHOT_BASE (for legacy file-based snapshots)
    return `${SNAPSHOT_BASE || ""}${normalized}`;
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
    setIsInQueue(true); // User is now in queue

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
      const eventSourceUrl = `${API_URL}?username=${encodeURIComponent(usernameValue)}&stream=true`;
      console.log(`🔌 Connecting to SSE: ${eventSourceUrl}`);
      
      const eventSource = new EventSource(eventSourceUrl);

      // Log connection state changes
      eventSource.onopen = () => {
        console.log(`✅ SSE connection opened`);
      };

      eventSource.addEventListener("snapshot", (e) => {
        try {
          const step = JSON.parse(e.data);
          console.log(`📥 Received snapshot via SSE: ${step.name}`, step);

          // Register snapshot immediately as it arrives
          setSnapshots((prev) => {
            const filtered = prev.filter((s) => s.name !== step.name);
            const updated = [...filtered, step];
            console.log(`📝 Updated snapshots list:`, updated.map(s => s.name));
            return updated;
          });

          // If this is profile-confirm, trigger immediate UI update
          if (step.name === "profile-confirm") {
            console.log(
              `✅ Profile-confirm snapshot received - UI will update immediately`
            );
            console.log(`   htmlPath: ${step.htmlPath}`);
          }
        } catch (err) {
          console.error("❌ Error parsing snapshot data:", err);
          console.error("   Raw data:", e.data);
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

          // Persist last successful scrape so payment-return pages can restore data
          saveLastRun({
            cards: finalResult.cards || [],
            steps: finalResult.steps || [],
            profile,
            savedAt: Date.now(),
          });

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
        console.error("❌ EventSource error:", err);
        console.error(`   ReadyState: ${eventSource.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`);
        console.error(`   URL: ${eventSourceUrl}`);
        
        // Only reject if connection is closed (readyState === 2)
        // If it's still connecting (0) or open (1), it might recover
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          reject(new Error("SSE connection closed"));
        }
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

  // Helper function to check if queue message should be shown
  const shouldShowQueueMessage = () => {
    if (!isInQueue) return false;
    return (
      screen === SCREEN.LANDING ||
      screen === SCREEN.ANALYZING ||
      screen === SCREEN.PROFILE ||
      screen === SCREEN.PROCESSING
    );
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
      {shouldShowQueueMessage() && (
        <div className="queue-message">
          {QUEUE_MESSAGE}
        </div>
      )}
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
          <h3>Who wants you ❤️‍🔥</h3>
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
        <button type="submit">Reveal</button>
        <small className="small-text-footer">
          Also NOT GOOGLE or FACEBOOK: This site is not a part of the Google
          website, Google Inc, Facebook/Meta website, or Meta, Inc.
          Additionally, This site is NOT endorsed by Google or Meta in any way.
        </small>
      </form>
      <div className="landing-footer">
        <div className="landing-links">
          <a href="https://whoviewedmyprofile.in/contact.html" target="_blank" rel="noreferrer">Contact</a>
          <a href="https://whoviewedmyprofile.in/terms-and-conditions.html" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>
          <a href="https://whoviewedmyprofile.in/privacy-policy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
          <a href="https://whoviewedmyprofile.in/shipping.html" target="_blank" rel="noreferrer">Shipping Policy</a>
          <a href="https://whoviewedmyprofile.in/refund-and-cancellation.html" target="_blank" rel="noreferrer">Refund &amp; Cancellation</a>
        </div>
      </div>
    </section>
  );

  const renderAnalyzing = () => (
    <section className="screen snapshot-stage">
      {shouldShowQueueMessage() && (
        <div className="queue-message">
          {QUEUE_MESSAGE}
        </div>
      )}
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
        {shouldShowQueueMessage() && (
          <div className="queue-message">
            You are in the queue
          </div>
        )}
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
      {shouldShowQueueMessage() && (
        <div className="queue-message">
          {QUEUE_MESSAGE}
        </div>
      )}
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
        <p className="stage-subtitle-analysis">
          Our robots are analyzing{" "}
          <strong className="strong-red">the behavior of your followers</strong>
          {/* {processingStage.subtitle} */}
        </p>
        <ul className="processing-list">
          {processingStage.bullets.map((message, index) => (
            <li
              key={`${message}-${index}`}
              className={index <= processingMessageIndex ? "visible" : ""}
            >
              <p>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="processing-check-icon"
                  aria-hidden="true"
                >
                  <path d="M21.801 10A10 10 0 1 1 17 3.335"></path>
                  <path d="m9 11 3 3L22 4"></path>
                </svg>
                {message}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  // Helper function to format addicted title with red "addicted" word
  const formatAddictedTitle = (title) => {
    if (!title) return null;
    const parts = title.split(/(addicted)/i);
    return parts.map((part, index) => {
      if (part.toLowerCase() === 'addicted') {
        return <span key={index} className="addicted-red">{part}</span>;
      }
      return <span key={index}>{part}</span>;
    });
  };

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
                    <div
                      className="visitor-item"
                      key={`visitor-${index}-${
                        visitor.isLocked ? "locked" : "visible"
                      }`}
                    >
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
                  <strong>{hero.visitors.length} people&nbsp;</strong>visited
                  your profile this week
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
              const hasBlurredCard = allCards.some(
                (card) => card?.blurImage || (!card?.username && card?.image)
              );

              // If no blurred card exists, inject one at a random position
              let cardsToRender = [...allCards];
              if (!hasBlurredCard && allCards.length > 0) {
                // Filter out locked cards and cards without images
                const availableCards = allCards.filter(
                  (card) =>
                    !card?.isLocked &&
                    !card?.blurImage &&
                    card?.image &&
                    card?.username // Must have a username (not already locked/blurred)
                );

                if (availableCards.length > 0) {
                  const randomIndex = Math.floor(
                    Math.random() * (allCards.length + 1)
                  );
                  // Pick a random card from available (non-locked) cards
                  const randomCard =
                    availableCards[
                      Math.floor(Math.random() * availableCards.length)
                    ];
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
                  const isAfterBlurredCard =
                    originalIndex - 1 > 0 && (originalIndex - 1) % 5 === 0;
                  return !isAfterBlurredCard;
                });

              if (filteredCardsWithIndex.length === 0) return null;

              // Create duplicated array for infinite loop
              // Last 3 items at start + all original items + first 3 items at end
              const offset = 3;
              const duplicatedCards = [
                ...filteredCardsWithIndex.slice(-offset).map((item, idx) => ({
                  ...item,
                  duplicateKey: `start-${idx}`,
                })),
                ...filteredCardsWithIndex.map((item, idx) => ({
                  ...item,
                  duplicateKey: `original-${idx}`,
                })),
                ...filteredCardsWithIndex.slice(0, offset).map((item, idx) => ({
                  ...item,
                  duplicateKey: `end-${idx}`,
                })),
              ];

              // Use carouselIndex directly (it already includes offset)
              const displayIndex = carouselIndex;

              return (
                <div className="carousel-container">
                  <div className="carousel-wrapper">
                    <div
                      className="carousel-track"
                      style={{
                        transform: `translateX(calc(-${
                          displayIndex * (220 + 16)
                        }px))`,
                        transition: carouselLoopingRef.current
                          ? 'none'
                          : 'transform 0.4s ease-in-out',
                      }}
                    >
                      {duplicatedCards.map(
                        ({ card, originalIndex, duplicateKey }, index) => {
                          const isActive = index === displayIndex;
                          const imageUrl =
                            card.image || hero.profileImage || profile.avatar;

                          // Check if original position is a multiple of 5 starting from 5 (5, 10, 15, 20, etc.)
                          // If yes, render as blurred card with lock icon (no username, grey blur, lock in middle)
                          const isMultipleOf5 =
                            originalIndex > 0 && originalIndex % 5 === 0;

                          if (isMultipleOf5 && imageUrl) {
                            return (
                              <article
                                className={`slider-card slider-card--blurred ${
                                  isActive ? "active" : ""
                                }`}
                                key={`blurred-multiple-5-${duplicateKey}-${index}`}
                              >
                                <div
                                  className="slider-image blurred-image"
                                  style={{
                                    backgroundImage: `url(${imageUrl})`,
                                  }}
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
                                  isActive ? "active" : ""
                                }`}
                                key={`locked-${duplicateKey}-${index}`}
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
                                  isActive ? "active" : ""
                                }`}
                                key={`blurred-${duplicateKey}-${index}`}
                              >
                                <div
                                  className="slider-image blurred-image"
                                  style={{
                                    backgroundImage: `url(${imageUrl})`,
                                  }}
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
                                isActive ? "active" : ""
                              }`}
                              key={`${card.title}-${duplicateKey}-${index}`}
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
              );
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
                
                if (storiesSlides.length === 0) return null;

                // Create duplicated array for infinite loop
                // Last 3 items at start + all original items + first 3 items at end
                const offset = 3;
                const duplicatedStories = [
                  ...storiesSlides.slice(-offset).map((story, idx) => ({
                    ...story,
                    duplicateKey: `start-${idx}`,
                  })),
                  ...storiesSlides.map((story, idx) => ({
                    ...story,
                    duplicateKey: `original-${idx}`,
                  })),
                  ...storiesSlides.slice(0, offset).map((story, idx) => ({
                    ...story,
                    duplicateKey: `end-${idx}`,
                  })),
                ];

                // Use storiesCarouselIndex directly (it already includes offset)
                const displayStoriesIndex = storiesCarouselIndex;

                return (
                  <div className="carousel-container">
                    <div className="carousel-wrapper">
                      <div
                        className="carousel-track"
                        style={{
                          transform: `translateX(calc(-${
                            displayStoriesIndex * (220 + 16)
                          }px))`,
                          transition: storiesCarouselLoopingRef.current
                            ? 'none'
                            : 'transform 0.4s ease-in-out',
                        }}
                      >
                        {duplicatedStories.map((story, index) => {
                          const isActive = index === displayStoriesIndex;
                          return (
                          <article
                            key={`${story.caption}-${story.duplicateKey}-${index}`}
                            className={`story-card ${
                              isActive ? "active" : ""
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
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
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
              <h3>{formatAddictedTitle(addicted.title)}</h3>
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
                <button
                  className="primary-btn cta-eye-btn"
                  onClick={handleViewFullReport}
                >
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
              {addicted.subfooter && (
                <small className="small-text-footer-sub">
                  {addicted.subfooter}
                </small>
              )}
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
                <h3>🔍Story Repeats</h3>
              </div>
              <p>People who viewed and re-viewed your stories</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
                <h3>🔍Visit Tracking</h3>
              </div>
              <p>Discover who is visiting your profile</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
                <h3>🔍Mention Tracking</h3>
              </div>
              <p>Find out which followers talk about you the most</p>
            </div>

            <div className="full-report-feature-card">
              <div className="full-report-feature-icon">
                <h3>🔍Who's Watching You</h3>
              </div>
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
                <span className="countdown-timer">
                  {formatCountdown(paymentCountdown)}
                </span>
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
                    from <span className="strikethrough">₹1299</span> for:
                  </p>
                  <p className="full-report-current-price">
                    <span className="price-currency">₹</span>{" "}
                    <span className="price-number">99</span>
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
              onClick={() => {
                setScreen(SCREEN.PAYMENT);
                // Scroll to top of page
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
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

  // Scroll to top when navigating to payment page + Track InitiateCheckout
  useEffect(() => {
    if (screen === SCREEN.PAYMENT) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      
      // META PIXEL: Track InitiateCheckout event (fires when payment page loads)
      const amount = 99 * quantity;
      const eventID = `initiate_checkout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'InitiateCheckout', {
          currency: 'INR',
          value: amount,
          content_name: 'Instagram Stalker Report',
          content_category: 'product',
          content_type: 'product',
          num_items: quantity
        }, {
          eventID: eventID // For CAPI deduplication
        });
        console.log('✅ Meta Pixel: InitiateCheckout event fired', { 
          value: amount, 
          currency: 'INR', 
          quantity,
          eventID 
        });
      } else {
        console.warn('⚠️ Meta Pixel (fbq) not loaded yet');
      }
      
      // GTM CODE COMMENTED OUT - Google Tag Manager: Push InitiateCheckout event to dataLayer
      // const amount = 99 * quantity;
      // console.log('🎯 Pushing InitiateCheckout event to dataLayer:', { amount, currency: 'INR', quantity });
      // 
      // if (window.dataLayer) {
      //   window.dataLayer.push({
      //     event: 'InitiateCheckout',
      //     ecommerce: {
      //       currency: 'INR',
      //       value: amount,
      //       items: [{
      //         item_name: 'Instagram Stalker Report',
      //         item_category: 'product',
      //         quantity: quantity,
      //         price: 99
      //       }]
      //     }
      //   });
      //   console.log('✅ InitiateCheckout event pushed to dataLayer successfully');
      // } else {
      //   console.warn('⚠️ dataLayer not available. GTM may not be loaded yet.');
      // }
    }
  }, [screen, quantity]);

  // Countdown timer effect for payment and full report pages
  useEffect(() => {
    if (
      (screen === SCREEN.PAYMENT || screen === SCREEN.FULL_REPORT) &&
      paymentCountdown > 0
    ) {
      const timer = setInterval(() => {
        setPaymentCountdown((prev) => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [screen, paymentCountdown]);

  // GTM CODE COMMENTED OUT - Google Tag Manager: Track PageView on screen changes (for SPA navigation)
  // useEffect(() => {
  //   console.log('🎯 Pushing PageView event to dataLayer for screen:', screen);
  //   
  //   if (window.dataLayer) {
  //     window.dataLayer.push({
  //       event: 'page_view',
  //       page_path: window.location.pathname,
  //       page_title: `Instagram Stalker - ${screen}`,
  //       screen: screen
  //     });
  //     console.log('✅ PageView event pushed to dataLayer successfully');
  //   } else {
  //     console.warn('⚠️ dataLayer not available. GTM may not be loaded yet.');
  //   }
  // }, [screen]);

  // Razorpay SDK is loaded via script tag in index.html - no dynamic loading needed

  // Note: Razorpay doesn't redirect like Cashfree - verification happens in payment handler
  // This useEffect is kept for backward compatibility but Razorpay uses modal, not redirects

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Wait for Razorpay SDK to load
  const waitForRazorpay = () =>
    new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve(window.Razorpay);

      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (window.Razorpay) {
          clearInterval(timer);
          resolve(window.Razorpay);
        }
        if (attempts > 20) {
          clearInterval(timer);
          reject(new Error("Razorpay SDK not loaded"));
        }
      }, 200);
    });

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setPaymentLoading(true);

    try {
      // Save user data to MongoDB
      const saveResponse = await fetch(`/api/payment/save-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentForm),
      }).catch((fetchErr) => {
        console.error("Network error saving user:", fetchErr);
        throw new Error(`Cannot connect to server. Please check if backend is running.`);
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to save user data");
      }

      // Create Razorpay order
      const amount = 99 * quantity; // 99₹ per item (will default to 99 if not provided)
      const orderResponse = await fetch(
        `/api/payment/create-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            amount,
            currency: 'INR',
            email: paymentForm.email,
            fullName: paymentForm.fullName,
            phoneNumber: paymentForm.phoneNumber,
          }),
        }
      ).catch((fetchErr) => {
        console.error("Network error creating payment:", fetchErr);
        throw new Error(`Cannot connect to payment server. Please check if backend is running.`);
      });

      if (!orderResponse.ok) {
        const errorData = await orderResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("Payment order error:", errorData);
        throw new Error(
          errorData.error || errorData.message || "Failed to create payment order"
        );
      }

      const orderData = await orderResponse.json();
      console.log("Razorpay order created:", orderData);

      if (!orderData.success || !orderData.orderId || !orderData.key) {
        throw new Error("Invalid order data received from server");
      }

      // Wait for Razorpay SDK to load
      const Razorpay = await waitForRazorpay();

      // Initialize Razorpay checkout
      const options = {
        key: orderData.key, // Razorpay Key ID from backend
        amount: orderData.amount, // Amount in paise
        currency: orderData.currency || 'INR',
        name: 'Instagram Stalker Analyzer',
        description: 'Payment for Full Report',
        order_id: orderData.orderId, // Order ID from backend
        handler: async function (response) {
          console.log('✅ Razorpay payment success callback:', response);
          
          const orderId = response.razorpay_order_id;
          const paymentId = response.razorpay_payment_id;
          
          // Store payment info in state for success page
          setPaymentForm((prev) => ({
            ...prev,
            orderId: orderId,
            paymentId: paymentId
          }));
          
          // Navigate to success page IMMEDIATELY
          setScreen(SCREEN.PAYMENT_SUCCESS);
          
          // Capture complete page state at payment time
          // This ensures the exact page can be recreated when accessing the link
          
          // Calculate payment success cards if not already set
          const getPaymentSuccessCards = () => {
            if (paymentSuccessCards.length > 0) {
              return paymentSuccessCards;
            }
            // Filter cards with strict criteria (clean profiles only)
            return cards.filter(
              (card) => !card?.isLocked && !card?.blurImage && card?.image && card?.username
            ).slice(0, 6);
          };
          
          // Calculate last 7 summary if not already set
          const getPaymentSuccessLast7Summary = () => {
            if (paymentSuccessLast7Summary.profileVisits !== null) {
              return paymentSuccessLast7Summary;
            }
            // Generate random values (same logic as useEffect)
            const visits = randBetween(1, 5);
            let screenshots = randBetween(1, 5);
            screenshots = ((screenshots % 5) || 5);
            if (screenshots === visits) {
              screenshots = ((screenshots + 1) % 5) || 5;
            }
            return { profileVisits: visits, screenshots };
          };
          
          // Calculate 90-day visits if not already set
          const getPaymentSuccess90DayVisits = () => {
            if (paymentSuccess90DayVisits !== null) {
              return paymentSuccess90DayVisits;
            }
            return randBetween(30, 45);
          };
          
          // Calculate last 7 rows if not already set (simplified version)
          const getPaymentSuccessLast7Rows = () => {
            if (paymentSuccessLast7Rows.length > 0) {
              return paymentSuccessLast7Rows;
            }
            // This will be calculated by useEffect when page loads, but we'll store empty array
            // The useEffect will populate it based on paymentSuccessCards
            return [];
          };
          
          const completePageState = {
            // Core data
            username: profile.username,
            cards: cards,
            profile: profile,
            
            // Payment success page specific state (calculate if not set)
            paymentSuccessCards: getPaymentSuccessCards(),
            paymentSuccessLast7Summary: getPaymentSuccessLast7Summary(),
            paymentSuccessLast7Rows: getPaymentSuccessLast7Rows(),
            paymentSuccess90DayVisits: getPaymentSuccess90DayVisits(),
            paymentSuccessAdditionalUsernames: paymentSuccessAdditionalUsernames.length > 0 
              ? paymentSuccessAdditionalUsernames 
              : [],
            
            // Analysis data (if available)
            analysis: analysis || null,
            
            // Snapshots (if available, for reference)
            snapshots: snapshots.length > 0 ? snapshots : []
          };
          
          // Backend verification happens in background (optional, don't wait)
          const verificationData = {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            // Send complete page state
            pageState: completePageState
          };
          
          console.log('📤 Sending complete pageState to backend:', {
            username: completePageState.username,
            cardsCount: completePageState.cards?.length || 0,
            paymentSuccessCardsCount: completePageState.paymentSuccessCards?.length || 0,
            hasProfile: !!completePageState.profile,
            hasPaymentSuccessLast7Summary: !!completePageState.paymentSuccessLast7Summary,
            paymentSuccessLast7RowsCount: completePageState.paymentSuccessLast7Rows?.length || 0,
            paymentSuccess90DayVisits: completePageState.paymentSuccess90DayVisits,
            hasAnalysis: !!completePageState.analysis
          });
          
          fetch('/api/payment/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(verificationData),
          })
          .then(res => res.json())
          .then(data => {
            console.log('✅ Backend verification response:', data);
            if (data.postPurchaseLink) {
              console.log('📧 Post-purchase link generated:', data.postPurchaseLink);
            }
          })
          .catch(err => console.error('❌ Background verification error:', err));
        },
        prefill: {
          name: paymentForm.fullName,
          email: paymentForm.email,
          contact: paymentForm.phoneNumber,
        },
        theme: {
          color: '#3399cc'
        },
        modal: {
          ondismiss: function() {
            console.log('Payment cancelled by user');
            setPaymentLoading(false);
          }
        }
      };

      console.log("✅ Opening Razorpay checkout with order:", orderData.orderId);

      const razorpay = new Razorpay(options);
      razorpay.open();
      
      // Note: setPaymentLoading(false) will be called in modal.ondismiss or after verification
    } catch (err) {
      console.error("Razorpay error:", err);
      alert(err.message || "Failed to process payment. Please try again.");
      setPaymentLoading(false);
    }
  };

  const renderPayment = () => {
    const originalPrice = 1299;
    const currentPrice = 99;
    const subtotal = currentPrice * quantity;
    const total = subtotal;

    // Indian reviews/testimonials
    const reviews = [
      {
        name: "Anya Aggarwal",
        rating: 5,
        text: "Bechara! It showed my ex is taking screenshots of my story every time I post, and I even discovered the name of his fake account lol,",
        avatar: g1Image,
      },
      {
        name: "Aditya Reddy",
        rating: 5,
        text: "Bruh 😭 I literally found out my ex's cousin was watching all my stories secretly. This app exposed everyone 😂🔥",
        avatar: b1Image,
      },
      {
        name: "Suhani Kedia",
        rating: 5,
        text: "I discovered my ex's 3 best friends were stalking my profile daily",
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
              {/* Payment Header Image */}
              <div className="payment-header-image">
                <img src={paymentHeader} alt="Payment Header" />
              </div>

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

              {/* Guarantee Section - removed as per latest design */}

              {/* Urgency Countdown */}
              <div className="payment-urgency">
                <div className="urgency-icon">⚠️</div>
                  <p>Your report expires in &nbsp;
                    {formatCountdown(paymentCountdown)}</p>
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
                  <div className="order-item-icon"><img src={instaLogo} alt="Instagram" height="80px" width="70px" /></div>
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
                    <span className="breakdown-row-text">Retail price</span>
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
                  type="button"
                  className="place-order-btn"
                  onClick={handlePaymentSubmit}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? "Processing..." : "PLACE ORDER"}
                </button>

                {/* Disclaimers */}
                <div className="payment-disclaimer-box">
                  <div className="payment-disclaimer-header">
                    <span>
                      By continuing, you acknowledge our Service Disclaimer, Acceptable Use, and Data &amp; Privacy Statement.
                    </span>
                    <button
                      type="button"
                      className="payment-disclaimer-toggle"
                      onClick={() => setShowDisclaimers((prev) => !prev)}
                    >
                      {showDisclaimers ? "Hide details" : "View details"}
                    </button>
                  </div>

                  {showDisclaimers && (
                    <div className="payment-disclaimer-body">
                      <h4>Service Disclaimer</h4>
                      <p>This website provides digital, entertainment-based informational services related to social media engagement insights.</p>
                      <p>All information and reports generated are strictly based on publicly available data and user-provided inputs.</p>
                      <p>We do not access private accounts, do not require login credentials, and do not retrieve or store any personal or confidential information.</p>
                      <p>This service is intended solely for entertainment and informational purposes and should not be interpreted as factual tracking, surveillance, or monitoring of any individual.</p>

                      <h4>Acceptable Use</h4>
                      <p>By using this service, you confirm that:</p>
                      <ul>
                        <li>You are requesting insights only for lawful and ethical purposes</li>
                        <li>You understand that the service does not guarantee accuracy or real-time activity</li>
                        <li>You agree that this service does not invade privacy or bypass platform restrictions</li>
                        <li>Any misuse or misinterpretation of the information provided is solely the responsibility of the user.</li>
                      </ul>

                      <h4>Data &amp; Privacy Statement</h4>
                      <p>We do not collect, store, or process:</p>
                      <ul>
                        <li>Private social media data</li>
                        <li>Login credentials</li>
                        <li>Passwords or authentication details</li>
                      </ul>
                      <p>All outputs are generated using publicly accessible information and automated analysis for entertainment use only.</p>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderContactUs = () => {
    return (
      <section className="screen contact-us-screen" style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '40px 20px',
        background: '#fff',
      }}>
        <div style={{ marginBottom: '30px' }}>
          <button 
            onClick={() => setScreen(SCREEN.PAYMENT)}
            style={{
              background: 'none',
              border: 'none',
              color: '#f43f3f',
              cursor: 'pointer',
              fontSize: '16px',
              marginBottom: '20px',
              textDecoration: 'underline'
            }}
          >
            ← Back to Payment
          </button>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '10px', color: '#1a1a1a' }}>
            Contact Us
          </h1>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '30px' }}>
            Get in touch with us for any queries or support
          </p>
        </div>

        {/* Business Information */}
        <div style={{
          background: '#f9f9f9',
          padding: '30px',
          borderRadius: '12px',
          marginBottom: '30px'
        }}>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: '#1a1a1a' }}>
            Contact Information
          </h2>
          
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontWeight: '600', marginBottom: '8px', color: '#333' }}>Email:</div>
            <div style={{ color: '#666', fontSize: '16px' }}>
              <a href="mailto:velarlunera@gmail.com" style={{ color: '#f43f3f', textDecoration: 'none' }}>
                velarlunera@gmail.com
              </a>
            </div>
          </div>
        </div>

        {/* Terms and Conditions */}
        <div style={{
          background: '#fff',
          border: '1px solid #e0e0e0',
          padding: '30px',
          borderRadius: '12px',
          marginBottom: '30px'
        }}>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: '#1a1a1a' }}>
            Terms & Conditions
          </h2>
          
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                1. Service Description
              </h3>
              <p>
                Our service provides Instagram profile analysis and visitor insights. By using our service, 
                you agree to these terms and conditions.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                2. Payment Terms
              </h3>
              <p>
                All payments are processed securely through Razorpay payment gateway. Payment is required 
                before accessing the full report. All prices are in Indian Rupees (INR).
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                3. Refund Policy
              </h3>
              <p>
                We offer a 14-day money-back guarantee. If you're not satisfied with our service within 
                14 days of purchase, contact us for a full refund - no questions asked.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                4. Privacy Policy
              </h3>
              <p>
                We respect your privacy. All personal information provided during payment is securely 
                stored and used only for processing your order and providing customer support.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                5. Service Availability
              </h3>
              <p>
                Our service availability depends on Instagram's API and website structure. We strive to 
                maintain 99% uptime but cannot guarantee uninterrupted service.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                6. Limitation of Liability
              </h3>
              <p>
                Our service is provided "as is" without warranties. We are not liable for any indirect, 
                incidental, or consequential damages arising from the use of our service.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                7. Contact Information
              </h3>
              <p>
                For any queries, complaints, or support, please contact us at:
                <br />
                Email: <a href="mailto:velarlunera@gmail.com" style={{ color: '#f43f3f' }}>velarlunera@gmail.com</a>
                <br />
                Address: #22-8-73/1/125, New Shoe Market, Yousuf Bazar, Chatta Bazaar, Hyderabad, Telangana - 500002
              </p>
            </div>

            <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', fontSize: '12px', color: '#999' }}>
              Last updated: December 5, 2024
            </div>
          </div>
        </div>

        {/* Refund & Cancellation Policy */}
        <div style={{
          background: '#fff',
          border: '1px solid #e0e0e0',
          padding: '30px',
          borderRadius: '12px',
          marginBottom: '30px'
        }}>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: '#1a1a1a' }}>
            Refunds & Cancellations
          </h2>
          
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
            <div style={{ marginBottom: '15px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                Refund Policy
              </h3>
              <p>
                We offer a 14-day money-back guarantee on all purchases. If you're not satisfied with 
                our service for any reason, contact us within 14 days of your purchase date for a full refund.
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                Cancellation Policy
              </h3>
              <p>
                You may cancel your order before payment is processed. Once payment is completed, 
                you can request a refund within 14 days as per our refund policy.
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                Processing Time
              </h3>
              <p>
                Refunds will be processed within 5-7 business days to your original payment method 
                after approval.
              </p>
            </div>
          </div>
        </div>

        {/* Contact Form */}
        <div style={{
          background: '#f9f9f9',
          padding: '30px',
          borderRadius: '12px'
        }}>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: '#1a1a1a' }}>
            Send us a Message
          </h2>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
            Have a question or need support? Send us an email at{' '}
            <a href="mailto:velarlunera@gmail.com" style={{ color: '#f43f3f', fontWeight: '600' }}>
              velarlunera@gmail.com
            </a>
          </p>
          <p style={{ fontSize: '14px', color: '#666' }}>
            We typically respond within 24-48 hours during business days.
          </p>
        </div>
      </section>
    );
  };

  // Fire Purchase pixel immediately when payment success screen loads
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    
    const orderId = paymentForm.orderId;
    const paymentId = paymentForm.paymentId;
    
    if (!orderId || !paymentId) return;
    
    // Prevent duplicate firing (one per order_id)
    if (purchaseEventFiredRef.current.has(orderId)) {
      console.log('⚠️ Purchase already fired for:', orderId);
      return;
    }
    
    // 🚀 FIRE PIXEL IMMEDIATELY ON PAGE LOAD
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', {
        value: 99 * quantity,
        currency: 'INR',
        content_ids: [orderId],
        order_id: orderId,
        transaction_id: paymentId,
        content_name: 'Instagram Stalker Report',
        content_type: 'product',
        num_items: quantity
      });
      console.log('✅ Purchase pixel fired on success page load:', orderId);
      purchaseEventFiredRef.current.add(orderId);
    }
  }, [screen, paymentForm.orderId, paymentForm.paymentId, quantity]);

  // Fetch results.html and extract cards when on payment success page
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    
    const fetchResultsCards = async () => {
      try {
        const resultsStep = snapshots.find((step) => step.name === "results");
        if (!resultsStep || !resultsStep.htmlPath) {
          console.log("No results snapshot found, using cards from state");
          // Helper function for carousel (strict criteria)
          const getCardsWithCriteria = (cardList, requireImage = true, requireNotBlurred = true) => {
            return cardList.filter((card) => {
              if (card?.isLocked || !card?.username) return false;
              if (requireImage && !card?.image) return false;
              if (requireNotBlurred && card?.blurImage) return false;
              return true;
            });
          };
          
          // Carousel: strict criteria (clean profiles only)
          const carouselCards = getCardsWithCriteria(cards, true, true);
          setPaymentSuccessCards(carouselCards.slice(0, 6));
          
          // No results snapshot; to avoid duplicates, do not populate additional usernames
          setPaymentSuccessAdditionalUsernames([]);
          return;
        }

        const url = buildSnapshotUrl(resultsStep.htmlPath);
        if (!url) {
          console.log("Could not build results URL, using cards from state");
          // Helper function for carousel (strict criteria)
          const getCardsWithCriteria = (cardList, requireImage = true, requireNotBlurred = true) => {
            return cardList.filter((card) => {
              if (card?.isLocked || !card?.username) return false;
              if (requireImage && !card?.image) return false;
              if (requireNotBlurred && card?.blurImage) return false;
              return true;
            });
          };
          
          // Carousel: strict criteria (clean profiles only)
          const carouselCards = getCardsWithCriteria(cards, true, true);
          setPaymentSuccessCards(carouselCards.slice(0, 6));
          
          // No URL; to avoid duplicates, do not populate additional usernames
          setPaymentSuccessAdditionalUsernames([]);
          return;
        }

        const res = await fetch(url);
        if (!res.ok) {
          console.log("Failed to fetch results.html, using cards from state");
          // Helper function for carousel (strict criteria)
          const getCardsWithCriteria = (cardList, requireImage = true, requireNotBlurred = true) => {
            return cardList.filter((card) => {
              if (card?.isLocked || !card?.username) return false;
              if (requireImage && !card?.image) return false;
              if (requireNotBlurred && card?.blurImage) return false;
              return true;
            });
          };
          
          // Carousel: strict criteria (clean profiles only)
          const carouselCards = getCardsWithCriteria(cards, true, true);
          setPaymentSuccessCards(carouselCards.slice(0, 6));
          
          // Fetch failed; to avoid duplicates, do not populate additional usernames
          setPaymentSuccessAdditionalUsernames([]);
          return;
        }

        const html = await res.text();
        const parsed = parseResultsSnapshot(html);
        
        // Helper function to get cards with progressively relaxed criteria
        const getCardsWithCriteria = (cardList, requireImage = true, requireNotBlurred = true) => {
          return cardList.filter((card) => {
            if (card?.isLocked || !card?.username) return false;
            if (requireImage && !card?.image) return false;
            if (requireNotBlurred && card?.blurImage) return false;
            return true;
          });
        };
        
        // Use only parsed slider cards from results.html
        const sliderCards = parsed.slider.cards || [];

        // Dedupe by username while preserving order
        const seen = new Set();
        const deduped = [];
        sliderCards.forEach(card => {
          const u = card?.username;
          if (u && !seen.has(u)) {
            seen.add(u);
            deduped.push(card);
          }
        });

        // Carousel: strict criteria (clean profiles only) from deduped slider cards
        const carouselCards = getCardsWithCriteria(deduped, true, true);
        setPaymentSuccessCards(carouselCards.slice(0, 6));

        // Additional usernames: from all remaining cards (>=7), any status, just need username
        const additionalUsernames = deduped
          .slice(6)              // skip first 6 used by carousel
          .map(card => card?.username)
          .filter(Boolean)
          .slice(0, 5);          // up to 5

        console.log(
          `Parsed slider usernames (deduped, after carousel): count=${additionalUsernames.length}`,
          additionalUsernames
        );
        setPaymentSuccessAdditionalUsernames(additionalUsernames);
      } catch (err) {
        console.error("Error fetching results cards:", err);
        // Helper function for carousel (strict criteria)
        const getCardsWithCriteria = (cardList, requireImage = true, requireNotBlurred = true) => {
          return cardList.filter((card) => {
            if (card?.isLocked || !card?.username) return false;
            if (requireImage && !card?.image) return false;
            if (requireNotBlurred && card?.blurImage) return false;
            return true;
          });
        };
        
        // Carousel: strict criteria (clean profiles only)
        const carouselCards = getCardsWithCriteria(cards, true, true);
        setPaymentSuccessCards(carouselCards.slice(0, 6));
        
        // Error fallback; to avoid duplicates, do not populate additional usernames
        setPaymentSuccessAdditionalUsernames([]);
      }
    };

    fetchResultsCards();
  }, [screen, snapshots, cards]);

  // Reset payment success carousel when cards change
  useEffect(() => {
    if (screen === SCREEN.PAYMENT_SUCCESS && paymentSuccessCards.length > 0) {
      const filteredCards = paymentSuccessCards.filter((card, index) => {
        const isAfterBlurredCard = index - 1 > 0 && (index - 1) % 5 === 0;
        return !isAfterBlurredCard;
      });
      const offset = 3;
      if (filteredCards.length > 0) {
        setPaymentSuccessCarouselIndex(offset);
      }
    }
  }, [screen, paymentSuccessCards]);

  // Auto-scroll payment success carousel (same logic as result page)
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS || paymentSuccessCards.length === 0) return;

    // Filter cards (same logic as result page)
    const filteredCards = paymentSuccessCards.filter((card, index) => {
      const isAfterBlurredCard = index - 1 > 0 && (index - 1) % 5 === 0;
      return !isAfterBlurredCard;
    });

    if (filteredCards.length <= 1) return;

    // Initialize carousel at offset (after duplicated items at start)
    const offset = 3;
    if (paymentSuccessCarouselIndex < offset && filteredCards.length > 0) {
      setPaymentSuccessCarouselIndex(offset);
    }

    const interval = setInterval(() => {
      setPaymentSuccessCarouselIndex((prev) => {
        const nextIndex = prev + 1;
        // When we reach duplicated end items, jump to real first items
        if (nextIndex >= offset + filteredCards.length) {
          paymentSuccessCarouselResetRef.current = true;
          setTimeout(() => {
            paymentSuccessCarouselResetRef.current = false;
          }, 50);
          return offset; // Jump to start of second copy
        }
        paymentSuccessCarouselResetRef.current = false;
        return nextIndex;
      });
    }, 2500); // Change slide every 2.5 seconds

    return () => clearInterval(interval);
  }, [screen, paymentSuccessCards.length]);

  // Randomize "Last 7 days" small stats on payment success (1–5 range, not equal)
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;

    const visits = randBetween(1, 5);
    let screenshots = randBetween(1, 5);
    if (screenshots === visits) {
      // Ensure screenshots count is different from visits
      screenshots = ((screenshots % 5) || 5);
      if (screenshots === visits) {
        screenshots = ((screenshots + 1) % 5) || 5;
      }
    }

    setPaymentSuccessLast7Summary({
      profileVisits: visits,
      screenshots,
    });
  }, [screen]);

  // Initialize 90-day profile visits stat on payment success (30–45, stable)
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    if (paymentSuccess90DayVisits === null) {
      setPaymentSuccess90DayVisits(randBetween(30, 45));
    }
  }, [screen, paymentSuccess90DayVisits]);

  // Build 7-profile list for payment success with highlight rules
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;

    // Prefer clean payment-success cards, fallback to generic cards list
    const sourceCards =
      (paymentSuccessCards.length ? paymentSuccessCards : cards).filter(
        (card) => !card?.isLocked && card?.username
      );

    if (!sourceCards.length) {
      setPaymentSuccessLast7Rows([]);
      return;
    }

    // Deduplicate by username while preserving order
    const seen = new Set();
    const uniqueCards = [];
    sourceCards.forEach((card) => {
      const username = (card.username || "").trim();
      if (!username || seen.has(username)) return;
      seen.add(username);
      uniqueCards.push(card);
    });

    // Shuffle (Fisher–Yates)
    const shuffled = [...uniqueCards];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    const TOTAL_ROWS = 7;
    const selected = shuffled.slice(0, Math.min(TOTAL_ROWS, shuffled.length));

    // Fallback: if fewer than 7, backfill from all cards (can include duplicates / placeholders)
    let fallbackIndex = 0;
    while (selected.length < TOTAL_ROWS && cards.length > 0 && fallbackIndex < cards.length * 2) {
      const fallbackCard = cards[fallbackIndex % cards.length];
      fallbackIndex += 1;
      const username = (fallbackCard?.username || "").trim();
      if (!username) continue;
      if (selected.some((c) => (c.username || "").trim() === username)) continue;
      selected.push(fallbackCard);
    }

    // Final padding with generic placeholders if still short
    while (selected.length < TOTAL_ROWS) {
      const index = selected.length + 1;
      selected.push({
        username: `@profile${index}`,
        title: "Instagram user",
        image: null,
      });
    }

    const rowCount = selected.length;

    // Choose one row between 3rd–7th (index 2–6) to have screenshots = 1
    let screenshotRowIndex = null;
    if (rowCount >= 3) {
      const minIndex = 2;
      const maxIndex = Math.min(6, rowCount - 1);
      screenshotRowIndex = randBetween(minIndex, maxIndex);
    }

    // 30% chance that 2nd row also has screenshot = 1
    const secondRowHasScreenshot = rowCount >= 2 && Math.random() < 0.3;

    const rows = selected.slice(0, TOTAL_ROWS).map((card, index) => {
      const username = card.username || "";
      const name =
        (card.title || card.name || "").trim() ||
        username.replace(/^@/, "") ||
        "Instagram user";
      const image = card.image || card.avatar || null;

      let visits = 0;
      let screenshots = 0;
      let visitsHighlighted = false;
      let screenshotsHighlighted = false;

      // First two profiles always have visits = 1 highlighted
      if (index === 0 || index === 1) {
        visits = 1;
        visitsHighlighted = true;
      }

      // Exactly one of the rows 3–7 has screenshots = 1 highlighted
      if (index === screenshotRowIndex) {
        screenshots = 1;
        screenshotsHighlighted = true;
      }

      // 30% chance that row 2 also has screenshots = 1 highlighted
      if (index === 1 && secondRowHasScreenshot) {
        screenshots = 1;
        screenshotsHighlighted = true;
      }

      return {
        id: `${username || "profile"}-${index}`,
        name,
        username,
        image,
        visits,
        screenshots,
        visitsHighlighted,
        screenshotsHighlighted,
      };
    });

    setPaymentSuccessLast7Rows(rows);
  }, [screen, paymentSuccessCards, cards]);

  const renderPaymentSuccess = () => {
    // Use cards from results.html, fallback to cards from state
    const allCards =
      paymentSuccessCards.length > 0
        ? paymentSuccessCards
        : cards
            .filter(
              (card) =>
                !card?.isLocked &&
                !card?.blurImage &&
                card?.image &&
                card?.username
            )
            .slice(0, 6);

    // Basic hero/profile info from analysis or fallback to current profile
    const heroData = analysis?.hero || {};
    const heroName = heroData.name || profile.name;
    const heroUsername = profile.username;
    const heroAvatar = heroData.profileImage || profile.avatar;
    const heroStats =
      heroData.stats && heroData.stats.length
        ? heroData.stats
        : profileStatsFromState();

    // Profile action texts (one for each of the 6 profiles in carousel)
    const profileActions = [
      "This user took screenshot of your profile earlier and yesterday",
      "This user shared your profile",
      "This user screenshoted your last story",
      "This user copied your username",
      "This user viewed your profile yesterday",
      "This user took screenshot of your profile"
    ];

    const handleDownloadPDF = () => {
      try {
        const link = document.createElement('a');
        link.href = '/Dont_Look_Back_Full.pdf';
        link.download = 'Dont_Look_Back_Full.pdf';
        link.target = '_blank'; // Fallback: open in new tab if download fails
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Error downloading PDF:', error);
        // Fallback: open PDF in new tab
        window.open('/Dont_Look_Back_Full.pdf', '_blank');
      }
    };

    return (
      <section className="screen payment-success-screen" style={{
        maxWidth: '100%',
        padding: 'clamp(10px, 3vw, 20px)',
        background: '#fff',
        minHeight: '100vh'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: 'clamp(15px, 3vw, 20px)'
        }}>
          {/* Top header bar */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              marginBottom: "clamp(20px, 4vw, 30px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  backgroundColor: "#f43f3f",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                O
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#111827",
                  }}
                >
                  Insta Reports
                </span>
                <small style={{ fontSize: 12, color: "#6b7280" }}>
                  Your Instagram visitor insights
                </small>
              </div>
            </div>
          </header>

          {/* Disclaimer at the top */}
          <div
            style={{
              marginBottom: "clamp(16px, 4vw, 24px)",
              padding: "clamp(12px, 3vw, 16px)",
              background: "#fef3c7",
              border: "1px solid #facc15",
              borderRadius: 12,
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: "clamp(13px, 2.5vw, 15px)",
                color: "#92400e",
                margin: 0,
                fontWeight: "600",
                lineHeight: 1.6,
              }}
            >
              This report is created by automated AI analysis and may not always
              be 100% accurate. Instagram does not provide official visitor
              data, so results are estimates based on engagement signals only.
            </p>
          </div>

          {/* Hero / profile card + Last 7 days small stats */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: isNarrowLayout
                ? "minmax(0, 1fr)"
                : "minmax(0, 2.2fr) minmax(0, 1.2fr)",
              gap: 20,
              alignItems: "stretch",
              marginBottom: "clamp(24px, 5vw, 32px)",
            }}
          >
            {/* Profile card */}
            <div
              style={{
                background: "#0f172a",
                color: "#f9fafb",
                borderRadius: 20,
                padding: "18px 18px 20px",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "2px solid #fb923c",
                  flexShrink: 0,
                }}
              >
                <img
                  src={heroAvatar}
                  alt={heroName}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    margin: 0,
                    marginBottom: 8,
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                  }}
                >
                  {heroName}
                </h1>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 12,
                    color: "#e5e7eb",
                  }}
                >
                  {heroStats.map((stat) => (
                    <div key={`${stat.label}-${stat.value}`}>
                      <strong style={{ display: "block", fontSize: 14 }}>
                        {stat.value}
                      </strong>
                      <span style={{ opacity: 0.85 }}>{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Last 7 days small stats */}
            <div
              style={{
                background: "#f9fafb",
                borderRadius: 20,
                padding: 18,
                border: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 12,
                  gap: 8,
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f97316"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#111827",
                  }}
                >
                  Last 7 days report
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    background: "#0f172a",
                    borderRadius: 16,
                    padding: "10px 12px",
                    color: "#f9fafb",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: 70,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      opacity: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Profile visits
                  </span>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "#f9fafb",
                    }}
                  >
                    {paymentSuccessLast7Summary.profileVisits ?? "–"}
                  </span>
                </div>
                <div
                  style={{
                    background: "#0f172a",
                    borderRadius: 16,
                    padding: "10px 12px",
                    color: "#f9fafb",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: 70,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      opacity: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Screenshots
                  </span>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "#f9fafb",
                    }}
                  >
                    {paymentSuccessLast7Summary.screenshots ?? "–"}
                  </span>
                </div>
                <div
                  style={{
                    background: "#0f172a",
                    borderRadius: 16,
                    padding: "10px 12px",
                    color: "#f9fafb",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: 70,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "#22c55e",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                      }}
                    >
                      Trend
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "#22c55e",
                    }}
                  >
                    +86%
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      opacity: 0.7,
                      marginTop: 4,
                      lineHeight: 1.3,
                    }}
                  >
                    Increase in visits vs. previous period
                  </span>
                </div>
                <div
                  style={{
                    background: "#0f172a",
                    borderRadius: 16,
                    padding: "10px 12px",
                    color: "#f9fafb",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: 70,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      opacity: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Activity Peak
                  </span>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "#3b82f6",
                    }}
                  >
                    6:30pm
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      opacity: 0.7,
                      marginTop: 4,
                      lineHeight: 1.3,
                    }}
                  >
                    Peak hours for visits
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Carousel - Show cards using same logic as result page */}
          {allCards.length > 0 ? (
            <>
              {(() => {
                // Filter out cards that come right after blurred cards (positions 6, 11, 16, etc.)
                // to prevent duplicates, while keeping track of original indices
                const filteredCardsWithIndex = allCards
                  .map((card, originalIndex) => ({ card, originalIndex }))
                  .filter(({ originalIndex }) => {
                    const isAfterBlurredCard =
                      originalIndex - 1 > 0 && (originalIndex - 1) % 5 === 0;
                    return !isAfterBlurredCard;
                  });

                if (filteredCardsWithIndex.length === 0) return null;

                // Create duplicated array for infinite loop
                // Last 3 items at start + all original items + first 3 items at end
                const offset = 3;
                const duplicatedCards = [
                  ...filteredCardsWithIndex.slice(-offset).map((item, idx) => ({
                    ...item,
                    duplicateKey: `start-${idx}`,
                  })),
                  ...filteredCardsWithIndex.map((item, idx) => ({
                    ...item,
                    duplicateKey: `original-${idx}`,
                  })),
                  ...filteredCardsWithIndex.slice(0, offset).map((item, idx) => ({
                    ...item,
                    duplicateKey: `end-${idx}`,
                  })),
                ];

                // Use paymentSuccessCarouselIndex directly (it already includes offset)
                const displayIndex = paymentSuccessCarouselIndex;

                return (
                  <div className="carousel-container" style={{
                    marginBottom: 'clamp(20px, 5vw, 40px)',
                    padding: '0 clamp(5px, 2vw, 10px)'
                  }}>
                    <div className="carousel-wrapper">
                      <div
                        className="carousel-track"
                        style={{
                          transform: `translateX(calc(-${
                            displayIndex * (220 + 16)
                          }px))`,
                          transition: paymentSuccessCarouselResetRef.current
                            ? 'none'
                            : 'transform 0.4s ease-in-out',
                          gap: '16px',
                          padding: '0 calc(50% - 110px)'
                        }}
                      >
                        {duplicatedCards.map(
                          ({ card, originalIndex, duplicateKey }, index) => {
                            const isActive = index === displayIndex;
                            const imageUrl = card.image;

                            return (
                              <article
                                key={`${card.username || 'card'}-${duplicateKey}-${index}`}
                                className={`slider-card ${
                                  isActive ? "active" : ""
                                }`}
                                style={{
                                  borderRadius: '18px',
                                  overflow: 'hidden',
                                  background: '#fff',
                                  border: '1px solid rgba(0, 0, 0, 0.08)',
                                  boxShadow: isActive ? '0 4px 12px rgba(0, 0, 0, 0.15)' : '0 2px 8px rgba(0, 0, 0, 0.1)'
                                }}
                              >
                                <div
                                  className="slider-image"
                                  style={{
                                    width: '100%',
                                    height: '250px',
                                    backgroundImage: imageUrl
                                      ? `url(${imageUrl})`
                                      : "none",
                                    backgroundColor: imageUrl
                                      ? "transparent"
                                      : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                    backgroundRepeat: 'no-repeat',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative'
                                  }}
                                >
                                  {!imageUrl && (
                                    <div style={{
                                      width: '120px',
                                      height: '120px',
                                      borderRadius: '50%',
                                      background: 'rgba(255, 255, 255, 0.3)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '48px',
                                      color: '#fff'
                                    }}>
                                      👤
                                    </div>
                                  )}
                                </div>
                                <div className="slider-card-content" style={{
                                  padding: 'clamp(15px, 3vw, 20px)',
                                  textAlign: 'center'
                                }}>
                                  {card?.username && (
                                    <h4 className="username" style={{
                                      fontSize: 'clamp(16px, 3vw, 18px)',
                                      fontWeight: '600',
                                      color: '#1a1a1a',
                                      margin: '0 0 8px 0'
                                    }}>
                                      {card.username}
                                    </h4>
                                  )}
                                  <p style={{
                                    fontSize: 'clamp(13px, 2.5vw, 15px)',
                                    color: '#666',
                                    margin: '8px 0 0 0',
                                    fontWeight: '500',
                                    lineHeight: '1.5'
                                  }}>
                                    {profileActions[originalIndex] || profileActions[0]}
                                  </p>
                                </div>
                              </article>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

            </>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: '#666',
              marginBottom: '40px'
            }}>
              <p>Loading profiles...</p>
            </div>
          )}

          {/* Last 7 days 7-profile table (keep, remove 90-day summary) */}
          <section
            style={{
              marginTop: "clamp(10px, 3vw, 18px)",
              marginBottom: "clamp(24px, 5vw, 32px)",
            }}
          >
            <div
              style={{
                background: "#0b1120",
                borderRadius: 20,
                padding: 16,
                color: "#f9fafb",
              }}
            >
                <p
                  style={{
                    fontSize: 11,
                    color: "#b91c1c",
                    margin: "0 0 6px 0",
                  }}
                >
                  We can&apos;t show the full name of the profile because it&apos;s
                  restricted by Instagram.
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <h4
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    Last 7 days
                  </h4>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#9ca3af",
                    }}
                  >
                    Swipe sideways →
                  </span>
                </div>

                <div
                  style={{
                    width: "100%",
                    overflowX: "auto",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      minWidth: 420,
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: "left",
                          color: "#9ca3af",
                          fontSize: 11,
                          letterSpacing: 0.03,
                        }}
                      >
                        <th
                          style={{
                            padding: "6px 4px",
                            fontWeight: 500,
                          }}
                        >
                          Name
                        </th>
                        <th
                          style={{
                            padding: "6px 4px",
                            fontWeight: 500,
                            textAlign: "center",
                          }}
                        >
                          Visits
                        </th>
                        <th
                          style={{
                            padding: "6px 4px",
                            fontWeight: 500,
                            textAlign: "center",
                          }}
                        >
                          Screenshots
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentSuccessLast7Rows.map((row, index) => (
                        <tr
                          key={row.id}
                          style={{
                            borderTop: "1px solid rgba(148, 163, 184, 0.25)",
                          }}
                        >
                          {/* Name + username */}
                          <td
                            style={{
                              padding: "8px 4px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  overflow: "hidden",
                                  background:
                                    "linear-gradient(135deg,#4b5563,#111827)",
                                  flexShrink: 0,
                                }}
                              >
                                {row.image ? (
                                  <img
                                    src={row.image}
                                    alt={row.name}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 14,
                                    }}
                                  >
                                    👤
                                  </div>
                                )}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    whiteSpace: "nowrap",
                                    textOverflow: "ellipsis",
                                    overflow: "hidden",
                                  }}
                                >
                                  {row.name}
                                </span>
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "#9ca3af",
                                  }}
                                >
                                  {row.username}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Visits */}
                          <td
                            style={{
                              padding: "8px 4px",
                              textAlign: "center",
                            }}
                          >
                            {row.visitsHighlighted ? (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 22,
                                  height: 22,
                                  borderRadius: "999px",
                                  border: "1px solid #fbbf24",
                                  color: "#fbbf24",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {row.visits}
                              </div>
                            ) : (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#9ca3af",
                                }}
                              >
                                {row.visits}
                              </span>
                            )}
                          </td>

                          {/* Screenshots */}
                          <td
                            style={{
                              padding: "8px 4px",
                              textAlign: "center",
                            }}
                          >
                            {row.screenshotsHighlighted ? (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 22,
                                  height: 22,
                                  borderRadius: "999px",
                                  background:
                                    "linear-gradient(135deg,#f97316,#ea580c)",
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {row.screenshots}
                              </div>
                            ) : (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#9ca3af",
                                }}
                              >
                                {row.screenshots}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {paymentSuccessLast7Rows.length === 0 && (
                  <div
                    style={{
                      paddingTop: 10,
                      fontSize: 12,
                      color: "#9ca3af",
                    }}
                  >
                    Profiles are loading...
                  </div>
                )}
            </div>
          </section>

          {/* PDF Download Section */}
          <div style={{
            background: '#f9f9f9',
            borderRadius: '16px',
            padding: 'clamp(20px, 4vw, 30px) clamp(15px, 3vw, 20px)',
            textAlign: 'center',
            marginBottom: 'clamp(20px, 4vw, 30px)',
            border: '1px solid #e0e0e0'
          }}>
            <div style={{
              fontSize: 'clamp(32px, 6vw, 48px)',
              marginBottom: 'clamp(12px, 3vw, 20px)'
            }}>📄</div>
            <h2 style={{
              fontSize: 'clamp(22px, 4vw, 28px)',
              fontWeight: '700',
              color: '#1a1a1a',
              marginBottom: '12px'
            }}>
              Download your ebook
            </h2>
            <button
              onClick={handleDownloadPDF}
              className="primary-btn"
              style={{
                background: '#f43f3f',
                color: '#fff',
                border: 'none',
                borderRadius: '999px',
                padding: 'clamp(12px, 2.5vw, 16px) clamp(24px, 4vw, 32px)',
                fontSize: 'clamp(14px, 2.5vw, 18px)',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 15px 40px rgba(244, 63, 63, 0.35)',
                transition: 'transform 0.2s, box-shadow 0.2s',
                minWidth: 'clamp(180px, 30vw, 200px)',
                width: '100%',
                maxWidth: '400px'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 20px 50px rgba(244, 63, 63, 0.4)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 15px 40px rgba(244, 63, 63, 0.35)';
              }}
            >
              pdf (dont look back) [download]
            </button>
          </div>

          {/* Back to Home Button */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => setScreen(SCREEN.LANDING)}
              style={{
                background: 'transparent',
                color: '#f43f3f',
                border: '2px solid #f43f3f',
                borderRadius: '999px',
                padding: 'clamp(10px, 2vw, 12px) clamp(20px, 3vw, 24px)',
                fontSize: 'clamp(14px, 2.5vw, 16px)',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
                width: '100%',
                maxWidth: '300px'
              }}
              onMouseOver={(e) => {
                e.target.style.background = '#f43f3f';
                e.target.style.color = '#fff';
              }}
              onMouseOut={(e) => {
                e.target.style.background = 'transparent';
                e.target.style.color = '#f43f3f';
              }}
            >
              Back to Home
            </button>
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
      case SCREEN.PAYMENT_SUCCESS:
        return renderPaymentSuccess();
      case SCREEN.CONTACT_US:
        return renderContactUs();
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
