/**
 * CASURECO II Queue Management System
 * Express.js Backend Server with Socket.IO
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

// Import configurations
const { pool } = require('./src/config/database');
const { initializeSocketIO } = require('./src/socket/socketHandler');

// Import routes
const authRoutes = require('./src/routes/auth');
const ticketRoutes = require('./src/routes/tickets');
const serviceRoutes = require('./src/routes/services');
const counterRoutes = require('./src/routes/counters');
const userRoutes = require('./src/routes/users');
const branchRoutes = require('./src/routes/branches');
const announcementRoutes = require('./src/routes/announcements');
const reportRoutes = require('./src/routes/reports');
const settingsRoutes = require('./src/routes/settings');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// CORS configuration - allow multiple origins
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'null' // For local HTML files
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

// Initialize Socket.IO
const io = socketIO(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/counters', counterRoutes);
app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Initialize Socket.IO handlers
initializeSocketIO(io);

// Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  CASURECO II Queue Management System - Backend Server     ║
╚════════════════════════════════════════════════════════════╝
  
  🚀 Server running on: http://${HOST}:${PORT}
  📊 Environment: ${process.env.NODE_ENV || 'development'}
  🔌 Socket.IO ready for real-time updates
  💾 Database: ${process.env.DB_NAME}@${process.env.DB_HOST}
  
  Press CTRL+C to stop
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

module.exports = { app, server, io };
