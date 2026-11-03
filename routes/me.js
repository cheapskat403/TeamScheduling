/**
 * GET /api/me: who the server thinks you are and what you may do. The page uses it to show or hide
 * controls; the server still checks every change itself.
 *
 * Send your Microsoft Graph access token in the X-Graph-Token header to have your job title verified
 * (see utils/graphIdentity.js). It is only read here and is never stored.
 */

const express = require('express');
const router = express.Router();
const graphIdentity = require('../utils/graphIdentity');
const { permissionsFor } = require('../utils/permissions');
const logger = require('../utils/logger');

router.get('/', async (req, res) => {
    try {
        let titleChecked = null;
        const graphToken = req.get('x-graph-token');
        if (graphToken && req.user && req.user.authenticated) {
            try {
                await graphIdentity.verifyJobTitle(req.user.id, graphToken);
                titleChecked = true;
            } catch (error) {
                logger.warn(`Job title check failed for ${req.user.email}: ${error.message}`);
                titleChecked = false;
            }
        }

        const p = req.permissions && titleChecked === null ? req.permissions : await permissionsFor(req.user);
        res.json({
            email: req.user && req.user.authenticated ? req.user.email : null,
            name: req.user && req.user.authenticated ? req.user.name : null,
            jobTitle: p.jobTitle,
            isAdmin: p.isAdmin,
            canBookCalendar: p.canBookCalendar,
            canViewAudit: p.canViewAudit,
            titleKnown: p.titleKnown,
            titleChecked,
            enforced: p.enforced
        });
    } catch (error) {
        logger.error('Error in /api/me:', error);
        res.status(500).json({ error: 'Failed to work out your permissions' });
    }
});

module.exports = router;
