/**
 * Verification script to check organization data and user associations
 * Run this to diagnose organization name issues
 * 
 * Usage: npm run verify:org
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import Organization from '../src/models/Organization';
import logger from 'jet-logger';

async function verifyOrganizationData() {
  try {
    // Connect to database
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI environment variable is not set');
    }

    await mongoose.connect(mongoUri);
    logger.info('✅ Connected to MongoDB');

    // Get all organizations
    const orgs = await Organization.find();
    logger.info(`\n📊 Found ${orgs.length} organizations:`);
    
    for (const org of orgs) {
      logger.info(`\n🏢 Organization: ${org.name}`);
      logger.info(`   ID: ${org._id}`);
      logger.info(`   Slug: ${org.slug}`);
      logger.info(`   Owner: ${org.owner}`);
      logger.info(`   Active: ${org.isActive}`);
      logger.info(`   Domain: ${org.domain || 'None'}`);
      
      // Count users in this org
      const userCount = await User.countDocuments({ organizationId: org._id });
      logger.info(`   Users: ${userCount}`);
      
      // Get users for this org
      const users = await User.find({ organizationId: org._id }).select('email name orgRole isApproved isActive');
      if (users.length > 0) {
        logger.info(`   User list:`);
        for (const user of users) {
          logger.info(`      - ${user.email} (${user.orgRole}) - Approved: ${user.isApproved}, Active: ${user.isActive}`);
        }
      }
    }

    // Check for orphaned users (users without organization)
    const orphanedUsers = await User.find({ organizationId: null }).select('email name googleId createdAt');
    if (orphanedUsers.length > 0) {
      logger.info(`\n⚠️  Found ${orphanedUsers.length} users without organization:`);
      for (const user of orphanedUsers) {
        logger.info(`   - ${user.email} (Created: ${user.createdAt})`);
      }
    }

    // Test population on a sample user
    const sampleUser = await User.findOne({ organizationId: { $ne: null } });
    if (sampleUser) {
      logger.info(`\n🧪 Testing organization population on user: ${sampleUser.email}`);
      
      const populatedUser = await User.findById(sampleUser._id)
        .populate('organizationId', 'name slug domain isActive');
      
      if (populatedUser && populatedUser.organizationId) {
        logger.info('   ✅ Population successful!');
        logger.info('   Organization data:');
        console.log(JSON.stringify(populatedUser.organizationId, null, 2));
      } else {
        logger.warn('   ❌ Population failed or organizationId is null');
      }
    }

    logger.info(`\n✅ Verification completed!`);

  } catch (error) {
    logger.err('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run verification
verifyOrganizationData();
