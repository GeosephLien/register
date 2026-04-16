(function () {
  const SYSTEM_DEFAULTS = {
    appName: 'Partner Host',
    locale: 'zh-TW',
    ac2Url: 'https://geosephlien.github.io/ac2/?embedded=1&uiMode=modal',
    ac2Origin: 'https://geosephlien.github.io',
    apiBase: 'https://ac2-host-api-avatar-page.kuanyi-lien.workers.dev',
    uiMode: 'modal',
    placement: 'center',
    panelWidth: 1280,
    panelHeight: 780,
    panelRadius: 28
  };

  const form = document.getElementById('generator-form');
  const frontendOutput = document.getElementById('frontend-output');
  const apiOutput = document.getElementById('api-output');
  const securityOutput = document.getElementById('security-output');
  const copyButtons = Array.from(document.querySelectorAll('[data-copy-target]'));
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

  const fieldErrorElements = new Map(
    Array.from(document.querySelectorAll('[data-field-error]')).map((element) => [
      element.getAttribute('data-field-error'),
      element
    ])
  );

  const editableFieldNames = ['hostOrigin', 'tenantId'];

  function getFormData() {
    const data = new FormData(form);
    const values = Object.fromEntries(data.entries());

    return {
      appName: SYSTEM_DEFAULTS.appName,
      hostOrigin: String(values.hostOrigin || '').trim(),
      tenantId: String(values.tenantId || '').trim(),
      locale: SYSTEM_DEFAULTS.locale,
      uiMode: SYSTEM_DEFAULTS.uiMode,
      placement: SYSTEM_DEFAULTS.placement,
      panelWidth: SYSTEM_DEFAULTS.panelWidth,
      panelHeight: SYSTEM_DEFAULTS.panelHeight,
      panelRadius: SYSTEM_DEFAULTS.panelRadius,
      useCredentials: true,
      allowedOrigins: values.hostOrigin ? [String(values.hostOrigin).trim()] : []
    };
  }

  function validate(values) {
    const fieldErrors = {};

    if (!values.hostOrigin) {
      fieldErrors.hostOrigin = 'Host origin is required.';
    } else {
      try {
        new URL(values.hostOrigin);
      } catch {
        fieldErrors.hostOrigin = 'Host origin must be a valid URL.';
      }
    }

    ['tenantId'].forEach((key) => {
      if (!values[key]) {
        fieldErrors[key] = key + ' is required.';
      }
    });

    const issues = editableFieldNames
      .filter((name) => Boolean(fieldErrors[name]))
      .map((name) => fieldErrors[name]);

    return { fieldErrors, issues };
  }

  function renderFieldErrors(fieldErrors) {
    editableFieldNames.forEach((name) => {
      const input = form.elements[name];
      const messageElement = fieldErrorElements.get(name);
      const message = fieldErrors[name] || '';

      if (messageElement) {
        messageElement.textContent = message;
      }

      if (input) {
        input.classList.toggle('input-error', Boolean(message));
        input.setAttribute('aria-invalid', message ? 'true' : 'false');
      }
    });
  }

  function renderFrontendSnippet(values) {
    const credentials = values.useCredentials ? "'include'" : "'omit'";

    return `/**
 * frontend/ac2-integration.js
 * Responsibilities: Embed + postMessage handling
 */

import {
  requestAc2Session,
  fetchVrmFiles,
  fetchDownloadUrl,
  fetchActiveAvatar,
  saveActiveAvatar
} from './ac2-api.js';

const AC2_ORIGIN = '${SYSTEM_DEFAULTS.ac2Origin}';
const AC2_URL = '${SYSTEM_DEFAULTS.ac2Url}';
const AC2_API_BASE = '${SYSTEM_DEFAULTS.apiBase}';

const CLIENT_CONTEXT = {
  tenantId: '${values.tenantId}',
  locale: '${values.locale}',
  uiMode: '${values.uiMode}'
};

const FRAME_STYLE = {
  source: '${values.appName.toLowerCase().replace(/\s+/g, '-')}',
  placement: '${values.placement}',
  panelWidth: ${values.panelWidth},
  panelHeight: ${values.panelHeight},
  panelRadius: ${values.panelRadius}
};

let ac2Session = null;

export async function openAc2(frameElement) {
  ac2Session = await requestAc2Session(AC2_API_BASE, CLIENT_CONTEXT, ${credentials});
  frameElement.src = AC2_URL;
}

export function bindAc2Messages(frameElement, handlers = {}) {
  const onReady = handlers.onReady || (() => {});
  const onInitAck = handlers.onInitAck || (() => {});
  const onAvatarSelected = handlers.onAvatarSelected || (() => {});
  const onCloseRequest = handlers.onCloseRequest || (() => {});
  const onError = handlers.onError || ((payload) => console.error('AC2 error', payload));

  window.addEventListener('message', async (event) => {
    if (event.origin !== AC2_ORIGIN) {
      return;
    }

    const message = event.data || {};

    if (message.type === 'ac2:ready') {
      onReady(message.payload || {});
      if (frameElement && frameElement.contentWindow && ac2Session) {
        frameElement.contentWindow.postMessage({
          type: 'ac2:init',
          requestId: 'host-' + Date.now(),
          payload: {
            ...ac2Session,
            apiBase: AC2_API_BASE,
            uiMode: CLIENT_CONTEXT.uiMode,
            locale: CLIENT_CONTEXT.locale,
            frameStyle: FRAME_STYLE
          }
        }, AC2_ORIGIN);
      }
      return;
    }

    if (message.type === 'ac2:init-ack') {
      onInitAck(message.payload || {});
      return;
    }

    if (message.type === 'ac2:avatar-selected') {
      onAvatarSelected(message.payload || {});
      return;
    }

    if (message.type === 'ac2:close-request') {
      onCloseRequest(message.payload || {});
      return;
    }

    if (message.type === 'ac2:error' || message.type === 'ac2:blocked') {
      onError(message.payload || {});
    }
  });
}

export async function syncInitialAvatar() {
  if (!ac2Session || !ac2Session.sessionToken) {
    throw new Error('AC2 session is not ready. Call openAc2() first.');
  }

  const filesResult = await fetchVrmFiles(AC2_API_BASE, ac2Session.sessionToken, ${credentials});
  const files = Array.isArray(filesResult.files) ? filesResult.files : [];

  if (!files.length) {
    return null;
  }

  let key = null;
  const active = await fetchActiveAvatar(AC2_API_BASE, ac2Session.sessionToken, ${credentials});
  if (active && active.key) {
    key = active.key;
  } else {
    key = files[0].key;
  }

  const download = await fetchDownloadUrl(AC2_API_BASE, ac2Session.sessionToken, key, 3600, ${credentials});
  await saveActiveAvatar(AC2_API_BASE, ac2Session.sessionToken, key, ${credentials});
  return download;
}
`;
  }

  function renderApiSnippet(values) {
    const credentials = values.useCredentials ? "'include'" : "'omit'";

    return `/**
 * frontend/ac2-api.js
 * Responsibilities: API request helpers
 */

function buildAuthHeaders(sessionToken, extra = {}) {
  return {
    ...extra,
    Authorization: 'Bearer ' + sessionToken
  };
}

export async function requestAc2Session(apiBase, context, credentials = ${credentials}) {
  const response = await fetch(apiBase + '/api/ac2/session', {
    method: 'POST',
    credentials,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tenantId: context.tenantId
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create AC2 session (' + response.status + ')');
  }

  return response.json();
}

export async function fetchVrmFiles(apiBase, sessionToken, credentials = ${credentials}) {
  const response = await fetch(apiBase + '/api/ac2/files', {
    method: 'GET',
    credentials,
    headers: buildAuthHeaders(sessionToken)
  });

  if (!response.ok) {
    throw new Error('Failed to fetch VRM files (' + response.status + ')');
  }

  return response.json();
}

export async function fetchDownloadUrl(apiBase, sessionToken, key, expiresIn = 3600, credentials = ${credentials}) {
  const response = await fetch(
    apiBase + '/api/ac2/download-url?key=' + encodeURIComponent(key) + '&expiresIn=' + encodeURIComponent(expiresIn),
    {
      method: 'GET',
      credentials,
      headers: buildAuthHeaders(sessionToken)
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create download URL (' + response.status + ')');
  }

  return response.json();
}

export async function fetchActiveAvatar(apiBase, sessionToken, credentials = ${credentials}) {
  const response = await fetch(apiBase + '/api/ac2/active-avatar', {
    method: 'GET',
    credentials,
    headers: buildAuthHeaders(sessionToken)
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export async function saveActiveAvatar(apiBase, sessionToken, key, credentials = ${credentials}) {
  const response = await fetch(apiBase + '/api/ac2/active-avatar', {
    method: 'PUT',
    credentials,
    headers: buildAuthHeaders(sessionToken, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ key })
  });

  if (!response.ok) {
    throw new Error('Failed to save active avatar (' + response.status + ')');
  }

  return response.json();
}
`;
  }

  function renderSecuritySnippet(values, issues) {
    const allowlistText = values.allowedOrigins.length
      ? values.allowedOrigins.map((origin) => `  '${origin}'`).join(',\n')
      : "  '<<ADD_ALLOWED_ORIGIN>>'";

    const issueSummary = issues.length
      ? issues.map((issue) => '- ' + issue).join('\n')
      : '- No validation issues found.';

    return `# backend/security-config.md

## 1) CORS Allowlist (Worker)
\`\`\`js
const ALLOWED_ORIGINS = new Set([
${allowlistText}
]);
\`\`\`

## 2) Frontend Message Origin Guard
\`\`\`js
function isTrustedAc2Event(event) {
  return event.origin === '${SYSTEM_DEFAULTS.ac2Origin}';
}
\`\`\`

## 3) Required Backend Controls
- Verify bearer session token signature and expiration on every protected endpoint.
- Validate object key ownership against tenant scope before file operations.
- Keep signed download URLs short-lived.
- Never trust tenantId passed from browser directly.

## 4) System-fixed Endpoints
- AC2 URL: ${SYSTEM_DEFAULTS.ac2Url}
- AC2 Origin: ${SYSTEM_DEFAULTS.ac2Origin}
- API Base: ${SYSTEM_DEFAULTS.apiBase}

## 5) Validation Report
${issueSummary}
`;
  }

  function render() {
    const values = getFormData();
    const validation = validate(values);

    renderFieldErrors(validation.fieldErrors);
    frontendOutput.textContent = renderFrontendSnippet(values);
    apiOutput.textContent = renderApiSnippet(values);
    securityOutput.textContent = renderSecuritySnippet(values, validation.issues);
  }

  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.getAttribute('data-copy-target');
      const target = document.getElementById(targetId);
      const text = target ? target.textContent : '';

      if (!text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1200);
      } catch (error) {
        console.error(error);
        button.textContent = 'Failed';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1200);
      }
    });
  });

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-tab-target');

      tabButtons.forEach((entry) => {
        entry.classList.toggle('is-active', entry === button);
      });

      tabPanels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.getAttribute('data-tab-panel') === target);
      });
    });
  });

  form.addEventListener('input', render);
  form.addEventListener('change', render);

  render();
})();
