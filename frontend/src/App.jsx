import "./App.css";
import { useEffect, useRef, useState } from "react";

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

const SAMPLE_FEED_PATH =
  import.meta.env.VITE_SAMPLE_PATH?.trim() || "/sample.txt";

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function App() {
  const [screen, setScreen] = useState(SCREEN.LANDING);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [usernameInput, setUsernameInput] = useState("");
  const [cards, setCards] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [runInfo, setRunInfo] = useState(null);
  const [processingStats, setProcessingStats] = useState(DEFAULT_STATS);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef({});
  const tickerRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    loadNotificationSeeds();
    return () => {
      Object.values(toastTimers.current).forEach(clearTimeout);
      clearInterval(tickerRef.current);
      clearTimeout(notificationTimerRef.current);
    };
  }, []);

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
    if (screen !== SCREEN.PREVIEW || notifications.length === 0) {
      clearTimeout(notificationTimerRef.current);
      return;
    }
    let index = 0;
    let toggle = 0;

    const schedule = (wait) => {
      notificationTimerRef.current = setTimeout(() => {
        const item = notifications[index % notifications.length];
        pushToast(
          `${item.username || "Unknown user"} visited your profile`,
          item.image
        );
        index += 1;
        toggle = toggle === 0 ? 1 : 0;
        const nextDelay = toggle === 0 ? 7000 : 10000;
        schedule(nextDelay);
      }, wait);
    };

    schedule(2000);
    return () => clearTimeout(notificationTimerRef.current);
  }, [screen, notifications]);

  const loadNotificationSeeds = async () => {
    try {
      const res = await fetch(SAMPLE_FEED_PATH);
      if (!res.ok) return;
      const html = await res.text();
      const parsed = parseCardsFromHtml(html);
      setNotifications(parsed);
    } catch (err) {
      console.warn("Unable to load notification seeds", err);
    }
  };

  const parseCardsFromHtml = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll("div[role='group']"))
      .map((group) => {
        const imageDiv = group.querySelector("div[style*='background-image']");
        const name = group.querySelector("h4")?.textContent?.trim();
        const style = imageDiv?.getAttribute("style") ?? "";
        const match = style.match(/url\((.*?)\)/);
        const image = match?.[1]?.replace(/&quot;/g, "") || "";
        return { username: name, image };
      })
      .filter((item) => item.image);
  };

  const buildSnapshotUrl = (htmlPath = "") => {
    if (!htmlPath) return null;
    const normalized = htmlPath.startsWith("/") ? htmlPath : `/${htmlPath}`;
    return `${SNAPSHOT_BASE}${normalized}`;
  };

  const renderSnapshotGallery = () => {
    if (!snapshots.length) return null;
    return (
      <section className="snapshot-gallery">
        <h2>Captured flow direct from Instagram analyzer</h2>
        <div className="snapshot-grid">
          {snapshots.map((step) => {
            const url = buildSnapshotUrl(step.htmlPath);
            return (
              <article className="snapshot-card" key={`${step.name}-${step.htmlPath}`}>
                <header>
                  <span>{step.name}</span>
                  {step.meta?.capturedAt && (
                    <small>
                      {new Date(step.meta.capturedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </small>
                  )}
                </header>
                {url ? (
                  <iframe src={url} loading="lazy" title={step.name} />
                ) : (
                  <p>Snapshot unavailable</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const pushToast = (message, image) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, image }]);
    toastTimers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      delete toastTimers.current[id];
    }, 7000);
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
    setRunInfo(null);
    setCards([]);

    try {
      setScreen(SCREEN.ANALYZING);
      const fetchPromise = fetchCards(formatted);
      await delay(4000);
      setScreen(SCREEN.PROFILE);
      await delay(3000);
      setScreen(SCREEN.PROCESSING);
      await fetchPromise;
      setScreen(SCREEN.PREVIEW);
    } catch (err) {
      setErrorMessage(err.message || "Unable to fetch stalkers right now.");
      setScreen(SCREEN.ERROR);
    }
  };

  const fetchCards = async (usernameValue) => {
    const res = await fetch(`${API_URL}?username=${encodeURIComponent(usernameValue)}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.cards)) {
      throw new Error(data?.error || "Unexpected response from server");
    }
    setCards(data.cards);
    setSnapshots(data.steps || []);
    setRunInfo({
      runId: data.runId,
      totalTime: data.totalTime,
    });
  };

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

  const renderAnalyzing = () => (
    <section className="screen processing-wrapper">
      <div className="spinner" />
      <h1>Analyzing...</h1>
      <p>We are capturing your profile information, please wait a few seconds.</p>
      <div className="progress-bar">
        <div className="progress-fill" id="progress-fill" />
      </div>
      <p>Analyzing your profile 🔍</p>
    </section>
  );

  const renderProfile = () => (
    <section className="screen">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: "55%" }} />
      </div>
      <div className="profile-card">
        <div className="profile-avatar">
          <img src={profile.avatar} alt="Profile" />
        </div>
        <div className="profile-meta">
          <p>{profile.username}</p>
          <h2>Hello, {profile.name}</h2>
          <p>Is this your profile? We already started the analysis in the background.</p>
          <div className="stats-grid">
            <div className="stat-box">
              <strong>{profile.posts}</strong>
              <span>posts</span>
            </div>
            <div className="stat-box">
              <strong>{profile.followers}</strong>
              <span>followers</span>
            </div>
            <div className="stat-box">
              <strong>{profile.following}</strong>
              <span>following</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderProcessing = () => (
    <section className="screen processing-wrapper">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: "78%" }} />
      </div>
      <div className="scan-area">
        <img src={profile.avatar} alt="Profile" />
        <div className="scan-line" />
      </div>
      <h1>Processing data</h1>
      <p>Our robots are analyzing the behavior of your followers</p>
      <div className="processing-metrics">
        <p>
          Found <strong>{processingStats.mentions} mentions</strong> of {profile.username}
        </p>
        <p>
          Detected <strong>{processingStats.screenshots} screenshots</strong> about you
        </p>
        <p>
          Someone visited your profile <strong>{processingStats.visits}</strong> times today
        </p>
      </div>
    </section>
  );

  const renderPreview = () => {
    const topCards = cards.slice(0, 5);
    return (
      <section className="screen">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: "92%" }} />
        </div>
        <div className="preview-header">
          <div>
            <p>Preview</p>
            <h1>Don't leave this page.</h1>
          </div>
          <div className="preview-cards">{
            topCards.map((card, index) => (
              <div
                key={`${card.username}-${index}`}
                className="profile-img"
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  border: "3px solid #fff",
                  backgroundImage: `url(${card.image})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            ))
          }</div>
        </div>
        <p>8 people visited your profile this week</p>
        {runInfo && (
          <p className="run-info">
            Session #{runInfo.runId} • took {runInfo.totalTime || "0"}s to mirror the
            remote flow
          </p>
        )}
        <div className="preview-grid">{renderPreviewTiles(topCards)}</div>
        <div className="cta-section">
          <p>Visited your profile this week between 2 to 7 times.</p>
          <button className="primary-btn" id="view-full-report" onClick={showFullReport}>
            View Full Report
          </button>
        </div>
        <section className="full-report" id="full-report" />
        {renderSnapshotGallery()}
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
