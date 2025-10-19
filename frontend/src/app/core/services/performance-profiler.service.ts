// Performance Profiling Service
// Use this to track heavy computations and find bottlenecks

import { Injectable } from '@angular/core';

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  category: 'render' | 'api' | 'computation' | 'cache' | 'navigation';
  metadata?: any;
}

interface PerformanceReport {
  totalMetrics: number;
  avgDuration: number;
  slowest: PerformanceMetric[];
  byCategory: Record<string, { count: number; avgDuration: number; totalDuration: number }>;
  heavyOperations: PerformanceMetric[];
}

@Injectable({ providedIn: 'root' })
export class PerformanceProfilerService {
  private metrics: PerformanceMetric[] = [];
  private readonly MAX_METRICS = 1000;
  private readonly HEAVY_THRESHOLD_MS = 100; // Operations > 100ms are "heavy"
  private enabled = !this.isProduction();

  constructor() {
    if (this.enabled) {
    }
  }

  /**
   * Track a synchronous operation
   */
  track<T>(
    name: string,
    operation: () => T,
    category: PerformanceMetric['category'] = 'computation',
    metadata?: any
  ): T {
    if (!this.enabled) return operation();

    const startMark = `${name}-start`;
    const endMark = `${name}-end`;
    const measureName = `${name}-measure`;

    performance.mark(startMark);
    const result = operation();
    performance.mark(endMark);
    
    try {
      performance.measure(measureName, startMark, endMark);
      const measure = performance.getEntriesByName(measureName)[0];
      
      this.recordMetric({
        name,
        duration: measure.duration,
        timestamp: Date.now(),
        category,
        metadata
      });

      // Cleanup
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(measureName);
    } catch (e) {
      // Silently ignore measurement errors
    }

    return result;
  }

  /**
   * Track an async operation
   */
  async trackAsync<T>(
    name: string,
    operation: () => Promise<T>,
    category: PerformanceMetric['category'] = 'api',
    metadata?: any
  ): Promise<T> {
    if (!this.enabled) return operation();

    const start = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - start;
      
      this.recordMetric({
        name,
        duration,
        timestamp: Date.now(),
        category,
        metadata
      });

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric({
        name: `${name} (ERROR)`,
        duration,
        timestamp: Date.now(),
        category,
        metadata: { ...metadata, error: error instanceof Error ? error.message : 'Unknown error' }
      });
      throw error;
    }
  }

  /**
   * Start a manual timer (for complex flows)
   */
  startTimer(name: string): () => void {
    if (!this.enabled) return () => {};

    const start = performance.now();
    return (category: PerformanceMetric['category'] = 'computation', metadata?: any) => {
      const duration = performance.now() - start;
      this.recordMetric({
        name,
        duration,
        timestamp: Date.now(),
        category,
        metadata
      });
    };
  }

  /**
   * Record a metric manually
   */
  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Warn about heavy operations
    if (metric.duration > this.HEAVY_THRESHOLD_MS) {
    }

    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  /**
   * Get performance report
   */
  getReport(): PerformanceReport {
    if (this.metrics.length === 0) {
      return {
        totalMetrics: 0,
        avgDuration: 0,
        slowest: [],
        byCategory: {},
        heavyOperations: []
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const avgDuration = totalDuration / this.metrics.length;

    // Group by category
    const byCategory: Record<string, { count: number; avgDuration: number; totalDuration: number }> = {};
    this.metrics.forEach(m => {
      if (!byCategory[m.category]) {
        byCategory[m.category] = { count: 0, avgDuration: 0, totalDuration: 0 };
      }
      byCategory[m.category].count++;
      byCategory[m.category].totalDuration += m.duration;
    });

    // Calculate averages
    Object.keys(byCategory).forEach(cat => {
      byCategory[cat].avgDuration = byCategory[cat].totalDuration / byCategory[cat].count;
    });

    // Find slowest operations
    const slowest = [...this.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    // Find heavy operations
    const heavyOperations = this.metrics.filter(m => m.duration > this.HEAVY_THRESHOLD_MS);

    return {
      totalMetrics: this.metrics.length,
      avgDuration,
      slowest,
      byCategory,
      heavyOperations
    };
  }

  /**
   * Display report in console
   */
  displayReport(): void {
    if (!this.enabled) {
      return;
    }

    const report = this.getReport();

    Object.entries(report.byCategory).forEach(([category, stats]) => {
    });

    report.slowest.forEach((m, i) => {
    });

    if (report.heavyOperations.length > 0) {
      report.heavyOperations
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .forEach((m, i) => {
        });
    }

  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify(this.getReport(), null, 2);
  }

  /**
   * Check if running in production
   */
  private isProduction(): boolean {
    return (window as any)['environment']?.production === true;
  }

  /**
   * Get current memory usage (if available)
   */
  getMemoryUsage(): { used: number; total: number; limit: number } | null {
    const memory = (performance as any).memory;
    if (memory) {
      return {
        used: memory.usedJSHeapSize / 1024 / 1024, // MB
        total: memory.totalJSHeapSize / 1024 / 1024, // MB
        limit: memory.jsHeapSizeLimit / 1024 / 1024 // MB
      };
    }
    return null;
  }

  /**
   * Track component lifecycle
   */
  trackComponentInit(componentName: string): () => void {
    return this.startTimer(`Component: ${componentName} init`);
  }

  /**
   * Track API calls
   */
  trackApiCall(endpoint: string, method: string = 'GET'): (status: number, size?: number) => void {
    const start = performance.now();
    return (status: number, size?: number) => {
      const duration = performance.now() - start;
      this.recordMetric({
        name: `API: ${method} ${endpoint}`,
        duration,
        timestamp: Date.now(),
        category: 'api',
        metadata: { status, size: size ? `${(size / 1024).toFixed(2)}KB` : undefined }
      });
    };
  }
}

// Global function to display report (call from browser console)
(window as any).showPerformanceReport = function() {
  const profiler = (window as any)['performanceProfiler'];
  if (profiler) {
    profiler.displayReport();
  } else {
    console.error('Performance profiler not available');
  }
};

(window as any).clearPerformanceMetrics = function() {
  const profiler = (window as any)['performanceProfiler'];
  if (profiler) {
    profiler.clear();
  }
};

(window as any).exportPerformanceMetrics = function() {
  const profiler = (window as any)['performanceProfiler'];
  if (profiler) {
    const json = profiler.exportMetrics();
    // Copy to clipboard
    navigator.clipboard?.writeText(json).then(() => {
    });
  }
};
