"use strict";
/**
 * Database cleanup script to remove duplicate users
 * Run this script to fix duplicate user issues in production
 *
 * Usage: npm run cleanup:users
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = __importDefault(require("../src/models/User"));
const jet_logger_1 = __importDefault(require("jet-logger"));
async function cleanupDuplicateUsers() {
    try {
        // Connect to database
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI environment variable is not set');
        }
        await mongoose_1.default.connect(mongoUri);
        jet_logger_1.default.info('✅ Connected to MongoDB');
        // Find all users grouped by googleId and organizationId
        const users = await User_1.default.find().sort({ createdAt: 1 });
        // Group by googleId + organizationId combination
        const userMap = new Map();
        for (const user of users) {
            const key = `${user.googleId}-${user.organizationId || 'null'}`;
            if (!userMap.has(key)) {
                userMap.set(key, []);
            }
            userMap.get(key).push(user);
        }
        let duplicatesFound = 0;
        let duplicatesRemoved = 0;
        // Process each group
        for (const [key, userGroup] of userMap.entries()) {
            if (userGroup.length > 1) {
                duplicatesFound++;
                jet_logger_1.default.info(`\n🔍 Found ${userGroup.length} duplicates for key: ${key}`);
                // Keep the oldest user (first created) or the one with super_admin role
                const userToKeep = userGroup.find(u => u.orgRole === 'super_admin') || userGroup[0];
                const usersToDelete = userGroup.filter(u => u._id.toString() !== userToKeep._id.toString());
                jet_logger_1.default.info(`   ✅ Keeping user: ${userToKeep.email} (ID: ${userToKeep._id}, Role: ${userToKeep.orgRole}, Created: ${userToKeep.createdAt})`);
                for (const userToDelete of usersToDelete) {
                    jet_logger_1.default.info(`   ❌ Deleting duplicate: ${userToDelete.email} (ID: ${userToDelete._id}, Role: ${userToDelete.orgRole}, Created: ${userToDelete.createdAt})`);
                    await User_1.default.findByIdAndDelete(userToDelete._id);
                    duplicatesRemoved++;
                }
            }
        }
        jet_logger_1.default.info(`\n📊 Cleanup Summary:`);
        jet_logger_1.default.info(`   Total users processed: ${users.length}`);
        jet_logger_1.default.info(`   Duplicate groups found: ${duplicatesFound}`);
        jet_logger_1.default.info(`   Duplicate records removed: ${duplicatesRemoved}`);
        jet_logger_1.default.info(`   Remaining users: ${users.length - duplicatesRemoved}`);
        if (duplicatesRemoved === 0) {
            jet_logger_1.default.info(`\n✅ No duplicates found! Database is clean.`);
        }
        else {
            jet_logger_1.default.info(`\n✅ Cleanup completed successfully!`);
        }
    }
    catch (error) {
        jet_logger_1.default.err('❌ Cleanup failed:', error);
        process.exit(1);
    }
    finally {
        await mongoose_1.default.disconnect();
        jet_logger_1.default.info('👋 Disconnected from MongoDB');
        process.exit(0);
    }
}
// Run cleanup
cleanupDuplicateUsers();
