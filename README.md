# Instagram Stalker Scraper

Full-stack application to scrape stalker cards from oseguidorsecreto.com

## Project Structure

```
insta-scraper/
├── backend/
│   ├── scraper/
│   │   ├── scrape.js
│   │   ├── selectors.js
│   │   └── browser.js
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

