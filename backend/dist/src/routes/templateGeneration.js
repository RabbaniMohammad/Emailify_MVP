"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const organizationContext_1 = require("../middleware/organizationContext");
const TemplateConversation_1 = __importDefault(require("../models/TemplateConversation"));
const GeneratedTemplate_1 = __importDefault(require("../models/GeneratedTemplate"));
const User_1 = __importDefault(require("../models/User"));
const templateGenerationService_1 = require("../services/templateGenerationService");
const mjmlConversionService_1 = require("../services/mjmlConversionService");
const jet_logger_1 = __importDefault(require("jet-logger"));
const router = (0, express_1.Router)();
router.get('/test', (req, res) => {
    res.json({ message: 'Template generation router is working!' });
});
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
router.post('/chat', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const { message, conversationHistory = [], currentMjml, images, extractedFileData } = req.body;
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        if (!organization) {
            return res.status(403).json({
                code: 'NO_ORGANIZATION',
                message: 'You must belong to an organization to generate templates'
            });
        }
        if (!message || !message.trim()) {
            jet_logger_1.default.warn('⚠️ Invalid message - empty or missing');
            return res.status(400).json({
                code: 'INVALID_MESSAGE',
                message: 'Message is required'
            });
        }
        jet_logger_1.default.info(`💬 Chat request from user ${userId}`);
        jet_logger_1.default.info(`📝 Message length: ${message.length}`);
        jet_logger_1.default.info(`📋 Conversation history: ${conversationHistory.length} messages`);
        jet_logger_1.default.info(`🖼️ Images: ${images?.length || 0}`);
        jet_logger_1.default.info(`📄 Current MJML: ${currentMjml ? 'Yes' : 'No'}`);
        jet_logger_1.default.info(`📎 Extracted file data: ${extractedFileData ? 'Yes' : 'No'}`);
        if (extractedFileData) {
            jet_logger_1.default.info(`📎 File data length: ${extractedFileData.length}`);
            jet_logger_1.default.info(`📎 First 200 chars: ${extractedFileData.substring(0, 200)}`);
        }
        if (images && images.length > 0) {
            jet_logger_1.default.info(`📊 Image details:`, images.map((img) => ({
                fileName: img.fileName,
                mediaType: img.mediaType,
                dataLength: img.data?.length
            })));
        }
        let result;
        if (currentMjml) {
            jet_logger_1.default.info(`🔧 Refining existing template...`);
            result = await (0, templateGenerationService_1.refineTemplate)(currentMjml, message.trim(), conversationHistory, userId, images || undefined, extractedFileData || undefined);
        }
        else {
            jet_logger_1.default.info(`🎨 Generating new template...`);
            result = await (0, templateGenerationService_1.generateTemplate)({
                prompt: message.trim(),
                conversationHistory,
                userId,
                images: images || undefined,
                extractedFileData: extractedFileData || undefined,
            });
        }
        jet_logger_1.default.info(`✅ Template ${currentMjml ? 'refined' : 'generated'} successfully`);
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
        const responseData = {
            html: conversion.html,
            mjml: result.mjmlCode,
            message: result.assistantMessage,
            hasErrors: conversion.errors.length > 0,
            errors: conversion.errors,
            attemptsUsed: result.attemptsUsed,
            hadErrors: result.hadErrors,
        };
        res.json(responseData);
    }
    catch (error) {
        jet_logger_1.default.err('❌ Chat error:', error);
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
        const { templateName, html, mjml } = req.body;
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
        if (!html) {
            console.error('❌ [SAVE] No HTML content provided');
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
            html: html,
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
