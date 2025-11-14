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
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const GeneratedTemplateSchema = new mongoose_1.Schema({
    templateId: {
        type: String,
        required: true,
        unique: true,
        index: true, // Fast lookups by templateId
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    html: {
        type: String,
        required: true,
    },
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true, // Fast lookups by userId
    },
    organizationId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true, // Fast lookups by organizationId (isolation)
    },
    conversationId: {
        type: String,
        index: true, // Optional link to conversation
    },
    type: {
        type: String,
        default: 'generated',
    },
    // Metadata fields (relaxed to accept Visual Editor values)
    templateType: {
        type: String,
        default: 'AI Generated',
    },
    createdBy: {
        type: String,
        required: true, // User's name from Google sign-in
        trim: true,
    },
    source: {
        type: String,
        default: 'AI Generated',
    },
    active: {
        type: String,
        default: 'N/A',
    },
    category: {
        type: String,
        default: 'N/A',
    },
    responsive: {
        type: String,
        default: 'Yes',
    },
    folderId: {
        type: String,
        default: 'N/A',
    },
    thumbnail: {
        type: String,
        default: '', // Empty string
    },
    dragDrop: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true, // Automatically creates createdAt and updatedAt
});
// Compound indexes for efficient queries
GeneratedTemplateSchema.index({ userId: 1, createdAt: -1 });
GeneratedTemplateSchema.index({ organizationId: 1, createdAt: -1 }); // Org isolation
GeneratedTemplateSchema.index({ organizationId: 1, userId: 1 }); // User within org
// Index for finding templates by conversation
GeneratedTemplateSchema.index({ conversationId: 1 });
exports.default = mongoose_1.default.model('GeneratedTemplate', GeneratedTemplateSchema);
