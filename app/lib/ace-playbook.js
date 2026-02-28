'use client';

// ACE (Agentic Context Engineering) playbook memory for the chat assistant.
// Inspired by "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models".
// We store an evolving, bullet-based playbook and update it with incremental deltas to avoid context collapse.

import { get, set } from 'idb-keyval';
import { getEmbedding, cosineSimilarity } from './embeddings';
import { estimateTokens } from './context-engine';

const PLAYBOOK_VERSION = 1;
const STORAGE_PREFIX = 'author-ace-playbook-';

const DEFAULT_SECTIONS = [
    { key: 'preferences', title: '偏好/输出格式' },
    { key: 'project', title: '项目/作品上下文' },
    { key: 'workflow', title: '工作流/工具使用' },
    { key: 'open_threads', title: '待办/未决问题' },
    { key: 'misc', title: '其他' },
];

function nowIso() {
    return new Date().toISOString();
}

function storageKey(workId) {
    const wid = (workId || 'work-default').trim() || 'work-default';
    return STORAGE_PREFIX + wid;
}

function makeEmptyPlaybook(workId) {
    const sections = {};
    DEFAULT_SECTIONS.forEach(s => { sections[s.key] = { title: s.title, bullets: [] }; });
    const now = nowIso();
    return {
        version: PLAYBOOK_VERSION,
        workId: workId || 'work-default',
        createdAt: now,
        updatedAt: now,
        nextId: 1,
        sections,
    };
}

function normalizeForDedupe(text) {
    return (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function ensureSections(playbook) {
    if (!playbook.sections || typeof playbook.sections !== 'object') {
        playbook.sections = {};
    }
    for (const s of DEFAULT_SECTIONS) {
        if (!playbook.sections[s.key]) {
            playbook.sections[s.key] = { title: s.title, bullets: [] };
        } else if (!Array.isArray(playbook.sections[s.key].bullets)) {
            playbook.sections[s.key].bullets = [];
        }
        if (!playbook.sections[s.key].title) playbook.sections[s.key].title = s.title;
    }
}

function allocBulletId(playbook) {
    const n = Math.max(1, parseInt(playbook.nextId || 1, 10));
    playbook.nextId = n + 1;
    return `ace-${String(n).padStart(5, '0')}`;
}

function mapSectionKey(section) {
    const raw = (section || '').toString().trim();
    if (!raw) return 'misc';
    const lower = raw.toLowerCase();
    const aliases = {
        preference: 'preferences',
        preferences: 'preferences',
        pref: 'preferences',
        '偏好': 'preferences',
        '输出': 'preferences',
        '格式': 'preferences',

        project: 'project',
        context: 'project',
        '作品': 'project',
        '设定': 'project',

        workflow: 'workflow',
        tool: 'workflow',
        tools: 'workflow',
        '工具': 'workflow',
        '工作流': 'workflow',

        open: 'open_threads',
        open_threads: 'open_threads',
        todo: 'open_threads',
        todos: 'open_threads',
        '待办': 'open_threads',
        '未决': 'open_threads',

        misc: 'misc',
        other: 'misc',
        '其他': 'misc',
    };
    return aliases[lower] || aliases[raw] || (DEFAULT_SECTIONS.some(s => s.key === lower) ? lower : 'misc');
}

function flattenBullets(playbook) {
    const out = [];
    for (const [sectionKey, sec] of Object.entries(playbook.sections || {})) {
        const bullets = Array.isArray(sec?.bullets) ? sec.bullets : [];
        for (const b of bullets) out.push({ sectionKey, sectionTitle: sec?.title || sectionKey, bullet: b });
    }
    return out;
}

function canUseEmbeddings(apiConfig) {
    // Conservative: only use embedding-based retrieval/dedupe when the user explicitly enabled it.
    return !!apiConfig?.useCustomEmbed;
}

async function embedText(text, apiConfig) {
    try {
        return await getEmbedding(text, apiConfig);
    } catch {
        return null;
    }
}

export async function loadAcePlaybook(workId) {
    if (typeof window === 'undefined') return makeEmptyPlaybook(workId);
    const key = storageKey(workId);
    try {
        const pb = await get(key);
        if (pb && typeof pb === 'object') {
            // Shallow migrate/repair.
            if (!pb.version) pb.version = PLAYBOOK_VERSION;
            if (!pb.workId) pb.workId = workId || 'work-default';
            if (!pb.nextId) pb.nextId = 1;
            ensureSections(pb);
            return pb;
        }
    } catch { /* ignore */ }
    const fresh = makeEmptyPlaybook(workId);
    try { await set(key, fresh); } catch { /* ignore */ }
    return fresh;
}

export async function saveAcePlaybook(workId, playbook) {
    if (typeof window === 'undefined') return;
    const key = storageKey(workId);
    try {
        await set(key, playbook);
    } catch { /* ignore */ }
}

export function renderAcePlaybookForCurator(playbook, maxTokens = 2500) {
    if (!playbook) return '';
    ensureSections(playbook);

    const lines = [];
    lines.push(`playbook_version=${playbook.version || PLAYBOOK_VERSION}`);
    lines.push(`work_id=${playbook.workId || 'work-default'}`);
    lines.push('');

    let used = estimateTokens(lines.join('\n'));
    for (const s of DEFAULT_SECTIONS) {
        const sec = playbook.sections[s.key];
        if (!sec) continue;
        const header = `## ${sec.title} (${s.key})`;
        const headerTokens = estimateTokens(header + '\n');
        if (used + headerTokens > maxTokens) break;
        lines.push(header);
        used += headerTokens;

        const bullets = Array.isArray(sec.bullets) ? sec.bullets : [];
        for (const b of bullets) {
            const line = `- [${b.id}] hits=${b.hits || 0} helpful=${b.helpful || 0} harmful=${b.harmful || 0} :: ${b.content || ''}`;
            const t = estimateTokens(line + '\n');
            if (used + t > maxTokens) break;
            lines.push(line);
            used += t;
        }
        lines.push('');
        used += 1;
        if (used > maxTokens) break;
    }

    return lines.join('\n').trim();
}

export async function selectAceBulletsForQuery(playbook, query, apiConfig, topK = 10) {
    if (!playbook) return [];
    ensureSections(playbook);
    const all = flattenBullets(playbook);
    if (all.length === 0) return [];

    const q = (query || '').trim();
    if (!q) {
        // No query: return recent bullets.
        return all
            .sort((a, b) => (b.bullet.updatedAt || b.bullet.createdAt || '').localeCompare(a.bullet.updatedAt || a.bullet.createdAt || ''))
            .slice(0, topK);
    }

    if (canUseEmbeddings(apiConfig)) {
        const qVec = await embedText(q.slice(0, 2000), apiConfig);
        if (qVec) {
            const scored = all.map(x => {
                const v = x.bullet?.embedding;
                const score = Array.isArray(v) ? cosineSimilarity(qVec, v) : -1;
                return { ...x, score };
            }).filter(x => x.score > 0.25);
            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, topK);
        }
    }

    // Fallback: naive keyword match.
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const scored = all.map(x => {
        const text = (x.bullet?.content || '').toLowerCase();
        let score = 0;
        for (const tok of tokens) {
            if (tok.length < 2) continue;
            if (text.includes(tok)) score += 1;
        }
        return { ...x, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

export function renderAceBulletsForInjection(bullets, maxTokens = 1200) {
    if (!Array.isArray(bullets) || bullets.length === 0) return '';

    const bySection = new Map();
    for (const x of bullets) {
        const key = x.sectionKey || 'misc';
        if (!bySection.has(key)) bySection.set(key, { title: x.sectionTitle || key, items: [] });
        bySection.get(key).items.push(x.bullet);
    }

    const lines = [];
    let used = 0;
    for (const [sectionKey, sec] of bySection.entries()) {
        const header = `【${sec.title}】`;
        const ht = estimateTokens(header + '\n');
        if (used + ht > maxTokens) break;
        lines.push(header);
        used += ht;

        for (const b of sec.items) {
            const line = `- [${b.id}] ${b.content || ''}`;
            const t = estimateTokens(line + '\n');
            if (used + t > maxTokens) break;
            lines.push(line);
            used += t;
        }
        lines.push('');
        used += 1;
        if (used > maxTokens) break;
    }

    return lines.join('\n').trim();
}

export async function applyAceDeltaOperations(playbook, operations, apiConfig) {
    const pb = playbook || makeEmptyPlaybook('work-default');
    ensureSections(pb);

    const ops = Array.isArray(operations) ? operations : [];
    const now = nowIso();

    let added = 0;
    let merged = 0;

    for (const op of ops) {
        const type = (op?.type || '').toString().trim().toUpperCase();
        if (type !== 'ADD') continue;

        const content = (op?.content || '').toString().trim();
        if (!content) continue;
        // Skip ultra-short fragments; they tend to be noise.
        if (content.replace(/\s/g, '').length < 8) continue;

        const sectionKey = mapSectionKey(op?.section);
        const sec = pb.sections[sectionKey] || pb.sections.misc;
        if (!sec) continue;

        const norm = normalizeForDedupe(content);
        const existing = (sec.bullets || []).find(b => normalizeForDedupe(b.content) === norm);
        if (existing) {
            existing.hits = (existing.hits || 0) + 1;
            existing.updatedAt = now;
            merged += 1;
            continue;
        }

        let embedding = null;
        if (canUseEmbeddings(apiConfig)) {
            embedding = await embedText(content.slice(0, 2000), apiConfig);
            if (embedding) {
                // Grow-and-refine: dedupe by semantic similarity in the same section.
                let best = null;
                let bestScore = -1;
                for (const b of (sec.bullets || [])) {
                    if (!Array.isArray(b.embedding)) continue;
                    const s = cosineSimilarity(embedding, b.embedding);
                    if (s > bestScore) { bestScore = s; best = b; }
                }
                if (best && bestScore >= 0.92) {
                    best.hits = (best.hits || 0) + 1;
                    best.updatedAt = now;
                    merged += 1;
                    continue;
                }
            }
        }

        const bullet = {
            id: allocBulletId(pb),
            content,
            hits: 0,
            helpful: 0,
            harmful: 0,
            embedding,
            createdAt: now,
            updatedAt: now,
        };
        sec.bullets.push(bullet);
        added += 1;
    }

    if (added > 0 || merged > 0) {
        pb.updatedAt = now;
    }

    return { playbook: pb, added, merged };
}

export async function getAceSystemPromptAddon(workId, query, apiConfig, opts = {}) {
    const pb = await loadAcePlaybook(workId);
    const topK = Math.max(1, Math.min(30, opts.topK || 10));
    const bullets = await selectAceBulletsForQuery(pb, query, apiConfig, topK);

    // Best-effort usage stats update.
    if (bullets.length > 0) {
        const now = nowIso();
        for (const x of bullets) {
            x.bullet.hits = (x.bullet.hits || 0) + 1;
            x.bullet.updatedAt = now;
        }
        pb.updatedAt = now;
        saveAcePlaybook(workId, pb); // background
    }

    const maxTokens = opts.maxTokens || 1200;
    const text = renderAceBulletsForInjection(bullets, maxTokens);
    return { text, bullets };
}

