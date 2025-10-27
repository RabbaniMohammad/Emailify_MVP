/**
 * Update user orgRole to super_admin
 */

import mongoose from 'mongoose';
import logger from 'jet-logger';
import dotenv from 'dotenv';
import path from 'path';
import User from '../src/models/User';
import Organization from '../src/models/Organization';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function updateUserRole() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    logger.info('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    logger.info('✅ Connected successfully\n');

    // Find the default organization
    const defaultOrg = await Organization.findOne({ slug: 'default' });
    if (!defaultOrg) {
      logger.err('❌ Default organization not found!');
      process.exit(1);
    }

    logger.info(`📋 Default Organization: ${defaultOrg.name} (${defaultOrg._id})\n`);

    // Find the user
    const userEmail = 'shaikrabbani29102000@gmail.com';
    const user = await User.findOne({ email: userEmail });

    if (!user) {
      logger.err(`❌ User not found: ${userEmail}`);
      process.exit(1);
    }

    logger.info(`👤 Found user: ${user.name} (${user.email})`);
    logger.info(`   Current orgRole: ${user.orgRole}`);
    logger.info(`   Current organizationId: ${user.organizationId || 'None'}`);

    // Update the user
    user.orgRole = 'super_admin';
    user.organizationId = defaultOrg._id as any;
    user.isApproved = true;
    user.isActive = true;
    await user.save();

    logger.info(`\n✅ User updated successfully!`);
    logger.info(`   New orgRole: ${user.orgRole}`);
    logger.info(`   New organizationId: ${user.organizationId}`);
    logger.info(`   Is Approved: ${user.isApproved}`);
    logger.info(`   Is Active: ${user.isActive}`);

  } catch (error) {
    logger.err('❌ Error updating user:', error);
  } finally {
    await mongoose.connection.close();
    logger.info('\n👋 Database connection closed');
    process.exit(0);
  }
}

updateUserRole();
