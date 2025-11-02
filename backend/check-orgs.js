const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/mailchimp-figma')
  .then(async () => {
    const Organization = mongoose.model('Organization', new mongoose.Schema({}, {strict: false}));
    const orgs = await Organization.find({});
    
    console.log('\n📋 All Organizations:');
    console.log('='.repeat(80));
    
    orgs.forEach(org => {
      console.log(`\nOrg Name: ${org.name}`);
      console.log(`Org ID: ${org._id}`);
      console.log(`Mailchimp Audience ID: ${org.mailchimpAudienceId || 'NOT SET'}`);
      console.log(`Template Folder ID: ${org.mailchimpTemplateFolderId || 'NOT SET'}`);
      console.log('-'.repeat(80));
    });
    
    // Check for duplicates
    const audienceIds = orgs.map(o => o.mailchimpAudienceId).filter(Boolean);
    const duplicates = audienceIds.filter((id, index) => audienceIds.indexOf(id) !== index);
    
    if (duplicates.length > 0) {
      console.log('\n⚠️  WARNING: Multiple organizations sharing the same audience ID:');
      duplicates.forEach(id => {
        const sharedOrgs = orgs.filter(o => o.mailchimpAudienceId === id);
        console.log(`\nAudience ID: ${id}`);
        sharedOrgs.forEach(o => console.log(`  - ${o.name} (${o._id})`));
      });
    } else {
      console.log('\n✅ All organizations have unique audience IDs');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
