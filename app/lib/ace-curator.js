'use client';

// ACE Curator module:
// - Decides incremental playbook updates (operations) using current playbook + reflector candidates
// - Does NOT tag bullets (no bullet_tags output)

export function buildAceCuratorPrompts({ currentPlaybookText, reflectorCandidates, userText, assistantText }) {
    const playbook = (currentPlaybookText || '').trim();
    const cands = Array.isArray(reflectorCandidates) ? reflectorCandidates : [];
    const safeCands = cands.slice(0, 8).map(x => ({
        section: (x?.section || '').toString().trim(),
        content: (x?.content || '').toString().trim(),
    })).filter(x => x.section && x.content);

    const u = String(userText || '').slice(0, 2500);
    const a = String(assistantText || '').slice(0, 2500);

    const systemPrompt = [
        '你是 ACE (Agentic Context Engineering) 框架中的 Curator。',
        '你只做“增量写入/演化 playbook”，不做反思评分（不输出 bullet_tags）。',
        '目标：把本轮对话中“未来仍然有用且稳定”的信息，增量写入 playbook，避免上下文坍塌与过度摘要。',
        '规则：',
        '- 只输出严格 JSON（不要 markdown/代码块）。',
        '- 只允许输出 operations 的增量更新，不要重写整个 playbook。',
        '- operations 仅使用 type=ADD。',
        '- 避免冗余：如果 playbook 已包含同样信息，就不要再添加。',
        '- 不要记录任何密钥、token、隐私或可识别个人信息。',
        '- 每次最多输出 5 条 ADD。',
        '可用 section: preferences, project, workflow, open_threads, misc',
    ].join('\n');

    const userPrompt = [
        '【当前 Playbook】',
        playbook || '(empty)',
        '',
        '【Reflector 给出的记忆候选（你可以筛选/改写/丢弃）】',
        safeCands.length ? JSON.stringify(safeCands, null, 2) : '(none)',
        '',
        '【本次对话（用于核对上下文）】',
        `用户：${u}`,
        `助手：${a}`,
        '',
        '请输出 JSON：',
        '{',
        '  "notes": "...",',
        '  "operations": [',
        '    {"type":"ADD","section":"preferences|project|workflow|open_threads|misc","content":"..."}',
        '  ]',
        '}',
    ].join('\n');

    return { systemPrompt, userPrompt, maxTokens: 900, temperature: 0.2 };
}
