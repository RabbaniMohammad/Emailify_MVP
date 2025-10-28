/**
 * Check Templates in Database
 * Query for templates with specific criteria
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import GeneratedTemplate from '../src/models/GeneratedTemplate';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkTemplates() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    logger.info('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    logger.info('✅ Connected successfully\n');

    // Total templates
    const totalCount = await GeneratedTemplate.countDocuments();
    logger.info(`📊 Total templates: ${totalCount}\n`);

    // Templates with "Emailify" in name
    logger.info('================================================================================');
    logger.info('🔍 TEMPLATES WITH "EMAILIFY" IN NAME');
    logger.info('================================================================================');
    const emailifyTemplates = await GeneratedTemplate.find({ 
      name: { $regex: /emailify/i } 
    }).lean();
    logger.info(`Found: ${emailifyTemplates.length}`);
    if (emailifyTemplates.length > 0) {
      emailifyTemplates.forEach((t: any) => {
        logger.info(`\n  ID: ${t.templateId}`);
        logger.info(`  Name: ${t.name}`);
        logger.info(`  Source: ${t.source}`);
        logger.info(`  Organization ID: ${t.organizationId || 'NULL/ORPHANED'}`);
        logger.info(`  Created: ${t.createdAt}`);
      });
    }

    // Orphaned templates (no organizationId)
    logger.info('\n================================================================================');
    logger.info('🔍 ORPHANED TEMPLATES (NO ORGANIZATION ID)');
    logger.info('================================================================================');
    const orphanedTemplates = await GeneratedTemplate.find({ 
      $or: [
        { organizationId: null },
        { organizationId: { $exists: false } }
      ]
    }).lean();
    logger.info(`Found: ${orphanedTemplates.length}`);
    if (orphanedTemplates.length > 0) {
      orphanedTemplates.forEach((t: any) => {
        logger.info(`\n  ID: ${t.templateId}`);
        logger.info(`  Name: ${t.name}`);
        logger.info(`  Source: ${t.source}`);
        logger.info(`  Created: ${t.createdAt}`);
      });
    }

    // Templates by source
    logger.info('\n================================================================================');
    logger.info('🔍 TEMPLATES BY SOURCE');
    logger.info('================================================================================');
    const sources = await GeneratedTemplate.aggregate([
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    sources.forEach((s: any) => {
      logger.info(`  ${s._id || 'NULL'}: ${s.count}`);
    });

    // ESP templates (source = campaign.content.html)
    logger.info('\n================================================================================');
    logger.info('🔍 ESP TEMPLATES (source = "campaign.content.html")');
    logger.info('================================================================================');
    const espTemplates = await GeneratedTemplate.find({ 
      source: 'campaign.content.html' 
    }).lean();
    logger.info(`Found: ${espTemplates.length}`);
    if (espTemplates.length > 0) {
      espTemplates.forEach((t: any) => {
        logger.info(`\n  ID: ${t.templateId}`);
        logger.info(`  Name: ${t.name}`);
        logger.info(`  Organization ID: ${t.organizationId || 'NULL/ORPHANED'}`);
        logger.info(`  Created: ${t.createdAt}`);
      });
    }

    // Visual Editor templates
    logger.info('\n================================================================================');
    logger.info('🔍 VISUAL EDITOR TEMPLATES');
    logger.info('================================================================================');
    const visualEditorTemplates = await GeneratedTemplate.find({ 
      source: { $regex: /visual editor/i }
    }).lean();
    logger.info(`Found: ${visualEditorTemplates.length}`);
    if (visualEditorTemplates.length > 0) {
      visualEditorTemplates.forEach((t: any) => {
        logger.info(`\n  ID: ${t.templateId}`);
        logger.info(`  Name: ${t.name}`);
        logger.info(`  Organization ID: ${t.organizationId || 'NULL/ORPHANED'}`);
        logger.info(`  Created: ${t.createdAt}`);
      });
    }

    await mongoose.disconnect();
    logger.info('\n✅ Disconnected from MongoDB');
    
  } catch (error) {
    logger.err('❌ Error:', error);
    process.exit(1);
  }
}

checkTemplates();
