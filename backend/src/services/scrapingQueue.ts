import PQueue from 'p-queue';
import logger from 'jet-logger';

/**
 * Scraping Queue Manager
 * 
 * Industry-standard concurrency control using p-queue library.
 * Prevents memory overflow by limiting concurrent scraping operations.
 * 
 * Why this matters:
 * - 3 concurrent scrapes = 900MB-1200MB RAM usage
 * - Server only has 1.9GB total (1.4GB available after system)
 * - Without queue: all requests execute simultaneously → CRASH
 * - With queue: max 2-3 concurrent → safe operation
 * 
 * Configuration:
 * - Concurrency: 2 (max 2 scrapes at once = ~800MB safe)
 * - Timeout: 90 seconds per task
 * - Auto-start: true
 */

class ScrapingQueueManager {
  private queue: PQueue;
  private readonly CONCURRENCY = 2; // Max 2 concurrent browser instances
  private readonly TIMEOUT = 90000; // 90 seconds per scrape

  constructor() {
    this.queue = new PQueue({
      concurrency: this.CONCURRENCY,
      timeout: this.TIMEOUT,
      autoStart: true,
    });

    // Event listeners for monitoring
    this.queue.on('active', () => {
      logger.info(
        `🔄 Queue active - Running: ${this.queue.pending}/${this.CONCURRENCY}, Waiting: ${this.queue.size}`
      );
    });

    this.queue.on('idle', () => {
      logger.info('✅ Queue idle - All tasks completed');
    });

    this.queue.on('error', (error) => {
      logger.err('❌ Queue error:', error);
    });

    logger.info(
      `✅ Scraping queue initialized (concurrency: ${this.CONCURRENCY}, timeout: ${this.TIMEOUT}ms)`
    );
  }

  /**
   * Add a scraping task to the queue
   * 
   * @param fn - Async function to execute (the scraping task)
   * @param priority - Higher priority = executes sooner (default: 0)
   * @returns Promise that resolves with the task result
   */
  async add<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
    return this.queue.add(fn, { priority });
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      size: this.queue.size, // Tasks waiting
      pending: this.queue.pending, // Tasks running
      isPaused: this.queue.isPaused,
      concurrency: this.CONCURRENCY,
      maxConcurrency: this.CONCURRENCY,
    };
  }

  /**
   * Pause the queue (stop processing new tasks)
   */
  pause(): void {
    this.queue.pause();
    logger.info('⏸️ Queue paused');
  }

  /**
   * Resume the queue
   */
  start(): void {
    this.queue.start();
    logger.info('▶️ Queue resumed');
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    this.queue.clear();
    logger.info('🧹 Queue cleared');
  }

  /**
   * Wait for all tasks to complete
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Wait for queue size to drop below threshold
   */
  async onSizeLessThan(limit: number): Promise<void> {
    await this.queue.onSizeLessThan(limit);
  }
}

// Singleton instance
export const scrapingQueue = new ScrapingQueueManager();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, waiting for queue to finish...');
  await scrapingQueue.onIdle();
  logger.info('Queue drained successfully');
});
