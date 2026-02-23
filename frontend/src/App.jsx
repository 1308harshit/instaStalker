import "./App.css";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import SuccessfullyPaid from "./SuccessfullyPaid";

// Simple Error Boundary for debugging
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px", color: "red", backgroundColor: "#ffebee", height: "100vh", overflow: "auto" }}>
          <h2>Application Error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.error && this.state.error.toString()}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: "10px", padding: "8px 16px" }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// API-FIRST ARCHITECTURE REFACTOR
// Snapshot parsing is commented out. Frontend now uses direct API JSON data.
// ============================================================================

// COMMENTED OUT: Snapshot parsing imports (no longer parsing HTML)
// import { parseResultsSnapshot } from "./utils/parseSnapshot";
// import { parseFullReport } from "./utils/parseFullReport";
import b1Image from "./assets/b1.jpg";
import g1Image from "./assets/g1.jpg";
import g2Image from "./assets/g2.jpg";
import printMessageBg from "./assets/print-message-new.png";
import printMessage3 from "./assets/print-message-3.png";
import profileNewPng from "./assets/profile-new.png";
import instaLogo from "./assets/insta-logo.jpeg";
import paymentHeader from "./assets/payment-header.jpeg";

// Production API URL - hardcoded to samjhona.com (NEVER localhost)
const API_URL = import.meta.env.VITE_API_URL?.trim() || "https://samjhona.com/api/stalkers";

const API_BASE = (() => {
  try {
    // Handle relative URLs (like /api/stalkers) - use current origin
    if (API_URL.startsWith("/")) {
      return typeof window !== "undefined" ? window.location.origin : "";
    }
    const url = new URL(API_URL);
    return `${url.protocol}//${url.host}`;
  } catch (err) {
    // Fallback to production domain
    return "https://samjhona.com";

  }
})();

const SNAPSHOT_BASE = import.meta.env.VITE_SNAPSHOT_BASE?.trim() || API_BASE;

// Helpers for Meta Pixel + purchase dedupe
const PURCHASE_PIXEL_STORAGE_KEY = "purchase-pixel-fired";
const PAGEVIEW_FIRED_KEY = "pageview-fired";
const INITIATECHECKOUT_FIRED_KEY = "initiatecheckout-fired";

const loadStoredPurchases = () => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PURCHASE_PIXEL_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(Boolean));
  } catch (err) {
    console.warn("⚠️ Failed to load stored purchase pixels", err);
    return new Set();
  }
};

const persistStoredPurchases = (set) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PURCHASE_PIXEL_STORAGE_KEY,
      JSON.stringify(Array.from(set))
    );
  } catch (err) {
    console.warn("⚠️ Failed to persist purchase pixels", err);
  }
};

// Check if PageView has been fired (persisted across sessions)
const hasPageViewFired = () => {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PAGEVIEW_FIRED_KEY) === "true";
  } catch (err) {
    return false;
  }
};

// Mark PageView as fired
const markPageViewFired = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PAGEVIEW_FIRED_KEY, "true");
  } catch (err) {
    console.warn("⚠️ Failed to persist PageView fired state", err);
  }
};

// Check if InitiateCheckout has been fired (persisted across sessions)
const hasInitiateCheckoutFired = () => {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(INITIATECHECKOUT_FIRED_KEY) === "true";
  } catch (err) {
    return false;
  }
};

// Mark InitiateCheckout as fired
const markInitiateCheckoutFired = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INITIATECHECKOUT_FIRED_KEY, "true");
  } catch (err) {
    console.warn("⚠️ Failed to persist InitiateCheckout fired state", err);
  }
};

// Meta Pixel Helper Function
// Only allows: InitiateCheckout and Purchase events (PageView is fired from index.html)
// SENSORAHUB (commented): use 710646615238495 when hostname has sensorahub
const META_PIXEL_ID = "1752528628790870";
const trackMetaPixel = (eventName, eventData = {}) => {
  if (typeof window === "undefined") return;

  // Only allow InitiateCheckout and Purchase here – PageView is handled in index.html
  const allowedEvents = ["InitiateCheckout", "Purchase"];
  if (!allowedEvents.includes(eventName)) {
    console.warn(
      `⚠️ Meta Pixel: Event "${eventName}" is disabled. Only ${allowedEvents.join(
        ", "
      )} are allowed.`
    );
    return;
  }

  try {
    if (!window.fbq) {
      console.warn(`⚠️ Meta Pixel: fbq not available for ${eventName}`);
      return;
    }

    window.fbq("track", eventName, eventData);
    console.log(`✅ Meta Pixel: ${eventName} tracked`, eventData);
  } catch (err) {
    console.error(`❌ Meta Pixel tracking error for ${eventName}:`, err);
  }
};

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
const LAST_RUN_KEY = "lastScrapeRun";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ANALYZING_STAGE_HOLD_MS = 1500;
const PROFILE_STAGE_HOLD_MS = 4000;
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
  avatar = INITIAL_PROFILE.avatar,
  city = null
) => ({
  username,
  avatar,
  title: "Processing data",
  subtitle: "Our robots are analyzing the behavior of your followers",
  bullets: [
    `Found **${randBetween(8, 15)} mentions** of ${username} in messages from your followers`,
    "Our AI detected a possible **screenshot of someone talking about you**",
    `It was detected that someone you know **visited your profile ${randBetween(7, 14)} times yesterday**`,
    `**${randBetween(2, 5)} people from ${city || "your region"} and nearby regions** shared one of your stories`,
    `Your name was mentioned **${randBetween(3, 8)} times in a secret Instagram group**`,
  ],
});

// ============================================================================
// COMMENTED OUT: HTML PARSING FUNCTIONS
// These functions extracted data from HTML snapshots. No longer needed with API-first approach.
// ============================================================================

// const extractInlineAvatar = (doc) => {
//   const candidate = Array.from(doc.querySelectorAll("[style]")).find((node) =>
//     /background-image/i.test(node.getAttribute("style") || "")
//   );
//   if (candidate) {
//     const match = candidate
//       .getAttribute("style")
//       .match(/url\((['"]?)(.+?)\1\)/i);
//     if (match?.[2]) {
//       return match[2];
//     }
//   }
//   const imgNode = doc.querySelector("img[src]");
//   return imgNode?.getAttribute("src") || INITIAL_PROFILE.avatar;
// };

// const parseProfileSnapshot = (
//   html,
//   fallbackUsername = INITIAL_PROFILE.username
// ) => {
//   try {
//     const parser = new DOMParser();
//     const doc = parser.parseFromString(html, "text/html");
//     const avatar = extractInlineAvatar(doc);
//     const usernameNode = Array.from(doc.querySelectorAll("span, div, p")).find(
//       (node) => /^@/.test((node.textContent || "").trim())
//     );
//     const greetingNode = doc.querySelector("h1, h2");
//     const questionNode = Array.from(doc.querySelectorAll("p, span")).find(
//       (node) => /profile/i.test((node.textContent || "").trim())
//     );
//     const buttons = Array.from(doc.querySelectorAll("button"));
//     const progressNode = Array.from(doc.querySelectorAll("[style]")).find(
//       (node) => /width:\s*\d+%/i.test(node.getAttribute("style") || "")
//     );
//
//     let progressPercent = 55;
//     if (progressNode) {
//       const match = progressNode
//         .getAttribute("style")
//         .match(/width:\s*([\d.]+)%/i);
//       if (match?.[1]) {
//         progressPercent = Number(match[1]);
//       }
//     }
//
//     let cleanUsername = fallbackUsername;
//     if (usernameNode) {
//       const rawText = usernameNode.textContent?.trim() || "";
//       const usernameMatch = rawText.match(/^(@[\w_]+)/i);
//       if (usernameMatch) {
//         cleanUsername = usernameMatch[1];
//         const cleaned = cleanUsername.replace(
//           /(Hello|Is|Continue|the|profile|correct|No|want|correct|it)$/i,
//           ""
//         );
//         if (cleaned.startsWith("@")) {
//           cleanUsername = cleaned;
//         }
//       } else if (rawText.startsWith("@")) {
//         const parts = rawText.split(
//           /(Hello|Is|Continue|the|profile|correct|No|want|correct|it)/i
//         );
//         cleanUsername = parts[0] || fallbackUsername;
//       }
//     }
//
//     return {
//       avatar,
//       progressPercent,
//       username: cleanUsername,
//       greeting: (greetingNode?.textContent || "Hello").trim(),
//       question: (questionNode?.textContent || "Is this your profile?").trim(),
//       primaryCta: (
//         buttons[0]?.textContent || "Continue, the profile is correct"
//       ).trim(),
//       secondaryCta: (
//         buttons[1]?.textContent || "No, I want to correct it"
//       ).trim(),
//     };
//   } catch (err) {
//     console.error("Failed to parse profile snapshot", err);
//     return null;
//   }
// };

// ============================================================================
// NEW: API-FIRST HELPER FUNCTIONS
// ============================================================================

/**
 * Extract best avatar from API response data
 * Priority: base64_profile_pic → profile_pic_url → hd_profile_pic_url_info
 * @param {Object} data - API response data containing profile info
 * @returns {string|null} - Avatar URL or data URI
 */
const getAvatarFromApiData = (data) => {
  if (!data) return null;
  // Priority 1: base64 (preferred - no CORS/expiry issues)
  if (data.base64_profile_pic) {
    const raw = String(data.base64_profile_pic).trim();
    if (raw) {
      return raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
    }
  }
  // Priority 2: Regular profile pic URL
  if (data.profile_pic_url) {
    return data.profile_pic_url;
  }
  // Priority 3: HD profile pic URL
  if (data.hd_profile_pic_url_info?.url) {
    return data.hd_profile_pic_url_info.url;
  }
  // Priority 4: Check for 'image' field (cards format)
  if (data.image) {
    return data.image;
  }
  // Priority 5: Check for 'avatar' field (pre-computed)
  if (data.avatar) {
    return data.avatar;
  }
  return null;
};

/**
 * Reconstruct analysis object from API data to unblock UI transitions
 */
const createAnalysisFromApiData = (profileData, followersData, profileState) => {
  if (!profileData) return null;

  // 1. Build Hero section
  const hero = {
    name: profileData.full_name || profileData.username || profileState.name,
    username: profileData.username ? `@${profileData.username.replace(/^@/, '')}` : profileState.username,
    profileImage: getAvatarFromApiData(profileData) || profileState.avatar,
    stats: [
      { 
        value: profileData.media_count ?? profileState.posts ?? 0, 
        label: "posts" 
      },
      { 
        value: profileData.follower_count ?? profileState.followers ?? 0, 
        label: "followers" 
      },
      { 
        value: profileData.following_count ?? profileState.following ?? 0, 
        label: "following" 
      },
    ],
    visitors: (followersData || []).slice(0, 6).map((f, i) => ({
      image: i % 2 === 0 ? getAvatarFromApiData(f) : null,
      isLocked: i % 2 !== 0,
      alt: f.username || `visitor-${i + 1}`,
    })),
    visitorSummary: "",

  };

  // 2. Build slider cards from followers
  const sliderCards = (followersData || []).map(f => ({
    username: f.username ? `@${f.username.replace(/^@/, '')}` : null,
    title: f.full_name || f.username || "Instagram User",
    image: getAvatarFromApiData(f),
    isLocked: false,
    blurImage: !f.username,
    lines: []
  }));

  // 3. Build addicted tiles from a subset of followers (up to 4)
  const addictedBodies = [
    `Visited your profile <strong>12 times yesterday</strong>`,
    `Visited your profile <strong>late at night</strong>`,
    `Added <span class="red">only you to their close friends</span>`,
    `Took a screenshot of your profile and stories`,
  ];
  const addictedTiles = (followersData || []).slice(0, 4).map((f, i) => ({
    title: f.username ? `@${f.username.replace(/^@/, '')}` : "hidden_user",
    image: getAvatarFromApiData(f),
    body: addictedBodies[i] || "",
    blurred: true,
  }));

  // 4. Return full analysis structure
  return {
    hero,
    summary: { 
      warning: "Don't leave this page.",
      weekRange: "Last 7 days",
      cards: [
        { title: "8 people", detail: "visited your profile in recent days" },
        { title: "5 conversations", detail: "contain your name, 3 positive and 2 negative" }
      ]
    },
    slider: { 
      heading: "Visited your profile this week between 2 to 7 times:",
      cards: sliderCards 
    },
    screenshots: { chat: [] },
    stories: { slides: [] },
    alert: { title: "", badge: "", copy: "" },
    addicted: { 
      tiles: addictedTiles, 
      title: "The addicted to you:",
      footer: "AVAILABLE IN\nTHE FULL REPORT",
      subfooter: "",
    },
    ctas: { 
      primary: "Reveal Stalkers", 
      secondary: "View Uncensored",
      tertiary: "View Full Report"
    }
  };
};


// COMMENTED OUT: parseProcessingSnapshot - HTML parsing no longer needed
// const parseProcessingSnapshot = (html, fallbackAvatar, fallbackUsername) => {
//   try {
//     const parser = new DOMParser();
//     const doc = parser.parseFromString(html, "text/html");
//     const avatar = extractInlineAvatar(doc) || fallbackAvatar;
//     const titleNode = doc.querySelector("h1, h2");
//     const subtitleNode = doc.querySelector("p");
//     const bullets = [];
//
//     const listItems = Array.from(doc.querySelectorAll("li"));
//     listItems.forEach((li) => {
//       const directText = Array.from(li.childNodes)
//         .filter((node) => node.nodeType === 3)
//         .map((node) => node.textContent.trim())
//         .join(" ")
//         .trim();
//
//       if (directText && directText.length > 20) {
//         const nestedText = li.textContent.trim();
//         const text = nestedText.length < 200 ? nestedText : directText;
//         if (
//           text &&
//           /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(
//             text
//           )
//         ) {
//           bullets.push(text);
//         }
//       }
//     });
//
//     if (bullets.length === 0) {
//       const paragraphs = Array.from(doc.querySelectorAll("p"));
//       paragraphs.forEach((p) => {
//         const text = p.textContent.trim();
//         if (
//           text.length > 20 &&
//           text.length < 200 &&
//           /mentions|detected|visited|people|screenshot|region|profile|times|yesterday|shared|stories|messages|followers|found.*\d+/i.test(
//             text
//           )
//         ) {
//           bullets.push(text);
//         }
//       });
//     }
//
//     const uniqueBullets = bullets
//       .filter((text, index, arr) => arr.indexOf(text) === index)
//       .filter((text) => text.length < 200);
//
//     return {
//       avatar,
//       title: titleNode?.textContent?.trim() || "Processing data",
//       subtitle:
//         subtitleNode?.textContent?.trim() ||
//         "Our robots are analyzing the behavior of your followers",
//       bullets:
//         uniqueBullets.length > 0
//           ? uniqueBullets
//           : [
//               `Found 10 mentions of ${fallbackUsername} in messages from your followers`,
//               "Our AI detected a possible screenshot of someone talking about you",
//               "It was detected that someone you know visited your profile 9 times yesterday",
//               "2 people from your region shared one of your stories",
//             ],
//     };
//   } catch (err) {
//     console.error("Failed to parse processing snapshot", err);
//     return null;
//   }
// };


function App() {
  const postPurchaseLockRef = useRef(false);
  const [screen, setScreen] = useState(SCREEN.LANDING);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [usernameInput, setUsernameInput] = useState("");
  const [cards, setCards] = useState([]);
  
  // ============================================================================
  // API-FIRST STATE: Raw API data storage (replaces snapshot-based approach)
  // ============================================================================
  const [apiProfileData, setApiProfileData] = useState(null);
  const apiProfileDataRef = useRef(null); // Ref for immediate access in SSE handlers
  // Shape: { username, full_name, profile_pic_url, base64_profile_pic, 
  //          hd_profile_pic_url_info, follower_count, following_count, 
  //          is_private, is_verified, id, avatar }
  
  const [apiFollowersData, setApiFollowersData] = useState([]);
  // Shape: [{ username, profile_pic_url, base64_profile_pic, full_name, image }, ...]
  
  // COMMENTED OUT: Snapshot-based state (replaced by API-first approach)
  // const [snapshots, setSnapshots] = useState([]);
  
  const [analysis, setAnalysis] = useState(null);
  const [paymentSuccessCards, setPaymentSuccessCards] = useState([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [freshAvatars, setFreshAvatars] = useState({}); // Cache for fresh avatars fetched on failure

  // ✅ Proxy Instagram images to bypass Referer/Session blocks
  const proxyImage = (url) => {
    if (!url || !url.includes("fbcdn.net")) return url;
    // Decode &amp; if present, then encode for proxy
    const cleanUrl = url.replace(/&amp;/g, "&");
    return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}`;
  };
  
  const formatWeekRange = () => {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - 6);
    const formatDate = (d) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month}`;
    };
    return `${formatDate(start)} - ${formatDate(now)}`;
  };
  const [paymentSuccessLast7Summary, setPaymentSuccessLast7Summary] = useState({
    profileVisits: null,
    screenshots: null,
  });
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
  const [paymentSuccessCarouselIndex, setPaymentSuccessCarouselIndex] =
    useState(0);
  const [
    paymentSuccessAdditionalUsernames,
    setPaymentSuccessAdditionalUsernames,
  ] = useState([]);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  
  const [geoData, setGeoData] = useState(null);

  // Fetch GEO Data
  useEffect(() => {
    fetch("https://get.geojs.io/v1/ip/geo.json")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.city) {
          setGeoData(data);
        }
      })
      .catch((err) => console.error("Failed to fetch geo data:", err));
  }, []);

  // Update Processing Stage Bullets when Geo Data arrives
  useEffect(() => {
    if (processingStage.username && geoData && geoData.city) {
      setProcessingStage((prev) => ({
        ...prev,
        ...createProcessingStageData(prev.username, prev.avatar, geoData.city),
      }));
    }
  }, [geoData]);
  
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
  const checkoutEventFiredRef = useRef(hasInitiateCheckoutFired()); // Track if InitiateCheckout has been fired (persisted)
  const pageViewFiredRef = useRef(hasPageViewFired()); // Track if PageView has been fired (persisted)
  const purchaseEventFiredRef = useRef(loadStoredPurchases()); // Track fired order IDs to prevent duplicates across session + persisted
  // Keep latest values available for effects with [] deps (e.g. payment return flow)
  const cardsRef = useRef([]);
  const profileRef = useRef(INITIAL_PROFILE);
  const [hasStoredReport, setHasStoredReport] = useState(false);
  const [profileConfirmParsed, setProfileConfirmParsed] = useState(false);
  const attemptedFreshAvatars = useRef(new Set());
  const [errorMessage, setErrorMessage] = useState("");
  
  // COMMENTED OUT: Snapshot HTML storage (replaced by API-first approach)
  // const [snapshotHtml, setSnapshotHtml] = useState({
  //   analyzing: null,
  //   "profile-confirm": null,
  //   processing: null,
  // });
  const [fullReportHtml, setFullReportHtml] = useState(null);
  const [fullReportData, setFullReportData] = useState(null);
  const [fullReportLoading, setFullReportLoading] = useState(false);
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const [isInQueue, setIsInQueue] = useState(false);
  // COMMENTED OUT: Cashfree state (replaced by Razorpay)
  // const [cashfreeEnv, setCashfreeEnv] = useState(null);
  // const [cashfreeSdkLoaded, setCashfreeSdkLoaded] = useState(false);
  // const cashfreeEnvRef = useRef(null);
  // Paytm: payment via redirect (no SDK state needed)

  // ✅ Purchase pixel: fire IMMEDIATELY when success screen is shown
  // Matches the exact Razorpay branch logic — simple, direct fbq call.
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    if (postPurchaseLockRef.current) return;

    // Read orderId from pending purchase in localStorage
    const PENDING_KEY = "instaStalker_pending_purchase";
    let orderId = "order_unknown";
    let paymentId = "";
    let numItems = 1;
    try {
      const raw = window.localStorage.getItem(PENDING_KEY);
      if (raw) {
        const pending = JSON.parse(raw);
        if (pending?.id) orderId = pending.id;
        if (pending?.quantity) numItems = pending.quantity;
        window.localStorage.removeItem(PENDING_KEY);
      }
    } catch {}

    if (purchaseEventFiredRef.current.has(orderId)) {
      console.log('⚠️ Purchase already fired for:', orderId);
      return;
    }

    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', {
        value: 99 * numItems,
        currency: 'INR',
        content_ids: [orderId],
        order_id: orderId,
        transaction_id: orderId,
        content_name: 'Instagram Stalker Report',
        content_type: 'product',
        num_items: numItems
      });
      console.log('✅ Purchase pixel fired on success page load:', orderId);
      purchaseEventFiredRef.current.add(orderId);
    }
  }, [screen]);

  // ✅ Cleanup stale pending purchases on app load (prevents false fires)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const PENDING_KEY = "instaStalker_pending_purchase";
    const PENDING_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

    try {
      const pendingRaw = window.localStorage.getItem(PENDING_KEY);
      if (!pendingRaw) return;

      const pending = JSON.parse(pendingRaw);
      if (!pending || typeof pending !== "object") {
        // Clean up invalid data
        window.localStorage.removeItem(PENDING_KEY);
        return;
      }

      const pendingTimestamp = typeof pending.ts === "number" ? pending.ts : null;
      if (!pendingTimestamp) {
        // Clean up data without timestamp
        window.localStorage.removeItem(PENDING_KEY);
        return;
      }

      const ageMs = Date.now() - pendingTimestamp;
      if (ageMs > PENDING_EXPIRY_MS || ageMs < 0) {
        // Clean up expired or invalid timestamps
        console.log("🧹 Cleaning up expired pending purchase (age:", Math.round(ageMs / 1000 / 60), "minutes)");
        window.localStorage.removeItem(PENDING_KEY);
      }
    } catch (err) {
      // Clean up corrupted data
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch {}
    }
  }, []); // Run once on mount

  // Detect PayU redirect path on initial load and show success screen
  useEffect(() => {
    if (typeof window === "undefined") return;

    const path = window.location.pathname;
    if (path === "/successfully-paid") {
      setScreen(SCREEN.PAYMENT_SUCCESS);
    }
  }, []);

  // Keep refs in sync with state (for one-time effects)
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Post-purchase entry point - always show success screen
  // ✅ CRITICAL FIX #6: Set postPurchaseLockRef FIRST before any other effects run
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Be tolerant of trailing slashes (e.g. /post-purchase/)
    if (window.location.pathname.startsWith("/post-purchase")) {
      postPurchaseLockRef.current = true; // 🔐 LOCK - Set immediately to prevent race condition
      // Clean up any pending purchase to prevent false fires
      try {
        window.localStorage.removeItem("instaStalker_pending_purchase");
      } catch {}
      setScreen(SCREEN.PAYMENT_SUCCESS);
    }
  }, []); // Run FIRST to prevent race conditions

  // Clean URL after showing success screen (remove query params)
  useEffect(() => {
    if (
      screen === SCREEN.PAYMENT_SUCCESS &&
      typeof window !== "undefined" &&
      !postPurchaseLockRef.current // ✅ ONLY normal payments
    ) {
      try {
        window.history.replaceState({}, "", "/successfully-paid");
      } catch {}
    }
  }, [screen]);

  // ❌ REMOVED: Old PayU success page useEffect that waited for screen state
  // This was causing the pixel to fire too late. The new immediate fire useEffect above handles this now.
  // // PayU success page: fire Purchase once on landing
  // useEffect(() => {
  //   if (typeof window === "undefined") return;
  //   if (screen !== SCREEN.PAYMENT_SUCCESS) return;
  //
  //   // Never fire Purchase for post-purchase (email link) flow
  //   if (postPurchaseLockRef.current) return;
  //
  //   // Only for PayU landing path
  //   if (window.location.pathname !== "/successfully-paid") return;
  //
  //   const PENDING_KEY = "instaStalker_pending_purchase";
  //
  //   let pending = null;
  //   try {
  //     pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "null");
  //   } catch {
  //     pending = null;
  //   }
  //
  //   // Prevent false Purchase events if user opens the URL directly
  //   if (!pending || typeof pending !== "object") return;
  //
  //   const purchaseId =
  //     typeof pending.id === "string" && pending.id.trim()
  //       ? pending.id.trim()
  //       : "payu";
  //   const firedKey = `instaStalker_purchase_fired_${purchaseId}`;
  //
  //   try {
  //     if (window.localStorage.getItem(firedKey)) return;
  //     window.localStorage.setItem(firedKey, String(Date.now()));
  //     window.localStorage.removeItem(PENDING_KEY);
  //   } catch {
  //     // ignore storage errors
  //   }
  //
  //   const value =
  //     typeof pending.value === "number" && Number.isFinite(pending.value)
  //       ? pending.value
  //       : 99;
  //   const currency =
  //     typeof pending.currency === "string" && pending.currency.trim()
  //       ? pending.currency.trim()
  //       : "INR";
  //
  //   trackMetaPixel("Purchase", {
  //     value,
  //     currency,
  //     content_name: "Instagram Stalker Report",
  //     content_category: "Digital Product",
  //     event_id: purchaseId, // Required for deduplication
  //     order_id: purchaseId, // Helps with conversion matching
  //     content_ids: [purchaseId], // Product identifier
  //   });
  // }, [screen]);

  const isNarrowLayout = viewportWidth < 768;

  // Payment page state
  const [paymentForm, setPaymentForm] = useState({
    email: "",
    fullName: "",
    phoneNumber: "",
  });
  const [previewEmail, setPreviewEmail] = useState("");
  const [paymentCountdown, setPaymentCountdown] = useState(404); // 6:44 in seconds
  const [quantity, setQuantity] = useState(1);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [showDisclaimers, setShowDisclaimers] = useState(false);
  const activeRequestRef = useRef(0);
  const stepHtmlFetchRef = useRef({});
  const paymentSessionRef = useRef(null);
  // keyData unused (Paytm uses server redirect)
  // COMMENTED OUT: snapshotLookup - no longer using snapshots with API-first approach
  // const snapshotLookup = useMemo(() => {
  //   return snapshots.reduce((acc, step) => {
  //     acc[step.name] = step;
  //     return acc;
  //   }, {});
  // }, [snapshots]);
  const snapshotLookup = {};  // Empty object for backward compatibility

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
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const rememberPurchasePixel = () =>
    persistStoredPurchases(purchaseEventFiredRef.current);

  // PageView is now fired directly from index.html on initial load
  // (old Razorpay behavior). We no longer send a React-driven PageView here.

  // Restore last successful scrape when returning from payment
  useEffect(() => {
    // Never restore from localStorage on post-purchase page (email link flow)
    if (window.location.pathname.startsWith("/post-purchase")) return;

    // Don't restore from localStorage if we're accessing via post-purchase link
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    const order = urlParams.get("order");

    if (token && order) {
      // Post-purchase link will load data from backend, skip localStorage
      return;
    }

    const restored = loadLastRun();
    if (!restored) return;

    if (Array.isArray(restored.cards) && restored.cards.length > 0) {
      setCards(restored.cards);
    }

    // COMMENTED OUT: snapshot state restoration
    // if (Array.isArray(restored.steps) && restored.steps.length > 0) {
    //   setSnapshots(restored.steps);
    // }

    if (restored.profile) {
      const restoredCards = Array.isArray(restored.cards) ? restored.cards : [];
      const derivedPosts =
        restored.profile.media_count ??
        restored.profile.posts ??
        (restoredCards.length > 0 ? restoredCards.length : undefined);
      setProfile((prev) => ({
        ...prev,
        ...restored.profile,
        ...(Number.isFinite(Number(derivedPosts))
          ? { posts: Number(derivedPosts) }
          : {}),
      }));
    }
  }, []);

  // Handle post-purchase link access - load order-specific data
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get("token");
    let order = urlParams.get("order");

    // If URL was cleaned (no query params), try to recover from sessionStorage
    // so refresh doesn't break the post-purchase page.
    // 🔐 ONLY recover from sessionStorage if we are actually on the post-purchase path
    if (!token || !order) {
      if (window.location.pathname.startsWith("/post-purchase")) {
        try {
          const storedToken = sessionStorage.getItem("postPurchaseToken");
          const storedOrder = sessionStorage.getItem("postPurchaseOrder");
          if (storedToken && storedOrder) {
            token = storedToken;
            order = storedOrder;
            console.log("🔄 Recovered post-purchase session from storage");
          }
        } catch {}
      }
    }

    // If we have token and order params, fetch order data
    if (token && order) {
      // 🔐 Ensure we never rewrite to /successfully-paid for post-purchase access
      postPurchaseLockRef.current = true;

      const loadOrderData = async () => {
        try {
          // Persist for reload safety (URL may be cleaned)
          try {
            sessionStorage.setItem("postPurchaseToken", token);
            sessionStorage.setItem("postPurchaseOrder", order);
          } catch {}

          const apiUrl = `/api/payment/post-purchase?token=${encodeURIComponent(
            token
          )}&order=${encodeURIComponent(order)}`;
          const validateResponse = await fetch(apiUrl);

          if (validateResponse.ok) {
            const validateData = await validateResponse.json();

            if (validateData.success) {
              console.log(
                "✅ Post-purchase link validated, loading order data"
              );

              // If backend returns a finalized stored report, use it and disable randomization.
              if (validateData.report) {
                setHasStoredReport(true);
                // Use stored hero profile (avatar + counts) so refresh is stable
                if (validateData.report.heroProfile) {
                  setProfile((prev) => {
                    const next = { ...prev, ...validateData.report.heroProfile };
                    // If older stored reports have the demo/default name, replace with username-derived label.
                    const looksDefault =
                      next?.name === INITIAL_PROFILE.name &&
                      next?.username === INITIAL_PROFILE.username;
                    if (looksDefault) {
                      const u =
                        (validateData.report.heroProfile?.username ||
                          validateData.username ||
                          next?.username ||
                          "")
                          .toString()
                          .trim();
                      if (u) next.name = u.replace(/^@/, "");
                    }
                    if (!next?.name) {
                      const u =
                        (validateData.report.heroProfile?.username ||
                          validateData.username ||
                          next?.username ||
                          "")
                          .toString()
                          .trim();
                      if (u) next.name = u.replace(/^@/, "");
                    }
                    return next;
                  });
                }
                if (validateData.report.carouselCards) {
                  setPaymentSuccessCards(validateData.report.carouselCards);
                }
                if (validateData.report.last7Summary) {
                  setPaymentSuccessLast7Summary(validateData.report.last7Summary);
                }
                if (
                  Array.isArray(validateData.report.last7Rows) &&
                  validateData.report.last7Rows.length > 0
                ) {
                  setPaymentSuccessLast7Rows(validateData.report.last7Rows);
                }
              } else {
                setHasStoredReport(false);
              }

              const hasCards =
                Array.isArray(validateData.cards) && validateData.cards.length > 0;

              // Load order-specific data from backend (not localStorage)
              if (hasCards) {
                if (!cancelled) {
                  setCards(validateData.cards);
                  if (!validateData.report?.carouselCards) {
                    setPaymentSuccessCards(validateData.cards);
                  }
                }
              }

              if (validateData.profile) {
                if (!cancelled) {
                  // Ensure "posts" isn't left at INITIAL_PROFILE.posts (10) when
                  // backend profile object doesn't include a posts/media_count field.
                  const derivedPosts =
                    validateData.profile.media_count ??
                    validateData.profile.posts ??
                    (hasCards ? validateData.cards.length : undefined);
                  setProfile((prev) => ({
                    ...prev,
                    ...validateData.profile,
                    ...(Number.isFinite(Number(derivedPosts))
                      ? { posts: Number(derivedPosts) }
                      : {}),
                  }));
                }
              }

              if (validateData.username) {
                if (!cancelled) {
                  setUsernameInput(validateData.username.replace("@", ""));
                }
              }

              // Fire purchase pixel once when arriving via post-purchase link
              const orderIdForPixel =
                validateData.orderId || order || validateData.payment_request_id;
              
              // Old Razorpay setup did not fire an extra Purchase event
              // for post-purchase links; we now rely on the main success
              // flow Purchase pixel instead.

              // Fallback: if backend has no stored report/cards (we no longer send
              // them during payment-init), use localStorage immediately so the
              // success screen renders fast instead of polling the DB for 30s.
              if (!validateData.report && !hasCards) {
                const restored = loadLastRun();
                const restoredCards =
                  restored && Array.isArray(restored.cards) ? restored.cards : [];
                const restoredProfile = restored?.profile || null;

                if (restoredCards.length > 0) {
                  if (!cancelled) {
                    setCards(restoredCards);
                    setPaymentSuccessCards(restoredCards);
                  }
                }

                if (restoredProfile) {
                  if (!cancelled) {
                    const derivedPosts =
                      restoredProfile.media_count ??
                      restoredProfile.posts ??
                      (restoredCards.length > 0 ? restoredCards.length : undefined);
                    setProfile((prev) => ({
                      ...prev,
                      ...restoredProfile,
                      ...(Number.isFinite(Number(derivedPosts))
                        ? { posts: Number(derivedPosts) }
                        : {}),
                    }));
                  }
                }
              }

              // Show payment success screen
              if (!cancelled) {
                setScreen(SCREEN.PAYMENT_SUCCESS);
              }

              // Clean URL but keep /post-purchase path
              window.history.replaceState({}, "", "/post-purchase");
            }
          }
        } catch (err) {
          console.error("Error loading order data:", err);
        }
      };

      loadOrderData();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // COMMENTED OUT: fetchSnapshotHtml - legacy function no longer needed
  // const fetchSnapshotHtml = async (stepName, htmlPath) => {
  //   const url = buildSnapshotUrl(htmlPath);
  //   if (!url) return null;
  //   try {
  //     const res = await fetch(url);
  //     if (!res.ok) return null;
  //     const html = await res.text();
  //     if (typeof DOMParser !== "undefined") {
  //       const parser = new DOMParser();
  //       const doc = parser.parseFromString(html, "text/html");
  //       doc.querySelectorAll("script").forEach((node) => node.remove());
  //       const body = doc.querySelector("body");
  //       const styles = doc.querySelectorAll("style, link[rel='stylesheet']");
  //       const headMarkup = Array.from(styles)
  //         .map((node) => node.outerHTML)
  //         .join("");
  //       if (body) {
  //         return `${headMarkup}${body.innerHTML}`;
  //       }
  //     }
  //     return html;
  //   } catch (err) {
  //     console.error(`Failed to fetch snapshot HTML for ${stepName}:`, err);
  //     return null;
  //   }
  // };

  // COMMENTED OUT: loadSnapshotHtml useEffect - no longer fetching snapshot HTML
  // useEffect(() => {
  //   const loadSnapshotHtml = async (stepName) => {
  //     const step = snapshotLookup[stepName];
  //     if (!step || snapshotHtml[stepName] || stepHtmlFetchRef.current[stepName])
  //       return;
  //     stepHtmlFetchRef.current[stepName] = true;
  //     
  //     // ✅ PRIORITY 1: Try to fetch metadata first (includes profileData)
  //     if (stepName === "profile-confirm") {
  //       try {
  //         const metaUrl = `${step.htmlPath}/meta`;
  //         const metaRes = await fetch(buildSnapshotUrl(metaUrl));
  //         if (metaRes.ok) {
  //           const metaData = await metaRes.json();
  //           if (metaData?.meta?.profileData) {
  //             const profileData = metaData.meta.profileData;
  //             console.log("✅ Using raw profileData from metadata API:", profileData);
  //             
  //             // Update profile with raw data from API
  //             setProfile((prev) => ({
  //               ...prev,
  //               username: profileData.username ? `@${profileData.username}` : prev.username,
  //               name: profileData.full_name || prev.name,
  //               avatar: profileData.avatar || prev.avatar,
  //               followers: profileData.follower_count || prev.followers,
  //               following: profileData.following_count || prev.following,
  //             }));
  //
  //             // Update profile stage
  //             setProfileStage({
  //               avatar: profileData.avatar,
  //               progressPercent: 55,
  //               username: profileData.username ? `@${profileData.username}` : profile.username,
  //               greeting: `Hello, ${profileData.full_name || profileData.username}`,
  //               question: "Is this your profile?",
  //               primaryCta: "Continue, the profile is correct",
  //               secondaryCta: "No, I want to correct it",
  //             });
  //             
  //             setProfileConfirmParsed(true);
  //             
  //             // ✅ CRITICAL: Mark HTML as loaded so screen transitions work
  //             setSnapshotHtml((prev) => ({
  //               ...prev,
  //               [stepName]: "<!-- Loaded from metadata -->",
  //             }));
  //             
  //             stepHtmlFetchRef.current[stepName] = false;
  //             return; // Skip HTML loading since we have the data
  //           }
  //         }
  //       } catch (metaErr) {
  //         console.log("⚠️ Failed to fetch metadata, falling back to HTML parsing:", metaErr);
  //       }
  //     }
  //     
  //     // ✅ FALLBACK: Load HTML and parse it
  //     const html = await fetchSnapshotHtml(stepName, step.htmlPath);
  //     if (html) {
  //       setSnapshotHtml((prev) => {
  //         if (prev[stepName]) return prev;
  //         return {
  //           ...prev,
  //           [stepName]: html,
  //         };
  //       });
  //       if (stepName === "profile-confirm") {
  //         // ✅ PRIORITY 1: Check if we have raw profileData in snapshot metadata
  //         const step = snapshotLookup["profile-confirm"];
  //         if (step?.meta?.profileData) {
  //           const profileData = step.meta.profileData;
  //           console.log("✅ Using raw profileData from snapshot metadata:", profileData);
  //           
  //           // Update profile with raw data from API
  //           setProfile((prev) => ({
  //             ...prev,
  //             username: profileData.username ? `@${profileData.username}` : prev.username,
  //             name: profileData.full_name || prev.name,
  //             avatar: profileData.avatar || prev.avatar,
  //             followers: profileData.follower_count || prev.followers,
  //             following: profileData.following_count || prev.following,
  //           }));
  //
  //           // Update profile stage
  //           setProfileStage({
  //             avatar: profileData.avatar,
  //             progressPercent: 55,
  //             username: profileData.username ? `@${profileData.username}` : profile.username,
  //             greeting: `Hello, ${profileData.full_name || profileData.username}`,
  //             question: "Is this your profile?",
  //             primaryCta: "Continue, the profile is correct",
  //           });
  //           
  //           setProfileConfirmParsed(true);
  //         } else {
  //           // ✅ FALLBACK: Parse HTML if no raw data available
  //           console.log("⚠️ No raw profileData, falling back to HTML parsing");
  //           const parsed = parseProfileSnapshot(html, profile.username);
  //           if (parsed) {
  //             setProfileStage(parsed);
  //             setProfileConfirmParsed(true);
  //             // Update profile avatar from parsed HTML
  //             if (parsed.avatar) {
  //               setProfile((prev) => ({
  //                 ...prev,
  //                 avatar: parsed.avatar,
  //               }));
  //             }
  //           }
  //         }
  //       }
  //       if (stepName === "processing") {
  //         const parsed = parseProcessingSnapshot(
  //           html,
  //           profile.avatar,
  //           profile.username
  //         );
  //         if (parsed) {
  //           setProcessingStage(parsed);
  //         }
  //       }
  //     }
  //     stepHtmlFetchRef.current[stepName] = false;
  //   };
  //
  //   // Load HTML for each available snapshot (only if not already loaded)
  //   if (snapshotLookup["analyzing"]) {
  //     loadSnapshotHtml("analyzing");
  //   }
  //   if (snapshotLookup["profile-confirm"]) {
  //     loadSnapshotHtml("profile-confirm");
  //   }
  //   if (snapshotLookup["processing"]) {
  //     loadSnapshotHtml("processing");
  //   }
  // }, [snapshotLookup, profile.avatar, profile.username]);

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

    // Transition to profile-confirm when: API data received + parsing complete + analyzing complete
    if (
      screen === SCREEN.ANALYZING &&
      apiProfileData && // Changed from snapshotHtml["profile-confirm"]
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
      // Removed check: apiFollowersData.length > 0 (Allow 4s transition regardless of data)
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
    apiProfileData,
    apiFollowersData,
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
    if (!apiProfileData) return; // Wait for API data instead of snapshotHtml
    if (!profileConfirmParsed) return; // Wait until parsing is complete

    // Force analyzing to 100% immediately
    clearInterval(analyzingTimerRef.current);
    setAnalyzingProgress(100);
  }, [screen, apiProfileData, profileConfirmParsed]);

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
    }, 2500); // 2.5 second delay between each bullet

    return () => {
      if (bulletTimer) {
        clearInterval(bulletTimer);
      }
      if (finalDelayTimer) {
        clearTimeout(finalDelayTimer);
      }
    };
  }, [screen, processingStage.bullets.length]);

  // COMMENTED OUT: Analysis loader from snapshots - API-first approach uses direct data
  // useEffect(() => {
  //   const resultsStep = snapshots.find((step) => step.name === "results");
  //   if (!resultsStep) return;
  //   const url = buildSnapshotUrl(resultsStep.htmlPath);
  //   if (!url) return;
  //   let cancelled = false;
  //
  //   const loadAnalysis = async () => {
  //     try {
  //       setAnalysisLoading(true);
  //       const res = await fetch(url);
  //       if (!res.ok) throw new Error("Unable to download analyzer snapshot");
  //       const html = await res.text();
  //       if (cancelled) return;
  //       const parsed = parseResultsSnapshot(html);
  //       setAnalysis(parsed);
  //     } catch (err) {
  //       console.error("Failed to parse analyzer snapshot", err);
  //     } finally {
  //       if (!cancelled) {
  //         setAnalysisLoading(false);
  //       }
  //     }
  //   };
  //
  //   loadAnalysis();
  //   return () => {
  //     cancelled = true;
  //   };
  // }, [snapshots]);

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
      // ✅ USER REQUEST: Added 5s delay to ensure all images are pre-loaded/proxied
      const timer = setTimeout(() => {
        setIsInQueue(false); // No longer in queue, results are ready
        setScreen(SCREEN.PREVIEW);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [
    analysis,
    screen,
    canAdvanceFromProcessing,
    processingMessageIndex,
    processingStage.bullets.length,
  ]);

  // ✅ SAFE BACKGROUND PRE-LOADER: Pre-fetches images and triggers recovery silently
  useEffect(() => {
    // 🔐 GATE: Only run if we are actually viewing a report/preview
    const activeScreens = [SCREEN.PROFILE, SCREEN.PROCESSING, SCREEN.PREVIEW, SCREEN.PAYMENT_SUCCESS, SCREEN.FULL_REPORT];
    if (!activeScreens.includes(screen)) return;
    const allCards = analysis?.slider?.cards || cards || [];
    const allStories = analysis?.stories?.slides || [];
    const allAddicts = analysis?.addicted?.tiles || [];
    
    // Collect all unique usernames and their associated image URLs
    const usersToPreload = [];
    const seenUsernames = new Set();

    const processItem = (item) => {
      const u = (item.username || item.title || "").replace('@', '').trim();
      if (!u || seenUsernames.has(u)) return;
      
      // Get the best available image URL
      let imageUrl = null;
      if (freshAvatars[u]) {
        imageUrl = freshAvatars[u];
      } else if (item.image) {
        // If it's a proxy url, use it directly, otherwise proxy it
        imageUrl = item.image.includes("weserv.nl") ? item.image : proxyImage(item.image);
      }

      if (imageUrl) {
        seenUsernames.add(u);
        usersToPreload.push({ username: u, url: imageUrl });
      }
    };

    allCards.forEach(processItem);
    allStories.forEach(processItem);
    allAddicts.forEach(processItem);

    usersToPreload.forEach(({ username, url }) => {
      if (!attemptedFreshAvatars.current.has(username)) {
        const img = new Image();
        img.src = url;
        img.onerror = () => {
          if (!attemptedFreshAvatars.current.has(username)) {
             attemptedFreshAvatars.current.add(username);
             console.log(`🚀 BG Recovery: ${username}`);
             fetchProfileDataDirectly(username, true).then(url => {
               if (url) setFreshAvatars(p => ({ ...p, [username]: url }));
             }); 
          }
        };
      }
    });
  }, [analysis, cards, freshAvatars]);

  // Reset carousel indices when entering PREVIEW or PAYMENT_SUCCESS
  useEffect(() => {
    if (screen === SCREEN.PREVIEW || screen === SCREEN.PAYMENT_SUCCESS) {
      setCarouselIndex(3);
      setStoriesCarouselIndex(3);
    }
  }, [screen]);

  // ✅ MEMOIZED SLIDER CARDS: Stable across re-renders (fixes random jumping)
  const processedSliderCards = useMemo(() => {
    const allCards = analysis?.slider?.cards?.length ? analysis.slider.cards : cards;
    
    // Check if we already have a blurred/locked card
    const hasBlurredCard = allCards.some(
      (card) => card?.blurImage || (!card?.username && card?.image)
    );

    // If no blurred card exists, inject one at a random position
    let cardsToRender = [...allCards];
    
    // ✅ USER REQUEST: Inject multiple "black locked" card varieties
    const lockVarieties = [
      {
        isLocked: true,
        lockText: "@bluredus is on your profile now.",
        lockTextBlurred: false,
      },
      {
        isLocked: true,
        lockText: "@bluredus visited your profile 2 hours ago.",
        lockTextBlurred: false,
      },
      {
        isLocked: true,
        lockText: "@bluredus took a screenshot of your profile this week.",
        lockTextBlurred: false,
      },
      {
        isLocked: true,
        lockText: "@bluredus shared your profile with *********.",
        lockTextBlurred: false,
      },
      {
        isLocked: true,
        lockText: "@bluredus visited your profile yesterday.",
        lockTextBlurred: false,
      },
      {
        isLocked: true,
        lockText: "@bluredus blocked you",
        lockTextBlurred: false,
      },
    ];

    // Inject varieties at regular intervals (Increased frequency: every 4 cards)
    lockVarieties.forEach((v, i) => {
      const targetIndex = 2 + i * 4; // Positions: 2, 6, 10, 14, 18, 22
      if (cardsToRender.length >= targetIndex) {
        cardsToRender.splice(targetIndex, 0, v);
      } else {
        cardsToRender.push(v);
      }
    });

    // Filter out cards that come right after blurred cards
    return cardsToRender
      .map((card, originalIndex) => ({ card, originalIndex }))
      .filter(({ card, originalIndex }) => {
        if (card.isLocked) return true; // ✅ Never filter manual locked injections
        const isAfterBlurredCard =
          originalIndex - 1 >= 0 && (originalIndex - 1) % 5 === 0;
        return !isAfterBlurredCard;
      });
  }, [analysis?.slider?.cards, cards]);

  // Auto-scroll carousel - Infinite loop with duplicates
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;

    if (processedSliderCards.length <= 1) return;

    // Initialize carousel at offset (after duplicated items at start)
    const offset = 3;
    if (carouselIndex < offset && processedSliderCards.length > 0) {
      setCarouselIndex(offset);
    }

    const interval = setInterval(() => {
      setCarouselIndex((prev) => {
        // Allow going ONE step past the real length (into the first duplicate)
        // The useEffect below will handle the snap back
        return prev + 1;
      });
    }, 1500); // Change slide every 1.5 seconds

    return () => clearInterval(interval);
  }, [screen, cards, analysis]);

  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;
    if (processedSliderCards.length <= 1) return;

    const offset = 3;
    const totalRealItems = processedSliderCards.length;
    
    // If we've slid to the first duplicate (index = offset + totalRealItems)
    if (carouselIndex >= offset + totalRealItems) {
      const timeout = setTimeout(() => {
        carouselLoopingRef.current = true; // Disable transition
        // Snap to the real first item (which is at index 'offset')
        setCarouselIndex(offset);
        
        // Re-enable transition after a brief moment (enough for the snap render)
        setTimeout(() => {
          carouselLoopingRef.current = false;
        }, 50);
      }, 500); // Wait 500ms for the slide transition to finish (CSS is 0.4s)
      
      return () => clearTimeout(timeout);
    }
  }, [carouselIndex, screen, processedSliderCards]);

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
        // Allow going ONE step past the real length
        return prev + 1;
      });
    }, 1500); // Change slide every 1.5 seconds

    return () => clearInterval(interval);
  }, [screen, analysis]);

  // Handle Stories Carousel Snap Back
  useEffect(() => {
    if (screen !== SCREEN.PREVIEW) return;
    const storiesSlides = analysis?.stories?.slides || [];
    if (storiesSlides.length <= 1) return;
    
    const offset = 3;
    const totalRealItems = storiesSlides.length;

    if (storiesCarouselIndex >= offset + totalRealItems) {
      const timeout = setTimeout(() => {
        storiesCarouselLoopingRef.current = true;
        setStoriesCarouselIndex(offset);
        setTimeout(() => {
           storiesCarouselLoopingRef.current = false;
        }, 50);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [storiesCarouselIndex, screen, analysis]);

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



  const handleStart = async (value) => {
    const formatted = value.startsWith("@") ? value : `@${value}`;
    setProfile((prev) => ({
      ...prev,
      username: formatted,
      name: formatted.replace("@", "") || prev.name,
    }));
    setUsernameInput("");
    setErrorMessage("");
    // COMMENTED OUT: snapshot-related state resets
    // setSnapshots([]);
    setCards([]);
    setNotifications([]);
    setToasts([]);
    Object.values(toastTimers.current).forEach(clearTimeout);
    toastTimers.current = {};
    setAnalysis(null);
    setAnalysisLoading(false);
    // setSnapshotHtml({
    //   analyzing: null,
    //   "profile-confirm": null,
    //   processing: null,
    // });
    const friendlyName = formatted.replace("@", "") || profile.name || "friend";
    setProfileStage(
      createProfileStageData(formatted, profile.avatar, friendlyName)
    );
    setProcessingStage(createProcessingStageData(formatted, profile.avatar, geoData?.city));
    setCanAdvanceFromProfile(false);
    setCanAdvanceFromProcessing(false);
    clearTimeout(profileHoldTimerRef.current);
    clearTimeout(processingHoldTimerRef.current);
    clearInterval(analyzingTimerRef.current);
    analyzingStartRef.current = Date.now();
    stepHtmlFetchRef.current = {};
    setProfileConfirmParsed(false); // Reset flag for new request
    attemptedFreshAvatars.current.clear(); // Clear image recovery record
    setAnalyzingProgress(0);
    setProcessingMessageIndex(0);
    setIsInQueue(true); // User is now in queue

    activeRequestRef.current += 1;
    const requestId = activeRequestRef.current;


    // Set analyzing screen immediately - don't wait for fetchCards
    setScreen(SCREEN.ANALYZING);

    // ✅ NEW: Fetch profile data directly from API (for immediate avatar display)
    fetchProfileDataDirectly(formatted).catch((err) => {
      console.error("Failed to fetch profile data directly:", err);
      // Don't block the flow - snapshots will still work as fallback
    });

    // Track Lead event when username is submitted - DISABLED
    // trackMetaPixel("Lead", {
    //   content_name: "Username Submitted",
    //   content_category: "User Input",
    // });

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

  // ✅ NEW: Fetch profile data directly from API (bypasses snapshots)
  // If silent = true, it just returns the avatar URL without updating the main profile state
  const fetchProfileDataDirectly = async (username, silent = false) => {
    try {
      console.log(`🔥 Fetching profile data directly from API for: ${username}`);
      const rawUsername = username.replace(/^@/, "").trim();
      
      const response = await fetch("https://server.oraculoproibido.com/verify-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: rawUsername }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const profileData = await response.json();
      console.log("✅ Got profile data from API:", profileData);

      // Extract avatar URL (try HD first, then regular, then base64)
      let avatar = null;
      if (profileData.hd_profile_pic_url_info?.url) {
        avatar = profileData.hd_profile_pic_url_info.url;
      } else if (profileData.profile_pic_url) {
        avatar = profileData.profile_pic_url;
      } else if (profileData.base64_profile_pic) {
        avatar = `data:image/jpeg;base64,${profileData.base64_profile_pic}`;
      }

      // ✅ Safety: Decode HTML entities in case API returns escaped URLs
      if (avatar) {
        avatar = proxyImage(avatar);
      }

      console.log("✅ Extracted avatar URL:", avatar);
      
      if (silent) return avatar;

      // Update profile state immediately
      setProfile((prev) => ({
        ...prev,
        username: `@${profileData.username.replace(/^@/, '')}`,
        name: profileData.full_name || profileData.username,
        avatar: avatar || prev.avatar,
        followers: profileData.follower_count || prev.followers,
        following: profileData.following_count || prev.following,
      }));

      // Update profile stage for confirmation screen
      setProfileStage({
        avatar: avatar,
        progressPercent: 55,
        username: `@${profileData.username.replace(/^@/, '')}`,
        greeting: `Hello, ${profileData.full_name || profileData.username}`,
        question: "Is this your profile?",
        primaryCta: "Continue, the profile is correct",
        secondaryCta: "No, I want to correct it",
      });

      setProfileConfirmParsed(true);

      return profileData;
    } catch (error) {
      console.error("❌ Failed to fetch profile data directly:", error);
      return null;
    }
  };

  const fetchCards = async (usernameValue) => {
    // ============================================================================
    // API-FIRST: SSE uses NAMED events from backend:
    //   event: snapshot  → {name, data: {profileData/cards/...}, capturedAt}
    //   event: done      → {cards, steps, profileData, ...}
    //   event: error     → {error: "message"}
    // IMPORTANT: Must use addEventListener (not onmessage) for named events!
    // ============================================================================
    return new Promise((resolve, reject) => {
      const eventSourceUrl = `${API_URL}?username=${encodeURIComponent(
        usernameValue
      )}&stream=true`;
      console.log(`🔌 Connecting to SSE: ${eventSourceUrl}`);

      const eventSource = new EventSource(eventSourceUrl);

      eventSource.onopen = () => {
        console.log(`✅ SSE connection opened`);
      };

      // ✅ Handle named "snapshot" events from backend
      eventSource.addEventListener("snapshot", (e) => {
        try {
          const step = JSON.parse(e.data);
          console.log(`📡 SSE snapshot: ${step.name}`, step);

          // Profile confirmation — step.data.profileData contains the profile info
          if (step.name === "profile-confirm" && step.data?.profileData) {
            const profileData = step.data.profileData;
            console.log("👤 Profile data received:", profileData);

            setApiProfileData(profileData);
            apiProfileDataRef.current = profileData;

            const avatar = getAvatarFromApiData(profileData);
            setProfile((prev) => ({
              ...prev,
              username: profileData.username ? `@${profileData.username.replace(/^@/, '')}` : prev.username,
              name: profileData.full_name || prev.name,
              avatar: avatar || prev.avatar,
              followers: profileData.follower_count || prev.followers,
              following: profileData.following_count || prev.following,
            }));

            setProfileStage({
              avatar: avatar,
              progressPercent: 55,
              username: profileData.username ? `@${profileData.username.replace(/^@/, '')}` : profile.username,
              greeting: `Hello, ${profileData.full_name || profileData.username}`,
              question: "Is this your profile?",
              primaryCta: "Continue, the profile is correct",
              secondaryCta: "No, I want to correct it",
            });

            setProfileConfirmParsed(true);
          }

          // Processing — step.data.profileData contains profile info for bullets
          if (step.name === "processing" && step.data?.profileData) {
            const profileData = step.data.profileData;
            const avatar = getAvatarFromApiData(profileData);
            setProcessingStage(
              createProcessingStageData(
                profileData.username
                  ? `@${profileData.username.replace(/^@/, '')}`
                  : profile.username,
                avatar,
                geoData?.city
              )
            );
          }

          // Results — step.data contains {cards, followersList}
          if (step.name === "results" && step.data?.cards) {
            console.log(`✅ Results received: ${step.data.cards.length} cards`);
            const cardsData = step.data.cards;
            const followersList = step.data.followersList || [];

            setApiFollowersData(followersList);
            setCards(cardsData);

            // ✅ CRITICAL: Populate analysis to unblock transition to PREVIEW
            setAnalysis(createAnalysisFromApiData(
              apiProfileDataRef.current,
              followersList,
              profileRef.current
            ));
            setAnalysisLoading(false);
          }
        } catch (err) {
          console.error("❌ Error processing snapshot event:", err);
          console.error("   Raw data:", e.data);
        }
      });

      // ✅ Handle named "done" event from backend
      eventSource.addEventListener("done", (e) => {
        try {
          const finalResult = JSON.parse(e.data);
          console.log(
            `✅ Scrape completed - received ${finalResult.cards?.length || 0} cards`
          );

          // Set cards from final result
          if (finalResult.cards && Array.isArray(finalResult.cards)) {
            setCards(finalResult.cards);
          }

          // Store profile data if available
          if (finalResult.profileData) {
            setApiProfileData(finalResult.profileData);
            apiProfileDataRef.current = finalResult.profileData;
          }

          // Ensure analysis is populated (may already be set from "results" event)
          if (!analysis) {
            setAnalysis(createAnalysisFromApiData(
              apiProfileDataRef.current,
              finalResult.cards || [],
              profileRef.current
            ));
          }
          setAnalysisLoading(false);

          // Persist last successful scrape for payment-return flow
          try {
            localStorage.setItem("lastScrapeRun", JSON.stringify({
              cards: finalResult.cards || [],
              profileData: finalResult.profileData || apiProfileDataRef.current,
              profile: profileRef.current,
              savedAt: Date.now(),
            }));
          } catch (e) { /* localStorage quota exceeded or unavailable */ }


          eventSource.close();
          resolve(finalResult);
        } catch (err) {
          console.error("Error parsing final result:", err);
          eventSource.close();
          reject(err);
        }
      });

      // ✅ Handle named "error" event from backend
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

      // Handle connection-level errors
      eventSource.onerror = (err) => {
        console.error("❌ EventSource connection error:", err);
        console.error(
          `   ReadyState: ${eventSource.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`
        );
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
    setFullReportLoading(true);
    setScreen(SCREEN.FULL_REPORT);
    setPaymentCountdown(900); // Reset to 15 minutes when entering full report

    try {
      // API-FIRST: If we have apiProfileData, we might use that instead of HTML
      if (apiProfileData) {
        console.log("✅ Using apiProfileData for full report");
        // For now, if we don't have the full report parsing logic ported to JSON,
        // we just show the state we have.
      }
    } catch (err) {
      console.error("Failed to transition to full report:", err);
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
        <div className="queue-message">{QUEUE_MESSAGE}</div>
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
          <a
            href="https://samjhona.com/aboutus.html"
            target="_blank"
            rel="noreferrer"
          >
            About Us
          </a>
          <a
            href="https://samjhona.com/contact.html"
            target="_blank"
            rel="noreferrer"
          >
            Contact Us
          </a>
          <a
            href="https://samjhona.com/pricing.html"
            target="_blank"
            rel="noreferrer"
          >
            Pricing
          </a>
          <a
            href="https://samjhona.com/terms-and-conditions.html"
            target="_blank"
            rel="noreferrer"
          >
            Terms &amp; Conditions
          </a>
          <a
            href="https://samjhona.com/privacy-policy.html"
            target="_blank"
            rel="noreferrer"
          >
            Privacy Policy
          </a>
          <a
            href="https://samjhona.com/shipping.html"
            target="_blank"
            rel="noreferrer"
          >
            Shipping Policy
          </a>
          <a
            href="https://samjhona.com/refund.html"
            target="_blank"
            rel="noreferrer"
          >
            Refund Policy
          </a>
          <a
            href="https://samjhona.com/cancellation.html"
            target="_blank"
            rel="noreferrer"
          >
            Cancellation Policy
          </a>
          {/* <a
            href="https://samjhona.com/return.html"
            target="_blank"
            rel="noreferrer"
          >
            Return Policy
          </a> */}
        </div>
      </div>
    </section>
  );

  const renderAnalyzing = () => (
    <section className="screen snapshot-stage">
      {shouldShowQueueMessage() && (
        <div className="queue-message">{QUEUE_MESSAGE}</div>
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
          <div className="queue-message">You are in the queue</div>
        )}
        <div className="stage-card profile-card profile-card--dynamic">
          <div className="stage-progress-track subtle">
            <div
              className="stage-progress-fill"
              style={{ width: `${profileStage.progressPercent}%` }}
            />
          </div>
          <div className="profile-avatar-ring">
            <img
              src={profileStage.avatar}
              alt={profileStage.username}
              referrerPolicy="no-referrer"
            />
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

  const renderProcessing = () => {
    // Helper to bold text wrapped in **
    const parseBold = (text) => {
      if (!text) return text;
      const parts = text.split(/(\*\*.*?\*\*)/g);
      return parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-bold text-gray-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      );
    };

    return (
      <section className="screen snapshot-stage">
        {shouldShowQueueMessage() && (
          <div className="queue-message">{QUEUE_MESSAGE}</div>
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
                referrerPolicy="no-referrer"
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
                key={`${index}`}
                className={index <= processingMessageIndex ? "visible" : ""}
              >
                <div className="processing-list-item-content">
                  {/* <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="processing-check-icon"
                    aria-hidden="true"
                    style={{ minWidth: "15px", marginTop: "4px" }}
                  >
                    <path d="M21.801 10A10 10 0 1 1 17 3.335"></path>
                    <path d="m9 11 3 3L22 4"></path>
                  </svg> */}
                  <p><svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="processing-check-icon"
                    aria-hidden="true"
                    style={{ minWidth: "15px", marginTop: "4px" }}
                  >
                    <path d="M21.801 10A10 10 0 1 1 17 3.335"></path>
                    <path d="m9 11 3 3L22 4"></path>
                  </svg> {parseBold(message)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  };

  // Helper function to format addicted title with red "addicted" word
  const formatAddictedTitle = (title) => {
    if (!title) return null;
    const parts = title.split(/(addicted)/i);
    return parts.map((part, index) => {
      if (part.toLowerCase() === "addicted") {
        return (
          <span key={index} className="addicted-red">
            {part}
          </span>
        );
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
          <section className="hero-panel" style={{marginBottom: "50px"}}>
            <div className="hero-top">
              <div className="hero-avatar">
                <img
                  src={freshAvatars[profile.username?.replace('@', '').trim()] || hero.profileImage || profile.avatar}
                  onError={() => {
                    const u = profile.username?.replace('@', '').trim();
                    if (u && !attemptedFreshAvatars.current.has(u)) {
                      attemptedFreshAvatars.current.add(u);
                      fetchProfileDataDirectly(u, true).then(url => {
                        if (url) setFreshAvatars(p => ({ ...p, [u]: url }));
                      });
                    }
                  }}
                  alt={hero.name || profile.name}
                  referrerPolicy="no-referrer"
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
                  <strong>8 people&nbsp;</strong>visited
                  your profile this week
                </small>
              </div>
            )}
          </section>

          <section className="preview-header" style={{marginBottom: "50px"}}>
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
              <div className="week-range">{formatWeekRange()}</div>
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

          <section className="slider-section" style={{marginBottom: "40px"}}>
            <h3 style={{fontSize: "1.5rem", marginBottom: "25px", lineHeight: "1.4"}}>
              Visited your profile this week{" "}
              <span style={{ color: "#f43f3f" }}>between 2 to 7 times:</span>
            </h3>
            {(() => {
              if (processedSliderCards.length === 0) return null;

              // Create duplicated array for infinite loop
              // Last 3 items at start + all processed items + first 3 items at end
              const offset = 3;
              const duplicatedCards = [
                ...processedSliderCards.slice(-offset).map((item, idx) => ({
                  ...item,
                  duplicateKey: `start-${idx}`,
                })),
                ...processedSliderCards.map((item, idx) => ({
                  ...item,
                  duplicateKey: `original-${idx}`,
                })),
                ...processedSliderCards.slice(0, offset).map((item, idx) => ({
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
                          ? "none"
                          : "transform 0.4s ease-in-out",
                      }}
                    >
                      {duplicatedCards.map(
                        ({ card, originalIndex, duplicateKey }, index) => {
                          const isActive = index === displayIndex;
                          const usernameForFresh = (card.username || "").replace('@', '').trim();
                          // ✅ Proxy Instagram images via weserv.nl
                          let imageUrl = freshAvatars[usernameForFresh] || (card.image ? proxyImage(card.image) : (hero.profileImage || profile.avatar));

                          const isLocked = Boolean(
                            card?.isLocked || card?.title?.includes("🔒")
                          );
                          const shouldBlurImage = Boolean(
                            card?.blurImage || (!card?.username && imageUrl)
                          );

                          // Check if original position is a multiple of 5 starting from 5 (5, 10, 15, 20, etc.)
                          // If yes, render as blurred card with lock icon (no username, grey blur, lock in middle)
                          // But DON'T clobber cards that are explicitly marked as isLocked (Type 3)
                          const isMultipleOf5 =
                            originalIndex > 0 && originalIndex % 5 === 0 && !isLocked;

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
                                  style={{ position: "relative", overflow: "hidden" }}
                                >
                                  <img
                                    src={imageUrl}
                                    alt="Blurred user"
                                    referrerPolicy="no-referrer"
                                    loading="eager"
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      filter: "blur(5px)", // Re-apply blur since class might relay on bg
                                      transform: "scale(1.1)" // Prevent blur edges
                                    }}
                                  />
                                </div>
                                <div className="blurred-lock">
                                  <span role="img" aria-label="locked">
                                    🔒
                                  </span>
                                </div>
                              </article>
                            );
                          }

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
                                  style={{ position: "relative", overflow: "hidden" }}
                                >
                                  <img
                                    src={imageUrl}
                                    alt="Blurred user"
                                    referrerPolicy="no-referrer"
                                    loading="eager"
                                    onError={(e) => {
                                      if (usernameForFresh && !attemptedFreshAvatars.current.has(usernameForFresh)) {
                                        attemptedFreshAvatars.current.add(usernameForFresh);
                                        fetchProfileDataDirectly(usernameForFresh, true).then(url => {
                                          if (url) {
                                            setFreshAvatars(prev => ({ ...prev, [usernameForFresh]: url }));
                                          }
                                        });
                                      }
                                    }}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      filter: "blur(5px)",
                                      transform: "scale(1.1)"
                                    }}
                                  />
                                </div>
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
                                  width: "100%",
                                  height: "250px",
                                  position: "relative",
                                  overflow: "hidden",
                                  backgroundColor: imageUrl ? "transparent" : "#f5f5f5",
                                }}
                              >
                                {imageUrl && (
                                  <img
                                    src={imageUrl}
                                    alt={card.username || "Card image"}
                                    referrerPolicy="no-referrer"
                                    loading="eager"
                                    onError={(e) => {
                                      if (usernameForFresh && !attemptedFreshAvatars.current.has(usernameForFresh)) {
                                        attemptedFreshAvatars.current.add(usernameForFresh);
                                        console.log(`📸 Recovery attempt for: ${usernameForFresh}`);
                                        fetchProfileDataDirectly(usernameForFresh, true).then(url => {
                                          if (url) {
                                            setFreshAvatars(prev => ({ ...prev, [usernameForFresh]: url }));
                                          }
                                        });
                                      }
                                    }}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      display: "block"
                                    }}
                                  />
                                )}
                              </div>
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
                        }
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {revealStalkersCta && (
            <div className="cta-inline">
              <button className="primary-btn primary-btn--large" onClick={scrollToFullReport}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-2 inline-block"
                  style={{ verticalAlign: 'middle', marginRight: '8px' }}
                >
                  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                Reveal Stalker
              </button>
            </div>
          )}

          {stories?.slides?.length > 0 && (
            <section className="stories-section" style={{marginBottom: "50px"}}>
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
                            ? "none"
                            : "transform 0.4s ease-in-out",
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
                                  position: "relative",
                                  overflow: "hidden",
                                  backgroundColor: story.image ? "transparent" : "#000"
                                }}
                              >
                                {story.image && (
                                  <img
                                    src={proxyImage(story.image)}
                                    alt="Story"
                                    referrerPolicy="no-referrer"
                                    loading="eager"
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      display: "block",
                                      position: "absolute",
                                      top: 0,
                                      left: 0,
                                      zIndex: 0
                                    }}
                                  />
                                )}
                                <div className="story-hero-info">
                                  <img
                                    src={proxyImage(hero.profileImage || profile.avatar)}
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
            <article className="chat-interface-card" style={{marginBottom: "40px"}}>
                <div className="chat-header-img-container">
                  <img src={printMessageBg} alt="Chat Header" className="chat-header-img" />
                </div>

                <div className="chat-body-content">
                  <img
                    src={printMessageBg}
                    alt="Blurred Content"
                    className="chat-blurred-bg"
                  />
                  <div className="chat-bubble left">
                      <span className="blur-text-sm">██████████████████</span>
                  </div>
                  <div className="chat-bubble left">
                      {profile.name?.split(" ")[0]} is
                      <span className="blur-text-sm" style={{ marginLeft: "4px" }}>████</span>
                  </div>
                  <div className="chat-bubble left with-avatar">
                      <div className="bubble-avatar">
                        <img src={profileNewPng} alt="Bubble Avatar" />
                      </div>
                      you know who it is
                  </div>
                </div>


              </article>
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
            <section className="addicted-panel" style={{marginBottom: "50px"}}>
              <h3>{formatAddictedTitle(addicted.title)}</h3>
              <div className="addicted-grid">
                {addicted.tiles.map((tile, index) => {
                  return (
                    <article key={`${tile.body || index}-${index}`}>
                      <div className="addicted-lock">🔒</div>
                      <div className="addicted-blur-name">
                        <span className="blurred-text addicted-username-small">
                          @{(tile.title || "").replace("@", "")}
                        </span>
                      </div>
                    <p
                      dangerouslySetInnerHTML={{
                        __html: tile.body,
                      }}
                    />
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {(addicted.footer || addicted.subfooter || ctas.tertiary) && (
            <section id="full-report-section" className="cta-block final">
              {addicted.footer && (
                <p className="cta-banner">{addicted.footer}</p>
              )}
                <div className="cta-button-container" style={{ textAlign: "center", width: "100%" }}>
                  <button
                    className="primary-btn cta-eye-btn"
                    onClick={handleViewFullReport}
                    style={{ width: "100%", maxWidth: "400px" }}
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
                      className="lucide lucide-eye mr-[10px]"
                      aria-hidden="true"
                    >
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    {ctas.tertiary}
                  </button>
                  <p style={{ 
                    color: "#f43f3f", 
                    fontSize: "1rem", 
                    marginTop: "12px", 
                    fontWeight: "700",
                    
                  }}>
                    Available for a limited time
                  </p>
                </div>
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
      // In API-first flow, fullReportData/fullReportHtml are not populated,
      // but we still show the hardcoded "Unlock Complete Report" screen below.
      // Only bail out if there's genuinely no profile info at all.
    }

    // Extract avatar from parsed data or use profile avatar
    const profileAvatar = fullReportData?.avatar 
      || analysis?.hero?.profileImage 
      || profile.avatar;


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
          eventID: eventID
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

  // Paytm: no script or key needed — redirect to Paytm payment page via form POST

  // COMMENTED OUT: Cashfree SDK loading
  // useEffect(() => { fetchCashfreeEnv(); }, []);

  // COMMENTED OUT: Cashfree payment return URL handler (Razorpay uses modal, no redirect)
  // useEffect(() => { /* Cashfree return URL verification */ }, []);

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // COMMENTED OUT: Cashfree waitForCashfree helper
  // const waitForCashfree = () => new Promise(...);

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setPaymentLoading(true);

    try {
      const restored = loadLastRun();
      const cardsToCheck =
        (Array.isArray(cards) && cards.length > 0 ? cards : null) ||
        (Array.isArray(restored?.cards) && restored.cards.length > 0
          ? restored.cards
          : []);

      if (!Array.isArray(cardsToCheck) || cardsToCheck.length === 0) {
        throw new Error(
          "Report data is not ready yet. Please wait for the report to finish loading, then try again."
        );
      }

      const amount = 99 * quantity;
      const rawUsername = profile?.username || profileRef.current?.username || (usernameInput ? `@${String(usernameInput).replace(/^@/, "")}` : "");
      const usernameToSend = rawUsername ? (rawUsername.startsWith("@") ? rawUsername : `@${rawUsername}`) : null;
      // IMPORTANT: Do NOT send cards/profile in payment-init calls.
      // They are large and can trigger 413 (nginx) and aren't required for gateway initiation.

      // SENSORAHUB (commented for later use): use Instamojo when domain is sensorahub.com
      // const hostname = typeof window !== "undefined" && window.location?.hostname
      //   ? window.location.hostname.toLowerCase() : "";
      // const useInstamojo = hostname === "sensorahub.com" || hostname.endsWith(".sensorahub.com");
      // if (useInstamojo) { ... instamojo create + redirect ... return; }

      // Primary: Paytm (fallback to Instamojo is done on backend when Paytm fails)
      const orderResponse = await fetch(`/api/payment/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          email: paymentForm.email,
          fullName: paymentForm.fullName || paymentForm.email,
          phoneNumber: paymentForm.phoneNumber || "",
        }),
      }).catch((fetchErr) => {
        console.error("Network error creating order:", fetchErr);
        throw new Error(
          "Cannot connect to payment server. Please check if backend is running."
        );
      });

      if (!orderResponse.ok) {
        const errorData = await orderResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("Paytm order error:", errorData);
        throw new Error(
          errorData.error ||
            errorData.message ||
            "Failed to create payment order"
        );
      }

      const data = await orderResponse.json();
      // Backend may return Instamojo redirectUrl when Paytm fails (fallback).
      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      const { orderId, txnToken, mid, paytmPaymentUrl } = data;

      if (!orderId || !txnToken || !mid || !paytmPaymentUrl) {
        throw new Error("Invalid response from payment server");
      }

      try {
        const pendingData = {
          id: orderId,
          value: amount,
          currency: "INR",
          ts: Date.now(),
        };
        window.localStorage.setItem(
          "instaStalker_pending_purchase",
          JSON.stringify(pendingData)
        );
      } catch (err) {
        console.warn("Failed to store pending purchase:", err);
      }

      // Redirect to Paytm showPaymentPage with txnToken
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `${paytmPaymentUrl}?mid=${encodeURIComponent(
        mid
      )}&orderId=${encodeURIComponent(orderId)}`;
      form.style.display = "none";
      [
        { name: "mid", value: mid },
        { name: "orderId", value: orderId },
        { name: "txnToken", value: txnToken },
      ].forEach(({ name, value }) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      console.error("Paytm error:", err);
      alert(err.message || "Failed to process payment. Please try again.");
      setPaymentLoading(false);
    }
  };

  // COMMENTED OUT: handlePlaceOrder (replaced by handlePaymentSubmit)
  // const handlePlaceOrder...

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
                {/* Only ask for email. Pressing Enter should place the order. */}
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
                <p>
                  Your report expires in &nbsp;
                  {formatCountdown(paymentCountdown)}
                </p>
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
                  <div className="order-item-icon">
                    <img
                      src={instaLogo}
                      alt="Instagram"
                      height="80px"
                      width="70px"
                    />
                  </div>
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
                      By continuing, you acknowledge our Service Disclaimer,
                      Acceptable Use, and Data &amp; Privacy Statement.
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
                      <p>
                        This website provides digital, entertainment-based
                        informational services related to social media
                        engagement insights.
                      </p>
                      <p>
                        All information and reports generated are strictly based
                        on publicly available data and user-provided inputs.
                      </p>
                      <p>
                        We do not access private accounts, do not require login
                        credentials, and do not retrieve or store any personal
                        or confidential information.
                      </p>
                      <p>
                        This service is intended solely for entertainment and
                        informational purposes and should not be interpreted as
                        factual tracking, surveillance, or monitoring of any
                        individual.
                      </p>

                      <h4>Acceptable Use</h4>
                      <p>By using this service, you confirm that:</p>
                      <ul>
                        <li>
                          You are requesting insights only for lawful and
                          ethical purposes
                        </li>
                        <li>
                          You understand that the service does not guarantee
                          accuracy or real-time activity
                        </li>
                        <li>
                          You agree that this service does not invade privacy or
                          bypass platform restrictions
                        </li>
                        <li>
                          Any misuse or misinterpretation of the information
                          provided is solely the responsibility of the user.
                        </li>
                      </ul>

                      <h4>Data &amp; Privacy Statement</h4>
                      <p>We do not collect, store, or process:</p>
                      <ul>
                        <li>Private social media data</li>
                        <li>Login credentials</li>
                        <li>Passwords or authentication details</li>
                      </ul>
                      <p>
                        All outputs are generated using publicly accessible
                        information and automated analysis for entertainment use
                        only.
                      </p>
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
      <section
        className="screen contact-us-screen"
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          padding: "40px 20px",
          background: "#fff",
        }}
      >
        <div style={{ marginBottom: "30px" }}>
          <button
            onClick={() => setScreen(SCREEN.PAYMENT)}
            style={{
              background: "none",
              border: "none",
              color: "#f43f3f",
              cursor: "pointer",
              fontSize: "16px",
              marginBottom: "20px",
              textDecoration: "underline",
            }}
          >
            ← Back to Payment
          </button>
          <h1
            style={{
              fontSize: "32px",
              fontWeight: "700",
              marginBottom: "10px",
              color: "#1a1a1a",
            }}
          >
            Contact Us
          </h1>
          <p style={{ fontSize: "16px", color: "#666", marginBottom: "30px" }}>
            Get in touch with us for any queries or support
          </p>
        </div>

        {/* Business Information */}
        <div
          style={{
            background: "#f9f9f9",
            padding: "30px",
            borderRadius: "12px",
            marginBottom: "30px",
          }}
        >
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "700",
              marginBottom: "20px",
              color: "#1a1a1a",
            }}
          >
            Contact Information
          </h2>

          <div style={{ marginBottom: "20px" }}>
            <div
              style={{ fontWeight: "600", marginBottom: "8px", color: "#333" }}
            >
              Email:
            </div>
            <div style={{ color: "#666", fontSize: "16px" }}>
              <a
                href="mailto:robertpranav369@gmail.com"
                style={{ color: "#f43f3f", textDecoration: "none" }}
              >
                robertpranav369@gmail.com
              </a>
            </div>
          </div>
        </div>

        {/* Terms and Conditions */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            padding: "30px",
            borderRadius: "12px",
            marginBottom: "30px",
          }}
        >
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "700",
              marginBottom: "20px",
              color: "#1a1a1a",
            }}
          >
            Terms & Conditions
          </h2>

          <div style={{ fontSize: "14px", color: "#666", lineHeight: "1.8" }}>
            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                1. Service Description
              </h3>
              <p>
                Our service provides Instagram profile analysis and visitor
                insights. By using our service, you agree to these terms and
                conditions.
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                2. Payment Terms
              </h3>
              <p>
                All payments are processed securely through Paytm payment
                gateway. Payment is required before accessing the full report.
                All prices are in Indian Rupees (INR).
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                3. Refund Policy
              </h3>
              <p>
                We offer a 14-day money-back guarantee. If you're not satisfied
                with our service within 14 days of purchase, contact us for a
                full refund - no questions asked.
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                4. Privacy Policy
              </h3>
              <p>
                We respect your privacy. All personal information provided
                during payment is securely stored and used only for processing
                your order and providing customer support.
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                5. Service Availability
              </h3>
              <p>
                Our service availability depends on Instagram's API and website
                structure. We strive to maintain 99% uptime but cannot guarantee
                uninterrupted service.
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                6. Limitation of Liability
              </h3>
              <p>
                Our service is provided "as is" without warranties. We are not
                liable for any indirect, incidental, or consequential damages
                arising from the use of our service.
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                7. Contact Information
              </h3>
              <p>
                For any queries, complaints, or support, please contact us at:
                <br />
                Email:{" "}
                <a
                  href="mailto:robertpranav369@gmail.com"
                  style={{ color: "#f43f3f" }}
                >
                  robertpranav369@gmail.com
                </a>
                <br />
                Address: #22-8-73/1/125, New Shoe Market, Yousuf Bazar, Chatta
                Bazaar, Hyderabad, Telangana - 500002
              </p>
            </div>

            <div
              style={{
                marginTop: "30px",
                paddingTop: "20px",
                borderTop: "1px solid #e0e0e0",
                fontSize: "12px",
                color: "#999",
              }}
            >
              Last updated: December 5, 2024
            </div>
          </div>
        </div>

        {/* Refund & Cancellation Policy */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e0e0e0",
            padding: "30px",
            borderRadius: "12px",
            marginBottom: "30px",
          }}
        >
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "700",
              marginBottom: "20px",
              color: "#1a1a1a",
            }}
          >
            Refunds & Cancellations
          </h2>

          <div style={{ fontSize: "14px", color: "#666", lineHeight: "1.8" }}>
            <div style={{ marginBottom: "15px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                Refund Policy
              </h3>
              <p>
                We offer a 14-day money-back guarantee on all purchases. If
                you're not satisfied with our service for any reason, contact us
                within 14 days of your purchase date for a full refund.
              </p>
            </div>

            <div style={{ marginBottom: "15px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                Cancellation Policy
              </h3>
              <p>
                You may cancel your order before payment is processed. Once
                payment is completed, you can request a refund within 14 days as
                per our refund policy.
              </p>
            </div>

            <div style={{ marginBottom: "15px" }}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "10px",
                  color: "#333",
                }}
              >
                Processing Time
              </h3>
              <p>
                Refunds will be processed within 5-7 business days to your
                original payment method after approval.
              </p>
            </div>
          </div>
        </div>

        {/* Contact Form */}
        <div
          style={{
            background: "#f9f9f9",
            padding: "30px",
            borderRadius: "12px",
          }}
        >
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "700",
              marginBottom: "20px",
              color: "#1a1a1a",
            }}
          >
            Send us a Message
          </h2>
          <p style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}>
            Have a question or need support? Send us an email at{" "}
            <a
              href="mailto:robertpranav369@gmail.com"
              style={{ color: "#f43f3f", fontWeight: "600" }}
            >
              robertpranav369@gmail.com
            </a>
          </p>
          <p style={{ fontSize: "14px", color: "#666" }}>
            We typically respond within 24-48 hours during business days.
          </p>
        </div>
      </section>
    );
  };

  // Fetch results.html and extract cards when on payment success page
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    // If we have a stored report (post-purchase link), do not override it
    if (hasStoredReport) return;

    const fetchResultsCards = async () => {
      try {
        console.log("API-first mode: using cards from state");
        
        // Helper function for carousel (strict criteria)
        const getCardsWithCriteria = (
          cardList,
          requireImage = true,
          requireNotBlurred = true
        ) => {
          return (cardList || []).filter((card) => {
            if (card?.isLocked || !card?.username) return false;
            if (requireImage && !card?.image) return false;
            if (requireNotBlurred && card?.blurImage) return false;
            return true;
          });
        };

        // Carousel: strict criteria (clean profiles only)
        const carouselCards = getCardsWithCriteria(cards, true, true);
        setPaymentSuccessCards(carouselCards.slice(0, 6));

        // In API-first mode, we don't have separate additional usernames from results.html yet
        setPaymentSuccessAdditionalUsernames([]);
      } catch (err) {
        console.error("Error processing results cards:", err);
      }
    };
    
    fetchResultsCards();
  }, [screen, cards, hasStoredReport]);  // Removed snapshots dependency

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
    if (screen !== SCREEN.PAYMENT_SUCCESS || paymentSuccessCards.length === 0)
      return;

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
    if (hasStoredReport) return;

    const visits = randBetween(1, 5);
    let screenshots = randBetween(1, 5);
    if (screenshots === visits) {
      // Ensure screenshots count is different from visits
      screenshots = screenshots % 5 || 5;
      if (screenshots === visits) {
        screenshots = (screenshots + 1) % 5 || 5;
      }
    }

    setPaymentSuccessLast7Summary({
      profileVisits: visits,
      screenshots,
    });
  }, [screen, hasStoredReport]);

  // Initialize 90-day profile visits stat on payment success (30–45, stable)
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    if (hasStoredReport) return;
    if (paymentSuccess90DayVisits === null) {
      setPaymentSuccess90DayVisits(randBetween(30, 45));
    }
  }, [screen, paymentSuccess90DayVisits, hasStoredReport]);

  // Build 10-profile list for payment success with highlight rules
  useEffect(() => {
    if (screen !== SCREEN.PAYMENT_SUCCESS) return;
    if (hasStoredReport) return;

    // Prefer clean payment-success cards, fallback to generic cards list
    // Include carousel data in the source pool for more profiles
    const sourceCards = [
      ...(paymentSuccessCards.length ? paymentSuccessCards : cards),
      ...apiFollowersData
    ].filter((card) => !card?.isLocked && card?.username);

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

    const TOTAL_ROWS = 10;
    const selected = shuffled.slice(0, Math.min(TOTAL_ROWS, shuffled.length));

    // Fallback: if fewer than 10, backfill from all cards (skip duplicates)
    let fallbackIndex = 0;
    while (
      selected.length < TOTAL_ROWS &&
      cards.length > 0 &&
      fallbackIndex < cards.length * 2
    ) {
      const fallbackCard = cards[fallbackIndex % cards.length];
      fallbackIndex += 1;
      const username = (fallbackCard?.username || "").trim();
      if (!username) continue;
      if (selected.some((c) => (c.username || "").trim() === username))
        continue;
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

    // Higher frequency and randomized counts (1-3)
    const screenshotIndices = new Set();
    while (screenshotIndices.size < 4 && rowCount > 0) {
      screenshotIndices.add(randBetween(0, Math.min(9, rowCount - 1)));
    }

    const rows = selected.slice(0, TOTAL_ROWS).map((card, index) => {
      const username = card.username || "";
      const name =
        (card.title || card.name || "").trim() ||
        username.replace(/^@/, "") ||
        "Instagram user";
      // ✅ Decode HTML entities in case old snapshots have &amp;
      let image = card.image || card.avatar || null;
      if (image) {
        image = image.replace(/&amp;/g, "&");
      }

      let visits = 0;
      let screenshots = 0;
      let visitsHighlighted = false;
      let screenshotsHighlighted = false;

      // Higher frequency visits (random 1-3 for first 5 rows)
      if (index < 5) {
        visits = randBetween(1, 3);
        visitsHighlighted = true;
      }

      // Higher frequency screenshots (random 1-3 for selected indices)
      if (screenshotIndices.has(index)) {
        screenshots = randBetween(1, 3);
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
            .slice(0, 10);

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
      "This user took screenshot of your profile",
      "This user visited your profile and stories multiple times",
      "This user searched for your username manually",
      "This user bookmarked one of your recent posts",
      "This user mentions you frequently in private chats",
    ];

    return (
      <section
        className="screen payment-success-screen"
        style={{
          maxWidth: "100%",
          padding: "clamp(10px, 3vw, 20px)",
          background: "#fff",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "clamp(15px, 3vw, 20px)",
          }}
        >
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
                  ...filteredCardsWithIndex
                    .slice(0, offset)
                    .map((item, idx) => ({
                      ...item,
                      duplicateKey: `end-${idx}`,
                    })),
                ];

                // Use paymentSuccessCarouselIndex directly (it already includes offset)
                const displayIndex = paymentSuccessCarouselIndex;

                return (
                  <div
                    className="carousel-container"
                    style={{
                      marginBottom: "clamp(20px, 5vw, 40px)",
                      padding: "0 clamp(5px, 2vw, 10px)",
                    }}
                  >
                    <div className="carousel-wrapper">
                      <div
                        className="carousel-track"
                        style={{
                          transform: `translateX(calc(-${
                            displayIndex * (220 + 16)
                          }px))`,
                          transition: paymentSuccessCarouselResetRef.current
                            ? "none"
                            : "transform 0.4s ease-in-out",
                          gap: "16px",
                          padding: "0 calc(50% - 110px)",
                        }}
                      >
                        {duplicatedCards.map(
                          ({ card, originalIndex, duplicateKey }, index) => {
                            const isActive = index === displayIndex;
                            const usernameForFresh = (card.username || "").replace('@', '').trim();
                            // ✅ Decode HTML entities in case old snapshots have &amp;
                            let imageUrl = freshAvatars[usernameForFresh] || (card.image ? proxyImage(card.image) : null);

                            return (
                              <article
                                key={`${
                                  card.username || "card"
                                }-${duplicateKey}-${index}`}
                                className={`slider-card ${
                                  isActive ? "active" : ""
                                }`}
                                style={{
                                  borderRadius: "18px",
                                  overflow: "hidden",
                                  background: "#fff",
                                  border: "1px solid rgba(0, 0, 0, 0.08)",
                                  boxShadow: isActive
                                    ? "0 4px 12px rgba(0, 0, 0, 0.15)"
                                    : "0 2px 8px rgba(0, 0, 0, 0.1)",
                                }}
                              >
                                <div
                                  className="slider-image"
                                  style={{
                                    width: "100%",
                                    height: "250px",
                                    backgroundColor: imageUrl
                                      ? "transparent"
                                      : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                    position: "relative",
                                    overflow: "hidden",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  {imageUrl && (
                                    <img
                                      src={imageUrl}
                                      alt={card.username || "Instagram user"}
                                      referrerPolicy="no-referrer"
                                      loading="eager"
                                      onError={(e) => {
                                        if (usernameForFresh && !freshAvatars[usernameForFresh]) {
                                          console.log(`📸 Image failed, fetching fresh avatar for: ${usernameForFresh}`);
                                          fetchProfileDataDirectly(usernameForFresh, true).then(url => {
                                            if (url) {
                                              setFreshAvatars(prev => ({ ...prev, [usernameForFresh]: url }));
                                            }
                                          });
                                        }
                                      }}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block"
                                      }}
                                    />
                                  )}

                                  {!imageUrl && (
                                    <div
                                      style={{
                                        width: "120px",
                                        height: "120px",
                                        borderRadius: "50%",
                                        background: "rgba(255, 255, 255, 0.3)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "48px",
                                        color: "#fff",
                                      }}
                                    >
                                      👤
                                    </div>
                                  )}
                                </div>
                                <div
                                  className="slider-card-content"
                                  style={{
                                    padding: "clamp(15px, 3vw, 20px)",
                                    textAlign: "center",
                                  }}
                                >
                                  {card?.username && (
                                    <h4
                                      className="username"
                                      style={{
                                        fontSize: "clamp(16px, 3vw, 18px)",
                                        fontWeight: "600",
                                        color: "#1a1a1a",
                                        margin: "0 0 8px 0",
                                      }}
                                    >
                                      {card.username}
                                    </h4>
                                  )}
                                  <p
                                    style={{
                                      fontSize: "clamp(13px, 2.5vw, 15px)",
                                      color: "#666",
                                      margin: "8px 0 0 0",
                                      fontWeight: "500",
                                      lineHeight: "1.5",
                                    }}
                                  >
                                    {profileActions[originalIndex] ||
                                      profileActions[0]}
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
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#666",
                marginBottom: "40px",
              }}
            >
              <p>Loading profiles...</p>
            </div>
          )}

          {/* Last 7 days 10-profile table */}
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
                We can&apos;t show the full name of the profile because
                it&apos;s restricted by Instagram.
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
                    {paymentSuccessLast7Rows.map((row, index) => {
                      const rowUsername = (row.username || "").replace('@', '').trim();
                      const rowImage = freshAvatars[rowUsername] || (row.image ? proxyImage(row.image) : null);
                      
                      return (
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
                              {rowImage ? (
                                <img
                                  src={rowImage}
                                  alt={row.name}
                                  referrerPolicy="no-referrer"
                                  loading="eager"
                                  onError={() => {
                                    if (rowUsername && !attemptedFreshAvatars.current.has(rowUsername)) {
                                      attemptedFreshAvatars.current.add(rowUsername);
                                      console.log(`📸 Recovery attempt (table): ${rowUsername}`);
                                      fetchProfileDataDirectly(rowUsername, true).then(url => {
                                        if (url) {
                                          setFreshAvatars(prev => ({ ...prev, [rowUsername]: url }));
                                        }
                                      });
                                    }
                                  }}
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
                    )})}
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
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

export default App;