export async function boardApi(
  path = "",
  { method = "GET", body, signal } = {},
) {
  return apiRequest(`/api/boards/${path}`, { method, body, signal });
}

export async function libraryData({ signal } = {}) {
  const info = await apiRequest('/api/session/', { signal });
  if (!info.user?.canAccess || !info.modules.mapper) return { ...info, boards: [] };
  try {
    const result = await boardApi('', { signal });
    return { ...info, boards: result.boards };
  } catch (error) {
    if (error.code === 'module_disabled') return { ...info, modules: { ...info.modules, mapper: false }, boards: [] };
    throw error;
  }
}

export async function apiRequest(url, { method = "GET", body, signal } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(url, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      ...(!multipart ? { "Content-Type": "application/json" } : {}),
      "X-CSRFToken": document.getElementById("mapper-root").dataset.csrfToken,
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`Board request failed: ${response.status}`);
    error.status = response.status;
    try {
      error.code = (await response.json()).error;
    } catch {
      /* CSRF errors may return HTML. */
    }
    throw error;
  }
  return response.json();
}
