import { saveSnapshotStep, saveSnapshotResult } from "../utils/mongodb.js";

const DEBUG_SCRAPE = process.env.DEBUG_SCRAPE === "1";

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const proxyImage = (url) => {
  if (!url || !url.includes("fbcdn.net")) return url;
  return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/&amp;/g, "&"))}`;
};

/** Build synthetic profile-confirm HTML parseable by parseProfileSnapshot */
function buildProfileConfirmHtml(profile) {
  const username = profile.username?.startsWith("@")
    ? profile.username
    : `@${profile.username || ""}`;
  let rawAvatar =
    (profile.hd_profile_pic_url_info &&
      profile.hd_profile_pic_url_info.url) ||
    profile.profile_pic_url ||
    profile.base64_profile_pic ||
    "";
  // If we only have base64, convert to data URL so <img src="..."> works
  if (rawAvatar && !/^https?:\/\//i.test(rawAvatar) && !rawAvatar.startsWith("data:")) {
    rawAvatar = `data:image/jpeg;base64,${rawAvatar}`;
  }
  // ✅ DO NOT escape URLs - they contain & for query params!
  const avatar = rawAvatar;
  const name = escapeHtml(profile.full_name || username.replace("@", ""));

  const proxiedAvatar = proxyImage(avatar);
  return `<!DOCTYPE html><html><body>
    <div style="background-image: url('${proxiedAvatar}')">
      <img src="${proxiedAvatar}" alt="${escapeHtml(username)}" referrerpolicy="no-referrer" />
    </div>
    <span>${escapeHtml(username)}</span>
    <h1>Hello, ${name}</h1>
    <p>Is this your profile?</p>
    <button>Continue, the profile is correct</button>
    <button>No, I want to correct it</button>
    <div style="width: 55%"></div>
  </body></html>`;
}

/** Build synthetic processing HTML parseable by parseProcessingSnapshot */
function buildProcessingHtml(profile) {
  const username = profile.username?.startsWith("@")
    ? profile.username
    : `@${profile.username || ""}`;
  let rawAvatar =
    (profile.hd_profile_pic_url_info &&
      profile.hd_profile_pic_url_info.url) ||
    profile.profile_pic_url ||
    profile.base64_profile_pic ||
    "";
  if (rawAvatar && !/^https?:\/\//i.test(rawAvatar) && !rawAvatar.startsWith("data:")) {
    rawAvatar = `data:image/jpeg;base64,${rawAvatar}`;
  }
  // ✅ DO NOT escape URLs - they contain & for query params!
  const avatar = rawAvatar;

  const proxiedAvatar = proxyImage(avatar);
  return `<!DOCTYPE html><html><body>
    <div style="background-image: url('${proxiedAvatar}')">
      <img src="${proxiedAvatar}" alt="${escapeHtml(username)}" referrerpolicy="no-referrer" />
    </div>
    <h1>Processing data</h1>
    <p>Our robots are analyzing the behavior of your followers</p>
    <ul>
      <li>Found 10 mentions of ${escapeHtml(username)} in messages from your followers</li>
      <li>Our AI detected a possible screenshot of someone talking about you</li>
      <li>It was detected that someone you know visited your profile 9 times yesterday</li>
      <li>2 people from your region shared one of your stories</li>
    </ul>
  </body></html>`;
}

/** Build synthetic results HTML parseable by parseResultsSnapshot (slider cards) */
function buildResultsHtml(cards) {
  const slideHtml = cards
    .slice(0, 50)
    .map((card) => {
      const u = (card.username || "").startsWith("@")
        ? card.username
        : `@${card.username}`;
      // ✅ Proxy Instagram images via weserv.nl
      const img = proxyImage(card.image || "");
      return `
    <div role="group" aria-roledescription="slide">
      <h4>${escapeHtml(u)}</h4>
      <div class="result-image" style="width:100%; height:250px; background:#f0f0f0; overflow:hidden;">
        <img src="${img}" alt="${escapeHtml(u)}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover;" onerror="this.setAttribute('data-error', '1')" />
      </div>
      <p>visited your profile this week</p>
    </div>`;
    })
    .join("");

  return `<!DOCTYPE html><html><body>
    <h3>Visited your profile this week between 2 to 7 times:</h3>
    <div>${slideHtml}</div>
  </body></html>`;
}

/** Minimal HTML for non-critical steps */
const MINIMAL_HTML = "<!DOCTYPE html><html><body></body></html>";

export async function scrape(username, onStep = null) {
  const startTime = Date.now();
  log(`🚀 Starting API-based scrape for username: ${username}`);

  const rawUsername = (username || "").replace(/^@/, "").trim();
  if (!rawUsername) {
    throw new Error("Username is required");
  }

  const runId = `${Date.now()}`;
  const steps = [];
  let stepIndex = 0;
  let snapshotId = null;

  const captureStep = async (name, html, meta = {}) => {
    try {
      stepIndex += 1;
      const result = await saveSnapshotStep(
        rawUsername,
        runId,
        name,
        html,
        meta
      );

      if (!result || !result.snapshotId) {
        log(`⚠️  Failed to save snapshot step "${name}" to MongoDB`);
        return null;
      }

      if (!snapshotId && result.snapshotId) {
        snapshotId = result.snapshotId;
      }

      const entry = {
        name,
        htmlPath: `/api/snapshots/${result.snapshotId}/${name}`,
        meta: { ...meta, capturedAt: new Date().toISOString() },
      };
      steps.push(entry);
      log(
        `📝 Snapshot saved for "${name}" to MongoDB (ID: ${result.snapshotId})`
      );

      if (onStep) {
        onStep(entry);
      }

      return entry;
    } catch (snapshotErr) {
      log(`⚠️  Failed to capture snapshot for "${name}"`, snapshotErr.message);
      return null;
    }
  };

  try {
    // —— API 1: Verify User ——
    log("📡 Calling verify-user API...");
    const verifyRes = await fetch(
      "https://server.oraculoproibido.com/verify-user",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: rawUsername }),
      }
    );

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      throw new Error(`verify-user API failed (${verifyRes.status}): ${errText}`);
    }

    const profile = await verifyRes.json();
    if (!profile || !profile.id) {
      throw new Error(
        "verify-user API returned invalid data (missing id)"
      );
    }

    log(`✅ Profile verified: ${profile.username} (id: ${profile.id})`);

    await captureStep("landing", MINIMAL_HTML, { url: "api" });
    await captureStep("username-entry", MINIMAL_HTML, {
      username: rawUsername,
    });
    await captureStep("analyzing", MINIMAL_HTML);
    await captureStep("profile-confirm", buildProfileConfirmHtml(profile), {
      displayedHandle: `@${profile.username}`,
      // ✅ Store raw profile data so frontend can access it directly
      profileData: {
        username: profile.username,
        full_name: profile.full_name,
        avatar: (profile.hd_profile_pic_url_info && profile.hd_profile_pic_url_info.url) || 
                profile.profile_pic_url || 
                (profile.base64_profile_pic ? `data:image/jpeg;base64,${profile.base64_profile_pic}` : null),
        follower_count: profile.follower_count,
        following_count: profile.following_count,
        is_private: profile.is_private,
        is_verified: profile.is_verified,
      }
    });
    await captureStep(
      "processing",
      buildProcessingHtml(profile)
    );

    // —— API 3: Followers ——
    log("📡 Calling followers API...");
    const followersRes = await fetch(
      "https://server.oraculoproibido.com/followers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ig: rawUsername,
          userId: profile.id,
          isPrivate: !!profile.is_private,
        }),
      }
    );

    if (!followersRes.ok) {
      const errText = await followersRes.text();
      throw new Error(
        `followers API failed (${followersRes.status}): ${errText}`
      );
    }

    const followers = await followersRes.json();
    const followersList = Array.isArray(followers) ? followers : [];

    log(`✅ Fetched ${followersList.length} followers`);

    // Helper to build a safe image src (URL or data URL)
    const toImageSrc = (item) => {
      if (item.profile_pic_url) return item.profile_pic_url;
      if (item.base64_profile_pic) {
        const raw = String(item.base64_profile_pic || "").trim();
        if (!raw) return null;
        return raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
      }
      return null;
    };

    // Map to frontend card format: { username, image }
    const cards = followersList.map((item) => ({
      username: (item.username || "").startsWith("@")
        ? item.username
        : `@${item.username || ""}`,
      image: toImageSrc(item),
    }));

    await captureStep(
      "results",
      buildResultsHtml(cards)
    );
    await captureStep("full-report", MINIMAL_HTML);

    if (DEBUG_SCRAPE) {
      log("📊 Cards sample:", cards.slice(0, 3));
    }

    await saveSnapshotResult(rawUsername, runId, cards, steps);

    if (!snapshotId) {
      const { getSnapshotByRunId } = await import("../utils/mongodb.js");
      const savedSnapshot = await getSnapshotByRunId(rawUsername, runId);
      snapshotId = savedSnapshot?._id?.toString() || null;
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`⏱️  Total scraping time: ${totalTime} seconds`);
    log(`✅ Successfully extracted ${cards.length} cards`);

    return {
      runId,
      snapshotId,
      steps,
      cards,
      totalTime,
    };
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log("❌ Scraping failed:", error.message);
    log("📋 Error stack:", error.stack);
    log(`⏱️  Time before failure: ${totalTime} seconds`);
    throw error;
  }
}
