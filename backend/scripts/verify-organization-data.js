"use strict";
/**
 * Verification script to check organization data and user associations
 * Run this to diagnose organization name issues
 *
 * Usage: npm run verify:org
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = __importDefault(require("../src/models/User"));
const Organization_1 = __importDefault(require("../src/models/Organization"));
const jet_logger_1 = __importDefault(require("jet-logger"));
async function verifyOrganizationData() {
    try {
        // Connect to database
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI environment variable is not set');
        }
        await mongoose_1.default.connect(mongoUri);
        jet_logger_1.default.info('✅ Connected to MongoDB');
        // Get all organizations
        const orgs = await Organization_1.default.find();
        jet_logger_1.default.info(`\n📊 Found ${orgs.length} organizations:`);
        for (const org of orgs) {
            jet_logger_1.default.info(`\n🏢 Organization: ${org.name}`);
            jet_logger_1.default.info(`   ID: ${org._id}`);
            jet_logger_1.default.info(`   Slug: ${org.slug}`);
            jet_logger_1.default.info(`   Owner: ${org.owner}`);
            jet_logger_1.default.info(`   Active: ${org.isActive}`);
            jet_logger_1.default.info(`   Domain: ${org.domain || 'None'}`);
            // Count users in this org
            const userCount = await User_1.default.countDocuments({ organizationId: org._id });
            jet_logger_1.default.info(`   Users: ${userCount}`);
            // Get users for this org
            const users = await User_1.default.find({ organizationId: org._id }).select('email name orgRole isApproved isActive');
            if (users.length > 0) {
                jet_logger_1.default.info(`   User list:`);
                for (const user of users) {
                    jet_logger_1.default.info(`      - ${user.email} (${user.orgRole}) - Approved: ${user.isApproved}, Active: ${user.isActive}`);
                }
            }
        }
        // Check for orphaned users (users without organization)
        const orphanedUsers = await User_1.default.find({ organizationId: null }).select('email name googleId createdAt');
        if (orphanedUsers.length > 0) {
            jet_logger_1.default.info(`\n⚠️  Found ${orphanedUsers.length} users without organization:`);
            for (const user of orphanedUsers) {
                jet_logger_1.default.info(`   - ${user.email} (Created: ${user.createdAt})`);
            }
        }
        // Test population on a sample user
        const sampleUser = await User_1.default.findOne({ organizationId: { $ne: null } });
        if (sampleUser) {
            jet_logger_1.default.info(`\n🧪 Testing organization population on user: ${sampleUser.email}`);
            const populatedUser = await User_1.default.findById(sampleUser._id)
                .populate('organizationId', 'name slug domain isActive');
            if (populatedUser && populatedUser.organizationId) {
                jet_logger_1.default.info('   ✅ Population successful!');
                jet_logger_1.default.info('   Organization data:');
                console.log(JSON.stringify(populatedUser.organizationId, null, 2));
            }
            else {
                jet_logger_1.default.warn('   ❌ Population failed or organizationId is null');
            }
        }
        jet_logger_1.default.info(`\n✅ Verification completed!`);
    }
    catch (error) {
        jet_logger_1.default.err('❌ Verification failed:', error);
        process.exit(1);
    }
    finally {
        await mongoose_1.default.disconnect();
        jet_logger_1.default.info('👋 Disconnected from MongoDB');
        process.exit(0);
    }
}
// Run verification
verifyOrganizationData();
