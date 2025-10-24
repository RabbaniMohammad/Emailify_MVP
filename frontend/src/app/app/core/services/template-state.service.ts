import { Injectable, inject } from '@angular/core';
import { DebugLoggerService } from './debug-logger.service';

/**
 * Template State Management Service
 * 
 * Manages synchronization of template states across:
 * - Home page (Run Tests)
 * - QA page (Original Template view)
 * - Visual Editor (Edit mode)
 * 
 * State Flow:
 * 1. temp_1 (original) -> Run Tests -> QA page shows temp_1
 * 2. Edit in Visual Editor -> temp_1 becomes temp_edit
 * 3. All edits persist across refresh/navigation
 * 4. Check Preview -> temp_edit replaces temp_1 in QA view
 * 5. Back to home -> Run Tests -> resets to temp_1
 */
@Injectable({
  providedIn: 'root'
})
export class TemplateStateService {
  private debugLogger = inject(DebugLoggerService);
  
  // Storage Keys
  private readonly PREFIX = 'template_state_';
  private readonly ORIGINAL_KEY = (id: string) => `${this.PREFIX}${id}_original`;
  private readonly EDITED_KEY = (id: string) => `${this.PREFIX}${id}_edited`;
  private readonly EDITOR_PROGRESS_KEY = (id: string) => `${this.PREFIX}${id}_editor_progress`;
  private readonly STATE_FLAG_KEY = (id: string) => `${this.PREFIX}${id}_state_flag`;
  private readonly LAST_RUN_TESTS_KEY = (id: string) => `${this.PREFIX}${id}_last_run_tests`;
  private readonly EDITING_CONTEXT_KEY = (id: string) => `${this.PREFIX}${id}_editing_context`;
  private readonly TRUE_ORIGINAL_KEY = (id: string) => `${this.PREFIX}${id}_true_original`; // Preserve real original during variant editing

  /**
   * Initialize template state when "Run Tests" is clicked
   * This clears any edited state and sets original template
   */
  initializeOriginalTemplate(templateId: string, originalHtml: string): void {
    console.log('🎯 [TemplateState] Initializing for ORIGINAL template:', templateId);
    
    // 📝 DEBUG LOG
    this.debugLogger.logTemplateState('initializeOriginalTemplate', templateId, {
      htmlLength: originalHtml.length,
      action: 'Starting initialization'
    });
    
    // Set the context for what is being edited
    const context = { type: 'original' };
    localStorage.setItem(this.EDITING_CONTEXT_KEY(templateId), JSON.stringify(context));
    this.debugLogger.logStorage('SET', this.EDITING_CONTEXT_KEY(templateId), context);

    // Save original template
    localStorage.setItem(this.ORIGINAL_KEY(templateId), originalHtml);
    this.debugLogger.logStorage('SET', this.ORIGINAL_KEY(templateId), { length: originalHtml.length });
    
    // ✅ CRITICAL FIX: Clear ONLY original template editing state
    // NOTE: We do NOT clear golden template keys - they must remain isolated!
    const keysToRemove = [
      this.EDITED_KEY(templateId),
      this.EDITOR_PROGRESS_KEY(templateId),
      this.TRUE_ORIGINAL_KEY(templateId),
      `visual_editor_${templateId}_return_flag`,
      `visual_editor_${templateId}_edited_html`
    ];
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      this.debugLogger.logStorage('REMOVE', key);
    });
    
    console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');
    this.debugLogger.logTemplateState('clearedState', templateId, { keysCleared: keysToRemove.length });
    
    // Set state flag to 'original'
    localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'original');
    this.debugLogger.logStorage('SET', this.STATE_FLAG_KEY(templateId), 'original');
    
    // Mark the timestamp of run tests
    localStorage.setItem(this.LAST_RUN_TESTS_KEY(templateId), Date.now().toString());
    
    console.log('✅ [TemplateState] Initialized with original template');
    this.debugLogger.logTemplateState('initializeOriginalTemplate', templateId, {
      status: 'complete',
      stateFlag: 'original'
    });
  }
  
  /**
   * NEW: Initialize state for editing a specific VARIANT.
   */
  initializeVariantForEditing(templateId: string, runId: string, variantNo: number, variantHtml: string): void {
    console.log(`🎯 [TemplateState] Initializing for VARIANT ${variantNo} in run ${runId}`);

    // CRITICAL: Save the TRUE original template before we overwrite anything
    const currentOriginal = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    if (currentOriginal) {
      console.log('💾 [TemplateState] Preserving TRUE original template (length:', currentOriginal.length, ')');
      localStorage.setItem(this.TRUE_ORIGINAL_KEY(templateId), currentOriginal);
    }

    // Set the context for what is being edited
    const context = { type: 'variant', runId, variantNo };
    localStorage.setItem(this.EDITING_CONTEXT_KEY(templateId), JSON.stringify(context));

    // Use the variant's HTML as the "original" for this editing session
    localStorage.setItem(this.ORIGINAL_KEY(templateId), variantHtml);

    // ✅ CRITICAL FIX: Clear ALL previous editing state to prevent leakage
    localStorage.removeItem(this.EDITED_KEY(templateId));
    localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));
    
    // ✅ CRITICAL FIX: Also clear visual editor progress and golden keys
    localStorage.removeItem(`visual_editor_${templateId}_progress`);
    localStorage.removeItem(`visual_editor_${templateId}_golden_html`);
    localStorage.removeItem(`visual_editor_${templateId}_snapshot_html`);
    localStorage.removeItem(`visual_editor_${templateId}_failed_edits`);
    localStorage.removeItem(`visual_editor_${templateId}_original_stats`);
    
    console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');

    // Set state flag to 'original' (relative to the variant)
    localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'original');

    console.log('✅ [TemplateState] Initialized with variant template');
  }

  /**
   * NEW: Initialize state for editing the GOLDEN TEMPLATE.
   */
  initializeGoldenForEditing(templateId: string, goldenHtml: string): void {
    console.log(`🎯 [TemplateState] Initializing for GOLDEN template`);
    
    // 📝 DEBUG LOG
    this.debugLogger.logTemplateState('initializeGoldenForEditing', templateId, {
      htmlLength: goldenHtml.length,
      action: 'Starting golden initialization'
    });

    // CRITICAL: Save the TRUE original template before we overwrite anything
    const currentOriginal = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    if (currentOriginal) {
      console.log('💾 [TemplateState] Preserving TRUE original template (length:', currentOriginal.length, ')');
      localStorage.setItem(this.TRUE_ORIGINAL_KEY(templateId), currentOriginal);
      this.debugLogger.logStorage('SET', this.TRUE_ORIGINAL_KEY(templateId), { 
        length: currentOriginal.length,
        reason: 'Preserving original before golden edit'
      });
    }

    // Set the context for what is being edited
    const context = { type: 'golden' };
    localStorage.setItem(this.EDITING_CONTEXT_KEY(templateId), JSON.stringify(context));
    this.debugLogger.logStorage('SET', this.EDITING_CONTEXT_KEY(templateId), context);

    // Use the golden template's HTML as the "original" for this editing session
    localStorage.setItem(this.ORIGINAL_KEY(templateId), goldenHtml);
    this.debugLogger.logStorage('SET', this.ORIGINAL_KEY(templateId), { 
      length: goldenHtml.length,
      note: 'Golden HTML stored as "original" for this editing session'
    });

    // ✅ CRITICAL FIX: Clear ALL previous editing state to prevent leakage from original template edits
    // NOTE: We do NOT clear visual_editor_${templateId}_golden_html because we just saved it above!
    const keysToRemove = [
      this.EDITED_KEY(templateId),
      this.EDITOR_PROGRESS_KEY(templateId),
      `visual_editor_${templateId}_progress`
    ];
    
    keysToRemove.forEach(key => {
      const hadValue = !!localStorage.getItem(key);
      localStorage.removeItem(key);
      this.debugLogger.logStorage('REMOVE', key, { 
        hadValue,
        reason: 'Preventing leakage from previous edits'
      });
      if (hadValue) {
        console.log(`🧹 [TemplateState] Removed old data from key: ${key}`);
      }
    });
    
    console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');
    this.debugLogger.logTemplateState('clearedState', templateId, { 
      keysCleared: keysToRemove.length,
      context: 'golden'
    });

    // Set state flag to 'original' (relative to the golden)
    localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'original');
    this.debugLogger.logStorage('SET', this.STATE_FLAG_KEY(templateId), 'original');

    console.log('✅ [TemplateState] Initialized with golden template');
    this.debugLogger.logTemplateState('initializeGoldenForEditing', templateId, {
      status: 'complete',
      stateFlag: 'original',
      context: 'golden'
    });
  }

  /**
   * NEW: Get the current editing context (original, variant, or golden).
   */
  getEditingContext(templateId: string): { type: 'original' } | { type: 'variant', runId: string, variantNo: number } | { type: 'golden' } | null {
    const contextJson = localStorage.getItem(this.EDITING_CONTEXT_KEY(templateId));
    if (contextJson) {
      try {
        return JSON.parse(contextJson);
      } catch (e) {
        console.error('❌ [TemplateState] Failed to parse editing context:', e);
        return null;
      }
    }
    return null;
  }

  /**
   * NEW: Get the TRUE original template (preserved during variant editing).
   * This returns the real temp_1, not the variant HTML.
   */
  getTrueOriginalTemplate(templateId: string): string | null {
    const trueOriginal = localStorage.getItem(this.TRUE_ORIGINAL_KEY(templateId));
    if (trueOriginal) {
      console.log('✅ [TemplateState] Retrieved TRUE original template (length:', trueOriginal.length, ')');
      return trueOriginal;
    }
    // Fallback to regular original if true_original doesn't exist
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    if (original) {
      console.log('✅ [TemplateState] Retrieved original template (length:', original.length, ')');
      return original;
    }
    console.log('⚠️ [TemplateState] No original template found');
    return null;
  }
  
  /**
   * Get the current template that should be displayed in QA page
   * Returns edited version if exists, otherwise returns original
   */
  getCurrentTemplate(templateId: string): string | null {
    console.log('🔍 [TemplateState] Getting current template for:', templateId);
    
    // Check editing context to determine where to look for the template
    const context = this.getEditingContext(templateId);
    console.log('🔍 [TemplateState] Editing context:', context);
    
    // ✅ FIX: Also check editing mode flag (for backwards compatibility)
    const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
    console.log('🔍 [TemplateState] Editing mode flag:', editingMode);
    
    // If editing golden template, get from golden key (check both context and mode)
    if (context?.type === 'golden' || editingMode === 'golden') {
      const goldenHtml = localStorage.getItem(`visual_editor_${templateId}_golden_html`);
      console.log('🔍 [TemplateState] Looking for golden HTML:', !!goldenHtml);
      if (goldenHtml) {
        console.log('✅ [TemplateState] Returning GOLDEN template (edited)');
        console.log('   - Length:', goldenHtml.length);
        console.log('   - Preview (first 100 chars):', goldenHtml.substring(0, 100));
        return goldenHtml;
      } else {
        console.warn('⚠️ [TemplateState] Golden editing mode detected but no golden HTML found!');
      }
    }
    
    // For original/variant editing, check edited version
    const edited = localStorage.getItem(this.EDITED_KEY(templateId));
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    
    console.log('   - Has edited version:', !!edited);
    console.log('   - Has original version:', !!original);
    
    // If edited exists, return it (temp_edit)
    if (edited) {
      console.log('✅ [TemplateState] Returning EDITED template (temp_edit)');
      return edited;
    }
    
    // Otherwise return original (temp_1)
    if (original) {
      console.log('✅ [TemplateState] Returning ORIGINAL template (temp_1)');
      return original;
    }
    
    console.log('⚠️ [TemplateState] No template found');
    return null;
  }
  
  /**
   * Get template for visual editor to load
   * Priority order:
   * 1. Golden template (if editing golden)
   * 2. Editor progress (if continuing edits)
   * 3. Edited template
   * 4. Original template
   */
  getTemplateForEditor(templateId: string): string | null {
    console.log('🟦🟦🟦 [TemplateState] getTemplateForEditor() called for ID:', templateId);
    
    // 📝 DEBUG LOG - Start
    this.debugLogger.logTemplateState('getTemplateForEditor', templateId, {
      action: 'Starting template load for visual editor'
    });
    
    // ✅ CRITICAL: Check if we're editing GOLDEN template
    const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
    console.log('🟦 [TemplateState] Editing mode:', editingMode);
    this.debugLogger.logStorage('GET', `visual_editor_${templateId}_editing_mode`, { value: editingMode });
    
    if (editingMode === 'golden') {
      console.log('🟦 [TemplateState] Editing mode is GOLDEN, checking for golden HTML...');
      this.debugLogger.logTemplateState('checkingGoldenHtml', templateId, { editingMode });
      
      const goldenHtml = localStorage.getItem(`visual_editor_${templateId}_golden_html`);
      
      if (goldenHtml) {
        console.log('✅✅✅ [TemplateState] Found GOLDEN HTML in localStorage!');
        console.log('🟦 [TemplateState] Golden HTML length:', goldenHtml.length);
        console.log('🟦 [TemplateState] Golden HTML preview:', goldenHtml.substring(0, 200));
        this.debugLogger.logTemplateState('foundGoldenHtml', templateId, {
          length: goldenHtml.length,
          preview: goldenHtml.substring(0, 200),
          returning: 'golden HTML'
        });
        return goldenHtml;
      } else {
        console.error('❌ [TemplateState] Editing mode is "golden" but no golden_html found in localStorage!');
        this.debugLogger.error('TEMPLATE_STATE', 'Golden mode but no golden HTML!', { templateId, editingMode });
      }
    }
    
    // Check editor progress first (in case of refresh during editing)
    const editorProgress = localStorage.getItem(this.EDITOR_PROGRESS_KEY(templateId));
    console.log('🟦 [TemplateState] Editor progress exists?', !!editorProgress);
    this.debugLogger.logStorage('GET', this.EDITOR_PROGRESS_KEY(templateId), { exists: !!editorProgress });
    
    if (editorProgress) {
      try {
        const parsed = JSON.parse(editorProgress);
        if (parsed.html) {
          console.log('✅ [TemplateState] Loading editor progress (temp_edit)');
          this.debugLogger.logTemplateState('foundEditorProgress', templateId, {
            htmlLength: parsed.html.length,
            cssLength: parsed.css?.length || 0,
            returning: 'editor progress'
          });
          return `<style>${parsed.css || ''}</style>${parsed.html}`;
        }
      } catch (e) {
        console.error('❌ [TemplateState] Failed to parse editor progress:', e);
        this.debugLogger.error('TEMPLATE_STATE', 'Failed to parse editor progress', { templateId, error: e });
      }
    }
    
    // Check edited version
    const edited = localStorage.getItem(this.EDITED_KEY(templateId));
    console.log('🟦 [TemplateState] Edited template exists?', !!edited);
    this.debugLogger.logStorage('GET', this.EDITED_KEY(templateId), { exists: !!edited });
    
    if (edited) {
      console.log('✅ [TemplateState] Loading edited template (temp_edit)');
      return edited;
    }
    
    // Fall back to original
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    console.log('🟦 [TemplateState] Original template exists?', !!original);
    
    if (original) {
      console.log('✅ [TemplateState] Loading original template (temp_1)');
      return original;
    }
    
    console.error('❌ [TemplateState] No template found anywhere!');
    return null;
  }
  
  /**
   * Save edited template (called by visual editor auto-save)
   * This updates temp_edit state
   */
  saveEditedTemplate(templateId: string, editedHtml: string, css?: string): void {
    console.log('💾 [TemplateState] Saving edited template:', templateId);
    console.log('   - HTML length:', editedHtml.length);
    
    const fullHtml = css ? `<style>${css}</style>${editedHtml}` : editedHtml;
    
    // Save edited version
    localStorage.setItem(this.EDITED_KEY(templateId), fullHtml);
    
    // Update state flag to 'edited'
    localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'edited');
    
    console.log('✅ [TemplateState] Saved edited template (temp_edit)');
  }
  
  /**
   * Save editor progress (auto-save during editing)
   * This is separate from edited template for finer control
   * 
   * ✅ CRITICAL: Routes to correct storage key based on editing mode
   */
  saveEditorProgress(templateId: string, html: string, css: string): void {
    console.log('💾 [TemplateState] saveEditorProgress called for:', templateId);
    
    // ✅ CRITICAL: Check BOTH editing context AND mode flag to route to correct storage
    const editingContext = this.getEditingContext(templateId);
    const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
    console.log('🔍 [TemplateState] Editing context:', editingContext);
    console.log('🔍 [TemplateState] Editing mode flag:', editingMode);
    
    // Check BOTH for maximum reliability (context is more reliable than flag)
    if (editingContext?.type === 'golden' || editingMode === 'golden') {
      // ✅ GOLDEN TEMPLATE: Save to golden-specific keys
      console.log('✅ [TemplateState] Saving GOLDEN template edits');
      const fullHtml = css ? `<style>${css}</style>${html}` : html;
      
      // Save to golden key (used by getCurrentTemplate)
      localStorage.setItem(`visual_editor_${templateId}_golden_html`, fullHtml);
      console.log('   - Saved to: visual_editor_' + templateId + '_golden_html');
      
      // Also save to edited_html key (used by check preview flow)
      localStorage.setItem(`visual_editor_${templateId}_edited_html`, fullHtml);
      console.log('   - Saved to: visual_editor_' + templateId + '_edited_html');
      
    } else {
      // ✅ ORIGINAL/VARIANT TEMPLATE: Save to standard keys
      console.log('✅ [TemplateState] Saving ORIGINAL/VARIANT template edits');
      const editorState = {
        html,
        css,
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(this.EDITOR_PROGRESS_KEY(templateId), JSON.stringify(editorState));
      console.log('   - Saved to:', this.EDITOR_PROGRESS_KEY(templateId));
      
      // Also update the edited template
      this.saveEditedTemplate(templateId, html, css);
    }
  }
  
  /**
   * Check if template has been edited
   */
  hasEdits(templateId: string): boolean {
    const stateFlag = localStorage.getItem(this.STATE_FLAG_KEY(templateId));
    const editingContext = this.getEditingContext(templateId);
    
    console.log('🔍 [hasEdits] templateId:', templateId);
    console.log('🔍 [hasEdits] stateFlag:', stateFlag);
    console.log('🔍 [hasEdits] editingContext:', editingContext);
    
    // Check if editing golden template
    if (editingContext?.type === 'golden') {
      const goldenHtml = localStorage.getItem(`visual_editor_${templateId}_golden_html`);
      const hasGoldenEdits = !!goldenHtml;
      console.log('🔍 [hasEdits] Golden template - has edits:', hasGoldenEdits);
      return hasGoldenEdits;
    }
    
    // For original/variant, check state flag
    const hasEdits = stateFlag === 'edited';
    console.log('🔍 [hasEdits] Original/variant - has edits:', hasEdits);
    return hasEdits;
  }
  
  /**
   * Get the original template (always temp_1)
   */
  getOriginalTemplate(templateId: string): string | null {
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    
    if (original) {
      console.log('📄 [TemplateState] Found original template in state');
      return original;
    }
    
    console.log('⚠️ [TemplateState] No original template in state');
    return null;
  }
  
  /**
   * Clear all template state for a given template ID
   * Used when user navigates away from template completely
   */
  clearTemplateState(templateId: string): void {
    console.log('🧹 [TemplateState] Clearing template state:', templateId);
    
    localStorage.removeItem(this.ORIGINAL_KEY(templateId));
    localStorage.removeItem(this.EDITED_KEY(templateId));
    localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));
    localStorage.removeItem(this.STATE_FLAG_KEY(templateId));
    localStorage.removeItem(this.LAST_RUN_TESTS_KEY(templateId));
    localStorage.removeItem(this.EDITING_CONTEXT_KEY(templateId)); // Also clear context
    
    console.log('✅ [TemplateState] Cleared template state');
  }
  
  /**
   * Check if this is a fresh "Run Tests" action
   * Used to determine if we should reset to original
   */
  isNewTestRun(templateId: string, currentTimestamp: number): boolean {
    const lastRunTests = localStorage.getItem(this.LAST_RUN_TESTS_KEY(templateId));
    
    if (!lastRunTests) {
      return true; // First run
    }
    
    const lastTimestamp = parseInt(lastRunTests, 10);
    
    // If current timestamp is newer than last run tests, it's a new run
    return currentTimestamp > lastTimestamp;
  }
  
  /**
   * Get current state of template
   */
  getState(templateId: string): 'original' | 'edited' | 'unknown' {
    const stateFlag = localStorage.getItem(this.STATE_FLAG_KEY(templateId));
    
    if (stateFlag === 'original') return 'original';
    if (stateFlag === 'edited') return 'edited';
    
    return 'unknown';
  }
  
  /**
   * Debug: Log all state for a template
   */
  debugState(templateId: string): void {
    console.log('🐛 [TemplateState] Debug state for:', templateId);
    console.log('   - State:', this.getState(templateId));
    console.log('   - Context:', this.getEditingContext(templateId));
    console.log('   - Has original:', !!localStorage.getItem(this.ORIGINAL_KEY(templateId)));
    console.log('   - Has edited:', !!localStorage.getItem(this.EDITED_KEY(templateId)));
    console.log('   - Has editor progress:', !!localStorage.getItem(this.EDITOR_PROGRESS_KEY(templateId)));
    console.log('   - Last run tests:', localStorage.getItem(this.LAST_RUN_TESTS_KEY(templateId)));
  }
}
