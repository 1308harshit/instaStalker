# Workflow Guide

## 🔄 Complete Process Flow

This document explains the end-to-end workflow of the Instagram Profile Analyzer application.

## Step-by-Step Process

### 1. **User Input** (Frontend)
- User enters an Instagram username in the landing screen
- Frontend validates and sends request to backend API

**Location:** `frontend/src/App.jsx` - Landing screen form submission

### 2. **API Request** (Backend)
- Frontend makes GET request to `/api/stalkers?username=<username>`
- Backend receives request and validates username

**Location:** `backend/server.js` - `/api/stalkers` endpoint

### 3. **Web Scraping** (Backend)
- Backend launches Playwright browser (headless)
- Navigates to Instagram website
- Performs automated interactions:
  - Enters username
  - Confirms profile
  - Waits for analysis
  - Captures HTML snapshots at each step

**Location:** `backend/scraper/scrape.js` - Main scraping logic

### 4. **Snapshot Storage** (Backend)
- Each step's HTML is saved to `backend/snapshots/<username>/<timestamp>/`
- Files are named: `01-landing.html`, `02-username-entry.html`, etc.
- Most important: `06-results.html` (contains all analysis data)

**Location:** `backend/scraper/scrape.js` - `captureStep()` function

### 5. **Backend Parsing** (Backend)
- Backend parses `04-profile-confirm.html` and `05-processing.html` immediately after capture
- Extracts avatar (base64), username, bullet points
- Stores parsed data in step metadata

**Location:** `backend/scraper/parseSnapshots.js` - Server-side parsing

### 6. **Response to Frontend** (Backend)
- Backend returns JSON with:
  - `cards`: Array of visitor cards
  - `steps`: Array of snapshot paths with parsed metadata
  - `profile`: Basic profile info

**Location:** `backend/server.js` - Response JSON

### 7. **Progressive Loading** (Frontend)
- Frontend starts polling for snapshots immediately after API call
- As snapshots become available, UI updates in real-time:
  - `03-analyzing.html` → Analyzing screen with animated progress bar
  - `04-profile-confirm.html` → Profile confirmation (uses backend-parsed data)
  - `05-processing.html` → Processing screen with animated bullet points (uses backend-parsed data)
  - `06-results.html` → Results/preview page
- Frontend also polls `/api/snapshots/parsed` for backend-parsed data

**Location:** `frontend/src/App.jsx` - `monitorSnapshots()`, `fetchParsedSnapshots()`

### 8. **Data Parsing** (Frontend)
- Frontend receives the response
- For intermediate stages (profile, processing): Uses backend-parsed data from `/api/snapshots/parsed`
- For results: Fetches `06-results.html` snapshot and parses using `DOMParser`
- For full report: Fetches `07-full-report.html` when user clicks "View Full Report"
- Extracts structured data:
  - Hero section (profile stats)
  - Slider cards (visitors)
  - Stories activity
  - Screenshots
  - Alerts
  - Addicted section
  - CTAs
  - Full report (avatar, features, pricing, marketing text)

**Location:** 
- `frontend/src/utils/parseSnapshot.js` - `parseResultsSnapshot()` (results)
- `frontend/src/utils/parseFullReport.js` - `parseFullReport()` (full report)

### 9. **Data Processing** (Frontend)
- Applies filtering:
  - Removes invalid usernames
  - Filters out non-English content
  - Removes duplicates
- Applies blurring:
  - Blurs sensitive keywords (e.g., "bluredus")
  - Blurs locked profiles
- Transforms data for display

**Location:** `frontend/src/App.jsx` - `useEffect` hooks and helper functions

### 10. **UI Rendering** (Frontend)
- Displays sections in order:
  1. Hero section (profile stats)
  2. Preview header (summary cards)
  3. Profile visitor slider
  4. REVEAL STALKERS button
  5. Stories activity section
  6. REVEAL PROFILES button
  7. Screenshots section
  8. Alert panel
  9. Addicted section
  10. Final CTA

**Location:** `frontend/src/App.jsx` - `renderPreview()` function

### 11. **Full Report Navigation** (Frontend)
- User clicks "View Full Report" button from results page
- Frontend navigates to full report screen
- Fetches `07-full-report.html` snapshot
- Parses using `parseFullReport()` to extract avatar, features, pricing
- Renders structured full report page with hardcoded marketing text

**Location:** `frontend/src/App.jsx` - `handleViewFullReport()`, `renderFullReport()`

### 12. **Real-time Updates** (Frontend)
- Toast notifications for profile visits
- Animated transitions between screens
- Loading states during analysis

**Location:** `frontend/src/App.jsx` - `schedule()` function and state management

## 📊 Data Flow Diagram

```
User Input
    │
    ▼
Frontend (App.jsx)
    │
    │ GET /api/stalkers?username=xxx
    ▼
Backend (server.js)
    │
    │ scrape(username)
    ▼
Scraper (scrape.js)
    │
    │ Playwright automation
    │
    │ Captures snapshots:
    │ - 03-analyzing.html
    │ - 04-profile-confirm.html → parseSnapshots.js (backend parsing)
    │ - 05-processing.html → parseSnapshots.js (backend parsing)
    │ - 06-results.html
    │ - 07-full-report.html
    ▼
Instagram Website
    │
    │ HTML snapshots
    ▼
Snapshots Storage
    │
    │ JSON response with paths + parsed data
    ▼
Frontend (App.jsx)
    │
    │ Progressive Loading:
    │ - Polls for snapshots
    │ - Polls /api/snapshots/parsed
    │ - Updates UI as snapshots arrive
    │
    │ For Results:
    │ │ Fetch 06-results.html
    │ ▼
    │ parseSnapshot.js
    │
    │ For Full Report:
    │ │ Fetch 07-full-report.html
    │ ▼
    │ parseFullReport.js
    │
    │ Parsed data objects
    ▼
App.jsx (State)
    │
    │ React rendering
    ▼
UI Display
```

## 🔑 Key Data Structures

### Backend Response
```javascript
{
  cards: [...],           // Visitor cards
  steps: [
    {
      name: "profile-confirm",
      htmlPath: "...",
      meta: {
        parsedProfileData: {
          avatar: "data:image/...",  // Base64 avatar
          username: "@username",
          greeting: "..."
        }
      }
    },
    // ... more steps
  ],
  profile: {...}         // Basic profile info
}
```

### Backend Parsed Data Endpoint
**GET `/api/snapshots/parsed`**
Returns parsed data for profile and processing stages:
```javascript
{
  profile: {
    avatar: "data:image/...",
    username: "@username",
    greeting: "..."
  },
  processing: {
    bullets: ["bullet 1", "bullet 2", ...]
  }
}
```

### Parsed Analysis Object
```javascript
{
  hero: {
    name: "...",
    profileImage: "...",
    stats: [...],
    visitors: [...]
  },
  summary: {
    cards: [...],
    warning: "..."
  },
  slider: {
    heading: "...",
    cards: [...]
  },
  stories: {
    heading: "...",
    slides: [...]
  },
  screenshots: {...},
  alert: {...},
  addicted: {...},
  ctas: {...}
}
```

## 🎯 Important Points

1. **Snapshots are the source of truth**: All displayed data comes from parsing HTML snapshots
2. **No direct Instagram API**: We scrape the website and parse HTML
3. **Frontend is stateless**: Data is parsed fresh from snapshots each time
4. **Blurring happens client-side**: Sensitive data is blurred during rendering
5. **Real-time notifications**: Simulated based on parsed visitor data

## 🐛 Debugging Workflow

1. **Check backend logs**: Console output shows scraping progress
2. **Inspect snapshots**: Look at `backend/snapshots/<username>/<timestamp>/06-results.html`
3. **Check parsed data**: Use browser console to see `analysis` object
4. **Verify selectors**: Ensure `parseSnapshot.js` selectors match HTML structure

## 🔄 State Transitions

```
LANDING → ANALYZING → PROFILE → PROCESSING → PREVIEW → FULL_REPORT
   │                                          │            │
   └──────────────────────────────────────────┘            │
                    (on error)                               │
                                                             │
                                                             └── (back to PREVIEW)
```

Each state is managed by the `screen` state variable in `App.jsx`.

**Transition Timing:**
- **ANALYZING**: ~7 seconds (progress bar animation to 100%)
- **PROFILE**: 5 seconds minimum (controlled by `PROFILE_STAGE_HOLD_MS`)
- **PROCESSING**: Until all bullet points shown + 1 second (controlled by `PROCESSING_STAGE_HOLD_MS`)
- **PREVIEW**: Until user clicks "View Full Report"
- **FULL_REPORT**: User navigated from preview screen

