import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import OpenAI from 'openai';

// Use require for packages without proper type definitions
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB limit (reasonable for email template specs)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'text/plain', // .txt
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/pdf', // .pdf
    ];

    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv|txt|doc|docx|pdf)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel, CSV, TXT, Word, and PDF files are allowed.'));
    }
  },
});

// Helper function to extract text from Excel/CSV
function extractFromExcel(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  let extractedText = '';

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    
    // Try to parse as objects with headers first
    const jsonDataWithHeaders = XLSX.utils.sheet_to_json(sheet);
    
    // If we got structured data with headers, use that
    if (jsonDataWithHeaders.length > 0) {
      extractedText += `Sheet: ${sheetName}\n`;
      extractedText += `Total Rows: ${jsonDataWithHeaders.length}\n`;
      extractedText += `Structured Data:\n`;
      extractedText += JSON.stringify(jsonDataWithHeaders, null, 2);
      extractedText += '\n\n';
    } else {
      // Fallback to raw array data
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      extractedText += `Sheet: ${sheetName}\n`;
      extractedText += JSON.stringify(jsonData, null, 2);
      extractedText += '\n\n';
    }
  });

  return extractedText;
}

// Helper function to extract text from Word documents
async function extractFromWord(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Helper function to extract text from PDF
async function extractFromPDF(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

// Main route handler
router.post('/csv-to-prompt', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
    let extractedText = '';

    // Extract text based on file type
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

    // Log extracted data for debugging

    // ⚠️ Smart truncation: Limit to ~100K tokens (~400KB) to stay within GPT limits
    const MAX_CHARS = 400000; // ~100K tokens
    let dataToSend = extractedText;
    let wasTruncated = false;
    
    if (extractedText.length > MAX_CHARS) {
      dataToSend = extractedText.substring(0, MAX_CHARS);
      wasTruncated = true;
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // ⚡ Dynamic max_tokens based on input size and complexity
    // Estimate: 1 char ≈ 0.25 tokens (4 chars per token average)
    const estimatedInputTokens = Math.ceil(dataToSend.length / 4);
    
    // For structured data (Excel/CSV), we need MORE output tokens
    // because we're summarizing many rows into organized sections
    // Formula: 50-60% of input for structured data
    // Min: 1000 tokens (tiny files)
    // Max: 16000 tokens (GPT-4o-mini max output: 16,384)
    const dynamicMaxTokens = Math.min(
      Math.max(1000, Math.ceil(estimatedInputTokens * 0.6)),
      16000  // Use almost full GPT-4o-mini capacity
    );
    

    // Generate prompt using GPT-4o-mini
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
  } catch (error: any) {
    console.error('Error processing document:', error);
    
    // Handle multer file size error
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

// NEW: Extract endpoint - only extracts data without GPT processing
router.post('/csv-to-prompt/extract', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }


    const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
    let extractedData = '';

    // Extract text based on file type
    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      extractedData = extractFromExcel(req.file.buffer);
    } else if (fileExtension === 'csv' || fileExtension === 'txt') {
      extractedData = req.file.buffer.toString('utf-8');
    } else if (fileExtension === 'docx' || fileExtension === 'doc') {
      extractedData = await extractFromWord(req.file.buffer);
    } else if (fileExtension === 'pdf') {
      extractedData = await extractFromPDF(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }


    res.json({
      success: true,
      extractedData,
      fileType: fileExtension,
      fileName: req.file.originalname,
    });
  } catch (error: any) {
    console.error('📄 [EXTRACT] Error extracting file data:', error);
    
    // Handle multer file size error
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

export default router;
