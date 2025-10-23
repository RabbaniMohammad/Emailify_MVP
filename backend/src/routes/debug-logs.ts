import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Directory for debug logs
const LOGS_DIR = path.join(__dirname, '../../logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * POST /api/debug-logs
 * Receive and write debug logs from frontend
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sessionId, logs } = req.body;

    if (!sessionId || !logs || !Array.isArray(logs)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Create log file name based on session ID
    const logFileName = `debug_${sessionId}.log`;
    const logFilePath = path.join(LOGS_DIR, logFileName);

    // Format logs
    const formattedLogs = logs.map(log => {
      const timestamp = new Date(log.timestamp).toISOString();
      const category = log.category?.padEnd(20) || ''.padEnd(20);
      const level = log.level || 'INFO';
      const message = log.message || '';
      const data = log.data ? `\n    Data: ${JSON.stringify(log.data, null, 2)}` : '';
      const error = log.error ? `\n    Error: ${JSON.stringify(log.error, null, 2)}` : '';
      
      return `[${timestamp}] [${level}] [${category}] ${message}${data}${error}\n`;
    }).join('');

    // Append to log file
    fs.appendFileSync(logFilePath, formattedLogs, 'utf-8');

    res.json({ success: true, logsWritten: logs.length });
  } catch (error) {
    console.error('Error writing debug logs:', error);
    res.status(500).json({ error: 'Failed to write logs' });
  }
});

/**
 * POST /api/debug-logs/clear
 * Clear debug logs for a session (called on logout)
 */
router.post('/clear', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const logFileName = `debug_${sessionId}.log`;
    const logFilePath = path.join(LOGS_DIR, logFileName);

    // Delete the log file if it exists
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
      console.log(`✅ Cleared debug logs for session: ${sessionId}`);
    }

    res.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    console.error('Error clearing debug logs:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

/**
 * GET /api/debug-logs/list
 * List all debug log files
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(file => file.startsWith('debug_') && file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(LOGS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    res.json({ files });
  } catch (error) {
    console.error('Error listing debug logs:', error);
    res.status(500).json({ error: 'Failed to list logs' });
  }
});

/**
 * GET /api/debug-logs/:filename
 * Read a specific log file
 */
router.get('/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Security: Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const logFilePath = path.join(LOGS_DIR, filename);

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    const content = fs.readFileSync(logFilePath, 'utf-8');
    res.json({ filename, content });
  } catch (error) {
    console.error('Error reading debug log:', error);
    res.status(500).json({ error: 'Failed to read log' });
  }
});

/**
 * DELETE /api/debug-logs/cleanup
 * Clean up old log files (older than 7 days)
 */
router.delete('/cleanup', async (req: Request, res: Response) => {
  try {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(LOGS_DIR)
      .filter(file => file.startsWith('debug_') && file.endsWith('.log'));

    let deletedCount = 0;
    files.forEach(file => {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime.getTime() < sevenDaysAgo) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Error cleaning up debug logs:', error);
    res.status(500).json({ error: 'Failed to cleanup logs' });
  }
});

export default router;
