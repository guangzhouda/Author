'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';
import {
    addSettingsNode,
    getActiveWorkId,
    getSettingsNodes,
    setActiveWorkId,
    updateSettingsNode,
} from '../lib/settings';

const OUTLINE_KINDS = {
    rough: 'rough',
    detailed: 'detailed',
};

export default function OutlinePanel() {
    const { showOutline: open, setShowOutline, showToast } = useAppStore();
    const { t } = useI18n();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rough, setRough] = useState('');
    const [detailed, setDetailed] = useState('');

    const roughNodeIdRef = useRef(null);
    const detailedNodeIdRef = useRef(null);
    const roughTextRef = useRef('');
    const detailedTextRef = useRef('');

    const pendingSaveRef = useRef(new Map()); // kind -> timeoutId
    const dirtyKindsRef = useRef(new Set()); // kind

    const clearTimers = useCallback(() => {
        pendingSaveRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
        pendingSaveRef.current.clear();
    }, []);

    const saveKind = useCallback(async (kind) => {
        const nodeId = kind === OUTLINE_KINDS.rough ? roughNodeIdRef.current : detailedNodeIdRef.current;
        if (!nodeId) return;

        const description = kind === OUTLINE_KINDS.rough ? (roughTextRef.current || '') : (detailedTextRef.current || '');
        await updateSettingsNode(nodeId, {
            content: { outlineKind: kind, description },
        });
        dirtyKindsRef.current.delete(kind);
    }, []);

    const scheduleSave = useCallback((kind, delayMs = 800) => {
        dirtyKindsRef.current.add(kind);
        const prev = pendingSaveRef.current.get(kind);
        if (prev) clearTimeout(prev);
        const timeoutId = setTimeout(() => {
            saveKind(kind).catch(() => { });
        }, delayMs);
        pendingSaveRef.current.set(kind, timeoutId);
    }, [saveKind]);

    const flushPendingSaves = useCallback(() => {
        clearTimers();
        // Fire-and-forget (do not block closing the panel).
        const kinds = Array.from(dirtyKindsRef.current);
        for (const kind of kinds) {
            saveKind(kind).catch(() => { });
        }
    }, [clearTimers, saveKind]);

    const onClose = useCallback(() => {
        flushPendingSaves();
        setShowOutline(false);
    }, [flushPendingSaves, setShowOutline]);

    const handleSaveAll = useCallback(async () => {
        setSaving(true);
        try {
            clearTimers();
            await Promise.all([
                saveKind(OUTLINE_KINDS.rough),
                saveKind(OUTLINE_KINDS.detailed),
            ]);
            showToast(t('outline.saved'), 'success');
        } catch (e) {
            showToast(t('outline.saveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    }, [clearTimers, saveKind, showToast, t]);

    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                clearTimers();
                dirtyKindsRef.current.clear();

                const nodes = await getSettingsNodes();

                // Ensure we have an active work.
                let workId = getActiveWorkId();
                if (!workId || !nodes.some(n => n.id === workId && n.type === 'work')) {
                    const firstWork = nodes.find(n => n.type === 'work');
                    workId = firstWork?.id || 'work-default';
                    if (workId) setActiveWorkId(workId);
                }

                const plotFolderId = `${workId}-plot`;

                const findOutlineNode = (kind) => nodes.find(n =>
                    n.parentId === plotFolderId &&
                    n.type === 'item' &&
                    n.category === 'plot' &&
                    n.content?.outlineKind === kind
                );

                let roughNode = findOutlineNode(OUTLINE_KINDS.rough);
                let detailedNode = findOutlineNode(OUTLINE_KINDS.detailed);

                if (!roughNode) {
                    roughNode = await addSettingsNode({
                        name: t('outline.roughLabel'),
                        type: 'item',
                        category: 'plot',
                        parentId: plotFolderId,
                        icon: '📄',
                        content: { outlineKind: OUTLINE_KINDS.rough, description: '' },
                    });
                }

                if (!detailedNode) {
                    detailedNode = await addSettingsNode({
                        name: t('outline.detailedLabel'),
                        type: 'item',
                        category: 'plot',
                        parentId: plotFolderId,
                        icon: '📄',
                        content: { outlineKind: OUTLINE_KINDS.detailed, description: '' },
                    });
                }

                if (cancelled) return;

                roughNodeIdRef.current = roughNode?.id || null;
                detailedNodeIdRef.current = detailedNode?.id || null;

                const roughText = roughNode?.content?.description || '';
                const detailedText = detailedNode?.content?.description || '';

                roughTextRef.current = roughText;
                detailedTextRef.current = detailedText;
                setRough(roughText);
                setDetailed(detailedText);
            } catch (e) {
                console.error('Failed to load outline:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [open, clearTimers, t]);

    if (!open) return null;

    return (
        <div className="settings-panel-overlay" onClick={onClose} style={{ zIndex: 9998 }}>
            <div
                className="settings-panel-container"
                onClick={e => e.stopPropagation()}
                style={{ width: 900, maxWidth: '95vw', height: '85vh' }}
            >
                <div className="settings-header">
                    <h2>
                        📋 {t('outline.title')}
                        <span className="subtitle">— {t('outline.subtitle')}</span>
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: '8px 14px', borderRadius: 'var(--radius-full)', fontWeight: 700 }}
                            onClick={handleSaveAll}
                            disabled={loading || saving}
                            title={t('outline.saveTip')}
                        >
                            {saving ? t('outline.saving') : t('outline.saveBtn')}
                        </button>
                        <button className="btn btn-ghost btn-icon" onClick={onClose} title={t('common.close')}>✕</button>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflow: 'auto', padding: '18px 24px', background: 'var(--bg-primary)' }}>
                    {loading ? (
                        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                            {t('outline.loading')}
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {t('outline.roughLabel')}
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
                                        roughTextRef.current = v;
                                        scheduleSave(OUTLINE_KINDS.rough);
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
                                        detailedTextRef.current = v;
                                        scheduleSave(OUTLINE_KINDS.detailed);
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
