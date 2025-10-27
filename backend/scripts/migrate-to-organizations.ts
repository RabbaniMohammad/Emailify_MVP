/**
 * Migration Script: Add Organization Support to Existing Data
 * 
 * This script:
 * 1. Creates a default organization
 * 2. Assigns all existing users to this organization
 * 3. Assigns all existing templates to this organization
 * 4. Assigns all existing conversations to this organization
 * 
 * Usage: ts-node backend/scripts/migrate-to-organizations.ts
 */

import mongoose from 'mongoose';
import Organization from '../src/models/Organization';
import User from '../src/models/User';
import GeneratedTemplate from '../src/models/GeneratedTemplate';
import TemplateConversation from '../src/models/TemplateConversation';
import logger from 'jet-logger';

// Load environment variables
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment');
  process.exit(1);
}

async function migrate() {
  try {
    logger.info('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    // Step 1: Check if default organization already exists
    logger.info('\n📋 Step 1: Checking for default organization...');
    let defaultOrg = await Organization.findOne({ slug: 'default' });

    if (defaultOrg) {
      logger.info(`✅ Default organization already exists: ${defaultOrg.name}`);
    } else {
      logger.info('📝 Creating default organization...');
      
      // Find the first user to make them the owner
      const firstUser = await User.findOne().sort({ createdAt: 1 });
      
      if (!firstUser) {
        logger.warn('⚠️ No users found. Creating organization without owner.');
        defaultOrg = await Organization.create({
          name: 'Default Organization',
          slug: 'default',
          owner: new mongoose.Types.ObjectId(), // Temporary
          isActive: true,
          maxUsers: 100,
          maxTemplates: 10000,
        });
      } else {
        defaultOrg = await Organization.create({
          name: 'Default Organization',
          slug: 'default',
          owner: firstUser._id,
          isActive: true,
          maxUsers: 100,
          maxTemplates: 10000,
        });
        logger.info(`✅ Default organization created with owner: ${firstUser.email}`);
      }
    }

    // Step 2: Migrate users
    logger.info('\n📋 Step 2: Migrating users to default organization...');
    const usersWithoutOrg = await User.find({ 
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    });

    logger.info(`Found ${usersWithoutOrg.length} users without organization`);

    for (const user of usersWithoutOrg) {
      user.organizationId = defaultOrg._id as any;
      
      // Make the owner of the org also have super_admin role
      if (String(user._id) === String(defaultOrg.owner)) {
        user.orgRole = 'super_admin';
      } else {
        user.orgRole = 'member';
      }
      
      await user.save();
      logger.info(`✅ Migrated user: ${user.email} → ${user.orgRole}`);
    }

    // Step 3: Migrate templates
    logger.info('\n📋 Step 3: Migrating templates to default organization...');
    const templatesWithoutOrg = await GeneratedTemplate.find({ 
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    });

    logger.info(`Found ${templatesWithoutOrg.length} templates without organization`);

    if (templatesWithoutOrg.length > 0) {
      // Use updateMany for bulk update to avoid validation issues
      const result = await GeneratedTemplate.updateMany(
        { 
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null }
          ]
        },
        { 
          $set: { organizationId: defaultOrg._id }
        }
      );
      logger.info(`✅ Migrated ${result.modifiedCount} templates to default organization`);
    }

    // Step 4: Migrate conversations
    logger.info('\n📋 Step 4: Migrating conversations to default organization...');
    const conversationsWithoutOrg = await TemplateConversation.find({ 
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    });

    logger.info(`Found ${conversationsWithoutOrg.length} conversations without organization`);

    if (conversationsWithoutOrg.length > 0) {
      // Use updateMany for bulk update
      const result = await TemplateConversation.updateMany(
        { 
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null }
          ]
        },
        { 
          $set: { organizationId: defaultOrg._id }
        }
      );
      logger.info(`✅ Migrated ${result.modifiedCount} conversations to default organization`);
    }

    // Summary
    logger.info('\n🎉 Migration Summary:');
    logger.info(`✅ Organization: ${defaultOrg.name} (${defaultOrg.slug})`);
    logger.info(`✅ Users migrated: ${usersWithoutOrg.length}`);
    logger.info(`✅ Templates ready for migration: ${templatesWithoutOrg.length}`);
    logger.info(`✅ Conversations ready for migration: ${conversationsWithoutOrg.length}`);
    
    logger.info('\n✅ Migration completed successfully!');
    logger.info('💡 All existing data is now associated with the default organization.');
    logger.info('💡 Users can now create new organizations via /api/organizations');

  } catch (error) {
    logger.err('❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('🔌 Database connection closed');
  }
}

// Run migration
migrate()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.err('Fatal error:', error);
    process.exit(1);
  });
