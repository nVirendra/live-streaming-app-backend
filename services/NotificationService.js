// backend/services/NotificationService.js

const User = require('../models/User');
const Stream = require('../models/Stream');

class NotificationService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // socketId -> user info
    this.streamRooms = new Map(); // streamId -> Set of socketIds
    this.notificationQueue = new Map(); // userId -> Array of notifications
  }

  /**
   * Initialize the notification service with Socket.IO instance
   */
  initialize(io) {
    this.io = io;
    this.setupSocketHandlers();
    console.log('📢 NotificationService initialized');
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Socket connected: ${socket.id}`);

      // Handle user authentication
      socket.on('authenticate', async (data) => {
        try {
          const { userId, username, token } = data;
          
          // Store user info
          this.userSockets.set(socket.id, {
            userId,
            username,
            socketId: socket.id,
            connectedAt: new Date()
          });
          
          this.connectedUsers.set(userId, socket.id);

          // Join user's personal room
          socket.join(`user_${userId}`);

          // Update user online status
          await User.findByIdAndUpdate(userId, {
            isOnline: true,
            lastSeen: new Date()
          });

          // Send pending notifications
          await this.sendPendingNotifications(userId);

          socket.emit('authenticated', {
            success: true,
            message: 'Successfully authenticated'
          });

          // Notify followers that user came online
          await this.notifyFollowersUserOnline(userId, username);

          console.log(`User authenticated: ${username} (${userId})`);

        } catch (error) {
          console.error('Authentication error:', error);
          socket.emit('authentication_error', {
            success: false,
            message: 'Authentication failed'
          });
        }
      });

      // Handle joining stream rooms
      socket.on('join-stream', async (streamId) => {
        try {
          const userInfo = this.userSockets.get(socket.id);
          
          if (!userInfo) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
          }

          // Join stream room
          socket.join(`stream_${streamId}`);
          
          // Track stream room membership
          if (!this.streamRooms.has(streamId)) {
            this.streamRooms.set(streamId, new Set());
          }
          this.streamRooms.get(streamId).add(socket.id);

          // Update viewer count
          const viewerCount = this.streamRooms.get(streamId).size;
          await this.updateStreamViewerCount(streamId, viewerCount);

          // Notify other viewers
          socket.to(`stream_${streamId}`).emit('viewer-joined', {
            username: userInfo.username,
            viewerCount
          });

          socket.emit('stream-joined', {
            streamId,
            viewerCount,
            message: 'Successfully joined stream'
          });

          console.log(`${userInfo.username} joined stream ${streamId}`);

        } catch (error) {
          console.error('Join stream error:', error);
          socket.emit('error', { message: 'Failed to join stream' });
        }
      });

      // Handle leaving stream rooms
      socket.on('leave-stream', async (streamId) => {
        try {
          const userInfo = this.userSockets.get(socket.id);
          
          if (!userInfo) return;

          // Leave stream room
          socket.leave(`stream_${streamId}`);
          
          // Remove from stream room tracking
          if (this.streamRooms.has(streamId)) {
            this.streamRooms.get(streamId).delete(socket.id);
            
            // Update viewer count
            const viewerCount = this.streamRooms.get(streamId).size;
            await this.updateStreamViewerCount(streamId, viewerCount);

            // Notify other viewers
            socket.to(`stream_${streamId}`).emit('viewer-left', {
              username: userInfo.username,
              viewerCount
            });
          }

          console.log(`${userInfo.username} left stream ${streamId}`);

        } catch (error) {
          console.error('Leave stream error:', error);
        }
      });

      // Handle chat messages
      socket.on('chat-message', async (data) => {
        try {
          const userInfo = this.userSockets.get(socket.id);
          
          if (!userInfo) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
          }

          const { streamId, message } = data;

          // Validate message
          if (!message || message.trim().length === 0) {
            socket.emit('error', { message: 'Message cannot be empty' });
            return;
          }

          if (message.length > 500) {
            socket.emit('error', { message: 'Message too long' });
            return;
          }

          // Check if user is banned from chat
          const user = await User.findById(userInfo.userId);
          if (user.isChatBanned) {
            socket.emit('error', { message: 'You are banned from chat' });
            return;
          }

          // Create message object
          const chatMessage = {
            id: Date.now(),
            streamId,
            userId: userInfo.userId,
            username: userInfo.username,
            message: message.trim(),
            timestamp: new Date(),
            avatar: user.avatar
          };

          // Save chat message to database (optional)
          await this.saveChatMessage(chatMessage);

          // Broadcast to all users in stream room
          this.io.to(`stream_${streamId}`).emit('new-message', chatMessage);

          // Notify stream owner if mentioned
          if (message.includes('@streamer')) {
            await this.notifyStreamerMention(streamId, chatMessage);
          }

        } catch (error) {
          console.error('Chat message error:', error);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle typing indicators
      socket.on('typing-start', (data) => {
        const userInfo = this.userSockets.get(socket.id);
        if (userInfo && data.streamId) {
          socket.to(`stream_${data.streamId}`).emit('user-typing', {
            username: userInfo.username,
            userId: userInfo.userId
          });
        }
      });

      socket.on('typing-stop', (data) => {
        const userInfo = this.userSockets.get(socket.id);
        if (userInfo && data.streamId) {
          socket.to(`stream_${data.streamId}`).emit('user-stopped-typing', {
            username: userInfo.username,
            userId: userInfo.userId
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', async () => {
        try {
          const userInfo = this.userSockets.get(socket.id);
          
          if (userInfo) {
            // Remove from tracking
            this.connectedUsers.delete(userInfo.userId);
            this.userSockets.delete(socket.id);

            // Remove from all stream rooms
            for (const [streamId, socketSet] of this.streamRooms.entries()) {
              if (socketSet.has(socket.id)) {
                socketSet.delete(socket.id);
                
                // Update viewer count
                const viewerCount = socketSet.size;
                await this.updateStreamViewerCount(streamId, viewerCount);

                // Notify other viewers
                socket.to(`stream_${streamId}`).emit('viewer-left', {
                  username: userInfo.username,
                  viewerCount
                });
              }
            }

            // Update user offline status (with delay to handle reconnections)
            setTimeout(async () => {
              if (!this.connectedUsers.has(userInfo.userId)) {
                await User.findByIdAndUpdate(userInfo.userId, {
                  isOnline: false,
                  lastSeen: new Date()
                });

                // Notify followers that user went offline
                await this.notifyFollowersUserOffline(userInfo.userId, userInfo.username);
              }
            }, 30000); // 30 second delay

            console.log(`User disconnected: ${userInfo.username}`);
          }

        } catch (error) {
          console.error('Disconnect error:', error);
        }
      });
    });
  }

  /**
   * Send notification to specific user
   */
  async sendNotificationToUser(userId, notification) {
    try {
      const socketId = this.connectedUsers.get(userId);
      
      if (socketId) {
        // User is online, send immediately
        this.io.to(`user_${userId}`).emit('notification', notification);
      } else {
        // User is offline, queue notification
        if (!this.notificationQueue.has(userId)) {
          this.notificationQueue.set(userId, []);
        }
        this.notificationQueue.get(userId).push(notification);
      }

      console.log(`Notification sent to user ${userId}:`, notification.type);

    } catch (error) {
      console.error('Send notification error:', error);
    }
  }

  /**
   * Send pending notifications to user when they come online
   */
  async sendPendingNotifications(userId) {
    try {
      const pendingNotifications = this.notificationQueue.get(userId);
      
      if (pendingNotifications && pendingNotifications.length > 0) {
        // Send all pending notifications
        for (const notification of pendingNotifications) {
          this.io.to(`user_${userId}`).emit('notification', notification);
        }

        // Clear the queue
        this.notificationQueue.delete(userId);

        console.log(`Sent ${pendingNotifications.length} pending notifications to user ${userId}`);
      }

    } catch (error) {
      console.error('Send pending notifications error:', error);
    }
  }

  /**
   * Notify when someone starts streaming
   */
  async notifyStreamStarted(streamId, streamerId, streamTitle) {
    try {
      const streamer = await User.findById(streamerId).populate('followers');
      
      if (!streamer) return;

      const notification = {
        type: 'stream_started',
        title: 'Stream Started',
        message: `${streamer.username} is now live: ${streamTitle}`,
        data: {
          streamId,
          streamerId,
          streamerUsername: streamer.username,
          streamTitle,
          streamerAvatar: streamer.avatar
        },
        timestamp: new Date()
      };

      // Notify all followers
      for (const followerId of streamer.followers) {
        await this.sendNotificationToUser(followerId.toString(), notification);
      }

      // Broadcast to general "live streams" room
      this.io.emit('new-live-stream', {
        streamId,
        title: streamTitle,
        streamer: {
          id: streamerId,
          username: streamer.username,
          avatar: streamer.avatar
        }
      });

      console.log(`Notified ${streamer.followers.length} followers about stream: ${streamTitle}`);

    } catch (error) {
      console.error('Notify stream started error:', error);
    }
  }

  /**
   * Notify when stream ends
   */
  async notifyStreamEnded(streamId, streamerId, streamTitle, duration) {
    try {
      const notification = {
        type: 'stream_ended',
        title: 'Stream Ended',
        message: `Stream "${streamTitle}" has ended after ${this.formatDuration(duration)}`,
        data: {
          streamId,
          streamerId,
          streamTitle,
          duration
        },
        timestamp: new Date()
      };

      // Notify all viewers in the stream room
      this.io.to(`stream_${streamId}`).emit('stream-ended', notification);

      console.log(`Notified viewers about stream end: ${streamTitle}`);

    } catch (error) {
      console.error('Notify stream ended error:', error);
    }
  }

  /**
   * Notify when someone follows a user
   */
  async notifyNewFollower(streamerId, followerId, followerUsername) {
    try {
      const notification = {
        type: 'new_follower',
        title: 'New Follower',
        message: `${followerUsername} started following you`,
        data: {
          followerId,
          followerUsername
        },
        timestamp: new Date()
      };

      await this.sendNotificationToUser(streamerId, notification);

    } catch (error) {
      console.error('Notify new follower error:', error);
    }
  }

  /**
   * Notify followers when user comes online
   */
  async notifyFollowersUserOnline(userId, username) {
    try {
      const user = await User.findById(userId).populate('followers');
      
      if (!user || !user.followers.length) return;

      const notification = {
        type: 'user_online',
        title: 'User Online',
        message: `${username} is now online`,
        data: {
          userId,
          username
        },
        timestamp: new Date()
      };

      // Only notify if user is a streamer
      if (user.isStreamer) {
        for (const followerId of user.followers) {
          await this.sendNotificationToUser(followerId.toString(), notification);
        }
      }

    } catch (error) {
      console.error('Notify followers user online error:', error);
    }
  }

  /**
   * Notify followers when user goes offline
   */
  async notifyFollowersUserOffline(userId, username) {
    try {
      // Only send offline notifications for streamers
      const user = await User.findById(userId);
      if (!user || !user.isStreamer) return;

      const notification = {
        type: 'user_offline',
        title: 'User Offline',
        message: `${username} is now offline`,
        data: {
          userId,
          username
        },
        timestamp: new Date()
      };

      // Don't spam with offline notifications - only send to users who are currently online
      const onlineFollowers = Array.from(this.connectedUsers.keys());
      
      for (const followerId of onlineFollowers) {
        await this.sendNotificationToUser(followerId, notification);
      }

    } catch (error) {
      console.error('Notify followers user offline error:', error);
    }
  }

  /**
   * Notify streamer when mentioned in chat
   */
  async notifyStreamerMention(streamId, chatMessage) {
    try {
      const stream = await Stream.findById(streamId);
      if (!stream) return;

      const notification = {
        type: 'chat_mention',
        title: 'Chat Mention',
        message: `${chatMessage.username} mentioned you in chat: "${chatMessage.message}"`,
        data: {
          streamId,
          chatMessage
        },
        timestamp: new Date()
      };

      await this.sendNotificationToUser(stream.streamer.toString(), notification);

    } catch (error) {
      console.error('Notify streamer mention error:', error);
    }
  }

  /**
   * Update stream viewer count in database
   */
  async updateStreamViewerCount(streamId, viewerCount) {
    try {
      await Stream.findByIdAndUpdate(streamId, {
        viewerCount,
        lastViewerUpdate: new Date()
      });

      // Broadcast viewer count update to stream room
      this.io.to(`stream_${streamId}`).emit('viewer-count-update', {
        streamId,
        viewerCount
      });

    } catch (error) {
      console.error('Update viewer count error:', error);
    }
  }

  /**
   * Save chat message to database (optional)
   */
  async saveChatMessage(chatMessage) {
    try {
      // You can implement chat message persistence here
      // const ChatMessage = require('../models/ChatMessage');
      // await ChatMessage.create(chatMessage);
      
      console.log('Chat message saved:', chatMessage.message);

    } catch (error) {
      console.error('Save chat message error:', error);
    }
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount() {
    return this.connectedUsers.size;
  }

  /**
   * Get active streams count
   */
  getActiveStreamsCount() {
    return this.streamRooms.size;
  }

  /**
   * Get users in specific stream
   */
  getStreamViewers(streamId) {
    const socketIds = this.streamRooms.get(streamId);
    if (!socketIds) return [];

    const viewers = [];
    for (const socketId of socketIds) {
      const userInfo = this.userSockets.get(socketId);
      if (userInfo) {
        viewers.push({
          userId: userInfo.userId,
          username: userInfo.username
        });
      }
    }

    return viewers;
  }

  /**
   * Format duration in human readable format
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Send system announcement to all connected users
   */
  async sendSystemAnnouncement(message, type = 'info') {
    const announcement = {
      type: 'system_announcement',
      title: 'System Announcement',
      message,
      data: { type },
      timestamp: new Date()
    };

    this.io.emit('system-announcement', announcement);
    console.log('System announcement sent:', message);
  }

  /**
   * Ban user from all chats
   */
  async banUserFromChat(userId, reason) {
    try {
      await User.findByIdAndUpdate(userId, {
        isChatBanned: true,
        chatBanReason: reason,
        chatBanDate: new Date()
      });

      // Disconnect user from all streams
      const socketId = this.connectedUsers.get(userId);
      if (socketId) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('chat-banned', {
            reason,
            timestamp: new Date()
          });
        }
      }

      console.log(`User ${userId} banned from chat: ${reason}`);

    } catch (error) {
      console.error('Ban user from chat error:', error);
    }
  }
}

module.exports = new NotificationService();