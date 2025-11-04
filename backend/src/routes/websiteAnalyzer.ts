import express, { Request, Response } from 'express';
import { analyzeWebsite, validateUrl } from '../services/websiteAnalyzer';
import logger from 'jet-logger';
import OpenAI from 'openai';

const router = express.Router();

/**
 * POST /api/analyze-website
 * Analyze a website and extract brand DNA
 */
router.post('/analyze-website', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    logger.info(`📥 Received website analysis request for: ${url}`);

    // Validate URL
    const validation = validateUrl(url);
    if (!validation.valid) {
      logger.info(`❌ Invalid URL: ${validation.error}`);
      return res.status(400).json({ error: validation.error });
    }

    // Analyze website
    const brandDNA = await analyzeWebsite(validation.normalizedUrl!);

    logger.info(`✅ Website analysis successful for: ${url}`);
    res.json(brandDNA);

  } catch (error: any) {
    logger.info('❌ Website analysis error: ' + error.message);

    // Handle specific error types
    if (error.message?.startsWith('REQUIRES_AUTH:')) {
      return res.status(403).json({ error: 'This website requires authentication. Please provide a public URL.' });
    }
    if (error.message?.startsWith('BOT_DETECTED:')) {
      return res.status(403).json({ error: 'Website has bot protection. Unable to analyze.' });
    }
    if (error.message?.startsWith('EMPTY_PAGE:')) {
      return res.status(400).json({ error: 'Page has insufficient content to analyze.' });
    }
    if (error.message?.startsWith('DOMAIN_NOT_FOUND:')) {
      return res.status(404).json({ error: 'Domain not found or cannot be resolved.' });
    }
    if (error.message?.startsWith('CONNECTION_REFUSED:')) {
      return res.status(503).json({ error: 'Website is unreachable. Please check the URL.' });
    }
    if (error.message?.startsWith('TIMEOUT:')) {
      return res.status(504).json({ error: 'Website took too long to respond. Please try again.' });
    }
    if (error.message?.startsWith('FORBIDDEN:')) {
      return res.status(403).json({ error: 'Access to website is forbidden.' });
    }
    if (error.message?.startsWith('NOT_FOUND:')) {
      return res.status(404).json({ error: 'Page not found (404).' });
    }
    if (error.message?.startsWith('NETWORK_ERROR:')) {
      return res.status(503).json({ error: 'Network error occurred. Please try again.' });
    }

    // Generic error
    res.status(500).json({ error: 'Failed to analyze website. Please try again later.' });
  }
});

/**
 * POST /api/brand-dna-to-prompt
 * Generate a prompt from brand DNA selections
 */
router.post('/brand-dna-to-prompt', async (req: Request, res: Response) => {
  try {
    const { colors, images, content, fonts, templateStyle, url } = req.body;

    logger.info(`📥 Received brand DNA to prompt request`, {
      colorsCount: colors?.length || 0,
      imagesCount: images?.length || 0,
      contentCount: content?.length || 0,
      templateStyle,
      url
    });

    // Build structured prompt data
    const promptData = {
      url,
      colors: colors || [],
      images: images || [],
      content: content || [],
      contentSections: req.body.contentSections || [],
      ctas: req.body.ctas || [],
      fonts: fonts || {},
      templateStyle: templateStyle || 'modern',
      logo: req.body.logo,
      products: req.body.products || [],
      brandInfo: req.body.brandInfo || {},
      testimonials: req.body.testimonials || [],
      contact: req.body.contact || {},
      social: req.body.social || {}
    };

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Generate prompt using GPT
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert email template prompt generator. Your task is to create detailed, well-structured prompts for email template generation based on brand DNA extracted from websites.

CRITICAL REQUIREMENTS:
1. Use the exact colors provided (in hex format)
2. Reference the image URLs when describing visual elements
3. Incorporate the brand voice from content snippets
4. Apply the selected template style characteristics
5. Include font preferences when available
6. Create a clear, actionable prompt for AI template generation

TEMPLATE STYLES:
- Modern & Minimal: Clean, spacious, simple layouts with lots of white space
- Bold & Vibrant: High contrast, energetic, eye-catching colors
- Professional: Corporate, trustworthy, classic layouts
- Creative: Artistic, unique, unconventional layouts
- Mobile-First: Card-based, responsive, mobile-optimized
- E-commerce: Product-focused, shopping-friendly layouts

OUTPUT FORMAT:
- Start with template style and purpose
- Specify color palette (exact hex codes)
- Describe layout and structure
- Include image placement instructions with URLs
- Incorporate brand voice elements
- Add responsive design requirements
- End with any special styling notes

Generate ONLY the prompt - no meta-commentary.`
        },
        {
          role: 'user',
          content: `Generate an email template prompt based on this brand DNA:

WEBSITE: ${url}

COLORS (Selected):
${promptData.colors.length > 0 ? promptData.colors.map((c: string) => `- ${c}`).join('\n') : '- Use website colors'}

FONTS:
- Heading: ${promptData.fonts.heading || 'Use modern sans-serif'}
- Body: ${promptData.fonts.body || 'Use readable sans-serif'}

IMAGES (Selected - MUST use these exact URLs):
${promptData.images.length > 0 ? promptData.images.map((img: string, i: number) => `${i + 1}. ${img}`).join('\n') : 'No images selected'}

CONTENT SNIPPETS (Brand Voice):
${promptData.content.length > 0 ? promptData.content.map((c: string) => `- "${c}"`).join('\n') : 'Use professional tone'}

FULL CONTENT SECTIONS (Detailed Information):
${promptData.contentSections.length > 0 ? promptData.contentSections.map((section: any, i: number) => 
  `${i + 1}. ${section.heading ? section.heading + ' (' + section.context + ')' : section.context}
   Paragraphs:
   ${section.paragraphs.map((p: string) => `   - ${p}`).join('\n')}
   ${section.listItems && section.listItems.length > 0 ? `\n   List Items:\n   ${section.listItems.map((li: string) => `   • ${li}`).join('\n')}` : ''}`
).join('\n\n') : 'No detailed content sections extracted'}

TEMPLATE STYLE: ${promptData.templateStyle}

BRAND LOGO:
${promptData.logo ? `Logo URL: ${promptData.logo}` : 'No logo available'}

BRAND IDENTITY:
${promptData.brandInfo.tagline ? `Tagline: "${promptData.brandInfo.tagline}"` : ''}
${promptData.brandInfo.mission ? `Mission: "${promptData.brandInfo.mission}"` : ''}
${promptData.brandInfo.values && promptData.brandInfo.values.length > 0 ? `Values: ${promptData.brandInfo.values.join(', ')}` : ''}

PRODUCTS (if any):
${promptData.products.length > 0 ? promptData.products.map((p: any, i: number) => 
  `${i + 1}. ${p.name}${p.price ? ` - ${p.price}` : ''}
   ${p.description ? `   Description: ${p.description}` : ''}
   ${p.image ? `   Image: ${p.image}` : ''}`
).join('\n') : 'No products extracted'}

TESTIMONIALS:
${promptData.testimonials.length > 0 ? promptData.testimonials.map((t: any, i: number) => 
  `${i + 1}. "${t.text}"${t.author ? ` - ${t.author}` : ''}${t.company ? `, ${t.company}` : ''}`
).join('\n') : 'No testimonials'}

CONTACT INFORMATION:
${promptData.contact.email ? `Email: ${promptData.contact.email}` : ''}
${promptData.contact.phone ? `Phone: ${promptData.contact.phone}` : ''}
${promptData.contact.address ? `Address: ${promptData.contact.address}` : ''}

SOCIAL MEDIA LINKS:
${promptData.social.facebook ? `Facebook: ${promptData.social.facebook}` : ''}
${promptData.social.twitter ? `Twitter: ${promptData.social.twitter}` : ''}
${promptData.social.instagram ? `Instagram: ${promptData.social.instagram}` : ''}
${promptData.social.linkedin ? `LinkedIn: ${promptData.social.linkedin}` : ''}
${promptData.social.youtube ? `YouTube: ${promptData.social.youtube}` : ''}
${promptData.social.tiktok ? `TikTok: ${promptData.social.tiktok}` : ''}

CALL-TO-ACTIONS (Selected - MUST use these exact links):
${promptData.ctas.length > 0 ? promptData.ctas.map((cta: any, i: number) => 
  `${i + 1}. "${cta.text}" → ${cta.url}`
).join('\n') : 'No CTAs selected'}

Requirements:
1. Create a ${promptData.templateStyle} style email template
2. Use the EXACT color hex codes specified above
3. **CRITICAL**: Include the logo at the top using: <mj-image src="${promptData.logo || 'LOGO_URL'}" alt="Logo" width="150px" />
4. **CRITICAL**: Include <mj-image> tags with the EXACT image URLs from the IMAGES section
5. Use the FULL CONTENT SECTIONS as the main body content - these are real paragraphs from the website
6. **CRITICAL**: Include CTA buttons using the EXACT text and links from CALL-TO-ACTIONS section above (e.g., <mj-button href="${promptData.ctas[0]?.url || 'CTA_URL'}">${promptData.ctas[0]?.text || 'CTA Text'}</mj-button>)
7. If products are provided, create a products showcase section with product images, names, prices, and descriptions
8. If testimonials are provided, include a testimonials section with customer quotes
9. Incorporate the brand tagline, mission, and values into the email header/intro
10. Include contact information in the footer (email, phone, address)
11. Add social media icons/links in the footer using the provided social links
12. Apply the specified fonts if provided
13. Make it fully mobile-responsive
14. Use the brand colors for all CTA buttons
15. Use authentic brand voice from content snippets and sections
16. Structure the email with: Header (logo) → Hero/Intro → Content Sections → CTAs → Products (if any) → Testimonials (if any) → Footer (contact + social)

Generate a complete, detailed prompt that will create a professional MJML email template incorporating ALL the brand DNA elements, especially the CTAs with their actual links, full content sections, and authentic messaging.`
        }
      ],
      max_tokens: 4000,
      temperature: 0.7,
    });

    const generatedPrompt = completion.choices[0]?.message?.content || '';

    logger.info(`✅ Prompt generated successfully`);
    res.json({
      success: true,
      prompt: generatedPrompt
    });

  } catch (error: any) {
    logger.info('❌ Brand DNA to prompt error: ' + error.message);
    res.status(500).json({ error: 'Failed to generate prompt. Please try again.' });
  }
});

export default router;

