import { MongoClient, ObjectId } from "mongodb";

// Validate required environment variables (will be checked when functions are called)
const getMongoDBUri = () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("❌ MONGODB_URI environment variable is required. Please set it in .env file or Railway environment variables.");
  }
  return uri;
};

const getDBName = () => {
  const name = process.env.MONGODB_DB_NAME;
  if (!name) {
    throw new Error("❌ MONGODB_DB_NAME environment variable is required. Please set it in .env file or Railway environment variables.");
  }
  return name;
};

const SNAPSHOTS_COLLECTION = "snapshots";

let dbClient = null;
let db = null;

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || "");
};

/**
 * Connect to MongoDB
 */
export async function connectDB() {
  try {
    if (!dbClient || !db) {
      const MONGODB_URI = getMongoDBUri();
      const DB_NAME = getDBName();
      
      const options = {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true,
      };

      dbClient = new MongoClient(MONGODB_URI, options);
      await dbClient.connect();
      await dbClient.db("admin").command({ ping: 1 });
      
      db = dbClient.db(DB_NAME);
      
      // Setup TTL index for 10-minute auto-deletion
      await setupTTLIndex();
      
      log('✅ MongoDB connected successfully');
    }
    return db;
  } catch (err) {
    log('❌ MongoDB connection error:', err.message);
    if (dbClient) {
      try {
        await dbClient.close();
      } catch (closeErr) {
        // Ignore close errors
      }
      dbClient = null;
      db = null;
    }
    return null;
  }
}

/**
 * Setup TTL index to auto-delete snapshots after 10 minutes
 */
async function setupTTLIndex() {
  try {
    const database = await connectDB();
    if (!database) return;
    
    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    // Create TTL index on createdAt field (10 minutes = 600 seconds)
    await collection.createIndex(
      { createdAt: 1 },
      { 
        expireAfterSeconds: 600, // 10 minutes
        name: "snapshots_ttl_index"
      }
    );
    
    log('✅ TTL index created for snapshots (10 minutes)');
  } catch (err) {
    // Index might already exist, that's okay
    if (err.code !== 85) { // 85 = IndexOptionsConflict
      log('⚠️  Error creating TTL index:', err.message);
    }
  }
}

/**
 * Save snapshot step to MongoDB
 * Returns the snapshot document ID
 */
export async function saveSnapshotStep(instagramUsername, runId, stepName, html, meta = {}) {
  try {
    const database = await connectDB();
    if (!database) {
      log('⚠️  MongoDB not available, cannot save snapshot');
      return null;
    }

    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    const stepData = {
      name: stepName,
      html: html,
      capturedAt: new Date(),
      meta: { ...meta, capturedAt: new Date().toISOString() }
    };

    // Upsert: create document if doesn't exist, or update if it does
    const result = await collection.updateOne(
      { 
        instagramUsername: instagramUsername,
        runId: runId 
      },
      {
        $setOnInsert: {
          instagramUsername: instagramUsername,
          runId: runId,
          createdAt: new Date(), // This is used for TTL deletion
          status: "processing"
        },
        $push: {
          steps: stepData
        }
      },
      { upsert: true }
    );

    // Get the document ID
    let snapshotId = null;
    if (result.upsertedId) {
      snapshotId = result.upsertedId.toString();
    } else {
      // Document already exists, fetch it to get ID
      const doc = await collection.findOne({
        instagramUsername: instagramUsername,
        runId: runId
      });
      snapshotId = doc?._id?.toString() || null;
    }

    log(`📝 Snapshot step saved: ${instagramUsername}/${runId}/${stepName}`);
    return { stepData, snapshotId };
  } catch (err) {
    log(`❌ Error saving snapshot step: ${err.message}`);
    return null;
  }
}

/**
 * Save final snapshot result with cards
 */
export async function saveSnapshotResult(instagramUsername, runId, cards, steps) {
  try {
    const database = await connectDB();
    if (!database) {
      log('⚠️  MongoDB not available, cannot save snapshot result');
      return null;
    }

    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    await collection.updateOne(
      { 
        instagramUsername: instagramUsername,
        runId: runId 
      },
      {
        $set: {
          cards: cards,
          status: "completed",
          completedAt: new Date()
        }
      }
    );

    log(`✅ Snapshot result saved: ${instagramUsername}/${runId} with ${cards.length} cards`);
    return true;
  } catch (err) {
    log(`❌ Error saving snapshot result: ${err.message}`);
    return false;
  }
}

/**
 * Get snapshot by ID and step name
 */
export async function getSnapshotStep(snapshotId, stepName) {
  try {
    const database = await connectDB();
    if (!database) {
      return null;
    }

    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    const snapshot = await collection.findOne({
      _id: new ObjectId(snapshotId)
    });

    if (!snapshot) {
      return null;
    }

    const step = snapshot.steps?.find(s => s.name === stepName);
    return step ? step.html : null;
  } catch (err) {
    log(`❌ Error getting snapshot step: ${err.message}`);
    return null;
  }
}

/**
 * Get snapshot by username and runId
 */
export async function getSnapshotByRunId(instagramUsername, runId) {
  try {
    const database = await connectDB();
    if (!database) {
      return null;
    }

    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    const snapshot = await collection.findOne({
      instagramUsername: instagramUsername,
      runId: runId,
      status: "completed"
    });

    return snapshot;
  } catch (err) {
    log(`❌ Error getting snapshot: ${err.message}`);
    return null;
  }
}

/**
 * Check if recent snapshot exists (cache check)
 */
export async function getRecentSnapshot(instagramUsername, maxAgeMinutes = 60) {
  try {
    const database = await connectDB();
    if (!database) {
      return null;
    }

    const collection = database.collection(SNAPSHOTS_COLLECTION);
    
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    
    const snapshot = await collection.findOne({
      instagramUsername: instagramUsername,
      createdAt: { $gte: cutoffTime },
      status: "completed"
    }, { 
      sort: { createdAt: -1 } 
    });

    return snapshot;
  } catch (err) {
    log(`❌ Error checking recent snapshot: ${err.message}`);
    return null;
  }
}

/**
 * Close MongoDB connection
 */
export async function closeDB() {
  try {
    if (dbClient) {
      await dbClient.close();
      dbClient = null;
      db = null;
      log('✅ MongoDB connection closed');
    }
  } catch (err) {
    log('⚠️  Error closing MongoDB connection:', err.message);
  }
}

