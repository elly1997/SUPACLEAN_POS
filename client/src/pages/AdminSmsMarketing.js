import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import Loader from '../components/Loader';

function formatBool(b) {
  return b === true || b === 'true' || b === 1 || b === '1';
}

const AdminSmsMarketing = () => {
  const { user } = useAuth();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(true);
  const [smsSendingEnabled, setSmsSendingEnabled] = useState(true);
  const [syncSaving, setSyncSaving] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const activeTemplates = useMemo(
    () => (templates || []).filter((t) => t.is_active === 1 || t.is_active === true),
    [templates]
  );

  // Template form
  const [templateName, setTemplateName] = useState('');
  const [templateMessage, setTemplateMessage] = useState('');
  const [templateIsActive, setTemplateIsActive] = useState(true);
  const [editingTemplateId, setEditingTemplateId] = useState(null);

  // Campaign form
  const [campaignName, setCampaignName] = useState('SMS marketing campaign');
  const [templateId, setTemplateId] = useState('');
  const [audienceAll, setAudienceAll] = useState(true);
  const [tagsCsv, setTagsCsv] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(200);
  const [sending, setSending] = useState(false);
  const [lastSendResult, setLastSendResult] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statusRes, templatesRes] = await Promise.all([
        api.get('/admin/sms-marketing/status'),
        api.get('/admin/sms-marketing/templates'),
      ]);
      setSmsSendingEnabled(formatBool(statusRes?.data?.smsSendingEnabled));
      setTemplates(Array.isArray(templatesRes?.data) ? templatesRes.data : []);

      const firstActive = (Array.isArray(templatesRes?.data) ? templatesRes.data : []).find(
        (t) => t.is_active === 1 || t.is_active === true
      );
      if (!templateId && firstActive?.id) setTemplateId(String(firstActive.id));
    } catch (err) {
      console.error(err);
      showToast(err?.response?.data?.error || err.message || 'Failed to load SMS marketing', 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleGlobalSms = async () => {
    try {
      setSyncSaving(true);
      await api.put('/admin/sms-marketing/suppress', { enabled: !smsSendingEnabled });
      const statusRes = await api.get('/admin/sms-marketing/status');
      setSmsSendingEnabled(formatBool(statusRes?.data?.smsSendingEnabled));
      showToast(`SMS sending is now ${!smsSendingEnabled ? 'ENABLED' : 'DISABLED'}`);
    } catch (err) {
      console.error(err);
      showToast(err?.response?.data?.error || err.message || 'Failed to update SMS switch', 'warning');
    } finally {
      setSyncSaving(false);
    }
  };

  const resetTemplateForm = () => {
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateMessage('');
    setTemplateIsActive(true);
  };

  const handleEditTemplate = (tpl) => {
    setEditingTemplateId(String(tpl.id));
    setTemplateName(tpl.name || '');
    setTemplateMessage(tpl.message || '');
    setTemplateIsActive(tpl.is_active === 1 || tpl.is_active === true);
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    const message = templateMessage.trim();
    if (!name || !message) {
      showToast('Template name and message are required', 'warning');
      return;
    }
    try {
      setSavingTemplate(true);
      if (editingTemplateId) {
        await api.put(`/admin/sms-marketing/templates/${editingTemplateId}`, {
          name,
          message,
          is_active: templateIsActive,
        });
        showToast('Template updated');
      } else {
        const res = await api.post('/admin/sms-marketing/templates', {
          name,
          message,
          is_active: templateIsActive,
        });
        showToast(`Template created (id: ${res?.data?.id ?? '?'})`);
      }
      resetTemplateForm();
      await loadAll();
    } catch (err) {
      console.error(err);
      showToast(err?.response?.data?.error || err.message || 'Failed to save template', 'warning');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleActivateTemplate = async (tpl, active) => {
    try {
      setSavingTemplate(true);
      await api.put(`/admin/sms-marketing/templates/${tpl.id}`, { is_active: active });
      showToast(active ? 'Template activated' : 'Template deactivated');
      await loadAll();
    } catch (err) {
      console.error(err);
      showToast(err?.response?.data?.error || err.message || 'Failed to update template', 'warning');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSendCampaign = async () => {
    try {
      setSending(true);
      setLastSendResult(null);

      const tags = tagsCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        name: campaignName.trim() || 'SMS marketing campaign',
        template_id: templateId,
        audience_all: audienceAll,
        tags,
        dry_run: dryRun,
        limit: Number(limit) || 200,
      };

      const res = await api.post('/admin/sms-marketing/send', payload);
      setLastSendResult(res?.data || null);
      showToast(dryRun ? 'Dry-run campaign prepared' : 'Campaign send started/completed');
    } catch (err) {
      console.error(err);
      showToast(err?.response?.data?.error || err.message || 'Campaign send failed', 'warning');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Loader message="Loading SMS marketing…" fullPage delayMs={0} />;

  return (
    <div className="page">
      <ToastContainer />

      <h1>SMS Marketing (Admin)</h1>

      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Global SMS Switch</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>
            SMS sending: {smsSendingEnabled ? 'ENABLED' : 'DISABLED'}
          </div>
          <button
            className={`btn-small ${smsSendingEnabled ? 'btn-warning' : 'btn-success'}`}
            disabled={syncSaving}
            onClick={handleToggleGlobalSms}
          >
            {syncSaving ? 'Saving…' : smsSendingEnabled ? 'Disable SMS' : 'Enable SMS'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Templates</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <h3 style={{ marginBottom: 10 }}>Existing Templates</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {templates.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)' }}>No templates yet.</div>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: 10,
                      padding: 12,
                      background: 'var(--bg-secondary)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>
                          {tpl.name} {tpl.is_active ? '• Active' : '• Inactive'}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 10 }}>
                          Message preview: {String(tpl.message || '').slice(0, 70)}
                          {String(tpl.message || '').length > 70 ? '…' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 auto' }}>
                        <button className="btn-small btn-primary" onClick={() => handleEditTemplate(tpl)}>
                          Edit
                        </button>
                        <button
                          className={`btn-small ${tpl.is_active ? 'btn-warning' : 'btn-success'}`}
                          onClick={() => handleActivateTemplate(tpl, !tpl.is_active)}
                        >
                          {tpl.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 style={{ marginBottom: 10 }}>{editingTemplateId ? 'Edit Template' : 'Create Template'}</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Template Name</div>
                <input
                  className="edit-input"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. VIP Offer"
                />
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Message</div>
                <textarea
                  className="edit-input"
                  value={templateMessage}
                  onChange={(e) => setTemplateMessage(e.target.value)}
                  placeholder="Hello {{customer_name}} …"
                  rows={6}
                />
              </label>

              <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={templateIsActive}
                  onChange={(e) => setTemplateIsActive(e.target.checked)}
                />
                <span>Active (available for campaign sends)</span>
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn-small btn-success" disabled={savingTemplate} onClick={handleSaveTemplate}>
                  {savingTemplate ? 'Saving…' : editingTemplateId ? 'Save Changes' : 'Create Template'}
                </button>
                <button className="btn-small btn-secondary" disabled={savingTemplate} onClick={resetTemplateForm}>
                  Cancel
                </button>
              </div>

              <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
                Supported placeholders: `{{name}}`, `{{customer_name}}`
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Send Campaign</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div style={{ gridColumn: '1 / span 2' }}>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Campaign Name</div>
              <input
                className="edit-input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </label>
          </div>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Template</div>
            <select
              className="edit-input"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={activeTemplates.length === 0}
            >
              {activeTemplates.length === 0 ? (
                <option value="">No active templates</option>
              ) : (
                activeTemplates.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Audience</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={audienceAll}
                  onChange={(e) => setAudienceAll(e.target.checked)}
                />
                <span>All customers</span>
              </label>
            </div>
            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Tags (comma-separated)</div>
              <input
                className="edit-input"
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="VIP, Regular, New"
                disabled={audienceAll}
              />
            </label>
          </div>

          <div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              <span>Dry run (do not actually send)</span>
            </label>
            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Limit</div>
              <input
                className="edit-input"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                type="number"
                min={1}
                max={500}
              />
            </label>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Actions</div>
            <button className="btn-small btn-success" disabled={sending || !templateId} onClick={handleSendCampaign}>
              {sending ? 'Sending…' : dryRun ? 'Prepare Dry Run' : 'Send Campaign'}
            </button>
            {lastSendResult && (
              <div style={{ marginTop: 14, color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Result</div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                  {JSON.stringify(lastSendResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdminSmsMarketing;

