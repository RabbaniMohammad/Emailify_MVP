"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.requireSuperAdmin = exports.requireRole = void 0;
const User_1 = __importDefault(require("@src/models/User"));
const requireRole = (...allowedRoles) => {
    return async (req, res, next) => {
        try {
            const tokenPayload = req.tokenPayload;
            if (!tokenPayload) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const user = await User_1.default.findById(tokenPayload.userId);
            if (!user || !user.isActive || !user.isApproved) {
                res.status(403).json({ error: 'Access denied' });
                return;
            }
            // Check orgRole for admin access
            const hasOrgRole = user.orgRole && allowedRoles.includes(user.orgRole);
            if (!hasOrgRole) {
                res.status(403).json({ error: 'Insufficient permissions' });
                return;
            }
            // Attach full user to request
            req.currentUser = user;
            next();
        }
        catch (error) {
            res.status(500).json({ error: 'Authorization check failed' });
        }
    };
};
exports.requireRole = requireRole;
exports.requireSuperAdmin = (0, exports.requireRole)('super_admin');
exports.requireAdmin = (0, exports.requireRole)('super_admin', 'admin');
