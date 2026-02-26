// Text utilities for counting words/characters in a way that matches novel-writing needs.
// - "字数" excludes whitespace, punctuation, symbols, and control/format chars by default.
// - Uses Unicode code points (avoids surrogate-pair double counting).

export function countNovelWordsFromText(text) {
    if (!text) return 0;
    const cleaned = String(text)
        .replace(/\s+/g, '')
        .replace(/[\p{P}\p{S}\p{C}]+/gu, '');
    return Array.from(cleaned).length;
}

export function htmlToPlainText(html) {
    if (!html) return '';
    const raw = String(html);
    if (typeof window === 'undefined') {
        return raw.replace(/<[^>]*>/g, ' ');
    }
    const el = document.createElement('div');
    el.innerHTML = raw;
    return el.textContent || '';
}

export function countNovelWordsFromHtml(html) {
    return countNovelWordsFromText(htmlToPlainText(html));
}

