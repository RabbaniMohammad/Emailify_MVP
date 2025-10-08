import Anthropic from '@anthropic-ai/sdk';
import logger from 'jet-logger';

// ⭐ ADD TIMEOUT CONFIGURATION
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT || '120000', 10); // 2 minutes default

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: API_TIMEOUT, // ⭐ APPLY TIMEOUT TO CLIENT
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = parseInt(process.env.GENERATION_MAX_TOKENS || '4096', 10);

interface GenerationRequest {
  prompt: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId: string;
}

interface GenerationResponse {
  mjmlCode: string;
  assistantMessage: string;
  conversationId: string;
}

/**
 * System prompt for MJML generation
 */
function getSystemPrompt(): string {
  return `You are an expert MJML email template generator. Your job is to create production-ready, responsive email templates using MJML.

CRITICAL RULES:
1. ALWAYS output valid MJML code wrapped in <mjml> tags
2. Start with <mjml><mj-head> for global styles, then <mj-body> for content
3. Use semantic MJML components: mj-section, mj-column, mj-text, mj-button, mj-image, mj-divider
4. Ensure mobile responsiveness (email clients are strict!)
5. Follow email best practices:
   - Max width: 600px
   - Web-safe fonts (Arial, Georgia, Times New Roman, Courier, Verdana)
   - Proper color contrast for accessibility
   - Alt text for all images
   - Inline styles (MJML handles this)
6. Include mj-preview for email preview text
7. Use mj-attributes in mj-head for global styling

MJML Structure Example:
\`\`\`mjml
<mjml>
  <mj-head>
    <mj-title>Email Title</mj-title>
    <mj-preview>Preview text here</mj-preview>
    <mj-attributes>
      <mj-text font-family="Arial, sans-serif" font-size="14px" line-height="20px" color="#333333" />
      <mj-all font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text>Content here</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
\`\`\`

When the user asks for a template:
1. Understand their requirements
2. Generate complete, valid MJML code
3. Provide a brief explanation of what you created
4. Output ONLY the MJML code in your response (explanation can be before or after the code block)

Remember: Email clients are unforgiving. Your MJML must be perfect!`;
}

/**
 * Extract MJML code from Claude's response
 */
function extractMJMLCode(text: string): string {
  // Try to find MJML code block first
  const mjmlMatch = text.match(/```mjml\n([\s\S]*?)\n```/);
  if (mjmlMatch) {
    return mjmlMatch[1].trim();
  }

  // Try to find any code block
  const codeMatch = text.match(/```\n([\s\S]*?)\n```/);
  if (codeMatch && codeMatch[1].includes('<mjml>')) {
    return codeMatch[1].trim();
  }

  // If no code blocks, check if entire response contains MJML
  if (text.includes('<mjml>') && text.includes('</mjml>')) {
    const mjmlStart = text.indexOf('<mjml>');
    const mjmlEnd = text.indexOf('</mjml>') + 7;
    return text.slice(mjmlStart, mjmlEnd).trim();
  }

  throw new Error('No valid MJML code found in Claude\'s response');
}

/**
 * Generate email template using Claude
 */
export async function generateTemplate(
  request: GenerationRequest
): Promise<GenerationResponse> {
  try {
    const { prompt, conversationHistory = [], userId } = request;

    logger.info(`🎨 Generating template for user ${userId}`);
    logger.info(`⏱️ Using timeout: ${API_TIMEOUT}ms`);

    // Build messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...conversationHistory,
      { role: 'user', content: prompt },
    ];

    const startTime = Date.now();
    
    // ⭐ RETRY LOGIC FOR OVERLOAD ERRORS
    let lastError: any;
    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔄 API attempt ${attempt}/${maxRetries}`);
        
        // Call Claude API (timeout is already set in client initialization)
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          system: getSystemPrompt(),
          messages: messages,
        });

        const duration = Date.now() - startTime;
        logger.info(`✅ API call completed in ${duration}ms on attempt ${attempt}`);

        // Extract text content
        const assistantMessage =
          response.content[0].type === 'text' ? response.content[0].text : '';

        // Extract MJML code
        const mjmlCode = extractMJMLCode(assistantMessage);

        logger.info(`✅ Template generated successfully (${mjmlCode.length} chars)`);

        return {
          mjmlCode,
          assistantMessage,
          conversationId: response.id,
        };
        
      } catch (apiError: any) {
        lastError = apiError;
        const duration = Date.now() - startTime;
        
        // ⭐ CHECK FOR TIMEOUT ERRORS
        if (apiError.name === 'APIConnectionTimeoutError' || apiError.message?.includes('timeout')) {
          logger.err(`⏱️ API timeout after ${duration}ms (limit: ${API_TIMEOUT}ms)`);
          throw new Error(`Request timed out after ${API_TIMEOUT / 1000} seconds. The AI is taking too long to respond. Please try a simpler prompt.`);
        }
        
        // ⭐ CHECK IF IT'S AN OVERLOAD ERROR
        if (apiError.status === 529 || apiError.message?.includes('overload') || apiError.message?.includes('Overloaded')) {
          const delay = baseDelay * attempt; // Exponential backoff
          
          if (attempt < maxRetries) {
            logger.warn(`⚠️ API overloaded (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          } else {
            logger.err(`❌ API still overloaded after ${maxRetries} attempts`);
            throw new Error('Claude API is currently overloaded. Please try again in a few moments.');
          }
        }
        
        // ⭐ FOR OTHER ERRORS, THROW IMMEDIATELY (no retry)
        logger.err(`❌ API error on attempt ${attempt}:`, apiError.message);
        throw apiError;
      }
    }
    
    // Should never reach here, but just in case
    throw lastError;
    
  } catch (error: any) {
    logger.err('❌ Template generation error:', error);
    
    // ⭐ USER-FRIENDLY ERROR MESSAGES
    if (error.message?.includes('timeout')) {
      throw new Error('Request timed out. Please try again with a simpler prompt.');
    }
    
    if (error.message?.includes('overloaded')) {
      throw error; // Pass through the overload message as-is
    }
    
    if (error.message?.includes('API key')) {
      throw new Error('API configuration error. Please contact support.');
    }
    
    if (error.message?.includes('MJML')) {
      throw error; // Pass through MJML extraction errors as-is
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
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  userId: string
): Promise<GenerationResponse> {
  try {
    logger.info(`🔧 Refining template for user ${userId}`);

    const refinementPrompt = `Current MJML template:
\`\`\`mjml
${currentMjml}
\`\`\`

User feedback: ${userFeedback}

Please update the template based on the user's feedback. Return the complete updated MJML code.`;

    return await generateTemplate({
      prompt: refinementPrompt,
      conversationHistory,
      userId,
    });
  } catch (error) {
    logger.err('❌ Template refinement error:', error);
    throw error;
  }
}