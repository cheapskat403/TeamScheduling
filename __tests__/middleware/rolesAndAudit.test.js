/**
 * Roles and audit log, wired the way server.js wires them (login, permissions, audit, then the guarded
 * routes). Logins are faked with a header so each test can pick who is calling; the database is a small
 * in-memory stand-in that understands the handful of calls these parts make.
 */
const request = require('supertest');
const express = require('express');

const mockDb = { settings: [], audit_log: [], teams: [], bookings: [], desk_bookings: [], public_holidays: [], desks: [], locations: [], floor_elements: [] };

jest.mock('../../config/supabase', () => {
    function builder(table) {
        const state = { filters: [], order: null, limit: null, insert: null, maybeSingle: false };
        const b = {
            select() { return b; },
            in(col, values) { state.filters.push(r => values.includes(r[col])); return b; },
            eq(col, v) { state.filters.push(r => r[col] === v); return b; },
            lt(col, v) { state.filters.push(r => r[col] < v); return b; },
            gte(col, v) { state.filters.push(r => r[col] >= v); return b; },
            order(col, { ascending = true } = {}) { state.order = { col, ascending }; return b; },
            limit(n) { state.limit = n; return b; },
            insert(row) { state.insert = row; return b; },
            maybeSingle() { state.maybeSingle = true; return b; },
            then(resolve, reject) {
                try {
                    if (state.insert) {
                        mockDb[table].push({ id: mockDb[table].length + 1, at: new Date().toISOString(), ...state.insert });
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    }
                    let rows = mockDb[table].filter(r => state.filters.every(f => f(r)));
                    if (state.order) rows = [...rows].sort((a, c) => (a[state.order.col] < c[state.order.col] ? -1 : 1) * (state.order.ascending ? 1 : -1));
                    if (state.limit) rows = rows.slice(0, state.limit);
                    if (state.maybeSingle) return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
                    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                } catch (e) { return Promise.reject(e).then(resolve, reject); }
            }
        };
        return b;
    }
    return { supabase: { from: builder } };
});

const { attachPermissions, requireAdmin, requireCalendarAccess, onWrites, teamWrites } = require('../../middleware/permissions');
const { auditWrites, sanitize } = require('../../middleware/audit');
const graphIdentity = require('../../utils/graphIdentity');
const { invalidateConfig } = require('../../utils/permissions');
const meRoutes = require('../../routes/me');
const auditRoutes = require('../../routes/audit');

function makeApp() {
    const app = express();
    app.use(express.json());
    // Fake login: X-User: "oid|email" signs somebody in; no header means not signed in
    app.use('/api', (req, res, next) => {
        const who = req.get('x-user');
        req.user = who ? { authenticated: true, id: who.split('|')[0], email: who.split('|')[1], name: 'Test User' } : { authenticated: false };
        next();
    });
    app.use('/api', attachPermissions);
    app.use('/api', auditWrites);
    const ok = (req, res) => res.status(201).json({ id: 'new-1' });
    app.use('/api/me', meRoutes);
    app.use('/api/audit', auditRoutes);
    app.use('/api/teams', teamWrites, express.Router().use(ok));
    app.use('/api/locations', onWrites(requireAdmin), express.Router().use(ok));
    app.use('/api/bookings', onWrites(requireCalendarAccess), express.Router().use(ok));
    app.use('/api/desk-bookings', express.Router().use(ok));
    return app;
}

const ADMIN = 'oid-admin|admin@example.com';
const MANAGER = 'oid-mgr|manager@example.com';
const STAFF = 'oid-staff|staff@example.com';
const AUDITOR = 'oid-aud|auditor@example.com';
const who = (u) => ({ 'X-User': u });
const flush = () => new Promise(resolve => setImmediate(resolve));

// Pretend Graph has already told us these people's job titles
function knowTitle(oid, title) {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: oid, jobTitle: title }) }));
    return graphIdentity.verifyJobTitle(oid, 'graph-token');
}

describe('roles and audit log (REQUIRE_AUTH=true)', () => {
    const app = makeApp();

    beforeEach(async () => {
        process.env.REQUIRE_AUTH = 'true';
        process.env.ADMIN_EMAILS = 'admin@example.com';
        mockDb.settings = [
            { key: 'team_roles', value: ['Senior Manager', 'Business Unit Manager'] },
            { key: 'audit_viewer_roles', value: ['Head of Risk'] }
        ];
        mockDb.audit_log = [];
        graphIdentity.clearCache();
        invalidateConfig();
        await knowTitle('oid-mgr', 'senior  manager ');      // different case and spacing on purpose
        await knowTitle('oid-staff', 'Developer');
        await knowTitle('oid-aud', 'Head of Risk');
    });
    afterEach(() => { delete process.env.REQUIRE_AUTH; delete process.env.ADMIN_EMAILS; delete global.fetch; });

    describe('who can change what', () => {
        test('admins (from ADMIN_EMAILS) can change admin-only things, others cannot', async () => {
            expect((await request(app).post('/api/locations').set(who(ADMIN)).send({})).status).toBe(201);
            const staff = await request(app).post('/api/locations').set(who(STAFF)).send({});
            expect(staff.status).toBe(403);
            expect(staff.body.code).toBe('FORBIDDEN');
            expect((await request(app).post('/api/locations').set(who(MANAGER)).send({})).status).toBe(403);
        });

        test('team leads can add and edit teams, but only admins can delete them', async () => {
            expect((await request(app).post('/api/teams').set(who(MANAGER)).send({})).status).toBe(201);
            expect((await request(app).put('/api/teams/t1').set(who(MANAGER)).send({})).status).toBe(201);
            const del = await request(app).delete('/api/teams/t1').set(who(MANAGER));
            expect(del.status).toBe(403);
            expect(del.body.code).toBe('FORBIDDEN');
            expect((await request(app).delete('/api/teams/t1').set(who(ADMIN))).status).toBe(201);
        });

        test('people without a team lead job title cannot add, edit or delete teams', async () => {
            for (const [method, path] of [['post', '/api/teams'], ['put', '/api/teams/t1'], ['delete', '/api/teams/t1']]) {
                expect((await request(app)[method](path).set(who(STAFF)).send({})).status).toBe(403);
            }
        });

        test('a team lead whose job title is not verified yet is asked to verify it, not refused', async () => {
            graphIdentity.clearCache();
            const res = await request(app).post('/api/teams').set(who(MANAGER)).send({});
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('IDENTITY_UNVERIFIED');
        });

        test('admins listed in the admin_emails setting count too, and the change applies at once', async () => {
            expect((await request(app).post('/api/teams').set(who(STAFF)).send({})).status).toBe(403);
            mockDb.settings.push({ key: 'admin_emails', value: ['staff@example.com'] });
            invalidateConfig();
            expect((await request(app).post('/api/teams').set(who(STAFF)).send({})).status).toBe(201);
        });

        test('admin email matching ignores case', async () => {
            process.env.ADMIN_EMAILS = 'Admin@Example.com';
            invalidateConfig();
            expect((await request(app).post('/api/teams').set(who(ADMIN)).send({})).status).toBe(201);
        });

        test('Calendar bookings: allowed job titles and admins only, whatever the case or spacing', async () => {
            expect((await request(app).post('/api/bookings').set(who(MANAGER)).send({})).status).toBe(201);
            expect((await request(app).post('/api/bookings').set(who(ADMIN)).send({})).status).toBe(201);
            const staff = await request(app).post('/api/bookings').set(who(STAFF)).send({});
            expect(staff.status).toBe(403);
            expect(staff.body.code).toBe('FORBIDDEN');
        });

        test('a job title that has not been verified yet gets a retryable answer, not a plain refusal', async () => {
            const stranger = await request(app).post('/api/bookings').set(who('oid-new|new@example.com')).send({});
            expect(stranger.status).toBe(403);
            expect(stranger.body.code).toBe('IDENTITY_UNVERIFIED');
        });

        test('everyone signed in can make desk bookings', async () => {
            expect((await request(app).post('/api/desk-bookings').set(who(STAFF)).send({})).status).toBe(201);
        });

        test('reads are open to everyone signed in', async () => {
            expect((await request(app).get('/api/teams').set(who(STAFF))).status).toBe(201);   // the stub answers every method with 201
        });

        test('not signed in gets 401', async () => {
            expect((await request(app).post('/api/teams').send({})).status).toBe(401);
        });

        test('nothing is enforced when REQUIRE_AUTH is not true', async () => {
            delete process.env.REQUIRE_AUTH;
            expect((await request(app).post('/api/teams').send({})).status).toBe(201);
            expect((await request(app).post('/api/bookings').set(who(STAFF)).send({})).status).toBe(201);
        });

        test('when the role settings cannot be read, nothing is allowed', async () => {
            const original = mockDb.settings;
            mockDb.settings = null;           // makes the stand-in database throw
            invalidateConfig();
            expect((await request(app).post('/api/teams').set(who(ADMIN)).send({})).status).toBe(403);
            mockDb.settings = original;
        });
    });

    describe('/api/me', () => {
        test('reports the caller and their rights', async () => {
            const admin = (await request(app).get('/api/me').set(who(ADMIN))).body;
            expect(admin).toMatchObject({ email: 'admin@example.com', isAdmin: true, canBookCalendar: true, canViewAudit: true });
            const mgr = (await request(app).get('/api/me').set(who(MANAGER))).body;
            expect(mgr).toMatchObject({ isAdmin: false, canBookCalendar: true, canViewAudit: false, jobTitle: 'senior  manager' });
            const staff = (await request(app).get('/api/me').set(who(STAFF))).body;
            expect(staff).toMatchObject({ isAdmin: false, canBookCalendar: false, canViewAudit: false });
        });

        test('a forwarded Graph token is checked with Microsoft and grants the title it vouches for', async () => {
            global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'oid-new', jobTitle: 'Business Unit Manager' }) }));
            const res = await request(app).get('/api/me').set(who('oid-new|new@example.com')).set('X-Graph-Token', 'abc');
            expect(res.body).toMatchObject({ titleChecked: true, canBookCalendar: true });
            expect(global.fetch.mock.calls[0][0]).toContain('graph.microsoft.com');
            expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
        });

        test("someone else's Graph token is refused, so nobody can borrow a title", async () => {
            global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'oid-mgr', jobTitle: 'Senior Manager' }) }));
            const res = await request(app).get('/api/me').set(who('oid-thief|thief@example.com')).set('X-Graph-Token', 'stolen');
            expect(res.body.titleChecked).toBe(false);
            expect(res.body.canBookCalendar).toBe(false);
        });

        test('a rejected or failing Graph call grants nothing', async () => {
            global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
            let res = await request(app).get('/api/me').set(who('oid-x|x@example.com')).set('X-Graph-Token', 'bad');
            expect(res.body).toMatchObject({ titleChecked: false, canBookCalendar: false });
            global.fetch = jest.fn(async () => { throw new Error('network down'); });
            res = await request(app).get('/api/me').set(who('oid-y|y@example.com')).set('X-Graph-Token', 'bad');
            expect(res.body).toMatchObject({ titleChecked: false, canBookCalendar: false });
        });
    });

    describe('audit log: writing', () => {
        test('records who changed what, and ignores reads', async () => {
            await request(app).get('/api/teams').set(who(ADMIN));
            await request(app).post('/api/teams').set(who(ADMIN)).send({ name: 'Platform', color: '#fff' });
            await flush();
            expect(mockDb.audit_log).toHaveLength(1);
            expect(mockDb.audit_log[0]).toMatchObject({
                actor_email: 'admin@example.com', action: 'create', entity: 'teams', entity_id: 'new-1', outcome: 'success', status: 201,
                details: { name: 'Platform', color: '#fff' }
            });
        });

        test('records refused attempts as denied', async () => {
            await request(app).post('/api/teams').set(who(STAFF)).send({ name: 'Sneaky' });
            await flush();
            expect(mockDb.audit_log[0]).toMatchObject({ actor_email: 'staff@example.com', outcome: 'denied', status: 403, entity: 'teams' });
        });

        test('maps methods to actions and picks the id out of the path', async () => {
            await request(app).put('/api/teams/t1').set(who(ADMIN)).send({});
            await request(app).delete('/api/teams/t2').set(who(ADMIN));
            await request(app).post('/api/desk-bookings/b9/checkin').set(who(STAFF)).send({});
            await flush();
            expect(mockDb.audit_log.map(r => [r.action, r.entity, r.entity_id])).toEqual([
                ['update', 'teams', 't1'], ['delete', 'teams', 't2'], ['check-in', 'desk-bookings', 'b9']
            ]);
        });

        test('does not log requests from people who are not signed in', async () => {
            await request(app).post('/api/teams').send({});
            await flush();
            expect(mockDb.audit_log).toHaveLength(0);
        });

        test('photos, QR codes and long text are not stored', () => {
            const cleaned = sanitize({
                name: 'Desk 1', managerImage: 'data:image/png;base64,AAAA', qrCode: 'secret-qr', notes: 'x'.repeat(500),
                nested: { deep: { deeper: { deepest: 1 } } }, list: Array.from({ length: 30 }, (_, i) => i)
            });
            expect(cleaned.managerImage).toBe('[hidden]');
            expect(cleaned.qrCode).toBe('[hidden]');
            expect(cleaned.notes.length).toBeLessThan(250);
            expect(cleaned.nested.deep.deeper).toBe('[nested]');
            expect(cleaned.list).toHaveLength(21);
            expect(sanitize('data:image/png;base64,AAAA')).toBe('[file]');
        });

        test('a database failure while auditing never breaks the request', async () => {
            const original = mockDb.audit_log;
            mockDb.audit_log = null;
            const res = await request(app).post('/api/teams').set(who(ADMIN)).send({});
            await flush();
            expect(res.status).toBe(201);
            mockDb.audit_log = original;
        });
    });

    describe('audit log: detail', () => {
        const last = () => mockDb.audit_log[mockDb.audit_log.length - 1];
        const owner = { 'X-User': ADMIN };

        test('a delete records what was deleted', async () => {
            mockDb.teams = [{ id: 'absa-cib', name: 'Absa CIB', manager: 'Francois', member_count: 8, color: '#b91c1c', location_id: 'jhb', manager_image: 'data:image/png;base64,AAAA', created_at: '2025-01-01' }];
            await request(app).delete('/api/teams/absa-cib').set(owner);
            await flush();
            expect(last()).toMatchObject({ action: 'delete', entity: 'teams', entity_id: 'absa-cib', outcome: 'success' });
            expect(last().details).toEqual({
                label: 'Absa CIB',
                deleted: { name: 'Absa CIB', manager: 'Francois', member_count: 8, location_id: 'jhb', color: '#b91c1c' }
            });
        });

        test('a create is named once it exists, with its key fields', async () => {
            mockDb.teams = [{ id: 'new-1', name: 'Platform', manager: 'Sam', member_count: 4, location_id: 'jhb', color: '#112233', manager_image: 'data:image/png;base64,AAAA' }];
            await request(app).post('/api/teams').set(owner).send({ name: 'Platform' });
            await flush();
            expect(last()).toMatchObject({ action: 'create', entity_id: 'new-1' });
            expect(last().details).toEqual({
                label: 'Platform',
                created: { name: 'Platform', manager: 'Sam', member_count: 4, location_id: 'jhb', color: '#112233' }
            });
        });

        test('each area gets a readable label', async () => {
            mockDb.bookings = [{ id: 'b1', date: '2026-11-05', team_name: 'Liberty', people_count: 4, location_id: 'jhb', notes: '' }];
            mockDb.desk_bookings = [{ id: 'd1', date: '2026-11-06', desk_name: 'SM01', employee_name: 'Jane Doe', employee_email: 'jane@example.com', checked_in: false }];
            mockDb.public_holidays = [{ id: 7, date: '2026-12-25', name: 'Christmas Day' }];
            await request(app).delete('/api/bookings/b1').set(owner);
            await request(app).delete('/api/desk-bookings/d1').set(owner);
            await request(app).delete('/api/holidays/2026-12-25').set(owner);
            await flush();
            expect(mockDb.audit_log.map(r => r.details.label)).toEqual(['Liberty on 2026-11-05', 'SM01 on 2026-11-06 (Jane Doe)', 'Christmas Day (2026-12-25)']);
        });

        test('an update records old and new values for what changed, and ignores what did not', async () => {
            mockDb.teams = [{ id: 't1', name: 'Platform', member_count: 5, color: '#000000', location_id: 'jhb' }];
            await request(app).put('/api/teams/t1').set(owner).send({ name: 'Platform', memberCount: 9, color: '#ffffff' });
            await flush();
            expect(last().details).toEqual({
                label: 'Platform',
                changed: { member_count: { from: 5, to: 9 }, color: { from: '#000000', to: '#ffffff' } }
            });
        });

        test('an update that changes nothing falls back to the request', async () => {
            mockDb.teams = [{ id: 't1', name: 'Platform', member_count: 5 }];
            await request(app).put('/api/teams/t1').set(owner).send({ name: 'Platform' });
            await flush();
            expect(last().details).toEqual({ label: 'Platform', request: { name: 'Platform' } });
        });

        test('a check-in is labelled with the booking', async () => {
            mockDb.desk_bookings = [{ id: 'd2', date: '2026-11-06', desk_name: 'SM02', employee_name: 'Sam' }];
            await request(app).post('/api/desk-bookings/d2/checkin').set(who(STAFF)).send({ qrCode: 'secret-qr' });
            await flush();
            expect(last().details).toEqual({ label: 'SM02 on 2026-11-06 (Sam)' });
        });

        test('a refused delete still says what the person tried to delete', async () => {
            mockDb.teams = [{ id: 't9', name: 'Protected' }];
            await request(app).delete('/api/teams/t9').set(who(STAFF));
            await flush();
            expect(last()).toMatchObject({ outcome: 'denied', status: 403 });
            expect(last().details.label).toBe('Protected');
        });

        test('a record that no longer exists, or cannot be looked up, does not stop the entry being written', async () => {
            await request(app).delete('/api/teams/ghost').set(owner);
            mockDb.teams = null;     // makes the lookup throw
            await request(app).delete('/api/teams/t1').set(owner);
            await flush();
            expect(mockDb.audit_log).toHaveLength(2);
            expect(mockDb.audit_log.every(r => r.outcome === 'success')).toBe(true);
            mockDb.teams = [];
        });

        test('photos and QR codes never appear in what is kept', async () => {
            mockDb.desks = [{ id: 'k1', name: 'Desk 1', qr_code: 'qr-secret', floor: '1', desk_type: 'hotseat' }];
            await request(app).delete('/api/desks/k1').set(owner);
            await flush();
            expect(JSON.stringify(last().details)).not.toContain('qr-secret');
        });
    });

    describe('audit log: reading', () => {
        beforeEach(() => {
            mockDb.audit_log = [
                { id: 1, at: '2026-11-01T08:00:00Z', actor_email: 'a@example.com', action: 'create', entity: 'teams', entity_id: 't1', outcome: 'success', status: 201, details: { name: 'A' } },
                { id: 2, at: '2026-11-02T08:00:00Z', actor_email: 'b@example.com', action: 'delete', entity: 'bookings', entity_id: 'b1', outcome: 'denied', status: 403, details: null },
                { id: 3, at: '2026-11-03T08:00:00Z', actor_email: 'a@example.com', action: 'update', entity: 'teams', entity_id: 't1', outcome: 'success', status: 200, details: {} }
            ];
        });

        test('admins and the chosen job titles can read it; nobody else', async () => {
            expect((await request(app).get('/api/audit').set(who(ADMIN))).status).toBe(200);
            expect((await request(app).get('/api/audit').set(who(AUDITOR))).status).toBe(200);
            expect((await request(app).get('/api/audit').set(who(STAFF))).status).toBe(403);
            expect((await request(app).get('/api/audit').set(who(MANAGER))).status).toBe(403);
            expect((await request(app).get('/api/audit')).status).toBe(401);
        });

        test('newest first, with paging', async () => {
            const page1 = (await request(app).get('/api/audit?limit=2').set(who(ADMIN))).body;
            expect(page1.entries.map(e => e.id)).toEqual([3, 2]);
            expect(page1.nextBefore).toBe(2);
            const page2 = (await request(app).get(`/api/audit?limit=2&before=${page1.nextBefore}`).set(who(ADMIN))).body;
            expect(page2.entries.map(e => e.id)).toEqual([1]);
            expect(page2.nextBefore).toBeNull();
        });

        test('filters by person, area and outcome', async () => {
            const ids = async (q) => (await request(app).get(`/api/audit?${q}`).set(who(ADMIN))).body.entries.map(e => e.id);
            expect(await ids('actor=A@example.com')).toEqual([3, 1]);
            expect(await ids('entity=bookings')).toEqual([2]);
            expect(await ids('outcome=denied')).toEqual([2]);
        });

        test('returns camelCase fields and the stored details', async () => {
            const entry = (await request(app).get('/api/audit?limit=1').set(who(ADMIN))).body.entries[0];
            expect(entry).toMatchObject({ actorEmail: 'a@example.com', entityId: 't1', outcome: 'success' });
        });

        test.each(['before=abc', 'entity=Robert;DROP', 'outcome=maybe', 'from=yesterday'])('rejects bad input: %s', async (q) => {
            expect((await request(app).get(`/api/audit?${q}`).set(who(ADMIN))).status).toBe(400);
        });
    });
});
