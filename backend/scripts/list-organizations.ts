// Load env variables from root .env ONLY (prevent dotenvx auto-loading)
process.env.DOTENVX_LOAD_PATH = '';

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import mongoose from 'mongoose';
import Organization from '../src/models/Organization';

const MONGODB_URI = process.env.MONGODB_URI;

async function listOrganizations() {
  try {
    console.log('MONGODB_URI:', MONGODB_URI);
    
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

    const orgs = await Organization.find({}).select('name slug isActive createdAt').sort({ createdAt: 1 });
    
    console.log(`Total Organizations: ${orgs.length}\n`);
    console.log('Organizations:');
    console.log('='.repeat(60));
    
    orgs.forEach((org: any, i: number) => {
      console.log(`${i + 1}. ${org.name}`);
      console.log(`   Slug: ${org.slug}`);
      console.log(`   Active: ${org.isActive}`);
      console.log(`   Created: ${org.createdAt}`);
      console.log('');
    });

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

listOrganizations();
