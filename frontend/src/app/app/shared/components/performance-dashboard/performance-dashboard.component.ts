import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatabaseService } from '../../../../core/services/db.service';
import { CacheMonitorService } from '../../../../core/services/cache-monitor.service';
import { trigger, transition, style, animate } from '@angular/animations';

interface CacheStats {
  templateCount: number;
  conversationCount: number;
  validLinksCount: number;
  screenshotCount: number;
  estimatedSizeMB: number;
}

interface StorageQuota {
  used: number;
  total: number;
  percentage: number;
  status: 'healthy' | 'warning' | 'critical';
}

@Component({
  selector: 'app-performance-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule
  ],
  templateUrl: './performance-dashboard.component.html',
  styleUrls: ['./performance-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-10px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ]),
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(-20px)', opacity: 0 }),
        animate('400ms ease-out', style({ transform: 'translateX(0)', opacity: 1 }))
      ])
    ])
  ]
})
export class PerformanceDashboardComponent implements OnInit, OnDestroy {
  cacheStats: CacheStats | null = null;
  storageQuota: StorageQuota | null = null;
  
  showClearWarning = false;
  isClearing = false;
  
  private refreshInterval?: any;
  readonly MAX_CACHE_SIZE_MB = 250;      // Increased from 50
  readonly MAX_TEMPLATES = 500;          // Increased from 50
  readonly MAX_CONVERSATIONS = 1000;     // Increased from 100
  readonly CACHE_EXPIRY_DAYS = 30;       // Increased from 7

  constructor(
    private dialogRef: MatDialogRef<PerformanceDashboardComponent>,
    private db: DatabaseService,
    private cacheMonitor: CacheMonitorService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    await this.loadStats();
    
    // Refresh stats every 30 seconds while dashboard is open
    this.refreshInterval = setInterval(() => {
      this.loadStats();
    }, 30000); // 30 seconds
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async loadStats() {
    try {
      // Get cache statistics
      this.cacheStats = await this.db.getCacheStats();
      
      // Get storage quota
      this.storageQuota = await this.cacheMonitor.checkStorageQuota();
      
      this.cdr.markForCheck();
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  get cacheHealthStatus(): 'healthy' | 'warning' | 'critical' {
    if (!this.cacheStats) return 'healthy';
    
    if (this.cacheStats.estimatedSizeMB > this.MAX_CACHE_SIZE_MB * 0.9) {
      return 'critical';
    }
    
    if (this.cacheStats.estimatedSizeMB > this.MAX_CACHE_SIZE_MB * 0.7 ||
        this.cacheStats.templateCount > this.MAX_TEMPLATES * 0.8 ||
        this.cacheStats.conversationCount > this.MAX_CONVERSATIONS * 0.8) {
      return 'warning';
    }
    
    return 'healthy';
  }

  get cacheHealthColor(): string {
    const status = this.cacheHealthStatus;
    return status === 'critical' ? '#ef4444' : 
           status === 'warning' ? '#f59e0b' : 
           '#10b981';
  }

  get storagePercentage(): number {
    return this.storageQuota?.percentage || 0;
  }

  get storageColor(): string {
    const pct = this.storagePercentage;
    return pct > 90 ? '#ef4444' : 
           pct > 70 ? '#f59e0b' : 
           '#10b981';
  }

  get templatePercentage(): number {
    if (!this.cacheStats) return 0;
    return (this.cacheStats.templateCount / this.MAX_TEMPLATES) * 100;
  }

  get conversationPercentage(): number {
    if (!this.cacheStats) return 0;
    return (this.cacheStats.conversationCount / this.MAX_CONVERSATIONS) * 100;
  }

  get cacheSizePercentage(): number {
    if (!this.cacheStats) return 0;
    return (this.cacheStats.estimatedSizeMB / this.MAX_CACHE_SIZE_MB) * 100;
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + ' MB';
  }

  showClearConfirmation() {
    this.showClearWarning = true;
    this.cdr.markForCheck();
  }

  cancelClear() {
    this.showClearWarning = false;
    this.cdr.markForCheck();
  }

  async confirmClearCache() {
    this.isClearing = true;
    this.cdr.markForCheck();
    
    try {
      await this.db.clearAllCache();
      
      // Reload stats
      await this.loadStats();
      
      this.showClearWarning = false;
      this.isClearing = false;
      
      this.cdr.markForCheck();
    } catch (error) {
      console.error('❌ Failed to clear cache:', error);
      this.isClearing = false;
      this.cdr.markForCheck();
    }
  }

  close() {
    this.dialogRef.close();
  }
}
