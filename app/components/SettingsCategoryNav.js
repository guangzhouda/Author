'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/useI18n';

// 分类的颜色和标识
const CATEGORY_STYLES = {
  work: { color: 'var(--cat-work)', bg: 'var(--cat-work-bg)' },
  bookInfo: { color: 'var(--cat-bookinfo)', bg: 'var(--cat-bookinfo-bg)' },
  character: { color: 'var(--cat-character)', bg: 'var(--cat-character-bg)' },
  location: { color: 'var(--cat-location)', bg: 'var(--cat-location-bg)' },
  world: { color: 'var(--cat-world)', bg: 'var(--cat-world-bg)' },
  object: { color: 'var(--cat-object)', bg: 'var(--cat-object-bg)' },
  plot: { color: 'var(--cat-plot)', bg: 'var(--cat-plot-bg)' },
  rules: { color: 'var(--cat-rules)', bg: 'var(--cat-rules-bg)' },
  custom: { color: 'var(--cat-custom)', bg: 'var(--cat-custom-bg)' },
};

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.custom;
}

function buildChildrenMap(nodes) {
  const map = new Map();
  for (const n of nodes) {
    const pid = n.parentId || null;
    const arr = map.get(pid);
    if (arr) arr.push(n);
    else map.set(pid, [n]);
  }
  return map;
}

function collectSubtreeIds(rootId, childrenMap) {
  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    const kids = childrenMap.get(id) || [];
    for (const k of kids) {
      if (ids.has(k.id)) continue;
      ids.add(k.id);
      if (k.type !== 'item') stack.push(k.id);
    }
  }
  return ids;
}

function nodeMatchesQuery(node, q) {
  if (!q) return true;
  const name = (node.name || '').toLowerCase();
  if (name.includes(q)) return true;

  // Try a few common fields first (fast path)
  const c = node.content || {};
  const fields = [
    c.description,
    c.personality,
    c.background,
    c.appearance,
    c.notes,
  ].filter(Boolean).map(String);
  for (const f of fields) {
    if (f.toLowerCase().includes(q)) return true;
  }

  // Fallback: shallow stringify content (avoid huge overhead)
  try {
    const s = JSON.stringify(c);
    if (s && s.toLowerCase().includes(q)) return true;
  } catch { /* ignore */ }
  return false;
}

function TreeRow({
  node,
  nodes,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  onToggleEnabled,
  collapsedIds,
  onToggleCollapse,
  level = 0,
  isCategoryRoot = false,
}) {
  const { t } = useI18n();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const children = useMemo(() => nodes.filter(n => n.parentId === node.id), [nodes, node.id]);
  const isFolder = node.type === 'folder' || node.type === 'special';
  const isCollapsed = collapsedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isDisabled = node.enabled === false;

  const descendantCount = useMemo(() => {
    if (!isFolder) return 0;
    let count = 0;
    const countChildren = (parentId) => {
      nodes.filter(n => n.parentId === parentId).forEach(child => {
        if (child.type === 'item') count++;
        else countChildren(child.id);
      });
    };
    countChildren(node.id);
    return count;
  }, [node.id, nodes, isFolder]);

  const handleRenameCommit = () => {
    if (renameValue.trim()) onRename(node.id, renameValue.trim());
    setIsRenaming(false);
  };

  return (
    <div className="tree-node" style={{ paddingLeft: level > 0 ? 12 : 0 }}>
      <div
        className={`tree-node-row ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
        onClick={() => onSelect(node.id)}
        title={isDisabled ? t('settingsTree.disabledHint') : ''}
      >
        {/* 折叠箭头 */}
        {isFolder && (
          <span
            className="tree-node-icon"
            onClick={e => { e.stopPropagation(); onToggleCollapse(node.id); }}
            style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10 }}
          >
            {isCollapsed ? '▶' : '▼'}
          </span>
        )}

        {/* 图标 */}
        <span className="tree-node-icon">{node.icon || (isFolder ? '📁' : '📄')}</span>

        {/* 名称 */}
        {isRenaming ? (
          <input
            className="tree-node-name"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameCommit(); if (e.key === 'Escape') setIsRenaming(false); }}
            autoFocus
            onClick={e => e.stopPropagation()}
            style={{ border: '1px solid var(--accent)', borderRadius: 3, padding: '1px 4px', fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
          />
        ) : (
          <span className="tree-node-name">{node.name}</span>
        )}

        {/* 启用/禁用开关（仅 item 节点） */}
        {!isFolder && (
          <button
            className={`tree-toggle-btn ${isDisabled ? 'visible' : ''}`}
            onClick={e => { e.stopPropagation(); onToggleEnabled(node.id); }}
            title={isDisabled ? t('settingsTree.enableHint') : t('settingsTree.disableHint')}
            style={{ opacity: isDisabled ? 1 : 0 }}
          >
            {isDisabled ? '🚫' : '👁'}
          </button>
        )}

        {/* 数量 badge（folder） */}
        {isFolder && descendantCount > 0 && (
          <span className="tree-node-badge" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {descendantCount}
          </span>
        )}

        {/* 操作按钮 */}
        <span className="tree-node-actions">
          {/* 添加子项：仅 folder */}
          {isFolder && (
            <button className="tree-action-btn" onClick={e => { e.stopPropagation(); onAdd(node.id, node.category); }} title={t('settingsTree.add')}>＋</button>
          )}
          {/* 重命名：不允许改分类根节点（避免改坏结构） */}
          {!isCategoryRoot && (
            <button className="tree-action-btn" onClick={e => { e.stopPropagation(); setRenameValue(node.name); setIsRenaming(true); }} title={t('common.rename')}>✏</button>
          )}
          {/* 删除：不允许删分类根节点 */}
          {!isCategoryRoot && (
            <button className="tree-action-btn danger" onClick={e => { e.stopPropagation(); onDelete(node.id); }} title={t('common.delete')}>✕</button>
          )}
        </span>
      </div>

      {/* 子节点 */}
      {isFolder && !isCollapsed && (
        <div className="tree-node-children">
          {children
            .sort((a, b) => (a.type === 'folder' ? -1 : 1) - (b.type === 'folder' ? -1 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0))
            .map(child => (
              <TreeRow
                key={child.id}
                node={child}
                nodes={nodes}
                selectedId={selectedId}
                onSelect={onSelect}
                onAdd={onAdd}
                onDelete={onDelete}
                onRename={onRename}
                onToggleEnabled={onToggleEnabled}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
                level={level + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsCategoryNav({
  nodes,
  activeWorkId,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  onToggleEnabled,
  searchQuery = '',
  expandedCategory = null,
  onExpandComplete,
}) {
  const { t } = useI18n();
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [collapsedIds, setCollapsedIds] = useState(new Set());

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const toggleSection = (id) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCollapse = (id) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const q = searchQuery.trim().toLowerCase();

  // 搜索过滤：只保留匹配节点 + 到根的路径
  const filteredNodes = useMemo(() => {
    if (!q) return nodes;
    const matchIds = new Set();
    for (const n of nodes) {
      if (nodeMatchesQuery(n, q)) {
        let cur = n;
        while (cur) {
          matchIds.add(cur.id);
          cur = cur.parentId ? nodeById.get(cur.parentId) : null;
        }
      }
    }
    return nodes.filter(n => matchIds.has(n.id));
  }, [nodes, q, nodeById]);

  const childrenMap = useMemo(() => buildChildrenMap(filteredNodes), [filteredNodes]);

  const categoryRoots = useMemo(() => {
    if (!activeWorkId) return [];
    return filteredNodes
      .filter(n => n.parentId === activeWorkId && (n.type === 'folder' || n.type === 'special'))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [filteredNodes, activeWorkId]);

  const bookInfoNode = useMemo(() => categoryRoots.find(n => n.type === 'special' && n.category === 'bookInfo') || null, [categoryRoots]);
  const sectionRoots = useMemo(() => categoryRoots.filter(n => n !== bookInfoNode), [categoryRoots, bookInfoNode]);

  // 外部触发展开某个分类（统计栏 badge 点击）
  useEffect(() => {
    if (!expandedCategory) return;
    const target = categoryRoots.find(n => n.type === 'folder' && n.category === expandedCategory);
    if (target) {
      setCollapsedSections(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      onSelect(target.id);
      onExpandComplete?.();
    }
  }, [expandedCategory, categoryRoots, onSelect, onExpandComplete]);

  // 搜索时自动展开所有分类，便于查看结果
  useEffect(() => {
    if (!q) return;
    setCollapsedSections(new Set());
  }, [q]);

  if (!activeWorkId) {
    return (
      <div className="settings-empty-state" style={{ padding: 24 }}>
        <div className="empty-icon">📕</div>
        <h3>{t('settings.workLabel')}</h3>
        <p>{t('settingsEditor.selectDesc')}</p>
      </div>
    );
  }

  return (
    <div className="settings-category-nav">
      {bookInfoNode && (
        <div className="settings-category-section">
          <div
            className={`tree-node-row ${selectedId === bookInfoNode.id ? 'selected' : ''}`}
            onClick={() => onSelect(bookInfoNode.id)}
            style={{ borderLeft: `3px solid ${getCategoryStyle(bookInfoNode.category).color}`, marginBottom: 6 }}
            title={bookInfoNode.name}
          >
            <span className="tree-node-icon" style={{ fontSize: 14 }}>{bookInfoNode.icon || '📖'}</span>
            <span className="tree-node-name">{bookInfoNode.name}</span>
          </div>
        </div>
      )}

      {sectionRoots.map(cat => {
        const style = getCategoryStyle(cat.category);
        const isCollapsed = collapsedSections.has(cat.id);

        const subtreeIds = collectSubtreeIds(cat.id, childrenMap);
        const sectionNodes = filteredNodes.filter(n => subtreeIds.has(n.id));

        // 显示 item 数量（递归）
        const itemCount = sectionNodes.filter(n => n.type === 'item').length;

        return (
          <div key={cat.id} className="settings-category-section">
            <div
              className="settings-category-header"
              onClick={() => toggleSection(cat.id)}
              style={{ borderLeft: `3px solid ${style.color}` }}
              title={cat.name}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 14, opacity: 0.95 }}>{cat.icon || '📁'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.name}
                </span>
              </span>

              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="tree-action-btn"
                  onClick={(e) => { e.stopPropagation(); onAdd(cat.id, cat.category); }}
                  title={t('settingsTree.add')}
                  style={{ opacity: 0.9 }}
                >
                  ＋
                </button>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: style.bg,
                    color: style.color,
                    border: `1px solid ${style.color}22`,
                    fontWeight: 700,
                    minWidth: 28,
                    textAlign: 'center',
                  }}
                  title={`${itemCount} 个设定项`}
                >
                  {itemCount}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {isCollapsed ? '▶' : '▼'}
                </span>
              </span>
            </div>

            {!isCollapsed && (
              <div className="settings-category-items">
                {(childrenMap.get(cat.id) || [])
                  .slice()
                  .sort((a, b) => (a.type === 'folder' ? -1 : 1) - (b.type === 'folder' ? -1 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0))
                  .map(child => (
                    <TreeRow
                      key={child.id}
                      node={child}
                      nodes={sectionNodes}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onAdd={onAdd}
                      onDelete={onDelete}
                      onRename={onRename}
                      onToggleEnabled={onToggleEnabled}
                      collapsedIds={collapsedIds}
                      onToggleCollapse={toggleCollapse}
                      level={0}
                    />
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
