/**
 * Settings Routes
 * Manages application settings stored in the database
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { requireAuthForWrites } = require('../middleware/requireAuth');
const { settingValue, ValidationError } = require('../utils/validate');
const { invalidateConfig, enforced } = require('../utils/permissions');

// Who the admins are and who may read the audit log: only admins can even see these lists
const ADMIN_ONLY_KEYS = ['admin_emails', 'audit_viewer_roles'];

// Apply auth middleware - GET allowed without auth, PUT requires auth
router.use(requireAuthForWrites);

// ============================================
// GET /api/settings/:key - Get a setting value
// ============================================
router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;

        if (ADMIN_ONLY_KEYS.includes(key) && enforced() && !(req.permissions && req.permissions.isAdmin)) {
            return res.status(403).json({ error: 'Only administrators can see this setting', code: 'FORBIDDEN' });
        }
        
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', key)
            .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            throw error;
        }
        
        // Return default values for known settings if not found
        if (!data) {
            const defaults = {
                'team_roles': [],
                'admin_emails': [],
                'audit_viewer_roles': [],
            };
            return res.json({ value: defaults[key] || null });
        }
        
        res.json({ value: data.value });
    } catch (error) {
        logger.error('Error getting setting:', error);
        res.status(500).json({ error: 'Failed to get setting' });
    }
});

// ============================================
// PUT /api/settings/:key - Update a setting value
// ============================================
router.put('/:key', async (req, res) => {
    try {
        const { key } = req.params;

        // Checks the name, and the value for the settings we know (team roles, floor plan backgrounds)
        let value;
        try {
            value = settingValue(key, req.body && req.body.value);
        } catch (validationError) {
            if (validationError instanceof ValidationError) {
                return res.status(400).json({ error: validationError.message, code: 'INVALID_INPUT' });
            }
            throw validationError;
        }
        
        const { data, error } = await supabase
            .from('settings')
            .upsert({ 
                key, 
                value,
                updated_at: new Date().toISOString()
            }, { 
                onConflict: 'key' 
            })
            .select()
            .single();
        
        if (error) throw error;
        
        invalidateConfig();   // role settings apply straight away
        logger.info(`Setting updated: ${key}`);
        res.json({ value: data.value });
    } catch (error) {
        logger.error('Error updating setting:', error);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

module.exports = router;

