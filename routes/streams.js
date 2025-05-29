const express = require('express');
const { 
  auth, 
  optionalAuth, 
  requireStreamer, 
  requireStreamOwner 
} = require('../middleware/auth');
const Stream = require('../models/Stream');
const User = require('../models/User');

const router = express.Router();

// Public route - Get all public streams
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, search } = req.query;
    
    // Build filter query
    const filter = { isLive: true };
    if (category && category !== 'all') {
      filter.category = category;
    }
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const streams = await Stream.find(filter)
      .populate('streamer', 'username avatar isOnline')
      .sort({ viewerCount: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Stream.countDocuments(filter);

    res.json({
      success: true,
      streams,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Optional auth - works for both authenticated and non-authenticated users
router.get('/live', optionalAuth, async (req, res) => {
  try {
    const streams = await Stream.find({ isLive: true })
      .populate('streamer', 'username avatar isOnline')
      .sort({ viewerCount: -1 });

    // req.user might be null or contain user info
    let personalizedStreams = streams;
    
    if (req.user) {
      // Add personalization logic for authenticated users
      const followedStreamers = req.user.following || [];
      
      // Sort followed streamers first, then by viewer count
      personalizedStreams = streams.sort((a, b) => {
        const aIsFollowed = followedStreamers.includes(a.streamer._id.toString());
        const bIsFollowed = followedStreamers.includes(b.streamer._id.toString());
        
        if (aIsFollowed && !bIsFollowed) return -1;
        if (!aIsFollowed && bIsFollowed) return 1;
        
        return b.viewerCount - a.viewerCount;
      });
    }

    res.json({
      success: true,
      streams: personalizedStreams,
      isAuthenticated: !!req.user
    });
  } catch (error) {
    console.error('Get live streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get specific stream by ID
router.get('/:streamId', optionalAuth, async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.streamId)
      .populate('streamer', 'username avatar isOnline followers');

    if (!stream) {
      return res.status(404).json({
        success: false,
        message: 'Stream not found'
      });
    }

    // Increment total views if not the owner
    if (!req.user || req.user._id.toString() !== stream.streamer._id.toString()) {
      stream.totalViews += 1;
      await stream.save();
    }

    res.json({
      success: true,
      stream,
      isOwner: req.user && req.user._id.toString() === stream.streamer._id.toString()
    });
  } catch (error) {
    console.error('Get stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Requires authentication and streamer privileges
router.post('/', auth, requireStreamer, async (req, res) => {
  try {
    const { title, description, category, chatEnabled = true, recordingEnabled = false } = req.body;
    
    // Validation
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Stream title is required'
      });
    }

    if (title.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Stream title must be less than 100 characters'
      });
    }

    // Check if user already has an active stream
    const existingStream = await Stream.findOne({
      streamer: req.user._id,
      isLive: true
    });

    if (existingStream) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active stream. End it before starting a new one.'
      });
    }

    const stream = new Stream({
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category || 'Other',
      streamer: req.user._id,
      streamKey: req.user.streamKey,
      chatEnabled,
      recordingEnabled,
      rtmpUrl: `rtmp://localhost:1935/live/${req.user.streamKey}`,
      hlsUrl: `http://localhost:8000/live/${req.user.streamKey}/index.m3u8`
    });

    await stream.save();

    // Populate streamer info
    await stream.populate('streamer', 'username avatar');

    res.status(201).json({
      success: true,
      stream,
      message: 'Stream created successfully'
    });
  } catch (error) {
    console.error('Create stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get user's active stream
router.get('/user/active', auth, async (req, res) => {
  try {
    const stream = await Stream.findOne({
      streamer: req.user._id,
      isLive: true
    }).populate('streamer', 'username avatar');

    res.json({
      success: true,
      stream
    });
  } catch (error) {
    console.error('Get active stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Requires stream ownership - Update stream
router.put('/:streamId', auth, requireStreamOwner, async (req, res) => {
  try {
    const { title, description, category, chatEnabled, recordingEnabled } = req.body;
    
    // Validation
    if (title !== undefined) {
      if (!title || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Stream title cannot be empty'
        });
      }
      if (title.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Stream title must be less than 100 characters'
        });
      }
      req.stream.title = title.trim();
    }

    if (description !== undefined) {
      req.stream.description = description ? description.trim() : '';
    }

    if (category !== undefined) {
      const validCategories = ['Gaming', 'Music', 'Talk Shows', 'Sports', 'Education', 'Other'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category'
        });
      }
      req.stream.category = category;
    }

    if (chatEnabled !== undefined) {
      req.stream.chatEnabled = chatEnabled;
    }

    if (recordingEnabled !== undefined) {
      req.stream.recordingEnabled = recordingEnabled;
    }

    await req.stream.save();

    // Populate streamer info
    await req.stream.populate('streamer', 'username avatar');

    res.json({
      success: true,
      stream: req.stream,
      message: 'Stream updated successfully'
    });
  } catch (error) {
    console.error('Update stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// End stream
router.post('/:streamId/end', auth, requireStreamOwner, async (req, res) => {
  try {
    if (!req.stream.isLive) {
      return res.status(400).json({
        success: false,
        message: 'Stream is not currently live'
      });
    }

    req.stream.isLive = false;
    req.stream.endedAt = new Date();
    
    // Calculate duration
    if (req.stream.startedAt) {
      req.stream.duration = Math.floor((new Date() - req.stream.startedAt) / 1000);
    }

    await req.stream.save();

    res.json({
      success: true,
      message: 'Stream ended successfully',
      stream: req.stream
    });
  } catch (error) {
    console.error('End stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Only stream owner can delete
router.delete('/:streamId', auth, requireStreamOwner, async (req, res) => {
  try {
    // Don't allow deletion of live streams
    if (req.stream.isLive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a live stream. End the stream first.'
      });
    }

    await req.stream.deleteOne();

    res.json({
      success: true,
      message: 'Stream deleted successfully'
    });
  } catch (error) {
    console.error('Delete stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get stream analytics (stream owner only)
router.get('/:streamId/analytics', auth, requireStreamOwner, async (req, res) => {
  try {
    const analytics = {
      streamId: req.stream._id,
      title: req.stream.title,
      totalViews: req.stream.totalViews,
      currentViewers: req.stream.viewerCount,
      duration: req.stream.duration,
      startedAt: req.stream.startedAt,
      endedAt: req.stream.endedAt,
      isLive: req.stream.isLive,
      category: req.stream.category
    };

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get trending streams
router.get('/trending/all', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get streams with highest viewer count in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const trendingStreams = await Stream.find({
      $or: [
        { isLive: true },
        { endedAt: { $gte: oneDayAgo } }
      ]
    })
    .populate('streamer', 'username avatar')
    .sort({ viewerCount: -1, totalViews: -1 })
    .limit(parseInt(limit))
    .lean();

    res.json({
      success: true,
      streams: trendingStreams
    });
  } catch (error) {
    console.error('Get trending streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Search streams
router.get('/search/query', async (req, res) => {
  try {
    const { q, category, page = 1, limit = 10 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Build search filter
    const filter = {
      $and: [
        {
          $or: [
            { title: { $regex: q.trim(), $options: 'i' } },
            { description: { $regex: q.trim(), $options: 'i' } }
          ]
        }
      ]
    };

    if (category && category !== 'all') {
      filter.$and.push({ category });
    }

    const streams = await Stream.find(filter)
      .populate('streamer', 'username avatar')
      .sort({ isLive: -1, viewerCount: -1, totalViews: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Stream.countDocuments(filter);

    res.json({
      success: true,
      streams,
      query: q.trim(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Search streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;