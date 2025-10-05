import mongoose from 'mongoose';
import logger from 'jet-logger';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoURI);
    
    logger.info('✅ MongoDB Atlas connected successfully');
    
    // Access db name only after connection is established
    const dbName = mongoose.connection.db?.databaseName;
    if (dbName) {
      logger.info(`📊 Database: ${dbName}`);
    }
  } catch (error) {
    logger.err('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.err('❌ MongoDB error:', err);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed through app termination');
  process.exit(0);
});

export default connectDB;