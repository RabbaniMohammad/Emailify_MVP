/**
 * Migration Script: Add Composite Unique Index for Multi-Org Support
 * 
 * This script:
 * 1. Drops old unique indexes on email and googleId
 * 2. Adds composite unique index on (email + organizationId)
 * 
 * Run with: npm run ts-node scripts/add-composite-index.ts
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root directory ONLY
const envPath = path.resolve(__dirname, '../.env');
logger.info(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath, override: true });

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  logger.err('❌ MONGODB_URI not found in .env file!');
  process.exit(1);
}

logger.info(`Using MongoDB URI: ${MONGODB_URI.substring(0, 50)}...`);

async function addCompositeIndex() {
  try {
    logger.info('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db?.collection('users');

    if (!collection) {
      throw new Error('Users collection not found');
    }

    logger.info('📋 Listing existing indexes...');
    const indexes = await collection.indexes();
    const indexNames = indexes.map(i => i.name).join(', ');
    logger.info(`Found ${indexes.length} indexes: ${indexNames}`);

    // Drop old unique indexes if they exist
    logger.info('🗑️  Dropping old unique indexes...');
    
    try {
      await collection.dropIndex('email_1');
      logger.info('✅ Dropped email_1 index');
    } catch (err: any) {
      if (err.codeName === 'IndexNotFound') {
        logger.info('⚠️  email_1 index not found (already removed or never existed)');
      } else {
        logger.warn('⚠️  Error dropping email_1 index:', err.message);
      }
    }

    try {
      await collection.dropIndex('googleId_1');
      logger.info('✅ Dropped googleId_1 index');
    } catch (err: any) {
      if (err.codeName === 'IndexNotFound') {
        logger.info('⚠️  googleId_1 index not found (already removed or never existed)');
      } else {
        logger.warn('⚠️  Error dropping googleId_1 index:', err.message);
      }
    }

    // Create composite unique index
    logger.info('🔨 Creating composite unique index on (email + organizationId)...');
    
    await collection.createIndex(
      { email: 1, organizationId: 1 },
      { 
        unique: true,
        name: 'email_organizationId_unique',
        // Allow null organizationId for users being created
        partialFilterExpression: { organizationId: { $exists: true } }
      }
    );
    
    logger.info('✅ Created composite unique index: email_organizationId_unique');

    // Verify final indexes
    logger.info('📋 Final index list:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach((index) => {
      logger.info(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });

    logger.info('✅ Migration completed successfully!');
    logger.info('');
    logger.info('📝 Summary:');
    logger.info('  - Same email can now exist in multiple organizations');
    logger.info('  - Each (email + org) combination is unique');
    logger.info('  - Users can have different roles in different orgs');
    
  } catch (error) {
    logger.err('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the migration
addCompositeIndex();
