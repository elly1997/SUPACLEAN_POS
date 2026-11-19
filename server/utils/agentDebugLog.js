/**
 * Debug-mode NDJSON logger (session ca0b4b).
 * Local: POST ingest + append workspace log file.
 * Render: also console so MCP list_logs can capture DBG lines.
 */
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../.cursor/debug-ca0b4b.log');
const INGEST = 'http://127.0.0.1:7319/ingest/2ad8c561-fba6-4742-af7e-5cdc0260fc1f';

function agentDebugLog({ hypothesisId, location, message, data, runId }) {
  const payload = {
    sessionId: 'ca0b4b',
    hypothesisId: hypothesisId || null,
    location: location || 'unknown',
    message: message || '',
    data: data || {},
    runId: runId || 'pre-fix',
    timestamp: Date.now(),
  };
  // #region agent log
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (_) { /* ignore */ }
  try {
    fetch(INGEST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ca0b4b' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_) { /* ignore */ }
  try {
    console.log(`DBG_ca0b4b ${JSON.stringify(payload)}`);
  } catch (_) { /* ignore */ }
  // #endregion
  return payload;
}

module.exports = { agentDebugLog };
