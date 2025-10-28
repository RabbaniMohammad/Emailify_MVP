"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const User_1 = __importDefault(require("@src/models/User"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '';
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    jet_logger_1.default.err('Missing Google OAuth environment variables');
    process.exit(1);
}
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL,
    passReqToCallback: true, // Enable access to req object
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        jet_logger_1.default.info(`Google OAuth callback for: ${profile.emails?.[0]?.value}`);
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const picture = profile.photos?.[0]?.value;
        if (!email) {
            return done(new Error('No email provided by Google'), undefined);
        }
        // Get organization slug from state parameter
        const orgSlug = req.query.state || '';
        if (!orgSlug) {
            // No org specified - this shouldn't happen with the new flow
            jet_logger_1.default.warn(`⚠️ No organization specified for login: ${email}`);
            return done(new Error('Organization is required'), undefined);
        }
        // Find or create organization first
        const Organization = (await Promise.resolve().then(() => __importStar(require('@src/models/Organization')))).default;
        let organization = await Organization.findOne({ slug: orgSlug.toLowerCase() });
        if (!organization) {
            // Create new organization (will be handled properly in callback)
            // For now, just pass user data back
            jet_logger_1.default.info(`🏢 New organization will be created: ${orgSlug}`);
        }
        const organizationId = organization?._id;
        // Look for existing user with this googleId in THIS organization
        // First check if user exists in this specific org
        let user = await User_1.default.findOne({
            googleId,
            organizationId: organizationId || null
        });
        if (user) {
            // Existing user in this org - update info
            jet_logger_1.default.info(`✅ Existing user in org ${orgSlug}: ${email}`);
            user.name = name;
            user.picture = picture;
            await user.updateLastLogin();
            return done(null, user);
        }
        // Check if user exists with this googleId but in a different org or no org
        const existingUser = await User_1.default.findOne({ googleId });
        if (existingUser && !existingUser.organizationId && organizationId) {
            // User exists without org, and now joining an org - update in callback
            jet_logger_1.default.info(`🔄 User ${email} exists without org, will be assigned to ${orgSlug} in callback`);
            return done(null, existingUser);
        }
        else if (existingUser && existingUser.organizationId && organizationId) {
            // User exists in different org - create new user record for this org
            const existingOrgId = String(existingUser.organizationId);
            const requestedOrgId = String(organizationId);
            if (existingOrgId !== requestedOrgId) {
                jet_logger_1.default.info(`� User ${email} exists in different org, creating new record for ${orgSlug}`);
                // Create new user record for this organization
                user = await User_1.default.create({
                    googleId,
                    email,
                    name,
                    picture,
                    organizationId,
                    orgRole: 'member',
                    isApproved: false,
                    isActive: true,
                });
                return done(null, user);
            }
            // Same org but shouldn't reach here (covered above) - safety fallback
            jet_logger_1.default.info(`⚠️ Fallback: User ${email} in correct org ${orgSlug}`);
            return done(null, existingUser);
        }
        else {
            // New user - create minimal record (org assignment happens in callback)
            jet_logger_1.default.info(`🆕 Creating new user for org ${orgSlug}: ${email}`);
            // If org exists, create user in that org
            if (organizationId) {
                user = await User_1.default.create({
                    googleId,
                    email,
                    name,
                    picture,
                    organizationId,
                    orgRole: 'member', // Default role, will be updated in callback if first user
                    isApproved: false,
                    isActive: true,
                });
            }
            else {
                // Org doesn't exist yet - create user without org (will be assigned in callback)
                user = await User_1.default.create({
                    googleId,
                    email,
                    name,
                    picture,
                    orgRole: 'member',
                    isApproved: false,
                    isActive: true,
                });
            }
            return done(null, user);
        }
    }
    catch (error) {
        jet_logger_1.default.err('Google OAuth error:', error);
        return done(error, undefined);
    }
}));
passport_1.default.serializeUser((user, done) => {
    done(null, user._id);
});
passport_1.default.deserializeUser(async (id, done) => {
    try {
        const user = await User_1.default.findById(id);
        done(null, user);
    }
    catch (error) {
        done(error, null);
    }
});
exports.default = passport_1.default;
