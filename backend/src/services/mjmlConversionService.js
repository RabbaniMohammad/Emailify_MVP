"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertMjmlToHtml = convertMjmlToHtml;
exports.validateMjml = validateMjml;
exports.sanitizeMjml = sanitizeMjml;
exports.extractPreviewText = extractPreviewText;
exports.getMjmlStarter = getMjmlStarter;
// @ts-ignore - MJML types are not perfect, suppress type checking
const mjml_1 = __importDefault(require("mjml"));
const jet_logger_1 = __importDefault(require("jet-logger"));
/**
 * Convert MJML to HTML
 */
function convertMjmlToHtml(mjmlCode) {
    try {
        jet_logger_1.default.info('🔄 Converting MJML to HTML...');
        // Validate input
        if (!mjmlCode || !mjmlCode.trim()) {
            throw new Error('Empty MJML code provided');
        }
        // Convert MJML to HTML
        const result = (0, mjml_1.default)(mjmlCode, {
            validationLevel: 'soft',
            beautify: true,
            minify: false,
            keepComments: false,
        });
        // Check for errors
        // @ts-ignore - MJML error handling
        if (result.errors && result.errors.length > 0) {
            // @ts-ignore
            jet_logger_1.default.warn('⚠️ MJML conversion warnings:', result.errors);
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
        jet_logger_1.default.info('✅ MJML converted successfully');
        return {
            html: result.html,
            errors: [],
        };
    }
    catch (error) {
        jet_logger_1.default.err('❌ MJML conversion error:', error);
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
function validateMjml(mjmlCode) {
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
        const result = (0, mjml_1.default)(mjmlCode, {
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
    }
    catch (error) {
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
function sanitizeMjml(mjmlCode) {
    try {
        let sanitized = mjmlCode.trim();
        if (!sanitized.startsWith('<mjml')) {
            sanitized = `<mjml>\n${sanitized}\n</mjml>`;
        }
        if (!sanitized.includes('</mjml>')) {
            sanitized = `${sanitized}\n</mjml>`;
        }
        return sanitized;
    }
    catch (error) {
        jet_logger_1.default.err('❌ MJML sanitization error:', error);
        return mjmlCode;
    }
}
/**
 * Extract preview text from MJML
 */
function extractPreviewText(mjmlCode) {
    try {
        const previewMatch = mjmlCode.match(/<mj-preview>(.*?)<\/mj-preview>/s);
        if (previewMatch && previewMatch[1]) {
            return previewMatch[1].trim();
        }
        return '';
    }
    catch (error) {
        jet_logger_1.default.err('❌ Preview text extraction error:', error);
        return '';
    }
}
/**
 * Get MJML template starter
 */
function getMjmlStarter() {
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
