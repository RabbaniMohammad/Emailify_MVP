import Dexie, { Table } from 'dexie';

// ============================================
// DATABASE SCHEMA INTERFACES
// ============================================

export interface CachedTemplate {
  id: string;
  runId: string;
  templateId?: string;
  html?: string;
  mjml?: string;
  // Note: NOT caching screenshots - too large
  timestamp: number;
  userId?: string;
}

export interface CachedConversation {
  runId: string;
  templateId?: string;
  html?: string; // 🔥 ADD HTML FIELD
  messages: any[];
  variants?: any[];
  timestamp: number;
  userId?: string;
}

export interface CachedValidLinks {
  runId: string;
  links: string[];
  timestamp: number;
}

export interface CachedScreenshot {
  url: string;          // Primary key
  runId: string;        // Associated run
  dataUrl: string;      // Base64 screenshot data
  timestamp: number;
}

// ✅ NEW: Golden template cache
export interface CachedGolden {
  templateId: string;   // Primary key
  html: string;
  changes: any[];       // Applied edits
  failedEdits?: any[];  // Failed edits with diagnostics
  timestamp: number;
  userId?: string;
}

// ✅ NEW: Suggestions cache
export interface CachedSuggestions {
  templateId: string;   // Primary key
  gibberish: Array<{ text: string; reason: string }>;
  suggestions: string[];
  timestamp: number;
  userId?: string;
}

// ✅ NEW: Variants run cache
export interface CachedVariantsRun {
  templateId: string;   // Primary key
  runId: string;
  items: any[];         // Variant items
  target: number;
  status: string;
  timestamp: number;
  userId?: string;
}

// ============================================
// DATABASE SERVICE
// ============================================

export class DatabaseService extends Dexie {
  // Tables
  templates!: Table<CachedTemplate, string>;
  conversations!: Table<CachedConversation, string>;
  validLinks!: Table<CachedValidLinks, string>;
  screenshots!: Table<CachedScreenshot, string>;
  
  // ✅ NEW: QA-specific tables
  goldenTemplates!: Table<CachedGolden, string>;
  suggestions!: Table<CachedSuggestions, string>;
  variantsRuns!: Table<CachedVariantsRun, string>;

  // Configuration
  private readonly MAX_TEMPLATES = 500;        // Increased from 50
  private readonly MAX_CONVERSATIONS = 1000;   // Increased from 100
  private readonly MAX_SCREENSHOTS = 200;      // New: Max screenshots to cache
  private readonly MAX_GOLDEN = 100;           // ✅ NEW: Max golden templates
  private readonly MAX_SUGGESTIONS = 100;      // ✅ NEW: Max suggestions
  private readonly MAX_VARIANTS = 100;         // ✅ NEW: Max variant runs
  private readonly MAX_AGE_DAYS = 30;          // Increased from 7

  constructor() {
    super('emailify-cache');

    // Define schema - Version 2 with new tables
    this.version(2).stores({
      templates: 'id, runId, templateId, timestamp, userId',
      conversations: 'runId, templateId, timestamp, userId',
      validLinks: 'runId, timestamp',
      screenshots: 'url, runId, timestamp',
      // ✅ NEW: QA-specific stores
      goldenTemplates: 'templateId, timestamp, userId',
      suggestions: 'templateId, timestamp, userId',
      variantsRuns: 'templateId, runId, timestamp, userId'
    });

  }

  // ============================================
  // TEMPLATE OPERATIONS
  // ============================================

  async cacheTemplate(template: CachedTemplate): Promise<void> {
    try {
      // Check if we're over the limit
      const count = await this.templates.count();
      
      if (count >= this.MAX_TEMPLATES) {
        await this.cleanOldestTemplates(10); // Remove 10 oldest
      }

      template.timestamp = Date.now();
      await this.templates.put(template);
      
    } catch (error) {
      console.error('❌ [DB] Failed to cache template:', error);
    }
  }

  async getTemplate(id: string): Promise<CachedTemplate | null> {
    try {
      const template = await this.templates.get(id);
      
      if (!template) {
        return null;
      }

      // Check if expired
      if (this.isExpired(template.timestamp)) {
        await this.templates.delete(id);
        return null;
      }

      return template;
    } catch (error) {
      console.error('❌ [DB] Failed to get template:', error);
      return null;
    }
  }

  async invalidateTemplate(id: string): Promise<void> {
    try {
      await this.templates.delete(id);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate template:', error);
    }
  }

  // ============================================
  // CONVERSATION OPERATIONS
  // ============================================

  async cacheConversation(conversation: CachedConversation): Promise<void> {
    try {
      // Check if we're over the limit
      const count = await this.conversations.count();
      
      if (count >= this.MAX_CONVERSATIONS) {
        await this.cleanOldestConversations(20); // Remove 20 oldest
      }

      conversation.timestamp = Date.now();
      await this.conversations.put(conversation);
      
    } catch (error) {
      console.error('❌ [DB] Failed to cache conversation:', error);
    }
  }

  async getConversation(runId: string): Promise<CachedConversation | null> {
    try {
      const conversation = await this.conversations.get(runId);
      
      if (!conversation) {
        return null;
      }

      // Check if expired
      if (this.isExpired(conversation.timestamp)) {
        await this.conversations.delete(runId);
        return null;
      }

      return conversation;
    } catch (error) {
      console.error('❌ [DB] Failed to get conversation:', error);
      return null;
    }
  }

  async invalidateConversation(runId: string): Promise<void> {
    try {
      await this.conversations.delete(runId);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate conversation:', error);
    }
  }

  // ============================================
  // VALID LINKS OPERATIONS
  // ============================================

  async cacheValidLinks(runId: string, links: string[]): Promise<void> {
    try {
      await this.validLinks.put({
        runId,
        links,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ [DB] Failed to cache valid links:', error);
    }
  }

  async getValidLinks(runId: string): Promise<string[] | null> {
    try {
      const cached = await this.validLinks.get(runId);
      
      if (!cached) {
        return null;
      }

      // Check if expired
      if (this.isExpired(cached.timestamp)) {
        await this.validLinks.delete(runId);
        return null;
      }

      return cached.links;
    } catch (error) {
      console.error('❌ [DB] Failed to get valid links:', error);
      return null;
    }
  }

  async invalidateValidLinks(runId: string): Promise<void> {
    try {
      await this.validLinks.delete(runId);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate valid links:', error);
    }
  }

  // ============================================
  // CLEANUP OPERATIONS
  // ============================================

  async cleanOldestTemplates(count: number): Promise<void> {
    try {
      const oldest = await this.templates
        .orderBy('timestamp')
        .limit(count)
        .toArray();

      for (const template of oldest) {
        await this.templates.delete(template.id);
      }

    } catch (error) {
      console.error('❌ [DB] Failed to clean templates:', error);
    }
  }

  async cleanOldestConversations(count: number): Promise<void> {
    try {
      const oldest = await this.conversations
        .orderBy('timestamp')
        .limit(count)
        .toArray();

      for (const conversation of oldest) {
        await this.conversations.delete(conversation.runId);
      }

    } catch (error) {
      console.error('❌ [DB] Failed to clean conversations:', error);
    }
  }

  async cleanExpiredData(): Promise<void> {
    try {
      const maxAge = Date.now() - (this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

      // Clean expired templates
      const expiredTemplates = await this.templates
        .where('timestamp')
        .below(maxAge)
        .count();
      
      await this.templates.where('timestamp').below(maxAge).delete();

      // Clean expired conversations
      const expiredConversations = await this.conversations
        .where('timestamp')
        .below(maxAge)
        .count();
      
      await this.conversations.where('timestamp').below(maxAge).delete();

      // Clean expired valid links
      const expiredLinks = await this.validLinks
        .where('timestamp')
        .below(maxAge)
        .count();
      
      await this.validLinks.where('timestamp').below(maxAge).delete();

      const total = expiredTemplates + expiredConversations + expiredLinks;
      
      if (total > 0) {
      }
    } catch (error) {
      console.error('❌ [DB] Failed to clean expired data:', error);
    }
  }

  async clearAllCache(): Promise<void> {
    try {
      await this.templates.clear();
      await this.conversations.clear();
      await this.validLinks.clear();
      
    } catch (error) {
      console.error('❌ [DB] Failed to clear cache:', error);
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  private isExpired(timestamp: number): boolean {
    const maxAge = this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - timestamp > maxAge;
  }

  async getCacheStats(): Promise<{
    templateCount: number;
    conversationCount: number;
    validLinksCount: number;
    screenshotCount: number;
    estimatedSizeMB: number;
  }> {
    try {
      const templateCount = await this.templates.count();
      const conversationCount = await this.conversations.count();
      const validLinksCount = await this.validLinks.count();
      const screenshotCount = await this.screenshots.count();

      // Estimate size
      const templates = await this.templates.toArray();
      const conversations = await this.conversations.toArray();
      const links = await this.validLinks.toArray();
      const screenshots = await this.screenshots.toArray();

      const sizeBytes = JSON.stringify({
        templates,
        conversations,
        links,
        screenshots
      }).length;

      const estimatedSizeMB = parseFloat((sizeBytes / 1024 / 1024).toFixed(2));

      return {
        templateCount,
        conversationCount,
        validLinksCount,
        screenshotCount,
        estimatedSizeMB
      };
    } catch (error) {
      console.error('❌ [DB] Failed to get cache stats:', error);
      return {
        templateCount: 0,
        conversationCount: 0,
        validLinksCount: 0,
        screenshotCount: 0,
        estimatedSizeMB: 0
      };
    }
  }

  async logCacheStats(): Promise<void> {
    const stats = await this.getCacheStats();
    console.table({
      'Templates': stats.templateCount,
      'Conversations': stats.conversationCount,
      'Valid Links': stats.validLinksCount,
      'Size (MB)': stats.estimatedSizeMB
    });
  }

  // ============================================
  // SCREENSHOT CACHING
  // ============================================

  async cacheScreenshot(url: string, runId: string, dataUrl: string): Promise<void> {
    try {
      await this.screenshots.put({
        url,
        runId,
        dataUrl,
        timestamp: Date.now()
      });
      // Clean old screenshots if needed
      await this.cleanOldestScreenshots();
    } catch (error) {
      console.error('❌ [DB] Failed to cache screenshot:', error);
    }
  }

  async getScreenshot(url: string): Promise<string | null> {
    try {
      const cached = await this.screenshots.get(url);
      return cached?.dataUrl || null;
    } catch (error) {
      console.error('❌ [DB] Failed to get screenshot:', error);
      return null;
    }
  }

  async getScreenshotsByRun(runId: string): Promise<Map<string, string>> {
    try {
      const screenshots = await this.screenshots.where('runId').equals(runId).toArray();
      const map = new Map<string, string>();
      screenshots.forEach(s => map.set(s.url, s.dataUrl));
      return map;
    } catch (error) {
      console.error('❌ [DB] Failed to get screenshots by run:', error);
      return new Map();
    }
  }

  private async cleanOldestScreenshots(): Promise<void> {
    try {
      const count = await this.screenshots.count();
      if (count > this.MAX_SCREENSHOTS) {
        const toDelete = count - this.MAX_SCREENSHOTS;
        const oldest = await this.screenshots
          .orderBy('timestamp')
          .limit(toDelete)
          .toArray();
        
        await this.screenshots.bulkDelete(oldest.map(s => s.url));
      }
    } catch (error) {
      console.error('❌ [DB] Failed to clean old screenshots:', error);
    }
  }

  // ============================================
  // GOLDEN TEMPLATE OPERATIONS
  // ============================================

  async cacheGolden(golden: CachedGolden): Promise<void> {
    try {
      const count = await this.goldenTemplates.count();
      
      if (count >= this.MAX_GOLDEN) {
        await this.cleanOldestGolden(10);
      }

      golden.timestamp = Date.now();
      await this.goldenTemplates.put(golden);
      
      console.log('✅ [DB] Cached golden template:', golden.templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to cache golden template:', error);
    }
  }

  async getGolden(templateId: string): Promise<CachedGolden | null> {
    try {
      const golden = await this.goldenTemplates.get(templateId);
      
      if (!golden) {
        return null;
      }

      // Check if expired
      const age = Date.now() - golden.timestamp;
      const maxAge = this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      
      if (age > maxAge) {
        await this.goldenTemplates.delete(templateId);
        return null;
      }

      return golden;
    } catch (error) {
      console.error('❌ [DB] Failed to get golden template:', error);
      return null;
    }
  }

  async invalidateGolden(templateId: string): Promise<void> {
    try {
      await this.goldenTemplates.delete(templateId);
      console.log('🗑️ [DB] Invalidated golden template:', templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate golden template:', error);
    }
  }

  private async cleanOldestGolden(count: number): Promise<void> {
    try {
      const oldest = await this.goldenTemplates
        .orderBy('timestamp')
        .limit(count)
        .toArray();
      
      await this.goldenTemplates.bulkDelete(oldest.map(g => g.templateId));
      console.log(`🧹 [DB] Cleaned ${oldest.length} old golden templates`);
    } catch (error) {
      console.error('❌ [DB] Failed to clean old golden templates:', error);
    }
  }

  // ============================================
  // SUGGESTIONS OPERATIONS
  // ============================================

  async cacheSuggestions(suggestions: CachedSuggestions): Promise<void> {
    try {
      const count = await this.suggestions.count();
      
      if (count >= this.MAX_SUGGESTIONS) {
        await this.cleanOldestSuggestions(10);
      }

      suggestions.timestamp = Date.now();
      await this.suggestions.put(suggestions);
      
      console.log('✅ [DB] Cached suggestions:', suggestions.templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to cache suggestions:', error);
    }
  }

  async getSuggestions(templateId: string): Promise<CachedSuggestions | null> {
    try {
      const suggestions = await this.suggestions.get(templateId);
      
      if (!suggestions) {
        return null;
      }

      // Check if expired
      const age = Date.now() - suggestions.timestamp;
      const maxAge = this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      
      if (age > maxAge) {
        await this.suggestions.delete(templateId);
        return null;
      }

      return suggestions;
    } catch (error) {
      console.error('❌ [DB] Failed to get suggestions:', error);
      return null;
    }
  }

  async invalidateSuggestions(templateId: string): Promise<void> {
    try {
      await this.suggestions.delete(templateId);
      console.log('🗑️ [DB] Invalidated suggestions:', templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate suggestions:', error);
    }
  }

  private async cleanOldestSuggestions(count: number): Promise<void> {
    try {
      const oldest = await this.suggestions
        .orderBy('timestamp')
        .limit(count)
        .toArray();
      
      await this.suggestions.bulkDelete(oldest.map(s => s.templateId));
      console.log(`🧹 [DB] Cleaned ${oldest.length} old suggestions`);
    } catch (error) {
      console.error('❌ [DB] Failed to clean old suggestions:', error);
    }
  }

  // ============================================
  // VARIANTS RUN OPERATIONS
  // ============================================

  async cacheVariantsRun(variantsRun: CachedVariantsRun): Promise<void> {
    try {
      const count = await this.variantsRuns.count();
      
      if (count >= this.MAX_VARIANTS) {
        await this.cleanOldestVariants(10);
      }

      variantsRun.timestamp = Date.now();
      await this.variantsRuns.put(variantsRun);
      
      console.log('✅ [DB] Cached variants run:', variantsRun.templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to cache variants run:', error);
    }
  }

  async getVariantsRun(templateId: string): Promise<CachedVariantsRun | null> {
    try {
      const variantsRun = await this.variantsRuns.get(templateId);
      
      if (!variantsRun) {
        return null;
      }

      // Check if expired
      const age = Date.now() - variantsRun.timestamp;
      const maxAge = this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      
      if (age > maxAge) {
        await this.variantsRuns.delete(templateId);
        return null;
      }

      return variantsRun;
    } catch (error) {
      console.error('❌ [DB] Failed to get variants run:', error);
      return null;
    }
  }

  async invalidateVariantsRun(templateId: string): Promise<void> {
    try {
      await this.variantsRuns.delete(templateId);
      console.log('🗑️ [DB] Invalidated variants run:', templateId);
    } catch (error) {
      console.error('❌ [DB] Failed to invalidate variants run:', error);
    }
  }

  private async cleanOldestVariants(count: number): Promise<void> {
    try {
      const oldest = await this.variantsRuns
        .orderBy('timestamp')
        .limit(count)
        .toArray();
      
      await this.variantsRuns.bulkDelete(oldest.map(v => v.templateId));
      console.log(`🧹 [DB] Cleaned ${oldest.length} old variants runs`);
    } catch (error) {
      console.error('❌ [DB] Failed to clean old variants runs:', error);
    }
  }
}
