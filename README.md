# Instagram Stalker Scraper

Full-stack application to scrape stalker cards from oseguidorsecreto.com

## ⚡ Performance Optimizations

The scraper has been optimized for speed and accuracy:

### Time Savings:
- **Before**: ~45-60 seconds per scrape
- **After**: ~20-35 seconds per scrape (40-50% faster!)

### Optimizations Made:
1. ✅ **Removed fixed 2-second waits** → Now waits for actual page events
2. ✅ **Faster page loading** → Uses `domcontentloaded` instead of `networkidle`
3. ✅ **Smart navigation waiting** → Waits for actual page changes, not fixed timeouts
4. ✅ **Dynamic analysis wait** → Waits for cards to appear instead of fixed 15s wait
5. ✅ **Optimized browser launch** → Disabled unnecessary features for faster startup
6. ✅ **Smarter selector detection** → Tries most common selectors first
7. ✅ **Image loading verification** → Only waits extra if images aren't loaded

## Project Structure

```
insta-scraper/
├── backend/
│   ├── scraper/
│   │   ├── scrape.js       # Optimized scraping logic
│   │   ├── selectors.js
│   │   └── browser.js     # Optimized browser launch
│   ├── server.js
│   └── package.json
└── frontend/
    ├── index.html
    ├── script.js
    └── styles.css
```

## Setup

### Backend

1. Navigate to backend folder:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright Chromium:
```bash
npx playwright install chromium
```

4. Start the server:
```bash
node server.js
```

The API will run on `http://localhost:3000`

### Frontend

1. Open `frontend/index.html` in your browser
2. Or serve it with a local server (e.g., `python -m http.server` in the frontend folder)

## Usage

The frontend automatically fetches data from:
```
http://localhost:3000/api/stalkers?username=harshit_1308
```

Change the username in `frontend/script.js` to scrape different accounts.

## API Endpoint

```
GET /api/stalkers?username=<instagram_username>
```

Returns JSON array with:
- `username`: Instagram username
- `image`: Profile image URL

