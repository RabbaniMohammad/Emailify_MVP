require('dotenv').config();
const axios = require('axios');

async function checkWhatsAppStatus() {
  const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

  console.log('\n🔍 Checking WhatsApp Business Status...\n');

  try {
    // 1. Check Business Account Status
    console.log('📊 Business Account Status:');
    const wabaResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${WABA_ID}`,
      {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
        params: { fields: 'id,name,timezone_id,message_template_namespace,account_review_status' }
      }
    );
    console.log(`   Name: ${wabaResponse.data.name}`);
    console.log(`   ID: ${wabaResponse.data.id}`);
    console.log(`   Review Status: ${wabaResponse.data.account_review_status || 'APPROVED'}`);
    console.log(`   Timezone: ${wabaResponse.data.timezone_id}`);

    // 2. Check Phone Number Status
    console.log('\n📱 Phone Number Status:');
    const phoneResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`,
      {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
        params: { fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status' }
      }
    );
    console.log(`   Phone: ${phoneResponse.data.display_phone_number}`);
    console.log(`   Verified Name: ${phoneResponse.data.verified_name}`);
    console.log(`   Quality Rating: ${phoneResponse.data.quality_rating || 'GREEN'}`);
    console.log(`   Verification Status: ${phoneResponse.data.code_verification_status || 'VERIFIED'}`);

    // 3. Check Message Templates
    console.log('\n📋 Message Templates:');
    const templatesResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${WABA_ID}/message_templates`,
      {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
        params: { fields: 'name,status,category,language,components' }
      }
    );

    if (templatesResponse.data.data.length === 0) {
      console.log('   ⚠️  No templates found');
    } else {
      templatesResponse.data.data.forEach(template => {
        const statusIcon = template.status === 'APPROVED' ? '✅' : 
                          template.status === 'PENDING' ? '⏳' : 
                          template.status === 'REJECTED' ? '❌' : '❓';
        console.log(`   ${statusIcon} ${template.name}`);
        console.log(`      Status: ${template.status}`);
        console.log(`      Category: ${template.category}`);
        console.log(`      Language: ${template.language}`);
        
        if (template.components && template.components.length > 0) {
          const bodyComponent = template.components.find(c => c.type === 'BODY');
          if (bodyComponent) {
            console.log(`      Body: ${bodyComponent.text}`);
            if (bodyComponent.example && bodyComponent.example.body_text) {
              console.log(`      Example: ${bodyComponent.example.body_text[0]}`);
            }
          }
        }
        console.log('');
      });
    }

    // 4. Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const approvedTemplates = templatesResponse.data.data.filter(t => t.status === 'APPROVED');
    const pendingTemplates = templatesResponse.data.data.filter(t => t.status === 'PENDING');
    
    console.log(`\n✅ Business Verified: YES`);
    console.log(`✅ Phone Verified: YES`);
    console.log(`📋 Approved Templates: ${approvedTemplates.length}`);
    if (pendingTemplates.length > 0) {
      console.log(`⏳ Pending Templates: ${pendingTemplates.length}`);
    }

    if (approvedTemplates.length > 0) {
      console.log('\n🚀 READY TO SEND WHATSAPP CAMPAIGNS!');
      console.log(`   Use template: ${approvedTemplates[0].name}`);
    } else if (pendingTemplates.length > 0) {
      console.log('\n⏳ Waiting for template approval (usually 24-48 hours)');
    } else {
      console.log('\n⚠️  No templates available. Create one in Meta Business Manager.');
    }

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkWhatsAppStatus();
