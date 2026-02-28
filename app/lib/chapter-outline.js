'use client';

// Per-chapter outline storage (rough/detailed) in IndexedDB.
// This is separate from the global settings-tree "plot" nodes.

import { get, set } from 'idb-keyval';

const OUTLINE_PREFIX = 'author-chapter-outline-';
const OUTLINE_VERSION = 1;

function nowIso() {
    return new Date().toISOString();
}

function keyForChapter(chapterId) {
    return OUTLINE_PREFIX + String(chapterId || '').trim();
}

function makeEmpty(chapterId) {
    const now = nowIso();
    return {
        version: OUTLINE_VERSION,
        chapterId: String(chapterId || ''),
        rough: '',
        detailed: '',
        createdAt: now,
        updatedAt: now,
    };
}

export async function loadChapterOutline(chapterId) {
    if (typeof window === 'undefined') return makeEmpty(chapterId);
    const cid = String(chapterId || '').trim();
    if (!cid) return makeEmpty(chapterId);
    const key = keyForChapter(cid);
    try {
        const data = await get(key);
        if (data && typeof data === 'object') {
            const fixed = { ...makeEmpty(cid), ...data };
            if (!fixed.chapterId) fixed.chapterId = cid;
            if (!fixed.version) fixed.version = OUTLINE_VERSION;
            return fixed;
        }
    } catch { /* ignore */ }
    const fresh = makeEmpty(cid);
    try { await set(key, fresh); } catch { /* ignore */ }
    return fresh;
}

export async function peekChapterOutline(chapterId) {
    if (typeof window === 'undefined') return null;
    const cid = String(chapterId || '').trim();
    if (!cid) return null;
    try {
        const data = await get(keyForChapter(cid));
        return (data && typeof data === 'object') ? data : null;
    } catch {
        return null;
    }
}

export async function saveChapterOutline(chapterId, outline) {
    if (typeof window === 'undefined') return;
    const cid = String(chapterId || '').trim();
    if (!cid) return;
    const key = keyForChapter(cid);
    const now = nowIso();
    const next = {
        ...makeEmpty(cid),
        ...(outline && typeof outline === 'object' ? outline : {}),
        chapterId: cid,
        version: OUTLINE_VERSION,
        updatedAt: now,
    };
    try { await set(key, next); } catch { /* ignore */ }
}

export async function resetChapterOutline(chapterId) {
    const empty = makeEmpty(chapterId);
    await saveChapterOutline(chapterId, empty);
    return empty;
}
