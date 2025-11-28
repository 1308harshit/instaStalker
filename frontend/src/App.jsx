import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseResultsSnapshot } from "./utils/parseSnapshot";

const API_URL =
  import.meta.env.VITE_API_URL?.trim() ||
  "http://localhost:3000/api/stalkers";
const API_BASE = (() => {
  try {
    const url = new URL(API_URL);
    return `${url.protocol}//${url.host}`;
  } catch (err) {
    return "http://localhost:3000";
  }
})();
const SNAPSHOT_BASE =
  import.meta.env.VITE_SNAPSHOT_BASE?.trim() || API_BASE;

const SCREEN = {
  LANDING: "landing",
  ANALYZING: "analyzing",
  PROFILE: "profile",
  PROCESSING: "processing",
  PREVIEW: "preview",
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
const NON_EN_SUMMARY_REGEX = /(seus seguidores|amoroso|vista\(o\)|você é|dos seus)/i;
const SUMMARY_EXCLUDE_REGEX = /top.*#.*stalker|stalker.*top/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const isValidUsername = (value = "") =>
  Boolean(value) && !INVALID_USERNAME_REGEX.test(value);

function App() {
  const [screen, setScreen] = useState(SCREEN.LANDING);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [usernameInput, setUsernameInput] = useState("");
  const [cards, setCards] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [processingStats, setProcessingStats] = useState(DEFAULT_STATS);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef({});
  const tickerRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshotHtml, setSnapshotHtml] = useState({
    analyzing: null,
    "profile-confirm": null,
    processing: null,
  });
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const activeRequestRef = useRef(0);
  const stepHtmlFetchRef = useRef({});
  const processingMessages = useMemo(
    () => [
      `Found 10 mentions of ${profile.username} in messages from your followers`,
      "Our AI detected a possible screenshot of someone talking about you",
      "It was detected that someone you know visited your profile 9 times yesterday",
      "2 people from your region shared one of your stories",
    ],
    [profile.username]
  );

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
      if (!step || snapshotHtml[stepName] || stepHtmlFetchRef.current[stepName]) return;
      stepHtmlFetchRef.current[stepName] = true;
      const html = await fetchSnapshotHtml(stepName, step.htmlPath);
      if (html) {
        setSnapshotHtml((prev) => {
          // Only update if not already loaded
          if (prev[stepName]) return prev;
          return {
            ...prev,
            [stepName]: html,
          };
        });
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
  }, [snapshotLookup, snapshotHtml]);

  useEffect(
    () => () => {
      Object.values(toastTimers.current).forEach(clearTimeout);
      clearInterval(tickerRef.current);
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
    const filtered = cards.filter(
      (item) => item && isValidUsername(item.username)
    );
    setNotifications(filtered);
  }, [cards]);

  useEffect(() => {
    if (screen !== SCREEN.ANALYZING || snapshotHtml.analyzing) {
      return;
    }
    setAnalyzingProgress(0);
    const timer = setInterval(() => {
      setAnalyzingProgress((prev) => {
          if (prev >= 95) {
            clearInterval(timer);
            return 95;
          }
          return Math.min(95, prev + randBetween(3, 7));
      });
    }, 700);
    return () => clearInterval(timer);
  }, [screen, snapshotHtml.analyzing]);

  useEffect(() => {
    if (snapshotHtml.analyzing) {
      setAnalyzingProgress(100);
    }
  }, [snapshotHtml.analyzing]);

  useEffect(() => {
    if (screen !== SCREEN.PROCESSING || snapshotHtml.processing) {
      return;
    }
    setProcessingMessageIndex(0);
    const timer = setInterval(() => {
      setProcessingMessageIndex((prev) => {
        if (prev >= processingMessages.length - 1) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, snapshotHtml.processing, processingMessages.length]);

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
    if (analysis && screen === SCREEN.PROCESSING) {
      setScreen(SCREEN.PREVIEW);
    }
  }, [analysis, screen]);

  useEffect(() => {
    if (screen !== SCREEN.PREVIEW || notifications.length === 0) {
      clearTimeout(notificationTimerRef.current);
      return;
    }
    let index = 0;
    let toggle = 0;

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
                 pushToast(`${item.username} visited your profile`, item.image);
               }

        toggle = toggle === 0 ? 1 : 0;
        const nextDelay = toggle === 0 ? 7000 : 10000;
        schedule(nextDelay);
      }, wait);
    };

    schedule(100000);
    return () => clearTimeout(notificationTimerRef.current);
  }, [screen, notifications]);

  const buildSnapshotUrl = (htmlPath = "") => {
    if (!htmlPath) return null;
    const normalized = htmlPath.startsWith("/") ? htmlPath : `/${htmlPath}`;
    return `${SNAPSHOT_BASE}${normalized}`;
  };

  const profileStatsFromState = () => ([
    { value: profile.posts, label: "posts" },
    { value: profile.followers, label: "followers" },
    { value: profile.following, label: "following" },
  ]);

  const pushToast = (message, image) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, image }]);
    toastTimers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      delete toastTimers.current[id];
    }, 7000);
  };

  const checkSnapshotExists = async (username, timestamp, fileName) => {
    const snapshotPath = `/snapshots/${encodeURIComponent(username)}/${timestamp}/${fileName}`;
    const url = buildSnapshotUrl(snapshotPath);
    try {
      // Try HEAD first (lighter), fallback to GET if HEAD fails
      let res = await fetch(url, { 
        method: "HEAD",
        cache: 'no-cache'
      });
      if (!res.ok && res.status === 405) {
        // If HEAD not supported, try GET
        res = await fetch(url, { 
          method: "GET",
          cache: 'no-cache'
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
    const snapshotFiles = ["03-analyzing.html", "04-profile-confirm.html", "05-processing.html", "06-results.html"];
    
    // Check files in parallel for each timestamp to speed up discovery
    for (let timestamp = now; timestamp >= now - checkRange; timestamp -= step) {
      if (activeRequestRef.current !== requestId) {
        return null;
      }
      // Check all files in parallel for this timestamp
      const checks = await Promise.all(
        snapshotFiles.map(fileName => checkSnapshotExists(username, timestamp, fileName))
      );
      
      // If any file exists, we found the directory
      if (checks.some(exists => exists)) {
        return timestamp;
      }
      
      // Small delay to avoid hammering the server
      await delay(100);
    }
    return null;
  };

  const registerSnapshot = (username, timestamp, fileName, stepName, requestId) => {
    if (activeRequestRef.current !== requestId) return;
    const snapshotPath = `/snapshots/${encodeURIComponent(username)}/${timestamp}/${fileName}`;
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

      for (const step of steps) {
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
        if (exists) {
          registerSnapshot(username, timestamp, step.file, step.name, requestId);
        }
      }
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
    stepHtmlFetchRef.current = {};
    setAnalyzingProgress(0);
    setProcessingMessageIndex(0);

    activeRequestRef.current += 1;
    const requestId = activeRequestRef.current;
    monitorSnapshots(formatted, requestId).catch((err) =>
      console.error("Snapshot monitor failed", err)
    );

    try {
      setScreen(SCREEN.ANALYZING);
      const fetchPromise = fetchCards(formatted);

      await delay(4000);
      if (activeRequestRef.current !== requestId) return;
      setScreen((prev) => (prev === SCREEN.ANALYZING ? SCREEN.PROFILE : prev));

      await delay(3000);
      if (activeRequestRef.current !== requestId) return;
      setScreen((prev) => (prev === SCREEN.PROFILE ? SCREEN.PROCESSING : prev));

      await fetchPromise;
    } catch (err) {
      setErrorMessage(err.message || "Unable to fetch stalkers right now.");
      setScreen(SCREEN.ERROR);
      activeRequestRef.current += 1;
    }
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
    const res = await fetch(`${API_URL}?username=${encodeURIComponent(usernameValue)}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.cards)) {
      throw new Error(data?.error || "Unexpected response from server");
    }
    setCards(data.cards);
    setSnapshots((prev) => mergeSnapshotSteps(prev, data.steps || []));
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
        <div className="stage-progress-fill" style={{ width: `${analyzingProgress}%` }} />
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
          <div className="stage-bar-fill" style={{ width: `${analyzingProgress}%` }} />
        </div>
      </div>
      <p className="stage-status">Analyzing your profile 🔎</p>
    </div>
  );

  const renderLanding = () => (
    <section className="screen hero">
      <h4>You have stalkers...</h4>
      <h1>Discover in 1 minute who loves you and who hates you</h1>
      <p className="hero-copy">
        We analyze your Instagram profile to identify who loves watching your life,
        who hasn't forgotten you, and who pretends to be your friend.
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
          <h3>Who wants you</h3>
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
        <small>Secure data – we will NEVER ask for your password.</small>
      </form>
    </section>
  );

  const renderProfileFallback = () => (
    <div className="stage-card profile-card">
      <div className="stage-progress-track subtle">
        <div className="stage-progress-fill" style={{ width: "55%" }} />
      </div>
      <div className="profile-avatar-ring">
        <img src={profile.avatar} alt={profile.name} />
      </div>
      <div className="profile-username">{profile.username}</div>
      <h1>Hello, {profile.name}</h1>
      <p className="stage-subtitle">Is this your profile?</p>
      <button className="profile-primary-btn">Continue, the profile is correct</button>
      <button className="profile-secondary-btn">No, I want to correct it</button>
    </div>
  );

  const renderProcessingFallback = () => (
    <div className="stage-card processing-card">
      <div className="stage-progress-track subtle">
        <div className="stage-progress-fill" style={{ width: "78%" }} />
      </div>
      <div className="processing-avatar-ring">
        <img src={profile.avatar} alt={profile.name} />
      </div>
      <h1>Processing data</h1>
      <p className="stage-subtitle">
        Our robots are analyzing the <strong>behavior of your followers</strong>
      </p>
      <ul className="processing-list">
        {processingMessages.map((message, index) => (
          <li key={message} className={index <= processingMessageIndex ? "visible" : ""}>
            <span>✔</span>
            <p>{message}</p>
          </li>
        ))}
      </ul>
    </div>
  );

  const renderAnalyzing = () => {
    return (
      <section className="screen snapshot-stage">
        {snapshotHtml.analyzing ? (
          <div
            className="snapshot-content"
            dangerouslySetInnerHTML={{ __html: snapshotHtml.analyzing }}
          />
        ) : (
          renderAnalyzingFallback()
        )}
      </section>
    );
  };

  const renderProfile = () => {
    return (
      <section className="screen snapshot-stage">
        {snapshotHtml["profile-confirm"] ? (
          <div
            className="snapshot-content"
            dangerouslySetInnerHTML={{ __html: snapshotHtml["profile-confirm"] }}
          />
        ) : (
          renderProfileFallback()
        )}
      </section>
    );
  };

  const renderProcessing = () => {
    return (
      <section className="screen snapshot-stage">
        {snapshotHtml.processing ? (
          <div
            className="snapshot-content"
            dangerouslySetInnerHTML={{ __html: snapshotHtml.processing }}
          />
        ) : (
          renderProcessingFallback()
        )}
      </section>
    );
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

    const { hero, summary, slider, screenshots, stories, alert, addicted, ctas } = analysis;
    const filteredSummaryCards = summary.cards.filter((card) => {
      const text = `${card.title} ${card.detail}`.trim();
      return text && !NON_EN_SUMMARY_REGEX.test(text) && !SUMMARY_EXCLUDE_REGEX.test(text);
    });
    
    // Determine which CTA is for "REVEAL STALKERS" and which is for "REVEAL PROFILES"
    const revealStalkersCta = ctas.primary && ctas.primary.toLowerCase().includes("stalker") ? ctas.primary : null;
    const revealProfilesCta = ctas.secondary && (ctas.secondary.toLowerCase().includes("profile") || ctas.secondary.toLowerCase().includes("uncensored")) ? ctas.secondary : null;

    return (
      <section className="screen preview-screen">
        <div className="analyzer-shell">
          <section className="hero-panel">
            <div className="hero-top">
              <div className="hero-avatar">
                <img src={hero.profileImage || profile.avatar} alt={hero.name || profile.name} />
              </div>
              <div className="hero-meta">
                <h1>{hero.name || profile.name}</h1>
                <div className="hero-stats">
                  {(hero.stats.length ? hero.stats : profileStatsFromState()).map((stat) => (
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
                  {hero.visitors.slice(0, 6).map((visitor, index) => (
                    <img
                      key={`${visitor.alt}-${index}`}
                      src={visitor.image}
                      alt={visitor.alt || `visitor-${index + 1}`}
                    />
                  ))}
                </div>
                <small>Live data from the remote analyzer</small>
              </div>
            )}
          </section>

          <section className="preview-header">
            <div className="preview-titles">
              <p>{summary.warning || "Don't leave this page."}</p>
              {summary.weekRange && <span>{summary.weekRange}</span>}
            </div>
            <div className="summary-grid">
              {(filteredSummaryCards.length ? filteredSummaryCards : summary.cards).map((card) => (
                <article key={`${card.title}-${card.detail}`}>
                  <h3>{card.title}</h3>
                  <p>{card.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="slider-section">
            <h3>{slider.heading}</h3>
            <div className="slider-grid">
              {(slider.cards.length ? slider.cards : cards).map((card, index) => {
                const imageUrl =
                  card.image || hero.profileImage || profile.avatar;
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
                      className="slider-card slider-card--locked"
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
                      className="slider-card slider-card--blurred"
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
                  <article className="slider-card" key={`${card.title}-${index}`}>
                    <div
                      className="slider-image"
                      style={{
                        backgroundImage: imageUrl ? `url(${imageUrl})` : "none",
                        backgroundColor: imageUrl ? "transparent" : "#f5f5f5",
                      }}
                    />
                    {card?.username && (
                      <h4 className="username">{card.username}</h4>
                    )}
                    {showLines &&
                      card.lines.map((line, idx) => (
                        <p
                          key={`${line.text}-${idx}`}
                          className={line.blurred ? "blurred-text" : ""}
                        >
                          {renderSensitiveText(line.text, line.blurred)}
                        </p>
                      ))}
                    {card?.badge && (
                      <span className="slider-badge">{card.badge}</span>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {revealStalkersCta && (
            <div className="cta-inline">
              <button className="primary-btn">{revealStalkersCta}</button>
            </div>
          )}

          {stories?.slides?.length > 0 && (
            <section className="stories-section">
              <h3>{stories.heading || "Stories activity"}</h3>
              <div className="stories-grid">
                {stories.slides.map((story, index) => (
                  <article key={`${story.caption}-${index}`} className="story-card">
                    <div
                      className="story-cover"
                      style={{ 
                        backgroundImage: story.image ? `url(${story.image})` : "none",
                        backgroundColor: story.image ? "transparent" : "#000"
                      }}
                    >
                      <div className="story-hero-info">
                        <img 
                          src={hero.profileImage || profile.avatar} 
                          alt={hero.name || profile.name}
                          className="story-hero-avatar"
                        />
                        <span className="story-hero-username">{hero.name || profile.name}</span>
                      </div>
                      {(story.caption || story.meta) && (
                        <div className="story-bottom-overlay">
                          <span className="story-lock-icon">🔒</span>
                          <div className="story-bottom-text">
                            {story.caption && <p className="story-caption">{story.caption}</p>}
                            {story.meta && <span className="story-meta">{story.meta}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {revealProfilesCta && (
            <div className="cta-inline">
              <button className="primary-btn">{revealProfilesCta}</button>
            </div>
          )}

          <section className="screenshots-panel">
            <h3>{screenshots.heading}</h3>
            <p>{screenshots.description}</p>
            <ul>
              {screenshots.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="chat-preview">
              {screenshots.chat.map((bubble, index) => (
                <div
                  key={`${bubble.text}-${index}`}
                  className={`chat-bubble ${
                    index % 2 === 0 ? "from-me" : "from-them"
                  } ${bubble.blurred ? "blurred-text" : ""}`}
                >
                  {renderSensitiveText(bubble.text, bubble.blurred)}
                </div>
              ))}
            </div>
            {screenshots.footer && (
              <p className="screenshots-footer">{screenshots.footer}</p>
            )}
            {ctas.secondary && !revealProfilesCta && (
              <div className="cta-inline">
                <button className="secondary-btn">{ctas.secondary}</button>
              </div>
            )}
          </section>

          {alert.title && (
            <section className="alert-panel">
              <h3 dangerouslySetInnerHTML={{ __html: alert.title }} />
              {alert.badge && <span className="alert-badge">{alert.badge}</span>}
              <p dangerouslySetInnerHTML={{ __html: alert.copy }} />
            </section>
          )}

          {addicted.tiles.length > 0 && (
            <section className="addicted-panel">
              <h3 dangerouslySetInnerHTML={{ __html: addicted.title }} />
              <div className="addicted-grid">
                {addicted.tiles.map((tile, index) => (
                  <article key={`${tile.body}-${index}`}>
                    <h4 className={tile.blurred ? "blurred-text" : ""}>
                      {renderSensitiveText(tile.title, tile.blurred)}
                    </h4>
                    <p>{tile.body}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
          {(addicted.footer || addicted.subfooter || ctas.tertiary) && (
            <section className="cta-block final">
              {addicted.footer && (
                <p className="cta-banner">{addicted.footer}</p>
              )}
              {ctas.tertiary && (
                <button className="primary-btn">{ctas.tertiary}</button>
              )}
              {addicted.subfooter && <small>{addicted.subfooter}</small>}
            </section>
          )}

          {/* table removed per request */}
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
              {toast.image && (
                <img src={toast.image} alt="" />
              )}
              <div>
                <p>{toast.message}</p>
                <small>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
