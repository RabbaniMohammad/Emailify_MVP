/**
 * Verify Migration Results
 * Check that all data was properly migrated to the default organization
 */

import mongoose from 'mongoose';
import Organization from '../src/models/Organization';
import User from '../src/models/User';
import GeneratedTemplate from '../src/models/GeneratedTemplate';
import TemplateConversation from '../src/models/TemplateConversation';
import logger from 'jet-logger';

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || '';

async function verifyMigration() {
  try {
    logger.info('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB\n');

    // Find the default organization
    const defaultOrg = await Organization.findOne({ slug: 'default' });
    
    if (!defaultOrg) {
      logger.err('❌ Default organization not found!');
      return;
    }

    logger.info('📋 Default Organization Details:');
    logger.info(`   Name: ${defaultOrg.name}`);
    logger.info(`   Slug: ${defaultOrg.slug}`);
    logger.info(`   ID: ${defaultOrg._id}`);
    logger.info(`   Created: ${defaultOrg.createdAt}\n`);

    // Count users in default org
    const usersInDefaultOrg = await User.countDocuments({ organizationId: defaultOrg._id });
    const totalUsers = await User.countDocuments();
    
    logger.info('👥 Users:');
    logger.info(`   In default org: ${usersInDefaultOrg}`);
    logger.info(`   Total users: ${totalUsers}`);
    logger.info(`   Without org: ${totalUsers - usersInDefaultOrg}\n`);

    // Count templates in default org
    const templatesInDefaultOrg = await GeneratedTemplate.countDocuments({ organizationId: defaultOrg._id });
    const totalTemplates = await GeneratedTemplate.countDocuments();
    
    logger.info('📄 Templates:');
    logger.info(`   In default org: ${templatesInDefaultOrg}`);
    logger.info(`   Total templates: ${totalTemplates}`);
    logger.info(`   Without org: ${totalTemplates - templatesInDefaultOrg}\n`);

    // List some template names
    const sampleTemplates = await GeneratedTemplate.find({ organizationId: defaultOrg._id })
      .limit(5)
      .select('name templateId createdAt');
    
    if (sampleTemplates.length > 0) {
      logger.info('📝 Sample Templates in Default Org:');
      sampleTemplates.forEach((t, i) => {
        logger.info(`   ${i + 1}. ${t.name} (${t.templateId}) - Created: ${t.createdAt.toLocaleDateString()}`);
      });
      logger.info('');
    }

    // Count conversations in default org
    const conversationsInDefaultOrg = await TemplateConversation.countDocuments({ organizationId: defaultOrg._id });
    const totalConversations = await TemplateConversation.countDocuments();
    
    logger.info('💬 Conversations:');
    logger.info(`   In default org: ${conversationsInDefaultOrg}`);
    logger.info(`   Total conversations: ${totalConversations}`);
    logger.info(`   Without org: ${totalConversations - conversationsInDefaultOrg}\n`);

    // Summary
    logger.info('✅ Migration Verification Summary:');
    logger.info(`   ✓ Default organization exists: ${defaultOrg.name}`);
    logger.info(`   ✓ Users migrated: ${usersInDefaultOrg}/${totalUsers}`);
    logger.info(`   ✓ Templates migrated: ${templatesInDefaultOrg}/${totalTemplates}`);
    logger.info(`   ✓ Conversations migrated: ${conversationsInDefaultOrg}/${totalConversations}`);
    
    if (totalUsers === usersInDefaultOrg && totalTemplates === templatesInDefaultOrg && totalConversations === conversationsInDefaultOrg) {
      logger.info('\n🎉 All data successfully migrated to default organization!');
    } else {
      logger.warn('\n⚠️ Some data not assigned to organization. Run migration again.');
    }

  } catch (error) {
    logger.err('❌ Verification failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('\n🔌 Database connection closed');
  }
}

verifyMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
