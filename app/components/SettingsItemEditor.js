'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '../lib/useI18n';
import { useAppStore } from '../store/useAppStore';
import { getProjectSettings, saveProjectSettings } from '../lib/settings';
import { buildContext, compileSystemPrompt } from '../lib/context-engine';

// ==================== 分类配色 ====================
const CATEGORY_COLORS = {
    character: { color: 'var(--cat-character)', bg: 'var(--cat-character-bg)' },
    location: { color: 'var(--cat-location)', bg: 'var(--cat-location-bg)' },
    world: { color: 'var(--cat-world)', bg: 'var(--cat-world-bg)' },
    object: { color: 'var(--cat-object)', bg: 'var(--cat-object-bg)' },
    plot: { color: 'var(--cat-plot)', bg: 'var(--cat-plot-bg)' },
    rules: { color: 'var(--cat-rules)', bg: 'var(--cat-rules-bg)' },
    custom: { color: 'var(--cat-custom)', bg: 'var(--cat-custom-bg)' },
};

const PRESET_ROLE_KEYS = ['protagonist', 'antagonist', 'supporting', 'minor'];

async function streamAiText({ apiEndpoint, systemPrompt, userPrompt, apiConfig, maxTokens }) {
    const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userPrompt, apiConfig, maxTokens }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const data = await res.json();
        throw new Error(data.error || '请求失败');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

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
                } catch { }
            }
        }
    }
    return fullText;
}

// ==================== 通用字段组件 ====================

function TextField({ label, value, onChange, placeholder, multiline = false, rows = 3, aiBtn = false, ai }) {
    const { t } = useI18n();
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
                {aiBtn && (
                    <button
                        type="button"
                        className="field-ai-btn"
                        title={t('settingsEditor.aiFill')}
                        onClick={ai?.onClick}
                        disabled={ai?.loading || !ai?.onClick}
                    >
                        {ai?.loading ? '…' : '✦'}
                    </button>
                )}
            </div>
            {multiline ? (
                <textarea
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                    style={{
                        width: '100%', padding: '8px 12px', border: '1px solid var(--border-light)',
                        borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                        fontSize: 13, fontFamily: 'var(--font-ui)', resize: 'vertical', outline: 'none',
                        lineHeight: 1.6, transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
                />
            ) : (
                <input
                    type="text"
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{
                        width: '100%', padding: '8px 12px', border: '1px solid var(--border-light)',
                        borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                        fontSize: 13, fontFamily: 'var(--font-ui)', outline: 'none', transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
                />
            )}
        </div>
    );
}

function ButtonGroup({ label, value, options, onChange }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {options.map(opt => (
                    <button
                        key={opt.value}
                        onClick={() => onChange(opt.value)}
                        style={{
                            padding: '5px 12px', borderRadius: 16, fontSize: 12, border: '1px solid var(--border-light)',
                            background: value === opt.value ? 'var(--accent)' : 'transparent',
                            color: value === opt.value ? 'var(--text-inverse)' : 'var(--text-secondary)',
                            cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-ui)',
                        }}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ==================== 字段分组折叠 ====================

function FieldGroup({ title, icon, children, defaultCollapsed = false }) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    return (
        <div className={`field-group ${collapsed ? 'collapsed' : ''}`}>
            <div className="field-group-header" onClick={() => setCollapsed(!collapsed)}>
                <h4>{icon && <span>{icon}</span>}{title}</h4>
                <span className="field-group-chevron">▼</span>
            </div>
            <div className="field-group-content">
                {children}
            </div>
        </div>
    );
}

// ==================== AI 生成的额外字段 ====================

function ExtraFieldsSection({ content, knownFields, onUpdate }) {
    const { t } = useI18n();
    const extraKeys = Object.keys(content || {}).filter(k => !knownFields.includes(k) && content[k]);
    if (extraKeys.length === 0) return null;
    return (
        <FieldGroup title={t('settingsEditor.aiExtraFields')} icon="✨" defaultCollapsed>
            {extraKeys.map(k => (
                <TextField
                    key={k}
                    label={k}
                    value={content[k]}
                    onChange={v => onUpdate(k, v)}
                    placeholder=""
                    multiline
                />
            ))}
        </FieldGroup>
    );
}

// ==================== 角色卡片预览 ====================

function CharacterCardPreview({ name, content, onRename }) {
    const { t } = useI18n();
    const c = content || {};
    const catColor = CATEGORY_COLORS.character;
    const roleLabels = {
        protagonist: t('settingsEditor.roles.protagonist'),
        antagonist: t('settingsEditor.roles.antagonist'),
        supporting: t('settingsEditor.roles.supporting'),
        minor: t('settingsEditor.roles.minor')
    };
    const roleLabel = roleLabels[c.role] || c.role || t('settingsEditor.charRole');

    // 头像文字：取名字第一个字
    const avatarChar = (name || t('settingsEditor.unnamedChar'))[0];

    return (
        <div className="character-card-preview" style={{ background: catColor.bg, color: catColor.color, border: `1px solid ${catColor.color}20` }}>
            <div className="character-card-header">
                <div className="character-card-avatar" style={{ background: `linear-gradient(135deg, ${catColor.color}, ${catColor.color}cc)` }}>
                    {avatarChar}
                </div>
                <div className="character-card-info">
                    {onRename ? (
                        <input
                            className="character-card-name-input"
                            value={name || ''}
                            onChange={(e) => onRename(e.target.value)}
                            placeholder={t('settingsEditor.unnamedChar')}
                            spellCheck={false}
                        />
                    ) : (
                        <div className="character-card-name">{name || t('settingsEditor.unnamedChar')}</div>
                    )}
                    <span className="character-card-role" style={{ background: `${catColor.color}18`, color: catColor.color }}>
                        {roleLabel}
                    </span>
                </div>
            </div>
            <div className="character-card-quickinfo">
                {c.gender && <span className="info-item"><span className="info-label">{t('settingsEditor.infoGender')}</span>{c.gender}</span>}
                {c.age && <span className="info-item"><span className="info-label">{t('settingsEditor.infoAge')}</span>{c.age}</span>}
                {c.personality && <span className="info-item"><span className="info-label">{t('settingsEditor.infoPersonality')}</span>{c.personality.length > 20 ? c.personality.slice(0, 20) + '…' : c.personality}</span>}
            </div>
        </div>
    );
}

// ==================== 各分类编辑器 ====================

function CharacterEditor({ node, onUpdate, getAiProps, customRoles, onAddCustomRole, onRemoveCustomRole }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });
    const [customRoleInput, setCustomRoleInput] = useState('');

    const presetRoleLabels = {
        protagonist: t('settingsEditor.roles.protagonist'),
        antagonist: t('settingsEditor.roles.antagonist'),
        supporting: t('settingsEditor.roles.supporting'),
        minor: t('settingsEditor.roles.minor'),
    };

    const resolvedCustomRoles = (() => {
        const list = Array.isArray(customRoles) ? customRoles : [];
        if (content.role && !PRESET_ROLE_KEYS.includes(content.role) && !list.includes(content.role)) {
            return [content.role, ...list];
        }
        return list;
    })();

    return (
        <div>
            <CharacterCardPreview name={node.name} content={content} onRename={(newName) => onUpdate(node.id, { name: newName })} />

            <FieldGroup title={t('settingsEditor.tabBasic')} icon="📋">
                <ButtonGroup label={t('settingsEditor.charRole')} value={content.role} onChange={v => update('role', v)}
                    options={[
                        { value: 'protagonist', label: t('settingsEditor.roles.proLabel') },
                        { value: 'antagonist', label: t('settingsEditor.roles.antLabel') },
                        { value: 'supporting', label: t('settingsEditor.roles.supLabel') },
                        { value: 'minor', label: t('settingsEditor.roles.minLabel') },
                    ]}
                />
                <div style={{ marginTop: 6, marginBottom: 4 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        {t('settingsEditor.customRoleTitle')}
                    </label>
                    {resolvedCustomRoles.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                            {resolvedCustomRoles.map(role => (
                                <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <button
                                        type="button"
                                        onClick={() => update('role', role)}
                                        style={{
                                            padding: '5px 12px', borderRadius: 16, fontSize: 12, border: '1px solid var(--border-light)',
                                            background: content.role === role ? 'var(--accent)' : 'transparent',
                                            color: content.role === role ? 'var(--text-inverse)' : 'var(--text-secondary)',
                                            cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-ui)',
                                        }}
                                    >
                                        {role}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onRemoveCustomRole?.(role)}
                                        title={t('common.delete')}
                                        style={{
                                            padding: '2px 6px', borderRadius: 10, fontSize: 10, border: '1px solid var(--border-light)',
                                            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                                        }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                        <input
                            type="text"
                            value={customRoleInput}
                            onChange={e => setCustomRoleInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const trimmed = customRoleInput.trim();
                                    if (!trimmed) return;
                                    const matchPreset = Object.entries(presetRoleLabels).find(([, label]) => label === trimmed);
                                    if (matchPreset) {
                                        update('role', matchPreset[0]);
                                        setCustomRoleInput('');
                                        return;
                                    }
                                    const added = onAddCustomRole?.(trimmed);
                                    if (added) update('role', added);
                                    setCustomRoleInput('');
                                }
                            }}
                            placeholder={t('settingsEditor.customRolePlaceholder')}
                            style={{
                                flex: 1, padding: '6px 10px', border: '1px solid var(--border-light)', borderRadius: 8,
                                background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-ui)',
                                outline: 'none',
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => {
                                const trimmed = customRoleInput.trim();
                                if (!trimmed) return;
                                const matchPreset = Object.entries(presetRoleLabels).find(([, label]) => label === trimmed);
                                if (matchPreset) {
                                    update('role', matchPreset[0]);
                                    setCustomRoleInput('');
                                    return;
                                }
                                const added = onAddCustomRole?.(trimmed);
                                if (added) update('role', added);
                                setCustomRoleInput('');
                            }}
                            className="btn btn-primary btn-sm"
                            style={{ padding: '6px 10px', fontSize: 11 }}
                        >
                            {t('settingsEditor.customRoleAdd')}
                        </button>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <TextField label={t('settingsEditor.infoGender')} value={content.gender} onChange={v => update('gender', v)} placeholder={t('settingsEditor.charGenderPlaceholder')} />
                    <TextField label={t('settingsEditor.infoAge')} value={content.age} onChange={v => update('age', v)} placeholder={t('settingsEditor.charAgePlaceholder')} />
                </div>
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabAppearance')} icon="✨">
                <TextField
                    label={t('settingsEditor.charAppearance')}
                    value={content.appearance}
                    onChange={v => update('appearance', v)}
                    placeholder={t('settingsEditor.charAppearancePlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'appearance', t('settingsEditor.charAppearance'), t('settingsEditor.charAppearancePlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.charPersonality')}
                    value={content.personality}
                    onChange={v => update('personality', v)}
                    placeholder={t('settingsEditor.charPersonalityPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'personality', t('settingsEditor.charPersonality'), t('settingsEditor.charPersonalityPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.charSpeechStyle')}
                    value={content.speechStyle}
                    onChange={v => update('speechStyle', v)}
                    placeholder={t('settingsEditor.charSpeechStylePlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'speechStyle', t('settingsEditor.charSpeechStyle'), t('settingsEditor.charSpeechStylePlaceholder'))}
                />
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabBackground')} icon="📖" defaultCollapsed>
                <TextField
                    label={t('settingsEditor.charBackground')}
                    value={content.background}
                    onChange={v => update('background', v)}
                    placeholder={t('settingsEditor.charBackgroundPlaceholder')}
                    multiline
                    rows={4}
                    aiBtn
                    ai={getAiProps?.(node, 'background', t('settingsEditor.charBackground'), t('settingsEditor.charBackgroundPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.charMotivation')}
                    value={content.motivation}
                    onChange={v => update('motivation', v)}
                    placeholder={t('settingsEditor.charMotivationPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'motivation', t('settingsEditor.charMotivation'), t('settingsEditor.charMotivationPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.charArc')}
                    value={content.arc}
                    onChange={v => update('arc', v)}
                    placeholder={t('settingsEditor.charArcPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'arc', t('settingsEditor.charArc'), t('settingsEditor.charArcPlaceholder'))}
                />
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabSkills')} icon="⚔️" defaultCollapsed>
                <TextField
                    label={t('settingsEditor.charSkills')}
                    value={content.skills}
                    onChange={v => update('skills', v)}
                    placeholder={t('settingsEditor.charSkillsPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'skills', t('settingsEditor.charSkills'), t('settingsEditor.charSkillsPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.charRelationships')}
                    value={content.relationships}
                    onChange={v => update('relationships', v)}
                    placeholder={t('settingsEditor.charRelationshipsPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'relationships', t('settingsEditor.charRelationships'), t('settingsEditor.charRelationshipsPlaceholder'))}
                />
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabNotes')} icon="📝" defaultCollapsed>
                <TextField label={t('settingsEditor.charNotes')} value={content.notes} onChange={v => update('notes', v)} placeholder={t('settingsEditor.charNotesPlaceholder')} multiline />
            </FieldGroup>

            <ExtraFieldsSection content={content} knownFields={['role', 'age', 'gender', 'appearance', 'personality', 'speechStyle', 'background', 'motivation', 'arc', 'skills', 'relationships', 'notes']} onUpdate={update} />
        </div>
    );
}

function LocationEditor({ node, onUpdate, getAiProps }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <FieldGroup title={t('settingsEditor.tabBasic')} icon="📋">
                <TextField
                    label={t('settingsEditor.locDescription')}
                    value={content.description}
                    onChange={v => update('description', v)}
                    placeholder={t('settingsEditor.locDescriptionPlaceholder')}
                    multiline
                    rows={4}
                    aiBtn
                    ai={getAiProps?.(node, 'description', t('settingsEditor.locDescription'), t('settingsEditor.locDescriptionPlaceholder'))}
                />
                <TextField label={t('settingsEditor.locSlugline')} value={content.slugline} onChange={v => update('slugline', v)} placeholder={t('settingsEditor.locSluglinePlaceholder')} />
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabSensory')} icon="👁">
                <TextField
                    label={t('settingsEditor.locVisual')}
                    value={content.sensoryVisual}
                    onChange={v => update('sensoryVisual', v)}
                    placeholder={t('settingsEditor.locVisualPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'sensoryVisual', t('settingsEditor.locVisual'), t('settingsEditor.locVisualPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.locAudio')}
                    value={content.sensoryAudio}
                    onChange={v => update('sensoryAudio', v)}
                    placeholder={t('settingsEditor.locAudioPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'sensoryAudio', t('settingsEditor.locAudio'), t('settingsEditor.locAudioPlaceholder'))}
                />
                <TextField
                    label={t('settingsEditor.locSmell')}
                    value={content.sensorySmell}
                    onChange={v => update('sensorySmell', v)}
                    placeholder={t('settingsEditor.locSmellPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'sensorySmell', t('settingsEditor.locSmell'), t('settingsEditor.locSmellPlaceholder'))}
                />
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabMood')} icon="🌙" defaultCollapsed>
                <TextField label={t('settingsEditor.locMood')} value={content.mood} onChange={v => update('mood', v)} placeholder={t('settingsEditor.locMoodPlaceholder')} />
                <ButtonGroup label={t('settingsEditor.locDangerLevel')} value={content.dangerLevel} onChange={v => update('dangerLevel', v)}
                    options={[
                        { value: 'safe', label: t('settingsEditor.dangerSafe') },
                        { value: 'caution', label: t('settingsEditor.dangerCaution') },
                        { value: 'danger', label: t('settingsEditor.dangerHigh') },
                    ]}
                />
            </FieldGroup>

            <ExtraFieldsSection content={content} knownFields={['description', 'slugline', 'sensoryVisual', 'sensoryAudio', 'sensorySmell', 'mood', 'dangerLevel']} onUpdate={update} />
        </div>
    );
}

function ObjectEditor({ node, onUpdate, getAiProps }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <FieldGroup title={t('settingsEditor.tabBasic')} icon="📋">
                <TextField
                    label={t('settingsEditor.objDescription')}
                    value={content.description}
                    onChange={v => update('description', v)}
                    placeholder={t('settingsEditor.objDescriptionPlaceholder')}
                    multiline
                    rows={4}
                    aiBtn
                    ai={getAiProps?.(node, 'description', t('settingsEditor.objDescription'), t('settingsEditor.objDescriptionPlaceholder'))}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <TextField label={t('settingsEditor.objType')} value={content.objectType} onChange={v => update('objectType', v)} placeholder={t('settingsEditor.objTypePlaceholder')} />
                    <TextField label={t('settingsEditor.objRank')} value={content.rank} onChange={v => update('rank', v)} placeholder={t('settingsEditor.objRankPlaceholder')} />
                </div>
            </FieldGroup>

            <FieldGroup title={t('settingsEditor.tabStats')} icon="📊" defaultCollapsed>
                <TextField label={t('settingsEditor.objHolder')} value={content.currentHolder} onChange={v => update('currentHolder', v)} placeholder={t('settingsEditor.objHolderPlaceholder')} />
                <TextField label={t('settingsEditor.objStats')} value={content.numericStats} onChange={v => update('numericStats', v)} placeholder={t('settingsEditor.objStatsPlaceholder')} multiline />
                <TextField
                    label={t('settingsEditor.objSymbolism')}
                    value={content.symbolism}
                    onChange={v => update('symbolism', v)}
                    placeholder={t('settingsEditor.objSymbolismPlaceholder')}
                    multiline
                    aiBtn
                    ai={getAiProps?.(node, 'symbolism', t('settingsEditor.objSymbolism'), t('settingsEditor.objSymbolismPlaceholder'))}
                />
            </FieldGroup>

            <ExtraFieldsSection content={content} knownFields={['description', 'objectType', 'rank', 'currentHolder', 'numericStats', 'symbolism']} onUpdate={update} />
        </div>
    );
}

function WorldEditor({ node, onUpdate, getAiProps }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <TextField
                label={t('settingsEditor.worldDescription')}
                value={content.description}
                onChange={v => update('description', v)}
                placeholder={t('settingsEditor.worldDescriptionPlaceholder')}
                multiline
                rows={6}
                aiBtn
                ai={getAiProps?.(node, 'description', t('settingsEditor.worldDescription'), t('settingsEditor.worldDescriptionPlaceholder'))}
            />
            <TextField label={t('settingsEditor.worldNotes')} value={content.notes} onChange={v => update('notes', v)} placeholder={t('settingsEditor.worldNotesPlaceholder')} multiline />
            <ExtraFieldsSection content={content} knownFields={['description', 'notes']} onUpdate={update} />
        </div>
    );
}

function PlotEditor({ node, onUpdate, getAiProps }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <ButtonGroup label={t('settingsEditor.plotStatus')} value={content.status} onChange={v => update('status', v)}
                options={[
                    { value: 'planned', label: t('settingsEditor.statusPlanned') },
                    { value: 'writing', label: t('settingsEditor.statusWriting') },
                    { value: 'done', label: t('settingsEditor.statusDone') },
                ]}
            />
            <TextField
                label={t('settingsEditor.plotDescription')}
                value={content.description}
                onChange={v => update('description', v)}
                placeholder={t('settingsEditor.plotDescriptionPlaceholder')}
                multiline
                rows={6}
                aiBtn
                ai={getAiProps?.(node, 'description', t('settingsEditor.plotDescription'), t('settingsEditor.plotDescriptionPlaceholder'))}
            />
            <TextField label={t('settingsEditor.plotNotes')} value={content.notes} onChange={v => update('notes', v)} placeholder={t('settingsEditor.plotNotesPlaceholder')} multiline />
            <ExtraFieldsSection content={content} knownFields={['status', 'description', 'notes']} onUpdate={update} />
        </div>
    );
}

function RulesEditor({ node, onUpdate }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <TextField label={t('settingsEditor.rulesDescription')} value={content.description} onChange={v => update('description', v)}
                placeholder={t('settingsEditor.rulesDescriptionPlaceholder')} multiline rows={6} />
            <ExtraFieldsSection content={content} knownFields={['description']} onUpdate={update} />
        </div>
    );
}

function GenericEditor({ node, onUpdate }) {
    const { t } = useI18n();
    const content = node.content || {};
    const update = (field, value) => onUpdate(node.id, { content: { ...content, [field]: value } });

    return (
        <div>
            <TextField label={t('settingsEditor.genericDescription')} value={content.description} onChange={v => update('description', v)} placeholder={t('settingsEditor.genericDescriptionPlaceholder')} multiline rows={6} />
            <TextField label={t('settingsEditor.genericNotes')} value={content.notes} onChange={v => update('notes', v)} placeholder={t('settingsEditor.genericNotesPlaceholder')} multiline />
            <ExtraFieldsSection content={content} knownFields={['description', 'notes']} onUpdate={update} />
        </div>
    );
}

// ==================== 面包屑导航 ====================

function Breadcrumb({ node, allNodes, onSelect }) {
    const path = [];
    let current = node;
    while (current) {
        path.unshift(current);
        current = current.parentId ? allNodes.find(n => n.id === current.parentId) : null;
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, flexWrap: 'wrap' }}>
            {path.map((p, i) => (
                <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
                    <span
                        onClick={() => onSelect(p.id)}
                        style={{ cursor: 'pointer', color: i === path.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: i === path.length - 1 ? 600 : 400, transition: 'color 0.15s' }}
                        onMouseEnter={e => e.target.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.target.style.color = i === path.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)'}
                    >
                        {p.icon} {p.name}
                    </span>
                </span>
            ))}
        </div>
    );
}

// ==================== 文件夹信息 ====================

function FolderInfo({ node, nodes, onAdd }) {
    const { t } = useI18n();
    const catColor = CATEGORY_COLORS[node.category] || CATEGORY_COLORS.custom;
    const children = nodes.filter(n => n.parentId === node.id);
    const folders = children.filter(n => n.type === 'folder');
    const items = children.filter(n => n.type === 'item');

    return (
        <div>
            <div style={{
                padding: 24, borderRadius: 'var(--radius-md)', background: catColor.bg,
                border: `1px solid ${catColor.color}20`, marginBottom: 20, textAlign: 'center',
            }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>{node.icon || '📁'}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>{node.name}</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {folders.length > 0 && `${folders.length} 个子文件夹 · `}
                    {items.length} 个设定项
                </p>
            </div>

            {children.length === 0 && (
                <div className="settings-empty-state">
                    <div className="empty-icon">📝</div>
                    <h3>{t('settingsEditor.emptyTitle')}</h3>
                    <p>{t('settingsEditor.emptyDesc')}</p>
                </div>
            )}

            <button
                className="tree-ai-generate-btn"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                onClick={() => onAdd(node.id, node.category)}
            >
                {t('settingsEditor.addBtn')}
            </button>
        </div>
    );
}

// ==================== 空状态 ====================

function EmptyState() {
    const { t } = useI18n();
    return (
        <div className="settings-empty-state">
            <div className="empty-icon">🎯</div>
            <h3>{t('settingsEditor.selectTitle')}</h3>
            <p>{t('settingsEditor.selectDesc')}</p>
        </div>
    );
}

// ==================== 主组件 ====================

export default function SettingsItemEditor({ selectedNode, allNodes, onUpdate, onSelect, onAdd }) {
    const { t } = useI18n();
    const { showToast, activeChapterId, contextSelection } = useAppStore();
    const [aiLoading, setAiLoading] = useState(new Set());
    const [customRoles, setCustomRoles] = useState(() => {
        const settings = getProjectSettings();
        return Array.isArray(settings?.customRoles) ? settings.customRoles : [];
    });

    const handleAddCustomRole = useCallback((role) => {
        const name = role?.trim();
        if (!name) return null;
        const settings = getProjectSettings();
        const existing = Array.isArray(settings?.customRoles) ? settings.customRoles : [];
        if (existing.includes(name)) return name;
        const next = [...existing, name];
        saveProjectSettings({ ...settings, customRoles: next });
        setCustomRoles(next);
        return name;
    }, []);

    const handleRemoveCustomRole = useCallback((role) => {
        const settings = getProjectSettings();
        const existing = Array.isArray(settings?.customRoles) ? settings.customRoles : [];
        const next = existing.filter(r => r !== role);
        saveProjectSettings({ ...settings, customRoles: next });
        setCustomRoles(next);
    }, []);

    const setAiLoadingFlag = useCallback((key, loading) => {
        setAiLoading(prev => {
            const next = new Set(prev);
            if (loading) next.add(key);
            else next.delete(key);
            return next;
        });
    }, []);

    const handleAiFill = useCallback(async ({ node, fieldKey, label }) => {
        if (!node || !fieldKey) return;
        const loadingKey = `${node.id}:${fieldKey}`;
        if (aiLoading.has(loadingKey)) return;

        const { apiConfig } = getProjectSettings();
        if (!apiConfig?.apiKey) {
            showToast('请先在 API 配置中填写 Key', 'error');
            return;
        }

        setAiLoadingFlag(loadingKey, true);
        try {
            const categoryLabel = t(`settings.categories.${node.category}`) || node.category;
            const name = node.name || '未命名';
            const currentValue = node.content?.[fieldKey] || '';
            const actionHint = currentValue.trim() ? '在保留原意基础上补充润色' : '生成';

            const roleLabels = {
                protagonist: t('settingsEditor.roles.protagonist'),
                antagonist: t('settingsEditor.roles.antagonist'),
                supporting: t('settingsEditor.roles.supporting'),
                minor: t('settingsEditor.roles.minor'),
            };
            const roleLabel = roleLabels[node.content?.role] || node.content?.role || '';

            const extraHints = [];
            if (roleLabel) extraHints.push(`角色身份：${roleLabel}。`);
            if (fieldKey === 'relationships') {
                extraHints.push(`关系描述只写与“${name}”相关的其他角色，避免用“主角/男主/女主/反派”等泛称指代该角色本人。`);
                const otherNames = (allNodes || [])
                    .filter(n => n.type === 'item' && n.category === 'character' && n.id !== node.id)
                    .map(n => n.name)
                    .filter(Boolean);
                if (otherNames.length > 0) {
                    extraHints.push(`可参考角色：${otherNames.slice(0, 8).join('、')}。`);
                }
            }

            const instruction = `请为${categoryLabel}「${name}」的「${label || fieldKey}」${actionHint}。要求：中文，简洁，2-4句，不要标题、不要列表、不要引号，只输出内容本身。${extraHints.length ? `\n补充要求：${extraHints.join(' ')}` : ''}`;
            const userPrompt = currentValue.trim()
                ? `${instruction}\n\n现有内容：${currentValue.trim()}`
                : instruction;

            const queryText = [name, label, currentValue].filter(Boolean).join(' ');
            const context = await buildContext(activeChapterId, queryText, contextSelection?.size ? contextSelection : null);
            const systemPrompt = compileSystemPrompt(context, 'chat');
            const apiEndpoint = apiConfig?.provider === 'gemini-native' ? '/api/ai/gemini' : '/api/ai';

            const output = await streamAiText({
                apiEndpoint,
                systemPrompt,
                userPrompt,
                apiConfig,
                maxTokens: 600,
            });

            let cleaned = output.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
            }
            cleaned = cleaned.replace(/^["“”]+|["“”]+$/g, '').trim();
            if (!cleaned) {
                showToast('AI 返回为空，请重试', 'error');
                return;
            }

            onUpdate(node.id, { content: { ...(node.content || {}), [fieldKey]: cleaned } });
            showToast('AI 已填充', 'success');
        } catch (err) {
            console.error('AI 填写失败:', err);
            showToast(`AI 填写失败：${err.message || '未知错误'}`, 'error');
        } finally {
            setAiLoadingFlag(loadingKey, false);
        }
    }, [activeChapterId, aiLoading, allNodes, contextSelection, onUpdate, setAiLoadingFlag, showToast, t]);

    const getAiProps = useCallback((node, fieldKey, label) => {
        const key = `${node.id}:${fieldKey}`;
        return {
            loading: aiLoading.has(key),
            onClick: () => handleAiFill({ node, fieldKey, label }),
        };
    }, [aiLoading, handleAiFill]);

    if (!selectedNode) return <EmptyState />;

    // 文件夹 → 显示文件夹信息
    if (selectedNode.type === 'folder' || selectedNode.type === 'special') {
        return (
            <div style={{ padding: 20 }}>
                <Breadcrumb node={selectedNode} allNodes={allNodes} onSelect={onSelect} />
                <FolderInfo node={selectedNode} nodes={allNodes} onAdd={onAdd} />
            </div>
        );
    }

    // item → 显示对应编辑器
    const editorMap = {
        character: CharacterEditor,
        location: LocationEditor,
        object: ObjectEditor,
        world: WorldEditor,
        plot: PlotEditor,
        rules: RulesEditor,
        custom: GenericEditor,
    };
    const EditorComponent = editorMap[selectedNode.category] || GenericEditor;

    return (
        <div style={{ padding: 20 }}>
            <Breadcrumb node={selectedNode} allNodes={allNodes} onSelect={onSelect} />
            <EditorComponent
                node={selectedNode}
                onUpdate={onUpdate}
                getAiProps={getAiProps}
                customRoles={customRoles}
                onAddCustomRole={handleAddCustomRole}
                onRemoveCustomRole={handleRemoveCustomRole}
            />
        </div>
    );
}
