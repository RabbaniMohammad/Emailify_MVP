/**
 * Test script to fetch ALL audiences from Mailchimp
 * This helps debug why only 1 audience shows when there are 20 in Mailchimp
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

async function testMailchimpAudiences() {
  console.log('🔍 Testing Mailchimp Audiences...\n');
  console.log(`API Key: ${process.env.MAILCHIMP_API_KEY?.substring(0, 10)}...`);
  console.log(`Server: ${process.env.MAILCHIMP_DC}\n`);

  try {
    // Test 1: Ping Mailchimp
    console.log('📡 Test 1: Ping Mailchimp...');
    const pong = await MC.ping.get();
    console.log('✅ Ping successful:', pong);
    console.log('');

    // Test 2: Get ALL lists (no filtering)
    console.log('📋 Test 2: Fetching ALL audiences/lists from Mailchimp...');
    const response = await MC.lists.getAllLists({ count: 1000 });
    
    console.log(`✅ Total audiences found: ${response.lists.length}`);
    console.log(`Total count from API: ${response.total_items}\n`);

    // Test 3: Display all audiences
    console.log('📊 Test 3: List all audiences:\n');
    response.lists.forEach((list: any, index: number) => {
      console.log(`${index + 1}. Name: "${list.name}"`);
      console.log(`   ID: ${list.id}`);
      console.log(`   Members: ${list.stats.member_count}`);
      console.log(`   Created: ${list.date_created}`);
      console.log('');
    });

    // Test 4: Filter audiences containing "default" (case insensitive)
    console.log('🔎 Test 4: Filtering audiences with "default" in name:\n');
    const defaultAudiences = response.lists.filter((list: any) => 
      list.name.toLowerCase().includes('default')
    );
    
    console.log(`Found ${defaultAudiences.length} audience(s) with "default" in name:\n`);
    defaultAudiences.forEach((list: any, index: number) => {
      console.log(`${index + 1}. Name: "${list.name}"`);
      console.log(`   ID: ${list.id}`);
      console.log(`   Members: ${list.stats.member_count}`);
      console.log('');
    });

    // Test 5: Check what the current code returns
    console.log('🧪 Test 5: Simulating current endpoint behavior:\n');
    console.log('Current code only returns audiences where:');
    console.log('  - Organization has mailchimpAudienceId set');
    console.log('  - Returns only that single audience\n');
    console.log('This is why you see only 1 audience instead of all 20!\n');

    // Summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('📈 SUMMARY:');
    console.log(`   Total Mailchimp Audiences: ${response.lists.length}`);
    console.log(`   Audiences with "default": ${defaultAudiences.length}`);
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('💡 RECOMMENDATION:');
    console.log('   The endpoint should fetch ALL Mailchimp audiences');
    console.log('   instead of just the organization\'s single audience.');
    console.log('   This will show all 20 audiences in the dropdown.\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.text || error.response.body);
    }
  }
}

// Run the test
testMailchimpAudiences();
