const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/app/features/visual-editor/visual-editor.component.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the searchTextInPage function
const oldFunc = /searchTextInPage\(text: string, event\?: MouseEvent\): void \{[\s\S]*?^\s\s\}/m;

const newFunc = `searchTextInPage(text: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    
    try {
      let iframe = document.querySelector('iframe#gjs') as HTMLIFrameElement;
      
      if (!iframe) {
        iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
      }
      
      if (!iframe) {
        iframe = document.querySelector('iframe') as HTMLIFrameElement;
      }
      
      if (!iframe || !iframe.contentWindow) {
        this.showToast('Editor not ready', 'warning');
        return;
      }
      
      iframe.contentWindow.focus();
      
      const found = iframe.contentWindow.find(text, false, false, true, false, true, false);
      
      if (found) {
        this.showToast(\`Found "\${this.truncateText(text, 30)}"\`, 'success');
      } else {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast(\`Not found. Copied - try Ctrl+F\`, 'warning');
        }).catch(() => {
          this.showToast('Not found', 'warning');
        });
      }
    } catch (error) {
      console.error('[SEARCH] Error:', error);
      this.showToast('Press Ctrl+F to search', 'info');
    }
  }`;

content = content.replace(oldFunc, newFunc);

fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ Fixed search function!');
