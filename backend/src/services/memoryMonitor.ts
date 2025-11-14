import logger from 'jet-logger';
import { browserPool } from './browserPool';
import { websiteCache } from './websiteCache';

/**
 * Memory Monitor Service
 * 
 * Prevents crashes by monitoring memory usage and taking action:
 * 1. Alerts when memory reaches 80% (1.5GB on 1.9GB server)
 * 2. Clears cache when memory reaches 85%
 * 3. Drains browser pool when memory reaches 90%
 * 4. Logs memory stats every 2 minutes
 */

class MemoryMonitor {
  private readonly MEMORY_LIMIT_MB = 1900; // 1.9GB server
  private readonly WARNING_THRESHOLD = 0.80; // 80% = 1.5GB
  private readonly CACHE_CLEAR_THRESHOLD = 0.85; // 85% = 1.6GB
  private readonly CRITICAL_THRESHOLD = 0.90; // 90% = 1.7GB
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes

  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastWarningTime = 0;

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // Resident Set Size (total memory)
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // Heap actually used
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // Total heap allocated
      external: Math.round(usage.external / 1024 / 1024), // C++ objects
      percentage: Math.round((usage.rss / 1024 / 1024 / this.MEMORY_LIMIT_MB) * 100),
    };
  }

  /**
   * Check memory and take action if needed
   */
  private async checkMemory(): Promise<void> {
    const mem = this.getMemoryUsage();
    const usageRatio = mem.rss / this.MEMORY_LIMIT_MB;

    // Log stats
    logger.info(
      `💾 Memory: ${mem.rss}MB / ${this.MEMORY_LIMIT_MB}MB (${mem.percentage}%) - Heap: ${mem.heapUsed}/${mem.heapTotal}MB`
    );

    // CRITICAL: 90%+ - Drain browser pool
    if (usageRatio >= this.CRITICAL_THRESHOLD) {
      logger.err(`🚨 CRITICAL: Memory at ${mem.percentage}% - Draining browser pool!`);
      await browserPool.drain().catch((err) => logger.err('Failed to drain pool:', err));
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        logger.info('🗑️ Forced garbage collection');
      }
    }
    // WARNING: 85%+ - Clear cache
    else if (usageRatio >= this.CACHE_CLEAR_THRESHOLD) {
      logger.warn(`⚠️ WARNING: Memory at ${mem.percentage}% - Clearing cache!`);
      websiteCache.flush();
      
      if (global.gc) {
        global.gc();
      }
    }
    // ALERT: 80%+ - Log warning
    else if (usageRatio >= this.WARNING_THRESHOLD) {
      const now = Date.now();
      // Only log warning once per 5 minutes to avoid spam
      if (now - this.lastWarningTime > 5 * 60 * 1000) {
        logger.warn(
          `⚠️ Memory at ${mem.percentage}% - Approaching limit (${mem.rss}MB / ${this.MEMORY_LIMIT_MB}MB)`
        );
        this.lastWarningTime = now;
      }
    }
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.monitoringInterval) {
      logger.warn('Memory monitor already running');
      return;
    }

    logger.info(
      `✅ Memory monitor started (limit: ${this.MEMORY_LIMIT_MB}MB, check interval: ${this.CHECK_INTERVAL_MS / 1000}s)`
    );

    // Check immediately
    this.checkMemory();

    // Then check periodically
    this.monitoringInterval = setInterval(() => {
      this.checkMemory();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Memory monitor stopped');
    }
  }

  /**
   * Get current memory stats
   */
  getStats() {
    const mem = this.getMemoryUsage();
    const browserStats = browserPool.getStats();
    const cacheStats = websiteCache.getStats();

    return {
      memory: {
        current: mem.rss,
        limit: this.MEMORY_LIMIT_MB,
        percentage: mem.percentage,
        heap: {
          used: mem.heapUsed,
          total: mem.heapTotal,
        },
        external: mem.external,
      },
      browserPool: browserStats,
      cache: {
        ...cacheStats,
        estimatedMemory: websiteCache.getMemoryEstimate(),
      },
      thresholds: {
        warning: `${this.WARNING_THRESHOLD * 100}%`,
        cacheClear: `${this.CACHE_CLEAR_THRESHOLD * 100}%`,
        critical: `${this.CRITICAL_THRESHOLD * 100}%`,
      },
    };
  }
}

// Singleton instance
export const memoryMonitor = new MemoryMonitor();

// Auto-start in production
if (process.env.NODE_ENV === 'production') {
  memoryMonitor.start();
  logger.info('🔍 Memory monitoring enabled (production mode)');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  memoryMonitor.stop();
});

process.on('SIGINT', () => {
  memoryMonitor.stop();
});
