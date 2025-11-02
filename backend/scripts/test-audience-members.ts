/**
 * Test script to fetch all members/subscribers from "Default Organization Subscribers" audience
 */

import mailchimp from '@mailchimp/mailchimp_marketing';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MC: any = mailchimp as any;

// Configure Mailchimp
MC.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_DC || 'us1',
});

async function testAudienceMembers() {
  console.log('🔍 Testing Audience Members...\n');

  try {
    // The "Default Organization Subscribers" audience ID from previous test
    const audienceId = 'a2e7f06c84';
    
    console.log(`📋 Fetching members from audience: ${audienceId}`);
    console.log('   (Default Organization Subscribers)\n');

    // Fetch all members
    const response = await MC.lists.getListMembersInfo(audienceId, {
      count: 1000,
      offset: 0,
    });

    console.log(`✅ Total members: ${response.total_items}`);
    console.log(`   Members returned: ${response.members.length}\n`);

    // Display all members
    console.log('👥 Members List:\n');
    console.log('═══════════════════════════════════════════════════════\n');
    
    response.members.forEach((member: any, index: number) => {
      console.log(`${index + 1}. Email: ${member.email_address}`);
      console.log(`   Status: ${member.status}`);
      console.log(`   Name: ${member.merge_fields?.FNAME || ''} ${member.merge_fields?.LNAME || ''}`);
      console.log(`   Subscribed: ${member.timestamp_opt || member.timestamp_signup}`);
      console.log(`   Tags: ${member.tags?.map((t: any) => t.name).join(', ') || 'None'}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════');
    console.log(`📊 SUMMARY: ${response.total_items} total subscriber(s)`);
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.text || error.response.body);
    }
  }
}

// Run the test
testAudienceMembers();
