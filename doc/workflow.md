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

### 5. **Response to Frontend** (Backend)
- Backend returns JSON with:
  - `cards`: Array of visitor cards
  - `steps`: Array of snapshot paths
  - `profile`: Basic profile info

**Location:** `backend/server.js` - Response JSON

### 6. **Data Parsing** (Frontend)
- Frontend receives the response
- Fetches `06-results.html` snapshot
- Parses HTML using `DOMParser`
- Extracts structured data:
  - Hero section (profile stats)
  - Slider cards (visitors)
  - Stories activity
  - Screenshots
  - Alerts
  - Addicted section
  - CTAs

**Location:** `frontend/src/utils/parseSnapshot.js` - `parseResultsSnapshot()`

### 7. **Data Processing** (Frontend)
- Applies filtering:
  - Removes invalid usernames
  - Filters out non-English content
  - Removes duplicates
- Applies blurring:
  - Blurs sensitive keywords (e.g., "bluredus")
  - Blurs locked profiles
- Transforms data for display

**Location:** `frontend/src/App.jsx` - `useEffect` hooks and helper functions

### 8. **UI Rendering** (Frontend)
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

### 9. **Real-time Updates** (Frontend)
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
    ▼
Instagram Website
    │
    │ HTML snapshots
    ▼
Snapshots Storage
    │
    │ JSON response with paths
    ▼
Frontend (App.jsx)
    │
    │ Fetch 06-results.html
    ▼
parseSnapshot.js
    │
    │ Parsed data object
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
  steps: [...],          // Snapshot paths
  profile: {...}         // Basic profile info
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
LANDING → ANALYZING → PROFILE → PROCESSING → PREVIEW
   │                                          │
   └──────────────────────────────────────────┘
                    (on error)
```

Each state is managed by the `screen` state variable in `App.jsx`.

