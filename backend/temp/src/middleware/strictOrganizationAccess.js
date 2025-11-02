"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.strictOrganizationAccess = void 0;
const Organization_1 = __importDefault(require("@src/models/Organization"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const strictOrganizationAccess = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tokenPayload = req.tokenPayload;
        if (!tokenPayload) {
            jet_logger_1.default.warn('🚫 [SECURITY] strictOrganizationAccess: No token payload');
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { userId, organizationId: tokenOrgId } = tokenPayload;
        if (!tokenOrgId) {
            jet_logger_1.default.warn(`🚫 [SECURITY] User ${userId} has no organizationId in token`);
            res.status(403).json({
                error: 'No organization assigned',
                message: 'Your account is not associated with any organization.'
            });
            return;
        }
        if (tokenOrgId.toString() !== id) {
            jet_logger_1.default.warn(`🚫 [SECURITY] Cross-org access attempt: User from org ${tokenOrgId} tried to access org ${id}`);
            res.status(403).json({
                error: 'Access denied',
                message: 'You can only access your own organization\'s resources'
            });
            return;
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            jet_logger_1.default.warn(`🚫 [SECURITY] Organization not found: ${id}`);
            res.status(404).json({
                error: 'Organization not found',
                message: 'The requested organization does not exist'
            });
            return;
        }
        if (!organization.isActive) {
            jet_logger_1.default.warn(`🚫 [SECURITY] Inactive organization access attempt: ${id}`);
            res.status(403).json({
                error: 'Organization inactive',
                message: 'This organization has been deactivated'
            });
            return;
        }
        req.organization = organization;
        jet_logger_1.default.info(`✅ [SECURITY] Organization access granted: ${organization.name} (${id})`);
        next();
    }
    catch (error) {
        jet_logger_1.default.err('❌ [SECURITY] Organization validation error:', error);
        res.status(500).json({
            error: 'Organization validation failed',
            message: 'An error occurred while validating organization access'
        });
    }
};
exports.strictOrganizationAccess = strictOrganizationAccess;
