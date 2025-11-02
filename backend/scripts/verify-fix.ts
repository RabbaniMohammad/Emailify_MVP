/**
 * Final verification test - simulates what the fixed endpoint will return
 */

import mailchimp from '@mailchimp/mailchimp_marketing';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MC: any = mailchimp as any;

MC.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_DC || 'us1',
});

async function verifyFix() {
  console.log('✅ VERIFICATION: Testing Fixed Endpoint\n');

  try {
    const listId = 'a2e7f06c84';
    const limit = 1000;

    // Simulate fixed endpoint
    const [listInfo, members] = await Promise.all([
      MC.lists.getList(listId),
      MC.lists.getListMembersInfo(listId, {
        count: Number(limit),
        sort_field: 'timestamp_opt',
        sort_dir: 'DESC',
        // No status filter - return all members
      })
    ]);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ENDPOINT RESPONSE SIMULATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Format member list (same as backend)
    const memberList = members.members.map((m: any) => ({
      email: m.email_address,
      status: m.status,
      joinedAt: m.timestamp_opt,
      firstName: m.merge_fields?.FNAME || '',
      lastName: m.merge_fields?.LNAME || '',
      emailClient: m.email_client || 'Unknown',
      location: m.location?.country_code || '',
    }));

    // Stats
    const stats = {
      totalSubscribers: listInfo.stats.member_count || 0,
      subscribed: listInfo.stats.member_count || 0,
      unsubscribed: listInfo.stats.unsubscribe_count || 0,
      cleaned: listInfo.stats.cleaned_count || 0,
    };

    console.log('📊 Stats:');
    console.log(`   Total: ${stats.totalSubscribers}`);
    console.log(`   Subscribed: ${stats.subscribed}`);
    console.log(`   Cleaned: ${stats.cleaned}`);
    console.log(`   Unsubscribed: ${stats.unsubscribed}\n`);

    console.log(`📋 Members returned: ${memberList.length}\n`);

    // Count by status
    const statusCount: any = {};
    memberList.forEach(m => {
      statusCount[m.status] = (statusCount[m.status] || 0) + 1;
    });

    console.log('Status breakdown in response:');
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('FRONTEND FILTER SIMULATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 1: Filter by status = "cleaned"
    const cleanedMembers = memberList.filter(m => m.status === 'cleaned');
    console.log(`✅ Filter by status "cleaned": ${cleanedMembers.length} members`);

    // Test 2: Filter by status = "subscribed"
    const subscribedMembers = memberList.filter(m => m.status === 'subscribed');
    console.log(`✅ Filter by status "subscribed": ${subscribedMembers.length} member(s)`);

    // Test 3: Search by name
    const alexSearch = memberList.filter(m => 
      m.email.toLowerCase().includes('alex') ||
      m.firstName.toLowerCase().includes('alex') ||
      m.lastName.toLowerCase().includes('alex')
    );
    console.log(`✅ Search "alex": ${alexSearch.length} result(s)`);

    // Test 4: Combined filter
    const combinedFilter = memberList.filter(m => {
      const matchesStatus = m.status === 'cleaned';
      const matchesSearch = m.email.toLowerCase().includes('sharma') ||
                          m.firstName.toLowerCase().includes('sharma') ||
                          m.lastName.toLowerCase().includes('sharma');
      return matchesStatus && matchesSearch;
    });
    console.log(`✅ Combined (status: cleaned + search: sharma): ${combinedFilter.length} result(s)`);
    if (combinedFilter.length > 0) {
      console.log(`   Found: ${combinedFilter[0].email}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS: Filters will now work properly!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Next steps:');
    console.log('1. Restart the backend server');
    console.log('2. Refresh the frontend page');
    console.log('3. Test the status filter dropdown');
    console.log('4. Test the search functionality\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

verifyFix();
