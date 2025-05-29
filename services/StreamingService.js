const NodeMediaServer = require('node-media-server');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const Stream = require('../models/Stream');
const User = require('../models/User');

class StreamingService {
  constructor() {
    this.nms = null;
    this.activeStreams = new Map();
  }

  initialize() {
    const config = {
      rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
      },
      http: {
        port: 8000,
        allow_origin: '*'
      }
    };

    this.nms = new NodeMediaServer(config);
    this.setupEventHandlers();
    this.nms.run();
    
    console.log('🎥 RTMP Server started on port 1935');
    console.log('📺 HTTP Server started on port 8000');
  }

  setupEventHandlers() {
    // When publisher connects
    this.nms.on('preConnect', (id, args) => {
      console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
    });

    // When stream starts publishing
    this.nms.on('postPublish', async (id, StreamPath, args) => {
      console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
      
      const streamKey = StreamPath.split('/')[2];
      await this.handleStreamStart(streamKey, id);
    });

    // When stream stops publishing
    this.nms.on('donePublish', async (id, StreamPath, args) => {
      console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
      
      const streamKey = StreamPath.split('/')[2];
      await this.handleStreamEnd(streamKey);
    });
  }

  async handleStreamStart(streamKey, sessionId) {
    try {
      // Find user by stream key
      const user = await User.findOne({ streamKey });
      if (!user) {
        console.log('Invalid stream key:', streamKey);
        return;
      }

      // Find or create stream
      let stream = await Stream.findOne({ streamKey, isLive: false });
      if (!stream) {
        stream = new Stream({
          title: `${user.username}'s Live Stream`,
          streamer: user._id,
          streamKey,
          rtmpUrl: `rtmp://localhost:1935/live/${streamKey}`
        });
      }

      // Update stream status
      stream.isLive = true;
      stream.startedAt = new Date();
      stream.hlsUrl = `http://localhost:8000/live/${streamKey}/index.m3u8`;
      
      await stream.save();

      // Store active stream
      this.activeStreams.set(streamKey, {
        sessionId,
        streamId: stream._id,
        startTime: Date.now()
      });

      // Start HLS conversion
      this.startHLSConversion(streamKey);

      console.log(`✅ Stream started: ${user.username} (${streamKey})`);

    } catch (error) {
      console.error('Error handling stream start:', error);
    }
  }

  async handleStreamEnd(streamKey) {
    try {
      const streamData = this.activeStreams.get(streamKey);
      if (!streamData) return;

      // Update stream in database
      const stream = await Stream.findById(streamData.streamId);
      if (stream) {
        stream.isLive = false;
        stream.endedAt = new Date();
        stream.duration = Math.floor((Date.now() - streamData.startTime) / 1000);
        await stream.save();
      }

      // Remove from active streams
      this.activeStreams.delete(streamKey);

      // Clean up HLS files
      this.cleanupHLSFiles(streamKey);

      console.log(`❌ Stream ended: ${streamKey}`);

    } catch (error) {
      console.error('Error handling stream end:', error);
    }
  }

  startHLSConversion(streamKey) {
    const inputUrl = `rtmp://localhost:1935/live/${streamKey}`;
    const outputDir = path.join(__dirname, '../../public/hls', streamKey);
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'index.m3u8');

    ffmpeg(inputUrl)
      .inputOptions([
        '-re'
      ])
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-ac 1',
        '-strict -2',
        '-crf 18',
        '-profile:v baseline',
        '-maxrate 400k',
        '-bufsize 1835k',
        '-pix_fmt yuv420p',
        '-hls_time 6',
        '-hls_list_size 8',
        '-hls_wrap 12',
        '-start_number 1'
      ])
      .output(outputPath)
      .on('start', () => {
        console.log(`🔄 HLS conversion started for ${streamKey}`);
      })
      .on('error', (err) => {
        console.error(`❌ HLS conversion error for ${streamKey}:`, err);
      })
      .on('end', () => {
        console.log(`✅ HLS conversion ended for ${streamKey}`);
      })
      .run();
  }

  cleanupHLSFiles(streamKey) {
    const outputDir = path.join(__dirname, '../../public/hls', streamKey);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log(`🗑️ Cleaned up HLS files for ${streamKey}`);
    }
  }

  getActiveStreams() {
    return Array.from(this.activeStreams.keys());
  }
}

module.exports = new StreamingService();