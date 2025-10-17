import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import TemplateConversation from '@src/models/TemplateConversation';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import User from '@src/models/User';
import { generateTemplate, refineTemplate } from '@src/services/templateGenerationService';
import { convertMjmlToHtml, validateMjml, getMjmlStarter } from '@src/services/mjmlConversionService';
import logger from 'jet-logger';
import { randomUUID } from 'crypto';

const router = Router();

/**
 * POST /api/generate
 * Simple one-shot template generation (no conversation)
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ 
        code: 'INVALID_PROMPT', 
        message: 'Prompt is required' 
      });
    }

    logger.info(`🎨 Quick generation for user ${userId}`);

    const result = await generateTemplate({
      prompt: prompt.trim(),
      conversationHistory: [],
      userId,
    });

    const conversion = convertMjmlToHtml(result.mjmlCode);

    if (conversion.errors.length > 0 && !conversion.html) {
      return res.status(400).json({
        success: false,
        code: 'MJML_CONVERSION_ERROR',
        message: 'Failed to convert MJML to HTML',
        errors: conversion.errors,
        mjml: result.mjmlCode,
      });
    }

    logger.info(`✅ Quick generation completed (attempts: ${result.attemptsUsed})`);

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
  } catch (error: any) {
    logger.err('❌ Quick generation error:', error);
    
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

/**
 * POST /api/generate/start
 * Start a new template generation conversation
 * ✅ Returns MJML on first generation (frontend needs it for editor)
 */
router.post('/start', authenticate, async (req: Request, res: Response) => {
  try {
    const { prompt, images } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    logger.info(`🎨 Starting template generation for user ${userId}`);
    logger.info(`📝 Prompt length: ${prompt?.length || 0}`);
    logger.info(`🖼️ Images received: ${images?.length || 0}`);

    if (!prompt || !prompt.trim()) {
      logger.warn('⚠️ Invalid prompt - empty or missing');
      return res.status(400).json({ 
        code: 'INVALID_PROMPT', 
        message: 'Prompt is required' 
      });
    }

    if (images && images.length > 0) {
      logger.info(`📊 Image details:`, images.map((img: any) => ({
        fileName: img.fileName,
        mediaType: img.mediaType,
        dataLength: img.data?.length
      })));
    }

    logger.info(`📡 Calling generateTemplate service...`);
    const result = await generateTemplate({
      prompt: prompt.trim(),
      conversationHistory: [],
      userId,
      images: images || undefined,
    });

    logger.info(`✅ Template generated successfully`);
    logger.info(`📄 MJML length: ${result.mjmlCode?.length}`);
    logger.info(`🔄 Attempts used: ${result.attemptsUsed}`);

    logger.info(`📄 Converting MJML to HTML...`);
    const conversion = convertMjmlToHtml(result.mjmlCode);

    if (conversion.errors.length > 0 && !conversion.html) {
      logger.err(`❌ MJML conversion failed: ${JSON.stringify(conversion.errors)}`);
      return res.status(400).json({
        code: 'MJML_CONVERSION_ERROR',
        message: 'Failed to convert MJML to HTML',
        errors: conversion.errors,
        mjml: result.mjmlCode,
      });
    }

    logger.info(`✅ MJML converted, HTML length: ${conversion.html?.length}`);

    const conversationId = randomUUID();
    logger.info(`🆔 Generated conversation ID: ${conversationId}`);

    logger.info(`💾 Creating conversation in database...`);
    const conversation = await TemplateConversation.create({
      userId,
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

    logger.info(`✅ Conversation created: ${conversationId}`);

    // ✅ First generation: Return MJML (frontend needs it for editor)
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
  } catch (error: any) {
    logger.err('❌ Start generation error:', error);
    logger.err('Error stack:', error.stack);
    
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

/**
 * POST /api/generate/continue/:conversationId
 * Continue an existing conversation
 * ✅ STATELESS: Only current MJML + new request (no conversation history)
 * ✅ Returns MJML + HTML in response
 * ✅ NO image deduplication (handled by frontend)
 */
router.post('/continue/:conversationId', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { message, images } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    logger.info(`🔧 Continuing conversation: ${conversationId}`);
    logger.info(`📝 Message length: ${message?.length || 0}`);
    logger.info(`🖼️ Images received: ${images?.length || 0}`);

    if (!message || !message.trim()) {
      logger.warn('⚠️ Invalid message - empty or missing');
      return res.status(400).json({
        code: 'INVALID_MESSAGE',
        message: 'Message is required',
      });
    }

    if (images && images.length > 0) {
      logger.info(`📊 Image details:`, images.map((img: any) => ({
        fileName: img.fileName,
        mediaType: img.mediaType,
        dataLength: img.data?.length
      })));
    }

    logger.info(`🔍 Finding conversation in database...`);
    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
    });

    if (!conversation) {
      logger.err(`❌ Conversation not found: ${conversationId}`);
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    logger.info(`✅ Conversation found`);
    logger.info(`📊 Current messages count: ${conversation.messages.length}`);

    // ✅ STATELESS APPROACH: No conversation history sent to AI
    // Send: Current MJML state + New user request only
    // Image deduplication: Handled by frontend warnings
    logger.info(`💰 Cost optimization: Stateless mode activated`);
    logger.info(`   - Conversation history: ${conversation.messages.length} messages stored in DB (NOT sent to AI)`);
    logger.info(`   - Sending to AI: Current MJML + new request only`);
    logger.info(`   - Image deduplication: Handled by frontend`);

    logger.info(`📡 Calling refineTemplate service...`);
    const result = await refineTemplate(
      conversation.currentMjml,  // ✅ Current template state (contains all previous changes)
      message.trim(),             // ✅ New user request
      [],                         // ✅ Empty history (stateless - huge cost savings!)
      userId,
      images || undefined         // ✅ Images as-is (no backend deduplication)
    );

    logger.info(`✅ Template refined successfully`);
    logger.info(`📄 New MJML length: ${result.mjmlCode?.length}`);
    logger.info(`🔄 Attempts used: ${result.attemptsUsed}`);

    logger.info(`📄 Converting MJML to HTML...`);
    const conversion = convertMjmlToHtml(result.mjmlCode);

    if (conversion.errors.length > 0 && !conversion.html) {
      logger.err(`❌ MJML conversion failed: ${JSON.stringify(conversion.errors)}`);
      return res.status(400).json({
        code: 'MJML_CONVERSION_ERROR',
        message: 'Failed to convert MJML to HTML',
        errors: conversion.errors,
        mjml: result.mjmlCode,
      });
    }

    logger.info(`✅ MJML converted, HTML length: ${conversion.html?.length}`);

    // ✅ Store messages in DB for audit/history (not sent to AI)
    logger.info(`💾 Adding messages to conversation history (DB only)...`);
    conversation.messages.push(
      { 
        role: 'user', 
        content: message, 
        timestamp: new Date(),
        images: images || undefined
      },
      { 
        role: 'assistant', 
        content: result.assistantMessage, 
        timestamp: new Date() 
      }
    );
    conversation.currentMjml = result.mjmlCode;
    conversation.currentHtml = conversion.html;
    
    logger.info(`💾 Saving conversation...`);
    await conversation.save();

    logger.info(`✅ Conversation updated: ${conversationId}`);
    logger.info(`📊 Total messages now: ${conversation.messages.length}`);

    // ✅ Return both HTML and MJML
    res.json({
      conversationId,
      html: conversion.html,           // ✅ HTML for preview
      mjml: result.mjmlCode,           // ✅ MJML for editor (YOU NEED THIS!)
      message: result.assistantMessage, // ✅ AI's response message
      hasErrors: conversion.errors.length > 0,
      errors: conversion.errors,
      attemptsUsed: result.attemptsUsed,
      hadErrors: result.hadErrors,
    });
  } catch (error: any) {
    logger.err('❌ Continue conversation error:', error);
    logger.err('Error stack:', error.stack);
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
 * Save template to MongoDB
 */
router.post('/save/:conversationId', authenticate, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { templateName } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    console.log('💾 [SAVE] Starting template save process');
    console.log('💾 [SAVE] Conversation ID:', conversationId);
    console.log('💾 [SAVE] Template name:', templateName);
    console.log('💾 [SAVE] User ID:', userId);

    if (!templateName || !templateName.trim()) {
      console.warn('⚠️ [SAVE] Template name is missing or empty');
      return res.status(400).json({
        code: 'INVALID_NAME',
        message: 'Template name is required',
      });
    }

    console.log('🔍 [SAVE] Finding conversation in database...');
    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
    });

    if (!conversation) {
      console.error('❌ [SAVE] Conversation not found:', conversationId);
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    console.log('✅ [SAVE] Conversation found');
    console.log('📊 [SAVE] Conversation status:', conversation.status);
    console.log('📄 [SAVE] HTML length:', conversation.currentHtml?.length);

    if (!conversation.currentHtml) {
      console.error('❌ [SAVE] No HTML content to save');
      return res.status(400).json({
        code: 'NO_TEMPLATE',
        message: 'No template to save',
      });
    }

    console.log('👤 [SAVE] Fetching user details for createdBy field...');
    const user = await User.findById(userId);
    
    if (!user) {
      console.error('❌ [SAVE] User not found:', userId);
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    console.log('✅ [SAVE] User found:', user.name);
    console.log('📧 [SAVE] User email:', user.email);

    const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    console.log('🆔 [SAVE] Generated template ID:', templateId);

    console.log('💾 [SAVE] Creating GeneratedTemplate document...');
    const generatedTemplate = await GeneratedTemplate.create({
      templateId,
      name: templateName.trim(),
      html: conversation.currentHtml,
      userId,
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

    console.log('✅ [SAVE] GeneratedTemplate created successfully');
    console.log('📊 [SAVE] Template metadata:', {
      templateId: generatedTemplate.templateId,
      name: generatedTemplate.name,
      createdBy: generatedTemplate.createdBy,
      templateType: generatedTemplate.templateType,
      source: generatedTemplate.source,
      responsive: generatedTemplate.responsive,
      createdAt: generatedTemplate.createdAt,
      updatedAt: generatedTemplate.updatedAt,
    });

    console.log('💾 [SAVE] Updating conversation status...');
    conversation.templateName = templateName.trim();
    conversation.status = 'saved';
    conversation.savedTemplateId = templateId;
    await conversation.save();

    console.log('✅ [SAVE] Conversation updated to "saved" status');
    logger.info(`✅ Template saved to MongoDB: ${templateId}`);

    res.json({
      templateId,
      templateName: generatedTemplate.name,
      message: 'Template saved successfully',
    });
  } catch (error: any) {
    console.error('❌ [SAVE] Save template error:', error);
    console.error('❌ [SAVE] Error stack:', error.stack);
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