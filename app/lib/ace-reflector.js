'use client';

// ACE Reflector module:
// - Tags injected bullets as helpful/harmful/neutral for this turn
// - Extracts memory candidates for the Curator (but does NOT output operations)

export function buildAceReflectorPrompts({ injectedBulletsText, userText, assistantText }) {
    const injected = (injectedBulletsText || '').trim();
    const u = String(userText || '').slice(0, 3000);
    const a = String(assistantText || '').slice(0, 3000);

    const systemPrompt = [
        '你是 ACE (Agentic Context Engineering) 框架中的 Reflector。',
        '你只做“反思/评估”，不做 playbook 写入操作（不输出 operations）。',
        '你的任务：',
        '1) 仅针对“本轮注入的 bullets”，给出 helpful/harmful/neutral 标签（保守：不确定就 neutral）。',
        '2) 从本轮对话中提取“未来仍然有用且稳定”的记忆候选（memory_candidates），供 Curator 决策是否写入 playbook。',
        '规则：',
        '- 只输出严格 JSON（不要 markdown/代码块）。',
        '- bullet_tags 最多 12 条；id 必须是 playbook bullet 的原始 id（如 ace-00001）。',
        '- memory_candidates 最多 5 条；不要包含任何密钥、token、隐私或可识别个人信息。',
        '- 只记录用户明确表达的、可长期复用的偏好/约束/事实/工作流/未决事项；不要记录一次性临时指令。',
        '- section 只能取：preferences, project, workflow, open_threads, misc',
    ].join('\n');

    const userPrompt = [
        '【本轮注入的 Bullets】',
        injected ? injected.slice(0, 2000) : '(none)',
        '',
        '【本次对话】',
        `用户：${u}`,
        `助手：${a}`,
        '',
        '请输出 JSON：',
        '{',
        '  "notes": "...",',
        '  "bullet_tags": [',
        '    {"id":"ace-00001","tag":"helpful|harmful|neutral"}',
        '  ],',
        '  "memory_candidates": [',
        '    {"section":"preferences|project|workflow|open_threads|misc","content":"..."}',
        '  ]',
        '}',
    ].join('\n');

    return { systemPrompt, userPrompt, maxTokens: 900, temperature: 0.2 };
}
