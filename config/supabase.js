// The routes talk to `supabase` with supabase-js style calls. DB_PROVIDER picks what is behind it:
//   supabase (default)  the Supabase REST API
//   postgres            a PostgreSQL server directly (see config/postgres.js)
const provider = (process.env.DB_PROVIDER || 'supabase').toLowerCase();

if (provider === 'postgres') {
    module.exports = { supabase: require('./postgres').supabase };
} else if (provider === 'supabase') {
    const { createClient } = require('@supabase/supabase-js');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Missing Supabase configuration!');
        console.error('Please set SUPABASE_URL and SUPABASE_SECRET_KEY environment variables');
        process.exit(1);
    }

    module.exports = { supabase: createClient(SUPABASE_URL, SUPABASE_KEY) };
} else {
    console.error(`❌ Unknown DB_PROVIDER "${process.env.DB_PROVIDER}". Use "supabase" or "postgres".`);
    process.exit(1);
}
