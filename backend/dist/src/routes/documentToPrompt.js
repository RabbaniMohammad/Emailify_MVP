"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const openai_1 = __importDefault(require("openai"));
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const router = (0, express_1.Router)();
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 1 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
        ];
        if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv|txt|doc|docx|pdf)$/)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only Excel, CSV, TXT, Word, and PDF files are allowed.'));
        }
    },
});
function extractFromExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let extractedText = '';
    workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const jsonDataWithHeaders = XLSX.utils.sheet_to_json(sheet);
        if (jsonDataWithHeaders.length > 0) {
            extractedText += `Sheet: ${sheetName}\n`;
            extractedText += `Total Rows: ${jsonDataWithHeaders.length}\n`;
            extractedText += `Structured Data:\n`;
            extractedText += JSON.stringify(jsonDataWithHeaders, null, 2);
            extractedText += '\n\n';
        }
        else {
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            extractedText += `Sheet: ${sheetName}\n`;
            extractedText += JSON.stringify(jsonData, null, 2);
            extractedText += '\n\n';
        }
    });
    return extractedText;
}
async function extractFromWord(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}
async function extractFromPDF(buffer) {
    const data = await pdfParse(buffer);
    return data.text;
}
router.post('/csv-to-prompt', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
        let extractedText = '';
        switch (fileExtension) {
            case 'xlsx':
            case 'xls':
                extractedText = extractFromExcel(req.file.buffer);
                break;
            case 'csv':
            case 'txt':
                extractedText = req.file.buffer.toString('utf-8');
                break;
            case 'doc':
            case 'docx':
                extractedText = await extractFromWord(req.file.buffer);
                break;
            case 'pdf':
                extractedText = await extractFromPDF(req.file.buffer);
                break;
            default:
                return res.status(400).json({ error: 'Unsupported file type' });
        }
        if (!extractedText || extractedText.trim() === '') {
            return res.status(400).json({ error: 'Could not extract text from the document' });
        }
        const MAX_CHARS = 400000;
        let dataToSend = extractedText;
        let wasTruncated = false;
        if (extractedText.length > MAX_CHARS) {
            dataToSend = extractedText.substring(0, MAX_CHARS);
            wasTruncated = true;
        }
        const openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const estimatedInputTokens = Math.ceil(dataToSend.length / 4);
        const dynamicMaxTokens = Math.min(Math.max(1000, Math.ceil(estimatedInputTokens * 0.6)), 16000);
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are an expert email template prompt generator. Your task is to analyze structured data from documents (Excel, CSV, Word, PDF) and create a detailed, well-organized prompt for email template generation.

CRITICAL REQUIREMENTS:
1. Include ALL fields and data from the document - nothing should be omitted
2. Organize the prompt by sections (Header, Body, Footer, Global Settings)
3. Use exact values provided in the data (colors, URLs, text, etc.)
4. Maintain field names and descriptions for clarity
5. Create a structured, easy-to-follow format

OUTPUT FORMAT:
- Start with a brief description of the email purpose
- List fields grouped by category/section
- Use clear labels and exact values
- End with design/global settings

Generate ONLY the structured prompt - no meta-commentary, field counts, or explanations about the prompt itself.`
                },
                {
                    role: 'user',
                    content: `Analyze this document data and create a comprehensive email template generation prompt:

${dataToSend}${wasTruncated ? '\n\n[Note: Data was truncated due to size. Focus on the most important fields shown above.]' : ''}

Requirements:
1. Include EVERY field from the data
2. Organize by sections (Header/Body/Footer/Global)
3. Use exact values (colors, URLs, text)
4. Maintain all specifications (sizes, fonts, colors)
5. Include personalization details
6. Specify tone and style

Format the prompt to be clear, structured, and actionable for an AI email template generator.`,
                },
            ],
            max_tokens: dynamicMaxTokens,
            temperature: 0.5,
        });
        const generatedPrompt = completion.choices[0]?.message?.content || '';
        res.json({
            success: true,
            prompt: generatedPrompt,
            fileType: fileExtension,
            fileName: req.file.originalname,
        });
    }
    catch (error) {
        console.error('Error processing document:', error);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large',
                message: 'File size must be less than 1MB. Please use a smaller file or reduce the data.',
            });
        }
        res.status(500).json({
            error: 'Failed to process document',
            message: error.message,
        });
    }
});
router.post('/csv-to-prompt/extract', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
        let extractedData = '';
        if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            extractedData = extractFromExcel(req.file.buffer);
        }
        else if (fileExtension === 'csv' || fileExtension === 'txt') {
            extractedData = req.file.buffer.toString('utf-8');
        }
        else if (fileExtension === 'docx' || fileExtension === 'doc') {
            extractedData = await extractFromWord(req.file.buffer);
        }
        else if (fileExtension === 'pdf') {
            extractedData = await extractFromPDF(req.file.buffer);
        }
        else {
            return res.status(400).json({ error: 'Unsupported file type' });
        }
        res.json({
            success: true,
            extractedData,
            fileType: fileExtension,
            fileName: req.file.originalname,
        });
    }
    catch (error) {
        console.error('📄 [EXTRACT] Error extracting file data:', error);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large',
                message: 'File size must be less than 1MB. Please use a smaller file or reduce the data.',
            });
        }
        res.status(500).json({
            error: 'Failed to extract file data',
            message: error.message,
        });
    }
});
exports.default = router;
