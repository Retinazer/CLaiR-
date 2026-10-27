const express = require('express');
const router = express.Router();
const { generateClairReply } = require('../services/chatService');

// POST /api/chat
router.post('/', (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const reply = generateClairReply(message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
