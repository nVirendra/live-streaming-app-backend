const express = require('express');
const { auth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Stream = require('../models/Stream');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(auth);
router.use(requireAdmin);

// Get platform statistics
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalStreamers = await User.countDocuments({ isStreamer: true });
    const liveStreams = await Stream.countDocuments({ isLive: true });
    const totalStreams = await Stream.countDocuments();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalStreamers,
        liveStreams,
        totalStreams
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});
