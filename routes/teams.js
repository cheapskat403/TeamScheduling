const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { toCamelCase } = require('../utils/helpers');
const logger = require('../utils/logger');
const { requireAuthForWrites } = require('../middleware/requireAuth');
const { validateBody } = require('../utils/validate');

// Protect write operations
router.use(requireAuthForWrites);

/**
 * Create a new team
 */
router.post('/', validateBody('team'), async (req, res) => {
    try {
        const { name, color, memberCount, manager, managerImage, locationId } = req.body;
        
        if (!locationId) {
            return res.status(400).json({ error: 'Location is required' });
        }
        
        const newTeam = {
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            name,
            manager: manager || '',
            manager_image: managerImage || '',
            color: color || '#6B7280',
            member_count: parseInt(memberCount) || 1,
            location_id: locationId
        };
        
        const { data, error } = await supabase
            .from('teams')
            .insert(newTeam)
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(toCamelCase(data));
    } catch (error) {
        logger.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});

/**
 * Update a team
 */
router.put('/:id', validateBody('team'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const dbUpdates = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.manager !== undefined) dbUpdates.manager = updates.manager;
        if (updates.managerImage !== undefined) dbUpdates.manager_image = updates.managerImage;
        if (updates.color) dbUpdates.color = updates.color;
        if (updates.memberCount) dbUpdates.member_count = parseInt(updates.memberCount);
        if (updates.locationId) dbUpdates.location_id = updates.locationId;
        
        const { data, error } = await supabase
            .from('teams')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Team not found' });
        }
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error updating team:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

/**
 * Delete a team and its bookings
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // First, delete all bookings for this team
        const { error: bookingsError } = await supabase
            .from('bookings')
            .delete()
            .eq('team_id', id);
        
        if (bookingsError) {
            logger.error('Error deleting team bookings:', bookingsError);
            // Continue anyway - team deletion is more important
        }
        
        // Then delete the team
        const { error } = await supabase
            .from('teams')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting team:', error);
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

module.exports = router;

