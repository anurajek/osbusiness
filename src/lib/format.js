export const inr = (n) =>
  "₹" + Math.abs(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export function daysAgoLabel(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const today = new Date();
  const diffMs = today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round(diffMs / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1) return `${days} days ago`;
  if (days === -1) return "Tomorrow";
  return `in ${Math.abs(days)} days`;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Returns { from, to } as ISO date strings (yyyy-mm-dd) for use in Supabase
// .gte()/.lte() filters, or null for "All time".
export function getPeriodRange(period, customFrom, customTo) {
  const today = new Date();
  if (period === "All time") return null;
  if (period === "Last month") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: startOfDay(from), to: endOfDay(to) };
  }
  if (period === "Last quarter") {
    const q = Math.floor(today.getMonth() / 3);
    const year = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const lastQ = q === 0 ? 3 : q - 1;
    const from = new Date(year, lastQ * 3, 1);
    const to = new Date(year, lastQ * 3 + 3, 0);
    return { from: startOfDay(from), to: endOfDay(to) };
  }
  if (period === "Last year") {
    const year = today.getFullYear() - 1;
    return { from: new Date(year, 0, 1), to: endOfDay(new Date(year, 11, 31)) };
  }
  if (period === "Custom" && customFrom && customTo) {
    return { from: startOfDay(new Date(customFrom)), to: endOfDay(new Date(customTo)) };
  }
  return null;
}

export function toISODate(d) {
  return d.toISOString().slice(0, 10);
}
