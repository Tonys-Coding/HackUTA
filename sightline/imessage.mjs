/**
 * Send Argo's large-text PNG over Chert iMessage (fire-and-forget).
 *
 * Shared / free trial (Gary / Chert support):
 *   CHERT_API_KEY=ftk_...
 *   CHERT_PROJECT_ID=<uuid>
 *   CHERT_LINE_ID=<shared line uuid>
 *   CHERT_IMESSAGE_TO=+1...   # verified phone (whitelist by texting the shared number)
 *   POST https://app.trychert.com/api/v1/shared-messages
 *   Body: { line_id, recipient, text, attachments } + Idempotency-Key header
 *
 * Always sends a native PNG attachment (in-thread image). No hosted link fallback —
 * tapping a separate URL is worse for low-vision callers than pinch-zooming the PNG.
 *
 * Dedicated Messaging tenant (optional fallback):
 *   CHERT_SIGNING_SECRET=... + console.trychert.com/api/v1/...
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { renderLargeTextPng } from './large-text-image.mjs';
import { getThemePreference } from './theme-pref.mjs';

const SHARED_BASE = 'https://app.trychert.com';
const DEDICATED_BASE = 'https://console.trychert.com';

function filled(v) {
  return Boolean(v && String(v).trim() && !/YOUR_/.test(v));
}

/** @returns {string} */
function projectId() {
  if (filled(process.env.CHERT_PROJECT_ID)) return process.env.CHERT_PROJECT_ID.trim();
  try {
    const p = `${process.env.HOME || ''}/.chert/credentials.json`;
    if (existsSync(p)) {
      const id = JSON.parse(readFileSync(p, 'utf8'))?.project_id;
      if (filled(id)) return String(id);
    }
  } catch {
    /* ignore */
  }
  return '';
}

function sharedLineId() {
  for (const name of ['CHERT_LINE_ID', 'CHERT_PHONE_LINE_ID', 'CHERT_SHARED_LINE_ID']) {
    if (filled(process.env[name])) return process.env[name].trim();
  }
  return '';
}

/** Project API key (ftk_…) preferred for shared trial. */
function projectApiKey() {
  for (const name of ['CHERT_API_KEY', 'CHERT_FACETIME_API_KEY', 'CHERT_PROJECT_API_KEY']) {
    if (filled(process.env[name])) return process.env[name].trim();
  }
  const legacy = process.env.CHERT_SIGNING_SECRET || '';
  if (legacy.startsWith('ftk_')) return legacy.trim();
  return '';
}

function messagingSecret() {
  const secret = process.env.CHERT_SIGNING_SECRET || '';
  if (filled(secret) && !secret.startsWith('ftk_')) return secret.trim();
  return '';
}

/**
 * Shared trial: project API key + X-Chert-Project-Id on app.trychert.com/shared-messages.
 * Dedicated: messaging signing secret on console.trychert.com.
 */
function authMode() {
  const key = projectApiKey();
  const pid = projectId();
  if (key && pid) {
    return {
      mode: 'shared',
      base: (process.env.CHERT_API_BASE || SHARED_BASE).replace(/\/$/, ''),
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Chert-Project-Id': pid,
      },
      sendPath: '/api/v1/shared-messages',
      attachPath: '/api/v1/shared-messages/attachments',
    };
  }
  const secret = messagingSecret();
  if (secret) {
    return {
      mode: 'dedicated',
      base: (process.env.CHERT_API_BASE || DEDICATED_BASE).replace(/\/$/, ''),
      headers: { Authorization: `Bearer ${secret}` },
      attachPath: '/api/v1/attachments',
      sendPath: '/api/v1/send',
    };
  }
  return null;
}

/**
 * Shared-line raw upload (when images are enabled on the line).
 * @param {Buffer} png
 * @param {ReturnType<typeof authMode>} auth
 * @param {string} filename
 */
async function uploadSharedPng(png, auth, filename) {
  const lineId = sharedLineId();
  if (!lineId) throw new Error('missing_CHERT_LINE_ID_for_attachment');
  const q = new URLSearchParams({
    filename,
    content_type: 'image/png',
    line_id: lineId,
  });
  const res = await fetch(`${auth.base}${auth.attachPath}?${q}`, {
    method: 'POST',
    headers: {
      ...auth.headers,
      'Content-Type': 'image/png',
      'Idempotency-Key': randomUUID(),
    },
    body: png,
    signal: AbortSignal.timeout(30_000),
  });
  const created = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`shared attachment HTTP ${res.status}: ${JSON.stringify(created).slice(0, 240)}`);
  }
  const attachmentId = created.attachment_id || created.id || created.data?.attachment_id || created.data?.id;
  if (!attachmentId) {
    throw new Error(`shared attachment missing id: ${JSON.stringify(created).slice(0, 240)}`);
  }
  return String(attachmentId);
}

/**
 * Dedicated Messaging create + PUT upload.
 * @param {Buffer} png
 * @param {ReturnType<typeof authMode>} auth
 * @param {string} filename
 */
async function uploadDedicatedPng(png, auth, filename) {
  const createRes = await fetch(`${auth.base}${auth.attachPath}`, {
    method: 'POST',
    headers: {
      ...auth.headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      content_type: 'image/png',
      size_bytes: png.length,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(`attachment create HTTP ${createRes.status}: ${JSON.stringify(created).slice(0, 240)}`);
  }
  const attachmentId = created.attachment_id || created.id || created.data?.attachment_id || created.data?.id;
  const uploadUrl = created.upload_url || created.data?.upload_url;
  if (!attachmentId || !uploadUrl) {
    throw new Error(`attachment create missing id/url: ${JSON.stringify(created).slice(0, 240)}`);
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      ...auth.headers,
      ...(created.required_headers || created.data?.required_headers || {}),
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
    },
    body: png,
    signal: AbortSignal.timeout(30_000),
  });
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '');
    throw new Error(`attachment upload HTTP ${putRes.status}: ${detail.slice(0, 200)}`);
  }
  return String(attachmentId);
}

/**
 * @param {{ text: string, phone?: string, caption?: string, theme?: string }} opts
 */
export async function sendLargeTextImessage(opts) {
  const phone = opts.phone || process.env.CHERT_IMESSAGE_TO;
  if (!filled(phone)) {
    return { ok: false, skipped: true, reason: 'missing_CHERT_IMESSAGE_TO' };
  }

  const auth = authMode();
  if (!auth) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_CHERT_API_KEY_or_PROJECT_ID',
    };
  }

  if (auth.mode === 'shared' && !sharedLineId()) {
    return { ok: false, skipped: true, reason: 'missing_CHERT_LINE_ID' };
  }

  const theme = opts.theme || getThemePreference(phone);
  const { png, lines } = renderLargeTextPng(opts.text, { theme });
  const filename = `argo-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  const caption =
    opts.caption ||
    'Argo large text — open the image and pinch to zoom. Voice on FaceTime is unchanged.';

  // Always native in-thread PNG — never a hosted link.
  const attachmentId =
    auth.mode === 'shared'
      ? await uploadSharedPng(png, auth, filename)
      : await uploadDedicatedPng(png, auth, filename);

  const idempotencyKey = `argo-magnifier-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const textPayload = caption;

  /** @type {Record<string, unknown>} */
  const body =
    auth.mode === 'shared'
      ? {
          line_id: sharedLineId(),
          recipient: phone,
          text: textPayload,
          attachments: [attachmentId],
        }
      : {
          phone,
          body: textPayload,
          attachments: [attachmentId],
          idempotency_key: idempotencyKey,
          ...(filled(process.env.CHERT_PHONE_LINE_ID)
            ? { phone_line_id: process.env.CHERT_PHONE_LINE_ID.trim() }
            : {}),
        };

  const sendHeaders = {
    ...auth.headers,
    'Content-Type': 'application/json',
    ...(auth.mode === 'shared' ? { 'Idempotency-Key': idempotencyKey } : {}),
  };

  const sendRes = await fetch(`${auth.base}${auth.sendPath}`, {
    method: 'POST',
    headers: sendHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const sent = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || sent.status === 'failed' || sent.data?.status === 'failed') {
    throw new Error(
      `iMessage send HTTP ${sendRes.status}: ${sent.reason || sent.error?.message || sent.error || JSON.stringify(sent).slice(0, 240)}`,
    );
  }

  return {
    ok: true,
    mode: auth.mode,
    theme,
    attachmentId,
    messageId: sent.message_id || sent.id || sent.data?.id,
    chatId: sent.chat_id || sent.data?.chat_id,
    lineCount: lines.length,
    bytes: png.length,
    filename,
  };
}

/**
 * Fire-and-forget wrapper for the call path — never throws into TTS.
 * @param {string} text
 * @param {(event: Record<string, unknown>) => void} [log]
 * @param {{ theme?: string, caption?: string, phone?: string }} [opts]
 */
export function queueLargeTextImessage(text, log, opts = {}) {
  if (!text?.trim()) return;
  void sendLargeTextImessage({ text, ...opts })
    .then(result => {
      log?.({ type: 'imessage.large_text', ...result });
      if (result.skipped) {
        console.warn('[argo] iMessage large-text skipped:', result.reason);
      } else {
        console.log('[argo] iMessage large-text sent', {
          mode: result.mode,
          theme: result.theme,
          messageId: result.messageId,
          attachmentId: result.attachmentId,
          bytes: result.bytes,
        });
      }
    })
    .catch(error => {
      console.error('[argo] iMessage large-text failed', error);
      log?.({
        type: 'imessage.large_text_error',
        error: String(error?.message || error),
      });
    });
}
