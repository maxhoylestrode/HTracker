// Date helpers. All dates are plain "YYYY-MM-DD" strings, treated as local calendar dates (no time zone math).

function parseISO(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // handle month-length overflow (e.g. Jan 31 + 1 month)
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function addYears(date, n) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

// Returns an array of ISO date strings ("YYYY-MM-DD") on which this expense
// occurs within [rangeStart, rangeEnd] (inclusive), given its frequency.
function occurrencesInRange(expense, rangeStart, rangeEnd) {
  const start = parseISO(expense.start_date);
  const rStart = parseISO(rangeStart);
  const rEnd = parseISO(rangeEnd);
  const end = expense.end_date ? parseISO(expense.end_date) : null;
  const results = [];

  if (expense.frequency === 'one_off') {
    if (start >= rStart && start <= rEnd && (!end || start <= end)) {
      results.push(toISO(start));
    }
    return results;
  }

  const stepFn = { weekly: (d) => addDays(d, 7), monthly: (d) => addMonths(d, 1), yearly: (d) => addYears(d, 1) }[expense.frequency];
  if (!stepFn) return results;

  let cursor = start;
  // Fast-forward cursor close to rStart to avoid iterating from the beginning of time
  // for old expenses, without doing unbounded math. Cap iterations for safety.
  let guard = 0;
  while (cursor < rStart && guard < 5000) {
    if (end && cursor > end) return results;
    cursor = stepFn(cursor);
    guard++;
  }

  guard = 0;
  while (cursor <= rEnd && guard < 5000) {
    if (end && cursor > end) break;
    if (cursor >= rStart) results.push(toISO(cursor));
    cursor = stepFn(cursor);
    guard++;
  }
  return results;
}

// The next occurrence on or after `fromDate` (ISO string), or null if none (e.g. one_off already past, or past end_date).
function nextOccurrence(expense, fromDate) {
  const rangeEnd = toISO(addYears(parseISO(fromDate), 2)); // look ahead up to 2 years
  const occ = occurrencesInRange(expense, fromDate, rangeEnd);
  return occ.length ? occ[0] : null;
}

module.exports = { parseISO, toISO, addDays, addMonths, addYears, occurrencesInRange, nextOccurrence };
