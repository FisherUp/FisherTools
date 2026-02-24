/**
 * 从 notes 中提取日历可见备注预览。
 *
 * 规则：
 * 1. 取 `---` 第一次出现之前的内容；若不含 `---` 则取全部内容。
 * 2. 最多显示 40 个字符（JS string.length），超出则截断并追加 `…`。
 * 3. 任意边界情况（null / undefined / 空 / 以 `---` 开头 / 多个 `---`）均安全处理。
 *
 * @param notes - service_assignments.notes 字段原始值
 * @returns 日历可见备注字符串，空则返回 ""
 */
export function getCalendarNotePreview(notes: string | null | undefined): string {
  if (!notes) return "";

  const separatorIndex = notes.indexOf("---");
  const visible = separatorIndex === -1 ? notes : notes.slice(0, separatorIndex);

  const trimmed = visible.trim();
  if (!trimmed) return "";

  return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed;
}

/**
 * 计算 notes 中 `---` 之前内容的可见字符数（供表单实时提示使用）。
 * 不 trim，保持与用户输入一致（trim 后长度在 getCalendarNotePreview 里处理）。
 */
export function getVisibleNoteLength(notes: string): number {
  const separatorIndex = notes.indexOf("---");
  const visible = separatorIndex === -1 ? notes : notes.slice(0, separatorIndex);
  return visible.trim().length;
}
