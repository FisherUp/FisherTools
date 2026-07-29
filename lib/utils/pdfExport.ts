/**
 * 通用 PDF 导出工具
 *
 * 方案说明：
 *   jsPDF 内嵌 CJK 字体存在两个致命问题——
 *     1) 项目里的 NotoSansCJKsc-Regular.otf 是 CFF(OpenType) 轮廓，jsPDF 只支持
 *        TrueType(glyf) 轮廓，强行 addFont 会得到乱码/方块。
 *     2) 该字体 16MB，转 base64 后 ~22MB，每次导出都要下载+解析，极慢。
 *   因此这里改用「离屏 DOM + html2canvas 光栅化」方案：
 *     - 中文由浏览器系统字体渲染，100% 不会乱码；
 *     - 不需要下载任何字体；
 *     - 通过按行分页测量，保证不会把某一行从中间截断。
 */

import jsPDF from "jspdf";

export type PdfAlign = "left" | "center" | "right";

export type PdfCell =
  | string
  | number
  | null
  | undefined
  | {
      text: string | number | null | undefined;
      align?: PdfAlign;
      bold?: boolean;
      color?: string;
      background?: string;
      colSpan?: number;
    };

export type PdfColumn = {
  header: string;
  /** 相对宽度权重，默认 1 */
  width?: number;
  align?: PdfAlign;
};

export type PdfMetaItem = { label: string; value: string };

export type PdfExportOptions = {
  filename: string;
  title: string;
  subtitle?: string;
  /** 表格上方的导出信息（导出人、组织、时间等） */
  meta?: PdfMetaItem[];
  columns: PdfColumn[];
  rows: PdfCell[][];
  /** 表格下方的汇总信息 */
  summary?: PdfMetaItem[];
  /** 页脚附注 */
  footnote?: string;
  orientation?: "portrait" | "landscape";
  /** 纸张尺寸，列数很多时用 a3 */
  paper?: "a4" | "a3";
  /** 表格字号，默认 portrait 10 / landscape 9 */
  fontSize?: number;
};

/* ---------- 纸张尺寸（96dpi 像素） ---------- */
const PAPER = {
  a4: {
    portrait: { w: 794, h: 1123 },
    landscape: { w: 1123, h: 794 },
  },
  a3: {
    portrait: { w: 1123, h: 1587 },
    landscape: { w: 1587, h: 1123 },
  },
};
const PAGE_PADDING = 36; // px

const FONT_STACK =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC","WenQuanYi Micro Hei",system-ui,-apple-system,"Segoe UI",Arial,sans-serif';

function normalizeCell(cell: PdfCell): {
  text: string;
  align: PdfAlign;
  bold: boolean;
  color: string;
  background: string;
  colSpan: number;
} {
  if (cell === null || cell === undefined) {
    return { text: "", align: "left", bold: false, color: "#1f2328", background: "", colSpan: 1 };
  }
  if (typeof cell === "string" || typeof cell === "number") {
    return { text: String(cell), align: "left", bold: false, color: "#1f2328", background: "", colSpan: 1 };
  }
  return {
    text: cell.text === null || cell.text === undefined ? "" : String(cell.text),
    align: cell.align ?? "left",
    bold: cell.bold ?? false,
    color: cell.color ?? "#1f2328",
    background: cell.background ?? "",
    colSpan: cell.colSpan ?? 1,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * ⚠️ Tailwind v4 的 preflight 会把 `*` 的 border-color 设成 oklch()，
 * html2canvas 1.4.x 无法解析该色彩函数并会直接抛错。
 * 这里在离屏容器内强制覆盖成 hex。
 */
const STAGE_RESET_CSS = `<style>
  .ft-pdf-stage, .ft-pdf-stage * {
    border-color: #dfe3e8;
    outline-color: #dfe3e8;
    text-decoration-color: currentColor;
    box-shadow: none !important;
  }
</style>`;

function buildHeaderHtml(opts: PdfExportOptions): string {
  const metaHtml = (opts.meta ?? [])
    .map(
      (m) =>
        `<span style="display:inline-block;margin-right:18px;white-space:nowrap;">
           <span style="color:#8b949e;">${escapeHtml(m.label)}：</span>
           <span style="color:#1f2328;">${escapeHtml(m.value)}</span>
         </span>`
    )
    .join("");

  return `
    <div class="ft-pdf-header" style="border-bottom:2px solid #1f2328;padding-bottom:10px;margin-bottom:14px;">
      <div style="font-size:19px;font-weight:700;color:#1f2328;letter-spacing:0.5px;">
        ${escapeHtml(opts.title)}
      </div>
      ${
        opts.subtitle
          ? `<div style="font-size:12px;color:#6a737d;margin-top:4px;">${escapeHtml(opts.subtitle)}</div>`
          : ""
      }
      ${metaHtml ? `<div style="font-size:11px;margin-top:8px;line-height:1.8;">${metaHtml}</div>` : ""}
    </div>
  `;
}

function buildTableHtml(
  opts: PdfExportOptions,
  rows: PdfCell[][],
  fontSize: number,
  colWidths: number[]
): string {
  const thead = `
    <thead>
      <tr>
        ${opts.columns
          .map(
            (c, i) =>
              `<th style="width:${colWidths[i]}%;padding:6px 8px;font-size:${fontSize}px;font-weight:700;
                 color:#1f2328;background:#eef1f5;border-bottom:1.5px solid #b9c0c8;
                 border-right:1px solid #dfe3e8;text-align:${c.align ?? "left"};white-space:nowrap;">
                 ${escapeHtml(c.header)}
               </th>`
          )
          .join("")}
      </tr>
    </thead>`;

  const tbody = `
    <tbody>
      ${rows
        .map((row, ri) => {
          const cells = row
            .map((cell, ci) => {
              const c = normalizeCell(cell);
              const bg = c.background || (ri % 2 === 1 ? "#fafbfc" : "#ffffff");
              const align = c.align !== "left" ? c.align : opts.columns[ci]?.align ?? "left";
              return `<td colspan="${c.colSpan}" style="padding:5px 8px;font-size:${fontSize}px;
                        color:${c.color};background:${bg};font-weight:${c.bold ? 700 : 400};
                        border-bottom:1px solid #eceff2;border-right:1px solid #f2f4f6;
                        text-align:${align};word-break:break-word;">
                        ${escapeHtml(c.text)}
                      </td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("")}
    </tbody>`;

  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;
            border:1px solid #dfe3e8;">${thead}${tbody}</table>`;
}

function buildSummaryHtml(opts: PdfExportOptions): string {
  if (!opts.summary || opts.summary.length === 0) return "";
  return `
    <div class="ft-pdf-summary" style="margin-top:14px;padding:10px 14px;background:#f6f8fa;border:1px solid #dfe3e8;border-radius:6px;">
      ${opts.summary
        .map(
          (s) =>
            `<span style="display:inline-block;margin-right:24px;font-size:12px;white-space:nowrap;">
               <span style="color:#6a737d;">${escapeHtml(s.label)}：</span>
               <span style="color:#1f2328;font-weight:700;">${escapeHtml(s.value)}</span>
             </span>`
        )
        .join("")}
    </div>`;
}

/** 创建一个离屏容器，用于测量与渲染 */
function createStage(widthPx: number, innerHtml: string): HTMLDivElement {
  const stage = document.createElement("div");
  stage.className = "ft-pdf-stage";
  stage.style.position = "fixed";
  stage.style.left = "-20000px";
  stage.style.top = "0";
  stage.style.width = `${widthPx}px`;
  stage.style.background = "#ffffff";
  stage.style.color = "#1f2328";
  stage.style.fontFamily = FONT_STACK;
  stage.style.boxSizing = "border-box";
  stage.innerHTML = STAGE_RESET_CSS + innerHtml;
  document.body.appendChild(stage);
  return stage;
}

/** 计算各列的百分比宽度 */
function computeColWidths(columns: PdfColumn[]): number[] {
  const weights = columns.map((c) => c.width ?? 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * 100);
}

/**
 * 导出表格为 PDF。
 * 会自动按行分页（不会把一行从中间截断），每页都重绘表头。
 */
export async function exportTablePdf(opts: PdfExportOptions): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;

  const orientation = opts.orientation ?? "portrait";
  const page = PAPER[opts.paper ?? "a4"][orientation];
  const contentW = page.w - PAGE_PADDING * 2;
  const contentH = page.h - PAGE_PADDING * 2;
  const fontSize = opts.fontSize ?? (orientation === "landscape" ? 9 : 10);
  const colWidths = computeColWidths(opts.columns);

  const headerHtml = buildHeaderHtml(opts);
  const summaryHtml = buildSummaryHtml(opts);
  const footHeight = 22; // 页码区

  /* ---------- 第一步：测量每一行高度，决定分页 ---------- */
  const measureStage = createStage(
    contentW,
    headerHtml + buildTableHtml(opts, opts.rows, fontSize, colWidths) + summaryHtml
  );

  const measuredHeaderH =
    (measureStage.querySelector(".ft-pdf-header") as HTMLElement | null)?.offsetHeight ?? 0;
  const theadH = (measureStage.querySelector("thead") as HTMLElement | null)?.offsetHeight ?? 24;
  const summaryH =
    (measureStage.querySelector(".ft-pdf-summary") as HTMLElement | null)?.offsetHeight ?? 0;
  const rowHeights = Array.from(measureStage.querySelectorAll("tbody tr")).map(
    (tr) => (tr as HTMLElement).offsetHeight
  );
  measureStage.remove();

  const pages: PdfCell[][][] = [];
  {
    let current: PdfCell[][] = [];
    // 第一页要减去 header 高度；最后一页要预留 summary 高度（保守：每页都预留）
    let available = contentH - footHeight - measuredHeaderH - theadH - summaryH;
    for (let i = 0; i < opts.rows.length; i++) {
      const h = rowHeights[i] ?? 24;
      if (current.length > 0 && h > available) {
        pages.push(current);
        current = [];
        available = contentH - footHeight - theadH - summaryH;
      }
      current.push(opts.rows[i]);
      available -= h;
    }
    pages.push(current);
  }
  if (pages.length === 0) pages.push([]);

  /* ---------- 第二步：逐页渲染 ---------- */
  const doc = new jsPDF({ unit: "px", format: [page.w, page.h], orientation, compress: true });

  for (let p = 0; p < pages.length; p++) {
    const stage = createStage(
      contentW,
      (p === 0 ? headerHtml : "") +
        buildTableHtml(opts, pages[p], fontSize, colWidths) +
        (p === pages.length - 1 ? summaryHtml : "")
    );

    const canvas = await html2canvas(stage, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      windowWidth: contentW,
    });
    stage.remove();

    if (p > 0) doc.addPage([page.w, page.h], orientation);

    const imgH = (canvas.height / canvas.width) * contentW;
    doc.addImage(
      canvas.toDataURL("image/jpeg", 0.94),
      "JPEG",
      PAGE_PADDING,
      PAGE_PADDING,
      contentW,
      Math.min(imgH, contentH - footHeight)
    );

    // 页脚：页码 + 附注
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `${p + 1} / ${pages.length}`,
      page.w - PAGE_PADDING,
      page.h - PAGE_PADDING + 12,
      { align: "right" }
    );
    if (opts.footnote) {
      // 页脚附注只放 ASCII 安全内容；中文附注请放在 meta 里
      doc.text(opts.footnote, PAGE_PADDING, page.h - PAGE_PADDING + 12);
    }
  }

  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}

/** 把「分」格式化为带千分位的金额字符串（不含币种符号） */
export function fenToAmountStr(fen: number): string {
  return (fen / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
