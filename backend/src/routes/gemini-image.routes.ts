import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { isPromptAllowed, wrapMarketingPrompt, wrapRemixPrompt } from '@src/util/ideogramPrompt';
import { GoogleGenAI } from '@google/genai';

const router = Router();

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';

// Initialize Gemini client (API key can be passed via env or constructor)
const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : new GoogleGenAI({});

// Aspect ratio mapping from client format to Gemini format
const ASPECT_RATIO_MAP: Record<string, '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
  '3:2': '3:2',
  '2:3': '2:3',
  '4:5': '4:5',
  '5:4': '5:4',
  '21:9': '21:9',
};

// Convert client aspect ratio to Gemini format (default to 16:9 for banners)
function convertAspectRatio(ar?: string): '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' {
  if (!ar || typeof ar !== 'string') return '16:9'; // Default to 16:9 for banners
  return ASPECT_RATIO_MAP[ar] || '16:9';
}

interface GeminiGenerateRequest {
  image_request: {
    prompt: string;
    aspect_ratio?: string;
    resolution?: '1K' | '2K' | '4K'; // For Gemini 3 Pro Image Preview
    style_type?: string; // Not directly supported, but we can add to prompt
    negative_prompt?: string; // Not directly supported, but we can add to prompt
  };
  samples?: number;
}

/**
 * Generate image using Gemini Nano Banana Pro (gemini-3-pro-image-preview)
 * POST /api/gemini-image/generate
 * 
 * Uses Gemini 3 Pro Image Preview for professional banner generation with:
 * - High-fidelity text rendering (perfect for banners)
 * - Up to 4K resolution
 * - Real-world grounding via Google Search
 * - Default "Thinking" process for better composition
 */
router.post('/generate', authenticate, async (req: Request, res: Response) => {
  try {
    const requestBody: GeminiGenerateRequest = req.body;

    if (!requestBody.image_request?.prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    if (!GEMINI_API_KEY || !genai) {
      console.error('GEMINI_API_KEY is not configured');
      return res.status(500).json({
        success: false,
        message: 'Gemini API is not configured. Please contact support.'
      });
    }

    // Moderate + wrap the prompt server-side
    const originalPrompt = requestBody.image_request?.prompt || '';
    const allowed = isPromptAllowed(originalPrompt);
    if (!allowed.ok) {
      return res.status(400).json({ success: false, message: allowed.reason || 'Prompt not allowed' });
    }

    // Wrap prompt for marketing/banner generation
    const clientOpts = (requestBody.image_request as any)?.options || {};
    const wrapped = wrapMarketingPrompt(originalPrompt, {
      aspect_ratio: requestBody.image_request?.aspect_ratio,
      style_hint: clientOpts.style_hint,
      negative_hint: clientOpts.negative_hint,
      num_images: clientOpts.num_images,
      allow_brand_names: !!clientOpts.allow_brand_names
    });

    // Convert aspect ratio
    const aspectRatio = convertAspectRatio(requestBody.image_request?.aspect_ratio);
    
    // Use Gemini 3 Pro Image Preview for professional banner generation
    // This model has high-fidelity text rendering and up to 4K resolution
    // For faster generation, use 'gemini-2.5-flash-image' instead
    const useProModel = requestBody.image_request?.resolution === '4K' || requestBody.image_request?.resolution === '2K';
    const model = useProModel ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
    
    // Resolution: 1K (default), 2K, or 4K for banners
    const resolution = requestBody.image_request?.resolution || '1K';
    
    // Build the prompt with style hints if provided
    let finalPrompt = wrapped;
    if (requestBody.image_request?.style_type) {
      finalPrompt = `${finalPrompt}\n\nStyle: ${requestBody.image_request.style_type.toLowerCase()}, professional marketing banner, high-quality text rendering`;
    }
    if (requestBody.image_request?.negative_prompt) {
      finalPrompt = `${finalPrompt}\n\nAvoid: ${requestBody.image_request.negative_prompt}`;
    }

    console.debug('Gemini image generation:', {
      model,
      aspectRatio,
      resolution,
      promptLength: finalPrompt.length,
      promptPreview: finalPrompt.substring(0, 200)
    });

    // Generate image using Gemini
    // API structure based on @google/genai SDK
    const response = await genai.models.generateContent({
      model,
      contents: finalPrompt, // Can be string or array
      config: {
        imageConfig: {
          aspectRatio,
        },
      },
    });

    // Extract image from response
    // Response structure: response.candidates[0].content.parts[] where parts can have text or inlineData
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part.inlineData);

    if (!imagePart) {
      console.error('No image in Gemini response:', JSON.stringify(response, null, 2));
      return res.status(502).json({
        success: false,
        message: 'Gemini did not return an image'
      });
    }

    // Extract image data
    const imageData = imagePart.inlineData?.data;
    const mimeType = imagePart.inlineData?.mimeType || 'image/png';
    
    if (!imageData) {
      console.error('No image data in response part:', imagePart);
      return res.status(502).json({
        success: false,
        message: 'Gemini response missing image data'
      });
    }

    // Convert base64 to data URL for client
    const imageUrl = `data:${mimeType};base64,${imageData}`;

    // Return in Ideogram-compatible format for easy migration
    const result = {
      created: new Date().toISOString(),
      data: [{
        url: imageUrl,
        prompt: wrapped,
        resolution: `${resolution} (${aspectRatio})`,
        is_image_safe: true, // Gemini has built-in safety
      }]
    };

    return res.status(200).json({ success: true, data: result });

  } catch (error: any) {
    console.error('Gemini image generation error:', error.message, error);
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate image'
    });
  }
});

/**
 * Remix/edit image using Gemini (Image + Text-to-Image editing)
 * POST /api/gemini-image/remix
 * 
 * Uses Gemini's image editing capabilities to modify existing images
 */
router.post('/remix', authenticate, async (req: Request, res: Response) => {
  try {
    const payload = req.body as any;
    const ir: any = payload.image_request || {};

    if (!ir.prompt) {
      return res.status(400).json({ success: false, message: 'Prompt is required' });
    }
    if (!ir.image_file && !ir.image_url) {
      return res.status(400).json({ success: false, message: 'image_file (or image_url) is required' });
    }

    // Handle both image_file (can be string URL or Buffer) and image_url (string URL)
    // If image_file is a string (data URL or HTTP URL), treat it as a URL
    const imageRef = (typeof ir.image_file === 'string') ? ir.image_file : (ir.image_file || ir.image_url);

    // Moderation
    const allowed = isPromptAllowed(ir.prompt);
    if (!allowed.ok) {
      return res.status(400).json({ success: false, message: allowed.reason || 'Prompt not allowed' });
    }

    // Use remix-specific wrapper to maintain original image context
    // This ensures the AI preserves the original composition while making requested changes
    const clientOpts = (ir as any)?.options || payload?.options || {};
    let prompt = wrapRemixPrompt(ir.prompt, {
      aspect_ratio: ir.aspect_ratio,
      style_hint: clientOpts.style_hint,
      negative_hint: clientOpts.negative_hint,
      allow_brand_names: !!clientOpts.allow_brand_names
    });

    if (!GEMINI_API_KEY || !genai) {
      console.error('GEMINI_API_KEY is not configured');
      return res.status(500).json({ success: false, message: 'Gemini API key is not configured' });
    }

    // Fetch image if it's a URL (HTTP/HTTPS or data URL)
    let imageData: Buffer | null = null;
    let imageMimeType = 'image/png';

    if (typeof imageRef === 'string') {
      // Handle data URLs (data:image/png;base64,...)
      if (imageRef.startsWith('data:')) {
        try {
          const dataUrlMatch = imageRef.match(/^data:([^;]+);base64,(.+)$/);
          if (dataUrlMatch) {
            imageMimeType = dataUrlMatch[1] || 'image/png';
            const base64Data = dataUrlMatch[2];
            imageData = Buffer.from(base64Data, 'base64');
          } else {
            return res.status(400).json({
              success: false,
              message: 'Invalid data URL format'
            });
          }
        } catch (err: any) {
          return res.status(400).json({
            success: false,
            message: `Failed to parse data URL: ${err.message}`
          });
        }
      } 
      // Handle HTTP/HTTPS URLs
      else if (/^https?:\/\//i.test(imageRef)) {
        try {
          const imgResp = await fetch(imageRef);
          if (!imgResp.ok) {
            return res.status(400).json({
              success: false,
              message: `Failed to fetch remote image at ${imageRef}`,
              status: imgResp.status
            });
          }
          const arrayBuffer = await imgResp.arrayBuffer();
          imageData = Buffer.from(arrayBuffer);
          imageMimeType = imgResp.headers.get('content-type') || 'image/png';
        } catch (err: any) {
          return res.status(400).json({
            success: false,
            message: `Failed to fetch image: ${err.message}`
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid image URL format'
        });
      }
    } else if (imageRef instanceof Buffer) {
      imageData = imageRef;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid image format'
      });
    }

    // Convert image to base64
    const imageBase64 = imageData.toString('base64');

    // Convert aspect ratio
    const aspectRatio = convertAspectRatio(ir.aspect_ratio);

    console.debug('Gemini image remix:', {
      promptLength: prompt.length,
      aspectRatio,
      imageSize: imageData.length
    });

    // Use Gemini for image editing (Image + Text-to-Image)
    // For remix/editing, use the same model as generate
    const useProModel = ir.resolution === '4K' || ir.resolution === '2K';
    const model = useProModel ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
    
    console.debug('Gemini remix API call:', {
      model,
      promptLength: prompt.length,
      imageSize: imageData.length,
      imageMimeType,
      aspectRatio
    });
    
    // Gemini API for image editing: provide image and text prompt
    const response = await genai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType: imageMimeType
              }
            },
            { text: prompt }
          ]
        }
      ],
      config: {
        imageConfig: {
          aspectRatio,
        },
      },
    });

    // Extract edited image
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part.inlineData);

    if (!imagePart) {
      console.error('No image in Gemini remix response:', JSON.stringify(response, null, 2));
      return res.status(502).json({
        success: false,
        message: 'Gemini did not return an edited image'
      });
    }

    // Extract image data
    const editedImageData = imagePart.inlineData?.data;
    const editedMimeType = imagePart.inlineData?.mimeType || 'image/png';
    
    if (!editedImageData) {
      return res.status(502).json({
        success: false,
        message: 'Gemini response missing edited image data'
      });
    }

    // Convert to data URL
    const editedImageUrl = `data:${editedMimeType};base64,${editedImageData}`;

    // Return in Ideogram-compatible format
    const result = {
      created: new Date().toISOString(),
      data: [{
        url: editedImageUrl,
        prompt: prompt,
        resolution: `1K (${aspectRatio})`,
        is_image_safe: true,
      }]
    };

    return res.status(200).json({ success: true, data: result });

  } catch (err: any) {
    console.error('[REMIX] Gemini remix error:', err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || 'Remix failed' });
  }
});

/**
 * Describe image using Gemini (for compatibility, though Gemini doesn't have a dedicated describe endpoint)
 * POST /api/gemini-image/describe
 * 
 * Uses Gemini's vision capabilities to describe images
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

    if (!GEMINI_API_KEY || !genai) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API is not configured'
      });
    }

    // Fetch image
    const imgResp = await fetch(image_url);
    if (!imgResp.ok) {
      return res.status(400).json({
        success: false,
        message: `Failed to fetch image: ${imgResp.status}`
      });
    }

    const arrayBuffer = await imgResp.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgResp.headers.get('content-type') || 'image/png';

    // Use Gemini to describe the image (use a text model for descriptions)
    const model = 'gemini-2.5-flash'; // Use text model for descriptions
    const response = await genai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType: mimeType
              }
            },
            { text: 'Describe this image in detail. Focus on the content, style, colors, composition, and any text visible in the image.' }
          ]
        }
      ],
    });

    const description = response.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not generate description';

    // Return in Ideogram-compatible format
    return res.status(200).json({
      success: true,
      data: {
        descriptions: [description]
      }
    });

  } catch (error: any) {
    console.error('Gemini describe error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to describe image'
    });
  }
});

export default router;

