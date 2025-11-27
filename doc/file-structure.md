# File Structure Reference

This document provides a detailed explanation of what each file does in the project.

## 📂 Project Root

```
project-root/
├── backend/          # Backend server and scraper
├── frontend/         # React frontend application
├── doc/             # Documentation (this folder)
└── README.md        # Project overview
```

---

## 🔷 Backend Files

### `backend/server.js`
**Type:** JavaScript (ES Modules)  
**Purpose:** Express API server  
**Key Responsibilities:**
- Handles HTTP requests
- Serves static snapshot files
- Orchestrates scraping process
- Error handling and logging

**Exports:** None (runs as main script)

**Key Code:**
- `app.get("/api/stalkers")` - Main API endpoint
- `app.use("/snapshots", express.static(...))` - Static file serving
- Server listens on port 3000

---

### `backend/scraper/browser.js`
**Type:** JavaScript (ES Modules)  
**Purpose:** Browser launch configuration  
**Key Responsibilities:**
- Launches Playwright Chromium browser
- Configures browser settings (headless, args)
- Returns browser instance

**Exports:**
- `launchBrowser()` - Returns Playwright browser instance

**Key Code:**
- Uses `chromium.launch()` from Playwright
- Configures headless mode and performance args

---

### `backend/scraper/scrape.js`
**Type:** JavaScript (ES Modules)  
**Purpose:** Main scraping orchestration  
**Key Responsibilities:**
- Coordinates entire scraping flow
- Navigates through Instagram website
- Captures HTML snapshots at each step
- Returns structured result object

**Exports:**
- `scrape(username)` - Main scraping function

**Key Functions:**
- `scrape(username)` - Main orchestration function
- `captureStep(name, meta)` - Saves HTML snapshot

**Dependencies:**
- `browser.js` - For browser instance
- `selectors.js` - For CSS selectors

---

### `backend/scraper/selectors.js`
**Type:** JavaScript (ES Modules)  
**Purpose:** CSS selectors for Instagram elements  
**Key Responsibilities:**
- Defines CSS selectors for finding elements
- Centralizes selector management
- Makes it easy to update when Instagram changes

**Exports:**
- `elements` - Object containing all selectors

**Example Structure:**
```javascript
export const elements = {
  usernameInput: 'input[name="username"]',
  submitButton: 'button[type="submit"]',
  // ... more selectors
};
```

---

### `backend/package.json`
**Type:** JSON  
**Purpose:** Backend dependencies and scripts  
**Key Content:**
- Dependencies: `express`, `playwright`, `cors`
- Scripts: (usually none, runs with `node server.js`)

---

### `backend/snapshots/` (Directory)
**Type:** Generated files  
**Purpose:** Stores HTML snapshots from scraping  
**Structure:**
```
snapshots/
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

**Note:** This directory is generated automatically. Don't commit these files.

---

## 🎨 Frontend Files

### `frontend/src/main.jsx`
**Type:** JavaScript (JSX)  
**Purpose:** React application entry point  
**Key Responsibilities:**
- Renders root `App` component
- Imports global CSS
- Sets up React StrictMode

**Key Code:**
```javascript
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**When to modify:** Rarely. Only for global setup.

---

### `frontend/src/App.jsx` ⭐ **MOST IMPORTANT**
**Type:** JavaScript (JSX)  
**Purpose:** Main React component with all application logic  
**Key Responsibilities:**
- Manages application state
- Handles API calls
- Renders all screens (landing, analyzing, preview, etc.)
- Applies data filtering and blurring
- Manages toast notifications

**Key Sections:**
1. **Constants** - API URLs, screen states, regex patterns
2. **State Management** - `useState` hooks for all state
3. **Helper Functions** - Validation, blurring, notifications
4. **API Integration** - `fetchAnalysis()` function
5. **Render Functions** - `renderLanding()`, `renderPreview()`, etc.
6. **Main Render** - Conditional rendering based on screen state

**Size:** ~700+ lines

**When to modify:** Frequently. Most frontend work happens here.

---

### `frontend/src/App.css` ⭐ **STYLING**
**Type:** CSS  
**Purpose:** All application styles  
**Key Responsibilities:**
- Styles all components
- Defines layouts
- Handles responsive design
- Blur effects and animations

**Key Sections:**
- Global styles (`.app`, `.screen`)
- Button styles (`.primary-btn`, `.secondary-btn`)
- Component styles (`.hero-panel`, `.slider-section`, `.stories-section`)
- Story card styles (`.story-card`, `.story-hero-info`, `.story-bottom-overlay`)
- Utility classes (`.blurred-text`, `.slider-card--blurred`)

**Size:** ~500+ lines

**When to modify:** Frequently. All styling changes happen here.

---

### `frontend/src/utils/parseSnapshot.js` ⭐ **PARSING LOGIC**
**Type:** JavaScript  
**Purpose:** Parses HTML snapshots and extracts structured data  
**Key Responsibilities:**
- Parses HTML using DOMParser
- Extracts data from DOM elements
- Returns structured analysis object
- Handles image URL normalization and comparison

**Key Functions:**
- `parseResultsSnapshot(html)` - Main parsing function
- `clean(value)` - Cleans whitespace
- `extractBackgroundImage(element)` - Gets CSS background-image
- `normalizeImageUrl(url)` - Normalizes URLs for comparison
- `isSameImage(url1, url2)` - Compares image URLs
- `extractUsername(raw)` - Extracts @username from text
- `queryAll(root, selector)` - Safe querySelectorAll wrapper

**Returns:**
```javascript
{
  hero: { name, profileImage, stats, visitors },
  summary: { cards, warning },
  slider: { heading, cards },
  stories: { heading, slides },
  screenshots: { ... },
  alert: { ... },
  addicted: { ... },
  ctas: { ... }
}
```

**When to modify:**
- When HTML structure changes
- Need to extract new data fields
- Selectors need updating
- Image extraction needs refinement

**Note:** Uses browser-only APIs (DOMParser). Won't work in Node.js.

---

### `frontend/src/index.css`
**Type:** CSS  
**Purpose:** Global CSS reset and base styles  
**Key Responsibilities:**
- CSS reset
- Global font settings
- Base element styles

**When to modify:** Rarely. Only for global style changes.

---

### `frontend/package.json`
**Type:** JSON  
**Purpose:** Frontend dependencies and scripts  
**Key Content:**
- Dependencies: `react`, `react-dom`
- Dev Dependencies: `vite`, `@vitejs/plugin-react`, `eslint`
- Scripts: `dev`, `build`, `preview`, `lint`

---

### `frontend/vite.config.js`
**Type:** JavaScript  
**Purpose:** Vite build tool configuration  
**Key Responsibilities:**
- Configures Vite for React
- Sets up build options

**Key Content:**
```javascript
export default defineConfig({
  plugins: [react()],
});
```

**When to modify:** Rarely. Only for build configuration changes.

---

### `frontend/index.html`
**Type:** HTML  
**Purpose:** HTML entry point  
**Key Responsibilities:**
- Root HTML structure
- Links to React app
- Meta tags

**When to modify:** Rarely. Only for meta tags or title changes.

---

## 📊 Data Flow Between Files

```
User Input
    │
    ▼
App.jsx (form submission)
    │
    │ GET /api/stalkers?username=xxx
    ▼
server.js (backend)
    │
    │ scrape(username)
    ▼
scrape.js
    │
    │ Uses browser.js and selectors.js
    ▼
Instagram Website
    │
    │ Saves HTML
    ▼
snapshots/06-results.html
    │
    │ Returns path in JSON
    ▼
App.jsx (fetchAnalysis)
    │
    │ Fetches HTML
    ▼
parseSnapshot.js
    │
    │ Parses and returns analysis object
    ▼
App.jsx (setAnalysis)
    │
    │ Renders with styles
    ▼
App.css
    │
    ▼
UI Display
```

---

## 🎯 File Modification Priority

### For Frontend Developers:

**High Priority (Most Work):**
1. `frontend/src/App.jsx` - Logic and UI
2. `frontend/src/App.css` - Styling

**Medium Priority (Occasional):**
3. `frontend/src/utils/parseSnapshot.js` - When HTML structure changes

**Low Priority (Rarely):**
4. `frontend/src/main.jsx` - Entry point
5. `frontend/src/index.css` - Global styles
6. `frontend/vite.config.js` - Build config

### For Backend Developers:

**High Priority:**
1. `backend/scraper/scrape.js` - Scraping logic
2. `backend/scraper/selectors.js` - Element selectors

**Medium Priority:**
3. `backend/server.js` - API server
4. `backend/scraper/browser.js` - Browser config

---

## 📝 File Naming Conventions

- **JavaScript/JSX:** PascalCase for components (`App.jsx`), camelCase for utilities (`parseSnapshot.js`)
- **CSS:** kebab-case for classes (`.hero-panel`)
- **Directories:** lowercase (`utils/`, `scraper/`)
- **Snapshots:** Numbered with description (`06-results.html`)

---

## 🔍 Finding Code

### "Where is the story card rendered?"
→ `frontend/src/App.jsx` - `renderPreview()` function, `.stories-section`

### "Where are story styles defined?"
→ `frontend/src/App.css` - `.story-card`, `.story-hero-info`, `.story-bottom-overlay`

### "Where is story data parsed?"
→ `frontend/src/utils/parseSnapshot.js` - `parseResultsSnapshot()`, `stories` section

### "Where is the API called?"
→ `frontend/src/App.jsx` - `fetchAnalysis()` function

### "Where are snapshots saved?"
→ `backend/scraper/scrape.js` - `captureStep()` function

### "Where is the blurring logic?"
→ `frontend/src/App.jsx` - `renderSensitiveText()` and `splitSensitiveSegments()` functions

---

## ⚠️ Important Notes

1. **No State Management Library**: Uses React `useState` only
2. **No CSS Framework**: Pure CSS, no Bootstrap/Tailwind
3. **No TypeScript**: Pure JavaScript/JSX
4. **Browser-Only Parsing**: `parseSnapshot.js` uses browser APIs
5. **Static File Serving**: Snapshots served as static files

---

## 📦 Generated Files (Don't Edit)

- `frontend/dist/` - Build output
- `backend/snapshots/` - Generated HTML snapshots
- `node_modules/` - Dependencies (both frontend and backend)

