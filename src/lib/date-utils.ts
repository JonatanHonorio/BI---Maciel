export function parseDateRange(searchParams: URLSearchParams) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const since = searchParams.get("since") || firstOfMonth.toISOString().split("T")[0];
  const until = searchParams.get("until") || today.toISOString().split("T")[0];

  return { since, until };
}
