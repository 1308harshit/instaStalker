# MongoDB Migration Guide

## ✅ Implementation Complete

The application has been successfully migrated from filesystem-based snapshot storage to MongoDB with automatic 10-minute cleanup.

## 🎯 What Changed

### 1. **MongoDB Integration**
- All snapshots are now stored in MongoDB instead of filesystem
- Works perfectly on Vercel (serverless) - no filesystem needed
- Automatic cleanup after 10 minutes using MongoDB TTL index

### 2. **New Files Created**

#### `backend/utils/mongodb.js`
- MongoDB connection management
- Functions for saving/retrieving snapshots
- TTL index setup for 10-minute auto-deletion

#### `backend/utils/queue.js`
- Request queue for handling concurrent users
- Prevents duplicate scrapes for the same username
- Multiple users can use the service simultaneously

### 3. **Modified Files**

#### `backend/scraper/scrape.js`
- Removed filesystem operations (`mkdir`, `writeFile`)
- Now saves snapshots directly to MongoDB
- Returns API endpoints instead of file paths

#### `backend/server.js`
- Added `/api/snapshots/:snapshotId/:stepName` endpoint
- Integrated request queue for concurrent handling
- Added caching (checks for recent snapshots before scraping)
- Removed dependency on filesystem for snapshots

### 4. **Frontend**
- ✅ **No changes needed!** 
- Frontend already uses `API_BASE` which works with new endpoints
- Existing code automatically works with MongoDB-based snapshots

## 📊 MongoDB Schema

```javascript
{
  _id: ObjectId,
  instagramUsername: "harshit_1308",
  runId: "1764258084316",
  createdAt: ISODate,  // Used for TTL (10 minutes)
  status: "completed" | "processing" | "failed",
  steps: [
    {
      name: "landing",
      html: "<html>...</html>",  // Full HTML stored
      capturedAt: ISODate,
      meta: { ... }
    },
    // ... other steps
  ],
  cards: [
    { username: "@user1", image: "..." }
  ],
  completedAt: ISODate
}
```

## 🔄 How It Works

### Request Flow:
1. User requests analysis for username
2. Backend checks MongoDB for recent snapshot (cache check)
3. If found → return cached result immediately
4. If not found → add to queue → scrape → save to MongoDB → return result
5. Multiple requests for same username → queue handles (no duplicate scrapes)

### Snapshot Serving:
- Frontend receives `htmlPath: "/api/snapshots/:snapshotId/:stepName"`
- Frontend fetches from `/api/snapshots/:snapshotId/:stepName`
- Backend retrieves HTML from MongoDB and serves it
- After 10 minutes, MongoDB automatically deletes the snapshot

## ⚙️ Configuration

### Environment Variables
```bash
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DB_NAME=insta_analyzer
```

### TTL Index
- Automatically created on first connection
- Deletes snapshots 10 minutes after `createdAt`
- No manual cleanup needed

## 🚀 Benefits

1. **Vercel Compatible**: No filesystem needed (serverless-friendly)
2. **Concurrent Users**: Queue handles multiple requests simultaneously
3. **Auto Cleanup**: Snapshots deleted after 10 minutes automatically
4. **Caching**: Recent snapshots returned instantly (no re-scraping)
5. **No Duplicate Scrapes**: Same username = shared result
6. **Scalable**: MongoDB handles thousands of snapshots

## 📝 API Endpoints

### GET `/api/stalkers?username=<username>`
- Initiates scraping or returns cached result
- Returns snapshot paths pointing to MongoDB

### GET `/api/snapshots/:snapshotId/:stepName`
- Serves HTML snapshot from MongoDB
- Example: `/api/snapshots/507f1f77bcf86cd799439011/results`

## 🔍 Testing

1. **Single User Test**:
   ```bash
   curl http://localhost:3000/api/stalkers?username=test_user
   ```

2. **Concurrent Users Test**:
   ```bash
   # Run multiple requests simultaneously
   curl http://localhost:3000/api/stalkers?username=user1 &
   curl http://localhost:3000/api/stalkers?username=user2 &
   curl http://localhost:3000/api/stalkers?username=user1 &  # Should use cached/queued result
   ```

3. **Cache Test**:
   ```bash
   # First request - scrapes
   curl http://localhost:3000/api/stalkers?username=test_user
   # Second request within 60 minutes - returns cached
   curl http://localhost:3000/api/stalkers?username=test_user
   ```

## ⚠️ Important Notes

1. **10-Minute Cleanup**: Snapshots are automatically deleted after 10 minutes
   - Scraping takes < 60 seconds
   - Frontend preview ends in < 2 minutes
   - Nobody returns to old snapshots
   - No broken UI

2. **MongoDB Connection**: Connection is established on first use
   - If MongoDB is unavailable, scraping will fail gracefully
   - Check MongoDB connection in logs

3. **Queue Behavior**: 
   - Same username = waits for existing scrape
   - Different usernames = processed concurrently
   - No limit on concurrent different usernames

4. **Storage**: HTML snapshots can be large
   - MongoDB handles this efficiently
   - Consider compression if storage becomes an issue

## 🐛 Troubleshooting

### Snapshots not saving
- Check MongoDB connection in logs
- Verify `MONGODB_URI` environment variable
- Check MongoDB network access (IP whitelist)

### Snapshots not deleting
- Check TTL index exists: `db.snapshots.getIndexes()`
- Verify `createdAt` field is being set
- TTL deletion happens automatically (not instant)

### Concurrent requests failing
- Check queue logs
- Verify MongoDB connection is stable
- Check for MongoDB connection limits

## 📚 Related Files

- `backend/utils/mongodb.js` - MongoDB operations
- `backend/utils/queue.js` - Request queue
- `backend/scraper/scrape.js` - Scraping logic (updated)
- `backend/server.js` - API server (updated)

