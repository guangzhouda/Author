/**
 * 项目导出/导入 — 将数据打包为 JSON 文件（用于备份/迁移/回退）
 *
 * ⚠️ 注意：
 * - 核心数据（章节、设定集、聊天会话）已迁移到 IndexedDB，本文件应以 IndexedDB 为准。
 * - 出于安全考虑，导出/导入默认不会包含 API Key（需要用户在设置里重新填写）。
 */

import { getChapters, saveChapters, getChapterSummary, saveChapterSummary } from './storage';
import { getSettingsNodes, saveSettingsNodes, getActiveWorkId, setActiveWorkId, getProjectSettings, saveProjectSettings } from './settings';
import { loadSessionStore, saveSessionStore } from './chat-sessions';
import { exportAllAcePlaybooks, importAllAcePlaybooks } from './ace-playbook';
import { peekChapterOutline, saveChapterOutline } from './chapter-outline';

const PROJECT_FILE_VERSION = 2;

// 需要导出的所有 localStorage keys
const STORAGE_KEYS = {
    chapters: 'author-chapters',
    settings: 'author-project-settings',
    settingsNodes: 'author-settings-nodes',
    activeWork: 'author-active-work',
    chatSessions: 'author-chat-sessions',
};

// 章节摘要前缀
const SUMMARY_PREFIX = 'author-chapter-summary-';

function stripSecretsFromSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    const safe = { ...settings };
    if (safe.apiConfig && typeof safe.apiConfig === 'object') {
        safe.apiConfig = { ...safe.apiConfig };
        // Do not export/import secrets.
        delete safe.apiConfig.apiKey;
        delete safe.apiConfig.embedApiKey;
    }
    return safe;
}

/**
 * 导出整个项目为 JSON 文件并下载
 */
export async function exportProject() {
    if (typeof window === 'undefined') return;

    const data = {
        _version: PROJECT_FILE_VERSION,
        _exportedAt: new Date().toISOString(),
        _app: 'Author',
    };

    // 核心数据：以 IndexedDB 为准（兼容旧版 localStorage 迁移逻辑由各模块内部处理）
    try {
        data.chapters = await getChapters();
    } catch {
        data.chapters = [];
    }
    try {
        data.settingsNodes = await getSettingsNodes();
    } catch {
        data.settingsNodes = null;
    }
    try {
        data.chatSessions = await loadSessionStore();
    } catch {
        data.chatSessions = { activeSessionId: null, sessions: [] };
    }

    // ACE playbooks (chat memory) — stored in IndexedDB.
    try {
        data.acePlaybooks = await exportAllAcePlaybooks();
    } catch {
        data.acePlaybooks = {};
    }

    // 项目设定（localStorage），去除 API Key
    try {
        data.settings = stripSecretsFromSettings(getProjectSettings());
    } catch {
        data.settings = null;
    }
    try {
        data.activeWork = getActiveWorkId();
    } catch {
        data.activeWork = null;
    }

    // 章节摘要：按章节 ID 逐个读取（避免遍历 IndexedDB key）
    const summaries = {};
    try {
        const chapters = Array.isArray(data.chapters) ? data.chapters : [];
        for (const ch of chapters) {
            const sid = ch?.id;
            if (!sid) continue;
            const summary = await getChapterSummary(sid);
            if (summary) summaries[sid] = summary;
        }
    } catch { }
    data.chapterSummaries = summaries;

    // 章节大纲（章纲）：按章节 ID 逐个读取（避免遍历 IndexedDB key）
    const outlines = {};
    try {
        const chapters = Array.isArray(data.chapters) ? data.chapters : [];
        for (const ch of chapters) {
            const cid = ch?.id;
            if (!cid) continue;
            const outline = await peekChapterOutline(cid);
            if (outline && (outline.rough || outline.detailed)) outlines[cid] = outline;
        }
    } catch { }
    data.chapterOutlines = outlines;

    // 生成文件名
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `Author_存档_${dateStr}.json`;

    // 下载
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return fileName;
}

/**
 * 从 JSON 文件导入项目数据
 * @param {File} file - 用户选择的 JSON 文件
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function importProject(file) {
    if (typeof window === 'undefined') return { success: false, message: '环境不支持' };

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        // 基本校验
        if (!data._app || data._app !== 'Author') {
            return { success: false, message: '文件格式不正确，不是 Author 存档文件' };
        }

        // 恢复章节（IndexedDB）
        if (Array.isArray(data.chapters)) {
            await saveChapters(data.chapters);
        } else if (data.chapters === null && data._version === 1) {
            // old export might not include chapters
        }

        // 恢复设定节点（IndexedDB）
        if (Array.isArray(data.settingsNodes)) {
            await saveSettingsNodes(data.settingsNodes);
        }

        // 恢复聊天会话（IndexedDB）
        if (data.chatSessions && typeof data.chatSessions === 'object') {
            await saveSessionStore(data.chatSessions);
        }

        // 恢复 ACE Playbooks（IndexedDB）
        if (data.acePlaybooks && typeof data.acePlaybooks === 'object') {
            await importAllAcePlaybooks(data.acePlaybooks);
        }

        // 恢复章节摘要（IndexedDB）
        if (data.chapterSummaries && typeof data.chapterSummaries === 'object') {
            for (const [chapterId, summary] of Object.entries(data.chapterSummaries)) {
                if (summary) {
                    await saveChapterSummary(chapterId, summary);
                }
            }
        }

        // 恢复章节大纲（章纲）：IndexedDB
        if (data.chapterOutlines && typeof data.chapterOutlines === 'object') {
            for (const [chapterId, outline] of Object.entries(data.chapterOutlines)) {
                if (outline && typeof outline === 'object') {
                    await saveChapterOutline(chapterId, outline);
                }
            }
        }

        // 恢复项目设定（localStorage），去除 API Key
        if (data.settings && typeof data.settings === 'object') {
            saveProjectSettings(stripSecretsFromSettings(data.settings));
        }
        if (typeof data.activeWork === 'string' && data.activeWork) {
            setActiveWorkId(data.activeWork);
        }

        const extraNote = '（API Key 出于安全考虑不会随存档导入，请在设置中重新填写）';
        return { success: true, message: `成功导入存档（导出时间：${data._exportedAt || '未知'}）${extraNote}` };
    } catch (err) {
        return { success: false, message: `导入失败：${err.message}` };
    }
}

/**
 * 获取当前项目数据的概要信息（用于显示）
 */
export function getProjectSummary() {
    if (typeof window === 'undefined') return null;

    try {
        const chaptersRaw = localStorage.getItem(STORAGE_KEYS.chapters);
        const chapters = chaptersRaw ? JSON.parse(chaptersRaw) : [];
        const nodesRaw = localStorage.getItem(STORAGE_KEYS.settingsNodes);
        const nodes = nodesRaw ? JSON.parse(nodesRaw) : [];
        const sessionsRaw = localStorage.getItem(STORAGE_KEYS.chatSessions);
        const sessions = sessionsRaw ? JSON.parse(sessionsRaw) : {};

        return {
            chapterCount: chapters.length,
            settingsNodeCount: nodes.length,
            sessionCount: Object.keys(sessions.sessions || {}).length,
            totalChars: chapters.reduce((sum, ch) => sum + (ch.content?.length || 0), 0),
        };
    } catch {
        return null;
    }
}
