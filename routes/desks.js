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
 * Get all desks for a location
 */
router.get('/', async (req, res) => {
    try {
        const { locationId } = req.query;
        
        let query = supabase.from('desks').select('*');
        if (locationId) {
            query = query.eq('location_id', locationId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error fetching desks:', error);
        res.status(500).json({ error: 'Failed to fetch desks' });
    }
});

/**
 * Create a new desk
 */
router.post('/', validateBody('desk'), async (req, res) => {
    try {
        const { name, locationId, floor, zone, x, y, width, height, deskType, assignedTeamId, chairPositions } = req.body;
        
        if (!name || !locationId) {
            return res.status(400).json({ error: 'Name and location are required' });
        }
        
        const newDesk = {
            id: Date.now().toString(),
            name,
            location_id: locationId,
            floor: floor || '1',
            zone: zone || '',
            x: x || 0,
            y: y || 0,
            width: width || 60,
            height: height || 40,
            desk_type: deskType || 'hotseat',
            assigned_team_id: assignedTeamId || null,
            chair_positions: chairPositions || ['bottom'],
            qr_code: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('desks')
            .insert(newDesk)
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(toCamelCase(data));
    } catch (error) {
        logger.error('Error creating desk:', error);
        res.status(500).json({ error: 'Failed to create desk' });
    }
});

/**
 * Update a desk
 */
router.put('/:id', validateBody('desk'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const dbUpdates = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.locationId) dbUpdates.location_id = updates.locationId;
        if (updates.floor) dbUpdates.floor = updates.floor;
        if (updates.zone !== undefined) dbUpdates.zone = updates.zone;
        if (updates.x !== undefined) dbUpdates.x = updates.x;
        if (updates.y !== undefined) dbUpdates.y = updates.y;
        if (updates.width !== undefined) dbUpdates.width = updates.width;
        if (updates.height !== undefined) dbUpdates.height = updates.height;
        if (updates.deskType) dbUpdates.desk_type = updates.deskType;
        if (updates.assignedTeamId !== undefined) dbUpdates.assigned_team_id = updates.assignedTeamId;
        if (updates.chairPositions) dbUpdates.chair_positions = updates.chairPositions;
        
        const { data, error } = await supabase
            .from('desks')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Desk not found' });
        }
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error updating desk:', error);
        res.status(500).json({ error: 'Failed to update desk' });
    }
});

/**
 * Delete a desk
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Delete desk bookings first (cascade should handle this)
        await supabase.from('desk_bookings').delete().eq('desk_id', id);
        
        const { error } = await supabase
            .from('desks')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting desk:', error);
        res.status(500).json({ error: 'Failed to delete desk' });
    }
});

module.exports = router;

