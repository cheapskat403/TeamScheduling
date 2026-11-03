/**
 * 4: PROOF that the public (anon / publishable) key can no longer read the database.
 *
 * Read only: it only asks for rows, it never writes. It never prints the key.
 *
 * Usage (PowerShell), with the project's URL and its PUBLISHABLE key. Type the key at the prompt,
 * so it is not saved in your command history:
 *
 *   $env:SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
 *   $env:SUPABASE_ANON_KEY = Read-Host "Publishable key"
 *   node scripts/security/4-check-anon-access.js
 *   Remove-Item Env:SUPABASE_ANON_KEY
 *
 * PASS means that table returned no rows or was refused. FAIL means the public key can still read it.
 */

const TABLES = ['locations', 'teams', 'bookings', 'public_holidays', 'desks', 'desk_bookings', 'floor_elements', 'settings'];

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_ANON_KEY || '';

function stop(message) {
    console.error(message);
    process.exit(2);
}

if (!url || !key) stop('Set SUPABASE_URL and SUPABASE_ANON_KEY first (see the top of this file).');

// Refuse a secret key: using one would "pass" nothing and would hand the secret to this script.
if (key.startsWith('sb_secret_')) stop('That is a SECRET key. Use the publishable (anon) key instead.');
if (key.startsWith('eyJ')) {
    try {
        const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
        if (role === 'service_role') stop('That is the service_role (secret) key. Use the anon key instead.');
    } catch (error) { /* not a readable JWT: carry on, the sanity check below will tell */ }
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function main() {
    // Sanity check: is the key a real key for this project? A wrong key is refused everywhere,
    // which would look like a PASS below, so it must be ruled out first.
    const health = await fetch(`${url}/auth/v1/settings`, { headers });
    if (!health.ok) stop(`The project did not accept this key (HTTP ${health.status}). Check the URL and the key; no conclusion can be drawn.`);

    let failures = 0;
    for (const table of TABLES) {
        const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
        let rows = null;
        let detail = '';
        try {
            const body = await response.json();
            if (Array.isArray(body)) rows = body.length;
            else detail = body && (body.message || body.code) ? ` (${body.message || body.code})` : '';
        } catch (error) { /* no JSON body */ }

        const readable = response.ok && rows > 0;
        if (readable) failures++;
        const outcome = readable ? `FAIL  returned ${rows} row(s)`
            : response.ok ? 'PASS  returned no rows'
            : `PASS  refused, HTTP ${response.status}${detail}`;
        console.log(`${table.padEnd(16)} ${outcome}`);
    }

    console.log(failures === 0
        ? '\nAll tables closed to the public key.'
        : `\n${failures} table(s) can still be read with the public key. Do not leave it like this.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => stop(`Could not complete the test: ${error.message}`));
