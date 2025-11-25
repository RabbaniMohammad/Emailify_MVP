#!/usr/bin/env node
/**
 * Backfill UploadMaster.userName and organizationName from linked UploadConsent records.
 * Usage:
 *   cd backend
 *   node ./scripts/backfill_upload_master_from_consent.js
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not found in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection.db;

  const uploadMasters = db.collection('uploadmasters');
  const uploadConsents = db.collection('uploadconsents');

  const cursor = uploadMasters.find({ consentId: { $exists: true }, $or: [ { userName: { $exists: false } }, { organizationName: { $exists: false } } ] });
  let updated = 0;
  while (await cursor.hasNext()) {
    const master = await cursor.next();
    if (!master) continue;
    const consentId = master.consentId;
    if (!consentId) continue;
    const consent = await uploadConsents.findOne({ _id: consentId });
    if (!consent) continue;
    const update = {};
    if (!master.userName && consent.userName) update.userName = consent.userName;
    if (!master.userId && consent.userId) update.userId = consent.userId;
    if (!master.organizationName && consent.organizationName) update.organizationName = consent.organizationName;
    if (Object.keys(update).length > 0) {
      await uploadMasters.updateOne({ _id: master._id }, { $set: update });
      updated++;
      console.log('Updated master', master._id.toString(), update);
    }
  }

  console.log('Backfill complete. Updated', updated, 'documents.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
