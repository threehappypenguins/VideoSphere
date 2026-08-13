// =============================================================================
// Google Cloud service account JSON validation
// =============================================================================

/**
 * Minimal service-account JSON fields required by the TTS client.
 */
export interface GcpServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
}

/**
 * Parses and validates a pasted Google Cloud service account JSON string.
 * @param raw - Raw JSON text from the owner UI.
 * @returns Parsed key object, or an error message.
 */
export function parseGcpServiceAccountJson(
  raw: string
): { ok: true; value: GcpServiceAccountKey } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Service account JSON is required.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'Service account JSON is not valid JSON.' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Service account JSON must be an object.' };
  }

  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  const projectId = typeof obj.project_id === 'string' ? obj.project_id : '';
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : '';

  if (type !== 'service_account') {
    return { ok: false, error: 'JSON type must be "service_account".' };
  }
  if (!projectId.trim() || !privateKey.trim() || !clientEmail.trim()) {
    return {
      ok: false,
      error: 'Service account JSON must include project_id, private_key, and client_email.',
    };
  }

  return {
    ok: true,
    value: {
      type,
      project_id: projectId,
      private_key: privateKey,
      client_email: clientEmail,
    },
  };
}
