import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';
import TemplateConversation from '@src/models/TemplateConversation';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import GeneratedImage from '@src/models/GeneratedImage';
import User from '@src/models/User';
import { generateTemplate, refineTemplate } from '@src/services/templateGenerationService';
import fs from 'fs';
import path from 'path';
import { convertMjmlToHtml, validateMjml, getMjmlStarter } from '@src/services/mjmlConversionService';
import logger from 'jet-logger';
import { randomUUID } from 'crypto';

const router = Router();


// Test route to verify router is working
router.get('/test', (req: Request, res: Response) => {
  res.json({ message: 'Template generation router is working!' });
});


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
 * POST /api/generate/chat
 * Single unified endpoint for template generation chat
 * ✅ Stateless: Frontend sends full conversation history
 * ✅ No database: Everything managed in frontend cache
 * ✅ Simple: One endpoint for all messages
 */
router.post('/chat', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
  const { message, conversationHistory = [], currentMjml, images, extractedFileData } = req.body;
    const userId = (req as any).tokenPayload?.userId;
    const organization = (req as any).organization;
    
    if (!organization) {
      return res.status(403).json({ 
        code: 'NO_ORGANIZATION', 
        message: 'You must belong to an organization to generate templates' 
      });
    }

    if (!message || !message.trim()) {
      logger.warn('⚠️ Invalid message - empty or missing');
      return res.status(400).json({ 
        code: 'INVALID_MESSAGE', 
        message: 'Message is required' 
      });
    }

    logger.info(`💬 Chat request from user ${userId}`);
    logger.info(`📝 Message length: ${message.length}`);
    logger.info(`📋 Conversation history: ${conversationHistory.length} messages`);
    logger.info(`🖼️ Images: ${images?.length || 0}`);
    logger.info(`📄 Current MJML: ${currentMjml ? 'Yes' : 'No'}`);
    logger.info(`📎 Extracted file data: ${extractedFileData ? 'Yes' : 'No'}`);
    if (extractedFileData) {
      logger.info(`📎 File data length: ${extractedFileData.length}`);
      logger.info(`📎 First 200 chars: ${extractedFileData.substring(0, 200)}`);
    }

    if (images && images.length > 0) {
      logger.info(`📊 Image details:`, images.map((img: any) => ({
        fileName: img.fileName,
        mediaType: img.mediaType,
        dataLength: img.data?.length
      })));
    }

    // If the client sent base64 image attachments, save them to disk and build public URLs
    const uploadedImageUrls: string[] = [];
    try {
      if (images && images.length > 0) {
        // Write into server's served public directory so files are accessible at /uploads/master/<file>
        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'master');
        try {
          fs.mkdirSync(uploadDir, { recursive: true });
        } catch (e) {
          // ignore
        }

        const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10); // default 5MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

        for (const img of images) {
          try {
            // img.data is expected to be base64 (without data: prefix)
            if (img.data && typeof img.data === 'string') {
              const buffer = Buffer.from(img.data, 'base64');

              // Server-side validation: size
              if (buffer.length > MAX_UPLOAD_BYTES) {
                logger.warn(`⚠️ Uploaded image ${img.fileName || 'unknown'} exceeds max size (${buffer.length} bytes)`);
                return res.status(400).json({ code: 'FILE_TOO_LARGE', message: `File ${img.fileName || ''} is too large` });
              }

              // Validate media type if provided
              if (img.mediaType && !allowedTypes.includes(String(img.mediaType).toLowerCase())) {
                logger.warn(`⚠️ Uploaded image ${img.fileName || 'unknown'} has disallowed media type: ${img.mediaType}`);
                return res.status(400).json({ code: 'INVALID_FILE_TYPE', message: `File ${img.fileName || ''} has invalid type` });
              }

              const ext = (img.mediaType && img.mediaType.split('/')[1]) || (img.fileName && img.fileName.split('.').pop()) || 'jpg';
              const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
              const fileName = `attached_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${safeExt}`;
              const filePath = path.join(uploadDir, fileName);
              fs.writeFileSync(filePath, buffer);

              const host = req.get('host');
              const protocol = req.protocol;
              const publicUrl = `${protocol}://${host}/uploads/master/${fileName}`;

              // Persist metadata to GeneratedImage collection
              try {
                const imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                await GeneratedImage.create({
                  imageId,
                  name: img.fileName && String(img.fileName).trim() ? String(img.fileName).trim() : 'uploaded_image',
                  prompt: 'Uploaded attachment',
                  wrappedPrompt: undefined,
                  userId: userId,
                  organizationId: organization._id,
                  source: 'upload',
                  modelName: 'upload',
                  width: undefined,
                  height: undefined,
                  url: publicUrl,
                  thumbnail: publicUrl,
                  metadata: { originalName: img.fileName || null },
                });

                uploadedImageUrls.push(publicUrl);
              } catch (dbErr) {
                logger.err('Failed to persist GeneratedImage', dbErr?.message || dbErr);
                // Still push the URL so generation can proceed, but log error
                uploadedImageUrls.push(publicUrl);
              }
            } else if (img.url) {
              uploadedImageUrls.push(String(img.url));
            }
          } catch (e) {
            logger.err('Failed to write uploaded image', e?.message || e);
          }
        }

        logger.info(`📥 Saved ${uploadedImageUrls.length} attached images to public uploads`);
      }
    } catch (e) {
      logger.err('Error processing attached images', e?.message || e);
    }

    // Determine if this is a new template or refinement
    let result;
    if (currentMjml) {
      // Refinement - use existing MJML + new request
      logger.info(`🔧 Refining existing template...`);
      result = await refineTemplate(
        currentMjml,
        message.trim(),
        conversationHistory,  // ✅ Full history from frontend
        userId,
        images || undefined,
        extractedFileData || undefined
      );
    } else {
      // New template - generate from scratch
      logger.info(`🎨 Generating new template...`);
      result = await generateTemplate({
        prompt: message.trim(),
        conversationHistory,  // ✅ Full history from frontend
        userId,
        images: images || undefined,
        extractedFileData: extractedFileData || undefined,
      });
    }

    logger.info(`✅ Template ${currentMjml ? 'refined' : 'generated'} successfully`);
    logger.info(`📄 MJML length: ${result.mjmlCode?.length}`);
    logger.info(`🔄 Attempts used: ${result.attemptsUsed}`);

    // Convert MJML to HTML
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

    // ✅ Simple response - no database, no conversationId tracking
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
  } catch (error: any) {
    logger.err('❌ Chat error:', error);
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
 * GET /api/generate/conversation/:conversationId
 * Get conversation history
 */
router.get('/conversation/:conversationId', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).tokenPayload?.userId;
    const organization = (req as any).organization;

    logger.info(`📖 Getting conversation: ${conversationId} for user: ${userId}`);

    const conversation = await TemplateConversation.findOne({
      conversationId,
      userId,
      organizationId: organization?._id
    });

    if (!conversation) {
      logger.warn(`⚠️ Conversation not found: ${conversationId} for user: ${userId}`);
      return res.status(404).json({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }

    logger.info(`✅ Conversation found with ${conversation.messages.length} messages`);

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
    const organization = (req as any).organization;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await TemplateConversation.find({
      userId,
      organizationId: organization?._id
    })
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .select('conversationId templateName status createdAt updatedAt messages');

    const total = await TemplateConversation.countDocuments({
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
 * ✅ Cache-only mode: Frontend sends HTML/MJML directly
 */
router.post('/save/:conversationId', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { templateName, html, mjml } = req.body;
    const userId = (req as any).tokenPayload?.userId;
    const organization = (req as any).organization;

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
    
    // ✅ Accept HTML from frontend (cache-only mode)
    if (!html) {
      console.error('❌ [SAVE] No HTML content provided');
      return res.status(400).json({
        code: 'NO_TEMPLATE',
        message: 'No template to save',
      });
    }
    const user = await User.findById(userId);
    
    if (!user) {
      console.error('❌ [SAVE] User not found:', userId);
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    // ✅ Save using HTML from frontend (no conversation lookup needed)
    const generatedTemplate = await GeneratedTemplate.create({
      templateId,
      name: templateName.trim(),
      html: html, // ✅ From frontend cache
      userId,
      organizationId: organization._id, // ✅ ORGANIZATION ISOLATION
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
