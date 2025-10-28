/**
 * Database cleanup script to remove duplicate users
 * Run this script to fix duplicate user issues in production
 * 
 * Usage: npm run cleanup:users
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import logger from 'jet-logger';

async function cleanupDuplicateUsers() {
  try {
    // Connect to database
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI environment variable is not set');
    }

    await mongoose.connect(mongoUri);
    logger.info('✅ Connected to MongoDB');

    // Find all users grouped by googleId and organizationId
    const users = await User.find().sort({ createdAt: 1 });
    
    // Group by googleId + organizationId combination
    const userMap = new Map<string, any[]>();
    
    for (const user of users) {
      const key = `${user.googleId}-${user.organizationId || 'null'}`;
      if (!userMap.has(key)) {
        userMap.set(key, []);
      }
      userMap.get(key)!.push(user);
    }

    let duplicatesFound = 0;
    let duplicatesRemoved = 0;

    // Process each group
    for (const [key, userGroup] of userMap.entries()) {
      if (userGroup.length > 1) {
        duplicatesFound++;
        logger.info(`\n🔍 Found ${userGroup.length} duplicates for key: ${key}`);
        
        // Keep the oldest user (first created) or the one with super_admin role
        const userToKeep = userGroup.find(u => u.orgRole === 'super_admin') || userGroup[0];
        const usersToDelete = userGroup.filter(u => u._id.toString() !== userToKeep._id.toString());
        
        logger.info(`   ✅ Keeping user: ${userToKeep.email} (ID: ${userToKeep._id}, Role: ${userToKeep.orgRole}, Created: ${userToKeep.createdAt})`);
        
        for (const userToDelete of usersToDelete) {
          logger.info(`   ❌ Deleting duplicate: ${userToDelete.email} (ID: ${userToDelete._id}, Role: ${userToDelete.orgRole}, Created: ${userToDelete.createdAt})`);
          await User.findByIdAndDelete(userToDelete._id);
          duplicatesRemoved++;
        }
      }
    }

    logger.info(`\n📊 Cleanup Summary:`);
    logger.info(`   Total users processed: ${users.length}`);
    logger.info(`   Duplicate groups found: ${duplicatesFound}`);
    logger.info(`   Duplicate records removed: ${duplicatesRemoved}`);
    logger.info(`   Remaining users: ${users.length - duplicatesRemoved}`);

    if (duplicatesRemoved === 0) {
      logger.info(`\n✅ No duplicates found! Database is clean.`);
    } else {
      logger.info(`\n✅ Cleanup completed successfully!`);
    }

  } catch (error) {
    logger.err('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run cleanup
cleanupDuplicateUsers();
