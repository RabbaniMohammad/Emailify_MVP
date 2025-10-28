"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkGrammar = checkGrammar;
const jsdom_1 = require("jsdom");
async function checkWithLanguageTool(text) {
    try {
        const response = await fetch('https://api.languagetool.org/v2/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                text,
                language: 'en-US',
                enabledOnly: 'false',
            }),
        });
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        return data.matches || [];
    }
    catch (error) {
        console.error('❌ LanguageTool API failed:', error);
        return [];
    }
}
function extractTextNodes(html) {
    const dom = new jsdom_1.JSDOM(html);
    const document = dom.window.document;
    const textNodes = [];
    function traverse(node, path) {
        if (node.nodeType === 3) {
            const text = node.textContent?.trim();
            if (text && text.length > 0) {
                textNodes.push({
                    node,
                    text,
                    path,
                });
            }
        }
        else if (node.nodeType === 1) {
            const element = node;
            if (['SCRIPT', 'STYLE', 'HEAD'].includes(element.tagName)) {
                return;
            }
            Array.from(node.childNodes).forEach((child, index) => {
                traverse(child, `${path}/${element.tagName.toLowerCase()}[${index}]`);
            });
        }
    }
    traverse(document.body || document.documentElement, '/root');
    return textNodes;
}
function findDuplicateWords(text) {
    const edits = [];
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
        const word1 = words[i].toLowerCase().replace(/[^a-z0-9]/g, '');
        const word2 = words[i + 1].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (word1 && word1 === word2 && words[i] === words[i + 1]) {
            const find = `${words[i]} ${words[i + 1]}`;
            const replace = words[i];
            const beforeIndex = text.indexOf(find);
            if (beforeIndex >= 0) {
                const before = text.slice(Math.max(0, beforeIndex - 20), beforeIndex);
                const after = text.slice(beforeIndex + find.length, beforeIndex + find.length + 20);
                edits.push({
                    find,
                    replace,
                    before_context: before,
                    after_context: after,
                    reason: `Duplicate word "${words[i]}" removed`,
                    changeType: 'duplicate',
                });
            }
        }
    }
    return edits;
}
function findSpacingIssues(text) {
    const edits = [];
    const spacingPatterns = [
        { pattern: /\bchat\s+gpt\b/gi, replacement: 'ChatGPT', reason: 'Brand name spacing' },
        { pattern: /\bface\s+book\b/gi, replacement: 'Facebook', reason: 'Brand name spacing' },
        { pattern: /\byou\s+tube\b/gi, replacement: 'YouTube', reason: 'Brand name spacing' },
        { pattern: /\bin\s+sta\s+gram\b/gi, replacement: 'Instagram', reason: 'Brand name spacing' },
        { pattern: /\btwit\s+ter\b/gi, replacement: 'Twitter', reason: 'Brand name spacing' },
        { pattern: /\blinked\s+in\b/gi, replacement: 'LinkedIn', reason: 'Brand name spacing' },
        { pattern: /\be\s+mail\b/gi, replacement: 'email', reason: 'Compound word spacing' },
        { pattern: /\bweb\s+site\b/gi, replacement: 'website', reason: 'Compound word spacing' },
    ];
    spacingPatterns.forEach(({ pattern, replacement, reason }) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const find = match[0];
            const beforeIndex = match.index;
            const before = text.slice(Math.max(0, beforeIndex - 20), beforeIndex);
            const after = text.slice(beforeIndex + find.length, beforeIndex + find.length + 20);
            edits.push({
                find,
                replace: replacement,
                before_context: before,
                after_context: after,
                reason,
                changeType: 'spacing',
            });
        }
    });
    return edits;
}
function convertLanguageToolMatches(text, matches) {
    const edits = [];
    matches.forEach(match => {
        if (!match.replacements || match.replacements.length === 0) {
            return;
        }
        const find = text.slice(match.offset, match.offset + match.length);
        const replace = match.replacements[0].value;
        const before = text.slice(Math.max(0, match.offset - 20), match.offset);
        const after = text.slice(match.offset + match.length, match.offset + match.length + 20);
        let changeType = 'grammar';
        if (match.rule.category.id === 'TYPOS') {
            changeType = 'typo';
        }
        else if (match.rule.category.id === 'SPELLING') {
            changeType = 'spelling';
        }
        edits.push({
            find,
            replace,
            before_context: before,
            after_context: after,
            reason: match.message,
            changeType,
        });
    });
    return edits;
}
function applyEditsToHTML(html, edits) {
    const dom = new jsdom_1.JSDOM(html);
    const document = dom.window.document;
    const appliedEdits = [];
    const failedEdits = [];
    const textNodes = extractTextNodes(html);
    edits.forEach(edit => {
        let applied = false;
        for (const textNode of textNodes) {
            const originalText = textNode.node.textContent || '';
            if (originalText.includes(edit.find)) {
                const index = originalText.indexOf(edit.find);
                const actualBefore = originalText.slice(Math.max(0, index - 20), index);
                const actualAfter = originalText.slice(index + edit.find.length, index + edit.find.length + 20);
                const beforeMatch = !edit.before_context || actualBefore.includes(edit.before_context) || edit.before_context.includes(actualBefore);
                const afterMatch = !edit.after_context || actualAfter.includes(edit.after_context) || edit.after_context.includes(actualAfter);
                if (beforeMatch && afterMatch) {
                    textNode.node.textContent = originalText.replace(edit.find, edit.replace);
                    appliedEdits.push({
                        find: edit.find,
                        replace: edit.replace,
                        before_context: edit.before_context,
                        after_context: edit.after_context,
                        reason: edit.reason,
                        status: 'applied',
                    });
                    applied = true;
                    break;
                }
            }
        }
        if (!applied) {
            failedEdits.push({
                find: edit.find,
                replace: edit.replace,
                before_context: edit.before_context,
                after_context: edit.after_context,
                reason: edit.reason,
                status: 'failed',
                error: 'Text spans across HTML element boundaries - cannot be safely modified',
            });
        }
    });
    const modifiedHTML = dom.serialize();
    return {
        html: modifiedHTML,
        appliedEdits,
        failedEdits,
        stats: {
            total: edits.length,
            applied: appliedEdits.length,
            failed: failedEdits.length,
        },
    };
}
async function checkGrammar(html) {
    const textNodes = extractTextNodes(html);
    const fullText = textNodes.map(tn => tn.text).join(' ');
    const [languageToolMatches] = await Promise.all([
        checkWithLanguageTool(fullText),
    ]);
    const languageToolEdits = convertLanguageToolMatches(fullText, languageToolMatches);
    const duplicateEdits = findDuplicateWords(fullText);
    const spacingEdits = findSpacingIssues(fullText);
    const allEdits = [...languageToolEdits, ...duplicateEdits, ...spacingEdits];
    const uniqueEdits = Array.from(new Map(allEdits.map(e => [`${e.find}::${e.replace}`, e])).values());
    const result = applyEditsToHTML(html, uniqueEdits);
    return result;
}
