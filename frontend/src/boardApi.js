export async function boardApi(
  path = "",
  { method = "GET", body, signal } = {},
) {
  const response = await fetch(`/api/boards/${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": document.getElementById("mapper-root").dataset.csrfToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
