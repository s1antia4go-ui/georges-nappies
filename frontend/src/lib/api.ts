export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : res.status === 429 ? "Too many requests. Try again shortly." : "Something went wrong.";
    if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("gn:unauthorized"));
    throw new ApiError(res.status, detail, data?.field);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", url, fd);
  },
};

export const qs = (params: Record<string, string | number | undefined>) =>
  "?" +
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
