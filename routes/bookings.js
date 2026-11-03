const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { toCamelCase } = require('../utils/helpers');
const logger = require('../utils/logger');
const { requireAuthForWrites } = require('../middleware/requireAuth');
const { validateBody, icsText, checks, ValidationError } = require('../utils/validate');

// Apply auth middleware to all routes in this router
// GET requests allowed without auth, POST/PUT/DELETE require auth (if REQUIRE_AUTH=true)
router.use(requireAuthForWrites);

// These will be injected from server.js
let emitRoomDataChanged = null;
let roomKeyForBooking = null;

/**
 * Initialize with socket functions
 */
function initBookingsRoutes(socketFns) {
    emitRoomDataChanged = socketFns.emitRoomDataChanged;
    roomKeyForBooking = socketFns.roomKeyForBooking;
}

/**
 * Get bookings for a specific month/date and location
 */
router.get('/', async (req, res) => {
    try {
        const { year, month, location, locationId, date, from, to } = req.query;
        
        let query = supabase.from('bookings').select('*');
        
        // Filter by specific date if provided
        if (date) {
            query = query.eq('date', date);
        } else if (from && to) {
            // A date range (used by the Desks page to show which teams are in this week)
            try {
                query = query.gte('date', checks.date(from, 'from')).lte('date', checks.date(to, 'to'));
            } catch (validationError) {
                if (validationError instanceof ValidationError) {
                    return res.status(400).json({ error: validationError.message, code: 'INVALID_INPUT' });
                }
                throw validationError;
            }
        } else if (year && month) {
            const startDate = `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`;
            const endDate = new Date(Date.UTC(parseInt(year), parseInt(month) + 1, 0)).toISOString().split('T')[0];   // last day of the month, in UTC so the server's time zone can't shift it
            query = query.gte('date', startDate).lte('date', endDate);
        }
        
        // Support both 'location' and 'locationId' parameters
        const loc = locationId || location;
        if (loc) {
            query = query.eq('location_id', loc);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

/**
 * Create a new booking
 */
router.post('/', validateBody('booking'), async (req, res) => {
    try {
        const { date, teamId, teamName, peopleCount, locationId, notes } = req.body;
        
        if (!date || !teamId || !peopleCount || !locationId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Get location capacity
        const { data: location, error: locError } = await supabase
            .from('locations')
            .select('capacity')
            .eq('id', locationId)
            .single();
        
        if (locError || !location) {
            return res.status(400).json({ error: 'Invalid location' });
        }
        
        // Check if team already has a booking for this date and location
        const { data: existingTeamBooking } = await supabase
            .from('bookings')
            .select('id')
            .eq('date', date)
            .eq('location_id', locationId)
            .eq('team_id', teamId)
            .single();
        
        if (existingTeamBooking) {
            return res.status(400).json({ 
                error: `${teamName || teamId} already has a booking for this date` 
            });
        }
        
        // Calculate current bookings for that date and location
        const { data: existingBookings } = await supabase
            .from('bookings')
            .select('people_count')
            .eq('date', date)
            .eq('location_id', locationId);
        
        const currentTotal = (existingBookings || []).reduce((sum, b) => sum + b.people_count, 0);
        
        // Allow overbooking if notes are provided (with explanation)
        let isOverbooked = false;
        if (currentTotal + peopleCount > location.capacity) {
            if (!notes || notes.trim().length === 0) {
                return res.status(400).json({ 
                    error: `Exceeds capacity (${location.capacity - currentTotal} spots available). Please provide a note explaining the overbooking.` 
                });
            }
            // Overbooking allowed with notes - continue
            isOverbooked = true;
            logger.info(`Overbooking allowed for ${date}: ${currentTotal + peopleCount}/${location.capacity} with note: ${notes}`);
        }
        
        const newBooking = {
            id: Date.now().toString(),
            date,
            team_id: teamId,
            team_name: teamName || teamId,
            people_count: parseInt(peopleCount),
            location_id: locationId,
            notes: isOverbooked ? `[OVERBOOKED] ${notes || ''}` : (notes || ''),
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('bookings')
            .insert(newBooking)
            .select()
            .single();
        
        if (error) throw error;

        const booking = toCamelCase(data);
        if (emitRoomDataChanged && roomKeyForBooking) {
            emitRoomDataChanged(roomKeyForBooking(booking.date, booking.locationId), {
                type: 'booking:created',
                booking
            });
        }
        
        res.status(201).json(booking);
    } catch (error) {
        logger.error('Error creating booking:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

/**
 * Update a booking
 */
router.put('/:id', validateBody('booking'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Get current booking
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', id)
            .single();
        
        if (fetchError || !booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        const targetDate = updates.date || booking.date;
        const targetLocation = updates.locationId || booking.location_id;
        const targetTeamId = updates.teamId || booking.team_id;
        
        // Check if team already has a booking for the target date (if date is changing)
        if (updates.date && updates.date !== booking.date) {
            const { data: existingTeamBooking } = await supabase
                .from('bookings')
                .select('id')
                .eq('date', updates.date)
                .eq('location_id', targetLocation)
                .eq('team_id', targetTeamId)
                .neq('id', id)
                .single();
            
            if (existingTeamBooking) {
                return res.status(400).json({ 
                    error: `${booking.team_name} already has a booking for that date` 
                });
            }
        }
        
        // Check capacity
        const { data: location } = await supabase
            .from('locations')
            .select('capacity')
            .eq('id', targetLocation)
            .single();
        
        const { data: otherBookings } = await supabase
            .from('bookings')
            .select('people_count')
            .eq('date', targetDate)
            .eq('location_id', targetLocation)
            .neq('id', id);
        
        const otherTotal = (otherBookings || []).reduce((sum, b) => sum + b.people_count, 0);
        const newPeopleCount = updates.peopleCount ? parseInt(updates.peopleCount) : booking.people_count;
        
        if (otherTotal + newPeopleCount > location.capacity) {
            return res.status(400).json({ 
                error: `Exceeds capacity. Available: ${location.capacity - otherTotal}` 
            });
        }
        
        // Convert camelCase to snake_case for update
        const dbUpdates = {};
        if (updates.date) dbUpdates.date = updates.date;
        if (updates.teamId) dbUpdates.team_id = updates.teamId;
        if (updates.teamName) dbUpdates.team_name = updates.teamName;
        if (updates.peopleCount) dbUpdates.people_count = parseInt(updates.peopleCount);
        if (updates.locationId) dbUpdates.location_id = updates.locationId;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
        
        const { data: updated, error: updateError } = await supabase
            .from('bookings')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();
        
        if (updateError) throw updateError;

        const before = toCamelCase(booking);
        const after = toCamelCase(updated);
        
        if (emitRoomDataChanged && roomKeyForBooking) {
            const beforeRoom = roomKeyForBooking(before.date, before.locationId);
            const afterRoom = roomKeyForBooking(after.date, after.locationId);

            emitRoomDataChanged(afterRoom, { type: 'booking:updated', booking: after, before });
            if (beforeRoom !== afterRoom) {
                emitRoomDataChanged(beforeRoom, { type: 'booking:moved_out', booking: after, before });
            }
        }
        
        res.json(after);
    } catch (error) {
        logger.error('Error updating booking:', error);
        res.status(500).json({ error: 'Failed to update booking' });
    }
});

/**
 * Generate ICS calendar file for a booking
 */
router.get('/:id/ics', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', id)
            .single();
        
        if (bookingError || !booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        const { data: location } = await supabase
            .from('locations')
            .select('name')
            .eq('id', booking.location_id)
            .single();
        
        const { data: team } = await supabase
            .from('teams')
            .select('manager')
            .eq('id', booking.team_id)
            .single();
        
        const startDate = booking.date.replace(/-/g, '');
        
        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Office Booking System//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            `DTSTART;VALUE=DATE:${startDate}`,
            `DTEND;VALUE=DATE:${startDate}`,
            `SUMMARY:${icsText(booking.team_name)} - Office Booking`,
            `DESCRIPTION:Team: ${icsText(booking.team_name)}\\nPeople: ${booking.people_count}\\nManager: ${icsText(team?.manager || 'N/A')}\\n${icsText(booking.notes)}`,
            `LOCATION:${icsText(location?.name || 'Office')}`,
            `UID:${booking.id}@officebooking`,
            'STATUS:CONFIRMED',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
        
        res.setHeader('Content-Type', 'text/calendar');
        res.setHeader('Content-Disposition', `attachment; filename="booking-${booking.id}.ics"`);
        res.send(icsContent);
    } catch (error) {
        logger.error('Error generating ICS:', error);
        res.status(500).json({ error: 'Failed to generate calendar file' });
    }
});

/**
 * Delete a booking
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get booking first for socket emit
        const { data: booking } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', id)
            .single();
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        const { error } = await supabase
            .from('bookings')
            .delete()
            .eq('id', id);
        
        if (error) throw error;

        if (emitRoomDataChanged && roomKeyForBooking) {
            const deletedBooking = toCamelCase(booking);
            emitRoomDataChanged(roomKeyForBooking(deletedBooking.date, deletedBooking.locationId), {
                type: 'booking:deleted',
                booking: deletedBooking
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting booking:', error);
        res.status(500).json({ error: 'Failed to delete booking' });
    }
});

module.exports = { router, initBookingsRoutes };

