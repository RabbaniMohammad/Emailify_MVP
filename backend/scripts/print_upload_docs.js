#!/usr/bin/env node
/**
 * Simple script to connect to MongoDB (using backend/.env MONGODB_URI)
 * and print sample documents from UploadMaster and UploadConsent collections.
 *
 * Usage (PowerShell):
 *   cd backend
 *   node .\scripts\print_upload_docs.js
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load env from backend/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not found in backend/.env. Aborting.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const db = mongoose.connection.db;
    console.log('Connected to database:', db.databaseName);

    const uploadMasterColl = db.collection('uploadmasters');
    const uploadConsentColl = db.collection('uploadconsents');

    console.log('\n--- UploadMaster documents (up to 50) ---');
    const masters = await uploadMasterColl.find({}).limit(50).toArray();
    if (masters.length === 0) {
      console.log('(no documents found)');
    } else {
      console.log(JSON.stringify(masters, null, 2));
    }

    console.log('\n--- UploadConsent documents (up to 50) ---');
    const consents = await uploadConsentColl.find({}).limit(50).toArray();
    if (consents.length === 0) {
      console.log('(no documents found)');
    } else {
      console.log(JSON.stringify(consents, null, 2));
    }

  } catch (err) {
    console.error('Error while querying collections:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
