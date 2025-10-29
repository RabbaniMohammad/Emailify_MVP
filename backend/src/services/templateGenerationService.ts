import Anthropic from '@anthropic-ai/sdk';
import logger from 'jet-logger';
import mjml2html from 'mjml';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

// ⭐ CONFIGURATION
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT || '120000', 10); // 2 minutes default
const MAX_GENERATION_RETRIES = 5; // Number of attempts to fix MJML errors

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: API_TIMEOUT,
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = parseInt(process.env.GENERATION_MAX_TOKENS || '4096', 10);

interface GenerationRequest {
  prompt: string;
  conversationHistory?: Array<{ 
    role: 'user' | 'assistant'; 
    content: string;
    images?: Array<{ data: string; mediaType: string; fileName: string }>;
  }>;
  userId: string;
  images?: Array<{ data: string; mediaType: string; fileName: string }>;
}

interface GenerationResponse {
  mjmlCode: string;
  assistantMessage: string;
  conversationId: string;
  attemptsUsed?: number;
  hadErrors?: boolean;
}

/**
 * System prompt for MJML generation with strict requirements
 */
/**
 * System prompt for MJML generation with strict requirements
 */
function getSystemPrompt(): string {
  return `You are an expert MJML email template generator. Your job is to create production-ready, responsive email templates using MJML.

🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY:

1. Your response must be COMPLETE - do not let it get cut off
2. Keep templates reasonably sized (aim for under 6000 characters total)
3. If the user asks for something very complex, create a simplified version
4. Your ENTIRE response must be ONLY the MJML code (no explanations before or after)
5. Start your response with <mjml> (the very first character)
6. End your response with </mjml> (the very last characters)

📱 MOBILE-FIRST RESPONSIVE DESIGN:
- ALL templates MUST be mobile-first and fully responsive
- Design for mobile screens (320-480px) FIRST, then scale up to desktop (600px+)
- MOBILE (default):
  * Use single column layouts for easy scrolling
  * Center-align headings, buttons, and CTAs for better mobile UX
  * Ensure buttons are easily tappable (min 44px height, full-width or centered)
  * Min 16px font size for body text (14px minimum for secondary text)
  * Adequate padding and spacing for touch targets
- DESKTOP (600px+ width):
  * Can use multi-column layouts if appropriate
  * Buttons can be left/right aligned if design requires
  * Larger font sizes and more spacing where appropriate
- CRITICAL: By default, center-align all headings, buttons, and important CTAs
- Use align="center" on mj-text and mj-button for mobile-friendly layouts

🖼️ IMAGE REFERENCES (IF PROVIDED):
- If the user provides design reference images, analyze them carefully for:
  - Color schemes and branding
  - Layout structure and spacing
  - Typography choices
  - Visual hierarchy and content organization
  - Overall design style and aesthetic
- Focus PRIMARY on the user's TEXT PROMPT for functionality and content
- Use the IMAGES as design inspiration for visual style, colors, and layout
- If NO images provided, create a beautiful, professional design on your own
- Never reference or mention the images in your MJML code (just use them for inspiration)

RESPONSE FORMAT (CRITICAL):
❌ WRONG: "Here's your template:\n<mjml>..." 
❌ WRONG: "<mjml>...</mjml>\n\nThis template includes..."
❌ WRONG: \`\`\`mjml\n<mjml>...\`\`\`
✅ CORRECT: <mjml><mj-head>...</mj-head><mj-body>...</mj-body></mjml>

Your response = MJML code ONLY. Nothing else.

VALID MJML COMPONENTS:
- mj-section: Container for columns
- mj-column: Column inside section
- mj-text: Text content
- mj-button: Call-to-action button
- mj-image: Images
- mj-divider: Horizontal line
- mj-spacer: Vertical spacing
- mj-social: Social media icons

VALID ATTRIBUTES BY COMPONENT:
- mj-text: font-size, font-family, color, line-height, padding, align, font-weight
- mj-button: background-color, color, font-size, border-radius, padding, href, align
- mj-image: src, alt, width, height, padding, border-radius, align
- mj-section: background-color, padding, full-width, background-url
- mj-column: width, padding, background-color
- mj-divider: border-color, border-width, padding
- mj-spacer: height

❌ INVALID ATTRIBUTES (DO NOT USE):
- border-radius on mj-text (use mj-button instead for rounded elements)
- margin (use padding instead)
- Any attribute not listed above for that component

REQUIRED MJML STRUCTURE:
<mjml>
  <mj-head>
    <mj-title>Email Title</mj-title>
    <mj-preview>Preview text that appears in inbox</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="20px" color="#333333" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>Your content here</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>

EMAIL BEST PRACTICES:
- Max width: 600px (MJML handles this automatically)
- Use web-safe fonts: Arial, Georgia, Times New Roman, Courier, Verdana
- Proper color contrast for accessibility
- Include alt text for all images
- Keep file size reasonable (aim for <6000 characters)
- Always include mj-head with title and preview
- Use mj-attributes for consistent global styling

ERROR HANDLING:
If you receive an error message about:
- Invalid attributes: Remove the problematic attribute and use only valid ones
- Truncation/max_tokens: Simplify the template significantly, reduce sections
- Missing closing tags: Ensure every tag is properly closed
- Validation errors: Fix the exact issue mentioned and regenerate

REMEMBER:
- Your entire response = MJML code only
- First character: <mjml>
- Last characters: </mjml>
- No explanations, no markdown, no extra text
- Must be complete and valid
- Mobile-first, responsive design ALWAYS
- Use image references for visual inspiration (if provided)
- Focus on user's text prompt for content and functionality
- Email clients are unforgiving - your MJML must be perfect!

Now generate the requested email template following ALL rules above.`;
}

/**
 * Generate error feedback prompt for retry attempts
 */
function getErrorFeedbackPrompt(error: string, previousCode?: string, attempt?: number): string {
  let prompt = `❌ ERROR in attempt ${attempt}: The MJML code has an issue:

${error}

`;

  // ⭐ ADD SPECIFIC GUIDANCE FOR COMMON ERRORS
  if (error.includes('illegal') || error.includes('Attribute')) {
    prompt += `\n⚠️ This is an ATTRIBUTE ERROR. Some attributes you used are not valid for that MJML component.

COMMON FIXES:
- Remove "border-radius" from mj-text (use mj-button instead for rounded buttons)
- Only use valid attributes for each component
- Check the MJML documentation for allowed attributes

`;
  }

  if (error.includes('truncat') || error.includes('max_tokens')) {
    prompt += `\n⚠️ Your previous response was TOO LONG and got cut off.

PLEASE SIMPLIFY:
- Use fewer sections
- Reduce decorative elements
- Keep content concise
- Aim for under 6000 characters total

`;
  }

  if (previousCode && previousCode.length > 800) {
    const codePreview = previousCode.substring(0, 800) + '...[truncated for brevity]';
    prompt += `Part of your previous code:\n${codePreview}\n\n`;
  }

  prompt += `Fix these issues and provide ONLY the corrected, complete MJML code.

REQUIREMENTS:
- Must start with <mjml> and end with </mjml>
- Must be COMPLETE (not truncated)
- Use ONLY valid MJML attributes
- No explanations, just code

Provide the corrected MJML now:`;

  return prompt;
}

/**
 * Extract MJML code from Claude's response
 */
function extractMJMLCode(text: string): string {
  // ⭐ LOG ORIGINAL TEXT FOR DEBUGGING
  logger.info(`🔍 Attempting to extract MJML from text (length: ${text.length})`);
  
  // Remove markdown code blocks if present
  let cleaned = text
    .replace(/```mjml\s*/gi, '')
    .replace(/```xml\s*/gi, '')
    .replace(/```html\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // ⭐ METHOD 1: Try to find complete MJML tags (case insensitive, with attributes)
  const mjmlMatch = cleaned.match(/<mjml[^>]*>[\s\S]*?<\/mjml>/i);
  
  if (mjmlMatch) {
    logger.info(`✅ Method 1: Found MJML via regex match`);
    return mjmlMatch[0];
  }

  // ⭐ METHOD 2: Look for mjml tags manually (handles weird spacing)
  const mjmlStartIndex = cleaned.search(/<mjml[\s>]/i);
  const mjmlEndIndex = cleaned.search(/<\/mjml>/i);
  
  if (mjmlStartIndex !== -1 && mjmlEndIndex !== -1 && mjmlEndIndex > mjmlStartIndex) {
    const extracted = cleaned.substring(mjmlStartIndex, mjmlEndIndex + 7); // +7 for </mjml>
    logger.info(`✅ Method 2: Extracted MJML by finding tags manually`);
    return extracted;
  }

  // ⭐ METHOD 3: Check if entire response is MJML (no extra text)
  if (cleaned.toLowerCase().startsWith('<mjml') && cleaned.toLowerCase().endsWith('</mjml>')) {
    logger.info(`✅ Method 3: Entire response is MJML`);
    return cleaned;
  }

  // ⭐ METHOD 4: Look for any mj- components and try to extract
  if (cleaned.includes('mj-') || cleaned.toLowerCase().includes('<mjml')) {
    logger.info(`⚠️ Method 4: Found mj- components but no complete MJML structure`);
    logger.info(`First 300 chars: ${cleaned.substring(0, 300)}`);
    
    // Try to find where MJML might start
    const possibleStart = cleaned.search(/<mjml/i);
    if (possibleStart !== -1) {
      // Look for closing tag after that
      const remainingText = cleaned.substring(possibleStart);
      const possibleEnd = remainingText.search(/<\/mjml>/i);
      
      if (possibleEnd !== -1) {
        const extracted = remainingText.substring(0, possibleEnd + 7);
        logger.info(`✅ Method 4: Extracted partial MJML`);
        return extracted;
      }
    }
  }

  // ⭐ LAST RESORT: Log what we received and throw error
  logger.err(`❌ Failed to extract MJML. Response preview:`);
  logger.err(`First 500 chars: ${cleaned.substring(0, 500)}`);
  logger.err(`Last 200 chars: ${cleaned.substring(Math.max(0, cleaned.length - 200))}`);
  logger.err(`Contains '<mjml': ${cleaned.toLowerCase().includes('<mjml')}`);
  logger.err(`Contains '</mjml>': ${cleaned.toLowerCase().includes('</mjml>')}`);
  
  throw new Error('No valid MJML code found in response. The response must contain <mjml>...</mjml> tags.');
}

/**
 * Validate MJML code using mjml2html
 */
function validateMJML(mjmlCode: string): { isValid: boolean; error?: string; html?: string } {
  try {
    // Check basic structure
    if (!mjmlCode.includes('<mjml') || !mjmlCode.includes('</mjml>')) {
      return {
        isValid: false,
        error: 'Missing <mjml> opening or closing tag. MJML code must be wrapped in <mjml>...</mjml>',
      };
    }

    if (!mjmlCode.includes('<mj-body') || !mjmlCode.includes('</mj-body>')) {
      return {
        isValid: false,
        error: 'Missing <mj-body> tag. All MJML templates must have a <mj-body> section inside <mjml>.',
      };
    }

    // Validate with MJML library
    const result = mjml2html(mjmlCode, {
      validationLevel: 'strict',
      minify: false,
    });

    // Check for errors
    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors
        .map((err: any) => `Line ${err.line}: ${err.message} (in <${err.tagName}>)`)
        .join('\n');
      
      return {
        isValid: false,
        error: `MJML validation errors:\n${errorMessages}`,
      };
    }

    // Success
    return {
      isValid: true,
      html: result.html,
    };
  } catch (error: any) {
    return {
      isValid: false,
      error: `MJML parsing error: ${error.message}`,
    };
  }
}

/**
 * Generate fallback template when all retries fail
 */
function getFallbackTemplate(originalPrompt: string, lastError: string, attemptsUsed: number): string {
  const sanitizedPrompt = originalPrompt.substring(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sanitizedError = lastError.substring(0, 400).replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<mjml>
  <mj-head>
    <mj-title>Template Generation Failed</mj-title>
    <mj-preview>Unable to generate custom template after ${attemptsUsed} attempts</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text padding="10px 25px" />
    </mj-attributes>
    <mj-style>
      .error-box {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
        padding: 15px;
        margin: 20px 0;
      }
      .code-box {
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 12px;
        font-family: monospace;
        font-size: 12px;
        overflow-wrap: break-word;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f8f9fa">
    <!-- Header -->
    <mj-section background-color="#dc3545" padding="30px 20px">
      <mj-column>
        <mj-text font-size="32px" font-weight="bold" color="#ffffff" align="center">
          ⚠️ Generation Error
        </mj-text>
        <mj-text font-size="16px" color="#ffffff" align="center" padding-top="10px">
          After ${attemptsUsed} attempts, we couldn't create your template
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- Error Details -->
    <mj-section background-color="#ffffff" padding="40px 25px">
      <mj-column>
        <mj-text font-size="20px" font-weight="bold" color="#333333">
          What Happened?
        </mj-text>
        
        <mj-text font-size="16px" color="#666666" line-height="1.6" padding-top="15px">
          Our AI attempted to generate your template ${attemptsUsed} times with automatic error correction,
          but encountered persistent validation issues. Don't worry - this is rare and usually happens
          with very complex or unusual design requests.
        </mj-text>

        <mj-divider border-color="#e9ecef" padding="30px 0" />

        <mj-text font-size="16px" font-weight="bold" color="#495057" padding-bottom="10px">
          📝 Your Request:
        </mj-text>
        <mj-text font-size="14px" color="#6c757d" css-class="error-box">
          ${sanitizedPrompt}
        </mj-text>

        <mj-text font-size="16px" font-weight="bold" color="#495057" padding-top="25px" padding-bottom="10px">
          ❌ Final Error (Attempt ${attemptsUsed}):
        </mj-text>
        <mj-text font-size="13px" color="#dc3545" css-class="code-box">
          ${sanitizedError}
        </mj-text>

        <mj-divider border-color="#e9ecef" padding="30px 0" />

        <mj-text font-size="18px" font-weight="bold" color="#333333" padding-bottom="20px">
          💡 What You Can Do:
        </mj-text>
        
        <mj-text font-size="15px" color="#666666" line-height="2">
          <strong>1. Simplify Your Request</strong><br/>
          Try breaking your design into smaller, simpler parts. Instead of "complex newsletter with multiple sections," try "simple newsletter header."
        </mj-text>
        
        <mj-text font-size="15px" color="#666666" line-height="2" padding-top="15px">
          <strong>2. Be More Specific</strong><br/>
          Provide clearer instructions. For example: "Create a welcome email with a blue header, white body, and a green button."
        </mj-text>
        
        <mj-text font-size="15px" color="#666666" line-height="2" padding-top="15px">
          <strong>3. Try Different Wording</strong><br/>
          Sometimes rephrasing your request can help the AI understand better.
        </mj-text>
        
        <mj-text font-size="15px" color="#666666" line-height="2" padding-top="15px">
          <strong>4. Use the Manual Builder</strong><br/>
          If AI generation keeps failing, try our drag-and-drop template builder instead.
        </mj-text>

        <mj-button background-color="#007bff" href="#" padding-top="30px" border-radius="8px">
          🔄 Try Again with Simpler Prompt
        </mj-button>
        
        <mj-button background-color="#6c757d" href="#" padding-top="15px" border-radius="8px">
          📞 Contact Support
        </mj-button>
      </mj-column>
    </mj-section>

    <!-- Footer -->
    <mj-section background-color="#f8f9fa" padding="30px 20px">
      <mj-column>
        <mj-text font-size="12px" color="#999999" align="center" line-height="1.6">
          This is an automated fallback template generated after ${attemptsUsed} failed attempts.<br/>
          Email Template Generator © ${new Date().getFullYear()}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/**
 * Generate email template using Claude with retry logic and error feedback
 */
export async function generateTemplate(
  request: GenerationRequest
): Promise<GenerationResponse> {
  try {
    const { prompt, conversationHistory = [], userId, images } = request;

    logger.info(`🎨 Generating template for user ${userId}`);
    logger.info(`📝 Prompt length: ${prompt?.length}`);
    logger.info(`🖼️ Images provided: ${images?.length || 0}`);
    logger.info(`⏱️ Using timeout: ${API_TIMEOUT}ms`);
    logger.info(`🔄 Max MJML validation retries: ${MAX_GENERATION_RETRIES}`);

    if (images && images.length > 0) {
      logger.info(`📊 Image details: ${JSON.stringify(images.map(img => ({
        fileName: img.fileName,
        mediaType: img.mediaType,
        dataLength: img.data.length
        })))}`);
    }

    let lastError: string = '';
    let lastMjmlCode: string = '';

    // ⭐ BUILD MESSAGES WITH IMAGE SUPPORT
    const messages: Anthropic.MessageParam[] = [];

    logger.info(`📋 Building conversation history (${conversationHistory.length} messages)...`);
    
    // ⭐ Add conversation history with PROMPT CACHING
    // Cache the last message in history to get 90% discount on tokens when reused
    for (let i = 0; i < conversationHistory.length; i++) {
      const msg = conversationHistory[i];
      const isLastHistoryMessage = (i === conversationHistory.length - 1);
      
      if (msg.images && msg.images.length > 0) {
        logger.info(`💬 History message with ${msg.images.length} images`);
        const content: Anthropic.MessageParam['content'] = [
          ...msg.images.map(img => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: img.data,
            },
          })),
          {
            type: 'text' as const,
            text: msg.content,
            // 🔥 Cache the last text block in history for 5min (90% discount on reuse)
            ...(isLastHistoryMessage ? { cache_control: { type: 'ephemeral' as const } } : {})
          },
        ];
        messages.push({ role: msg.role, content });
      } else {
        // For text-only messages, use array format to support cache_control
        if (isLastHistoryMessage) {
          // 🔥 Cache the last message in history for 5min (90% discount on reuse)
          messages.push({ 
            role: msg.role, 
            content: [
              {
                type: 'text' as const,
                text: msg.content,
                cache_control: { type: 'ephemeral' as const }
              }
            ]
          });
        } else {
          // Regular messages without caching
          messages.push({ 
            role: msg.role, 
            content: msg.content
          });
        }
      }
    }

    // Add current user message with images
    if (images && images.length > 0) {
      logger.info(`📤 Adding current message with ${images.length} images`);
      const content: Anthropic.MessageParam['content'] = [
        ...images.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: img.data,
          },
        })),
        {
          type: 'text' as const,
          text: prompt,
        },
      ];
      messages.push({ role: 'user', content });
    } else {
      logger.info(`📤 Adding current message (text only)`);
      messages.push({ role: 'user', content: prompt });
    }

    logger.info(`✅ Messages built: ${messages.length} total messages`);
    logger.info(`🔥 Prompt caching: System prompt + last history message cached (90% discount on reuse)`);

    // ⭐ RETRY LOOP FOR MJML GENERATION AND VALIDATION
    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
      try {
        logger.info(`🔄 Generation attempt ${attempt}/${MAX_GENERATION_RETRIES}`);
        
        const startTime = Date.now();

        // ⭐ CALL CLAUDE API WITH PROMPT CACHING
        logger.info(`📡 Calling Anthropic API with prompt caching...`);
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: getSystemPrompt(),
              cache_control: { type: "ephemeral" } // 🔥 Cache system prompt for 5 min (90% discount on reuse)
            }
          ],
          messages: messages,
        });

        const duration = Date.now() - startTime;
        logger.info(`✅ API call completed in ${duration}ms`);
        logger.info(`📊 Response ID: ${response.id}`);
        logger.info(`📊 Stop reason: ${response.stop_reason}`);
        logger.info(`📊 Usage - Input: ${response.usage.input_tokens}, Output: ${response.usage.output_tokens}`);
        
        // 🔥 Log cache performance (if available)
        if ((response.usage as any).cache_creation_input_tokens) {
          logger.info(`🔥 Cache created: ${(response.usage as any).cache_creation_input_tokens} tokens`);
        }
        if ((response.usage as any).cache_read_input_tokens) {
          logger.info(`🔥 Cache hit: ${(response.usage as any).cache_read_input_tokens} tokens (90% discount!)`);
        };

        // Extract text content
        const assistantMessage =
        response.content[0].type === 'text' ? response.content[0].text : '';

        // ⭐ CHECK IF RESPONSE WAS TRUNCATED
        if (response.stop_reason === 'max_tokens') {
          logger.warn(`⚠️ Response was truncated (hit max_tokens limit)`);
          throw new Error('Response was truncated. The template is too complex. Please try a simpler description.');
        }

        // ⭐ DEBUG: Log the raw response
        logger.info(`📝 Raw Claude response (first 500 chars):`);
        logger.info(assistantMessage.substring(0, 500));
        logger.info(`📝 Response length: ${assistantMessage.length} chars`);
        logger.info(`📝 Contains <mjml>: ${assistantMessage.includes('<mjml>')}`);
        logger.info(`📝 Contains </mjml>: ${assistantMessage.includes('</mjml>')}`);

        // Add assistant response to conversation history
        messages.push({ role: 'assistant', content: assistantMessage });
        logger.info(`💬 Assistant response added to conversation`);

        // Extract MJML code
        logger.info(`🔍 Extracting MJML code...`);
        const mjmlCode = extractMJMLCode(assistantMessage);
        lastMjmlCode = mjmlCode;

        logger.info(`✅ Extracted MJML code (${mjmlCode.length} chars)`);

        // ⭐ VALIDATE MJML
        logger.info(`🔍 Validating MJML...`);
        const validationResult = validateMJML(mjmlCode);

        if (validationResult.isValid) {
          logger.info(`✅ Template generated and validated successfully on attempt ${attempt}`);
          logger.info(`📊 Final stats - Attempts: ${attempt}, Had errors: ${attempt > 1}`);
          
          // Create user-friendly message (no technical details about attempts/retries)
          const userMessage = `✅ Template generated successfully! I've created a responsive email template based on your requirements.`;
          
          return {
            mjmlCode,
            assistantMessage: userMessage,
            conversationId: response.id,
            attemptsUsed: attempt,
            hadErrors: attempt > 1,
          };
        } else {
          // ⭐ VALIDATION FAILED - PREPARE ERROR FEEDBACK
          lastError = validationResult.error || 'Unknown validation error';
          logger.warn(`⚠️ Attempt ${attempt} failed validation: ${lastError.substring(0, 200)}`);

          if (attempt < MAX_GENERATION_RETRIES) {
            // Send error feedback to Claude for next attempt
            const errorPrompt = getErrorFeedbackPrompt(lastError, mjmlCode, attempt);
            messages.push({ role: 'user', content: errorPrompt });
            
            logger.info(`🔧 Sending error feedback to Claude for retry...`);
          }
        }
      } catch (apiError: any) {
        const duration = Date.now() - Date.now();
        
        // ⭐ HANDLE TIMEOUT ERRORS
        if (apiError.name === 'APIConnectionTimeoutError' || apiError.message?.includes('timeout')) {
          logger.err(`⏱️ API timeout after ${duration}ms (limit: ${API_TIMEOUT}ms)`);
          throw new Error(`Request timed out after ${API_TIMEOUT / 1000} seconds. The AI is taking too long to respond. Please try a simpler prompt.`);
        }
        
        // ⭐ HANDLE OVERLOAD ERRORS (with retry only for overload)
        if (apiError.status === 529 || apiError.message?.includes('overload') || apiError.message?.includes('Overloaded')) {
          const delay = 2000 * attempt; // Exponential backoff
          
          if (attempt < 3) { // Only retry overload errors 3 times
            logger.warn(`⚠️ API overloaded (attempt ${attempt}/3 for overload), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry the same attempt
          } else {
            logger.err(`❌ API still overloaded after 3 attempts`);
            throw new Error('Claude API is currently overloaded. Please try again in a few moments.');
          }
        }
        
        // ⭐ HANDLE EXTRACTION ERRORS (add to feedback loop)
        if (apiError.message?.includes('No valid MJML')) {
          lastError = apiError.message;
          logger.warn(`⚠️ Attempt ${attempt} - MJML extraction failed: ${lastError}`);
          
          if (attempt < MAX_GENERATION_RETRIES) {
            const errorPrompt = getErrorFeedbackPrompt(lastError, lastMjmlCode, attempt);
            messages.push({ role: 'user', content: errorPrompt });
            continue; // Retry
          }
        }
        
        // ⭐ FOR OTHER API ERRORS, THROW IMMEDIATELY
        logger.err(`❌ API error on attempt ${attempt}:`, apiError.message);
        logger.err(`Error details:`, apiError);
        throw apiError;
      }
    }

    // ⭐ ALL RETRIES EXHAUSTED - RETURN FALLBACK
    logger.err(`🚨 All ${MAX_GENERATION_RETRIES} attempts failed. Returning fallback template.`);
    logger.err(`Last error: ${lastError}`);
    
    const fallbackMjml = getFallbackTemplate(prompt, lastError, MAX_GENERATION_RETRIES);
    
    return {
      mjmlCode: fallbackMjml,
      assistantMessage: `Failed to generate template after ${MAX_GENERATION_RETRIES} attempts. Fallback template provided.`,
      conversationId: 'fallback',
      attemptsUsed: MAX_GENERATION_RETRIES,
      hadErrors: true,
    };
    
  } catch (error: any) {
    logger.err('❌ Template generation error:', error);
    logger.err('Error stack:', error.stack);
    
    // ⭐ USER-FRIENDLY ERROR MESSAGES
    if (error.message?.includes('timeout')) {
      throw new Error('Request timed out. Please try again with a simpler prompt.');
    }
    
    if (error.message?.includes('overloaded')) {
      throw error;
    }
    
    if (error.message?.includes('API key')) {
      throw new Error('API configuration error. Please contact support.');
    }
    
    throw new Error(error.message || 'Failed to generate template');
  }
}

/**
 * Refine existing template based on user feedback
 */
export async function refineTemplate(
  currentMjml: string,
  userFeedback: string,
  conversationHistory: Array<{ 
    role: 'user' | 'assistant'; 
    content: string;
    images?: Array<{ data: string; mediaType: string; fileName: string }>;
  }>,
  userId: string,
  images?: Array<{ data: string; mediaType: string; fileName: string }>
): Promise<GenerationResponse> {
  try {
    logger.info(`🔧 Refining template for user ${userId}`);
    logger.info(`📝 User feedback length: ${userFeedback?.length}`);
    logger.info(`🖼️ Images provided: ${images?.length || 0}`);
    logger.info(`📋 Conversation history length: ${conversationHistory.length}`);
    logger.info(`📄 Current MJML length: ${currentMjml?.length || 0} (LATEST VERSION ONLY)`);

    if (images && images.length > 0) {
      logger.info(`📊 Image details: ${JSON.stringify(images.map(img => ({
        fileName: img.fileName,
        mediaType: img.mediaType,
        dataLength: img.data.length
        })))}`);
    }

    // ✅ IMPORTANT: We use ONLY the latest MJML (currentMjml parameter)
    // We do NOT extract old MJML from conversation history
    // This ensures we always refine the most recent version
    const refinementPrompt = `Current MJML template:
${currentMjml}

User feedback: ${userFeedback}

Please update the template based on the user's feedback. Remember to output ONLY the complete updated MJML code starting with <mjml> and ending with </mjml>. Do not use markdown code blocks.`;

    logger.info(`📤 Calling generateTemplate for refinement...`);
    
    return await generateTemplate({
      prompt: refinementPrompt,
      conversationHistory,
      userId,
      images: images || undefined,
    });
  } catch (error) {
    logger.err('❌ Template refinement error:', error);
    logger.err('Error details:', error);
    throw error;
  }
}