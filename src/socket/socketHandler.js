/**
 * Socket.IO Event Handlers
 * Real-time communication for queue updates
 */

const jwt = require('jsonwebtoken');

// Store connected clients by branch
const connectedClients = new Map();

/**
 * Initialize Socket.IO with event handlers
 */
function initializeSocketIO(io) {
  // Authentication middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    // Allow public connections (display, kiosk) without token
    if (!token) {
      socket.isPublic = true;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      socket.isPublic = false;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id} (${socket.isPublic ? 'Public' : socket.user?.email})`);

    // Join branch room
    socket.on('join:branch', (branchId) => {
      socket.join(`branch:${branchId}`);
      console.log(`📍 Socket ${socket.id} joined branch: ${branchId}`);
      
      // Track connection
      if (!connectedClients.has(branchId)) {
        connectedClients.set(branchId, new Set());
      }
      connectedClients.get(branchId).add(socket.id);
    });

    // Join counter room (for staff)
    socket.on('join:counter', (counterId) => {
      socket.join(`counter:${counterId}`);
      console.log(`🎯 Socket ${socket.id} joined counter: ${counterId}`);
    });

    // Leave branch room
    socket.on('leave:branch', (branchId) => {
      socket.leave(`branch:${branchId}`);
      console.log(`📍 Socket ${socket.id} left branch: ${branchId}`);
      
      // Remove from tracking
      if (connectedClients.has(branchId)) {
        connectedClients.get(branchId).delete(socket.id);
      }
    });

    // Heartbeat for connection monitoring
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      
      // Clean up tracking
      connectedClients.forEach((clients, branchId) => {
        clients.delete(socket.id);
        if (clients.size === 0) {
          connectedClients.delete(branchId);
        }
      });
    });
  });

  console.log('✅ Socket.IO initialized');
}

/**
 * Emit ticket created event
 */
function emitTicketCreated(io, ticket) {
  io.to(`branch:${ticket.branch_id}`).emit('ticket:created', ticket);
  console.log(`📤 Emitted ticket:created for ${ticket.ticket_number}`);
}

/**
 * Emit ticket updated event
 */
function emitTicketUpdated(io, ticket) {
  io.to(`branch:${ticket.branch_id}`).emit('ticket:updated', ticket);
  console.log(`📤 Emitted ticket:updated for ${ticket.ticket_number} (${ticket.status})`);
}

/**
 * Emit ticket called event (for announcements)
 */
function emitTicketCalled(io, ticket) {
  io.to(`branch:${ticket.branch_id}`).emit('ticket:called', {
    ticket_number: ticket.ticket_number,
    counter_name: ticket.counter_name,
    timestamp: new Date().toISOString()
  });
  console.log(`📢 Emitted ticket:called for ${ticket.ticket_number}`);
}

/**
 * Emit ticket deleted event
 */
function emitTicketDeleted(io, ticketId, branchId) {
  io.to(`branch:${branchId}`).emit('ticket:deleted', { id: ticketId });
  console.log(`📤 Emitted ticket:deleted for ${ticketId}`);
}

/**
 * Emit counter updated event
 */
function emitCounterUpdated(io, counter) {
  io.to(`branch:${counter.branch_id}`).emit('counter:updated', counter);
  console.log(`📤 Emitted counter:updated for ${counter.name}`);
}

/**
 * Emit announcement created event
 */
function emitAnnouncementCreated(io, announcement) {
  // Emit to specific branch
  if (announcement.branch_id) {
    io.to(`branch:${announcement.branch_id}`).emit('announcement:new', announcement);
    console.log(`📤 Emitted announcement:new to branch ${announcement.branch_id}`);
  } else {
    // Global announcement - emit to all connected clients
    io.emit('announcement:new', announcement);
    console.log(`📤 Emitted announcement:new (global)`);
  }
}

/**
 * Emit announcement updated event
 */
function emitAnnouncementUpdated(io, announcement) {
  // Emit to specific branch
  if (announcement.branch_id) {
    io.to(`branch:${announcement.branch_id}`).emit('announcement:updated', announcement);
    console.log(`📤 Emitted announcement:updated to branch ${announcement.branch_id}`);
  } else {
    // Global announcement - emit to all connected clients
    io.emit('announcement:updated', announcement);
    console.log(`📤 Emitted announcement:updated (global)`);
  }
}

/**
 * Emit announcement deleted event
 */
function emitAnnouncementDeleted(io, announcementId, branchId) {
  // Emit to specific branch or globally
  if (branchId) {
    io.to(`branch:${branchId}`).emit('announcement:deleted', announcementId);
    console.log(`📤 Emitted announcement:deleted to branch ${branchId}`);
  } else {
    io.emit('announcement:deleted', announcementId);
    console.log(`📤 Emitted announcement:deleted (global)`);
  }
}

/**
 * @deprecated Use emitAnnouncementCreated instead
 */
function emitAnnouncement(io, announcement) {
  emitAnnouncementCreated(io, announcement);
}

/**
 * Emit transfer notification
 */
function emitTransferNotification(io, transfer) {
  // Notify target counter
  io.to(`counter:${transfer.target_counter_id}`).emit('transfer:incoming', transfer);
  console.log(`📤 Emitted transfer:incoming to counter ${transfer.target_counter_id}`);
}

/**
 * Get connected clients count for a branch
 */
function getConnectedClientsCount(branchId) {
  return connectedClients.get(branchId)?.size || 0;
}

module.exports = {
  initializeSocketIO,
  emitTicketCreated,
  emitTicketUpdated,
  emitTicketCalled,
  emitTicketDeleted,
  emitCounterUpdated,
  emitAnnouncement, // Deprecated - use emitAnnouncementCreated
  emitAnnouncementCreated,
  emitAnnouncementUpdated,
  emitAnnouncementDeleted,
  emitTransferNotification,
  getConnectedClientsCount
};
