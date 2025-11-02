require('dotenv').config();
const mongoose = require('mongoose');
const mailchimp = require('@mailchimp/mailchimp_marketing');
const fs = require('fs');
const path = require('path');

// Configure Mailchimp
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_DC || 'us17'
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mailchimp-figma';

// Organization schema
const organizationSchema = new mongoose.Schema({
  name: String,
  mailchimpAudienceId: String
}, { collection: 'organizations' });

const Organization = mongoose.model('Organization', organizationSchema);

async function addTestSubscribers() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load test data
    const testDataPath = path.join(__dirname, 'test-subscribers.json');
    const testData = JSON.parse(fs.readFileSync(testDataPath, 'utf8'));

    // Organization name mapping (case-insensitive)
    const orgMapping = {
      'munna': 'munna',
      'default': 'default',
      'default organization': 'default',
      'kishan': 'kishan'
    };

    console.log('📋 Loading organizations from database...\n');
    const organizations = await Organization.find({});
    
    for (const org of organizations) {
      const orgNameLower = org.name.toLowerCase();
      const mappedName = orgMapping[orgNameLower];

      if (!mappedName || !testData[mappedName]) {
        console.log(`⏭️  Skipping ${org.name} (no test data)`);
        continue;
      }

      if (!org.mailchimpAudienceId) {
        console.log(`⚠️  ${org.name} has no mailchimpAudienceId - skipping\n`);
        continue;
      }

      console.log(`\n📧 Adding subscribers to ${org.name}:`);
      console.log(`   Audience ID: ${org.mailchimpAudienceId}`);
      console.log(`   Subscribers: ${testData[mappedName].length}`);

      const subscribers = testData[mappedName];
      const members = subscribers.map(sub => ({
        email_address: sub.email,
        status: 'subscribed',
        merge_fields: {
          FNAME: sub.firstName,
          LNAME: sub.lastName
        }
      }));

      try {
        // Use batch operations for better performance
        const response = await mailchimp.lists.batchListMembers(org.mailchimpAudienceId, {
          members: members,
          update_existing: true
        });

        console.log(`   ✅ Added: ${response.new_members.length}`);
        console.log(`   🔄 Updated: ${response.updated_members.length}`);
        console.log(`   ❌ Errors: ${response.error_count}`);

        if (response.errors && response.errors.length > 0) {
          console.log(`   Error details:`);
          response.errors.slice(0, 3).forEach(err => {
            console.log(`      - ${err.email_address}: ${err.error}`);
          });
          if (response.errors.length > 3) {
            console.log(`      ... and ${response.errors.length - 3} more errors`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Failed to add subscribers:`, error.response?.body || error.message);
      }
    }

    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

addTestSubscribers();
