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
const OrganizationSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 100,
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
        validate: {
            validator: function (v) {
                return /^[a-z0-9-]+$/.test(v);
            },
            message: 'Slug can only contain lowercase letters, numbers, and hyphens'
        }
    },
    domain: {
        type: String,
        lowercase: true,
        trim: true,
        sparse: true,
        validate: {
            validator: function (v) {
                if (!v)
                    return true;
                return /^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
            },
            message: 'Invalid email domain format'
        }
    },
    mailchimpApiKey: {
        type: String,
        default: '',
    },
    mailchimpServerPrefix: {
        type: String,
        default: '',
    },
    mailchimpAudienceId: {
        type: String,
        default: '',
    },
    mailchimpTemplateFolderId: {
        type: String,
        default: '',
        sparse: true,
    },
    maxUsers: {
        type: Number,
        default: 50,
        min: 1,
    },
    maxTemplates: {
        type: Number,
        default: 1000,
        min: 1,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    owner: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
}, {
    timestamps: true,
});
OrganizationSchema.index({ slug: 1, isActive: 1 });
OrganizationSchema.index({ owner: 1 });
OrganizationSchema.pre('save', function (next) {
    if (this.isNew && !this.slug) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }
    next();
});
exports.default = mongoose_1.default.model('Organization', OrganizationSchema);
