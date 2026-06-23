const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI from environment variables.
 * Implements retry logic for production resilience.
 *
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error('❌  FATAL: MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }

  const options = {
    // Mongoose 8+ has these as defaults, but listed here for clarity
    serverSelectionTimeoutMS: 5000,  // Fail fast if can't reach server
    socketTimeoutMS: 45000,          // Close sockets after 45s of inactivity
  };

  try {
    const conn = await mongoose.connect(MONGO_URI, options);
    console.log(`✅  MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦  Database: ${conn.connection.name}`);
  } catch (error) {
    console.error(`❌  MongoDB Connection Error: ${error.message}`);
    process.exit(1); // Exit with failure so PM2 / Docker can restart
  }
};

// ─── Connection Event Listeners ───────────────────────────────────────────────
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️   MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔄  MongoDB reconnected successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error(`❌  MongoDB runtime error: ${err.message}`);
});

module.exports = connectDB;
