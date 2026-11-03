const { PostgresClient, quote } = require('../../utils/pgQueryBuilder');

function makeDb(rows = [], error = null) {
    const pool = { query: jest.fn(async () => { if (error) throw error; return { rows }; }) };
    return { db: new PostgresClient(pool), pool };
}
const lastCall = pool => pool.query.mock.calls[pool.query.mock.calls.length - 1];

describe('pgQueryBuilder', () => {
    describe('select', () => {
        test('select * with filters, ordering and a limit uses bound parameters', async () => {
            const { db, pool } = makeDb([{ id: 1 }]);
            const result = await db.from('bookings').select('*').eq('location_id', 'jhb').gte('date', '2026-01-01').lte('date', '2026-01-31').order('date').limit(5);
            expect(lastCall(pool)).toEqual([
                'SELECT * FROM "bookings" WHERE "location_id" = $1 AND "date" >= $2 AND "date" <= $3 ORDER BY "date" ASC LIMIT $4',
                ['jhb', '2026-01-01', '2026-01-31', 5]
            ]);
            expect(result).toEqual({ data: [{ id: 1 }], error: null });
        });

        test('column lists are quoted and filters can come before select', async () => {
            const { db, pool } = makeDb([]);
            await db.from('desk_bookings').select('id, desk_name, employee_email').eq('desk_id', 'd1').neq('id', 'x');
            expect(lastCall(pool)[0]).toBe('SELECT "id", "desk_name", "employee_email" FROM "desk_bookings" WHERE "desk_id" = $1 AND "id" <> $2');
        });

        test('in() binds one array parameter', async () => {
            const { db, pool } = makeDb([]);
            await db.from('desks').delete().in('id', ['a', 'b']);
            expect(lastCall(pool)).toEqual(['DELETE FROM "desks" WHERE "id" = ANY($1)', [['a', 'b']]]);
        });

        test('like, range and descending order', async () => {
            const { db, pool } = makeDb([]);
            await db.from('settings').select('*').like('key', 'floorplan_bg_jhb_%').order('key', { ascending: false }).range(10, 19);
            expect(lastCall(pool)).toEqual([
                'SELECT * FROM "settings" WHERE "key" LIKE $1 ORDER BY "key" DESC LIMIT $2 OFFSET $3',
                ['floorplan_bg_jhb_%', 10, 10]
            ]);
        });

        test('awaiting a builder resolves to { data, error } without calling execute', async () => {
            const { db } = makeDb([{ a: 1 }]);
            const { data, error } = await db.from('teams').select();
            expect(data).toEqual([{ a: 1 }]);
            expect(error).toBeNull();
        });
    });

    describe('single / maybeSingle', () => {
        test('single returns the row when exactly one comes back', async () => {
            const { db } = makeDb([{ id: 'a' }]);
            expect(await db.from('teams').select('*').eq('id', 'a').single()).toEqual({ data: { id: 'a' }, error: null });
        });

        test.each([[[]], [[{ id: 1 }, { id: 2 }]]])('single gives PGRST116 for %j rows', async rows => {
            const { db } = makeDb(rows);
            const { data, error } = await db.from('teams').select('*').eq('id', 'a').single();
            expect(data).toBeNull();
            expect(error.code).toBe('PGRST116');
        });

        test('maybeSingle returns null for no rows', async () => {
            const { db } = makeDb([]);
            expect(await db.from('teams').select('*').eq('id', 'a').maybeSingle()).toEqual({ data: null, error: null });
        });
    });

    describe('mutations', () => {
        test('insert returns rows only when select() is chained', async () => {
            const { db, pool } = makeDb([{ id: 'a' }]);
            const without = await db.from('teams').insert({ id: 'a', name: 'A' });
            expect(without).toEqual({ data: null, error: null });
            expect(lastCall(pool)[0]).toBe('INSERT INTO "teams" ("id", "name") VALUES ($1, $2)');

            const withSelect = await db.from('teams').insert({ id: 'a', name: 'A' }).select().single();
            expect(lastCall(pool)[0]).toBe('INSERT INTO "teams" ("id", "name") VALUES ($1, $2) RETURNING *');
            expect(withSelect.data).toEqual({ id: 'a' });
        });

        test('bulk insert uses DEFAULT for a column a row leaves out', async () => {
            const { db, pool } = makeDb([]);
            await db.from('desks').insert([{ id: 'a', name: 'A', zone: 'x' }, { id: 'b', name: 'B' }]);
            expect(lastCall(pool)).toEqual([
                'INSERT INTO "desks" ("id", "name", "zone") VALUES ($1, $2, $3), ($4, $5, DEFAULT)',
                ['a', 'A', 'x', 'b', 'B']
            ]);
        });

        test('arrays are sent as JSON so they fit JSONB columns', async () => {
            const { db, pool } = makeDb([]);
            await db.from('settings').upsert({ key: 'team_roles', value: ['a', 'b'] }, { onConflict: 'key' });
            expect(lastCall(pool)[1]).toEqual(['team_roles', '["a","b"]']);
        });

        test('update builds SET before WHERE', async () => {
            const { db, pool } = makeDb([{ id: 'a' }]);
            await db.from('teams').update({ name: 'New', color: '#fff' }).eq('id', 'a').select().single();
            expect(lastCall(pool)).toEqual([
                'UPDATE "teams" SET "name" = $1, "color" = $2 WHERE "id" = $3 RETURNING *',
                ['New', '#fff', 'a']
            ]);
        });

        test('upsert updates everything except the conflict column', async () => {
            const { db, pool } = makeDb([{ key: 'k' }]);
            await db.from('settings').upsert({ key: 'k', value: { a: 1 }, updated_at: 'now' }, { onConflict: 'key' }).select().single();
            expect(lastCall(pool)[0]).toBe(
                'INSERT INTO "settings" ("key", "value", "updated_at") VALUES ($1, $2, $3) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = EXCLUDED."updated_at" RETURNING *'
            );
        });

        test('upsert with only the conflict column does nothing on conflict', async () => {
            const { db, pool } = makeDb([]);
            await db.from('public_holidays').upsert([{ date: '2026-01-01' }], { onConflict: 'date' });
            expect(lastCall(pool)[0]).toContain('ON CONFLICT ("date") DO NOTHING');
        });

        test('delete with a filter', async () => {
            const { db, pool } = makeDb([]);
            await db.from('desk_bookings').delete().eq('desk_id', 'd1');
            expect(lastCall(pool)).toEqual(['DELETE FROM "desk_bookings" WHERE "desk_id" = $1', ['d1']]);
        });

        test('update and delete without a filter are refused and never reach the database', async () => {
            const { db, pool } = makeDb([]);
            expect((await db.from('teams').delete()).error.code).toBe('PGBUILD');
            expect((await db.from('teams').update({ name: 'x' })).error.code).toBe('PGBUILD');
            expect(pool.query).not.toHaveBeenCalled();
        });

        test('inserting an empty list is a no-op', async () => {
            const { db, pool } = makeDb([]);
            expect(await db.from('desks').insert([])).toEqual({ data: null, error: null });
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('safety and errors', () => {
        test('malicious table, column and select names are rejected before any SQL runs', async () => {
            const { db, pool } = makeDb([]);
            expect((await db.from('teams; drop table teams').select('*')).error.code).toBe('PGBUILD');
            expect((await db.from('teams').select('*').eq('id" = 1 or "1', 'x')).error.code).toBe('PGBUILD');
            expect((await db.from('teams').select('id, name from teams --')).error.code).toBe('PGBUILD');
            expect((await db.from('teams').insert({ 'x") values (1); --': 1 })).error.code).toBe('PGBUILD');
            expect(pool.query).not.toHaveBeenCalled();
        });

        test('malicious values stay in the parameter list, never in the SQL text', async () => {
            const { db, pool } = makeDb([]);
            const attack = "'; DROP TABLE teams; --";
            await db.from('teams').select('*').eq('name', attack);
            const [sql, params] = lastCall(pool);
            expect(sql).not.toContain('DROP');
            expect(params).toEqual([attack]);
        });

        test('database errors keep their Postgres code (e.g. unique violation 23505)', async () => {
            const { db } = makeDb([], Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key exists' }));
            const { data, error } = await db.from('teams').insert({ id: 'a', name: 'A' }).select().single();
            expect(data).toBeNull();
            expect(error).toMatchObject({ code: '23505', message: 'duplicate key', details: 'Key exists' });
        });

        test('a unique violation says which rule was hit, so the app can explain it', async () => {
            const { db } = makeDb([], Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_desk_bookings_desk_date' }));
            const { error } = await db.from('desk_bookings').insert({ id: 'a' });
            expect(error.constraint).toBe('uq_desk_bookings_desk_date');
        });

        test('quote accepts normal names and rejects odd ones', () => {
            expect(quote('desk_bookings')).toBe('"desk_bookings"');
            expect(() => quote('a b')).toThrow();
            expect(() => quote('')).toThrow();
            expect(() => quote(null)).toThrow();
        });
    });
});
