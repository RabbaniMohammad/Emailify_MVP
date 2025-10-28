/**
 * List all templates in database
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import GeneratedTemplate from '../src/models/GeneratedTemplate';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function listTemplates() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoURI);

    const templates = await GeneratedTemplate.find({})
      .sort({ createdAt: -1 })
      .lean();

    console.log('\n================================================================================');
    console.log(`📋 ALL TEMPLATES (Total: ${templates.length})`);
    console.log('================================================================================\n');

    // Group by organization
    const byOrg: any = {};
    templates.forEach((t: any) => {
      const orgId = t.organizationId?.toString() || 'ORPHANED';
      if (!byOrg[orgId]) byOrg[orgId] = [];
      byOrg[orgId].push(t);
    });

    console.log(`📊 Organizations found: ${Object.keys(byOrg).length}\n`);

    Object.keys(byOrg).forEach(orgId => {
      const orgTemplates = byOrg[orgId];
      console.log(`\n🏢 Organization ID: ${orgId}`);
      console.log(`   Templates: ${orgTemplates.length}`);
      console.log('   ────────────────────────────────────────────────────────');
      
      orgTemplates.forEach((t: any, index: number) => {
        console.log(`   ${index + 1}. ${t.name}`);
        console.log(`      ID: ${t.templateId}`);
        console.log(`      Source: ${t.source || 'NULL'}`);
        console.log(`      Type: ${t.type || 'NULL'}`);
        console.log(`      Created By: ${t.createdBy || 'Unknown'}`);
        console.log(`      Created: ${t.createdAt}`);
        console.log('');
      });
    });

    await mongoose.disconnect();
    
  } catch (error) {
    logger.err('❌ Error:', error);
    process.exit(1);
  }
}

listTemplates();
