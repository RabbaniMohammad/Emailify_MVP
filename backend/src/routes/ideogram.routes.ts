import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// Ideogram API configuration
const IDEOGRAM_API_KEY = process.env.IDEOGRAM_API_KEY || '';
const IDEOGRAM_API_URL = 'https://api.ideogram.ai/v2';

interface IdeogramGenerateRequest {
  image_request: {
    prompt: string;
    aspect_ratio?: string;
    model?: string;
    magic_prompt_option?: string;
    style_type?: string;
    negative_prompt?: string;
  };
}

/**
 * Generate image using Ideogram 2.0 API
 * POST /api/ideogram/generate
 */
router.post('/generate', authenticate, async (req: Request, res: Response) => {
  try {
    const requestBody: IdeogramGenerateRequest = req.body;

    if (!requestBody.image_request?.prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    if (!IDEOGRAM_API_KEY) {
      console.error('IDEOGRAM_API_KEY is not configured');
      return res.status(500).json({
        success: false,
        message: 'Ideogram API is not configured. Please contact support.'
      });
    }

    // Call Ideogram API
    const response = await fetch(
      `${IDEOGRAM_API_URL}/generate`,
      {
        method: 'POST',
        headers: {
          'Api-Key': IDEOGRAM_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to generate image');
    }

    return res.status(200).json({
      success: true,
      data: data
    });

  } catch (error: any) {
    console.error('Ideogram generate error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate image'
    });
  }
});

/**
 * Describe image using Ideogram API
 * POST /api/ideogram/describe
 */
router.post('/describe', authenticate, async (req: Request, res: Response) => {
  try {
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({
        success: false,
        message: 'Image URL is required'
      });
    }

    if (!IDEOGRAM_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Ideogram API is not configured'
      });
    }

    const response = await fetch(
      `${IDEOGRAM_API_URL}/describe`,
      {
        method: 'POST',
        headers: {
          'Api-Key': IDEOGRAM_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ image_url })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to describe image');
    }

    return res.status(200).json({
      success: true,
      data: data
    });

  } catch (error: any) {
    console.error('Ideogram describe error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to describe image'
    });
  }
});

/**
 * Remix image using Ideogram API
 * POST /api/ideogram/remix
 */
router.post('/remix', authenticate, async (req: Request, res: Response) => {
  try {
    const requestBody: IdeogramGenerateRequest = req.body;

    if (!requestBody.image_request?.prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    if (!IDEOGRAM_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Ideogram API is not configured'
      });
    }

    const response = await fetch(
      `${IDEOGRAM_API_URL}/remix`,
      {
        method: 'POST',
        headers: {
          'Api-Key': IDEOGRAM_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to remix image');
    }

    return res.status(200).json({
      success: true,
      data: data
    });

  } catch (error: any) {
    console.error('Ideogram remix error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to remix image'
    });
  }
});

export default router;
