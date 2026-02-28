'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';
import { loadChapterOutline, saveChapterOutline } from '../lib/chapter-outline';
import { buildContext, compileSystemPrompt } from '../lib/context-engine';
import { getProjectSettings, getActiveWorkId } from '../lib/settings';
import { getAceSystemPromptAddon } from '../lib/ace-playbook';
import { injectAceAddonIntoSystemPrompt } from '../lib/ace-generator';

function parseJsonFromModel(text) {
    if (!text) return null;
    const trimmed = String(text).trim();
    // Common case: strict JSON
    try { return JSON.parse(trimmed); } catch { /* ignore */ }

    // Remove ```json fences if present
    const fence = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
    if (fence?.[1]) {
        try { return JSON.parse(fence[1].trim()); } catch { /* ignore */ }
    }

    // Fallback: try the largest {...} block
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* ignore */ }
    }
    return null;
}

export default function OutlinePanel() {
    const {
        showOutline: open, setShowOutline, showToast,
        chapters, activeChapterId,
        contextSelection,
    } = useAppStore();
    const { t } = useI18n();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rough, setRough] = useState('');
    const [detailed, setDetailed] = useState('');
    const [selectedChapterId, setSelectedChapterId] = useState(null);
    const [generating, setGenerating] = useState(false);

    const roughRef = useRef('');
    const detailedRef = useRef('');
    const chapterIdRef = useRef(null);
    const dirtyRef = useRef(false);
    const timerRef = useRef(null);
    const aiAbortRef = useRef(null);

    const selectedId = selectedChapterId || activeChapterId || null;
    const selectedChapter = useMemo(
        () => chapters?.find(ch => ch.id === selectedId) || null,
        [chapters, selectedId]
    );
    const selectedIndex = useMemo(
        () => (chapters || []).findIndex(ch => ch.id === selectedId),
        [chapters, selectedId]
    );

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const abortAi = useCallback(() => {
        try { aiAbortRef.current?.abort(); } catch { /* ignore */ }
        aiAbortRef.current = null;
    }, []);

    const saveNow = useCallback(async () => {
        const cid = chapterIdRef.current;
        if (!cid) return;
        await saveChapterOutline(cid, {
            rough: roughRef.current || '',
            detailed: detailedRef.current || '',
        });
        dirtyRef.current = false;
    }, []);

    const scheduleSave = useCallback((delayMs = 800) => {
        dirtyRef.current = true;
        clearTimer();
        timerRef.current = setTimeout(() => {
            saveNow().catch(() => { });
        }, delayMs);
    }, [clearTimer, saveNow]);

    const flushPendingSave = useCallback(() => {
        clearTimer();
        if (dirtyRef.current) {
            // Fire-and-forget (do not block UI interactions).
            saveNow().catch(() => { });
        }
    }, [clearTimer, saveNow]);

    const onClose = useCallback(() => {
        abortAi();
        flushPendingSave();
        setShowOutline(false);
    }, [abortAi, flushPendingSave, setShowOutline]);

    const handleSaveAll = useCallback(async () => {
        setSaving(true);
        try {
            clearTimer();
            await saveNow();
            showToast(t('outline.saved'), 'success');
        } catch {
            showToast(t('outline.saveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    }, [clearTimer, saveNow, showToast, t]);

    const switchChapter = useCallback((nextId) => {
        abortAi();
        flushPendingSave();
        setSelectedChapterId(nextId || null);
    }, [abortAi, flushPendingSave]);

    const onPrev = useCallback(() => {
        if (!chapters || chapters.length === 0) return;
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        const prev = chapters[idx - 1];
        if (prev?.id) switchChapter(prev.id);
    }, [chapters, selectedIndex, switchChapter]);

    const onNext = useCallback(() => {
        if (!chapters || chapters.length === 0) return;
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        const next = chapters[idx + 1];
        if (next?.id) switchChapter(next.id);
    }, [chapters, selectedIndex, switchChapter]);

    const streamText = useCallback(async ({ apiEndpoint, systemPrompt, userPrompt, apiConfig, signal }) => {
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        const res = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemPrompt,
                userPrompt,
                apiConfig,
                maxTokens: 1800,
                temperature: 0.7,
            }),
            signal,
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await res.json();
            throw new Error(data.error || '请求失败');
        }
        if (!res.body) throw new Error('响应为空');

        const reader = res.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
                const trimmed = event.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        if (json.text) fullText += json.text;
                    } catch { /* ignore */ }
                }
            }
        }
        return fullText;
    }, []);

    const handleAiGenerate = useCallback(async () => {
        if (!selectedId || generating || loading || saving) return;

        const hasExisting = !!((roughRef.current || '').trim() || (detailedRef.current || '').trim());
        if (hasExisting) {
            const ok = typeof window !== 'undefined' ? window.confirm(t('outline.aiOverwriteConfirm')) : false;
            if (!ok) return;
        }

        setGenerating(true);
        showToast(t('outline.aiGenerating'), 'info');

        const cid = selectedId;
        const chapterTitle = selectedChapter?.title || t('outline.untitled');
        const chapterNo = (selectedIndex >= 0 ? String(selectedIndex + 1) : '?');

        try {
            abortAi();
            const controller = new AbortController();
            aiAbortRef.current = controller;

            const { apiConfig } = getProjectSettings();
            const apiEndpoint = apiConfig?.provider === 'gemini-native' ? '/api/ai/gemini' : '/api/ai';

            const queryText = [
                `为第${chapterNo}章「${chapterTitle}」生成大纲（粗纲/细纲）`,
                roughRef.current ? `已有粗纲：\n${String(roughRef.current).slice(0, 1200)}` : '',
                detailedRef.current ? `已有细纲：\n${String(detailedRef.current).slice(0, 1200)}` : '',
            ].filter(Boolean).join('\n\n');

            const context = await buildContext(cid, queryText, (contextSelection && contextSelection.size > 0) ? contextSelection : null);
            let systemPrompt = compileSystemPrompt(context, 'outline');

            // ACE: inject evolving playbook bullets (optional).
            const aceEnabled = (typeof window !== 'undefined') && localStorage.getItem('author-ace-enabled') === '1';
            if (aceEnabled) {
                try {
                    const workId = getActiveWorkId() || 'work-default';
                    const addon = await getAceSystemPromptAddon(workId, queryText, apiConfig, { topK: 12, maxTokens: 1200 });
                    if (addon?.text) {
                        systemPrompt = injectAceAddonIntoSystemPrompt(systemPrompt, addon.text);
                    }
                } catch (e) {
                    console.warn('ACE add-on failed (outline):', e?.message || e);
                }
            }

            const userPrompt = [
                `请为第${chapterNo}章「${chapterTitle}」输出严格 JSON（不要 markdown/代码块/多余文字）：`,
                '{',
                '  "rough": "粗纲（3-8条，突出冲突/转折/节奏/结尾钩子，可用列表或分段）",',
                '  "detailed": "细纲（按场景/段落列出推进：场景/出场人物/目标与冲突/关键动作/伏笔信息/情绪变化/章节结尾）"',
                '}',
                '',
                '要求：',
                '- 严格基于设定集、剧情大纲、前文回顾与当前写作位置（若已有正文需保持一致）',
                '- 不要输出正文，不要输出设定操作块',
            ].join('\n');

            const out = await streamText({
                apiEndpoint,
                systemPrompt,
                userPrompt,
                apiConfig,
                signal: controller.signal,
            });

            // If user switched chapters during generation, do nothing.
            if (chapterIdRef.current !== cid) return;

            const obj = parseJsonFromModel(out) || {};
            const nextRoughRaw = obj.rough ?? obj.coarse ?? obj.roughOutline ?? '';
            const nextDetailedRaw = obj.detailed ?? obj.fine ?? obj.detailedOutline ?? '';

            const nextRough = Array.isArray(nextRoughRaw) ? nextRoughRaw.join('\n') : String(nextRoughRaw || '').trim();
            const nextDetailed = Array.isArray(nextDetailedRaw) ? nextDetailedRaw.join('\n') : String(nextDetailedRaw || '').trim();

            if (!nextRough && !nextDetailed) {
                throw new Error(t('outline.aiParseFailed'));
            }

            if (nextRough) {
                setRough(nextRough);
                roughRef.current = nextRough;
            }
            if (nextDetailed) {
                setDetailed(nextDetailed);
                detailedRef.current = nextDetailed;
            }

            scheduleSave(200);
            showToast(t('outline.aiGenerated'), 'success');
        } catch (err) {
            if (err?.name === 'AbortError') {
                showToast(t('outline.aiCanceled'), 'info');
            } else {
                console.warn('Outline AI generate failed:', err?.message || err);
                showToast((err?.message ? `${t('outline.aiFailed')}：${err.message}` : t('outline.aiFailed')), 'error');
            }
        } finally {
            aiAbortRef.current = null;
            setGenerating(false);
        }
    }, [abortAi, contextSelection, generating, loading, saving, scheduleSave, selectedChapter?.title, selectedId, selectedIndex, showToast, streamText, t]);

    // When opened, default to the current active chapter.
    useEffect(() => {
        if (!open) return;
        setSelectedChapterId(activeChapterId || null);
    }, [open, activeChapterId]);

    // Unmount safety
    useEffect(() => () => abortAi(), [abortAi]);

    // Load outline when the selected chapter changes.
    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        clearTimer();
        dirtyRef.current = false;

        const cid = selectedId;
        chapterIdRef.current = cid;
        setRough('');
        setDetailed('');
        roughRef.current = '';
        detailedRef.current = '';

        if (!cid) return;

        const load = async () => {
            setLoading(true);
            try {
                const data = await loadChapterOutline(cid);
                if (cancelled) return;
                const r = data?.rough || '';
                const d = data?.detailed || '';
                setRough(r);
                setDetailed(d);
                roughRef.current = r;
                detailedRef.current = d;
            } catch {
                if (!cancelled) showToast(t('outline.loadFailed'), 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [open, selectedId, clearTimer, showToast, t]);

    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
            <div className="outline-panel-modal" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <h2 style={{ minWidth: 0 }}>
                        📋 {t('outline.title')}
                        <span className="subtitle">— {t('outline.subtitle')}</span>
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                            className="btn-mini-icon"
                            onClick={onPrev}
                            disabled={loading || saving || selectedIndex <= 0}
                            title={t('outline.prevChapter')}
                        >◀</button>
                        <select
                            className="outline-chapter-select"
                            value={selectedId || ''}
                            onChange={(e) => switchChapter(e.target.value)}
                            disabled={loading || saving || !(chapters?.length > 0)}
                            title={t('outline.chapterSelect')}
                        >
                            {(chapters || []).map((ch, idx) => (
                                <option key={ch.id} value={ch.id}>
                                    {t('outline.chapterLabel')
                                        .replace('{num}', String(idx + 1))
                                        .replace('{title}', ch.title || t('outline.untitled'))}
                                </option>
                            ))}
                        </select>
                        <button
                            className="btn-mini-icon"
                            onClick={onNext}
                            disabled={loading || saving || selectedIndex < 0 || selectedIndex >= (chapters?.length || 0) - 1}
                            title={t('outline.nextChapter')}
                        >▶</button>

                        <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '8px 14px', borderRadius: 'var(--radius-full)', fontWeight: 700 }}
                            onClick={handleAiGenerate}
                            disabled={loading || saving || generating || !selectedId}
                            title={t('outline.aiTip')}
                        >
                            {generating ? t('outline.aiGeneratingBtn') : t('outline.aiBtn')}
                        </button>

                        <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: '8px 14px', borderRadius: 'var(--radius-full)', fontWeight: 700 }}
                            onClick={handleSaveAll}
                            disabled={loading || saving || !selectedId}
                            title={t('outline.saveTip')}
                        >
                            {saving ? t('outline.saving') : t('outline.saveBtn')}
                        </button>
                        <button className="btn btn-ghost btn-icon" onClick={onClose} title={t('common.close')}>✕</button>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflow: 'auto', padding: '18px 24px', background: 'var(--bg-primary)' }}>
                    {!selectedId ? (
                        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                            {t('outline.noChapter')}
                        </div>
                    ) : loading ? (
                        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                            {t('outline.loading')}
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
                                        {t('outline.roughLabel')}
                                        {selectedChapter?.title ? <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> — {selectedChapter.title}</span> : null}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        {t('outline.autoSaveHint')}
                                    </div>
                                </div>
                                <textarea
                                    className="modal-input"
                                    style={{ minHeight: 140, resize: 'vertical', fontFamily: 'var(--font-writing)', lineHeight: 1.6 }}
                                    placeholder={t('outline.roughPlaceholder')}
                                    value={rough}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setRough(v);
                                        roughRef.current = v;
                                        scheduleSave();
                                    }}
                                    disabled={saving}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {t('outline.detailedLabel')}
                                </div>
                                <textarea
                                    className="modal-input"
                                    style={{ flex: 1, minHeight: 240, resize: 'vertical', fontFamily: 'var(--font-writing)', lineHeight: 1.6 }}
                                    placeholder={t('outline.detailedPlaceholder')}
                                    value={detailed}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setDetailed(v);
                                        detailedRef.current = v;
                                        scheduleSave();
                                    }}
                                    disabled={saving}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
