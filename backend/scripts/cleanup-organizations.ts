// Load env variables from root .env ONLY (prevent dotenvx auto-loading)
process.env.DOTENVX_LOAD_PATH = '';

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import mongoose from 'mongoose';
import Organization from '../src/models/Organization';

const MONGODB_URI = process.env.MONGODB_URI;

async function cleanupOrganizations() {
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined');
    }

    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
    });
    console.log('Connected to MongoDB\n');

    // Delete all organizations except default
    const result = await Organization.deleteMany({ 
      slug: { $ne: 'default' } 
    });

    console.log(`✅ Deleted ${result.deletedCount} organizations`);
    console.log('✅ Kept: Default Organization\n');

    // List remaining organizations
    const orgs = await Organization.find({}).select('name slug');
    console.log('Remaining organizations:');
    orgs.forEach((org: any) => {
      console.log(`  - ${org.name} (${org.slug})`);
    });

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupOrganizations();
