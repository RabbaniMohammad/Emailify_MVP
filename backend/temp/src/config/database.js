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
        await mongoose_1.default.connect(mongoURI, {
            maxPoolSize: 50,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
        });
        jet_logger_1.default.info('✅ MongoDB Atlas connected successfully');
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
