'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';
import { loadChapterOutline, saveChapterOutline } from '../lib/chapter-outline';

export default function OutlinePanel() {
    const {
        showOutline: open, setShowOutline, showToast,
        chapters, activeChapterId,
    } = useAppStore();
    const { t } = useI18n();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rough, setRough] = useState('');
    const [detailed, setDetailed] = useState('');
    const [selectedChapterId, setSelectedChapterId] = useState(null);

    const roughRef = useRef('');
    const detailedRef = useRef('');
    const chapterIdRef = useRef(null);
    const dirtyRef = useRef(false);
    const timerRef = useRef(null);

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
        flushPendingSave();
        setShowOutline(false);
    }, [flushPendingSave, setShowOutline]);

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
        flushPendingSave();
        setSelectedChapterId(nextId || null);
    }, [flushPendingSave]);

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

    // When opened, default to the current active chapter.
    useEffect(() => {
        if (!open) return;
        setSelectedChapterId(activeChapterId || null);
    }, [open, activeChapterId]);

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

