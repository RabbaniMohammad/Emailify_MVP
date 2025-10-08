import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import TemplateConversation from '@src/models/TemplateConversation';
import { generateTemplate, refineTemplate } from '@src/services/templateGenerationService';
import { convertMjmlToHtml, validateMjml, getMjmlStarter } from '@src/services/mjmlConversionService';
import logger from 'jet-logger';
import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import path from 'path';

const router = Router();

// Directory for saved templates (same as existing templates)
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');

// Ensure templates directory exists
fs.ensureDirSync(TEMPLATES_DIR);

/**
 * POST /api/generate/start
 * Start a new template generation conversation
 */
router.post('/start', authenticate, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ 
        code: 'INVALID_PROMPT', 
        message: 'Prompt is required' 
      });
    }

    logger.info(`🎨 Starting template generation for user ${userId}`);

    // Generate template using Claude
    const result = await generateTemplate({
      prompt: prompt.trim(),
      conversationHistory: [],
      userId,
    });

    // Convert MJML to HTML
    const conversion = convertMjmlToHtml(result.mjmlCode);

    if (conversion.errors.length > 0 && !conversion.html) {
      return res.status(400).json({
        code: 'MJML_CONVERSION_ERROR',
        message: 'Failed to convert MJML to HTML',
        errors: conversion.errors,
        mjml: result.mjmlCode,
      });
    }

    // Create conversation in database
    const conversationId = randomUUID();
    const conversation = await TemplateConversation.create({
      userId,
      conversationId,
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
        { role: 'assistant', content: result.assistantMessage, timestamp: new Date() },
      ],
      currentMjml: result.mjmlCode,
      currentHtml: conversion.html,
      status: 'active',
    });

    logger.info(`✅ Conversation created: ${conversationId}`);

    res.json({
      conversationId,
      html: conversion.html,
      mjml: result.mjmlCode,
      message: result.assistantMessage,
      hasErrors: conversion.errors.length > 0,
      errors: conversion.errors,
    });
  } catch (error: any) {
    logger.err('❌ Start generation error:', error);
    
    // ⭐ SPECIAL HANDLING FOR OVERLOAD
    if (error.message?.includes('overloaded') || error.status === 529) {
        return res.status(503).json({
        code: 'API_OVERLOADED',
        message: 'Claude AI is currently experiencing high demand. Please try again in a moment.',
        retryAfter: 10, // seconds
        });
    }
    
    res.status(500).json({
        code: 'GENERATION_ERROR',
        message: error.message || 'Failed to generate template',
    });
    }
});

/**
 * POST /api/generate/continue/:conversationId
 * Continue an existing conversation
 */
router.post('/continue/:conversationId', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { message } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!message || !message.trim()) {
      return res.status(400).json({
        code: 'INVALID_MESSAGE',
        message: 'Message is required',
      });
    }

    // Find conversation
    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
    });

    if (!conversation) {
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    logger.info(`🔧 Continuing conversation: ${conversationId}`);

    // Build conversation history
    const conversationHistory = conversation.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Refine template
    const result = await refineTemplate(
      conversation.currentMjml,
      message.trim(),
      conversationHistory,
      userId
    );

    // Convert MJML to HTML
    const conversion = convertMjmlToHtml(result.mjmlCode);

    if (conversion.errors.length > 0 && !conversion.html) {
      return res.status(400).json({
        code: 'MJML_CONVERSION_ERROR',
        message: 'Failed to convert MJML to HTML',
        errors: conversion.errors,
        mjml: result.mjmlCode,
      });
    }

    // Update conversation
    conversation.messages.push(
      { role: 'user', content: message, timestamp: new Date() },
      { role: 'assistant', content: result.assistantMessage, timestamp: new Date() }
    );
    conversation.currentMjml = result.mjmlCode;
    conversation.currentHtml = conversion.html;
    await conversation.save();

    logger.info(`✅ Conversation updated: ${conversationId}`);

    res.json({
      conversationId,
      html: conversion.html,
      mjml: result.mjmlCode,
      message: result.assistantMessage,
      hasErrors: conversion.errors.length > 0,
      errors: conversion.errors,
    });
  } catch (error: any) {
    logger.err('❌ Continue conversation error:', error);
    res.status(500).json({
      code: 'GENERATION_ERROR',
      message: error.message || 'Failed to continue conversation',
    });
  }
});

/**
 * GET /api/generate/conversation/:conversationId
 * Get conversation history
 */
router.get('/conversation/:conversationId', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).tokenPayload?.userId;

    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
    });

    if (!conversation) {
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

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
  } catch (error: any) {
    logger.err('❌ Get conversation error:', error);
    res.status(500).json({
      code: 'FETCH_ERROR',
      message: error.message || 'Failed to fetch conversation',
    });
  }
});

/**
 * GET /api/generate/history
 * Get user's conversation history
 */
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await TemplateConversation.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .select('conversationId templateName status createdAt updatedAt messages');

    const total = await TemplateConversation.countDocuments({ userId });

    // Format response
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
  } catch (error: any) {
    logger.err('❌ Get history error:', error);
    res.status(500).json({
      code: 'FETCH_ERROR',
      message: error.message || 'Failed to fetch history',
    });
  }
});

/**
 * POST /api/generate/save/:conversationId
 * Save template to file system (like existing templates)
 */
router.post('/save/:conversationId', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { templateName } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!templateName || !templateName.trim()) {
      return res.status(400).json({
        code: 'INVALID_NAME',
        message: 'Template name is required',
      });
    }

    // Find conversation
    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
    });

    if (!conversation) {
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    if (!conversation.currentHtml) {
      return res.status(400).json({
        code: 'NO_TEMPLATE',
        message: 'No template to save',
      });
    }

    // Generate unique template ID
    const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fileName = `${templateId}.html`;
    const filePath = path.join(TEMPLATES_DIR, fileName);

    // Save HTML to file
    await fs.writeFile(filePath, conversation.currentHtml, 'utf-8');

    // Update conversation
    conversation.templateName = templateName.trim();
    conversation.status = 'saved';
    conversation.savedTemplateId = templateId;
    await conversation.save();

    logger.info(`✅ Template saved: ${templateId} (${fileName})`);

    res.json({
      templateId,
      templateName: conversation.templateName,
      fileName,
      message: 'Template saved successfully',
    });
  } catch (error: any) {
    logger.err('❌ Save template error:', error);
    res.status(500).json({
      code: 'SAVE_ERROR',
      message: error.message || 'Failed to save template',
    });
  }
});

/**
 * POST /api/generate/preview
 * Quick preview without saving to database
 */
router.post('/preview', authenticate, async (req: Request, res: Response) => {
  try {
    const { mjml } = req.body;

    if (!mjml || !mjml.trim()) {
      return res.status(400).json({
        code: 'INVALID_MJML',
        message: 'MJML code is required',
      });
    }

    // Validate and convert
    const validation = validateMjml(mjml);
    
    if (!validation.valid) {
      return res.status(400).json({
        code: 'INVALID_MJML',
        message: 'Invalid MJML syntax',
        errors: validation.errors,
      });
    }

    const conversion = convertMjmlToHtml(mjml);

    res.json({
      html: conversion.html,
      hasErrors: conversion.errors.length > 0,
      errors: conversion.errors,
    });
  } catch (error: any) {
    logger.err('❌ Preview error:', error);
    res.status(500).json({
      code: 'PREVIEW_ERROR',
      message: error.message || 'Failed to preview template',
    });
  }
});

/**
 * GET /api/generate/starter
 * Get MJML starter template
 */
router.get('/starter', authenticate, async (req: Request, res: Response) => {
  try {
    const mjml = getMjmlStarter();
    const conversion = convertMjmlToHtml(mjml);

    res.json({
      mjml,
      html: conversion.html,
    });
  } catch (error: any) {
    logger.err('❌ Starter template error:', error);
    res.status(500).json({
      code: 'STARTER_ERROR',
      message: error.message || 'Failed to get starter template',
    });
  }
});

export default router;