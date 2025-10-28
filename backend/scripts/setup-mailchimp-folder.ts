/**
 * Setup Mailchimp Folder for Organization
 * Creates a folder in Mailchimp and moves templates to it
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../src/models/Organization';
import mailchimp from '@mailchimp/mailchimp_marketing';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Configure Mailchimp
const apiKey = process.env.MAILCHIMP_API_KEY;
const serverPrefix = process.env.MAILCHIMP_DC;

if (!apiKey || !serverPrefix) {
  console.error('❌ Missing Mailchimp credentials in .env file');
  console.error('   MAILCHIMP_API_KEY:', apiKey ? 'Set' : 'Missing');
  console.error('   MAILCHIMP_DC:', serverPrefix ? 'Set' : 'Missing');
  process.exit(1);
}

mailchimp.setConfig({
  apiKey,
  server: serverPrefix,
});

const MC: any = mailchimp as any;

async function setupMailchimpFolder() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    logger.info('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    logger.info('✅ Connected successfully\n');

    // Find Default Organization
    const org = await Organization.findOne({ slug: 'default' });
    
    if (!org) {
      throw new Error('Default organization not found');
    }

    logger.info(`📋 Found organization: ${org.name}`);
    logger.info(`   ID: ${org._id}`);
    logger.info(`   Current folder ID: ${org.mailchimpTemplateFolderId || 'None'}\n`);

    // Check if folder already exists
    if (org.mailchimpTemplateFolderId) {
      logger.info(`✅ Organization already has a folder: ${org.mailchimpTemplateFolderId}`);
      logger.info('Skipping folder creation...\n');
    } else {
      // Create folder in Mailchimp
      logger.info('📁 Creating folder in Mailchimp...');
      
      const folderName = `${org.name} Templates`;
      
      try {
        const folder = await MC.templateFolders.create({ name: folderName });
        const folderId = String(folder.id || folder.folder_id);
        
        logger.info(`✅ Created folder: ${folderName}`);
        logger.info(`   Folder ID: ${folderId}\n`);
        
        // Save folder ID to organization
        org.mailchimpTemplateFolderId = folderId;
        await org.save();
        
        logger.info(`✅ Saved folder ID to organization\n`);
      } catch (folderError: any) {
        logger.err('❌ Error creating folder:', folderError?.message || folderError);
        logger.err('Response:', folderError?.response?.text || folderError?.response?.body || 'No response details');
        throw folderError;
      }
    }

    // Get all templates
    logger.info('📋 Fetching all Mailchimp templates...');
    const templatesResponse = await MC.templates.list({ count: 1000, type: 'user' });
    const allTemplates = templatesResponse.templates || [];
    
    logger.info(`   Found ${allTemplates.length} total templates\n`);

    // Filter Emailify templates
    const emailifyTemplates = allTemplates.filter((t: any) => 
      t.name && t.name.includes('Emailify Template')
    );

    logger.info(`📧 Found ${emailifyTemplates.length} "Emailify Template" templates:\n`);

    if (emailifyTemplates.length === 0) {
      logger.info('No Emailify templates to move.');
    } else {
      // Move each template to the folder
      let movedCount = 0;
      let alreadyInFolder = 0;
      let errorCount = 0;

      for (const template of emailifyTemplates) {
        const templateId = template.id;
        const templateName = template.name;
        const currentFolderId = template.folder_id;

        logger.info(`\n📄 Template: ${templateName} (ID: ${templateId})`);
        logger.info(`   Current folder: ${currentFolderId || 'None'}`);

        if (currentFolderId === org.mailchimpTemplateFolderId) {
          logger.info(`   ✅ Already in correct folder`);
          alreadyInFolder++;
          continue;
        }

        try {
          // Update template to move it to the folder
          await MC.templates.update(templateId, {
            folder_id: org.mailchimpTemplateFolderId
          });
          
          logger.info(`   ✅ Moved to folder: ${org.mailchimpTemplateFolderId}`);
          movedCount++;
        } catch (moveError: any) {
          logger.err(`   ❌ Error moving template:`, moveError?.message || moveError);
          errorCount++;
        }
      }

      logger.info('\n================================================================================');
      logger.info('📊 SUMMARY');
      logger.info('================================================================================');
      logger.info(`Total Emailify templates: ${emailifyTemplates.length}`);
      logger.info(`Moved to folder: ${movedCount}`);
      logger.info(`Already in folder: ${alreadyInFolder}`);
      logger.info(`Errors: ${errorCount}`);
      logger.info('================================================================================\n');
    }

    await mongoose.disconnect();
    logger.info('✅ Disconnected from MongoDB');
    
  } catch (error) {
    logger.err('❌ Error:', error);
    process.exit(1);
  }
}

setupMailchimpFolder();
