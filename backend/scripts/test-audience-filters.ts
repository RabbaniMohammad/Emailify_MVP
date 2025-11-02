/**
 * Test script to verify the audience endpoint and filter data
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

async function testFilters() {
  console.log('🔍 Testing Filter Functionality...\n');

  try {
    const audienceId = 'a2e7f06c84'; // Default Organization Subscribers
    
    // Fetch all members
    const response = await MC.lists.getListMembersInfo(audienceId, {
      count: 1000,
      offset: 0,
    });

    const members = response.members;
    console.log(`📊 Total members: ${members.length}\n`);

    // Test 1: Count by status
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Status Filter Counts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const statusCounts: any = {};
    members.forEach((m: any) => {
      statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
    });

    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log('\n✅ Status filter should show:');
    console.log('   - All: 21 members');
    console.log('   - Subscribed: 1 member');
    console.log('   - Cleaned: 20 members');
    console.log('   - Unsubscribed: 0 members\n');

    // Test 2: Search filter test
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Search Filter Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const searchTests = [
      { term: 'alex', expectedCount: 1 },
      { term: 'kumar', expectedCount: 1 },
      { term: 'sharma', expectedCount: 1 },
      { term: 'rabbani', expectedCount: 1 },
      { term: 'default', expectedCount: 20 },
      { term: '@gmail.com', expectedCount: 21 },
    ];

    searchTests.forEach(test => {
      const results = members.filter((m: any) => {
        const email = m.email_address.toLowerCase();
        const firstName = (m.merge_fields?.FNAME || '').toLowerCase();
        const lastName = (m.merge_fields?.LNAME || '').toLowerCase();
        const search = test.term.toLowerCase();
        
        return email.includes(search) || firstName.includes(search) || lastName.includes(search);
      });

      const match = results.length === test.expectedCount ? '✅' : '❌';
      console.log(`${match} Search "${test.term}": ${results.length} (expected: ${test.expectedCount})`);
    });

    // Test 3: Combined filter test
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Combined Filters (Status + Search)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Status = "cleaned" + search = "alex"
    const combinedTest = members.filter((m: any) => {
      const matchesStatus = m.status === 'cleaned';
      const email = m.email_address.toLowerCase();
      const firstName = (m.merge_fields?.FNAME || '').toLowerCase();
      const lastName = (m.merge_fields?.LNAME || '').toLowerCase();
      const matchesSearch = email.includes('alex') || firstName.includes('alex') || lastName.includes('alex');
      
      return matchesStatus && matchesSearch;
    });

    console.log(`Combined filter (status: cleaned, search: alex): ${combinedTest.length} result(s)`);
    if (combinedTest.length > 0) {
      console.log(`  Result: ${combinedTest[0].email_address} (${combinedTest[0].status})`);
    }

    // Test 4: Check data structure
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Data Structure for Frontend');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const sampleMember = members[0];
    console.log('Sample member data structure:');
    console.log({
      email: sampleMember.email_address,
      status: sampleMember.status,
      firstName: sampleMember.merge_fields?.FNAME,
      lastName: sampleMember.merge_fields?.LNAME,
      joinedAt: sampleMember.timestamp_opt || sampleMember.timestamp_signup,
      tags: sampleMember.tags?.map((t: any) => t.name) || [],
    });

    console.log('\n✅ Frontend should receive members in this format');
    console.log('   Filters should work on: email, firstName, lastName, status\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

// Run the test
testFilters();
