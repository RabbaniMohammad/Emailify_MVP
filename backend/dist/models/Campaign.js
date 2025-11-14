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
const CampaignSchema = new mongoose_1.Schema({
    mailchimpCampaignId: {
        type: String,
        required: true,
        unique: true,
        index: true, // Fast lookups by Mailchimp ID
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    subject: {
        type: String,
        trim: true,
    },
    previewText: {
        type: String,
        trim: true,
    },
    // Organization isolation - CRITICAL for multi-tenant
    organizationId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true, // Fast lookups by organization
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true, // Fast lookups by user
    },
    // Campaign status
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'canceled'],
        default: 'draft',
        index: true, // Fast filtering by status
    },
    // Template reference
    templateUsed: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'GeneratedTemplate',
    },
    templateName: {
        type: String,
        trim: true,
    },
    // Audience info
    recipientsCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    audienceId: {
        type: String,
    },
    audienceName: {
        type: String,
        trim: true,
    },
    // Timestamps
    sentAt: {
        type: Date,
    },
    scheduledFor: {
        type: Date,
    },
    // Campaign metrics
    metrics: {
        emailsSent: {
            type: Number,
            default: 0,
            min: 0,
        },
        // Opens
        opens: {
            type: Number,
            default: 0,
            min: 0,
        },
        uniqueOpens: {
            type: Number,
            default: 0,
            min: 0,
        },
        openRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        // Clicks
        clicks: {
            type: Number,
            default: 0,
            min: 0,
        },
        uniqueClicks: {
            type: Number,
            default: 0,
            min: 0,
        },
        clickRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        // Negative metrics
        bounces: {
            type: Number,
            default: 0,
            min: 0,
        },
        bounceRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        unsubscribes: {
            type: Number,
            default: 0,
            min: 0,
        },
        unsubscribeRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        lastSyncedAt: {
            type: Date,
        },
    },
}, {
    timestamps: true, // Automatically creates createdAt and updatedAt
});
// Compound indexes for efficient queries
CampaignSchema.index({ organizationId: 1, createdAt: -1 }); // Org isolation, newest first
CampaignSchema.index({ organizationId: 1, status: 1 }); // Filter by org and status
CampaignSchema.index({ organizationId: 1, sentAt: -1 }); // Recent sent campaigns
CampaignSchema.index({ createdBy: 1, createdAt: -1 }); // User's campaigns
CampaignSchema.index({ status: 1, scheduledFor: 1 }); // Find scheduled campaigns
// Text index for searching campaigns by name or subject
CampaignSchema.index({ name: 'text', subject: 'text' });
exports.default = mongoose_1.default.model('Campaign', CampaignSchema);
