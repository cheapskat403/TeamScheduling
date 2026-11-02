const express = require('express');
const https = require('https');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { toCamelCase } = require('../utils/helpers');
const logger = require('../utils/logger');
const { requireAuthForWrites } = require('../middleware/requireAuth');
const { holidayYear, countryCode, checks, ValidationError } = require('../utils/validate');

// Protect write operations
router.use(requireAuthForWrites);

/**
 * Fetch public holidays from Nager.Date API
 */
router.get('/fetch/:year', async (req, res) => {
    try {
        // These go into the URL we call, so they must be exactly a year and a country code
        let year, country;
        try {
            year = holidayYear(req.params.year);
            country = countryCode(req.query.country || 'ZA');
        } catch (validationError) {
            if (validationError instanceof ValidationError) {
                return res.status(400).json({ error: validationError.message, code: 'INVALID_INPUT' });
            }
            throw validationError;
        }

        const MAX_RESPONSE_BYTES = 500000;
        const fetchHolidays = () => {
            return new Promise((resolve, reject) => {
                const request = https.get(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, (response) => {
                    let data = '';
                    response.on('data', chunk => {
                        data += chunk;
                        if (data.length > MAX_RESPONSE_BYTES) {
                            request.destroy(new Error('Holiday response too large'));
                        }
                    });
                    response.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Failed to parse holiday data'));
                        }
                    });
                });
                request.setTimeout(10000, () => request.destroy(new Error('Holiday request timed out')));
                request.on('error', reject);
            });
        };
        
        const holidays = await fetchHolidays();
        
        const formattedHolidays = holidays.map(h => ({
            date: h.date,
            name: h.localName || h.name
        }));
        
        res.json(formattedHolidays);
    } catch (error) {
        logger.error('Error fetching holidays:', error);
        res.status(500).json({ error: 'Failed to fetch holidays from API' });
    }
});

/**
 * Update holidays in the database
 */
router.post('/', async (req, res) => {
    try {
        const { holidays } = req.body;

        // A list of {date, name}: real dates, short plain names, at most a few hundred
        if (!Array.isArray(holidays) || holidays.length > 400) {
            return res.status(400).json({ error: 'holidays must be a list of at most 400 items', code: 'INVALID_INPUT' });
        }
        let cleaned;
        try {
            cleaned = holidays.map(h => ({
                date: checks.date(h && h.date, 'date'),
                name: checks.str(100)(h && h.name, 'name')
            }));
        } catch (validationError) {
            if (validationError instanceof ValidationError) {
                return res.status(400).json({ error: validationError.message, code: 'INVALID_INPUT' });
            }
            throw validationError;
        }

        // Upsert holidays (insert or update on conflict)
        const { error } = await supabase
            .from('public_holidays')
            .upsert(cleaned, { onConflict: 'date' });
        
        if (error) throw error;
        
        const { data: allHolidays } = await supabase
            .from('public_holidays')
            .select('*')
            .order('date');
        
        res.json(toCamelCase(allHolidays));
    } catch (error) {
        logger.error('Error updating holidays:', error);
        res.status(500).json({ error: 'Failed to update holidays' });
    }
});

/**
 * Delete a holiday
 */
router.delete('/:date', async (req, res) => {
    try {
        const { date } = req.params;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'date must be like 2026-03-31', code: 'INVALID_INPUT' });
        }

        const { error } = await supabase
            .from('public_holidays')
            .delete()
            .eq('date', date);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting holiday:', error);
        res.status(500).json({ error: 'Failed to delete holiday' });
    }
});

module.exports = router;

