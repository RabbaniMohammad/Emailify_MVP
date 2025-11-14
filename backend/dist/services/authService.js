"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRefreshToken = exports.verifyAccessToken = exports.generateRefreshToken = exports.generateAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '1h');
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || '';
const REFRESH_TOKEN_EXPIRES_IN = (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');
if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error('JWT secrets not configured');
}
const generateAccessToken = (user) => {
    const payload = {
        userId: String(user._id),
        email: user.email,
        name: user.name,
        organizationId: user.organizationId ? String(user.organizationId) : undefined,
        orgRole: user.orgRole,
    };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};
exports.generateAccessToken = generateAccessToken;
const generateRefreshToken = (user) => {
    const payload = {
        userId: String(user._id),
        email: user.email,
        name: user.name,
        organizationId: user.organizationId ? String(user.organizationId) : undefined,
        orgRole: user.orgRole,
    };
    return jsonwebtoken_1.default.sign(payload, REFRESH_TOKEN_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRES_IN
    });
};
exports.generateRefreshToken = generateRefreshToken;
const verifyAccessToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (error) {
        throw new Error('Invalid access token');
    }
};
exports.verifyAccessToken = verifyAccessToken;
const verifyRefreshToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, REFRESH_TOKEN_SECRET);
    }
    catch (error) {
        throw new Error('Invalid refresh token');
    }
};
exports.verifyRefreshToken = verifyRefreshToken;
