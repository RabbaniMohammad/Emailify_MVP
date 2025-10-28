"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateToken = generateToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function generateToken(user) {
    const payload = {
        userId: user._id,
        email: user.email,
        organizationId: user.organizationId,
        orgRole: user.orgRole
    };
    return jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
        expiresIn: '7d'
    });
}
