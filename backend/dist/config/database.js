"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }
        // Connection pool configuration for better concurrent user handling
        await mongoose_1.default.connect(mongoURI, {
            maxPoolSize: 50, // Max 50 connections (Free tier allows 500)
            minPoolSize: 5, // Keep 5 connections ready
            serverSelectionTimeoutMS: 5000, // Timeout after 5s if can't connect
            socketTimeoutMS: 45000, // Close sockets after 45s inactivity
            family: 4, // Use IPv4, skip IPv6
        });
        jet_logger_1.default.info('✅ MongoDB Atlas connected successfully');
        // Access db name only after connection is established
        const dbName = mongoose_1.default.connection.db?.databaseName;
        if (dbName) {
            jet_logger_1.default.info(`📊 Database: ${dbName}`);
        }
    }
    catch (error) {
        jet_logger_1.default.err('❌ MongoDB connection error:', error);
        process.exit(1);
    }
};
// Handle connection events
mongoose_1.default.connection.on('disconnected', () => {
    jet_logger_1.default.warn('⚠️ MongoDB disconnected');
});
mongoose_1.default.connection.on('error', (err) => {
    jet_logger_1.default.err('❌ MongoDB error:', err);
});
process.on('SIGINT', async () => {
    await mongoose_1.default.connection.close();
    jet_logger_1.default.info('MongoDB connection closed through app termination');
    process.exit(0);
});
exports.default = connectDB;
