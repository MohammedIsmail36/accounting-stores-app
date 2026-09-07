// import bwipjs from "bwip-js/browser";
// import JsBarcode from "jsbarcode";

// export interface LabelSize {
//   widthMm: number;
//   heightMm: number;
// }

// export interface LabelOptions {
//   size: LabelSize;
//   showName: boolean;
//   showPrice: boolean;
//   showCode: boolean;
//   currency: string;
// }

// export interface LabelProduct {
//   id: string;
//   code: string;
//   name: string;
//   barcode_label?: string | null;
//   barcode?: string | null;
//   barcode_price?: number | null;
//   selling_price?: number | null;
//   model_number?: string | null;
// }

// export const PRESET_SIZES: Record<string, LabelSize> = {
//   "30x40": { widthMm: 30, heightMm: 40 },
//   "40x30": { widthMm: 40, heightMm: 30 },
//   "50x30": { widthMm: 50, heightMm: 30 },
//   "50x25": { widthMm: 50, heightMm: 25 },
//   "58x40": { widthMm: 58, heightMm: 40 },
//   "80x50": { widthMm: 80, heightMm: 50 },
// };

// export const DEFAULT_SIZE_KEY = "40x30";

// /**
//  * Generate a UPC-A barcode as inline SVG using the same engine/options as the
//  * reference template. Falls back to Code128 only when the stored value cannot
//  * be represented as UPC-A, so the label never renders a broken "no barcode".
//  */
// function generateBarcodeSvg(value: string): string {
//   const cleaned = (value || "").trim();
//   if (!cleaned) {
//     return generateFallbackBarcodeSvg("00000000000");
//   }
//   const digits = cleaned.replace(/\D/g, "");

//   const renderFallback = (bcid: string, text: string) =>
//     bwipjs.toSVG({
//       bcid,
//       text,
//       scale: 3,
//       height: 18,
//       includetext: true,
//       textxalign: bcid === "code128" ? "center" : undefined,
//       textfont: "OCR-B",
//       textsize: 11,
//       textyoffset: 2,
//       guardwhitespace: bcid === "upca" || bcid === "ean13",
//       backgroundcolor: "FFFFFF",
//       paddingwidth: 0,
//       paddingheight: 0,
//     } as any);

//   try {
//     if (typeof document !== "undefined" && (digits.length === 11 || digits.length === 12)) {
//       const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
//       JsBarcode(svg, digits, {
//         format: "UPC",
//         displayValue: true,
//         font: "Tajawal",
//         fontOptions: "bold",
//         fontSize: 26,
//         textMargin: 2,
//         margin: 0,
//         marginLeft: 14,
//         marginRight: 14,
//         height: 55,
//         width: 2.2,
//       });
//       svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
//       svg.setAttribute("style", "width:92%;height:100%;max-height:100%;display:block;overflow:visible;");
//       return new XMLSerializer().serializeToString(svg);
//     }

//     if (digits.length === 11 || digits.length === 12) {
//       return withBarcodeSvgStyle(renderFallback("upca", digits));
//     }

//     return withBarcodeSvgStyle(renderFallback("code128", cleaned));
//   } catch {
//     return generateFallbackBarcodeSvg(cleaned || "00000000000");
//   }
// }

// function generateFallbackBarcodeSvg(value: string): string {
//   try {
//     return withBarcodeSvgStyle(
//       bwipjs.toSVG({
//         bcid: "code128",
//         text: value,
//         scale: 3,
//         height: 18,
//         includetext: true,
//         textxalign: "center",
//         textfont: "OCR-B",
//         textsize: 11,
//         backgroundcolor: "FFFFFF",
//         paddingwidth: 0,
//         paddingheight: 0,
//       } as any),
//     );
//   } catch {
//     return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" style="width:92%;height:100%;display:block"><text x="50" y="20" text-anchor="middle" font-size="8" fill="black">${escapeHtml(value)}</text></svg>`;
//   }
// }

// function withBarcodeSvgStyle(svg: string): string {
//   return svg.replace(
//     "<svg ",
//     '<svg style="width:92%;height:100%;max-height:100%;display:block;overflow:visible;" preserveAspectRatio="xMidYMid meet" ',
//   );
// }

// function displayName(p: LabelProduct): string {
//   return (p.barcode_label && p.barcode_label.trim()) || p.name;
// }

// function displayPrice(p: LabelProduct): number {
//   return p.barcode_price != null ? Number(p.barcode_price) : Number(p.selling_price || 0);
// }

// function formatPrice(n: number): string {
//   return Number(n || 0).toLocaleString("en-US", {
//     minimumFractionDigits: 2,
//     maximumFractionDigits: 2,
//   });
// }

// function escapeHtml(s: string): string {
//   return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// }

// /**
//  * Render a single label — layout inspired by the reference template:
//  *   [ title (single line, ellipsis) ]
//  *   [    barcode (flex, centered)  ]
//  *   [ code (LTR)     price + curr  ]
//  */
// export function renderLabelHtml(p: LabelProduct, opts: LabelOptions): string {
//   const { widthMm, heightMm } = opts.size;
//   const name = displayName(p);
//   const price = displayPrice(p);
//   const barcodeValue = (p.barcode && p.barcode.trim()) || p.code || "";
//   const svg = generateBarcodeSvg(barcodeValue);

//   const titleFs = Math.max(2, Math.min(3.2, (widthMm * 1.55) / Math.max(name.length, 1)));
//   const codeFs = Math.max(1.9, Math.min(2.4, heightMm * 0.08));
//   const priceFs = Math.max(2.8, Math.min(3.8, heightMm * 0.12));
//   const currencyFs = Math.max(1.7, Math.min(2.1, heightMm * 0.067));

//   return `
//     <div class="lbl" style="width:${widthMm}mm;height:${heightMm}mm;background:white;padding:2.2mm;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;color:black;font-family:'Tajawal',system-ui,sans-serif;page-break-after:always;page-break-inside:avoid;">
//       ${
//         opts.showName
//           ? `<div class="lbl-title" style="text-align:center;font-size:${titleFs}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0.3mm;flex-shrink:0;direction:rtl;line-height:1.1;">${escapeHtml(name)}</div>`
//           : ""
//       }
//       <div class="lbl-barcode" style="display:flex;justify-content:center;align-items:stretch;flex:1;min-height:0;overflow:visible;">${svg}</div>
//       <div class="lbl-bottom" style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:1.2mm;flex-shrink:0;direction:rtl;">
//         ${
//           opts.showPrice
//             ? `<div class="lbl-price" style="text-align:right;line-height:1;display:flex;align-items:baseline;gap:.6mm;direction:rtl;">
//                <span class="lbl-currency" style="writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);font-size:${currencyFs}mm;font-weight:700;letter-spacing:.2mm;">${escapeHtml(opts.currency)}</span>
//                <span class="lbl-value" style="direction:ltr;font-size:${priceFs}mm;font-weight:800;">${formatPrice(price)}</span>
//              </div>`
//             : `<div></div>`
//         }
//         <div class="lbl-code" style="direction:ltr;font-size:${codeFs}mm;color:black;font-weight:400;">${opts.showCode ? escapeHtml(p.code || "") : ""}</div>
//       </div>
//     </div>
//   `;
// }

// /**
//  * Full printable document — each label = one page sized exactly to the roll.
//  */
// export function buildPrintHtml(items: Array<{ product: LabelProduct; copies: number }>, opts: LabelOptions): string {
//   const { widthMm, heightMm } = opts.size;
//   const labels: string[] = [];
//   for (const it of items) {
//     const n = Math.max(1, Math.floor(it.copies));
//     for (let i = 0; i < n; i++) labels.push(renderLabelHtml(it.product, opts));
//   }

//   return `<!doctype html>
// <html dir="rtl" lang="ar">
// <head>
// <meta charset="utf-8" />
// <title>طباعة الباركود</title>
// <link rel="preconnect" href="https://fonts.googleapis.com" />
// <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
// <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
// <style>
//   @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
//   * { margin: 0; padding: 0; box-sizing: border-box; }
//   html, body { background: #fff; font-family: 'Tajawal', system-ui, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
//   .lbl:last-child { page-break-after: auto; }
//   @media screen {
//     body { background: #d8d8d8; padding: 20px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
//     .lbl { box-shadow: 0 0 6px rgba(0,0,0,0.25); }
//   }
// </style>
// </head>
// <body>
// ${labels.join("\n")}
// <script>
//   window.addEventListener('load', function () {
//     if (document.fonts && document.fonts.ready) {
//       document.fonts.ready.then(function () { setTimeout(function () { window.print(); }, 200); });
//     } else {
//       setTimeout(function () { window.print(); }, 500);
//     }
//   });
// </script>
// </body>
// </html>`;
// }

// export function openPrintWindow(html: string) {
//   const win = window.open("", "_blank", "width=700,height=800");
//   if (!win) return;
//   win.document.open();
//   win.document.write(html);
//   win.document.close();
// }

import bwipjs from "bwip-js/browser";
import JsBarcode from "jsbarcode";

export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

export interface LabelOptions {
  size: LabelSize;
  showName: boolean;
  showPrice: boolean;
  showCode: boolean;
  currency: string;
}

export interface LabelProduct {
  id: string;
  code: string;
  name: string;
  barcode_label?: string | null;
  barcode?: string | null;
  barcode_price?: number | null;
  selling_price?: number | null;
  model_number?: string | null;
}

export const PRESET_SIZES: Record<string, LabelSize> = {
  "30x40": { widthMm: 30, heightMm: 40 },
  "40x30": { widthMm: 40, heightMm: 30 },
  "50x30": { widthMm: 50, heightMm: 30 },
  "50x25": { widthMm: 50, heightMm: 25 },
  "58x40": { widthMm: 58, heightMm: 40 },
  "80x50": { widthMm: 80, heightMm: 50 },
};

export const DEFAULT_SIZE_KEY = "40x30";

/**
 * Generate a UPC-A barcode as inline SVG using the same engine/options as the
 * reference template. Falls back to Code128 only when the stored value cannot
 * be represented as UPC-A, so the label never renders a broken "no barcode".
 *
 * Clarity fixes vs the previous version:
 *  - shape-rendering="crispEdges" on the root <svg> removes browser
 *    anti-aliasing on the vertical bars, which is the main cause of blurry
 *    edges both on screen and when printed.
 *  - Wider quiet zone (marginLeft/marginRight) so scanners have enough blank
 *    space on each side to lock onto the start/stop guard bars.
 *  - Slightly thicker module width so each bar maps to at least a full pixel
 *    at typical thermal-printer resolutions instead of a fractional pixel
 *    that gets blurred out.
 */
function generateBarcodeSvg(value: string): string {
  const cleaned = (value || "").trim();
  if (!cleaned) {
    return generateFallbackBarcodeSvg("00000000000");
  }
  const digits = cleaned.replace(/\D/g, "");

  const renderFallback = (bcid: string, text: string) =>
    bwipjs.toSVG({
      bcid,
      text,
      scale: 4,
      height: 18,
      includetext: true,
      textxalign: bcid === "code128" ? "center" : undefined,
      textfont: "OCR-B",
      textsize: 11,
      textyoffset: 2,
      guardwhitespace: bcid === "upca" || bcid === "ean13",
      backgroundcolor: "FFFFFF",
      paddingwidth: 2,
      paddingheight: 0,
    } as any);

  try {
    if (typeof document !== "undefined" && (digits.length === 11 || digits.length === 12)) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, digits, {
        format: "UPC",
        displayValue: true,
        font: "Tajawal",
        fontOptions: "bold",
        fontSize: 24,
        textMargin: 1,
        margin: 0,
        marginLeft: 6,
        marginRight: 6,
        height: 50,
        width: 2.8,
      });
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("shape-rendering", "crispEdges");
      svg.setAttribute(
        "style",
        "width:100%;height:100%;max-height:100%;display:block;overflow:visible;shape-rendering:crispEdges;",
      );
      // Pull guard digits closer to bars and space out the inner 5-digit groups.
      const texts = svg.querySelectorAll("text");
      if (texts.length >= 4) {
        const first = texts[0] as SVGTextElement;
        first.setAttribute("x", String(parseFloat(first.getAttribute("x") || "0") + 12));
        const last = texts[texts.length - 1] as SVGTextElement;
        last.setAttribute("x", String(parseFloat(last.getAttribute("x") || "0") - 12));
        for (let i = 1; i <= texts.length - 2; i++) {
          (texts[i] as SVGTextElement).setAttribute("letter-spacing", "5");
        }
      }
      return new XMLSerializer().serializeToString(svg);
    }

    if (digits.length === 11 || digits.length === 12) {
      return withBarcodeSvgStyle(renderFallback("upca", digits));
    }

    return withBarcodeSvgStyle(renderFallback("code128", cleaned));
  } catch {
    return generateFallbackBarcodeSvg(cleaned || "00000000000");
  }
}

function generateFallbackBarcodeSvg(value: string): string {
  try {
    return withBarcodeSvgStyle(
      bwipjs.toSVG({
        bcid: "code128",
        text: value,
        scale: 4,
        height: 18,
        includetext: true,
        textxalign: "center",
        textfont: "OCR-B",
        textsize: 11,
        backgroundcolor: "FFFFFF",
        paddingwidth: 2,
        paddingheight: 0,
      } as any),
    );
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" style="width:92%;height:100%;display:block"><text x="50" y="20" text-anchor="middle" font-size="8" fill="black">${escapeHtml(value)}</text></svg>`;
  }
}

function withBarcodeSvgStyle(svg: string): string {
  return svg.replace(
    "<svg ",
    '<svg shape-rendering="crispEdges" style="width:100%;height:100%;max-height:100%;display:block;overflow:visible;shape-rendering:crispEdges;" preserveAspectRatio="none" ',
  );
}

function displayName(p: LabelProduct): string {
  return (p.barcode_label && p.barcode_label.trim()) || p.name;
}

function displayPrice(p: LabelProduct): number {
  return p.barcode_price != null ? Number(p.barcode_price) : Number(p.selling_price || 0);
}

function formatPrice(n: number): string {
  return Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render a single label — layout inspired by the reference template:
 *   [ title (single line, ellipsis) ]
 *   [    barcode (flex, centered)  ]
 *   [ code (LTR)     price + curr  ]
 */
export function renderLabelHtml(p: LabelProduct, opts: LabelOptions): string {
  const { widthMm, heightMm } = opts.size;
  const name = displayName(p);
  const price = displayPrice(p);
  const barcodeValue = (p.barcode && p.barcode.trim()) || p.code || "";
  const svg = generateBarcodeSvg(barcodeValue);

  const titleFs = Math.max(2, Math.min(3.2, (widthMm * 1.55) / Math.max(name.length, 1)));
  const codeFs = Math.max(1.9, Math.min(2.4, heightMm * 0.08));
  const priceFs = Math.max(2.8, Math.min(3.8, heightMm * 0.12));
  const currencyFs = Math.max(1.7, Math.min(2.1, heightMm * 0.067));
  // Keep the barcode area compact while still leaving enough space for the
  // title and price/footer rows to be clearly readable.
  const barcodeMinHeightMm = Math.max(10, heightMm * 0.50);

  return `
    <div class="lbl" style="width:${widthMm}mm;height:${heightMm}mm;background:white;padding:2.2mm;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;color:black;font-family:'Tajawal',system-ui,sans-serif;page-break-after:always;page-break-inside:avoid;">
      ${
        opts.showName
          ? `<div class="lbl-title" style="text-align:center;font-size:2.9523809523809526mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2.3mm;flex-shrink:0;direction:rtl;line-height:1.1;font-weight:700;">${escapeHtml(name)}</div>`
          : ""
      }
      <div class="lbl-barcode" style="display:flex;justify-content:center;align-items:center;flex:1;min-height:${barcodeMinHeightMm}mm;overflow:visible;">${svg}</div>
      <div class="lbl-bottom" style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:1.2mm;flex-shrink:0;direction:rtl;">
        ${
          opts.showPrice
            ? `<div class="lbl-price" style="text-align:right;line-height:1;display:flex;align-items:baseline;gap:.6mm;direction:rtl;">
               <span class="lbl-currency" style="writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);font-size:${currencyFs}mm;font-weight:700;letter-spacing:.2mm;">${escapeHtml(opts.currency)}</span>
               <span class="lbl-value" style="direction:ltr;font-size:${priceFs}mm;font-weight:800;">${formatPrice(price)}</span>
             </div>`
            : `<div></div>`
        }
        <div class="lbl-code" style="direction:ltr;font-size:${codeFs}mm;color:black;font-weight:400;">${opts.showCode ? escapeHtml(p.code || "") : ""}</div>
      </div>
    </div>
  `;
}

/**
 * Full printable document — each label = one page sized exactly to the roll.
 */
export function buildPrintHtml(items: Array<{ product: LabelProduct; copies: number }>, opts: LabelOptions): string {
  const { widthMm, heightMm } = opts.size;
  const labels: string[] = [];
  for (const it of items) {
    const n = Math.max(1, Math.floor(it.copies));
    for (let i = 0; i < n; i++) labels.push(renderLabelHtml(it.product, opts));
  }

  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>طباعة الباركود</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; font-family: 'Tajawal', system-ui, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lbl:last-child { page-break-after: auto; }
  @media screen {
    body { background: #d8d8d8; padding: 20px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .lbl { box-shadow: 0 0 6px rgba(0,0,0,0.25); }
  }
</style>
</head>
<body>
${labels.join("\n")}
</body>
</html>`;
}

/**
 * Print labels via a hidden iframe (no popup window).
 * Auto-closes/cleans up after print or cancel.
 */
export function printLabels(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    setTimeout(() => {
      try {
        iframe.parentNode?.removeChild(iframe);
      } catch {
        // The iframe may already have been detached by the browser.
      }
    }, 200);
  };

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    try {
      win.addEventListener("afterprint", cleanup);
    } catch {
      // Printing still proceeds; the timeout below remains the cleanup fallback.
    }
    const doPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
    };
    const doc = iframe.contentDocument;
    if (doc && (doc as any).fonts && (doc as any).fonts.ready) {
      (doc as any).fonts.ready.then(() => setTimeout(doPrint, 100)).catch(() => doPrint());
    } else {
      setTimeout(doPrint, 300);
    }
    // Fallback cleanup after 2 minutes in case afterprint never fires
    setTimeout(cleanup, 120000);
  };

  iframe.onload = triggerPrint;

  const doc = iframe.contentDocument;
  if (!doc) {
    cleanup();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
}

/** @deprecated Use printLabels instead. Kept for backwards compatibility. */
export function openPrintWindow(html: string) {
  printLabels(html);
}
