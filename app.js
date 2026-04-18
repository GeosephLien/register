(function () {
  const SYSTEM_DEFAULTS = {
    appName: 'Partner Host',
    tenantId: 'openme@htc.com',
    locale: 'zh-TW',
    ac2Url: 'https://geosephlien.github.io/ac2/?embedded=1&uiMode=modal',
    ac2Origin: 'https://geosephlien.github.io',
    apiBase: 'https://ac2-host-api-avatar-page.kuanyi-lien.workers.dev',
    hostOrigin: 'http://localhost:5500',
    uiMode: 'modal',
    placement: 'center',
    panelWidth: 1280,
    panelHeight: 780,
    panelRadius: 28
  };

  const form = document.getElementById('generator-form');
  const downloadButton = document.getElementById('download-demo-button');
  const verificationModal = document.getElementById('download-verification-modal');
  const verificationCodeInput = document.getElementById('verification-code-input');
  const verificationStatus = document.getElementById('verification-status');
  const verificationDownloadButton = document.getElementById('verification-download-button');
  const verificationCloseTargets = Array.from(document.querySelectorAll('[data-close-verification-panel]'));

  const verificationState = {
    isOpen: false,
    isVerified: false,
    requestId: '',
    email: '',
    hostOrigin: '',
    tenantId: '',
    isSending: false,
    isDownloading: false
  };

  const fieldErrorElements = new Map(
    Array.from(document.querySelectorAll('[data-field-error]')).map((element) => [
      element.getAttribute('data-field-error'),
      element
    ])
  );

  const editableFieldNames = ['hostOrigin', 'tenantId'];

  function getFrameSource(hostOrigin) {
    try {
      const host = new URL(hostOrigin).hostname || 'partner-host';
      return host.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'partner-host';
    } catch {
      return 'partner-host';
    }
  }

  function sanitizeArchiveName(value, fallback = 'ac2-demo') {
    const sanitized = String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return sanitized || fallback;
  }

  function getArchiveBaseName(emailLikeValue, fallback = 'ac2-demo') {
    const normalizedValue = String(emailLikeValue || '').trim();
    const localPart = normalizedValue.includes('@')
      ? normalizedValue.split('@')[0]
      : normalizedValue;

    return sanitizeArchiveName(localPart, fallback);
  }

  function escapeForSingleQuotedJs(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function escapeForHtmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function replaceLiteral(source, searchValue, replaceValue) {
    if (!source.includes(searchValue)) {
      throw new Error('Expected template fragment not found: ' + searchValue);
    }

    return source.replace(searchValue, replaceValue);
  }

  async function fetchAsset(path, responseType = 'text') {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to fetch ' + path + ' (' + response.status + ')');
    }

    if (responseType === 'blob') {
      return response.blob();
    }

    return response.text();
  }

  async function registerHostOrigin(values) {
    const response = await fetch(SYSTEM_DEFAULTS.apiBase + '/api/ac2/register-host', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tenantId: values.tenantId,
        hostOrigin: values.hostOrigin,
        downloadRequestId: values.downloadRequestId || ''
      })
    });

    if (!response.ok) {
      throw new Error('Failed to register host origin (' + response.status + ')');
    }

    return response.json();
  }

  async function requestDownloadCode(values) {
    const response = await fetch(SYSTEM_DEFAULTS.apiBase + '/api/ac2/request-download-code', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tenantId: values.tenantId,
        hostOrigin: values.hostOrigin
      })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !payload.ok) {
      throw new Error(payload && payload.message ? payload.message : 'Failed to send verification code.');
    }

    return payload;
  }

  async function verifyDownloadCode(payload) {
    const response = await fetch(SYSTEM_DEFAULTS.apiBase + '/api/ac2/verify-download-code', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) {
      throw new Error(data && data.message ? data.message : 'Verification failed.');
    }

    return data;
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function isFilePickerAbortError(error) {
    return error && (error.name === 'AbortError' || error.message === 'The user aborted a request.');
  }

  async function saveBlobWithFilePicker(blob, filename) {
    if (typeof window.showSaveFilePicker !== 'function') {
      return false;
    }

    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'zip';
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'ZIP archive',
          accept: {
            'application/zip': ['.' + extension]
          }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  async function saveArchiveBlob(blob, filename) {
    try {
      const saved = await saveBlobWithFilePicker(blob, filename);
      if (saved) {
        return 'saved';
      }
    } catch (error) {
      if (isFilePickerAbortError(error)) {
        return 'cancelled';
      }
      console.warn('File picker save failed, falling back to browser download.', error);
    }

    triggerBlobDownload(blob, filename);
    return 'downloaded';
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }

    return table;
  })();

  function computeCrc32(bytes) {
    let crc = 0xffffffff;

    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  function createDosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    return {
      time: ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
    };
  }

  async function toUint8Array(value) {
    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer());
    }

    if (typeof value === 'string') {
      return new TextEncoder().encode(value);
    }

    throw new Error('Unsupported zip content type.');
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value & 0xffff, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  async function buildZipBlob(entries) {
    const normalizedEntries = await Promise.all(entries.map(async (entry) => {
      const nameBytes = new TextEncoder().encode(entry.path);
      const dataBytes = await toUint8Array(entry.content);
      return {
        nameBytes,
        dataBytes,
        crc32: computeCrc32(dataBytes)
      };
    }));

    const parts = [];
    const centralDirectoryParts = [];
    let localOffset = 0;
    const { time, date } = createDosDateTime();

    normalizedEntries.forEach((entry) => {
      const localHeader = new ArrayBuffer(30);
      const localView = new DataView(localHeader);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, time);
      writeUint16(localView, 12, date);
      writeUint32(localView, 14, entry.crc32);
      writeUint32(localView, 18, entry.dataBytes.length);
      writeUint32(localView, 22, entry.dataBytes.length);
      writeUint16(localView, 26, entry.nameBytes.length);
      writeUint16(localView, 28, 0);
      parts.push(localHeader, entry.nameBytes, entry.dataBytes);

      const centralHeader = new ArrayBuffer(46);
      const centralView = new DataView(centralHeader);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, 0);
      writeUint16(centralView, 10, 0);
      writeUint16(centralView, 12, time);
      writeUint16(centralView, 14, date);
      writeUint32(centralView, 16, entry.crc32);
      writeUint32(centralView, 20, entry.dataBytes.length);
      writeUint32(centralView, 24, entry.dataBytes.length);
      writeUint16(centralView, 28, entry.nameBytes.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, localOffset);
      centralDirectoryParts.push(centralHeader, entry.nameBytes);

      localOffset += 30 + entry.nameBytes.length + entry.dataBytes.length;
    });

    const centralDirectorySize = centralDirectoryParts.reduce((total, part) => total + part.byteLength, 0);
    const endRecord = new ArrayBuffer(22);
    const endView = new DataView(endRecord);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, normalizedEntries.length);
    writeUint16(endView, 10, normalizedEntries.length);
    writeUint32(endView, 12, centralDirectorySize);
    writeUint32(endView, 16, localOffset);
    writeUint16(endView, 20, 0);

    return new Blob([...parts, ...centralDirectoryParts, endRecord], {
      type: 'application/zip'
    });
  }

  async function buildTenantDemoArchive(values) {
    const tenantFolderName = 'ac2-' + getArchiveBaseName(values.tenantId, 'demo');
    const frameSource = getFrameSource(values.hostOrigin);

    const [
      readme,
      minimalHtml,
      minimalAc2Host,
      demoSceneHtml,
      demoSceneCss,
      demoSceneAc2Host,
      demoSceneMain,
      demoSceneVrmScene
    ] = await Promise.all([
      fetchAsset('../demo/README.md', 'text'),
      fetchAsset('../demo/minimal/index.html', 'text'),
      fetchAsset('../demo/minimal/ac2-host.js', 'text'),
      fetchAsset('../demo/demo-scene/index.html', 'text'),
      fetchAsset('../demo/demo-scene/style.css', 'text'),
      fetchAsset('../demo/demo-scene/ac2-host.js', 'text'),
      fetchAsset('../demo/demo-scene/main.js', 'text'),
      fetchAsset('../demo/demo-scene/vrm-scene.js', 'text')
    ]);

    const customizedMinimalHtml = replaceLiteral(
      minimalHtml,
      "const tenantId = 'viverse';",
      `const tenantId = '${escapeForSingleQuotedJs(values.tenantId)}';`
    );

    const customizedMinimalHtmlWithHostOrigin = replaceLiteral(
      customizedMinimalHtml,
      'const hostOrigin = window.location.origin;',
      `const hostOrigin = '${escapeForSingleQuotedJs(values.hostOrigin)}';`
    );

    const customizedMinimalAc2Host = replaceLiteral(
      minimalAc2Host,
      "source: 'partner-host',",
      `source: '${escapeForSingleQuotedJs(frameSource)}',`
    );

    const customizedDemoSceneHtml = replaceLiteral(
      replaceLiteral(
        demoSceneHtml,
        '<title>Partner VRM Host</title>',
        `<title>${escapeForHtmlText(values.tenantId)} VRM Host</title>`
      ),
      '<h1 class="overlay-title">Partner VRM Host</h1>',
      `<h1 class="overlay-title">${escapeForHtmlText(values.tenantId)} VRM Host</h1>`
    );

    const customizedDemoSceneAc2Host = replaceLiteral(
      demoSceneAc2Host,
      "source: 'partner-host',",
      `source: '${escapeForSingleQuotedJs(frameSource)}',`
    );

    const customizedDemoSceneMain = replaceLiteral(
      demoSceneMain,
      "tenantId: 'viverse',",
      `tenantId: '${escapeForSingleQuotedJs(values.tenantId)}',`
    );

    const blob = await buildZipBlob([
      {
        path: 'README.md',
        content: readme
      },
      {
        path: 'minimal/index.html',
        content: customizedMinimalHtmlWithHostOrigin
      },
      {
        path: 'minimal/ac2-host.js',
        content: customizedMinimalAc2Host
      },
      {
        path: 'demo-scene/index.html',
        content: customizedDemoSceneHtml
      },
      {
        path: 'demo-scene/style.css',
        content: demoSceneCss
      },
      {
        path: 'demo-scene/ac2-host.js',
        content: customizedDemoSceneAc2Host
      },
      {
        path: 'demo-scene/main.js',
        content: customizedDemoSceneMain
      },
      {
        path: 'demo-scene/vrm-scene.js',
        content: demoSceneVrmScene
      }
    ]);

    return {
      archiveName: tenantFolderName,
      blob
    };
  }

  function getFormData(options = {}) {
    const applyDefaults = options.applyDefaults === true;
    const data = new FormData(form);
    const values = Object.fromEntries(data.entries());
    const hostOrigin = String(values.hostOrigin || '').trim();
    const tenantId = String(values.tenantId || '').trim();

    return {
      appName: SYSTEM_DEFAULTS.appName,
      hostOrigin: hostOrigin || (applyDefaults ? SYSTEM_DEFAULTS.hostOrigin : ''),
      tenantId: tenantId || (applyDefaults ? SYSTEM_DEFAULTS.tenantId : ''),
      locale: SYSTEM_DEFAULTS.locale,
      uiMode: SYSTEM_DEFAULTS.uiMode,
      placement: SYSTEM_DEFAULTS.placement,
      panelWidth: SYSTEM_DEFAULTS.panelWidth,
      panelHeight: SYSTEM_DEFAULTS.panelHeight,
      panelRadius: SYSTEM_DEFAULTS.panelRadius,
      useCredentials: true,
      allowedOrigins: hostOrigin ? [hostOrigin] : []
    };
  }

  function validate(values) {
    const fieldErrors = {};
    const effectiveHostOrigin = values.hostOrigin || SYSTEM_DEFAULTS.hostOrigin;

    try {
      new URL(effectiveHostOrigin);
    } catch {
      fieldErrors.hostOrigin = 'Domain must be a valid URL.';
    }

    if (!values.tenantId) {
      fieldErrors.tenantId = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.tenantId)) {
      fieldErrors.tenantId = 'Email must be a valid email address.';
    }

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
  domain: '${values.hostOrigin}',
  locale: '${values.locale}',
  uiMode: '${values.uiMode}'
};

const FRAME_STYLE = {
  source: '${getFrameSource(values.hostOrigin)}',
  placement: '${values.placement}',
  breakpoint: 960,
  panelWidth: ${values.panelWidth},
  panelHeight: ${values.panelHeight},
  panelRadius: ${values.panelRadius},
  mobilePanelWidth: null,
  mobilePanelHeight: ${values.panelHeight},
  mobilePanelRadius: 22,
  padding: {
    top: 32,
    right: 32,
    bottom: 32,
    left: 32
  },
  mobilePadding: {
    top: 16,
    right: 0,
    bottom: 16,
    left: 0
  },
  backdrop: 'rgba(4, 7, 20, 0.58)',
  backdropFilter: 'blur(12px)',
  panelBackground: 'rgba(11, 14, 40, 0.96)',
  frameBackground: '#050814',
  border: '1px solid rgba(255, 255, 255, 0.18)'
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
      tenantId: context.tenantId,
      domain: context.domain
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
- Allowlist the host origin in Worker CORS before frontend testing.
- Map browser tenant input to a server-side tenant policy before production use.

## 4) System-fixed Endpoints
- AC2 URL: ${SYSTEM_DEFAULTS.ac2Url}
- AC2 Origin: ${SYSTEM_DEFAULTS.ac2Origin}
- API Base: ${SYSTEM_DEFAULTS.apiBase}

## 5) Current API Notes
- Session API currently accepts: { tenantId }
- Protected endpoints used by the host sample: /session, /files, /download-url, /active-avatar

## 6) Validation Report
${issueSummary}
`;
  }

  function clearFieldErrors() {
    renderFieldErrors({});
  }

  function setVerificationStatus(message, tone = '') {
    if (!verificationStatus) {
      return;
    }

    verificationStatus.textContent = message || '';
    verificationStatus.classList.toggle('is-error', tone === 'error');
    verificationStatus.classList.toggle('is-success', tone === 'success');
  }

  function syncVerificationDownloadButton() {
    if (!verificationDownloadButton) {
      return;
    }

    verificationDownloadButton.disabled = !verificationState.isVerified || verificationState.isDownloading;
  }

  function closeVerificationPanel() {
    verificationState.isOpen = false;
    verificationState.isVerified = false;
    verificationState.requestId = '';
    verificationState.email = '';
    verificationState.hostOrigin = '';
    verificationState.tenantId = '';
    verificationState.isSending = false;
    verificationState.isDownloading = false;

    if (verificationModal) {
      verificationModal.hidden = true;
    }

    if (verificationCodeInput) {
      verificationCodeInput.value = '';
      verificationCodeInput.classList.remove('input-error');
    }

    setVerificationStatus('');
    syncVerificationDownloadButton();
  }

  function openVerificationPanel(values) {
    verificationState.isOpen = true;
    verificationState.isVerified = false;
    verificationState.email = values.tenantId;
    verificationState.hostOrigin = values.hostOrigin;
    verificationState.tenantId = values.tenantId;

    if (verificationModal) {
      verificationModal.hidden = false;
    }

    if (verificationCodeInput) {
      verificationCodeInput.value = '';
      verificationCodeInput.classList.remove('input-error');
      window.setTimeout(() => verificationCodeInput.focus(), 0);
    }

    setVerificationStatus('Sending verification code...');
    syncVerificationDownloadButton();
  }

  async function performVerifiedDownload(values) {
    if (!downloadButton || verificationState.isDownloading) {
      return;
    }

    const originalMainButtonText = downloadButton.textContent;
    const originalPanelButtonText = verificationDownloadButton ? verificationDownloadButton.textContent : 'Download';

    verificationState.isDownloading = true;
    downloadButton.disabled = true;
    downloadButton.textContent = 'Preparing';
    if (verificationDownloadButton) {
      verificationDownloadButton.disabled = true;
      verificationDownloadButton.textContent = 'Preparing';
    }

    try {
      await registerHostOrigin(values);
      const archive = await buildTenantDemoArchive(values);
      const saveResult = await saveArchiveBlob(archive.blob, archive.archiveName + '.zip');

      if (saveResult !== 'cancelled') {
        closeVerificationPanel();
        downloadButton.textContent = 'Downloaded';
      } else {
        setVerificationStatus('Download was cancelled. You can try again.', 'error');
        downloadButton.textContent = originalMainButtonText;
      }
    } catch (error) {
      console.error(error);
      setVerificationStatus(error.message || 'Download failed.', 'error');
      if (verificationCodeInput) {
        verificationCodeInput.classList.add('input-error');
      }
      downloadButton.textContent = 'Failed';
    } finally {
      verificationState.isDownloading = false;
      if (verificationDownloadButton) {
        verificationDownloadButton.textContent = originalPanelButtonText;
      }
      syncVerificationDownloadButton();
      window.setTimeout(() => {
        downloadButton.disabled = false;
        downloadButton.textContent = originalMainButtonText;
      }, 1400);
    }
  }

  async function handleDownloadDemo() {
    const values = getFormData();
    const validation = validate(values);

    renderFieldErrors(validation.fieldErrors);
    if (validation.issues.length) {
      return;
    }

    if (!downloadButton) {
      return;
    }

    const originalText = downloadButton.textContent;
    downloadButton.disabled = true;
    downloadButton.textContent = 'Sending';

    try {
      const effectiveValues = getFormData({ applyDefaults: true });
      openVerificationPanel(effectiveValues);
      verificationState.isSending = true;
      const payload = await requestDownloadCode(effectiveValues);
      verificationState.requestId = payload.requestId || '';
      setVerificationStatus('Verification code sent. Enter the 4-digit code to enable download.');
      downloadButton.textContent = originalText;
    } catch (error) {
      console.error(error);
      if (verificationState.isOpen) {
        setVerificationStatus(error.message || 'Failed to send verification code.', 'error');
        if (verificationCodeInput) {
          verificationCodeInput.classList.add('input-error');
          verificationCodeInput.focus();
        }
      }
      downloadButton.textContent = 'Failed';
    } finally {
      verificationState.isSending = false;
      window.setTimeout(() => {
        downloadButton.disabled = false;
        if (downloadButton.textContent === 'Failed') {
          downloadButton.textContent = originalText;
        }
      }, 1400);
    }
  }

  async function handleVerificationCodeInput() {
    if (!verificationCodeInput || !verificationState.requestId) {
      return;
    }

    const code = verificationCodeInput.value.replace(/\D+/g, '').slice(0, 4);
    verificationCodeInput.value = code;
    verificationState.isVerified = false;
    verificationCodeInput.classList.remove('input-error');
    syncVerificationDownloadButton();

    if (code.length < 4) {
      setVerificationStatus('Enter the 4-digit verification code.');
      return;
    }

    setVerificationStatus('Verifying code...');

    try {
      await verifyDownloadCode({
        requestId: verificationState.requestId,
        tenantId: verificationState.tenantId,
        hostOrigin: verificationState.hostOrigin,
        code
      });
      verificationState.isVerified = true;
      setVerificationStatus('Code verified. Download is now enabled.', 'success');
      syncVerificationDownloadButton();
    } catch (error) {
      verificationState.isVerified = false;
      verificationCodeInput.classList.add('input-error');
      setVerificationStatus(error.message || 'Verification code is incorrect.', 'error');
      syncVerificationDownloadButton();
    }
  }

  form.addEventListener('input', () => {
    clearFieldErrors();
  });
  form.addEventListener('change', () => {
    clearFieldErrors();
  });

  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      handleDownloadDemo();
    });
  }

  if (verificationCodeInput) {
    verificationCodeInput.addEventListener('input', () => {
      handleVerificationCodeInput();
    });
  }

  if (verificationDownloadButton) {
    verificationDownloadButton.addEventListener('click', () => {
      if (!verificationState.isVerified) {
        setVerificationStatus('Enter the correct verification code before downloading.', 'error');
        if (verificationCodeInput) {
          verificationCodeInput.classList.add('input-error');
          verificationCodeInput.focus();
        }
        return;
      }

      performVerifiedDownload({
        ...getFormData({ applyDefaults: true }),
        tenantId: verificationState.tenantId,
        hostOrigin: verificationState.hostOrigin,
        downloadRequestId: verificationState.requestId
      });
    });
  }

  verificationCloseTargets.forEach((target) => {
    target.addEventListener('click', () => {
      closeVerificationPanel();
    });
  });

})();
