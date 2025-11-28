# Backend Guide

## 🎯 Overview

This guide explains the backend architecture, API endpoints, and scraping logic. Useful for understanding how data flows from Instagram to the frontend.

## 📁 Backend Structure

```
backend/
├── server.js           # Express API server
├── scraper/
│   ├── browser.js      # Browser launch configuration
│   ├── scrape.js       # Main scraping orchestration
│   └── selectors.js    # CSS selectors for Instagram
└── snapshots/          # Generated HTML snapshots
    └── <username>/
        └── <timestamp>/
            ├── 01-landing.html
            ├── 02-username-entry.html
            ├── 03-analyzing.html
            ├── 04-profile-confirm.html
            ├── 05-processing.html
            ├── 06-results.html      ⭐ Most important
            └── 07-full-report.html
```

## 🔌 API Endpoints

### GET `/api/stalkers?username=<instagram_username>`

**Purpose:** Initiates scraping and returns snapshot paths with parsed data

**Request:**
```
GET http://localhost:3000/api/stalkers?username=harshit_1308
```

**Response:**
```json
{
  "cards": [
    {
      "username": "@user1",
      "visits": 5,
      "image": "..."
    }
  ],
  "steps": [
    {
      "name": "landing",
      "htmlPath": "/snapshots/@harshit_1308/1764258084316/01-landing.html",
      "meta": { ... }
    },
    {
      "name": "results",
      "htmlPath": "/snapshots/@harshit_1308/1764258084316/06-results.html",
      "meta": { ... }
    }
  ],
  "profile": {
    "name": "Harshit",
    "username": "@harshit_1308",
    "avatar": "..."
  }
}
```

**Error Response:**
```json
{
  "error": "username required"
}
```

**Static File Serving:**
- Snapshots are served at `/snapshots/<path>`
- Example: `http://localhost:3000/snapshots/@harshit_1308/1764258084316/06-results.html`

### GET `/api/snapshots/parsed`

**Purpose:** Returns parsed data for profile and processing stages

**Response:**
```json
{
  "profile": {
    "avatar": "data:image/png;base64,...",
    "username": "@username",
    "greeting": "..."
  },
  "processing": {
    "bullets": ["bullet 1", "bullet 2", ...]
  }
}
```

**When available:** After `04-profile-confirm.html` and `05-processing.html` are captured and parsed

**Location:** `backend/server.js` - `/api/snapshots/parsed` endpoint

---

## 📄 File Breakdown

### 1. `backend/server.js`

**Purpose:** Express server that handles API requests and serves static files

**Key Features:**
- CORS enabled
- Static file serving for snapshots
- Error handling and logging
- Port 3000

**Main Functions:**
- `app.get("/api/stalkers")` - Scraping endpoint
- `app.use("/snapshots", express.static(...))` - Static file serving

**When to modify:**
- Change port
- Add new endpoints
- Modify CORS settings
- Add authentication

---

### 2. `backend/scraper/scrape.js` ⭐

**Purpose:** Main scraping orchestration logic

**Key Functions:**

#### **`scrape(username)`**
Main function that:
1. Launches browser
2. Creates new page
3. Navigates through Instagram flow
4. Captures snapshots at each step
5. Returns result object

**Flow:**
```
1. Launch browser (Playwright)
2. Navigate to Instagram
3. Capture: 01-landing.html
4. Enter username
5. Capture: 02-username-entry.html
6. Wait for analysis
7. Capture: 03-analyzing.html
8. Confirm profile
9. Capture: 04-profile-confirm.html
10. Wait for processing
11. Capture: 05-processing.html
12. Wait for results
13. Capture: 06-results.html ⭐
14. (Optional) Capture: 07-full-report.html
15. Close browser
16. Return result
```

#### **`captureStep(name, meta)`**
Saves current page HTML as snapshot

**Parameters:**
- `name`: Step name (e.g., "landing", "results")
- `meta`: Additional metadata

**Returns:**
```javascript
{
  name: "results",
  htmlPath: "/snapshots/.../06-results.html",
  meta: { capturedAt: "..." }
}
```

**When to modify:**
- Change scraping flow
- Add new steps
- Modify wait times
- Change snapshot naming

---

### 3. `backend/scraper/browser.js`

**Purpose:** Browser launch configuration

**Key Function:**

#### **`launchBrowser()`**
Launches Playwright Chromium browser with optimized settings

**Configuration:**
- Headless mode
- Disabled automation detection
- Performance optimizations
- Resource limits handling

**When to modify:**
- Change browser type (Firefox, WebKit)
- Modify browser arguments
- Add extensions
- Change viewport size

---

### 4. `backend/scraper/selectors.js`

**Purpose:** CSS selectors for Instagram elements

**Contains:**
- Selectors for buttons
- Selectors for input fields
- Selectors for profile elements
- Selectors for results

**When to modify:**
- Instagram changes their HTML structure
- Need to target different elements
- Add new selectors

**Example:**
```javascript
export const elements = {
  usernameInput: 'input[name="username"]',
  submitButton: 'button[type="submit"]',
  // ... more selectors
};
```

---

### 5. `backend/scraper/parseSnapshots.js` ⭐ **SERVER-SIDE PARSING**

**Purpose:** Server-side HTML parsing for profile and processing stages

**Key Functions:**

#### **`parseProfileSnapshot(html)`**
Parses `04-profile-confirm.html` and extracts:
- Avatar (base64 from background-image style)
- Username (using regex to extract @username)
- Greeting text

**Returns:**
```javascript
{
  avatar: "data:image/png;base64,...",
  username: "@username",
  greeting: "..."
}
```

#### **`parseProcessingSnapshot(html)`**
Parses `05-processing.html` and extracts:
- Bullet points (from various elements, filtered by length and keywords)

**Returns:**
```javascript
{
  bullets: ["bullet 1", "bullet 2", ...]
}
```

**When to modify:**
- HTML structure changes on profile/processing pages
- Need to extract new data fields
- Avatar extraction needs refinement
- Username extraction needs improvement

**Note:** Uses JSDOM for server-side parsing. Works in Node.js.

---

## 🔄 Scraping Process

### Step 1: Landing Page
- Navigate to Instagram analyzer website
- Capture: `01-landing.html`

### Step 2: Username Entry
- Find username input field
- Enter username
- Click submit
- Capture: `02-username-entry.html`

### Step 3: Analyzing
- Wait for analysis to start
- Capture: `03-analyzing.html`

### Step 4: Profile Confirmation
- Wait for profile to load
- Confirm profile (if needed)
- Capture: `04-profile-confirm.html`

### Step 5: Processing
- Wait for processing to complete
- Capture: `05-processing.html`

### Step 6: Results ⭐
- Wait for results page
- Capture: `06-results.html`
- **This is the most important snapshot** - contains all analysis data

### Step 7: Full Report (Optional)
- Click "View Full Report" button from results page
- Navigate to full report page
- Capture: `07-full-report.html`
- **Note:** Frontend parses this client-side using `parseFullReport.js`

---

## 📊 Data Flow

```
API Request
    │
    ▼
server.js (/api/stalkers)
    │
    │ scrape(username)
    ▼
scrape.js
    │
    │ launchBrowser()
    ▼
browser.js
    │
    │ Playwright automation
    ▼
Instagram Website
    │
    │ HTML content
    ▼
captureStep()
    │
    │ Save to disk
    │
    │ For profile/processing:
    │ │ parseProfileSnapshot() / parseProcessingSnapshot()
    │ ▼
    │ parseSnapshots.js (backend)
    │
    │ Store parsed data in step metadata
    ▼
snapshots/<username>/<timestamp>/
    │
    │ Return paths + parsed data in JSON
    ▼
Frontend
    │
    │ Progressive Loading:
    │ - Polls for snapshots
    │ - Polls /api/snapshots/parsed
    │
    │ For Results:
    │ │ Fetch 06-results.html
    │ ▼
    │ parseSnapshot.js (frontend)
    │
    │ For Full Report:
    │ │ Fetch 07-full-report.html
    │ ▼
    │ parseFullReport.js (frontend)
```

---

## 🛠️ Configuration

### Environment Variables

**Backend:**
- `DEBUG_SCRAPE=1` - Enable debug logging in scraper

**Port:**
- Default: `3000`
- Change in `server.js`: `app.listen(3000, ...)`

---

## 🐛 Debugging

### 1. Check Server Logs
```bash
# Server logs show:
[timestamp] 📥 New request received for username: harshit_1308
[timestamp] ⏱️  Starting scrape process...
[timestamp] 📝 Snapshot saved for "landing" -> snapshots/...
[timestamp] ✅ Scrape completed successfully in 45.23s
```

### 2. Inspect Snapshots
- Check `backend/snapshots/<username>/<timestamp>/`
- Open `06-results.html` in browser
- Verify HTML structure matches what frontend expects

### 3. Test Scraping
```javascript
// In Node.js REPL or test file:
import { scrape } from './scraper/scrape.js';
const result = await scrape('test_username');
console.log(result);
```

### 4. Check Browser
- Set `headless: false` in `browser.js` to see browser
- Useful for debugging selector issues

---

## ⚠️ Important Notes

1. **Playwright Required**: Backend uses Playwright for browser automation
2. **Server-Side Parsing**: Profile and processing snapshots are parsed immediately after capture using JSDOM
3. **Parsed Data Endpoint**: `/api/snapshots/parsed` provides parsed data for faster frontend rendering
4. **Snapshots are Temporary**: Old snapshots may be cleaned up
5. **Rate Limiting**: Instagram may rate limit requests
6. **HTML Structure Changes**: Instagram may change HTML, requiring selector updates
7. **Headless Mode**: Browser runs headless by default for performance
8. **Avatar Extraction**: Avatars are extracted from base64 data in background-image styles

---

## 🔧 Common Modifications

### Change Port
```javascript
// server.js
app.listen(3000, () => {  // Change 3000 to desired port
  // ...
});
```

### Add New Endpoint
```javascript
// server.js
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});
```

### Modify Scraping Flow
```javascript
// scraper/scrape.js
// In scrape() function, add new steps:
await captureStep("new-step", { custom: "data" });
```

### Change Snapshot Directory
```javascript
// scraper/scrape.js
const SNAPSHOT_DIR = path.join(__dirname, "..", "snapshots");  // Change path
```

---

## 📦 Dependencies

**package.json:**
- `express` - Web server
- `playwright` - Browser automation
- `cors` - CORS middleware

**Install:**
```bash
cd backend
npm install
```

---

## 🚀 Running Backend

```bash
cd backend
npm start
# or
node server.js
```

**Expected Output:**
```
🚀 API server started on port 3000
📍 Endpoint: http://localhost:3000/api/stalkers?username=<instagram_username>
⏱️  Expected response time: 30-60 seconds per request
```

---

## 🔐 Security Considerations

1. **No Authentication**: API is currently open (add auth if needed)
2. **CORS Enabled**: Allows requests from any origin (restrict if needed)
3. **Input Validation**: Username is validated but could be stricter
4. **Rate Limiting**: Not implemented (add if needed)

---

## 📞 Integration with Frontend

The backend:
1. Receives username from frontend
2. Scrapes Instagram
3. Saves HTML snapshots
4. **Parses profile and processing snapshots immediately** (server-side)
5. Returns snapshot paths with parsed data in metadata
6. Provides `/api/snapshots/parsed` endpoint for frontend polling
7. Frontend fetches and parses results/full report snapshots (client-side)

**Hybrid Approach:**
- **Backend parsing**: Profile and processing stages (faster, uses JSDOM)
- **Frontend parsing**: Results and full report (more flexible, uses DOMParser)
- **Progressive loading**: Frontend polls for snapshots and updates UI in real-time

