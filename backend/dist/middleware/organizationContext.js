"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalOrganizationContext = exports.organizationContext = void 0;
const Organization_1 = __importDefault(require("../models/Organization"));
const jet_logger_1 = __importDefault(require("jet-logger"));
/**
 * Middleware to attach organization context to the request.
 * Must be used AFTER authenticate middleware.
 * Attaches req.organization and ensures user belongs to an active org.
 */
const organizationContext = async (req, res, next) => {
    try {
        const tokenPayload = req.tokenPayload;
        if (!tokenPayload) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { organizationId, orgRole } = tokenPayload;
        // 🔍 DEBUG: Log token payload
        jet_logger_1.default.info(`🔍 [ORG_CONTEXT] User: ${tokenPayload.email}, OrgId: ${organizationId}, Role: ${orgRole}`);
        // Regular users must belong to an organization
        if (!organizationId) {
            jet_logger_1.default.warn(`⚠️ [ORG_CONTEXT] User ${tokenPayload.email} has no organizationId in JWT token`);
            res.status(403).json({
                error: 'No organization assigned',
                message: 'Your account is not associated with any organization. Please contact support.'
            });
            return;
        }
        // Fetch organization details
        const organization = await Organization_1.default.findById(organizationId);
        if (!organization) {
            res.status(404).json({
                error: 'Organization not found',
                message: 'The organization associated with your account no longer exists.'
            });
            return;
        }
        if (!organization.isActive) {
            res.status(403).json({
                error: 'Organization inactive',
                message: 'Your organization has been deactivated. Please contact support.'
            });
            return;
        }
        // Attach organization to request for use in routes
        req.organization = organization;
        req.isSuperAdmin = false;
        jet_logger_1.default.info(`✅ [ORG_CONTEXT] Organization: ${organization.name} (${organization.slug})`);
        next();
    }
    catch (error) {
        jet_logger_1.default.err('Organization context error:', error);
        res.status(500).json({ error: 'Failed to load organization context' });
    }
};
exports.organizationContext = organizationContext;
/**
 * Optional organization context - doesn't fail if no org
 * Useful for public endpoints that show different data based on org
 */
const optionalOrganizationContext = async (req, res, next) => {
    try {
        const tokenPayload = req.tokenPayload;
        if (!tokenPayload || !tokenPayload.organizationId) {
            next();
            return;
        }
        const organization = await Organization_1.default.findById(tokenPayload.organizationId);
        if (organization && organization.isActive) {
            req.organization = organization;
        }
        next();
    }
    catch (error) {
        // Silently continue without org context
        next();
    }
};
exports.optionalOrganizationContext = optionalOrganizationContext;
