# Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Step 1: Install Dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

---

### Step 2: Start Backend Server

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
```

**Keep this terminal open!**

---

### Step 3: Start Frontend Dev Server

**Open a new terminal:**
```bash
cd frontend
npm run dev
```

**Expected Output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

### Step 4: Open in Browser

1. Open `http://localhost:5173/` in your browser
2. Enter an Instagram username
3. Click "Analyze"
4. Wait for analysis (30-60 seconds)
5. View results!

---

## 🎯 For Frontend Developers

### Where to Work

**Main Files:**
- `frontend/src/App.jsx` - All UI and logic
- `frontend/src/App.css` - All styling

### Common Tasks

**Change Colors:**
→ Edit `frontend/src/App.css`

**Modify Layout:**
→ Edit `frontend/src/App.jsx` → `renderPreview()` function

**Add New Section:**
1. Parse data in `frontend/src/utils/parseSnapshot.js`
2. Render in `frontend/src/App.jsx`
3. Style in `frontend/src/App.css`

**Change Blurring:**
→ Edit `frontend/src/App.jsx` → `BLUR_KEYWORD_REGEX` constant

---

## 📚 Next Steps

1. Read **[Frontend Developer Guide](./frontend-guide.md)** for detailed instructions
2. Read **[Workflow Guide](./workflow.md)** to understand the process
3. Read **[File Structure Reference](./file-structure.md)** to know what each file does

---

## 🐛 Troubleshooting

### Backend won't start
- Check if port 3000 is already in use
- Make sure Playwright is installed: `npx playwright install`

### Frontend won't start
- Check if port 5173 is already in use
- Make sure all dependencies are installed

### No data showing
- Check browser console for errors
- Verify backend is running
- Check if `06-results.html` exists in snapshots folder

### Images not loading
- Check if snapshot paths are correct
- Verify backend is serving static files correctly
- Check browser network tab

---

## 📞 Need Help?

- Check the detailed guides in this `doc/` folder
- Inspect browser console for errors
- Check backend terminal for logs
- Review the HTML snapshots in `backend/snapshots/`

