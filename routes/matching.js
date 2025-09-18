const express = require('express');
const router = express.Router();

// GET /api/matching - Get potential matches for blood requests
router.get('/', (req, res) => {
  res.json({ 
    message: 'Matching service endpoint',
    matches: []
  });
});

// POST /api/matching - Create a new match
router.post('/', (req, res) => {
  res.json({ 
    message: 'Match created successfully',
    matchId: Date.now()
  });
});

module.exports = router;

