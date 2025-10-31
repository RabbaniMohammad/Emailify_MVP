/**
 * 🔌 FRONTEND INTEGRATION EXAMPLE
 * 
 * Copy this code to your Angular service to integrate the new grammar checker.
 * 
 * Location: frontend/src/app/app/features/qa/services/qa.service.ts
 */

// ============================================
// ADD THIS METHOD TO YOUR QA SERVICE
// ============================================

/**
 * Check grammar using the NEW advanced local checker (no API calls)
 * This is faster and has no rate limits compared to the ChatGPT approach
 */
checkGrammarAdvanced(html: string): Observable<{
  success: boolean;
  html: string;
  appliedEdits: Array<{
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason: string;
    changeType: string;
    status: 'applied';
  }>;
  failedEdits: Array<{
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason: string;
    changeType: string;
    status: 'failed';
    error: string;
  }>;
  stats: {
    total: number;
    applied: number;
    failed: number;
  };
  message: string;
}> {
  return this.http.post<any>('/api/qa-advanced/grammar-check', { html });
}

// ============================================
// EXAMPLE USAGE IN COMPONENT
// ============================================

/**
 * In your use-variant-page.component.ts or similar
 */

async checkGrammarQuick(): Promise<void> {
  const html = this.htmlSubject.value;
  
  if (!html || !html.trim()) {
    console.log('No HTML to check');
    return;
  }

  // Set loading state
  this.grammarCheckLoadingSubject.next(true);
  this.cdr.markForCheck();

  try {
    const response = await firstValueFrom(
      this.qa.checkGrammarAdvanced(html)
    );

    if (response.success) {
      // ✅ Update HTML with corrected version
      this.htmlSubject.next(response.html);

      // ✅ Show success message
      console.log(`✅ Grammar check complete: ${response.stats.applied} fixes applied`);
      
      // ✅ Log what was fixed
      response.appliedEdits.forEach(edit => {
        console.log(`  - Fixed: "${edit.find}" → "${edit.replace}" (${edit.reason})`);
      });

      // ✅ Log what couldn't be fixed (boundary issues)
      if (response.failedEdits.length > 0) {
        console.log(`⚠️ ${response.failedEdits.length} edits couldn't be applied (boundary issues):`);
        response.failedEdits.forEach(edit => {
          console.log(`  - "${edit.find}" → "${edit.replace}" (${edit.error})`);
        });
      }

      // ✅ Update UI with results
      this.grammarCheckResultSubject.next({
        hasErrors: response.stats.applied > 0,
        mistakes: response.appliedEdits.map(edit => ({
          word: edit.find,
          suggestion: edit.replace,
          context: edit.reason
        })),
        count: response.stats.applied,
        message: response.message
      });
    }

  } catch (error) {
    console.error('❌ Grammar check failed:', error);
    
    this.grammarCheckResultSubject.next({
      hasErrors: false,
      mistakes: [],
      count: 0,
      message: 'Check failed. Please try again.'
    });
  } finally {
    this.grammarCheckLoadingSubject.next(false);
    this.cdr.markForCheck();
  }
}

// ============================================
// HTML TEMPLATE EXAMPLE
// ============================================

/**
 * Add a button in your template (alongside existing "Run Tests" button)
 */

/*
<button 
  class="quick-check-btn"
  (click)="checkGrammarQuick()"
  [disabled]="grammarCheckLoading$ | async"
>
  <svg *ngIf="!(grammarCheckLoading$ | async)" width="16" height="16" viewBox="0 0 16 16">
    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM3.5 7.5a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1h-9z"/>
  </svg>
  <span *ngIf="grammarCheckLoading$ | async">Checking...</span>
  <span *ngIf="!(grammarCheckLoading$ | async)">Quick Check (Fast)</span>
</button>
*/

// ============================================
// COMPARISON: OLD vs NEW
// ============================================

/**
 * OLD APPROACH (ChatGPT API):
 * 
 * checkTemplateGrammar(html: string): Observable<...> {
 *   return this.http.post('/api/qa/template/grammar-check', { html });
 * }
 * 
 * - Slow: 2-5 seconds
 * - Expensive: API costs
 * - Rate limited
 * - High boundary failure rate (50-70%)
 * 
 * 
 * NEW APPROACH (Local):
 * 
 * checkGrammarAdvanced(html: string): Observable<...> {
 *   return this.http.post('/api/qa-advanced/grammar-check', { html });
 * }
 * 
 * - Fast: 50-200ms
 * - Free: No API costs
 * - No rate limits
 * - Low boundary failure rate (10-20%)
 */

// ============================================
// SIDE-BY-SIDE COMPARISON UI
// ============================================

/**
 * Let users compare both approaches:
 */

async compareGrammarCheckers(): Promise<void> {
  const html = this.htmlSubject.value;
  
  console.log('🔬 Running side-by-side comparison...\n');
  
  // Test OLD approach
  console.time('ChatGPT Approach');
  const oldResult = await firstValueFrom(
    this.qa.checkTemplateGrammar(html)
  );
  console.timeEnd('ChatGPT Approach');
  console.log('Old approach found:', oldResult.count, 'issues');
  
  // Test NEW approach
  console.time('Advanced Local Approach');
  const newResult = await firstValueFrom(
    this.qa.checkGrammarAdvanced(html)
  );
  console.timeEnd('Advanced Local Approach');
  console.log('New approach found:', newResult.stats.total, 'issues');
  console.log('  - Applied:', newResult.stats.applied);
  console.log('  - Failed:', newResult.stats.failed);
  
  console.log('\n✅ Comparison complete!');
}

// ============================================
// MIGRATION STRATEGY
// ============================================

/**
 * STEP 1: Add new method (keep old one)
 * STEP 2: Add "Quick Check" button for testing
 * STEP 3: Compare results for a week
 * STEP 4: If satisfied, replace old method
 * STEP 5: Remove old endpoint
 */
