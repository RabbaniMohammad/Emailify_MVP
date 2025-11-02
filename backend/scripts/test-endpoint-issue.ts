/**
 * Test to verify the backend endpoint returns only subscribed members
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

async function testCurrentEndpoint() {
  console.log('🔍 Testing Current Backend Endpoint Behavior\n');

  try {
    const listId = 'a2e7f06c84';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CURRENT ENDPOINT (status: "subscribed")');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // This is what the current endpoint does
    const subscribedOnly = await MC.lists.getListMembersInfo(listId, {
      count: 1000,
      sort_field: 'timestamp_opt',
      sort_dir: 'DESC',
      status: 'subscribed'  // ❌ This filters out cleaned/unsubscribed
    });

    console.log(`Members returned: ${subscribedOnly.members.length}`);
    console.log(`Total items: ${subscribedOnly.total_items}\n`);
    console.log('Members:');
    subscribedOnly.members.forEach((m: any, i: number) => {
      console.log(`  ${i + 1}. ${m.email_address} (${m.status})`);
    });

    console.log('\n❌ PROBLEM: Only returns 1 member (subscribed only)');
    console.log('   Frontend cannot filter by status because cleaned members are missing!\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('FIXED ENDPOINT (no status filter)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // This is what it SHOULD do
    const allMembers = await MC.lists.getListMembersInfo(listId, {
      count: 1000,
      sort_field: 'timestamp_opt',
      sort_dir: 'DESC',
      // NO status filter - get all members
    });

    console.log(`Members returned: ${allMembers.members.length}`);
    console.log(`Total items: ${allMembers.total_items}\n`);
    
    const statusBreakdown: any = {};
    allMembers.members.forEach((m: any) => {
      statusBreakdown[m.status] = (statusBreakdown[m.status] || 0) + 1;
    });

    console.log('Status breakdown:');
    Object.entries(statusBreakdown).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log('\n✅ SOLUTION: Returns all 21 members');
    console.log('   Frontend can now filter by status (subscribed, cleaned, etc.)!\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('RECOMMENDATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Change line 1216 in organization.routes.ts:');
    console.log('');
    console.log('FROM:');
    console.log('  MC.lists.getListMembersInfo(listId, {');
    console.log('    count: Number(limit),');
    console.log('    sort_field: "timestamp_opt",');
    console.log('    sort_dir: "DESC",');
    console.log('    status: "subscribed"  // ❌ Remove this line');
    console.log('  })');
    console.log('');
    console.log('TO:');
    console.log('  MC.lists.getListMembersInfo(listId, {');
    console.log('    count: Number(limit),');
    console.log('    sort_field: "timestamp_opt",');
    console.log('    sort_dir: "DESC"');
    console.log('    // No status filter - return all members');
    console.log('  })');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testCurrentEndpoint();
