import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import OpenAI from 'openai';

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
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let extractedText = '';

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('No sheets found in Excel file');
    }

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      
      if (!sheet) {
        console.warn(`Sheet "${sheetName}" is empty or invalid`);
        return;
      }
      
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
        if (jsonData.length > 0) {
          extractedText += `Sheet: ${sheetName}\n`;
          extractedText += JSON.stringify(jsonData, null, 2);
          extractedText += '\n\n';
        }
      }
    });

    if (!extractedText || extractedText.trim() === '') {
      throw new Error('No data could be extracted from Excel file');
    }

    return extractedText;
  } catch (error: any) {
    console.error('Error extracting from Excel:', error);
    throw new Error(`Failed to extract text from Excel: ${error.message}`);
  }
}

// Helper function to extract text from Word documents
async function extractFromWord(buffer: Buffer): Promise<string> {
  try {
    // Use eval to bypass TypeScript's module resolution for CommonJS
    const mammoth = eval('require')('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    
    if (!result || !result.value) {
      throw new Error('Word document parsing succeeded but no text was extracted');
    }
    
    return result.value;
  } catch (error: any) {
    console.error('Error extracting from Word:', error);
    if (error.message.includes('Cannot find module')) {
      throw new Error('Mammoth is not installed. Please run: npm install mammoth');
    }
    throw new Error(`Failed to extract text from Word document: ${error.message}`);
  }
}

// Helper function to extract text from PDF
async function extractFromPDF(buffer: Buffer): Promise<string> {
  try {
    // For pdf-parse, we need to use a simple approach
    // The library is CommonJS and should export a single function
    const pdfParse = eval('require')('pdf-parse');
    
    console.log('📦 PDF module loaded');
    console.log('📦 Type:', typeof pdfParse);
    console.log('📦 Is function?', typeof pdfParse === 'function');
    
    if (typeof pdfParse !== 'function') {
      console.log('📦 Module keys:', Object.keys(pdfParse));
      console.log('📦 Checking for callable exports...');
      
      // Check if there's a default export
      if (pdfParse.default && typeof pdfParse.default === 'function') {
        console.log('✅ Found default export, using that');
        const data = await pdfParse.default(buffer);
        return data.text || '';
      }
      
      throw new Error(`pdf-parse did not export a function. Type: ${typeof pdfParse}. You may have the wrong version installed. Try: npm install pdf-parse@1.1.1`);
    }
    
    console.log('🔄 Calling pdf-parse with buffer...');
    const data = await pdfParse(buffer);
    
    console.log('📄 PDF parse result:', {
      hasData: !!data,
      hasText: !!data?.text,
      textLength: data?.text?.length || 0,
      keys: data ? Object.keys(data) : []
    });
    
    if (!data || !data.text) {
      throw new Error('PDF parsing succeeded but no text was extracted from the document');
    }
    
    console.log('✅ PDF text extracted successfully, length:', data.text.length);
    return data.text;
  } catch (error: any) {
    console.error('❌ Error extracting from PDF:', error);
    
    // Handle specific PDF errors with helpful messages
    if (error.message && error.message.includes('bad XRef')) {
      console.warn('⚠️ PDF has corrupted XRef table, attempting text extraction anyway...');
      // Return a helpful error message instead of crashing
      return `[PDF Error: This PDF file appears to be corrupted or has an invalid structure. Please try re-saving the PDF or using a different file format like DOCX or TXT. Error details: ${error.message}]`;
    }
    
    if (error.message && error.message.includes('Invalid PDF')) {
      return `[PDF Error: The uploaded file does not appear to be a valid PDF document. Please verify the file is not corrupted and try again.]`;
    }
    
    if (error.message.includes('Cannot find module')) {
      throw new Error('pdf-parse is not installed. Please run: npm install pdf-parse@1.1.1');
    }
    
    // For other PDF errors, return a user-friendly message
    console.warn('⚠️ PDF parsing failed, returning error message to user');
    return `[PDF Extraction Error: Unable to extract text from this PDF. The file may be image-based (scanned), password-protected, or corrupted. Error: ${error.message}]`;
  }
}

// Main route handler
router.post('/csv-to-prompt', upload.single('file'), async (req: Request, res: Response) => {
  try {
    console.log('📄 Document upload request received');
    
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📁 File received:', {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
    let extractedText = '';

    // Extract text based on file type
    switch (fileExtension) {
      case 'xlsx':
      case 'xls':
        console.log('📊 Extracting from Excel...');
        extractedText = extractFromExcel(req.file.buffer);
        break;
      case 'csv':
      case 'txt':
        console.log('📝 Extracting from CSV/TXT...');
        try {
          extractedText = req.file.buffer.toString('utf-8');
          if (!extractedText || extractedText.trim() === '') {
            throw new Error('File is empty');
          }
        } catch (error: any) {
          throw new Error(`Failed to read CSV/TXT file: ${error.message}`);
        }
        break;
      case 'doc':
      case 'docx':
        console.log('📄 Extracting from Word...');
        extractedText = await extractFromWord(req.file.buffer);
        break;
      case 'pdf':
        console.log('📕 Extracting from PDF...');
        extractedText = await extractFromPDF(req.file.buffer);
        break;
      default:
        console.log('❌ Unsupported file type:', fileExtension);
        return res.status(400).json({ 
          error: 'Unsupported file type',
          message: `File type ".${fileExtension}" is not supported. Please upload Excel (.xlsx, .xls), CSV, TXT, Word (.doc, .docx), or PDF files.`
        });
    }

    if (!extractedText || extractedText.trim() === '') {
      console.log('❌ No text extracted from document');
      return res.status(400).json({ error: 'Could not extract text from the document' });
    }

    console.log('✅ Text extracted, length:', extractedText.length);

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
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY not configured');
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        message: 'Please configure OPENAI_API_KEY in environment variables' 
      });
    }

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
    
    console.log('🤖 Calling OpenAI API...', {
      inputTokensEstimate: estimatedInputTokens,
      maxTokens: dynamicMaxTokens
    });

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

    console.log('✅ OpenAI response received, prompt length:', generatedPrompt.length);

    if (!generatedPrompt) {
      console.error('❌ OpenAI returned empty prompt');
      return res.status(500).json({
        error: 'Failed to generate prompt',
        message: 'OpenAI returned an empty response'
      });
    }

    console.log('✅ Successfully generated prompt from document');

    res.json({
      success: true,
      prompt: generatedPrompt,
      fileType: fileExtension,
      fileName: req.file.originalname,
    });
  } catch (error: any) {
    console.error('❌ Error processing document:', error);
    console.error('Error stack:', error.stack);
    
    // Handle multer file size error
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'File size must be less than 1MB. Please use a smaller file or reduce the data.',
      });
    }
    
    // Handle OpenAI API errors
    if (error.response) {
      console.error('OpenAI API error:', error.response.data);
      return res.status(500).json({
        error: 'OpenAI API error',
        message: error.response.data?.error?.message || 'Failed to generate prompt using AI'
      });
    }
    
    res.status(500).json({
      error: 'Failed to process document',
      message: error.message || 'An unknown error occurred',
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
      // Check if extraction returned an error message
      if (extractedData.startsWith('[PDF Error:') || extractedData.startsWith('[PDF Extraction Error:')) {
        console.warn('⚠️ PDF extraction had issues but returning partial result');
        // Still return the error message so user knows what happened
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Even if extractedData contains an error message, return it
    // The AI can work with the error message to explain the issue to the user
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
