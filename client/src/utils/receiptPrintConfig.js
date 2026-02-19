/**
 * Receipt print layout – adapts to different thermal paper widths.
 * Set REACT_APP_RECEIPT_WIDTH_MM in .env (58 or 80) then rebuild.
 * Default: 58mm (in-built POS). Use 80 for 80mm thermal printers.
 */
const widthMm = parseInt(process.env.REACT_APP_RECEIPT_WIDTH_MM, 10) || 58;
const is58 = widthMm <= 58;

export const receiptWidthMm = is58 ? 58 : 80;
export const receiptWidthCss = `${receiptWidthMm}mm`;
export const receiptPadding = is58 ? '5mm 3mm' : '8mm 4mm';
export const receiptFontSize = is58 ? '8pt' : '9pt';
export const receiptCompactFontSize = is58 ? '7pt' : '8pt';
export const termsQrSize = is58 ? 48 : 64;
export const receiptBrandMargin = is58 ? '0 0 2px 0' : '0 0 4px 0';
export const receiptBrandFontSize = is58 ? '1em' : '1.1em';
