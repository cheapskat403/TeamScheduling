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
 * Get floor elements for a location/floor
 */
router.get('/', async (req, res) => {
    try {
        const { locationId, floor } = req.query;
        
        let query = supabase.from('floor_elements').select('*');
        if (locationId) query = query.eq('location_id', locationId);
        if (floor) query = query.eq('floor', floor);
        
        const { data, error } = await query;
        if (error) throw error;
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error fetching floor elements:', error);
        res.status(500).json({ error: 'Failed to get floor elements' });
    }
});

/**
 * Create a floor element
 */
router.post('/', validateBody('floorElement'), async (req, res) => {
    try {
        const { type, locationId, floor, x, y, width, height, points, label, color, rotation } = req.body;
        
        if (!type || !locationId) {
            return res.status(400).json({ error: 'Type and location are required' });
        }
        
        const newElement = {
            id: Date.now().toString(),
            type,
            location_id: locationId,
            floor: floor || '1',
            x: x || 0,
            y: y || 0,
            width: width || 100,
            height: height || 100,
            rotation: rotation || 0,
            points: points || [],
            label: label || '',
            color: color || null,
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('floor_elements')
            .insert(newElement)
            .select()
            .single();
        
        if (error) throw error;
        res.status(201).json(toCamelCase(data));
    } catch (error) {
        logger.error('Error creating floor element:', error);
        res.status(500).json({ error: 'Failed to create floor element' });
    }
});

/**
 * Update a floor element
 */
router.put('/:id', validateBody('floorElement'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const dbUpdates = {};
        if (updates.type) dbUpdates.type = updates.type;
        if (updates.locationId) dbUpdates.location_id = updates.locationId;
        if (updates.floor) dbUpdates.floor = updates.floor;
        if (updates.x !== undefined) dbUpdates.x = updates.x;
        if (updates.y !== undefined) dbUpdates.y = updates.y;
        if (updates.width !== undefined) dbUpdates.width = updates.width;
        if (updates.height !== undefined) dbUpdates.height = updates.height;
        if (updates.rotation !== undefined) dbUpdates.rotation = updates.rotation;
        if (updates.points) dbUpdates.points = updates.points;
        if (updates.label !== undefined) dbUpdates.label = updates.label;
        if (updates.color !== undefined) dbUpdates.color = updates.color;
        
        const { data, error } = await supabase
            .from('floor_elements')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();
        
        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Element not found' });
        }
        
        res.json(toCamelCase(data));
    } catch (error) {
        logger.error('Error updating floor element:', error);
        res.status(500).json({ error: 'Failed to update floor element' });
    }
});

/**
 * Delete a floor element
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('floor_elements')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting floor element:', error);
        res.status(500).json({ error: 'Failed to delete floor element' });
    }
});

module.exports = router;

