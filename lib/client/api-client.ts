// Browser-side helper for calling the JSON API with the shared envelope.

export interface ClientApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ClientApiError };

export function postJson<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return requestJson<T>("POST", url, body);
}

export async function requestJson<T>(method: "POST" | "PATCH", url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection and try again." },
    };
  }

  const payload = await res.json().catch(() => null);
  if (res.ok && payload && "data" in payload) return { ok: true, data: payload.data as T };
  return {
    ok: false,
    status: res.status,
    error: payload?.error ?? { code: "UNKNOWN", message: `Request failed with status ${res.status}.` },
  };
}
