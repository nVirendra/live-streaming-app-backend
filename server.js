const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
require('dotenv').config();

// Import configurations
const connectDB = require('./config/database');
//const connectRedis = require('./config/redis');

// Import routes
const authRoutes = require('./routes/auth');
const streamRoutes = require('./routes/streams');
const userRoutes = require('./routes/users');
const rtmpRoutes = require('./routes/rtmp');
const analyticsRoutes = require('./routes/analytics');

// Import services
const StreamingService = require('./services/StreamingService');
const NotificationService = require('./services/NotificationService');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Database connections
connectDB();
//connectRedis();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rtmp', rtmpRoutes);
app.use('/api/analytics', analyticsRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join stream room
  socket.on('join-stream', (streamId) => {
    socket.join(`stream-${streamId}`);
    console.log(`Socket ${socket.id} joined stream ${streamId}`);
  });
  
  // Handle chat messages
  socket.on('chat-message', (data) => {
    socket.to(`stream-${data.streamId}`).emit('new-message', data);
  });
  
  // Handle viewer count updates
  socket.on('viewer-joined', (streamId) => {
    socket.to(`stream-${streamId}`).emit('viewer-count-update');
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start streaming services
StreamingService.initialize();
NotificationService.initialize(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = { app, io };