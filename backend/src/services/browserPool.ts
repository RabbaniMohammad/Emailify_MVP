import puppeteer, { Browser } from 'puppeteer';
import { createPool, Pool, Factory } from 'generic-pool';
import logger from 'jet-logger';

/**
 * Browser Pool Manager
 * 
 * Industry-standard browser pooling using generic-pool library.
 * Reuses browser instances instead of creating new ones for each request.
 * 
 * Benefits:
 * - Reduces memory usage (no repeated browser launches)
 * - Faster scraping (no 3-second launch delay)
 * - Better resource management
 * 
 * Configuration:
 * - Min: 1 browser (always ready)
 * - Max: 2 browsers (prevents memory overflow on 1.9GB server)
 * - Idle timeout: 5 minutes (browsers close if unused)
 */

interface BrowserPoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  acquireTimeoutMillis?: number;
}

const DEFAULT_CONFIG: Required<BrowserPoolConfig> = {
  min: 1,  // Keep 1 browser always warm
  max: 2,  // Max 2 concurrent browsers (400MB × 2 = 800MB safe for 1.9GB RAM)
  idleTimeoutMillis: 5 * 60 * 1000,  // Close idle browsers after 5 minutes
  acquireTimeoutMillis: 30000,  // Wait up to 30s for available browser
};

class BrowserPoolManager {
  private pool: Pool<Browser> | null = null;
  private config: Required<BrowserPoolConfig>;

  constructor(config: BrowserPoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the browser pool
   */
  private async createBrowserPool(): Promise<Pool<Browser>> {
    const factory: Factory<Browser> = {
      create: async (): Promise<Browser> => {
        logger.info('🚀 Creating new browser instance...');
        
        const browser = await puppeteer.launch({
          headless: true,  // Headless mode
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',  // Use /tmp instead of /dev/shm (prevents crashes)
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
          ],
          // Memory limits
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });

        browser.on('disconnected', () => {
          logger.warn('⚠️ Browser disconnected unexpectedly');
        });

        return browser;
      },

      destroy: async (browser: Browser): Promise<void> => {
        logger.info('🗑️ Destroying browser instance...');
        try {
          // Close all pages first to prevent memory leaks
          const pages = await browser.pages();
          await Promise.all(pages.map(page => page.close().catch(() => {})));
          await browser.close();
        } catch (error) {
          logger.err('Error closing browser:', error);
        }
      },

      validate: async (browser: Browser): Promise<boolean> => {
        try {
          if (!browser.isConnected()) {
            return false;
          }
          
          // Check for page leak - if browser has >5 pages, it's leaking
          const pages = await browser.pages();
          if (pages.length > 5) {
            logger.warn(`⚠️ Browser has ${pages.length} pages open - possible memory leak!`);
            // Close extra pages (keep only blank page)
            const pagesToClose = pages.slice(1); // Keep first page
            await Promise.all(pagesToClose.map(p => p.close().catch(() => {})));
          }
          
          return true;
        } catch {
          return false;
        }
      },
    };

    return createPool(factory, {
      min: this.config.min,
      max: this.config.max,
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      acquireTimeoutMillis: this.config.acquireTimeoutMillis,
      testOnBorrow: true,  // Validate browser before lending
      autostart: true,  // Create min browsers immediately
    });
  }

  /**
   * Get the pool instance (lazy initialization)
   */
  private async getPool(): Promise<Pool<Browser>> {
    if (!this.pool) {
      this.pool = await this.createBrowserPool();
      logger.info(`✅ Browser pool initialized (min: ${this.config.min}, max: ${this.config.max})`);
    }
    return this.pool;
  }

  /**
   * Acquire a browser from the pool
   */
  async acquire(): Promise<Browser> {
    const pool = await this.getPool();
    logger.info(`📥 Acquiring browser (available: ${pool.available}, pending: ${pool.pending})`);
    return pool.acquire();
  }

  /**
   * Release browser back to pool
   */
  async release(browser: Browser): Promise<void> {
    if (!this.pool) return;
    logger.info('📤 Releasing browser back to pool');
    await this.pool.release(browser);
  }

  /**
   * Drain and close all browsers
   */
  async drain(): Promise<void> {
    if (!this.pool) return;
    logger.info('🔄 Draining browser pool...');
    await this.pool.drain();
    await this.pool.clear();
    this.pool = null;
  }

  /**
   * Get pool statistics
   */
  getStats() {
    if (!this.pool) {
      return { size: 0, available: 0, pending: 0, borrowed: 0 };
    }
    return {
      size: this.pool.size,
      available: this.pool.available,
      pending: this.pool.pending,
      borrowed: this.pool.borrowed,
      min: this.config.min,
      max: this.config.max,
    };
  }
}

// Singleton instance
export const browserPool = new BrowserPoolManager();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, draining browser pool...');
  await browserPool.drain();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, draining browser pool...');
  await browserPool.drain();
});
