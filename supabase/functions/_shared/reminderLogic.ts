// Shared between send-payment-reminder (manual, one document, runs as the
// calling user) and send-payment-reminders-batch (automatic, cron-invoked,
// runs as the service role across every firm) - both need the exact same
// schedule and wording, so it lives here once rather than being duplicated
// (and risking drifting out of sync) in two separate function files.

// Whole calendar days between an issued_date (YYYY-MM-DD) and today.
export function daysSince(issuedDate: string, today: Date): number {
  const issued = new Date(issuedDate + 'T00:00:00Z')
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return Math.floor((todayUtc.getTime() - issued.getTime()) / 86400000)
}

// The exact day a stage is scheduled to fire on, for automatic (cron)
// sends - each stage matches on exactly one day (or, for "overdue", every
// 2nd day past the due date), never re-fires early or late. Schedule:
//   day 3            -> gentle nudge
//   day (grace - 1)  -> reminder ("due tomorrow")
//   day grace        -> due today
//   every 2 days past grace -> overdue, with the day count
export function exactStageForDay(daysSinceIssued: number, graceDays: number): string | null {
  if (daysSinceIssued === 3) return 'gentle'
  if (daysSinceIssued === graceDays - 1) return 'reminder'
  if (daysSinceIssued === graceDays) return 'due'
  if (daysSinceIssued > graceDays && (daysSinceIssued - graceDays) % 2 === 0) return 'overdue'
  return null
}

// For a manual "send now" click, which can happen on any day, not just an
// exact scheduled one - returns whichever stage is the most advanced one
// that already applies as of today, so there's always something sensible
// to send. Returns null only if it's too early (before day 3) to send
// anything at all.
export function currentStage(daysSinceIssued: number, graceDays: number): string | null {
  if (daysSinceIssued < 3) return null
  if (daysSinceIssued > graceDays) return 'overdue'
  if (daysSinceIssued >= graceDays) return 'due'
  if (daysSinceIssued >= graceDays - 1) return 'reminder'
  return 'gentle'
}

export function reminderEmailContent(
  stage: string,
  { customerName, docLabel, docNumber, amountDue, daysSinceIssued, graceDays, firmName }:
  { customerName: string; docLabel: string; docNumber: string; amountDue: string; daysSinceIssued: number; graceDays: number; firmName: string }
) {
  const overdueDays = daysSinceIssued - graceDays
  const greeting = `Hi ${customerName || 'there'},`

  if (stage === 'gentle') {
    return {
      subject: `${docLabel} ${docNumber} from ${firmName}`,
      html: `<p>${greeting}</p><p>Just a friendly note that ${docLabel.toLowerCase()} <strong>${docNumber}</strong> for <strong>${amountDue}</strong> is on its way to being due. No action needed yet - this is just a heads up.</p><p>Thanks,<br>${firmName}</p>`,
    }
  }
  if (stage === 'reminder') {
    return {
      subject: `Reminder: ${docLabel} ${docNumber} due soon`,
      html: `<p>${greeting}</p><p>${docLabel} <strong>${docNumber}</strong> for <strong>${amountDue}</strong> is due tomorrow. Please arrange payment at your earliest convenience.</p><p>Thanks,<br>${firmName}</p>`,
    }
  }
  if (stage === 'due') {
    return {
      subject: `${docLabel} ${docNumber} is due today`,
      html: `<p>${greeting}</p><p>${docLabel} <strong>${docNumber}</strong> for <strong>${amountDue}</strong> is due today. If payment has already been made, please disregard this note.</p><p>Thanks,<br>${firmName}</p>`,
    }
  }
  // 'overdue'
  return {
    subject: `Overdue: ${docLabel} ${docNumber} (${overdueDays} day${overdueDays === 1 ? '' : 's'})`,
    html: `<p>${greeting}</p><p>${docLabel} <strong>${docNumber}</strong> for <strong>${amountDue}</strong> is now <strong>${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue</strong>. Please arrange payment as soon as possible, or let us know if there's anything holding it up.</p><p>Thanks,<br>${firmName}</p>`,
  }
}
