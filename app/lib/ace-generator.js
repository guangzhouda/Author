'use client';

// ACE Generator module:
// - Responsible for injecting the selected playbook bullets into the Generator's system prompt.

export function injectAceAddonIntoSystemPrompt(systemPrompt, addonText) {
    if (!addonText) return systemPrompt || '';
    const sep = '\n\n---\n\n';
    const base = String(systemPrompt || '');
    const parts = base.split(sep);
    const aceSection = `【ACE Playbook（对话记忆，仅供参考）】\n${addonText}`;

    // Keep it near the tail so it's salient, but before the final instruction block when possible.
    if (parts.length >= 2) parts.splice(parts.length - 1, 0, aceSection);
    else parts.push(aceSection);
    return parts.join(sep);
}

