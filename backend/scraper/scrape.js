// ============================================================================
// API-FIRST ARCHITECTURE REFACTOR
// MongoDB snapshot saving and HTML generation are commented out.
// SSE now streams raw JSON data directly to frontend.
// ============================================================================

// COMMENTED OUT: MongoDB snapshot imports (no longer saving HTML snapshots)
// import { saveSnapshotStep, saveSnapshotResult } from "../utils/mongodb.js";

const DEBUG_SCRAPE = process.env.DEBUG_SCRAPE === "1";

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

// COMMENTED OUT: escapeHtml - no longer generating HTML
// const escapeHtml = (s) =>
//   String(s || "")
//     .replace(/&/g, "&amp;")
//     .replace(/</g, "&lt;")
//     .replace(/>/g, "&gt;")
//     .replace(/"/g, "&quot;")
//     .replace(/'/g, "&#39;");

// COMMENTED OUT: proxyImage for HTML - frontend will handle proxying
// const proxyImage = (url) => {
//   if (!url || !url.includes("fbcdn.net")) return url;
//   return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/&amp;/g, "&"))}`;
// };

// ============================================================================
// COMMENTED OUT: HTML GENERATION FUNCTIONS
// These functions built synthetic HTML for parsing. No longer needed with API-first approach.
// ============================================================================

// /** Build synthetic profile-confirm HTML parseable by parseProfileSnapshot */
// function buildProfileConfirmHtml(profile) {
//   const username = profile.username?.startsWith("@")
//     ? profile.username
//     : `@${profile.username || ""}`;
//   let rawAvatar =
//     (profile.hd_profile_pic_url_info &&
//       profile.hd_profile_pic_url_info.url) ||
//     profile.profile_pic_url ||
//     profile.base64_profile_pic ||
//     "";
//   if (rawAvatar && !/^https?:\/\//i.test(rawAvatar) && !rawAvatar.startsWith("data:")) {
//     rawAvatar = `data:image/jpeg;base64,${rawAvatar}`;
//   }
//   const avatar = rawAvatar;
//   const name = escapeHtml(profile.full_name || username.replace("@", ""));
//   const proxiedAvatar = proxyImage(avatar);
//   return `<!DOCTYPE html><html><body>
//     <div style="background-image: url('${proxiedAvatar}')">
//       <img src="${proxiedAvatar}" alt="${escapeHtml(username)}" referrerpolicy="no-referrer" />
//     </div>
//     <span>${escapeHtml(username)}</span>
//     <h1>Hello, ${name}</h1>
//     <p>Is this your profile?</p>
//     <button>Continue, the profile is correct</button>
//     <button>No, I want to correct it</button>
//     <div style="width: 55%"></div>
//   </body></html>`;
// }

// /** Build synthetic processing HTML parseable by parseProcessingSnapshot */
// function buildProcessingHtml(profile) {
//   const username = profile.username?.startsWith("@")
//     ? profile.username
//     : `@${profile.username || ""}`;
//   let rawAvatar =
//     (profile.hd_profile_pic_url_info &&
//       profile.hd_profile_pic_url_info.url) ||
//     profile.profile_pic_url ||
//     profile.base64_profile_pic ||
//     "";
//   if (rawAvatar && !/^https?:\/\//i.test(rawAvatar) && !rawAvatar.startsWith("data:")) {
//     rawAvatar = `data:image/jpeg;base64,${rawAvatar}`;
//   }
//   const avatar = rawAvatar;
//   const proxiedAvatar = proxyImage(avatar);
//   return `<!DOCTYPE html><html><body>
//     <div style="background-image: url('${proxiedAvatar}')">
//       <img src="${proxiedAvatar}" alt="${escapeHtml(username)}" referrerpolicy="no-referrer" />
//     </div>
//     <h1>Processing data</h1>
//     <p>Our robots are analyzing the behavior of your followers</p>
//     <ul>
//       <li>Found ${Math.floor(Math.random() * 15) + 5} mentions of ${escapeHtml(username)} in private messages</li>
//       <li>Our AI detected a high-probability screenshot from a hidden follower</li>
//       <li>Geo-analysis: 2 people from your region shared your recent stories</li>
//       <li>Tracker: Someone near your location visited your profile ${Math.floor(Math.random() * 8) + 4} times this week</li>
//     </ul>
//   </body></html>`;
// }

// /** Build synthetic results HTML parseable by parseResultsSnapshot (slider cards) */
// function buildResultsHtml(cards) {
//   const slideHtml = cards
//     .slice(0, 50)
//     .map((card) => {
//       const u = (card.username || "").startsWith("@")
//         ? card.username
//         : `@${card.username}`;
//       const img = proxyImage(card.image || "");
//       return `
//     <div role="group" aria-roledescription="slide">
//       <h4>${escapeHtml(u)}</h4>
//       <div class="result-image" style="width:100%; height:250px; background:#f0f0f0; overflow:hidden;">
//         <img src="${img}" alt="${escapeHtml(u)}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover;" onerror="this.setAttribute('data-error', '1')" />
//       </div>
//       <p>visited your profile this week</p>
//     </div>`;
//     })
//     .join("");
//   return `<!DOCTYPE html><html><body>
//     <h3>Visited your profile this week between 2 to 7 times:</h3>
//     <div>${slideHtml}</div>
//   </body></html>`;
// }

// COMMENTED OUT: Minimal HTML for placeholder steps
// const MINIMAL_HTML = "<!DOCTYPE html><html><body></body></html>";

// ============================================================================
// NEW: Helper to extract best avatar from API data (base64 preferred)
// ============================================================================
const getAvatarFromApiData = (data) => {
  if (!data) return null;
  // Priority: base64 → profile_pic_url → HD URL
  if (data.base64_profile_pic) {
    const raw = String(data.base64_profile_pic).trim();
    if (raw) {
      return raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
    }
  }
  if (data.profile_pic_url) {
    return data.profile_pic_url;
  }
  if (data.hd_profile_pic_url_info?.url) {
    return data.hd_profile_pic_url_info.url;
  }
  return null;
};

// ============================================================================
// MAIN SCRAPE FUNCTION - API-FIRST ARCHITECTURE
// ============================================================================
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

  // ============================================================================
  // NEW: emitStep - sends raw JSON data via SSE (replaces captureStep)
  // ============================================================================
  const emitStep = (name, data = {}) => {
    stepIndex += 1;
    const entry = {
      name,
      data,  // Raw JSON data instead of htmlPath
      capturedAt: new Date().toISOString(),
    };
    steps.push(entry);
    log(`📤 Emitting step "${name}" with data`);

    if (onStep) {
      onStep(entry);
    }

    return entry;
  };

  // COMMENTED OUT: Old captureStep that saved to MongoDB
  // const captureStep = async (name, html, meta = {}) => {
  //   try {
  //     stepIndex += 1;
  //     const result = await saveSnapshotStep(
  //       rawUsername,
  //       runId,
  //       name,
  //       html,
  //       meta
  //     );
  //     if (!result || !result.snapshotId) {
  //       log(`⚠️  Failed to save snapshot step "${name}" to MongoDB`);
  //       return null;
  //     }
  //     if (!snapshotId && result.snapshotId) {
  //       snapshotId = result.snapshotId;
  //     }
  //     const entry = {
  //       name,
  //       htmlPath: `/api/snapshots/${result.snapshotId}/${name}`,
  //       meta: { ...meta, capturedAt: new Date().toISOString() },
  //     };
  //     steps.push(entry);
  //     log(`📝 Snapshot saved for "${name}" to MongoDB (ID: ${result.snapshotId})`);
  //     if (onStep) {
  //       onStep(entry);
  //     }
  //     return entry;
  //   } catch (snapshotErr) {
  //     log(`⚠️  Failed to capture snapshot for "${name}"`, snapshotErr.message);
  //     return null;
  //   }
  // };

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

    // ============================================================================
    // EMIT STEPS WITH RAW JSON DATA (no more HTML)
    // ============================================================================
    
    // Step 1: Landing (no data needed)
    emitStep("landing", { url: "api" });
    
    // Step 2: Username entry
    emitStep("username-entry", { username: rawUsername });
    
    // Step 3: Analyzing (no data needed)
    emitStep("analyzing", {});
    
    // Step 4: Profile confirm - send full profile data
    const profileData = {
      username: profile.username,
      full_name: profile.full_name,
      profile_pic_url: profile.profile_pic_url,
      base64_profile_pic: profile.base64_profile_pic,
      hd_profile_pic_url_info: profile.hd_profile_pic_url_info,
      avatar: getAvatarFromApiData(profile),
      follower_count: profile.follower_count,
      following_count: profile.following_count,
      is_private: profile.is_private,
      is_verified: profile.is_verified,
      id: profile.id,
    };
    emitStep("profile-confirm", { profileData });
    
    // Step 5: Processing
    emitStep("processing", { profileData });

    // —— API 2: Followers ——
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

    // Map to frontend card format with avatar extraction
    const cards = followersList.map((item) => ({
      username: (item.username || "").startsWith("@")
        ? item.username
        : `@${item.username || ""}`,
      image: getAvatarFromApiData(item),
      // Include raw data for frontend flexibility
      profile_pic_url: item.profile_pic_url,
      base64_profile_pic: item.base64_profile_pic,
      full_name: item.full_name,
    }));

    // Step 6: Results - send followers/cards data
    emitStep("results", { cards, followersList });
    
    // Step 7: Full report
    emitStep("full-report", { profileData, cards });

    if (DEBUG_SCRAPE) {
      log("📊 Cards sample:", cards.slice(0, 3));
    }

    // COMMENTED OUT: MongoDB saving
    // await saveSnapshotResult(rawUsername, runId, cards, steps);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`⏱️  Total scraping time: ${totalTime} seconds`);
    log(`✅ Successfully extracted ${cards.length} cards`);

    return {
      runId,
      steps,
      cards,
      profileData, // Include profile data in final result
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
