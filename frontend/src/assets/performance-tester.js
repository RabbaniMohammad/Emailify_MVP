/**
 * 🔬 Performance Testing Helper
 * Run this in browser console to get detailed performance insights
 */

// ============================================
// QUICK PERFORMANCE TESTS
// ============================================

window.runQuickTests = function() {
  console.log('%c🔬 Running Quick Performance Tests...', 'color: #00ff00; font-size: 16px; font-weight: bold');
  // Test 1: Check if profiler is loaded
  console.log('%c1️⃣ Profiler Status', 'color: #00bfff; font-size: 14px');
  const hasProfiler = window.hasOwnProperty('showPerformanceReport');
  if (!hasProfiler) {
    return;
  }
  
  // Test 2: Current performance state
  console.log('%c2️⃣ Current Performance Metrics', 'color: #00bfff; font-size: 14px');
  const metricsJSON = window.exportPerformanceMetrics();
  
  if (!metricsJSON) {
    return;
  }
  
  const metrics = JSON.parse(metricsJSON);
  // Test 3: Check for heavy operations
  console.log('%c3️⃣ Heavy Operations (> 100ms)', 'color: #00bfff; font-size: 14px');
  
  const heavyOps = metrics.operations.filter(op => op.duration > 100);
  if (heavyOps.length === 0) {
  } else {
    heavyOps.forEach(op => {
    });
  }
  
  // Test 4: Category breakdown
  console.log('%c4️⃣ Category Breakdown', 'color: #00bfff; font-size: 14px');
  Object.entries(metrics.byCategory).forEach(([category, stats]) => {
    const avg = stats.count > 0 ? (stats.total / stats.count).toFixed(1) : 0;
  });
  
  // Test 5: Memory check
  console.log('%c5️⃣ Memory Usage', 'color: #00bfff; font-size: 14px');
  if (performance.memory) {
    const usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
    const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
    const percentUsed = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
    if (percentUsed > 80) {
    } else if (percentUsed > 50) {
    } else {
    }
  } else {
  }
  
  // Test 6: Recommendations
  console.log('%c💡 Recommendations', 'color: #ffa500; font-size: 14px');
  
  const recommendations = [];
  
  if (heavyOps.length > 0) {
    recommendations.push('Optimize heavy operations (see list above)');
  }
  
  const apiOps = metrics.operations.filter(op => op.category === 'api');
  const slowApis = apiOps.filter(op => op.duration > 1000);
  if (slowApis.length > 0) {
    recommendations.push(`${slowApis.length} API calls > 1s - check backend performance`);
  }
  
  const cacheOps = metrics.byCategory.cache;
  if (cacheOps && cacheOps.count > 50) {
    recommendations.push('High cache operation count - consider batching');
  }
  
  if (recommendations.length === 0) {
  } else {
    recommendations.forEach((rec, i) => {
    });
  }
  console.log('%c📊 Full Report', 'color: #00ff00; font-size: 14px');
  console.log('%c🔄 To reset metrics and test again:', 'color: #ffa500; font-size: 14px');
};

// ============================================
// PAGE-SPECIFIC TESTS
// ============================================

window.testCurrentPage = function() {
  const path = window.location.pathname;
  console.log(`%c🔬 Testing Current Page: ${path}`, 'color: #00ff00; font-size: 16px; font-weight: bold');
  clearPerformanceMetrics();
  
  if (path.includes('/templates')) {
    console.log('%c📋 Templates Page Test', 'color: #00bfff; font-size: 14px');
  } else if (path.includes('/generate')) {
    console.log('%c✨ Generate Page Test', 'color: #00bfff; font-size: 14px');
  } else if (path.includes('/qa')) {
    console.log('%c🧪 QA Page Test', 'color: #00bfff; font-size: 14px');
  } else {
    console.log('%cℹ️ General Test', 'color: #00bfff; font-size: 14px');
  }
};

// ============================================
// HELPER: Find Bottlenecks
// ============================================

window.findBottlenecks = function() {
  const metricsJSON = window.exportPerformanceMetrics();
  
  if (!metricsJSON) {
    return;
  }
  
  const metrics = JSON.parse(metricsJSON);
  
  console.log('%c🔍 Bottleneck Analysis', 'color: #ff0000; font-size: 16px; font-weight: bold');
  // Slowest operations
  const sorted = [...metrics.operations].sort((a, b) => b.duration - a.duration);
  const top5 = sorted.slice(0, 5);
  
  console.log('%c⏱️ Top 5 Slowest Operations:', 'color: #ff6b6b; font-size: 14px');
  top5.forEach((op, i) => {
    const emoji = op.duration > 200 ? '🔴' : op.duration > 100 ? '🟡' : '🟢';
    if (op.metadata) {
    }
  });
  // Category analysis
  console.log('%c📊 Category Performance:', 'color: #00bfff; font-size: 14px');
  const catArray = Object.entries(metrics.byCategory)
    .map(([name, stats]) => ({
      name,
      ...stats,
      avg: stats.count > 0 ? stats.total / stats.count : 0
    }))
    .sort((a, b) => b.total - a.total);
  
  catArray.forEach(cat => {
    const emoji = cat.avg > 100 ? '🔴' : cat.avg > 50 ? '🟡' : '🟢';
  });
  // Actionable insights
  console.log('%c💡 Actionable Insights:', 'color: #ffa500; font-size: 14px');
  
  const insights = [];
  
  // Check for slow API calls
  const slowApis = metrics.operations.filter(op => op.category === 'api' && op.duration > 1000);
  if (slowApis.length > 0) {
    insights.push(`⚠️ ${slowApis.length} slow API calls detected (> 1s)`);
    insights.push(`   → Check backend performance and add caching`);
  }
  
  // Check for heavy computations
  const heavyComp = metrics.operations.filter(op => op.category === 'computation' && op.duration > 200);
  if (heavyComp.length > 0) {
    insights.push(`⚠️ ${heavyComp.length} heavy computations detected (> 200ms)`);
    insights.push(`   → Consider Web Workers or algorithm optimization`);
  }
  
  // Check for excessive cache operations
  if (metrics.byCategory.cache && metrics.byCategory.cache.count > 100) {
    insights.push(`⚠️ High cache operation count: ${metrics.byCategory.cache.count}`);
    insights.push(`   → Batch cache writes and add debouncing`);
  }
  
  // Check for slow renders
  const slowRenders = metrics.operations.filter(op => op.category === 'render' && op.duration > 100);
  if (slowRenders.length > 0) {
    insights.push(`⚠️ ${slowRenders.length} slow render operations (> 100ms)`);
    insights.push(`   → Check for unnecessary change detection or DOM manipulation`);
  }
  
  if (insights.length === 0) {
  } else {
    insights.forEach(insight => console.log(`   ${insight}`));
  }
};

// ============================================
// AUTO-RUN ON LOAD
// ============================================

console.log('%c🎯 Performance Testing Tools Loaded!', 'color: #00ff00; font-size: 18px; font-weight: bold');
console.log('%cAvailable Commands:', 'color: #00bfff; font-size: 14px');
console.log('%c💡 Quick Start:', 'color: #ffa500; font-size: 14px');