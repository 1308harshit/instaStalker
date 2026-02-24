import mongoose from 'mongoose';

const connectMongoose = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME,
      // These options are no longer needed in Mongoose 6+, but harmless
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });

    console.log(`✅ Mongoose Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Mongoose Connection Error: ${error.message}`);
    // Don't exit process, let the app run even if DB fails temporarily
  }
};

export default connectMongoose;
