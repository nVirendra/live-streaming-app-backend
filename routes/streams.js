const express = require('express');
const { 
  auth, 
  optionalAuth, 
  requireStreamer, 
  requireStreamOwner 
} = require('../middleware/auth');
const Stream = require('../models/Stream');

const router = express.Router();

// Public route - no authentication required
router.get('/', async (req, res) => {
  // Get all public streams
});

// Optional auth - works for both authenticated and non-authenticated users
router.get('/live', optionalAuth, async (req, res) => {
  try {
    const streams = await Stream.find({ isLive: true })
      .populate('streamer', 'username avatar')
      .sort({ viewerCount: -1 });

    // req.user might be null or contain user info
    const personalizedStreams = req.user 
      ? streams.filter(stream => /* personalization logic */)
      : streams;

    res.json({
      success: true,
      streams: personalizedStreams
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Requires authentication and streamer privileges
router.post('/', auth, requireStreamer, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    
    const stream = new Stream({
      title,
      description,
      category,
      streamer: req.user._id, // Available from auth middleware
      streamKey: req.user.streamKey
    });

    await stream.save();

    res.status(201).json({
      success: true,
      stream
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Requires stream ownership
router.put('/:streamId', auth, requireStreamOwner, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    
    // req.stream is available from requireStreamOwner middleware
    req.stream.title = title || req.stream.title;
    req.stream.description = description || req.stream.description;
    req.stream.category = category || req.stream.category;

    await req.stream.save();

    res.json({
      success: true,
      stream: req.stream
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Only stream owner can delete
router.delete('/:streamId', auth, requireStreamOwner, async (req, res) => {
  try {
    await req.stream.deleteOne();

    res.json({
      success: true,
      message: 'Stream deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;