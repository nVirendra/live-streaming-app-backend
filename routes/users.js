// backend/routes/users.js
const express = require('express');
const { 
  auth, 
  requireAdmin, 
  requireOwnerOrAdmin 
} = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// User can only access their own profile or admin can access any
router.get('/:userId', auth, requireOwnerOrAdmin('userId'), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Only admins can get all users
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    
    res.json({
      success: true,
      users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// User can update their own profile or admin can update any
router.put('/:userId', auth, requireOwnerOrAdmin('userId'), async (req, res) => {
  try {
    const { username, email, avatar } = req.body;
    
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.username = username || user.username;
    user.email = email || user.email;
    user.avatar = avatar || user.avatar;

    await user.save();

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
