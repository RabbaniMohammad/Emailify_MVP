// @ts-ignore - MJML types are not perfect, suppress type checking
import mjml2html from 'mjml';
import logger from 'jet-logger';

interface ConversionResult {
  html: string;
  errors: Array<{
    line: number;
    message: string;
    tagName: string;
  }>;
}

/**
 * Convert MJML to HTML
 */
export function convertMjmlToHtml(mjmlCode: string): ConversionResult {
  try {
    logger.info('🔄 Converting MJML to HTML...');

    // Validate input
    if (!mjmlCode || !mjmlCode.trim()) {
      throw new Error('Empty MJML code provided');
    }

    // Convert MJML to HTML
    const result = mjml2html(mjmlCode, {
      validationLevel: 'soft',
      beautify: true,
      minify: false,
      keepComments: false,
    });

    // Check for errors
    // @ts-ignore - MJML error handling
    if (result.errors && result.errors.length > 0) {
      // @ts-ignore
      logger.warn('⚠️ MJML conversion warnings:', result.errors);
      
      // Map errors to our format
      // @ts-ignore
      const errors = result.errors.map((err) => ({
        line: err.line || 0,
        message: err.message || 'Unknown error',
        tagName: err.tagName || 'unknown',
      }));

      return {
        html: result.html,
        errors,
      };
    }

    logger.info('✅ MJML converted successfully');

    return {
      html: result.html,
      errors: [],
    };
  } catch (error: any) {
    logger.err('❌ MJML conversion error:', error);
    
    return {
      html: '',
      errors: [
        {
          line: 0,
          message: error.message || 'Failed to convert MJML',
          tagName: 'mjml',
        },
      ],
    };
  }
}

/**
 * Validate MJML syntax without converting
 */
export function validateMjml(mjmlCode: string): {
  valid: boolean;
  errors: Array<{
    line: number;
    message: string;
    tagName: string;
  }>;
} {
  try {
    if (!mjmlCode || !mjmlCode.trim()) {
      return {
        valid: false,
        errors: [
          {
            line: 0,
            message: 'Empty MJML code',
            tagName: 'mjml',
          },
        ],
      };
    }

    const result = mjml2html(mjmlCode, {
      validationLevel: 'strict',
    });

    // @ts-ignore - MJML error handling
    const errors = (result.errors || []).map((err) => ({
      line: err.line || 0,
      message: err.message || 'Unknown error',
      tagName: err.tagName || 'unknown',
    }));

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error: any) {
    return {
      valid: false,
      errors: [
        {
          line: 0,
          message: error.message || 'Invalid MJML syntax',
          tagName: 'mjml',
        },
      ],
    };
  }
}

/**
 * Sanitize and format MJML code
 */
export function sanitizeMjml(mjmlCode: string): string {
  try {
    let sanitized = mjmlCode.trim();

    if (!sanitized.startsWith('<mjml')) {
      sanitized = `<mjml>\n${sanitized}\n</mjml>`;
    }

    if (!sanitized.includes('</mjml>')) {
      sanitized = `${sanitized}\n</mjml>`;
    }

    return sanitized;
  } catch (error) {
    logger.err('❌ MJML sanitization error:', error);
    return mjmlCode;
  }
}

/**
 * Extract preview text from MJML
 */
export function extractPreviewText(mjmlCode: string): string {
  try {
    const previewMatch = mjmlCode.match(/<mj-preview>(.*?)<\/mj-preview>/s);
    if (previewMatch && previewMatch[1]) {
      return previewMatch[1].trim();
    }
    return '';
  } catch (error) {
    logger.err('❌ Preview text extraction error:', error);
    return '';
  }
}

/**
 * Get MJML template starter
 */
export function getMjmlStarter(): string {
  return `<mjml>
  <mj-head>
    <mj-title>New Email Template</mj-title>
    <mj-preview>Preview text appears here</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="20px" color="#333333" />
      <mj-button background-color="#667eea" color="#ffffff" border-radius="4px" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="20px" font-weight="bold">
          Welcome!
        </mj-text>
        <mj-text>
          Start customizing your email template here.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}