/**
 * Check Organization's Mailchimp Folder Setup
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../src/models/Organization';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkMailchimpFolder() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined');
    }

    await mongoose.connect(mongoURI);

    const orgs = await Organization.find({});
    
    console.log('\n================================================================================');
    console.log('📋 MAILCHIMP FOLDER STATUS');
    console.log('================================================================================\n');
    
    for (const org of orgs) {
      console.log(`Organization: ${org.name}`);
      console.log(`Slug: ${org.slug}`);
      console.log(`Folder ID: ${org.mailchimpTemplateFolderId || 'Not configured'}`);
      console.log(`Status: ${org.mailchimpTemplateFolderId ? '✅ Configured' : '❌ Not configured'}`);
      console.log('');
    }

    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkMailchimpFolder();
