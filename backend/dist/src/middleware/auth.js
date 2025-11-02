"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.authenticate = void 0;
const authService_1 = require("../services/authService");
const User_1 = __importDefault(require("../models/User"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const authenticate = async (req, res, next) => {
    try {
        const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }
        const payload = (0, authService_1.verifyAccessToken)(token);
        const user = await User_1.default.findById(payload.userId);
        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }
        const isAuthMeRoute = req.path === '/me' && req.baseUrl === '/api/auth';
        if (!isAuthMeRoute) {
            if (!user.organizationId) {
                jet_logger_1.default.warn(`🚫 SECURITY: User ${user.email} has no organization - access denied`);
                res.status(403).json({
                    error: 'No organization assigned',
                    message: 'You must belong to an organization to access this resource.'
                });
                return;
            }
            if (payload.organizationId && user.organizationId) {
                if (payload.organizationId.toString() !== user.organizationId.toString()) {
                    jet_logger_1.default.warn(`🚫 [TOKEN_VALIDATION] User ${user.email} organization changed: token=${payload.organizationId}, current=${user.organizationId}`);
                    res.status(401).json({
                        error: 'Organization changed',
                        code: 'ORG_CHANGED',
                        message: 'Your organization has changed. Please log in again.'
                    });
                    return;
                }
            }
            if (payload.orgRole && payload.orgRole !== user.orgRole) {
                jet_logger_1.default.warn(`🚫 [TOKEN_VALIDATION] User ${user.email} role changed: token=${payload.orgRole}, current=${user.orgRole}`);
                res.status(401).json({
                    error: 'Role changed',
                    code: 'ROLE_CHANGED',
                    message: 'Your role has changed. Please log in again.'
                });
                return;
            }
            if (!user.isApproved) {
                res.status(403).json({ error: 'Account pending approval' });
                return;
            }
            if (!user.isActive) {
                res.status(403).json({ error: 'Account deactivated' });
                return;
            }
        }
        req.tokenPayload = payload;
        next();
    }
    catch (error) {
        jet_logger_1.default.err('Authentication error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
};
exports.authenticate = authenticate;
const optionalAuth = async (req, res, next) => {
    try {
        const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            const payload = (0, authService_1.verifyAccessToken)(token);
            const user = await User_1.default.findById(payload.userId);
            if (user && user.isActive && user.isApproved) {
                req.tokenPayload = payload;
            }
        }
        next();
    }
    catch (error) {
        next();
    }
};
exports.optionalAuth = optionalAuth;
