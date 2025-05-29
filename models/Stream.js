const mongoose = require('mongoose');

const StreamSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  streamer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  streamKey: {
    type: String,
    required: true,
    unique: true
  },
  isLive: {
    type: Boolean,
    default: false
  },
  category: {
    type: String,
    enum: ['Gaming', 'Music', 'Talk Shows', 'Sports', 'Education', 'Other'],
    default: 'Other'
  },
  thumbnail: {
    type: String,
    default: ''
  },
  viewerCount: {
    type: Number,
    default: 0
  },
  totalViews: {
    type: Number,
    default: 0
  },
  duration: {
    type: Number, // duration in seconds
    default: 0
  },
  startedAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  rtmpUrl: {
    type: String
  },
  hlsUrl: {
    type: String
  },
  quality: [{
    resolution: String, // '720p', '480p', '360p'
    bitrate: Number,
    url: String
  }],
  chatEnabled: {
    type: Boolean,
    default: true
  },
  recordingEnabled: {
    type: Boolean,
    default: false
  },
  recordingUrl: {
    type: String
  }
}, {
  timestamps: true
});

// Index for better query performance
StreamSchema.index({ isLive: -1, createdAt: -1 });
StreamSchema.index({ streamer: 1, createdAt: -1 });

module.exports = mongoose.model('Stream', StreamSchema);