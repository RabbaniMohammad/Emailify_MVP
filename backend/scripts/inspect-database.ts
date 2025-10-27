/**
 * Database Inspector
 * Connects to MongoDB and displays schema information for all collections
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../src/models/Organization';
import User from '../src/models/User';
import GeneratedTemplate from '../src/models/GeneratedTemplate';
import TemplateConversation from '../src/models/TemplateConversation';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function inspectDatabase() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    logger.info('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    logger.info('✅ Connected successfully\n');

    const dbName = mongoose.connection.db?.databaseName;
    logger.info(`📊 Database: ${dbName}\n`);

    // Get all collections
    const collections = await mongoose.connection.db?.listCollections().toArray();
    logger.info(`📚 Collections found: ${collections?.length}\n`);

    // Display Organizations
    logger.info('================================================================================');
    logger.info('📋 ORGANIZATIONS COLLECTION');
    logger.info('================================================================================');
    const orgCount = await Organization.countDocuments();
    logger.info(`Total documents: ${orgCount}\n`);
    
    if (orgCount > 0) {
      const sampleOrg = await Organization.findOne().lean();
      logger.info('Sample document structure:');
      logger.info(JSON.stringify(sampleOrg, null, 2));
      
      logger.info('\n📊 All Organizations:');
      const allOrgs = await Organization.find().select('name slug isActive owner createdAt').lean();
      allOrgs.forEach((org: any, index: number) => {
        logger.info(`\n${index + 1}. ${org.name}`);
        logger.info(`   Slug: ${org.slug}`);
        logger.info(`   Active: ${org.isActive}`);
        logger.info(`   Owner ID: ${org.owner}`);
        logger.info(`   Created: ${org.createdAt}`);
      });
    }

    // Display Users
    logger.info('\n' + '='.repeat(80));
    logger.info('👥 USERS COLLECTION');
    logger.info('='.repeat(80));
    const userCount = await User.countDocuments();
    logger.info(`Total documents: ${userCount}\n`);
    
    if (userCount > 0) {
      const sampleUser = await User.findOne().lean();
      logger.info('Sample document structure:');
      logger.info(JSON.stringify(sampleUser, null, 2));
      
      logger.info('\n📊 All Users:');
      const allUsers = await User.find().select('email name role orgRole organizationId isActive isApproved').lean();
      allUsers.forEach((user: any, index: number) => {
        logger.info(`\n${index + 1}. ${user.name} (${user.email})`);
        logger.info(`   Global Role: ${user.role}`);
        logger.info(`   Org Role: ${user.orgRole}`);
        logger.info(`   Organization ID: ${user.organizationId || 'None'}`);
        logger.info(`   Active: ${user.isActive}, Approved: ${user.isApproved}`);
      });
    }

    // Display Templates
    logger.info('\n' + '='.repeat(80));
    logger.info('📄 TEMPLATES COLLECTION');
    logger.info('='.repeat(80));
    const templateCount = await GeneratedTemplate.countDocuments();
    logger.info(`Total documents: ${templateCount}\n`);
    
    if (templateCount > 0) {
      const sampleTemplate = await GeneratedTemplate.findOne().lean();
      logger.info('Sample document structure (first 500 chars):');
      const templateStr = JSON.stringify(sampleTemplate, null, 2);
      logger.info(templateStr.substring(0, 500) + '...');
      
      logger.info('\n📊 Template Summary by Organization:');
      const templatesByOrg = await GeneratedTemplate.aggregate([
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      templatesByOrg.forEach((item: any) => {
        logger.info(`   Org ID ${item._id}: ${item.count} templates`);
      });
    }

    // Display Conversations
    logger.info('\n' + '='.repeat(80));
    logger.info('💬 TEMPLATE CONVERSATIONS COLLECTION');
    logger.info('='.repeat(80));
    const conversationCount = await TemplateConversation.countDocuments();
    logger.info(`Total documents: ${conversationCount}\n`);
    
    if (conversationCount > 0) {
      const sampleConversation = await TemplateConversation.findOne().lean();
      logger.info('Sample document structure (first 500 chars):');
      const convStr = JSON.stringify(sampleConversation, null, 2);
      logger.info(convStr.substring(0, 500) + '...');
      
      logger.info('\n📊 Conversation Summary by Organization:');
      const convsByOrg = await TemplateConversation.aggregate([
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      convsByOrg.forEach((item: any) => {
        logger.info(`   Org ID ${item._id}: ${item.count} conversations`);
      });
    }

    // Display schema definitions
    logger.info('\n' + '='.repeat(80));
    logger.info('📖 SCHEMA DEFINITIONS');
    logger.info('='.repeat(80));

    logger.info('\n🏢 Organization Schema Fields:');
    const orgSchema = Organization.schema.obj as any;
    Object.keys(orgSchema).forEach(field => {
      logger.info(`   - ${field}: ${typeof orgSchema[field]}`);
    });

    logger.info('\n👤 User Schema Fields:');
    const userSchema = User.schema.obj as any;
    Object.keys(userSchema).forEach(field => {
      logger.info(`   - ${field}: ${typeof userSchema[field]}`);
    });

    logger.info('\n📝 Template Schema Fields:');
    const templateSchema = GeneratedTemplate.schema.obj as any;
    Object.keys(templateSchema).forEach(field => {
      logger.info(`   - ${field}: ${typeof templateSchema[field]}`);
    });

    logger.info('\n💭 Conversation Schema Fields:');
    const conversationSchema = TemplateConversation.schema.obj as any;
    Object.keys(conversationSchema).forEach(field => {
      logger.info(`   - ${field}: ${typeof conversationSchema[field]}`);
    });

    logger.info('\n' + '='.repeat(80));
    logger.info('✅ Database inspection complete!');
    logger.info('='.repeat(80));

  } catch (error) {
    logger.err('❌ Error inspecting database:', error);
  } finally {
    await mongoose.connection.close();
    logger.info('\n👋 Database connection closed');
    process.exit(0);
  }
}

inspectDatabase();
