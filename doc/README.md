# Instagram Profile Analyzer - Project Documentation

## 📋 Project Overview

This is an Instagram profile analyzer application that scrapes Instagram profile data, analyzes visitor activity, stories, and generates a comprehensive report. The project consists of two main parts:

1. **Backend**: Node.js/Express server with Playwright for web scraping
2. **Frontend**: React application that displays the analyzed data

## 🏗️ Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Frontend  │ ──────> │   Backend   │ ──────> │  Instagram  │
│   (React)   │ <────── │  (Express)  │ <────── │   Website   │
└─────────────┘         └─────────────┘         └─────────────┘
                              │
                              ▼
                        ┌─────────────┐
                        │  Snapshots  │
                        │   (HTML)    │
                        └─────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Backend Setup
```bash
cd backend
npm install
npm start  # Server runs on http://localhost:3000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev  # Development server (usually http://localhost:5173)
```

## 📁 Project Structure

```
project-root/
├── backend/              # Backend server and scraper
│   ├── server.js        # Express API server
│   ├── scraper/         # Web scraping logic
│   │   ├── browser.js   # Browser launch configuration
│   │   ├── scrape.js    # Main scraping orchestration
│   │   └── selectors.js # CSS selectors for Instagram elements
│   └── snapshots/       # Saved HTML snapshots (generated)
│
├── frontend/            # React frontend application
│   ├── src/
│   │   ├── App.jsx      # Main React component
│   │   ├── App.css      # Main stylesheet
│   │   ├── main.jsx     # React entry point
│   │   └── utils/
│   │       ├── parseSnapshot.js  # HTML parsing utility (results)
│   │       └── parseFullReport.js # HTML parsing utility (full report)
│   └── package.json
│
└── doc/                 # Documentation (this folder)
```

## 📚 Documentation Index

1. **[Workflow Guide](./workflow.md)** - Complete process flow from user input to result display
2. **[Frontend Developer Guide](./frontend-guide.md)** - Detailed guide for frontend work
3. **[Backend Guide](./backend-guide.md)** - Backend architecture and API reference
4. **[File Structure Reference](./file-structure.md)** - What each file does

## 🎯 Key Features

- **Progressive Loading**: Real-time UI updates as snapshots become available
- **Profile Analysis**: Extracts profile stats (posts, followers, following)
- **Visitor Tracking**: Identifies profile visitors with visit counts
- **Stories Activity**: Parses and displays story interactions
- **Screenshots Recovery**: Shows recovered screenshots
- **Full Report Page**: Complete report with pricing and features
- **Smart Blurring**: Automatically blurs sensitive information
- **Real-time Notifications**: Toast notifications for profile visits
- **Avatar Extraction**: Dynamically extracts and converts base64 avatars from snapshots

## 🔧 Technology Stack

**Backend:**
- Node.js
- Express.js
- Playwright (web scraping)
- CORS

**Frontend:**
- React 18
- Vite (build tool)
- CSS3

## 📝 Important Notes

- The backend scrapes Instagram and saves HTML snapshots
- The frontend uses **progressive loading** - polls for snapshots and updates UI in real-time
- The backend parses profile and processing snapshots server-side for faster data extraction
- The frontend parses results and full report snapshots client-side
- All data is dynamically extracted from the HTML snapshots
- Avatar images are extracted from base64 data in snapshots and converted for display
- The application handles sensitive data with automatic blurring
- Screen transitions are controlled with minimum hold times for better UX

## 🤝 For Frontend Developers

**Start here:** [Frontend Developer Guide](./frontend-guide.md)

This guide contains:
- Where to work on the frontend
- File-by-file explanation
- Common tasks and modifications
- Styling guidelines
- Data flow understanding

