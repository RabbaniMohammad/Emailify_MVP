import { Injectable } from '@angular/core';
import { DatabaseService } from './db.service';
import { interval } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CacheMonitorService {
  private readonly MAX_CACHE_SIZE_MB = 50;
  private readonly WARNING_THRESHOLD_PERCENT = 80;
  private readonly MONITORING_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

  constructor(private db: DatabaseService) {}

  /**
   * Check browser storage quota
   */
  async checkStorageQuota(): Promise<{
    used: number;
    total: number;
    percentage: number;
    status: 'healthy' | 'warning' | 'critical';
  }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const total = estimate.quota || 0;
        const percentage = total > 0 ? (used / total) * 100 : 0;

        let status: 'healthy' | 'warning' | 'critical' = 'healthy';
        if (percentage > 90) {
          status = 'critical';
        } else if (percentage > this.WARNING_THRESHOLD_PERCENT) {
          status = 'warning';
        }

        // Only log warnings and errors in production
        if (status === 'critical') {
          await this.emergencyCleanup();
        } else if (status === 'warning') {
        }

        return { used, total, percentage, status };
      }

      return { used: 0, total: 0, percentage: 0, status: 'healthy' };
    } catch (error) {
      console.error('❌ [MONITOR] Failed to check storage quota:', error);
      return { used: 0, total: 0, percentage: 0, status: 'healthy' };
    }
  }

  /**
   * Check cache health and size
   */
  async checkCacheHealth(): Promise<{
    stats: any;
    isHealthy: boolean;
    warnings: string[];
  }> {
    try {
      const stats = await this.db.getCacheStats();
      const warnings: string[] = [];
      let isHealthy = true;

      // Check cache size
      if (stats.estimatedSizeMB > this.MAX_CACHE_SIZE_MB) {
        warnings.push(`Cache size (${stats.estimatedSizeMB}MB) exceeds limit (${this.MAX_CACHE_SIZE_MB}MB)`);
        isHealthy = false;
      }

      // Check template count
      if (stats.templateCount > 40) {
        warnings.push(`High template count: ${stats.templateCount}`);
      }

      // Check conversation count
      if (stats.conversationCount > 80) {
        warnings.push(`High conversation count: ${stats.conversationCount}`);
      }

      if (warnings.length > 0) {
      } else {
      }

      return { stats, isHealthy, warnings };
    } catch (error) {
      console.error('❌ [MONITOR] Failed to check cache health:', error);
      return {
        stats: null,
        isHealthy: false,
        warnings: ['Failed to check cache health']
      };
    }
  }

  /**
   * Emergency cleanup when storage is critical
   */
  async emergencyCleanup(): Promise<void> {
    try {
      // Keep only 10 most recent templates
      const allTemplates = await this.db.templates
        .orderBy('timestamp')
        .reverse()
        .toArray();

      const templatesToDelete = allTemplates.slice(10);
      for (const template of templatesToDelete) {
        await this.db.templates.delete(template.id);
      }

      // Keep only 20 most recent conversations
      const allConversations = await this.db.conversations
        .orderBy('timestamp')
        .reverse()
        .toArray();

      const conversationsToDelete = allConversations.slice(20);
      for (const conversation of conversationsToDelete) {
        await this.db.conversations.delete(conversation.runId);
      }

      // Delete all expired data
      await this.db.cleanExpiredData();

    } catch (error) {
      console.error('❌ [MONITOR] Emergency cleanup failed:', error);
    }
  }

  /**
   * Periodic cleanup (run on app startup and every 3 hours)
   */
  async periodicCleanup(): Promise<void> {
    try {
      // Remove expired data
      await this.db.cleanExpiredData();

      // Check health
      const health = await this.checkCacheHealth();

      // If not healthy, do more aggressive cleanup
      if (!health.isHealthy) {
        await this.db.cleanOldestTemplates(10);
        await this.db.cleanOldestConversations(20);
      }
    } catch (error) {
      console.error('❌ [MONITOR] Periodic cleanup failed:', error);
    }
  }

  /**
   * Display cache statistics (for debugging)
   */
  async displayStats(): Promise<void> {
    await this.db.logCacheStats();
    
    const quota = await this.checkStorageQuota();
    const health = await this.checkCacheHealth();

    if (!health.isHealthy || quota.status !== 'healthy') {
    }
  }

  /**
   * Start monitoring (call on app init)
   * Runs initial cleanup, then monitors every 3 hours
   */
  async startMonitoring(): Promise<void> {
    // Initial cleanup on app startup
    await this.periodicCleanup();

    // Check storage quota
    await this.checkStorageQuota();

    // Setup periodic monitoring every 3 hours
    interval(this.MONITORING_INTERVAL_MS).subscribe(async () => {
      await this.periodicCleanup();
      await this.checkStorageQuota();
    });
  }
}
