/**
 * Make User Super Admin in Default Org
 * Updates shaikrabbani to super_admin role in the default organization
 */

import mongoose from 'mongoose';
import Organization from '../src/models/Organization';
import User from '../src/models/User';
import logger from 'jet-logger';

import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root directory ONLY
const envPath = path.resolve(__dirname, '../.env');
logger.info(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath, override: true });

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  logger.err('❌ MONGODB_URI not found in .env file!');
  process.exit(1);
}

logger.info(`Using MongoDB URI: ${MONGODB_URI.substring(0, 50)}...`);

async function makeSuperAdmin() {
  try {
    logger.info('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB\n');

    // Find the default organization
    const defaultOrg = await Organization.findOne({ slug: 'default' });
    
    if (!defaultOrg) {
      logger.err('❌ Default organization not found!');
      logger.info('Creating default organization...');
      
      const newDefaultOrg = new Organization({
        name: 'Default',
        slug: 'default',
        isActive: true,
        maxUsers: 50,
        maxTemplates: 1000,
      });
      await newDefaultOrg.save();
      logger.info('✅ Created default organization');
      
      // Find user
      const user = await User.findOne({ email: 'shaikrabbani29102000@gmail.com' });
      
      if (!user) {
        logger.err('❌ User shaikrabbani29102000@gmail.com not found!');
        return;
      }
      
      // Update user
      user.organizationId = newDefaultOrg._id as any;
      user.orgRole = 'super_admin';
      user.isApproved = true;
      user.isActive = true;
      await user.save();
      
      // Update org owner
      newDefaultOrg.owner = user._id as any;
      await newDefaultOrg.save();
      
      logger.info('✅ Made shaikrabbani29102000@gmail.com super_admin of default org');
      return;
    }

    logger.info(`📋 Default Organization: ${defaultOrg.name} (${defaultOrg.slug})`);
    logger.info(`   ID: ${defaultOrg._id}\n`);

    // Find the user by email
    const user = await User.findOne({ 
      email: 'shaikrabbani29102000@gmail.com',
      organizationId: defaultOrg._id
    });

    if (!user) {
      logger.err('❌ User shaikrabbani29102000@gmail.com not found in default org!');
      logger.info('Checking if user exists in other orgs...');
      
      const userInOtherOrg = await User.findOne({ email: 'shaikrabbani29102000@gmail.com' });
      
      if (userInOtherOrg) {
        logger.info(`Found user in org: ${userInOtherOrg.organizationId}`);
        logger.info('Updating user to default org...');
        
        userInOtherOrg.organizationId = defaultOrg._id as any;
        userInOtherOrg.orgRole = 'super_admin';
        userInOtherOrg.isApproved = true;
        userInOtherOrg.isActive = true;
        await userInOtherOrg.save();
        
        // Update org owner
        defaultOrg.owner = userInOtherOrg._id as any;
        await defaultOrg.save();
        
        logger.info('✅ Updated user to super_admin of default org');
      } else {
        logger.err('❌ User not found in database at all!');
      }
      return;
    }

    logger.info(`👤 Found user: ${user.name} (${user.email})`);
    logger.info(`   Current role: ${user.orgRole}`);
    logger.info(`   Is approved: ${user.isApproved}`);
    logger.info(`   Is active: ${user.isActive}\n`);

    // Update to super_admin
    const oldRole = user.orgRole;
    user.orgRole = 'super_admin';
    user.isApproved = true;
    user.isActive = true;
    await user.save();

    // Update organization owner
    defaultOrg.owner = user._id as any;
    await defaultOrg.save();

    logger.info(`✅ Updated user role: ${oldRole} → super_admin`);
    logger.info(`✅ Set as organization owner`);
    logger.info(`✅ User is now approved and active\n`);

    logger.info('🎉 Successfully made shaikrabbani29102000@gmail.com a super_admin in default org!');

  } catch (error) {
    logger.err('❌ Error:', error);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
makeSuperAdmin();
