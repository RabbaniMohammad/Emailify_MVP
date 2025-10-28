"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("@src/middleware/auth");
const organizationContext_1 = require("@src/middleware/organizationContext");
const TemplateConversation_1 = __importDefault(require("@src/models/TemplateConversation"));
const GeneratedTemplate_1 = __importDefault(require("@src/models/GeneratedTemplate"));
const User_1 = __importDefault(require("@src/models/User"));
const templateGenerationService_1 = require("@src/services/templateGenerationService");
const mjmlConversionService_1 = require("@src/services/mjmlConversionService");
const jet_logger_1 = __importDefault(require("jet-logger"));
const crypto_1 = require("crypto");
const router = (0, express_1.Router)();
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const { prompt } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({
                code: 'INVALID_PROMPT',
                message: 'Prompt is required'
            });
        }
        jet_logger_1.default.info(`🎨 Quick generation for user ${userId}`);
        const result = await (0, templateGenerationService_1.generateTemplate)({
            prompt: prompt.trim(),
            conversationHistory: [],
            userId,
        });
        const conversion = (0, mjmlConversionService_1.convertMjmlToHtml)(result.mjmlCode);
        if (conversion.errors.length > 0 && !conversion.html) {
            return res.status(400).json({
                success: false,
                code: 'MJML_CONVERSION_ERROR',
                message: 'Failed to convert MJML to HTML',
                errors: conversion.errors,
                mjml: result.mjmlCode,
            });
        }
        jet_logger_1.default.info(`✅ Quick generation completed (attempts: ${result.attemptsUsed})`);
        res.json({
            success: true,
            mjml: result.mjmlCode,
            html: conversion.html,
            message: result.hadErrors
                ? `Template generated successfully after ${result.attemptsUsed} attempts`
                : 'Template generated successfully',
            attemptsUsed: result.attemptsUsed,
            hadErrors: result.hadErrors,
            errors: conversion.errors,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Quick generation error:', error);
        if (error.message?.includes('overloaded') || error.status === 529) {
            return res.status(503).json({
                success: false,
                code: 'API_OVERLOADED',
                message: 'Claude AI is currently experiencing high demand. Please try again in a moment.',
                retryAfter: 10,
            });
        }
        if (error.message?.includes('timeout')) {
            return res.status(408).json({
                success: false,
                code: 'REQUEST_TIMEOUT',
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            code: 'GENERATION_ERROR',
            message: error.message || 'Failed to generate template',
        });
    }
});
router.post('/start', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const { prompt, images } = req.body;
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        if (!organization) {
            return res.status(403).json({
                code: 'NO_ORGANIZATION',
                message: 'You must belong to an organization to generate templates'
            });
        }
        jet_logger_1.default.info(`🎨 Starting template generation for user ${userId}`);
        jet_logger_1.default.info(`📝 Prompt length: ${prompt?.length || 0}`);
        jet_logger_1.default.info(`🖼️ Images received: ${images?.length || 0}`);
        if (!prompt || !prompt.trim()) {
            jet_logger_1.default.warn('⚠️ Invalid prompt - empty or missing');
            return res.status(400).json({
                code: 'INVALID_PROMPT',
                message: 'Prompt is required'
            });
        }
        if (images && images.length > 0) {
            jet_logger_1.default.info(`📊 Image details:`, images.map((img) => ({
                fileName: img.fileName,
                mediaType: img.mediaType,
                dataLength: img.data?.length
            })));
        }
        jet_logger_1.default.info(`📡 Calling generateTemplate service...`);
        const result = await (0, templateGenerationService_1.generateTemplate)({
            prompt: prompt.trim(),
            conversationHistory: [],
            userId,
            images: images || undefined,
        });
        jet_logger_1.default.info(`✅ Template generated successfully`);
        jet_logger_1.default.info(`📄 MJML length: ${result.mjmlCode?.length}`);
        jet_logger_1.default.info(`🔄 Attempts used: ${result.attemptsUsed}`);
        jet_logger_1.default.info(`📄 Converting MJML to HTML...`);
        const conversion = (0, mjmlConversionService_1.convertMjmlToHtml)(result.mjmlCode);
        if (conversion.errors.length > 0 && !conversion.html) {
            jet_logger_1.default.err(`❌ MJML conversion failed: ${JSON.stringify(conversion.errors)}`);
            return res.status(400).json({
                code: 'MJML_CONVERSION_ERROR',
                message: 'Failed to convert MJML to HTML',
                errors: conversion.errors,
                mjml: result.mjmlCode,
            });
        }
        jet_logger_1.default.info(`✅ MJML converted, HTML length: ${conversion.html?.length}`);
        const conversationId = (0, crypto_1.randomUUID)();
        jet_logger_1.default.info(`🆔 Generated conversation ID: ${conversationId}`);
        jet_logger_1.default.info(`💾 Creating conversation in database...`);
        const conversation = await TemplateConversation_1.default.create({
            userId,
            organizationId: organization._id,
            conversationId,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                    timestamp: new Date(),
                    images: images || undefined
                },
                {
                    role: 'assistant',
                    content: result.assistantMessage,
                    timestamp: new Date()
                },
            ],
            currentMjml: result.mjmlCode,
            currentHtml: conversion.html,
            status: 'active',
        });
        jet_logger_1.default.info(`✅ Conversation created: ${conversationId}`);
        res.json({
            conversationId,
            html: conversion.html,
            mjml: result.mjmlCode,
            message: result.assistantMessage,
            hasErrors: conversion.errors.length > 0,
            errors: conversion.errors,
            attemptsUsed: result.attemptsUsed,
            hadErrors: result.hadErrors,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Start generation error:', error);
        jet_logger_1.default.err('Error stack:', error.stack);
        if (error.message?.includes('overloaded') || error.status === 529) {
            return res.status(503).json({
                code: 'API_OVERLOADED',
                message: 'Claude AI is currently experiencing high demand. Please try again in a moment.',
                retryAfter: 10,
            });
        }
        res.status(500).json({
            code: 'GENERATION_ERROR',
            message: error.message || 'Failed to generate template',
        });
    }
});
router.post('/continue/:conversationId', auth_1.authenticate, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { message, images } = req.body;
        const userId = req.tokenPayload?.userId;
        jet_logger_1.default.info(`🔧 Continuing conversation: ${conversationId}`);
        jet_logger_1.default.info(`📝 Message length: ${message?.length || 0}`);
        jet_logger_1.default.info(`🖼️ Images received: ${images?.length || 0}`);
        if (!message || !message.trim()) {
            jet_logger_1.default.warn('⚠️ Invalid message - empty or missing');
            return res.status(400).json({
                code: 'INVALID_MESSAGE',
                message: 'Message is required',
            });
        }
        if (images && images.length > 0) {
            jet_logger_1.default.info(`📊 Image details:`, images.map((img) => ({
                fileName: img.fileName,
                mediaType: img.mediaType,
                dataLength: img.data?.length
            })));
        }
        jet_logger_1.default.info(`🔍 Finding conversation in database...`);
        const conversation = await TemplateConversation_1.default.findOne({
            conversationId,
            userId,
            organizationId: req.organization?._id
        });
        if (!conversation) {
            jet_logger_1.default.err(`❌ Conversation not found: ${conversationId}`);
            return res.status(404).json({
                code: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found',
            });
        }
        jet_logger_1.default.info(`✅ Conversation found`);
        jet_logger_1.default.info(`📊 Current messages count: ${conversation.messages.length}`);
        jet_logger_1.default.info(`💰 Cost optimization: Stateless mode activated`);
        jet_logger_1.default.info(`   - Conversation history: ${conversation.messages.length} messages stored in DB (NOT sent to AI)`);
        jet_logger_1.default.info(`   - Sending to AI: Current MJML + new request only`);
        jet_logger_1.default.info(`   - Image deduplication: Handled by frontend`);
        jet_logger_1.default.info(`📡 Calling refineTemplate service...`);
        const result = await (0, templateGenerationService_1.refineTemplate)(conversation.currentMjml, message.trim(), [], userId, images || undefined);
        jet_logger_1.default.info(`✅ Template refined successfully`);
        jet_logger_1.default.info(`📄 New MJML length: ${result.mjmlCode?.length}`);
        jet_logger_1.default.info(`🔄 Attempts used: ${result.attemptsUsed}`);
        jet_logger_1.default.info(`📄 Converting MJML to HTML...`);
        const conversion = (0, mjmlConversionService_1.convertMjmlToHtml)(result.mjmlCode);
        if (conversion.errors.length > 0 && !conversion.html) {
            jet_logger_1.default.err(`❌ MJML conversion failed: ${JSON.stringify(conversion.errors)}`);
            return res.status(400).json({
                code: 'MJML_CONVERSION_ERROR',
                message: 'Failed to convert MJML to HTML',
                errors: conversion.errors,
                mjml: result.mjmlCode,
            });
        }
        jet_logger_1.default.info(`✅ MJML converted, HTML length: ${conversion.html?.length}`);
        jet_logger_1.default.info(`💾 Adding messages to conversation history (DB only)...`);
        conversation.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date(),
            images: images || undefined
        }, {
            role: 'assistant',
            content: result.assistantMessage,
            timestamp: new Date()
        });
        conversation.currentMjml = result.mjmlCode;
        conversation.currentHtml = conversion.html;
        jet_logger_1.default.info(`💾 Saving conversation...`);
        await conversation.save();
        jet_logger_1.default.info(`✅ Conversation updated: ${conversationId}`);
        jet_logger_1.default.info(`📊 Total messages now: ${conversation.messages.length}`);
        res.json({
            conversationId,
            html: conversion.html,
            mjml: result.mjmlCode,
            message: result.assistantMessage,
            hasErrors: conversion.errors.length > 0,
            errors: conversion.errors,
            attemptsUsed: result.attemptsUsed,
            hadErrors: result.hadErrors,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Continue conversation error:', error);
        jet_logger_1.default.err('Error stack:', error.stack);
        res.status(500).json({
            code: 'GENERATION_ERROR',
            message: error.message || 'Failed to continue conversation',
        });
    }
});
router.get('/conversation/:conversationId', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        jet_logger_1.default.info(`📖 Getting conversation: ${conversationId} for user: ${userId}`);
        const conversation = await TemplateConversation_1.default.findOne({
            conversationId,
            userId,
            organizationId: organization?._id
        });
        if (!conversation) {
            jet_logger_1.default.warn(`⚠️ Conversation not found: ${conversationId} for user: ${userId}`);
            return res.status(404).json({
                code: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found',
            });
        }
        jet_logger_1.default.info(`✅ Conversation found with ${conversation.messages.length} messages`);
        res.json({
            conversationId: conversation.conversationId,
            messages: conversation.messages,
            currentHtml: conversation.currentHtml,
            currentMjml: conversation.currentMjml,
            templateName: conversation.templateName,
            status: conversation.status,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get conversation error:', error);
        res.status(500).json({
            code: 'FETCH_ERROR',
            message: error.message || 'Failed to fetch conversation',
        });
    }
});
router.get('/history', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const offset = parseInt(req.query.offset) || 0;
        const conversations = await TemplateConversation_1.default.find({
            userId,
            organizationId: organization?._id
        })
            .sort({ updatedAt: -1 })
            .skip(offset)
            .limit(limit)
            .select('conversationId templateName status createdAt updatedAt messages');
        const total = await TemplateConversation_1.default.countDocuments({
            userId,
            organizationId: organization?._id
        });
        const items = conversations.map((conv) => ({
            conversationId: conv.conversationId,
            templateName: conv.templateName || 'Untitled Template',
            status: conv.status,
            messageCount: conv.messages.length,
            lastMessage: conv.messages[conv.messages.length - 1]?.content.substring(0, 100) || '',
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
        }));
        res.json({
            items,
            total,
            limit,
            offset,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get history error:', error);
        res.status(500).json({
            code: 'FETCH_ERROR',
            message: error.message || 'Failed to fetch history',
        });
    }
});
router.post('/save/:conversationId', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { templateName } = req.body;
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        if (!organization) {
            return res.status(403).json({
                code: 'NO_ORGANIZATION',
                message: 'You must belong to an organization to save templates'
            });
        }
        if (!templateName || !templateName.trim()) {
            return res.status(400).json({
                code: 'INVALID_NAME',
                message: 'Template name is required',
            });
        }
        const conversation = await TemplateConversation_1.default.findOne({
            conversationId,
            userId,
            organizationId: organization?._id
        });
        if (!conversation) {
            console.error('❌ [SAVE] Conversation not found:', conversationId);
            return res.status(404).json({
                code: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found',
            });
        }
        if (!conversation.currentHtml) {
            console.error('❌ [SAVE] No HTML content to save');
            return res.status(400).json({
                code: 'NO_TEMPLATE',
                message: 'No template to save',
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user) {
            console.error('❌ [SAVE] User not found:', userId);
            return res.status(404).json({
                code: 'USER_NOT_FOUND',
                message: 'User not found',
            });
        }
        const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const generatedTemplate = await GeneratedTemplate_1.default.create({
            templateId,
            name: templateName.trim(),
            html: conversation.currentHtml,
            userId,
            organizationId: organization._id,
            conversationId,
            type: 'generated',
            templateType: 'AI Generated',
            createdBy: user.name,
            source: 'AI Generated',
            active: 'N/A',
            category: 'N/A',
            responsive: 'Yes',
            folderId: 'N/A',
            thumbnail: '',
        });
        conversation.templateName = templateName.trim();
        conversation.status = 'saved';
        conversation.savedTemplateId = templateId;
        await conversation.save();
        jet_logger_1.default.info(`✅ Template saved to MongoDB: ${templateId}`);
        res.json({
            templateId,
            templateName: generatedTemplate.name,
            message: 'Template saved successfully',
        });
    }
    catch (error) {
        console.error('❌ [SAVE] Save template error:', error);
        console.error('❌ [SAVE] Error stack:', error.stack);
        jet_logger_1.default.err('❌ Save template error:', error);
        res.status(500).json({
            code: 'SAVE_ERROR',
            message: error.message || 'Failed to save template',
        });
    }
});
router.post('/preview', auth_1.authenticate, async (req, res) => {
    try {
        const { mjml } = req.body;
        if (!mjml || !mjml.trim()) {
            return res.status(400).json({
                code: 'INVALID_MJML',
                message: 'MJML code is required',
            });
        }
        const validation = (0, mjmlConversionService_1.validateMjml)(mjml);
        if (!validation.valid) {
            return res.status(400).json({
                code: 'INVALID_MJML',
                message: 'Invalid MJML syntax',
                errors: validation.errors,
            });
        }
        const conversion = (0, mjmlConversionService_1.convertMjmlToHtml)(mjml);
        res.json({
            html: conversion.html,
            hasErrors: conversion.errors.length > 0,
            errors: conversion.errors,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Preview error:', error);
        res.status(500).json({
            code: 'PREVIEW_ERROR',
            message: error.message || 'Failed to preview template',
        });
    }
});
router.get('/starter', auth_1.authenticate, async (req, res) => {
    try {
        const mjml = (0, mjmlConversionService_1.getMjmlStarter)();
        const conversion = (0, mjmlConversionService_1.convertMjmlToHtml)(mjml);
        res.json({
            mjml,
            html: conversion.html,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Starter template error:', error);
        res.status(500).json({
            code: 'STARTER_ERROR',
            message: error.message || 'Failed to get starter template',
        });
    }
});
exports.default = router;
