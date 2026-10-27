/**
 * Date helpers. The office is in South Africa, so "today" must follow that
 * timezone rather than UTC (which rolls over at 02:00 local time).
 */
const OFFICE_TIMEZONE = process.env.OFFICE_TIMEZONE || 'Africa/Johannesburg';

/** Today's date in the office timezone as YYYY-MM-DD */
function todayInOffice(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: OFFICE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
}

module.exports = { todayInOffice, OFFICE_TIMEZONE };
