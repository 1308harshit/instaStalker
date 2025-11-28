# Frontend Developer Guide

## 🎯 Welcome!

This guide is specifically for frontend developers working on this project. It explains where to work, what each file does, and how to make common modifications.

## 📍 Where to Work

**Primary Working Directory:** `frontend/src/`

The main files you'll be working with:
- `App.jsx` - Main React component (most of your work here)
- `App.css` - All styling (CSS)
- `utils/parseSnapshot.js` - HTML parsing logic for results page
- `utils/parseFullReport.js` - HTML parsing logic for full report page

## 📁 File-by-File Breakdown

### 1. `frontend/src/main.jsx`
**Purpose:** React application entry point

**What it does:**
- Renders the root `App` component
- Imports global CSS
- Sets up React StrictMode

**When to modify:**
- Rarely. Only if you need to add providers, context, or global setup.

---

### 2. `frontend/src/App.jsx` ⭐ **MAIN FILE**
**Purpose:** Main React component containing all application logic and UI

**Key Sections:**

#### **Constants & Configuration** (Lines 1-50)
```javascript
const API_URL = "http://localhost:3000/api/stalkers";
const SCREEN = { LANDING, ANALYZING, PROFILE, PROCESSING, PREVIEW, FULL_REPORT, ERROR };
const BLUR_KEYWORD_REGEX = /bluredus/i;
const INVALID_USERNAME_REGEX = /unknown/i;
const ANALYZING_STAGE_HOLD_MS = 1500;
const PROFILE_STAGE_HOLD_MS = 5000;
const PROCESSING_STAGE_HOLD_MS = 2000;
```
- API endpoint configuration
- Screen state constants (including FULL_REPORT)
- Regex patterns for filtering/blurring
- Stage hold times for controlled transitions

**When to modify:**
- Change API URL
- Add new screen states
- Adjust filtering rules

#### **State Management** (Lines 50-100)
```javascript
const [screen, setScreen] = useState(SCREEN.LANDING);
const [profile, setProfile] = useState(INITIAL_PROFILE);
const [analysis, setAnalysis] = useState(null);
const [notifications, setNotifications] = useState([]);
```
- Manages current screen/view
- Stores profile data
- Stores parsed analysis data
- Manages toast notifications

**When to modify:**
- Add new state variables
- Change initial values

#### **Helper Functions** (Lines 100-200)
- `isValidUsername()` - Validates usernames
- `splitSensitiveSegments()` - Splits text for blurring
- `renderSensitiveText()` - Renders text with blurring
- `schedule()` - Creates toast notifications

**When to modify:**
- Change blurring logic
- Adjust validation rules
- Modify notification behavior

#### **API Integration & Progressive Loading** (Lines 200-400)
```javascript
const handleStart = async (username) => {
  // Initiates API call
  // Starts snapshot polling
  // Monitors for snapshot files
};

const monitorSnapshots = () => {
  // Polls for snapshot files
  // Updates UI as snapshots become available
  // Fetches parsed data from backend
};

const fetchParsedSnapshots = async () => {
  // Polls /api/snapshots/parsed endpoint
  // Gets server-side parsed data (profile, processing)
};
```
- Handles API calls
- **Progressive loading**: Polls for snapshots and updates UI in real-time
- Fetches HTML snapshots as they become available
- Fetches backend-parsed data for profile and processing stages
- Triggers client-side parsing for results and full report

**When to modify:**
- Change API request format
- Add error handling
- Modify data fetching logic

#### **Rendering Functions** (Lines 300-800)
- `renderLanding()` - Landing page UI
- `renderAnalyzing()` - Loading screen with progress bar animation
- `renderProfile()` - Profile confirmation (redesigned with greeting)
- `renderProcessing()` - Processing screen with animated bullet points
- `renderPreview()` - **Main results display** ⭐
- `renderFullReport()` - **Full report page** ⭐ (new)

**When to modify:**
- Change UI layout
- Add new sections
- Modify styling classes
- Reorder sections

#### **Main Render** (Lines 700+)
```javascript
return (
  <div className="app">
    {screen === SCREEN.LANDING && renderLanding()}
    {screen === SCREEN.PREVIEW && renderPreview()}
    {/* ... */}
  </div>
);
```

**When to modify:**
- Add new screen conditions
- Add global components (modals, overlays)

---

### 3. `frontend/src/App.css` ⭐ **STYLING FILE**
**Purpose:** All CSS styles for the application

**Key Sections:**

#### **Global Styles**
- `.app` - Root container
- `.screen` - Base screen styles
- `.primary-btn`, `.secondary-btn` - Button styles

#### **Component Styles**
- `.hero-panel` - Profile stats section
- `.slider-section` - Visitor carousel
- `.stories-section` - Stories activity grid
- `.story-card` - Individual story card
- `.story-hero-info` - Hero username/photo overlay (top-right)
- `.story-bottom-overlay` - Story text overlay (bottom-left)
- `.screenshots-panel` - Screenshots section
- `.alert-panel` - Alert notifications
- `.addicted-panel` - "Addicted to you" section

#### **Utility Classes**
- `.blurred-text` - Blurred text effect
- `.slider-card--blurred` - Blurred profile card
- `.slider-card--locked` - Locked profile card

**When to modify:**
- Change colors, fonts, spacing
- Adjust layouts
- Add animations
- Modify responsive breakpoints

**Common Tasks:**
- Change button colors → `.primary-btn`, `.secondary-btn`
- Adjust card spacing → `.slider-card`, `.story-card`
- Modify blur effect → `.blurred-text`, `.slider-card--blurred`
- Change story layout → `.story-card`, `.story-hero-info`, `.story-bottom-overlay`

---

### 4. `frontend/src/utils/parseSnapshot.js` ⭐ **PARSING LOGIC (RESULTS)**
**Purpose:** Parses `06-results.html` snapshot and extracts structured data

**Key Functions:**

#### **`parseResultsSnapshot(html)`**
Main parsing function that:
1. Creates DOM parser
2. Queries HTML elements
3. Extracts data into structured object
4. Returns analysis object

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

**Helper Functions:**
- `clean()` - Cleans whitespace
- `extractBackgroundImage()` - Gets CSS background-image URL
- `normalizeImageUrl()` - Normalizes URLs for comparison
- `isSameImage()` - Compares two image URLs
- `extractUsername()` - Extracts @username from text
- `queryAll()` - Safe querySelectorAll wrapper

**When to modify:**
- HTML structure changes on Instagram
- Need to extract new data fields
- Selectors need updating
- Image extraction logic needs refinement

**Important:** This file uses `DOMParser` which only works in the browser. It won't work in Node.js.

---

### 5. `frontend/src/utils/parseFullReport.js` ⭐ **PARSING LOGIC (FULL REPORT)**
**Purpose:** Parses `07-full-report.html` snapshot and extracts structured data

**Key Functions:**

#### **`parseFullReport(html)`**
Main parsing function that:
1. Creates DOM parser
2. Extracts avatar from base64 background-image styles
3. Extracts features, pricing, marketing text
4. Returns structured full report object

**Returns:**
```javascript
{
  avatar: "data:image/png;base64,...",  // Extracted from background-image
  heading: "Unlock Complete Report",
  features: [...],
  pricing: { current, original, discount },
  cta: "...",
  bonus: "...",
  guarantee: "..."
}
```

**Avatar Extraction:**
- Looks for `div[class*='rounded-full']` with `background-image` style
- Extracts base64 data from `url(&quot;data:image/...&quot;)` pattern
- Cleans HTML entities (`&quot;`, `&amp;`)
- Validates it's a complete base64 image string

**When to modify:**
- HTML structure changes on full report page
- Need to extract new data fields
- Avatar extraction needs refinement
- Selectors need updating

**Important:** This file uses `DOMParser` which only works in the browser.

---

### 6. `frontend/src/index.css`
**Purpose:** Global CSS reset and base styles

**When to modify:**
- Change global font family
- Modify CSS reset rules
- Add global variables

---

## 🎨 Common Frontend Tasks

### Task 0: Understanding Progressive Loading
**How it works:**
1. User clicks "Start Analysis"
2. Frontend calls API and starts polling for snapshots
3. As snapshots become available, UI updates:
   - `03-analyzing.html` → Shows analyzing screen with progress bar
   - `04-profile-confirm.html` → Shows profile confirmation (parsed from backend)
   - `05-processing.html` → Shows processing with bullet points (parsed from backend)
   - `06-results.html` → Shows preview/results page
   - `07-full-report.html` → Available when user clicks "View Full Report"

**Key Functions:**
- `monitorSnapshots()` - Polls for snapshot files
- `fetchParsedSnapshots()` - Polls `/api/snapshots/parsed` for backend-parsed data
- `registerSnapshot()` - Updates snapshot state
- `fetchSnapshotHtml()` - Fetches HTML and strips scripts

**Screen Transitions:**
- Controlled by `canAdvance` flags and hold timers
- Analyzing: ~7 seconds (progress bar animation)
- Profile: 5 seconds minimum
- Processing: Until all bullets shown + 1 second

---

### Task 1: Change Section Order
**File:** `frontend/src/App.jsx`
**Location:** `renderPreview()` function

```javascript
// Current order in renderPreview():
1. hero-panel
2. preview-header
3. slider-section
4. revealStalkersCta
5. stories-section
6. revealProfilesCta
7. screenshots-panel
8. alert-panel
9. addicted-panel
10. cta-block final
```

**To reorder:** Move JSX blocks around in the return statement.

---

### Task 2: Modify Story Card Layout
**File:** `frontend/src/App.jsx` and `frontend/src/App.css`

**In App.jsx:**
- Find `.stories-section` in `renderPreview()`
- Modify `.story-card` structure

**In App.css:**
- Modify `.story-card` styles
- Adjust `.story-hero-info` (top-right overlay)
- Adjust `.story-bottom-overlay` (bottom-left overlay)

---

### Task 3: Change Blurring Behavior
**File:** `frontend/src/App.jsx`

**To change blur keyword:**
```javascript
const BLUR_KEYWORD_REGEX = /bluredus/i;  // Change this
```

**To modify blur rendering:**
- Find `renderSensitiveText()` function
- Modify how blurred segments are rendered

---

### Task 4: Add New Section
**Steps:**
1. **Parse data** in `parseSnapshot.js`:
   ```javascript
   // In parseResultsSnapshot()
   analysis.newSection = {
     heading: "...",
     items: [...]
   };
   ```

2. **Render in App.jsx**:
   ```javascript
   // In renderPreview()
   {analysis.newSection && (
     <section className="new-section">
       <h3>{analysis.newSection.heading}</h3>
       {/* Render items */}
     </section>
   )}
   ```

3. **Style in App.css**:
   ```css
   .new-section {
     /* Your styles */
   }
   ```

---

### Task 5: Modify Full Report Page
**Files:** `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/utils/parseFullReport.js`

**In App.jsx:**
- Find `renderFullReport()` function
- Modify layout structure
- Update hardcoded marketing text

**In App.css:**
- Modify `.full-report-*` classes
- Adjust font sizes, spacing, colors
- Update responsive breakpoints

**In parseFullReport.js:**
- Modify avatar extraction logic
- Update feature/pricing extraction
- Change selectors if HTML structure changes

---

### Task 6: Change Colors/Themes
**File:** `frontend/src/App.css`

**Common color variables to change:**
- Button colors: `.primary-btn { background: ... }`
- Card backgrounds: `.slider-card { background: ... }`
- Text colors: Various `.text-*` classes
- Overlay backgrounds: `.story-bottom-overlay { background: ... }`
- Full report: `.full-report-*` classes

---

### Task 7: Adjust Responsive Design
**File:** `frontend/src/App.css`

**Add media queries:**
```css
@media (max-width: 768px) {
  .stories-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## 🔍 Debugging Tips

### 1. Check Parsed Data
```javascript
// In App.jsx, add console.log:
console.log('Analysis:', analysis);
console.log('Stories:', analysis?.stories);
```

### 2. Inspect HTML Snapshots
- Open `backend/snapshots/<username>/<timestamp>/`
- Check `03-analyzing.html`, `04-profile-confirm.html`, `05-processing.html`
- Check `06-results.html` for results page
- Check `07-full-report.html` for full report page
- Verify selectors in `parseSnapshot.js` and `parseFullReport.js` match HTML structure

### 3. Test Parsing
```javascript
// In browser console:
const html = await fetch('/snapshots/.../06-results.html').then(r => r.text());
const analysis = parseResultsSnapshot(html);
console.log(analysis);
```

### 4. Check CSS Classes
- Use browser DevTools to inspect elements
- Verify classes are applied correctly
- Check if styles are being overridden

---

## 📦 Dependencies

**Package.json dependencies:**
- `react` - UI library
- `react-dom` - React DOM rendering

**Dev dependencies:**
- `vite` - Build tool
- `@vitejs/plugin-react` - React plugin for Vite

**No external UI libraries** - All styling is custom CSS.

---

## 🚀 Development Workflow

1. **Start dev server:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Make changes:**
   - Edit `App.jsx` for logic/UI
   - Edit `App.css` for styling
   - Edit `parseSnapshot.js` for parsing

3. **Test:**
   - Enter username in landing screen
   - Wait for analysis
   - Check preview screen

4. **Build for production:**
   ```bash
   npm run build
   ```

---

## ⚠️ Important Notes

1. **Progressive Loading** - UI updates as snapshots become available, no hardcoded delays
2. **Data comes from HTML parsing** - All displayed data is extracted from HTML snapshots
3. **Backend Parsing** - Profile and processing stages are parsed server-side for faster extraction
4. **Client-side Parsing** - Results and full report are parsed client-side using DOMParser
5. **Avatar Extraction** - Avatars are extracted from base64 data in snapshots and converted for display
6. **No direct API calls for data** - Only snapshot paths come from API
7. **Blurring is client-side** - Happens during rendering, not in backend
8. **State is local** - No global state management (Redux, Context, etc.)
9. **CSS-only styling** - No CSS-in-JS or styled-components
10. **Screen Transitions** - Controlled with minimum hold times for better UX

---

## 🎯 Quick Reference

| Task | File | Function/Class |
|------|------|----------------|
| Change layout | `App.jsx` | `renderPreview()`, `renderFullReport()` |
| Modify styles | `App.css` | Component classes, `.full-report-*` |
| Extract new data (results) | `parseSnapshot.js` | `parseResultsSnapshot()` |
| Extract new data (full report) | `parseFullReport.js` | `parseFullReport()` |
| Change blur keyword | `App.jsx` | `BLUR_KEYWORD_REGEX` |
| Add new screen | `App.jsx` | `SCREEN` constant + render function |
| Filter data | `App.jsx` | `filteredSummaryCards`, `isValidUsername` |
| Modify avatar extraction | `parseFullReport.js` | Avatar extraction logic |
| Adjust screen transitions | `App.jsx` | `*_STAGE_HOLD_MS` constants |

---

## 📞 Need Help?

- Check `workflow.md` for process understanding
- Check `file-structure.md` for detailed file explanations
- Inspect browser console for errors
- Check backend logs for API issues

