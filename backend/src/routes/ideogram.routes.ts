import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { isPromptAllowed, wrapMarketingPrompt } from '@src/util/ideogramPrompt';

// Configure Ideogram base URL via env (default to https://api.ideogram.ai)
// Normalize the env var so any trailing 
// `/vN` segment or trailing slashes are removed. This allows us to append /v3/generate
// without accidentally creating /v3/v3/generate.
const rawIdeogramUrl = process.env.IDEOGRAM_API_URL || 'https://api.ideogram.ai';
const IDEOGRAM_API_BASE = rawIdeogramUrl.replace(/\/v\d+\/?$/i, '').replace(/\/+$/, '');

// Default negative prompt to avoid cartoon/illustration-style or other unwanted artifacts
// Expanded to also block drawn/vector styles, poor-quality text rendering, watermarks and logos
const DEFAULT_NEGATIVE_PROMPT = 'cartoon, illustration, drawing, vector, painting, sketch, comic, anime, low-resolution, watermark, logo, text as part of image, hand-drawn text, posterized, flat color, caricature, fake lens flare, over-saturated, distorted food, messy composition';

const router = Router();

// Ideogram API configuration
const IDEOGRAM_API_KEY = process.env.IDEOGRAM_API_KEY || '';

// Convert some client-friendly fields to the v2 API shape.
function convertRequestToV2(req: any) {
  const copy = JSON.parse(JSON.stringify(req || {}));
  const ar = copy?.image_request?.aspect_ratio;
  if (ar) {
    const map: Record<string, string> = {
      '1:1': 'ASPECT_1_1',
      '16:9': 'ASPECT_16_9',
      '9:16': 'ASPECT_9_16',
      '4:3': 'ASPECT_4_3',
      '3:4': 'ASPECT_3_4',
      '3:2': 'ASPECT_3_2',
      '2:3': 'ASPECT_2_3',
      '1:3': 'ASPECT_1_3',
      '3:1': 'ASPECT_3_1',
      '10:16': 'ASPECT_10_16',
      '16:10': 'ASPECT_16_10'
    };
    copy.image_request.aspect_ratio = map[ar] || ar;
  }
  return copy;
}

// Convert '1:1' style aspect ratios to the v1 string form '1x1'
function convertAspectToV1(ar?: string) {
  if (!ar || typeof ar !== 'string') return ar;
  return ar.replace(/:/g, 'x');
}

// Convert human-friendly aspect ratios to Ideogram v1/v3 enum form (e.g. '1:1' -> 'ASPECT_1_1')
function convertAspectToEnum(ar?: string) {
  if (!ar || typeof ar !== 'string') return ar;
  const map: Record<string, string> = {
    '1:1': 'ASPECT_1_1',
    '16:9': 'ASPECT_16_9',
    '9:16': 'ASPECT_9_16',
    '4:3': 'ASPECT_4_3',
    '3:4': 'ASPECT_3_4',
    '3:2': 'ASPECT_3_2',
    '2:3': 'ASPECT_2_3',
    '1:3': 'ASPECT_1_3',
    '3:1': 'ASPECT_3_1',
    '10:16': 'ASPECT_10_16',
    '16:10': 'ASPECT_16_10'
  };
  return map[ar] || ar.replace(/:/g, 'x');
}

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

    // Prepare outgoing request object (start from client body)
    const outgoingRequest = { ...requestBody } as any;

    // Moderate + wrap the prompt server-side. Reject requests with disallowed content.
    const originalPrompt = requestBody.image_request?.prompt || '';
    const allowed = isPromptAllowed(originalPrompt);
    if (!allowed.ok) {
      return res.status(400).json({ success: false, message: allowed.reason || 'Prompt not allowed' });
    }

    // Replace prompt with our structured marketing wrapper (A., B., C. style).
    // The wrapper no longer forcefully forbids embedded text/numbers; clients may include
    // price/title in their prompt if they choose (we still recommend overlay composition).
  // Pass through client options (including allow_brand_names) to the wrapper so callers can opt-in
  const clientOpts = (requestBody.image_request as any)?.options || {};
  const wrapped = wrapMarketingPrompt(originalPrompt, { aspect_ratio: requestBody.image_request?.aspect_ratio, style_hint: clientOpts.style_hint, negative_hint: clientOpts.negative_hint, num_images: clientOpts.num_images, allow_brand_names: !!clientOpts.allow_brand_names });
    outgoingRequest.image_request = outgoingRequest.image_request || {};
    outgoingRequest.image_request.prompt = wrapped;

    // Note: we no longer force magic_prompt_option = 'OFF' server-side; clients can request it.

    // If client asked for v3/model 'v3', we'll send v3-compatible payload to the v3 endpoint below

    // Always use Ideogram v3 generate endpoint and v3 payload for improved text rendering.
    const r = outgoingRequest.image_request as any;
    // Map aspect_ratio to width/height (defaults to 1024x1024)
    let width = 1024;
    let height = 1024;
    if (r.aspect_ratio) {
      switch (r.aspect_ratio) {
        case '16:9': width = 1600; height = 900; break;
        case '9:16': width = 900; height = 1600; break;
        case '4:3': width = 1024; height = 768; break;
        case '3:4': width = 768; height = 1024; break;
        case '1:1':
        default: width = 1024; height = 1024; break;
      }
    }

    // Build candidate payloads for different Ideogram endpoint variants.
    // For the v1/v3 account-style endpoint, provide either `resolution` OR `aspect_ratio`, not both.
    const v1_v3_Body: any = {
      prompt: outgoingRequest.image_request.prompt,
      // Prefer realistic-style renders by default for marketing/photo assets
      style_type: outgoingRequest.image_request.style_type || 'REALISTIC',
      // Provide a conservative negative prompt by default to reduce illustration/cartoon artifacts
      negative_prompt: outgoingRequest.image_request.negative_prompt || DEFAULT_NEGATIVE_PROMPT,
      magic_prompt_option: outgoingRequest.image_request.magic_prompt_option || undefined,
      samples: outgoingRequest.samples || 1,
      ...(outgoingRequest.options || {})
    };

    // If the client explicitly provided a resolution string (or we derived one), prefer that.
    const clientResolution = outgoingRequest.image_request?.resolution;
    if (clientResolution) {
      v1_v3_Body.resolution = clientResolution;
    } else {
      // otherwise provide ONLY aspect_ratio in the '1x1' style and do NOT include resolution.
      v1_v3_Body.aspect_ratio = convertAspectToV1(outgoingRequest.image_request.aspect_ratio || '1:1');
      // Note: many v1 deployments reject both resolution and aspect_ratio together, so we avoid sending resolution here.
    }

    const v3Body: any = {
      prompt: outgoingRequest.image_request.prompt,
      model: 'v3',
      width,
      height,
      samples: (outgoingRequest.samples || 1),
      negative_prompt: outgoingRequest.image_request.negative_prompt || DEFAULT_NEGATIVE_PROMPT,
      // Use realistic style by default when not provided
      style: outgoingRequest.image_request.style_type || 'REALISTIC',
      ...(outgoingRequest.options || {})
    };

    // First try the account-style v1 ideogram-v3 endpoint which expects Api-Key header
    const v1v3Url = `${IDEOGRAM_API_BASE}/v1/ideogram-v3/generate`;
    console.debug('Ideogram proxy attempting v1 ideogram-v3 at:', { v1v3Url, bodySnippet: JSON.stringify(v1_v3_Body).slice(0,200) });

    let response = await fetch(v1v3Url, {
      method: 'POST',
      headers: {
        'Api-Key': IDEOGRAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(v1_v3_Body)
    });

    // If v1/v3 returns 404 or is not ok, fall back to the v3 path we previously used.
    if (!response.ok) {
      let tryBody: any = null;
      try { tryBody = await response.json(); } catch {}
      console.warn('v1 ideogram-v3 attempt failed, status:', response.status, 'body:', tryBody || '<unreadable>');

      // Try the v3/generate path with Bearer auth next
      const v3url = `${IDEOGRAM_API_BASE}/v3/generate`;
      const v3FetchOptions = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${IDEOGRAM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(v3Body)
      };

      console.debug('Ideogram proxy sending v3 to:', { url: v3url, bodySnippet: JSON.stringify(v3Body).slice(0,200) });
      response = await fetch(v3url, v3FetchOptions);
    }

    let data: any = null;
    let bodyText = '';
    try {
      data = await response.json();
    } catch (err) {
      try { bodyText = await response.text(); } catch { bodyText = '<unreadable body>'; }
    }

    // If the latest response is not ok and is a 404, we'll attempt the v2 /generate fallback.
    if (!response.ok && response.status === 404) {
      try {
        const fallbackUrl = `${IDEOGRAM_API_BASE}/generate`;
        console.warn('v3 endpoint returned 404 — retrying v2 generate at', fallbackUrl);
        const fallbackResp = await fetch(fallbackUrl, {
          method: 'POST',
          headers: {
            'Api-Key': IDEOGRAM_API_KEY,
            'Content-Type': 'application/json'
          },
          // Convert aspect_ratio to the v2 enum values before falling back
          body: JSON.stringify(convertRequestToV2(outgoingRequest))
        });

        let fallbackData: any = null;
        let fallbackText = '';
        try { fallbackData = await fallbackResp.json(); } catch { try { fallbackText = await fallbackResp.text(); } catch {} }

        if (!fallbackResp.ok) {
          console.error('Fallback v2 generate also failed:', { status: fallbackResp.status, body: fallbackData || fallbackText });
          return res.status(502).json({ success: false, message: fallbackData?.message || fallbackText || `Ideogram API returned ${fallbackResp.status}`, status: fallbackResp.status, body: fallbackData || fallbackText });
        }

        return res.status(200).json({ success: true, data: fallbackData });
      } catch (fbErr: any) {
        console.error('Error calling fallback v2 generate:', fbErr?.message || fbErr);
        return res.status(502).json({ success: false, message: fbErr?.message || 'Fallback to v2 failed' });
      }
    }

    if (!response.ok) {
      console.error('Ideogram generate error:', { status: response.status, body: data || bodyText });
      return res.status(502).json({ success: false, message: data?.message || bodyText || `Ideogram API returned ${response.status}`, status: response.status, body: data || bodyText });
    }

    return res.status(200).json({ success: true, data: data });

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
      `${IDEOGRAM_API_BASE}/describe`,
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
    const payload = req.body as any;
    const ir: any = payload.image_request || {};

    if (!ir.prompt) {
      return res.status(400).json({ success: false, message: 'Prompt is required' });
    }
    if (!ir.image_file && !ir.image_url) {
      return res.status(400).json({ success: false, message: 'image_file (or image_url) is required' });
    }
    const imageRef = ir.image_file || ir.image_url;

    // Moderation: always check for disallowed content
    const allowed = isPromptAllowed(ir.prompt);
    if (!allowed.ok) {
      return res.status(400).json({ success: false, message: allowed.reason || 'Prompt not allowed' });
    }

    // By default do not apply the marketing wrapper for remix requests.
    // If the client explicitly asks for marketing-style wrapping (for testing or
    // specific marketing edits), set image_request.options.use_marketing_wrapper = true
    // and optionally image_request.options.allow_brand_names to allow brand text.
    const clientOpts = (ir as any)?.options || payload?.options || {};
    if (clientOpts?.use_marketing_wrapper) {
      ir.prompt = wrapMarketingPrompt(ir.prompt, { aspect_ratio: ir.aspect_ratio, style_hint: clientOpts.style_hint, negative_hint: clientOpts.negative_hint, num_images: clientOpts.num_images, allow_brand_names: !!clientOpts.allow_brand_names });
    }

    if (!IDEOGRAM_API_KEY) {
      console.error('IDEOGRAM_API_KEY is not configured');
      return res.status(500).json({ success: false, message: 'Ideogram API key is not configured' });
    }

    console.debug('[REMIX] Incoming request:', JSON.stringify(payload).slice(0, 500));

    // If the image file is a remote URL, fetch it and build multipart/form-data
    if (typeof imageRef === 'string' && /^https?:\/\//i.test(imageRef)) {
      try {
        const imgResp = await fetch(imageRef);
        if (!imgResp.ok) {
          const errText = await imgResp.text().catch(() => '<unreadable body>');
          console.error('[REMIX] Failed to fetch image:', imgResp.status, errText);
          return res.status(400).json({
            success: false,
            message: `Failed to fetch remote image at ${imageRef}`,
            status: imgResp.status
          });
        }

        const arrayBuffer = await imgResp.arrayBuffer();
        const contentType = imgResp.headers.get('content-type') || 'application/octet-stream';

        // Compute a small fingerprint of the fetched image so we can verify we fetched
        // the same bytes the client saw. We log status, content-type, size and sha256.
        try {
          const buf = Buffer.from(arrayBuffer);
          const size = buf.length;
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          console.debug('[REMIX] Fetched remote image', { imageRef, status: imgResp.status, contentType, size, sha });
        } catch (hashErr) {
          console.warn('[REMIX] Failed to compute hash of fetched image', { imageRef, err: hashErr?.message || hashErr });
        }

        // Build multipart form-data
        const form = new FormData();
        // Ensure aspect_ratio uses v1 enum form for v1/v3 endpoints (e.g. 'ASPECT_1_1')
        const imageRequestPayload: any = { ...ir };
        // Default to realistic style for remixes unless caller specified otherwise
        imageRequestPayload.style_type = imageRequestPayload.style_type || 'REALISTIC';
        if (imageRequestPayload.aspect_ratio) {
          imageRequestPayload.aspect_ratio = convertAspectToEnum(imageRequestPayload.aspect_ratio);
        }
        // Log the outgoing image_request payload (trimmed) so we can verify what we sent to Ideogram
        try {
          console.debug('[REMIX] Outgoing image_request payload:', JSON.stringify(imageRequestPayload).slice(0, 1000));
        } catch (logErr) {
          console.warn('[REMIX] Failed to stringify image_request payload', logErr?.message || logErr);
        }

        form.append('image_request', JSON.stringify(imageRequestPayload)); // JSON wrapper
        form.append('image_file', new Blob([arrayBuffer], { type: contentType }), 'remix.png');
        // Optional compatibility alias
        form.append('image', new Blob([arrayBuffer], { type: contentType }), 'remix.png');

        // Send multipart remix request
        const remixUrl = `${IDEOGRAM_API_BASE}/remix`;
        console.debug('[REMIX] Sending multipart remix to:', remixUrl);

        const remixResp = await fetch(remixUrl, {
          method: 'POST',
          headers: {
            'Api-Key': IDEOGRAM_API_KEY
            // NOTE: Do NOT set Content-Type here — fetch will handle correct boundaries
          } as any,
          body: form as any
        });

        const remixBody = await safeRead(remixResp);

        // Log a summary of the Ideogram response so we can trace returned image URLs
        try {
          console.debug('[REMIX] Ideogram remix response summary', {
            status: remixResp.status,
            bodySnippet: JSON.stringify(remixBody).slice(0, 1000),
            firstUrl: remixBody?.data?.[0]?.url || null
          });
        } catch (logErr) {
          console.warn('[REMIX] Failed to log remix response summary', logErr?.message || logErr);
        }

        if (!remixResp.ok) {
          console.error('[REMIX] Remix error:', remixResp.status, remixBody);
          return res.status(502).json({
            success: false,
            message: remixBody?.message || remixBody || `Ideogram remix failed with status ${remixResp.status}`,
            status: remixResp.status,
            body: remixBody
          });
        }

        return res.status(200).json({ success: true, data: remixBody });
      } catch (err: any) {
        console.error('[REMIX] Unexpected remix error:', err?.message || err);
        return res.status(500).json({ success: false, message: err?.message || 'Unexpected remix error' });
      }
    }

    // If image is not a remote URL, pass through JSON
    console.debug('[REMIX] Sending JSON remix to IDEOGRAM');
    // Convert aspect_ratio for v1/v3 API when sending JSON payloads as well
    const jsonPayload = JSON.parse(JSON.stringify(payload || {}));
    if (jsonPayload.image_request && jsonPayload.image_request.aspect_ratio) {
      jsonPayload.image_request.aspect_ratio = convertAspectToEnum(jsonPayload.image_request.aspect_ratio);
    }
    const resp = await fetch(`${IDEOGRAM_API_BASE}/remix`, {
      method: 'POST',
      headers: {
        'Api-Key': IDEOGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonPayload),
    });

    const body = await safeRead(resp);

    if (!resp.ok) {
      console.error('[REMIX] JSON remix failed:', resp.status, body);
      return res.status(502).json({
        success: false,
        message: body?.message || body || `Ideogram remix failed with status ${resp.status}`,
        status: resp.status,
        body,
      });
    }

    return res.status(200).json({ success: true, data: body });

  } catch (err: any) {
    console.error('[REMIX] Critical remix error:', err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || 'Remix failed' });
  }
});

// Helper: read response safely (works for fetch Response)
async function safeRead(resp: any) {
  try {
    return await resp.json();
  } catch {
    try {
      return await resp.text();
    } catch {
      return '<unreadable body>';
    }
  }
}
export default router;
