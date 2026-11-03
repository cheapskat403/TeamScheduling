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
 * Create a new location
 */
router.post('/', validateBody('location', { required: ['name'] }), async (req, res) => {
    try {
        const { name, address, capacity, floors } = req.body;
        
        const newLocation = {
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            name,
            address: address || '',
            capacity: parseInt(capacity) || 21,
            floors: parseInt(floors) || 1
        };
        
        const { data, error } = await supabase
            .from('locations')
            .insert(newLocation)
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(toCamelCase(data));
    } catch (error) {
        logger.error('Error creating location:', error);
        res.status(500).json({ error: 'Failed to create location' });
    }
});

/**
 * Update a location
 */
router.put('/:id', validateBody('location'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const dbUpdates = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.address !== undefined) dbUpdates.address = updates.address;
        if (updates.capacity) dbUpdates.capacity = parseInt(updates.capacity);
        if (updates.floors) dbUpdates.floors = parseInt(updates.floors);
        if (updates.floorPlanWidth) dbUpdates.floor_plan_width = parseInt(updates.floorPlanWidth);
        if (updates.floorPlanHeight) dbUpdates.floor_plan_height = parseInt(updates.floorPlanHeight);
        
        const { data, error } = await supabase
            .from('locations')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Location not found' });
        }
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error updating location:', error);
        res.status(500).json({ error: 'Failed to update location' });
    }
});

/**
 * Delete a location
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Delete associated bookings first (cascade should handle this, but being explicit)
        await supabase.from('bookings').delete().eq('location_id', id);
        
        const { error } = await supabase
            .from('locations')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting location:', error);
        res.status(500).json({ error: 'Failed to delete location' });
    }
});

module.exports = router;

