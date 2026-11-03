/**
 * Job titles from Microsoft Graph, verified.
 *
 * Roles in this app are Azure AD job titles. They are not in the login token, so the browser forwards its
 * own Microsoft Graph token once (to /api/me) and the server asks Graph who that token belongs to. Graph
 * is the one that vouches for it: the title is only accepted when the token belongs to the same person as
 * the verified login (matching object id), so nobody can present someone else's title.
 *
 * The result is cached per person, so ordinary requests need no Graph token at all.
 */

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me?$select=id,jobTitle';
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 2000;
const cache = new Map();   // object id -> { jobTitle, at }

/** The cached title for a person: { jobTitle } (jobTitle may be null) or null when unknown or expired */
function cached(oid) {
    const entry = cache.get(oid);
    if (!entry) return null;
    if (Date.now() - entry.at > TTL_MS) { cache.delete(oid); return null; }
    return { jobTitle: entry.jobTitle };
}

/**
 * Ask Graph about the token's owner. Resolves with the job title (a string, or null when the person has
 * none) and caches it. Rejects when the token is not valid or belongs to someone other than `oid`.
 */
async function verifyJobTitle(oid, graphToken) {
    if (!oid || !graphToken) throw new Error('A login and a Graph token are both needed');

    const response = await fetch(GRAPH_ME, {
        headers: { Authorization: `Bearer ${graphToken}` },
        signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Graph refused the token (HTTP ${response.status})`);

    const me = await response.json();
    if (!me || me.id !== oid) throw new Error('The Graph token belongs to a different person than the login');

    const jobTitle = typeof me.jobTitle === 'string' && me.jobTitle.trim() ? me.jobTitle.trim() : null;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(oid, { jobTitle, at: Date.now() });
    return jobTitle;
}

function clearCache() { cache.clear(); }

module.exports = { cached, verifyJobTitle, clearCache, TTL_MS };
