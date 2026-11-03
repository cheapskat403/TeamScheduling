/**
 * Supabase-style query builder on top of a node-postgres pool.
 *
 * The routes were written against supabase-js (`supabase.from('t').select().eq()...`), so this keeps that
 * interface and turns it into parameterised SQL. Only the calls the app uses are supported.
 *
 * Behaviour copied from supabase-js:
 *  - a builder is awaitable and resolves to { data, error } (it never throws)
 *  - insert / update / upsert / delete return rows only when .select() is chained after them
 *  - .single() fails with code PGRST116 unless exactly one row comes back
 *  - update and delete without a filter are refused
 *
 * Identifiers (tables, columns) are checked against a strict pattern and quoted; values are always bound
 * parameters, never pasted into the SQL.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(name) {
    if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
        throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`);
    }
    return `"${name}"`;
}

function columnList(fields) {
    if (fields === undefined || fields === null || fields === '' || fields.trim() === '*') return '*';
    return fields.split(',').map(f => quote(f.trim())).join(', ');
}

// node-postgres turns a JS array into a Postgres array, but the JSONB columns here hold JSON arrays.
function toParam(value) {
    return Array.isArray(value) ? JSON.stringify(value) : value;
}

class QueryBuilder {
    constructor(pool, table) {
        this.pool = pool;
        this.table = table;
        this.mode = 'select';
        this.fields = '*';
        this.returning = null;
        this.filters = [];
        this.orders = [];
        this.limitValue = null;
        this.offsetValue = null;
        this.expect = null; // 'single' | 'maybeSingle'
        this.payload = null;
        this.upsertOptions = {};
    }

    select(fields) {
        if (this.mode === 'select') this.fields = fields;
        else this.returning = fields === undefined ? '*' : fields;
        return this;
    }

    insert(rows) { this.mode = 'insert'; this.payload = rows; return this; }
    update(values) { this.mode = 'update'; this.payload = values; return this; }
    upsert(rows, options = {}) { this.mode = 'upsert'; this.payload = rows; this.upsertOptions = options; return this; }
    delete() { this.mode = 'delete'; return this; }

    eq(column, value) { return this._filter(column, '=', value); }
    neq(column, value) { return this._filter(column, '<>', value); }
    gt(column, value) { return this._filter(column, '>', value); }
    gte(column, value) { return this._filter(column, '>=', value); }
    lt(column, value) { return this._filter(column, '<', value); }
    lte(column, value) { return this._filter(column, '<=', value); }
    like(column, pattern) { return this._filter(column, 'LIKE', pattern); }
    ilike(column, pattern) { return this._filter(column, 'ILIKE', pattern); }

    is(column, value) {
        this.filters.push({ column, sql: value === null ? 'IS NULL' : value ? 'IS TRUE' : 'IS FALSE' });
        return this;
    }

    in(column, values) {
        this.filters.push({ column, op: '= ANY', value: Array.isArray(values) ? values : [values] });
        return this;
    }

    match(conditions) {
        Object.entries(conditions).forEach(([column, value]) => this.eq(column, value));
        return this;
    }

    order(column, { ascending = true } = {}) {
        this.orders.push({ column, ascending });
        return this;
    }

    limit(count) { this.limitValue = count; return this; }

    range(from, to) {
        this.offsetValue = from;
        this.limitValue = to - from + 1;
        return this;
    }

    single() { this.expect = 'single'; return this; }
    maybeSingle() { this.expect = 'maybeSingle'; return this; }

    _filter(column, op, value) {
        this.filters.push({ column, op, value });
        return this;
    }

    _where(params) {
        if (this.filters.length === 0) return '';
        const parts = this.filters.map(f => {
            if (f.sql) return `${quote(f.column)} ${f.sql}`;
            params.push(f.value);
            // "= ANY($n)" needs the bracket form; plain operators do not
            return f.op === '= ANY'
                ? `${quote(f.column)} = ANY($${params.length})`
                : `${quote(f.column)} ${f.op} $${params.length}`;
        });
        return ` WHERE ${parts.join(' AND ')}`;
    }

    _build() {
        const table = quote(this.table);
        const params = [];

        if (this.mode === 'select') {
            let sql = `SELECT ${columnList(this.fields)} FROM ${table}${this._where(params)}`;
            if (this.orders.length) {
                sql += ' ORDER BY ' + this.orders.map(o => `${quote(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ');
            }
            if (this.limitValue !== null) { params.push(this.limitValue); sql += ` LIMIT $${params.length}`; }
            if (this.offsetValue !== null) { params.push(this.offsetValue); sql += ` OFFSET $${params.length}`; }
            return { sql, params };
        }

        const returning = this.returning === null ? '' : ` RETURNING ${columnList(this.returning)}`;

        if (this.mode === 'insert' || this.mode === 'upsert') {
            const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
            if (rows.length === 0) return { sql: null, params };
            const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
            const tuples = rows.map(row => `(${columns.map(c => {
                // a column missing from this row takes its default; an explicit undefined/null is stored as null
                if (!(c in row)) return 'DEFAULT';
                params.push(toParam(row[c]));
                return `$${params.length}`;
            }).join(', ')})`);
            let sql = `INSERT INTO ${table} (${columns.map(quote).join(', ')}) VALUES ${tuples.join(', ')}`;
            if (this.mode === 'upsert') {
                const conflict = (this.upsertOptions.onConflict || '').split(',').map(c => c.trim()).filter(Boolean);
                if (conflict.length === 0) throw new Error('upsert needs an onConflict column');
                const updates = columns.filter(c => !conflict.includes(c)).map(c => `${quote(c)} = EXCLUDED.${quote(c)}`);
                sql += ` ON CONFLICT (${conflict.map(quote).join(', ')}) ` +
                    (updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING');
            }
            return { sql: sql + returning, params };
        }

        if (this.filters.length === 0) throw new Error(`${this.mode} on ${this.table} needs a filter`);

        if (this.mode === 'update') {
            const entries = Object.entries(this.payload);
            if (entries.length === 0) throw new Error('update needs at least one column');
            const sets = entries.map(([column, value]) => {
                params.push(toParam(value));
                return `${quote(column)} = $${params.length}`;
            });
            return { sql: `UPDATE ${table} SET ${sets.join(', ')}${this._where(params)}${returning}`, params };
        }

        return { sql: `DELETE FROM ${table}${this._where(params)}${returning}`, params };
    }

    async execute() {
        let built;
        try {
            built = this._build();
        } catch (error) {
            return { data: null, error: { message: error.message, code: 'PGBUILD' } };
        }
        if (built.sql === null) return { data: this.returning === null ? null : [], error: null };

        let result;
        try {
            result = await this.pool.query(built.sql, built.params);
        } catch (error) {
            return { data: null, error: { message: error.message, code: error.code, details: error.detail || null, hint: error.hint || null, constraint: error.constraint || null } };
        }

        const returnsRows = this.mode === 'select' || this.returning !== null;
        if (!returnsRows) return { data: null, error: null };

        const rows = result.rows;
        if (this.expect === 'single') {
            if (rows.length !== 1) {
                return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
            }
            return { data: rows[0], error: null };
        }
        if (this.expect === 'maybeSingle') {
            if (rows.length > 1) return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST116' } };
            return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
    }

    // Makes `await supabase.from(...)...` work exactly as it does with supabase-js.
    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }
}

class PostgresClient {
    constructor(pool) {
        this.pool = pool;
    }

    from(table) {
        return new QueryBuilder(this.pool, table);
    }
}

module.exports = { PostgresClient, QueryBuilder, quote };
