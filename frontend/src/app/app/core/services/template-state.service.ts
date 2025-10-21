import { Injectable } from '@angular/core';

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
  
  // Storage Keys
  private readonly PREFIX = 'template_state_';
  private readonly ORIGINAL_KEY = (id: string) => `${this.PREFIX}${id}_original`;
  private readonly EDITED_KEY = (id: string) => `${this.PREFIX}${id}_edited`;
  private readonly EDITOR_PROGRESS_KEY = (id: string) => `${this.PREFIX}${id}_editor_progress`;
  private readonly STATE_FLAG_KEY = (id: string) => `${this.PREFIX}${id}_state_flag`;
  private readonly LAST_RUN_TESTS_KEY = (id: string) => `${this.PREFIX}${id}_last_run_tests`;
  
  /**
   * Initialize template state when "Run Tests" is clicked
   * This clears any edited state and sets original template
   */
  initializeOriginalTemplate(templateId: string, originalHtml: string): void {
    console.log('🎯 [TemplateState] Initializing original template:', templateId);
    
    // Save original template
    localStorage.setItem(this.ORIGINAL_KEY(templateId), originalHtml);
    
    // Clear any edited state (reset to temp_1)
    localStorage.removeItem(this.EDITED_KEY(templateId));
    localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));
    
    // Set state flag to 'original'
    localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'original');
    
    // Mark the timestamp of run tests
    localStorage.setItem(this.LAST_RUN_TESTS_KEY(templateId), Date.now().toString());
    
    console.log('✅ [TemplateState] Initialized with original template');
  }
  
  /**
   * Get the current template that should be displayed in QA page
   * Returns edited version if exists, otherwise returns original
   */
  getCurrentTemplate(templateId: string): string | null {
    const edited = localStorage.getItem(this.EDITED_KEY(templateId));
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    
    console.log('🔍 [TemplateState] Getting current template for:', templateId);
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
   * If edited version exists (user is continuing edits), return that
   * Otherwise return original
   */
  getTemplateForEditor(templateId: string): string | null {
    // Check editor progress first (in case of refresh during editing)
    const editorProgress = localStorage.getItem(this.EDITOR_PROGRESS_KEY(templateId));
    
    if (editorProgress) {
      try {
        const parsed = JSON.parse(editorProgress);
        if (parsed.html) {
          console.log('✅ [TemplateState] Loading editor progress (temp_edit)');
          return `<style>${parsed.css || ''}</style>${parsed.html}`;
        }
      } catch (e) {
        console.error('❌ [TemplateState] Failed to parse editor progress:', e);
      }
    }
    
    // Check edited version
    const edited = localStorage.getItem(this.EDITED_KEY(templateId));
    if (edited) {
      console.log('✅ [TemplateState] Loading edited template (temp_edit)');
      return edited;
    }
    
    // Fall back to original
    const original = localStorage.getItem(this.ORIGINAL_KEY(templateId));
    if (original) {
      console.log('✅ [TemplateState] Loading original template (temp_1)');
      return original;
    }
    
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
   */
  saveEditorProgress(templateId: string, html: string, css: string): void {
    const editorState = {
      html,
      css,
      savedAt: new Date().toISOString()
    };
    
    localStorage.setItem(this.EDITOR_PROGRESS_KEY(templateId), JSON.stringify(editorState));
    
    // Also update the edited template
    this.saveEditedTemplate(templateId, html, css);
  }
  
  /**
   * Check if template has been edited
   */
  hasEdits(templateId: string): boolean {
    const stateFlag = localStorage.getItem(this.STATE_FLAG_KEY(templateId));
    return stateFlag === 'edited';
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
    console.log('   - Has original:', !!localStorage.getItem(this.ORIGINAL_KEY(templateId)));
    console.log('   - Has edited:', !!localStorage.getItem(this.EDITED_KEY(templateId)));
    console.log('   - Has editor progress:', !!localStorage.getItem(this.EDITOR_PROGRESS_KEY(templateId)));
    console.log('   - Last run tests:', localStorage.getItem(this.LAST_RUN_TESTS_KEY(templateId)));
  }
}
