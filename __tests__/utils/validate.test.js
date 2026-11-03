/**
 * The input checks that stop booby-trapped values (colours, names, image links...) from being stored.
 */
const {
    validateBody, ValidationError, settingValue, holidayYear, countryCode, icsText, checks
} = require('../../utils/validate');

const run = (schema, body, options) => {
    const req = { body };
    const res = createMockResponse();
    const next = jest.fn();
    validateBody(schema, options)(req, res, next);
    return { req, res, next };
};
const refuses = (fn) => expect(fn).toThrow(ValidationError);

// Strings an attacker would try. Each breaks out of an HTML attribute or injects markup.
const ATTACKS = [
    'red" onmouseover="alert(1)" x="',
    "red' onmouseover='alert(1)",
    '#fff" onmouseover="alert(1)" a="',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    'javascript:alert(1)',
    'url(javascript:alert(1))',
    '#fff;background:url(//evil.example/x)',
    'x" style="background:url(//evil.example/x)'
];

describe('colour', () => {
    test.each(['#fff', '#FFFF', '#3b82f6', '#3B82F6', '#3b82f680'])('accepts %s', (c) => {
        expect(checks.color(c, 'color')).toBe(c);
    });
    test('accepts empty and null (no colour)', () => {
        expect(checks.color('', 'color')).toBe('');
        expect(checks.color(null, 'color')).toBeNull();
    });
    test.each(['red', 'rgb(0,0,0)', '#12', '#12345', '#ggg', '3b82f6', ' #fff', '#fff ', 123, {}, []])('refuses %p', (c) => {
        refuses(() => checks.color(c, 'color'));
    });
    test.each(ATTACKS)('refuses attack string %s', (a) => refuses(() => checks.color(a, 'color')));
});

describe('image', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    test('accepts a small image data URL, an https link, and nothing', () => {
        expect(checks.image(png, 'img')).toBe(png);
        expect(checks.image('https://example.com/jane.jpg', 'img')).toBe('https://example.com/jane.jpg');
        expect(checks.image('', 'img')).toBe('');
        expect(checks.image(null, 'img')).toBeNull();
    });
    test.each([
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',            // SVG can carry scripts
        'http://example.com/a.png',                              // not https
        'https://example.com/a.png" onerror="alert(1)',
        'https://example.com/a b.png',
        '//evil.example/x.png',
        'x" onerror="alert(1)',
        'data:image/png;base64,iVBOR"onerror="alert(1)',
        5, {}
    ])('refuses %p', (v) => refuses(() => checks.image(v, 'img')));
    test('refuses an oversized image', () => {
        refuses(() => checks.image('data:image/png;base64,' + 'A'.repeat(400001), 'img'));
    });
});

describe('text', () => {
    test('trims and strips control characters', () => {
        expect(checks.str(50)('  Hello\u0000 World\n\t ', 'name')).toBe('Hello World');
    });
    test('enforces the length limit and the type', () => {
        expect(checks.str(5)('12345', 'name')).toBe('12345');
        refuses(() => checks.str(5)('123456', 'name'));
        refuses(() => checks.str(5)(12345, 'name'));
        refuses(() => checks.str(5)({ a: 1 }, 'name'));
        refuses(() => checks.str(5)(['a'], 'name'));
    });
    test('keeps characters that are normal in names (escaping happens when it is shown)', () => {
        expect(checks.str(50)("O'Brien & Sons <3 \"Ltd\"", 'name')).toBe("O'Brien & Sons <3 \"Ltd\"");
    });
});

describe('numbers', () => {
    const n = checks.int(1, 1000);
    test('accepts whole numbers and numeric strings', () => {
        expect(n(5, 'x')).toBe(5);
        expect(n('12', 'x')).toBe(12);
    });
    test.each([0, -5, 1001, 1.5, NaN, Infinity, '', ' ', 'abc', '5abc', null, true, [], {}])('refuses %p', (v) => {
        refuses(() => n(v, 'x'));
    });
});

describe('ids, dates, emails, lists', () => {
    test('slug', () => {
        expect(checks.slug('absa-cib', 'id')).toBe('absa-cib');
        expect(checks.slug('1765561922945', 'id')).toBe('1765561922945');
        expect(checks.slug('', 'id')).toBe('');
        expect(checks.slug(null, 'id')).toBeNull();
        ['a b', 'a"b', "a'b", 'a<b>', '../x', 'x'.repeat(101)].forEach(v => refuses(() => checks.slug(v, 'id')));
    });
    test('date must be a real calendar date', () => {
        expect(checks.date('2026-03-31', 'd')).toBe('2026-03-31');
        ['2026-02-30', '2026-13-01', '26-03-31', '2026-3-1', '2026-03-31T00:00', "2026-03-31'", 20260331, null].forEach(v => refuses(() => checks.date(v, 'd')));
    });
    test('email', () => {
        expect(checks.email('jane@example.com', 'e')).toBe('jane@example.com');
        expect(checks.email('', 'e')).toBe('');
        ['jane', 'jane@', '@x.com', 'a b@x.com', 'a"b@x.com', '<a>@x.com'].forEach(v => refuses(() => checks.email(v, 'e')));
    });
    test('chair sides', () => {
        expect(checks.chairs(['top', 'top', 'left'], 'c')).toEqual(['top', 'left']);
        [['up'], 'top', ['top', 'bottom', 'left', 'right', 'x'], [{}]].forEach(v => refuses(() => checks.chairs(v, 'c')));
    });
});

describe('validateBody middleware', () => {
    test('passes good data on and writes the cleaned values back', () => {
        const { req, next, res } = run('team', { name: '  Marketing ', color: '#10b981', memberCount: '8', managerImage: '' });
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
        expect(req.body).toMatchObject({ name: 'Marketing', color: '#10b981', memberCount: 8 });
    });

    test('checks only the fields that are present (partial updates work)', () => {
        expect(run('team', { name: 'x' }).next).toHaveBeenCalledWith();
        expect(run('desk', { x: 5 }).next).toHaveBeenCalledWith();
        expect(run('desk', {}).next).toHaveBeenCalledWith();
    });

    test('ignores fields it does not know about', () => {
        const { next, req } = run('team', { name: 'x', somethingElse: '<b>' });
        expect(next).toHaveBeenCalledWith();
        expect(req.body.somethingElse).toBe('<b>');
    });

    test('refuses with 400 and a message, and never calls the handler', () => {
        const { res, next } = run('team', { color: 'red" onmouseover="x' });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_INPUT', error: expect.stringMatching(/color/i) }));
    });

    test('required fields', () => {
        const { res, next } = run('location', { address: 'x' }, { required: ['name'] });
        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'name is required' }));
    });

    test.each([undefined, null, 'text', 5, [], [{ name: 'x' }]])('refuses a body that is not a JSON object: %p', (body) => {
        const { res, next } = run('team', body);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('every kind of record refuses a booby-trapped value in each text and colour field', () => {
        const cases = [
            ['team', 'color'], ['team', 'name'], ['team', 'manager'], ['team', 'managerImage'],
            ['floorElement', 'color'], ['floorElement', 'label'],
            ['desk', 'name'], ['desk', 'zone'], ['desk', 'floor'],
            ['location', 'name'], ['location', 'address'],
            ['booking', 'notes'], ['booking', 'teamName'],
            ['deskBooking', 'employeeName'], ['deskBooking', 'employeeEmail']
        ];
        const attacks = { color: ATTACKS, managerImage: ATTACKS };
        for (const [schema, field] of cases) {
            const values = attacks[field] || ['x'.repeat(600)];                   // text: refused for being too long (longest limit is 500)
            for (const value of values) {
                const { res, next } = run(schema, { [field]: value });
                expect({ schema, field, value, called: next.mock.calls.length }).toEqual({ schema, field, value, called: 0 });
                expect(res.status).toHaveBeenCalledWith(400);
            }
        }
    });

    test('unknown schema is a programming error', () => {
        expect(() => validateBody('nope')).toThrow(/Unknown validation schema/);
    });
});

describe('settings', () => {
    test('floor plan background must be one of our own files with numeric placement', () => {
        const good = { url: '/floorplans/jhb-floor-plan.svg', x: 0, y: 0, width: 570, height: 800 };
        expect(settingValue('floorplan_bg_jhb_1', good)).toEqual(good);
        // extra fields are dropped
        expect(settingValue('floorplan_bg_jhb_1', { ...good, evil: '<script>' })).toEqual(good);
        [
            { ...good, url: 'https://evil.example/track.png' },
            { ...good, url: '//evil.example/x.png' },
            { ...good, url: '/floorplans/../../etc/passwd' },
            { ...good, url: '/floorplans/a.svg" onerror="alert(1)' },
            { ...good, url: 'javascript:alert(1)' },
            { ...good, width: '570" onload="x' },
            { ...good, width: 0 },
            { ...good, height: 1e9 },
            { ...good, x: NaN },
            { url: '/floorplans/a.svg' },
            'text', null, [], 5
        ].forEach(v => refuses(() => settingValue('floorplan_bg_jhb_1', v)));
    });

    test('team roles keep their original messages', () => {
        expect(settingValue('team_roles', ['Manager', ' Lead '])).toEqual(['Manager', 'Lead']);
        expect(() => settingValue('team_roles', 'x')).toThrow('team_roles must be an array');
        expect(() => settingValue('team_roles', [1])).toThrow('team_roles must be an array of strings');
        expect(() => settingValue('team_roles', Array(201).fill('a'))).toThrow(/at most 200/);
        expect(() => settingValue('team_roles', ['x'.repeat(101)])).toThrow(ValidationError);
    });

    test('other settings: sensible name, value present, not huge', () => {
        expect(settingValue('anything_else', { a: 1 })).toEqual({ a: 1 });
        expect(() => settingValue('anything_else', undefined)).toThrow('Value is required');
        expect(() => settingValue('anything_else', 'x'.repeat(20001))).toThrow(/too large/);
        ['', 'a b', 'a/b', 'a"b', '<x>', 'x'.repeat(101)].forEach(k => refuses(() => settingValue(k, 1)));
    });
});

describe('values that go into an outgoing URL', () => {
    test('year', () => {
        expect(holidayYear('2026')).toBe('2026');
        ['26', '20266', '2026/../x', '2026?x=1', '%2e%2e', '', 'abcd', '2026 '].forEach(v => refuses(() => holidayYear(v)));
    });
    test('country', () => {
        expect(countryCode('ZA')).toBe('ZA');
        ['za', 'ZAF', 'Z', 'ZA/../x', 'Z A', '', 'Z1'].forEach(v => refuses(() => countryCode(v)));
    });
});

describe('calendar (.ics) text', () => {
    test('cannot add lines or properties', () => {
        const out = icsText('Team\r\nATTACH:http://evil.example/x\nBEGIN:VALARM');
        expect(out).not.toMatch(/[\r\n]/);
        expect(out.startsWith('Team ATTACH')).toBe(true);
    });
    test('escapes the characters that have a meaning in .ics files', () => {
        expect(icsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    });
    test('handles missing values', () => {
        expect(icsText(null)).toBe('');
        expect(icsText(undefined)).toBe('');
    });
});
