/**
 * Office Booking System - Main Server
 * 
 * A modular Express.js server for managing office space bookings,
 * team schedules, desk reservations, and floor plans.
 */

// Load environment variables from .env file (for local dev)
// Render and other hosts set env vars directly
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Import modules
const { supabase } = require('./config/supabase');
const { initializeSocketHandlers, roomKeyForBooking, roomKeyForDesks, emitRoomDataChanged } = require('./socket/presence');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const { router: bookingsRoutes, initBookingsRoutes } = require('./routes/bookings');
const locationsRoutes = require('./routes/locations');
const holidaysRoutes = require('./routes/holidays');
const teamsRoutes = require('./routes/teams');
const desksRoutes = require('./routes/desks');
const floorElementsRoutes = require('./routes/floorElements');
const deskBookingsRoutes = require('./routes/deskBookings');
const settingsRoutes = require('./routes/settings');
const meRoutes = require('./routes/me');
const auditRoutes = require('./routes/audit');

// Import middleware
const { authenticate, optionalAuth } = require('./middleware/auth');
const { requireLoginForApi } = require('./middleware/requireAuth');
const { attachPermissions, requireAdmin, requireCalendarAccess, onWrites } = require('./middleware/permissions');
const { auditWrites } = require('./middleware/audit');
const { warnIfNoAdmins } = require('./utils/permissions');
const { socketAuth } = require('./middleware/socketAuth');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required for rate limiting behind reverse proxies (Render, Heroku, etc.)
// This tells Express to trust X-Forwarded-* headers from the first proxy
app.set('trust proxy', 1);

// Create HTTP server and Socket.IO
const httpServer = http.createServer(app);
// Pages are served from this same server, so cross-origin access is off unless CORS_ORIGINS lists origins
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : false;

const io = new Server(httpServer, { cors: { origin: corsOrigin } });

// Websockets need a valid login too when REQUIRE_AUTH=true
io.use(socketAuth());

// Initialize Socket.IO handlers
initializeSocketHandlers(io);

// Initialize routes that need Socket.IO
initBookingsRoutes({
    emitRoomDataChanged: (roomKey, payload) => {
        emitRoomDataChanged(io, roomKey, payload);
        // The Desks page lists which teams are booked in each day, so Calendar bookings change it too
        const locations = new Set([payload.booking && payload.booking.locationId, payload.before && payload.before.locationId].filter(Boolean));
        locations.forEach(locationId => emitRoomDataChanged(io, roomKeyForDesks(locationId), { type: 'teamBooking:changed' }));
    },
    roomKeyForBooking
});

// Desk bookings made, cancelled or checked in reach everyone on the Desks page of that location
deskBookingsRoutes.initLive((locationId, payload) => emitRoomDataChanged(io, roomKeyForDesks(locationId), payload));

// ============================================
// Middleware
// ============================================

// Security headers using Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://alcdn.msauth.net"],
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc.)
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://graph.microsoft.com", "https://login.microsoftonline.com", "wss:", "ws:"],
            frameSrc: ["'self'", "https://login.microsoftonline.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'", "https://login.microsoftonline.com"],
        },
    },
    crossOriginEmbedderPolicy: false, // Required for loading external resources
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200, // Limit each IP to this many requests per windowMs (RATE_LIMIT_MAX overrides it)
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Enable Gzip compression for all responses
app.use(compression());

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Enable CORS
app.use(cors({ origin: corsOrigin }));

// Serve static files.
// The page, scripts and styles are not fingerprinted, so they must be revalidated on every load
// (cheap: the ETag turns an unchanged file into a 304). A long cache here meant that right after a
// deploy people could run new HTML with old scripts, or the other way round, for up to an hour.
// Images, fonts and the floor plan drawings can be cached for an hour.
app.use(express.static('public', {
    maxAge: '1h',
    etag: true,
    setHeaders: (res, filePath) => {
        if (/\.(html|css|js|mjs)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ============================================
// Routes
// ============================================

// Public routes (no authentication required)
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);

// Attach the user if a valid token is present...
app.use('/api', optionalAuth);

// ...and, when REQUIRE_AUTH=true, refuse everything below without one. The only exceptions are the
// QR check-in lookups (see PUBLIC_READ_PATHS), since people scanning a desk sticker are not signed in.
app.use('/api', requireLoginForApi);

if (process.env.REQUIRE_AUTH === 'true' && !(process.env.AZURE_AD_TENANT_ID && process.env.AZURE_AD_CLIENT_ID)) {
    logger.error('REQUIRE_AUTH=true but Azure AD is not configured: every API request will be refused');
}

// What the signed-in user may do (admin, Calendar bookings, audit log), and the audit trail of every change.
// Roles are only enforced when REQUIRE_AUTH=true. See utils/permissions.js.
app.use('/api', attachPermissions);
app.use('/api', auditWrites);
warnIfNoAdmins();

// Data route (initial load)
app.use('/api/data', dataRoutes);

app.use('/api/me', meRoutes);
app.use('/api/audit', auditRoutes);

// Resource routes (each router also protects its own writes).
// Anyone signed in can read. Changing teams, locations, holidays, the desk layout and settings is for
// admins; Calendar bookings need an allowed job title (or admin); desk bookings are open to everyone.
app.use('/api/bookings', onWrites(requireCalendarAccess), bookingsRoutes);
app.use('/api/locations', onWrites(requireAdmin), locationsRoutes);
app.use('/api/holidays', onWrites(requireAdmin), holidaysRoutes);
app.use('/api/teams', onWrites(requireAdmin), teamsRoutes);
app.use('/api/desks', onWrites(requireAdmin), desksRoutes);
app.use('/api/floor-elements', onWrites(requireAdmin), floorElementsRoutes);
app.use('/api/desk-bookings', deskBookingsRoutes);
app.use('/api/settings', onWrites(requireAdmin), settingsRoutes);

// QR code check-in lookup (legacy path). Same handler as /api/desk-bookings/checkin/:qrCode, and the
// only API read that works without logging in (see PUBLIC_READ_PATHS in middleware/requireAuth.js).
app.get('/api/checkin/:qrCode', deskBookingsRoutes.checkinInfo);

// ============================================
// Start Server
// ============================================

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏢 Office Booking System                               ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   Modules loaded:                                         ║
║   ✓ Auth          ✓ Bookings      ✓ Locations            ║
║   ✓ Teams         ✓ Holidays      ✓ Desks                ║
║   ✓ Floor Plans   ✓ Desk Bookings ✓ Socket.IO            ║
║                                                           ║
║   Security:                                               ║
║   ✓ Helmet (CSP, HSTS, X-Frame, etc.)                    ║
║   ✓ Rate Limiting (200 req/15min per IP)                 ║
║                                                           ║
║   Press Ctrl+C to stop                                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

// Export for testing
module.exports = { app, io };
