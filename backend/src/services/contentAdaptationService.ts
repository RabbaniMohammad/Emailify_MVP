import OpenAI from 'openai';
import * as cheerio from 'cheerio';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Analysis result from email HTML
interface EmailAnalysis {
  summary: string;
  mainOffer: string;
  cta: string;
  urgency?: string;
  audience: string;
  brandTone: 'professional' | 'casual' | 'friendly' | 'urgent';
  keyPoints: string[];
}

// Adapted content for all channels
interface AdaptedContent {
  email: {
    html: string;
    subject: string;
  };
  sms: {
    text: string;
    characterCount: number;
    hasEmoji: boolean;
  };
  whatsapp: {
    text: string;
    lineCount: number;
    hasEmoji: boolean;
    suggestedMediaUrl?: string;
  };
  instagram: {
    text: string;
    lineCount: number;
    tone: 'casual' | 'friendly' | 'engaging';
    suggestedMediaUrl?: string;
  };
  analysis: EmailAnalysis;
}

/**
 * Extract plain text and key information from HTML email
 */
function analyzeEmailHTML(html: string, subject: string): Partial<EmailAnalysis> {
  const $ = cheerio.load(html);
  
  // Remove script, style tags
  $('script, style').remove();
  
  // Extract text content
  const text = $('body').text().trim().replace(/\s+/g, ' ').substring(0, 2000);
  
  // Try to find CTAs
  const ctaButtons = $('a, button')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(t => t.length > 0 && t.length < 50);
  
  const cta = ctaButtons.length > 0 ? ctaButtons[0] : 'Learn more';
  
  // Try to detect urgency
  const urgencyKeywords = ['today', 'now', 'limited', 'hurry', 'ends', 'expires', 'last chance'];
  const hasUrgency = urgencyKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
  
  return {
    summary: text.substring(0, 500),
    cta,
    urgency: hasUrgency ? 'high' : 'medium',
  };
}

/**
 * Use AI to analyze email content and extract key information
 */
async function analyzeEmailWithAI(
  html: string, 
  subject: string
): Promise<EmailAnalysis> {
  
  const htmlAnalysis = analyzeEmailHTML(html, subject);
  
  const prompt = `Analyze this email campaign and extract key information:

Subject: ${subject}
Content: ${htmlAnalysis.summary}

Provide a JSON response with:
1. "summary" - One sentence summary of the email (max 100 chars)
2. "mainOffer" - The main offer/promotion (max 50 chars)
3. "cta" - The call-to-action (max 30 chars)
4. "urgency" - Time-sensitive element if any (max 30 chars, or empty string)
5. "audience" - Target audience type (e.g., "customers", "subscribers", "shoppers")
6. "brandTone" - One of: "professional", "casual", "friendly", "urgent"
7. "keyPoints" - Array of 3-4 key selling points (each max 40 chars)

Response must be valid JSON only, no markdown.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert marketing analyst. Respond only with valid JSON, no markdown formatting.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content?.trim() || '{}';
    
    // Remove markdown code blocks if present
    const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const analysis = JSON.parse(jsonContent);
    
    return {
      summary: analysis.summary || htmlAnalysis.summary?.substring(0, 100) || '',
      mainOffer: analysis.mainOffer || 'Special offer',
      cta: analysis.cta || htmlAnalysis.cta || 'Shop now',
      urgency: analysis.urgency || htmlAnalysis.urgency,
      audience: analysis.audience || 'customers',
      brandTone: analysis.brandTone || 'friendly',
      keyPoints: analysis.keyPoints || [],
    };
  } catch (error) {
    console.error('AI analysis failed, using fallback:', error);
    
    // Fallback to basic analysis
    return {
      summary: htmlAnalysis.summary?.substring(0, 100) || 'Check out our latest offer',
      mainOffer: 'Special promotion',
      cta: htmlAnalysis.cta || 'Learn more',
      urgency: htmlAnalysis.urgency,
      audience: 'customers',
      brandTone: 'friendly',
      keyPoints: ['Great value', 'Limited time', 'Shop now'],
    };
  }
}

/**
 * Generate SMS version (max 160 characters)
 */
async function generateSMS(analysis: EmailAnalysis): Promise<string> {
  const prompt = `Convert this email campaign to SMS (STRICT 160 character limit):

Main Offer: ${analysis.mainOffer}
Key Points: ${analysis.keyPoints.join(', ')}
CTA: ${analysis.cta}
Urgency: ${analysis.urgency || 'none'}

CRITICAL RULES:
- MAXIMUM 160 characters total (including spaces and emojis)
- Include 1-2 relevant emojis
- Include shortened URL placeholder: "bit.ly/offer"
- Urgent, action-oriented tone
- Clear call-to-action
- Format: [Emoji] [Hook] [Offer] [CTA] [Link] [Urgency emoji]

Example (145 chars):
"🎉 BLACK FRIDAY! 50% OFF everything. Use code: BF50. Shop now: bit.ly/bf-deals Ends tonight! ⏰"

Generate SMS (max 160 chars):`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert SMS marketer. Create ultra-concise, compelling SMS messages. NEVER exceed 160 characters.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    let sms = response.choices[0].message.content?.trim() || '';
    
    // Remove quotes if AI wrapped the response
    sms = sms.replace(/^["']|["']$/g, '');
    
    // Ensure it's under 160 characters
    if (sms.length > 160) {
      sms = sms.substring(0, 157) + '...';
    }
    
    return sms;
  } catch (error) {
    console.error('SMS generation failed:', error);
    
    // Fallback SMS
    return `${analysis.mainOffer}! ${analysis.cta}: bit.ly/offer`;
  }
}

/**
 * Generate WhatsApp version (6-7 lines, conversational)
 */
async function generateWhatsApp(analysis: EmailAnalysis): Promise<string> {
  const prompt = `Convert this email campaign to WhatsApp message (6-7 lines):

Main Offer: ${analysis.mainOffer}
Key Points: ${analysis.keyPoints.join(', ')}
CTA: ${analysis.cta}
Brand Tone: ${analysis.brandTone}

RULES:
- Exactly 6-7 short lines (max 300 characters total)
- Conversational, ${analysis.brandTone} tone
- Use 2-4 emojis (strategic, not excessive)
- Personal greeting: "Hey there! 👋" or similar
- 3 bullet points with emojis for key benefits
- Clear CTA with link placeholder
- End with: "Reply STOP to unsubscribe"

Format:
Line 1: Greeting + Hook
Lines 2-4: Value props (3 bullets with emojis)
Line 5: CTA with link
Line 6: Opt-out

Example:
Hey there! 👋

Our biggest sale is LIVE! 🎉

✨ 50% off everything
🎁 Free gift with purchase
🚚 Free shipping over $50

Shop now: [link]

Reply STOP to unsubscribe

Generate WhatsApp message:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert WhatsApp marketer. Create friendly, conversational messages with emojis.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    let whatsapp = response.choices[0].message.content?.trim() || '';
    
    // Ensure it ends with opt-out
    if (!whatsapp.toLowerCase().includes('stop')) {
      whatsapp += '\n\nReply STOP to unsubscribe';
    }
    
    return whatsapp;
  } catch (error) {
    console.error('WhatsApp generation failed:', error);
    
    // Fallback WhatsApp
    return `Hey there! 👋\n\n${analysis.mainOffer} is here!\n\n${analysis.keyPoints.map(p => `✨ ${p}`).join('\n')}\n\n${analysis.cta}: [link]\n\nReply STOP to unsubscribe`;
  }
}

/**
 * Generate Instagram DM version (5-6 lines, casual and engaging)
 */
async function generateInstagram(analysis: EmailAnalysis): Promise<string> {
  const prompt = `Convert this email campaign to Instagram DM (5-6 lines):

Main Offer: ${analysis.mainOffer}
Key Points: ${analysis.keyPoints.join(', ')}
CTA: ${analysis.cta}

RULES:
- 5-6 short, punchy lines
- Very casual, Gen-Z friendly, conversational tone
- Use 1-3 emojis per line (playful, not corporate)
- Start with personal greeting
- Include engagement question
- Reference visual content: "[Image attached]" or "[Check your DMs]"
- NO opt-out text (Instagram DMs are opt-in by nature)

Format:
Line 1: Super casual greeting
Line 2: Reference their interest
Line 3: Tease the offer (excited tone)
Line 4: Engagement question
Line 5: CTA
Line 6: Note about attachment

Example:
Heyyy! 💛

Remember those summer vibes? ☀️

We just dropped 70% OFF our entire collection! 😱

Want first dibs before it sells out? 🏃‍♀️

Tap the link in our bio 🔗

[Product carousel attached]

Generate Instagram DM:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert Instagram marketer. Create fun, casual, engaging DMs with personality and emojis.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.9,
      max_tokens: 200,
    });

    let instagram = response.choices[0].message.content?.trim() || '';
    
    // Ensure it mentions visual content
    if (!instagram.toLowerCase().includes('attach') && !instagram.toLowerCase().includes('image')) {
      instagram += '\n\n[Image attached]';
    }
    
    return instagram;
  } catch (error) {
    console.error('Instagram generation failed:', error);
    
    // Fallback Instagram
    return `Heyyy! 💜\n\n${analysis.mainOffer} just dropped!\n\nWant to see? 👀\n\n${analysis.cta} (link in bio)\n\n[Image attached]`;
  }
}

/**
 * Main function: Adapt email content to all channels
 */
export async function adaptEmailToAllChannels(
  emailHtml: string,
  emailSubject: string
): Promise<AdaptedContent> {
  
  console.log('🤖 Starting AI content adaptation...');
  
  // Step 1: Analyze email
  const analysis = await analyzeEmailWithAI(emailHtml, emailSubject);
  console.log('✅ Email analyzed:', analysis);
  
  // Step 2: Generate all channel versions in parallel
  const [smsText, whatsappText, instagramText] = await Promise.all([
    generateSMS(analysis),
    generateWhatsApp(analysis),
    generateInstagram(analysis),
  ]);
  
  console.log('✅ All channel content generated');
  
  // Step 3: Count lines and characters
  const smsCharCount = smsText.length;
  const whatsappLineCount = whatsappText.split('\n').length;
  const instagramLineCount = instagramText.split('\n').length;
  
  return {
    email: {
      html: emailHtml,
      subject: emailSubject,
    },
    sms: {
      text: smsText,
      characterCount: smsCharCount,
      hasEmoji: /[\u{1F300}-\u{1F9FF}]/u.test(smsText),
    },
    whatsapp: {
      text: whatsappText,
      lineCount: whatsappLineCount,
      hasEmoji: /[\u{1F300}-\u{1F9FF}]/u.test(whatsappText),
    },
    instagram: {
      text: instagramText,
      lineCount: instagramLineCount,
      tone: 'casual',
    },
    analysis,
  };
}

/**
 * Regenerate content for a specific channel with different tone
 */
export async function regenerateChannelContent(
  analysis: EmailAnalysis,
  channel: 'sms' | 'whatsapp' | 'instagram',
  tone?: 'professional' | 'casual' | 'urgent'
): Promise<string> {
  
  // Override tone if specified
  const modifiedAnalysis = tone ? { ...analysis, brandTone: tone } : analysis;
  
  switch (channel) {
    case 'sms':
      return generateSMS(modifiedAnalysis);
    case 'whatsapp':
      return generateWhatsApp(modifiedAnalysis);
    case 'instagram':
      return generateInstagram(modifiedAnalysis);
    default:
      throw new Error(`Unknown channel: ${channel}`);
  }
}

/**
 * Validate content for channel-specific requirements
 */
export function validateChannelContent(
  channel: 'sms' | 'whatsapp' | 'instagram',
  content: string
): { valid: boolean; errors: string[] } {
  
  const errors: string[] = [];
  
  switch (channel) {
    case 'sms':
      if (content.length > 160) {
        errors.push(`SMS too long: ${content.length}/160 characters`);
      }
      if (content.length === 0) {
        errors.push('SMS content is empty');
      }
      break;
      
    case 'whatsapp':
      if (content.length > 1024) {
        errors.push(`WhatsApp message too long: ${content.length}/1024 characters`);
      }
      const lines = content.split('\n').length;
      if (lines > 15) {
        errors.push(`Too many lines: ${lines} (recommended: 6-10)`);
      }
      break;
      
    case 'instagram':
      if (content.length > 1000) {
        errors.push(`Instagram DM too long: ${content.length}/1000 characters`);
      }
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
