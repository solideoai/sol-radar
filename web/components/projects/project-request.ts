export async function projectRequest(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<unknown> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "sol-radar",
    },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "object" &&
      value.error !== null &&
      "message" in value.error &&
      typeof value.error.message === "string"
        ? value.error.message
        : "저장하지 못했습니다. 다시 시도하세요.";
    throw new Error(message);
  }
  return value;
}
