/**
 * Utilities for wrapping and moderately sanitizing prompts before sending to Ideogram.
 *
 * Purpose:
 * - Enforce a server-side marketing-only wrapper so clients cannot request disallowed content
 * - Provide a consistent, easy-to-read structure (A., B., C.) so the model understands intent
 * - Provide a small blacklist matcher to catch obvious disallowed content early
 */

const DISALLOWED_PATTERNS = [
  /\b(porn|pornography|nsfw|sex|rape)\b/i,
  /\b(illegal|terrorism|bomb|explosive)\b/i,
  /\b(child|minor)\b/i,
  /\b(drugs|cocaine|heroin|meth)\b/i
];

export function isPromptAllowed(prompt: string): { ok: boolean; reason?: string } {
  if (!prompt || !prompt.trim()) return { ok: false, reason: 'Prompt is empty' };
  const p = prompt.trim();
  for (const re of DISALLOWED_PATTERNS) {
    if (re.test(p)) return { ok: false, reason: 'Prompt contains disallowed content' };
  }
  // Add more checks here (length, profanity, PII regexes) as needed
  return { ok: true };
}

export function wrapMarketingPrompt(userPrompt: string, opts?: { aspect_ratio?: string; style_hint?: string; negative_hint?: string; num_images?: number; allow_text?: boolean; allow_brand_names?: boolean }): string {
  const p = (userPrompt || '').trim();

  // Human-readable structured wrapper using letters (A., B., C.) as requested
  // NOTE: We no longer force a hard "no text" constraint here — callers may include text/numbers
  // in the user prompt if they want them embedded in the generated image.
  const constraints = [
    // Allow caller to opt-in to brand names. By default we advise avoiding brand names/logos.
    opts?.allow_brand_names
      ? `A. CONSTRAINTS: Strictly produce marketing/promotional imagery. Brand names and product names may be used as requested.`
      : `A. CONSTRAINTS: Strictly produce marketing/promotional imagery. Do not include brand names or copyrighted logos.`,
    "B. PURPOSE: This image will be used as a promotional hero/banner. Keep composition clean, subject centered or following standard marketing layout.",
    `C. USER DESCRIPTION: ${p}`,
    // Explicit instruction: include only the exact on-image text requested and do not invent additional textual elements.
    `D. TEXT POLICY: If the user requests on-image text (headline, price, CTA), include EXACTLY that text only. Do NOT add any extra words, translations, captions, dialogue, speech bubbles, or labels in any language. Do not invent or translate content.`,
    // If the user prompt contains a short price or headline, reinforce rendering it verbatim as an overlay
    ...( /\$\s*\d+|\d+\s*\$/i.test(p) || /\b(price|sale|off|discount|\$)\b/i.test(p)
      ? [`H. ON-IMAGE DIRECTIVE: The user requested promotional text. Render the exact price/headline from the user prompt as a large, readable overlay (bold, high-contrast, sans-serif). The exact text to render is: "${p}".`]
      : []),
    `E. STYLE: ${(opts?.style_hint) || 'photorealistic, high-resolution, studio lighting, shallow depth of field, vibrant colors'}`,
    // Note: we intentionally do NOT ban on-image text or numbers here; clients may request embedded text.
    `F. NEGATIVE: ${(opts?.negative_hint) || 'logo, watermark, caption, signature, low-res, blurred, deformed, extra limbs, gibberish text, untranslated foreign text'}`,
    `G. OUTPUT: Provide ${opts?.num_images || 1} image(s) suitable for hero marketing; avoid people with identifiable faces if privacy-risk is a concern.`
  ];

  // Join with two newlines to keep it readable for reviewers / debugging
  return constraints.join('\n\n');
}

/**
 * Wrap a remix/edit prompt to maintain the original image context
 * This ensures the AI preserves the original composition, layout, and elements
 * while only making the specific changes requested by the user.
 */
export function wrapRemixPrompt(userPrompt: string, opts?: { aspect_ratio?: string; style_hint?: string; negative_hint?: string; allow_brand_names?: boolean }): string {
  const p = (userPrompt || '').trim();

  const constraints = [
    `A. CONTEXT: You are editing an existing marketing image. The user wants to modify the current image while maintaining its core composition, layout, and visual identity.`,
    `B. PRESERVATION RULES: 
   - Keep the original layout, positioning, and spatial relationships between elements
   - Maintain the original color scheme unless the user specifically requests color changes
   - Preserve the original style, mood, and aesthetic unless explicitly asked to change
   - Keep all existing elements that are not mentioned in the user's request
   - Maintain the same aspect ratio and overall composition structure`,
    `C. USER REQUEST: ${p}`,
    `D. MODIFICATION SCOPE: Only make the specific changes requested by the user. Do not add new elements, remove existing elements, or change the composition unless explicitly requested.`,
    `E. STYLE CONSISTENCY: Maintain the same visual style, lighting, and quality as the original image. ${opts?.style_hint ? `Additional style guidance: ${opts.style_hint}` : ''}`,
    `F. NEGATIVE: ${(opts?.negative_hint) || 'do not change the composition, layout, or remove existing elements unless explicitly requested'}`,
    `G. OUTPUT: Return the edited image that looks like a natural continuation of the original, with only the requested modifications applied.`
  ];

  return constraints.join('\n\n');
}

// Optionally a helper to produce a short preview string (for showing sanitized prompt in UI)
export function previewWrappedPrompt(userPrompt: string): string {
  const p = (userPrompt || '').trim();
  return `Marketing prompt: ${p.slice(0, 240)}${p.length > 240 ? '…' : ''}`;
}

export default {
  isPromptAllowed,
  wrapMarketingPrompt,
  wrapRemixPrompt,
  previewWrappedPrompt
};
