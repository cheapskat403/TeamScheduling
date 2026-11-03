/**
 * Input validation for anything an employee can type, paste or upload.
 *
 * Why it exists: these values are shown to other people (team colours, desk names, images...), so an
 * unchecked value such as   red" onmouseover="...   becomes a booby trap that runs in a colleague's
 * browser. Every route that stores such values runs the matching schema below before saving.
 *
 *   router.post('/', validateBody('team', { required: ['name'] }), handler)
 *
 * Only the fields that are present are checked, so partial updates (PUT) keep working. Checked values
 * are written back to req.body, already trimmed and with control characters removed.
 */

class ValidationError extends Error {}

const CONTROL_CHARS = new RegExp('[\u0000-\u001F\u007F\u2028\u2029]', 'g');
const CONTROL_NO_NEWLINE = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F\\u2028\\u2029]', 'g');
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const HTTPS_URL = /^https:\/\/[^\s"'<>\\`]{1,480}$/;
const SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@"<>\\`]{1,120}@[^\s@"'<>\\`]{1,120}$/;   // an apostrophe is fine in the name part (o'brien@...)
const FLOOR = /^[A-Za-z0-9 _-]{1,20}$/;
const FLOORPLAN_FILE = /^\/floorplans\/[A-Za-z0-9._-]{1,100}$/;
const CHAIR_SIDES = ['top', 'bottom', 'left', 'right'];
const MAX_IMAGE_CHARS = 400000;     // a base64 profile photo is normally 20-100 KB

// ------------------------------------------------------------------ single-value checks
// Each takes (value, label) and returns the cleaned value, or throws a ValidationError.

const fail = (message) => { throw new ValidationError(message); };

/** Plain text: a string, control characters removed, trimmed, at most `max` characters. Empty is allowed. */
const str = (max, { multiline = false } = {}) => (value, label) => {
    if (typeof value !== 'string') fail(`${label} must be text`);
    // Line breaks become a space (or stay, for multi-line fields) instead of gluing words together
    const text = multiline ? value.replace(/\r\n?/g, '\n') : value.replace(/[\r\n\t]+/g, ' ');
    const clean = text.replace(multiline ? CONTROL_NO_NEWLINE : CONTROL_CHARS, '').trim();
    if (clean.length > max) fail(`${label} must be at most ${max} characters`);
    return clean;
};

/** A hex colour such as #3b82f6. Empty and null are allowed (no colour). */
const color = (value, label) => {
    if (value === null || value === '') return value;
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(`${label} must be a hex colour like #3b82f6`);
    return value;
};

/** A picture: nothing, a small image data URL, or an https link. */
const image = (value, label) => {
    if (value === null || value === '') return value;
    if (typeof value !== 'string') fail(`${label} must be an image`);
    if (value.startsWith('data:')) {
        if (value.length > MAX_IMAGE_CHARS) fail(`${label} is too large`);
        if (!IMAGE_DATA_URL.test(value)) fail(`${label} must be a png, jpeg, gif or webp image`);
        return value;
    }
    if (!HTTPS_URL.test(value)) fail(`${label} must be an https link or an image`);
    return value;
};

/** A whole number in [min, max]. Numeric strings are accepted (forms send them) and returned as numbers. */
const int = (min, max) => (value, label) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}`);
    return n;
};

const oneOf = (list) => (value, label) => {
    if (!list.includes(value)) fail(`${label} must be one of: ${list.join(', ')}`);
    return value;
};

/** An identifier: letters, numbers, - and _ only. Empty and null are allowed (not set). */
const slug = (value, label) => {
    if (value === null || value === '') return value;
    if (typeof value !== 'string' || !SLUG.test(value)) fail(`${label} is not a valid id`);
    return value;
};

/** A floor name: letters, numbers, space, - and _ . Empty is allowed. */
const floor = (value, label) => {
    if (typeof value !== 'string') fail(label + ' must be text');
    const clean = value.trim();
    if (clean !== '' && !FLOOR.test(clean)) fail(label + ' may only contain letters, numbers, spaces, - and _ (20 characters at most)');
    return clean;
};

const date = (value, label) => {
    if (typeof value !== 'string' || !DATE.test(value)) fail(`${label} must be a date like 2026-03-31`);
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(`${label} is not a real date`);
    return value;
};

const email = (value, label) => {
    if (value === null || value === '') return value;
    if (typeof value !== 'string' || !EMAIL.test(value.trim())) fail(`${label} must be an email address`);
    return value.trim();
};

const chairs = (value, label) => {
    if (!Array.isArray(value) || value.length > 4 || !value.every(v => CHAIR_SIDES.includes(v))) {
        fail(`${label} must list some of: ${CHAIR_SIDES.join(', ')}`);
    }
    return [...new Set(value)];
};

const points = (value, label) => {
    const ok = Array.isArray(value) && value.length <= 200 && value.every(p =>
        Number.isFinite(p) || (Array.isArray(p) && p.every(Number.isFinite)) ||
        (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)));
    if (!ok) fail(`${label} must be a list of numbers or {x, y} points`);
    return value;
};

// ------------------------------------------------------------------ schemas (one per kind of record)

const schemas = {
    team: {
        name: str(100), manager: str(100), managerImage: image, color,
        memberCount: int(1, 1000), locationId: slug
    },
    location: {
        name: str(100), address: str(250), capacity: int(1, 100000), floors: int(1, 100),
        floorPlanWidth: int(0, 100000), floorPlanHeight: int(0, 100000)
    },
    desk: {
        name: str(60), locationId: slug, floor, zone: str(60),
        x: int(-1000, 10000), y: int(-1000, 10000), width: int(1, 2000), height: int(1, 2000),
        deskType: oneOf(['hotseat', 'team_seat', 'unavailable']), assignedTeamId: slug, chairPositions: chairs
    },
    floorElement: {
        type: oneOf(['room', 'wall', 'label']), locationId: slug, floor,
        x: int(-1000, 10000), y: int(-1000, 10000), width: int(0, 10000), height: int(0, 10000),
        rotation: int(-360, 360), points, label: str(100), color
    },
    booking: {
        date, teamId: slug, teamName: str(100), peopleCount: int(1, 1000), locationId: slug, notes: str(500, { multiline: true })
    },
    deskBooking: {
        deskId: slug, date, employeeName: str(100), employeeEmail: email, teamId: slug
    }
};

/**
 * Express middleware that checks req.body against a schema.
 * @param {keyof typeof schemas} schemaName
 * @param {{required?: string[]}} [options] fields that must be present
 */
function validateBody(schemaName, { required = [] } = {}) {
    const schema = schemas[schemaName];
    if (!schema) throw new Error(`Unknown validation schema: ${schemaName}`);

    return (req, res, next) => {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Request body must be a JSON object', code: 'INVALID_INPUT' });
        }
        try {
            for (const field of required) {
                if (body[field] === undefined || body[field] === null || body[field] === '') fail(`${field} is required`);
            }
            for (const [field, check] of Object.entries(schema)) {
                if (body[field] !== undefined) body[field] = check(body[field], field);
            }
            return next();
        } catch (error) {
            if (error instanceof ValidationError) {
                return res.status(400).json({ error: error.message, code: 'INVALID_INPUT' });
            }
            return next(error);
        }
    };
}

// ------------------------------------------------------------------ settings (free-form key/value)

const SETTING_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_SETTING_JSON = 20000;

/** Checks a setting's key and value; returns the cleaned value. Throws ValidationError. */
function settingValue(key, value) {
    if (!SETTING_KEY.test(key)) fail('Setting name may only contain letters, numbers and _ . : -');
    if (value === undefined) fail('Value is required');

    if (key === 'team_roles') {
        if (!Array.isArray(value)) fail('team_roles must be an array');
        if (!value.every(v => typeof v === 'string')) fail('team_roles must be an array of strings');
        if (value.length > 200) fail('team_roles can have at most 200 items');
        return value.map(v => str(100)(v, 'team_roles item'));
    }

    if (key === 'admin_emails') {
        if (!Array.isArray(value)) fail('admin_emails must be an array');
        if (value.length > 200) fail('admin_emails can have at most 200 items');
        return [...new Set(value.map(v => email(v, 'admin_emails item').toLowerCase()))];
    }

    if (key === 'audit_viewer_roles') {
        if (!Array.isArray(value)) fail('audit_viewer_roles must be an array');
        if (!value.every(v => typeof v === 'string')) fail('audit_viewer_roles must be an array of strings');
        if (value.length > 200) fail('audit_viewer_roles can have at most 200 items');
        return value.map(v => str(100)(v, 'audit_viewer_roles item'));
    }

    if (key.startsWith('floorplan_bg_')) {
        const ok = value && typeof value === 'object' && !Array.isArray(value)
            && typeof value.url === 'string' && FLOORPLAN_FILE.test(value.url)
            && Number.isFinite(value.x) && Math.abs(value.x) <= 10000
            && Number.isFinite(value.y) && Math.abs(value.y) <= 10000
            && Number.isFinite(value.width) && value.width > 0 && value.width <= 20000
            && Number.isFinite(value.height) && value.height > 0 && value.height <= 20000;
        if (!ok) fail('A floor plan background needs a file from /floorplans/ and numeric x, y, width and height');
        return { url: value.url, x: value.x, y: value.y, width: value.width, height: value.height };
    }

    if (JSON.stringify(value).length > MAX_SETTING_JSON) fail('Setting value is too large');
    return value;
}

// ------------------------------------------------------------------ small helpers for routes

/** Public holiday request values that go into an outgoing URL */
const holidayYear = (value) => { if (!/^\d{4}$/.test(String(value))) fail('year must be 4 digits'); return String(value); };
const countryCode = (value) => { if (!/^[A-Z]{2}$/.test(String(value))) fail('country must be a 2-letter code like ZA'); return String(value); };

/** Escape text for an iCalendar (.ics) field so it cannot add lines or properties */
const icsText = (value) => String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

module.exports = {
    ValidationError, validateBody, schemas, settingValue, holidayYear, countryCode, icsText,
    checks: { floor, str, color, image, int, oneOf, slug, date, email, chairs, points },
    HEX_COLOR, IMAGE_DATA_URL, SLUG
};
