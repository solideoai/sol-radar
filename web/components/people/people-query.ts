export function peopleSearchParams(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  return params;
}

export function peopleListParams(params: URLSearchParams) {
  const query = new URLSearchParams(params);
  query.delete("view");
  query.set("limit", "20");
  return query;
}

export function peopleHref(query: string, changes: Record<string, string | null>) {
  const params = new URLSearchParams(query);
  params.delete("view");
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  return `/people${params.size ? `?${params}` : ""}`;
}
