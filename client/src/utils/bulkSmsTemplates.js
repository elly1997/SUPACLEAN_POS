/**
 * Saved bulk SMS templates (browser localStorage, per device/user profile).
 */

const STORAGE_KEY = 'supaclean_bulk_sms_templates_v2';

export const BULK_SMS_TEMPLATE_BODY_MAX = 640;

export const DEFAULT_BULK_SMS_TEMPLATES = [
  {
    id: 'announcement_en',
    name: 'General notice (English)',
    body:
      'SUPACLEAN, Arusha: [Add your short notice here — e.g. hours change or pickup reminder.] Thank you for choosing us.',
  },
  {
    id: 'announcement_bi',
    name: 'General notice (English + Swahili)',
    body:
      'SUPACLEAN, Arusha: [English notice here.] — Kiswahili: [Andika hapa taarifa yako mfupi.] Asante kwa kuwa nasi.',
  },
];

function newTemplateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `tpl_${crypto.randomUUID()}`;
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeBulkSmsTemplate(t) {
  if (!t || typeof t !== 'object') return null;
  const id = String(t.id || '').trim() || newTemplateId();
  const name = String(t.name || 'Template').trim().slice(0, 100);
  const body = String(t.body || '').slice(0, BULK_SMS_TEMPLATE_BODY_MAX);
  return { id, name: name || 'Template', body };
}

export function loadBulkSmsTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BULK_SMS_TEMPLATES.map((x) => ({ ...x }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_BULK_SMS_TEMPLATES.map((x) => ({ ...x }));
    }
    const normalized = parsed.map(normalizeBulkSmsTemplate).filter(Boolean);
    return normalized.length ? normalized : DEFAULT_BULK_SMS_TEMPLATES.map((x) => ({ ...x }));
  } catch {
    return DEFAULT_BULK_SMS_TEMPLATES.map((x) => ({ ...x }));
  }
}

export function saveBulkSmsTemplates(templates) {
  const cleaned = templates.map(normalizeBulkSmsTemplate).filter(Boolean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function resetBulkSmsTemplatesToDefaults() {
  const fresh = DEFAULT_BULK_SMS_TEMPLATES.map((x) => ({ ...x }));
  saveBulkSmsTemplates(fresh);
  return fresh;
}
