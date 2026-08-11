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

// India's fiscal year runs April -> March. offset 0 = current FY, -1 = previous FY.
export function getFiscalYearRange(offset, today) {
  const fyStartCalendarYear = (today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1) + offset;
  return {
    start: new Date(fyStartCalendarYear, 3, 1),
    end: new Date(fyStartCalendarYear + 1, 2, 31, 23, 59, 59, 999),
  };
}

// Determines the *real* status of an invoice/bill from its actual numbers,
// rather than trusting a manually-set field that can go stale (e.g. nobody
// remembers to flip it to "Overdue" once a due date quietly passes).
export function computeStatus({ amount, paid_amount, due_date }, baseStatus) {
  const paid = Number(paid_amount) || 0;
  const total = Number(amount) || 0;

  if (total > 0 && paid >= total) return "Paid";
  if (paid > 0) return "Partial";

  if (due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(due_date); due.setHours(0, 0, 0, 0);
    if (due < today) return "Overdue";
    if (due.getTime() === today.getTime()) return "Due today";
  }

  return baseStatus; // "Sent" for sales, "Approved" for purchases - nothing paid, not yet due
}

// The database columns only accept a fixed set of values per table (a
// constraint from the original schema). The computed status above can
// produce values outside that set for a given table (e.g. "Partial" isn't
// in purchase_bills' allowed list) - this maps back to the nearest allowed
// value so writes never fail, while the app always *displays* the fully
// accurate computed value regardless of what's persisted.
export function statusForStorage(computed, isSales) {
  const salesAllowed = ["Sent", "Paid", "Partial", "Overdue"];
  const purchaseAllowed = ["Approved", "Paid", "Due today", "Overdue"];
  const allowed = isSales ? salesAllowed : purchaseAllowed;
  if (allowed.includes(computed)) return computed;
  if (computed === "Due today" && isSales) return "Sent";
  if (computed === "Partial" && !isSales) return "Approved";
  return isSales ? "Sent" : "Approved";
}

// Single source of truth for the manual status vocabulary - both
// PaymentFollowUpScreen and ReceivablesScreen import this rather than
// each keeping their own copy, so adding a new value here (or the CHECK
// constraint that limits what the database will actually accept - see
// migration_partially_paid_status.sql) only has to happen once. Does NOT
// include "Cancelled" - that's a real, separate mechanism (is_cancelled),
// not a manual_status value; the screens that use this list add a
// "Cancelled" option of their own, wired to that mechanism directly.
export const MANUAL_STATUSES = ["Sent", "Overdue", "Partially Paid", "Paid", "Invoiced", "Completed"];

// A document (invoice/bill/PI) should stop counting toward "still owed"
// totals for three different reasons, and all of them matter: the amount
// is genuinely fully paid, it's been cancelled/voided, or someone has
// manually tagged it Paid/Invoiced/Completed. That last one matters most
// for Proforma Invoices specifically - "Invoiced" means a real Tax Invoice
// now exists elsewhere for the same underlying receivable, so continuing
// to count the PI's amount as pending would double-count it once that Tax
// Invoice is also imported. Used everywhere a "still pending" figure is
// computed, so all of them agree with each other. "Partially Paid" is
// deliberately NOT in this list - some of the amount is still genuinely
// outstanding, so it should keep counting as pending exactly like the
// plain amount-based check already does on its own.
const RESOLVED_MANUAL_STATUSES = ["Paid", "Invoiced", "Completed"];

export function isResolved(doc) {
  if (doc.is_cancelled) return true;
  if (doc.manual_status && RESOLVED_MANUAL_STATUSES.includes(doc.manual_status)) return true;
  return Number(doc.amount) - Number(doc.paid_amount || 0) <= 0;
}
