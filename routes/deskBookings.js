const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { toCamelCase } = require('../utils/helpers');
const logger = require('../utils/logger');
const { requireAuthForWrites } = require('../middleware/requireAuth');
const { todayInOffice } = require('../utils/dates');
const { validateBody } = require('../utils/validate');
const crypto = require('crypto');

/** Identity of the caller: the verified Azure AD user when signed in, otherwise null */
function callerEmail(req) {
    return req.user && req.user.authenticated && req.user.email ? req.user.email.toLowerCase() : null;
}

// Protect write operations
router.use(requireAuthForWrites);

// Tells everyone looking at the Desks page of a location that its bookings changed (set up in server.js).
// It only says WHAT kind of change and for which day; the pages fetch the new bookings themselves.
let notifyDesks = null;
function liveChanged(locationId, payload) {
    if (!notifyDesks || !locationId) return;
    try { notifyDesks(locationId, payload); } catch (error) { logger.warn('Could not send live desk update:', error.message); }
}

/**
 * Get desk bookings for a date/location
 */
router.get('/', async (req, res) => {
    try {
        const { date, from, to, locationId, deskId } = req.query;

        let query = supabase.from('desk_bookings').select('*');

        if (date) query = query.eq('date', date);
        // Date range, used by the day strip to show how busy each day is
        if (from) query = query.gte('date', from);
        if (to) query = query.lte('date', to);
        if (locationId) query = query.eq('location_id', locationId);
        if (deskId) query = query.eq('desk_id', deskId);
        
        const { data, error } = await query;
        if (error) throw error;
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error fetching desk bookings:', error);
        res.status(500).json({ error: 'Failed to fetch desk bookings' });
    }
});

/**
 * Create a desk booking (full day)
 */
router.post('/', validateBody('deskBooking'), async (req, res) => {
    try {
        const { deskId, date, teamId } = req.body;
        // A verified sign-in always wins over whatever the client typed
        const verifiedEmail = callerEmail(req);
        const employeeName = (req.user && req.user.authenticated && req.user.name) || req.body.employeeName;
        const employeeEmail = verifiedEmail || req.body.employeeEmail;

        if (!deskId || !date || !employeeName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date' });
        }
        if (date < todayInOffice()) {
            return res.status(400).json({ error: 'Cannot book a desk in the past' });
        }
        
        // Get desk info
        const { data: desk, error: deskError } = await supabase
            .from('desks')
            .select('*')
            .eq('id', deskId)
            .single();
        
        if (deskError || !desk) {
            return res.status(400).json({ error: 'Desk not found' });
        }
        
        // Check if desk is already booked for this day
        const { data: conflicts } = await supabase
            .from('desk_bookings')
            .select('id')
            .eq('desk_id', deskId)
            .eq('date', date);
        
        if (conflicts && conflicts.length > 0) {
            return res.status(400).json({ error: 'Desk already booked for this day' });
        }

        // One desk per person per day
        if (employeeEmail) {
            const { data: dayBookings } = await supabase
                .from('desk_bookings')
                .select('id, desk_name, employee_email')
                .eq('date', date);
            const mine = (dayBookings || []).find(
                b => (b.employee_email || '').toLowerCase() === employeeEmail.toLowerCase()
            );
            if (mine) {
                return res.status(409).json({ error: `You already have ${mine.desk_name} for this day` });
            }
        }

        const newBooking = {
            id: crypto.randomUUID(),
            desk_id: deskId,
            desk_name: desk.name,
            location_id: desk.location_id,
            date,
            employee_name: employeeName,
            employee_email: employeeEmail || '',
            team_id: teamId || null,
            checked_in: false,
            checked_in_at: null,
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('desk_bookings')
            .insert(newBooking)
            .select()
            .single();
        
        if (error) {
            // Unique index hit: someone else won the race for this desk / this person already booked
            if (error.code === '23505') {
                return res.status(409).json({ error: 'That desk was just taken. Pick another one.' });
            }
            throw error;
        }
        res.status(201).json(toCamelCase(data));
        liveChanged(data.location_id, { type: 'deskBooking:created', date: data.date });
    } catch (error) {
        logger.error('Error creating desk booking:', error);
        res.status(500).json({ error: 'Failed to create desk booking' });
    }
});

/**
 * Cancel a desk booking
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: existing } = await supabase
            .from('desk_bookings')
            .select('employee_email, location_id, date')
            .eq('id', id)
            .single();

        // Signed-in users can only cancel their own bookings (admins can cancel anyone's)
        const email = callerEmail(req);
        if (email && !(req.permissions && req.permissions.isAdmin)) {
            if (existing && (existing.employee_email || '').toLowerCase() !== email) {
                return res.status(403).json({ error: 'You can only cancel your own bookings' });
            }
        }

        const { error } = await supabase
            .from('desk_bookings')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
        if (existing) liveChanged(existing.location_id, { type: 'deskBooking:cancelled', date: existing.date });
    } catch (error) {
        logger.error('Error canceling desk booking:', error);
        res.status(500).json({ error: 'Failed to cancel desk booking' });
    }
});

/**
 * Check in to a desk booking via QR code
 */
router.post('/:id/checkin', async (req, res) => {
    try {
        const { id } = req.params;
        const { qrCode } = req.body;
        
        // Get booking
        const { data: booking, error: bookingError } = await supabase
            .from('desk_bookings')
            .select('*')
            .eq('id', id)
            .single();
        
        if (bookingError || !booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        // Get desk
        const { data: desk, error: deskError } = await supabase
            .from('desks')
            .select('qr_code')
            .eq('id', booking.desk_id)
            .single();
        
        if (deskError || !desk) {
            return res.status(404).json({ error: 'Desk not found' });
        }
        
        // Verify QR code (proves the person is physically at the desk)
        if (!qrCode || desk.qr_code !== qrCode) {
            return res.status(400).json({ error: 'Invalid QR code for this desk' });
        }

        // Only the booking owner can check in
        // (when logins are enforced, a login without a usable email cannot check in someone else's booking either)
        const email = callerEmail(req);
        const signedIn = req.user && req.user.authenticated;
        const bookedBy = booking.employee_email && booking.employee_email.toLowerCase();
        if (bookedBy && (signedIn ? email !== bookedBy : (email && email !== bookedBy))) {
            return res.status(403).json({ error: 'This desk is booked by someone else' });
        }

        // Check if booking is for today (office timezone, not UTC)
        const today = todayInOffice();
        if (booking.date !== today) {
            return res.status(400).json({ error: 'Can only check in on the booking date' });
        }
        
        // Update booking
        const { data: updated, error: updateError } = await supabase
            .from('desk_bookings')
            .update({
                checked_in: true,
                checked_in_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
        
        if (updateError) throw updateError;
        
        res.json({ success: true, booking: toCamelCase(updated) });
        liveChanged(booking.location_id, { type: 'deskBooking:checkedIn', date: booking.date });
    } catch (error) {
        logger.error('Error checking in:', error);
        res.status(500).json({ error: 'Failed to check in' });
    }
});

/**
 * Get check-in page data (for QR code scan).
 * This is readable without logging in (the page is opened from a sticker on the desk), so it only
 * returns what the page shows: no email addresses, no QR codes, no other internal fields.
 * Also served at /api/checkin/:qrCode, see server.js.
 */
async function checkinInfo(req, res) {
    try {
        const { qrCode } = req.params;
        
        // Get desk by QR code
        const { data: desk, error: deskError } = await supabase
            .from('desks')
            .select('*')
            .eq('qr_code', qrCode)
            .single();
        
        if (deskError || !desk) {
            return res.status(404).json({ error: 'Desk not found' });
        }
        
        // Get location
        const { data: location } = await supabase
            .from('locations')
            .select('*')
            .eq('id', desk.location_id)
            .single();
        
        // Get today's bookings for this desk
        const today = todayInOffice();
        const { data: todayBookings } = await supabase
            .from('desk_bookings')
            .select('*')
            .eq('desk_id', desk.id)
            .eq('date', today);
        
        res.json({
            desk: { id: desk.id, name: desk.name, floor: desk.floor, zone: desk.zone },
            location: location ? { name: location.name } : null,
            todayBookings: (todayBookings || []).map(b => ({
                id: b.id,
                employeeName: b.employee_name,
                checkedIn: !!b.checked_in
            }))
        });
    } catch (error) {
        logger.error('Error getting check-in data:', error);
        res.status(500).json({ error: 'Failed to get check-in data' });
    }
}

router.get('/checkin/:qrCode', checkinInfo);
router.checkinInfo = checkinInfo;

/** Called once by server.js with a function (locationId, payload) that reaches the Desks page of that location */
router.initLive = (notify) => { notifyDesks = notify; };

module.exports = router;

