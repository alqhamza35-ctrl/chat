require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db, usersRef, messagesRef, groupsRef, commentsRef;
let useFirebase = false;

try {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== 'your-project-id') {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    db = admin.firestore();
    usersRef = db.collection('users');
    messagesRef = db.collection('messages');
    groupsRef = db.collection('groups');
    commentsRef = db.collection('comments');
    useFirebase = true;
    console.log('Firebase connected successfully');
  } else {
    console.log('Firebase not configured - running in demo mode with in-memory storage');
  }
} catch (err) {
  console.error('Firebase init failed, running in demo mode:', err.message);
}

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345#Super';

const memStore = {
  users: [],
  messages: [],
  groups: [],
  comments: [],
  nextId: 1,
};

function genId() { return 'mem_' + (memStore.nextId++); }

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

async function findUserByEmail(email) {
  if (useFirebase) {
    const snap = await usersRef.where('email', '==', email).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return memStore.users.find(u => u.email === email) || null;
}

async function findUserByUsername(username) {
  if (useFirebase) {
    const snap = await usersRef.where('username', '==', username).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return memStore.users.find(u => u.username === username) || null;
}

async function findUserById(id) {
  if (useFirebase) {
    const doc = await usersRef.doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }
  return memStore.users.find(u => u.id === id) || null;
}

async function getAllUsers() {
  if (useFirebase) {
    const snap = await usersRef.get();
    const users = [];
    snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
    return users;
  }
  return memStore.users;
}

async function getAllMessages() {
  if (useFirebase) {
    const snap = await messagesRef.get();
    const msgs = [];
    snap.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
    return msgs;
  }
  return memStore.messages;
}

async function getAllGroups() {
  if (useFirebase) {
    const snap = await groupsRef.get();
    const groups = [];
    snap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));
    return groups;
  }
  return memStore.groups;
}

async function getAllComments() {
  if (useFirebase) {
    const snap = await commentsRef.get();
    const comments = [];
    snap.forEach(doc => comments.push({ id: doc.id, ...doc.data() }));
    return comments;
  }
  return memStore.comments;
}

async function getMessagesByGroup(groupId) {
  if (useFirebase) {
    const snap = await messagesRef.where('groupId', '==', groupId).get();
    const msgs = [];
    snap.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
    msgs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    return msgs.slice(0, 200);
  }
  return memStore.messages
    .filter(m => m.groupId === groupId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .slice(0, 200);
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingEmail = await findUserByEmail(email);
    if (existingEmail) return res.status(400).json({ error: 'Email already exists' });

    const existingUser = await findUserByUsername(username);
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const isAdmin = password === ADMIN_PASSWORD;

    let userId;
    if (useFirebase) {
      const ref = await usersRef.add({ username, email, password: hashedPassword, isAdmin, isOnline: false, createdAt: new Date().toISOString() });
      userId = ref.id;
    } else {
      userId = genId();
      memStore.users.push({ id: userId, username, email, password: hashedPassword, isAdmin, isOnline: false, createdAt: new Date().toISOString() });
    }

    const token = jwt.sign({ id: userId, username, email, isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: userId, username, email, isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', authenticate, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users.map(u => ({ id: u.id, username: u.username, email: u.email, isAdmin: u.isAdmin, isOnline: u.isOnline })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const caller = await findUserById(req.user.id);
    if (!caller || !caller.isAdmin) return res.status(403).json({ error: 'Admin only' });
    if (useFirebase) {
      await usersRef.doc(req.params.id).delete();
    } else {
      memStore.users = memStore.users.filter(u => u.id !== req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:groupId', authenticate, async (req, res) => {
  try {
    const messages = await getMessagesByGroup(req.params.groupId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups', authenticate, async (req, res) => {
  try {
    const groups = await getAllGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    let group;
    if (useFirebase) {
      const ref = await groupsRef.add({ name, description: description || '', createdBy: req.user.username, members: [req.user.id], createdAt: new Date().toISOString() });
      group = { id: ref.id, name, description: description || '', createdBy: req.user.username, members: [req.user.id] };
    } else {
      const id = genId();
      group = { id, name, description: description || '', createdBy: req.user.username, members: [req.user.id] };
      memStore.groups.push(group);
    }
    io.emit('group-created', group);
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups/:id/join', authenticate, async (req, res) => {
  try {
    if (useFirebase) {
      const doc = await groupsRef.doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Group not found' });
      const members = doc.data().members || [];
      if (!members.includes(req.user.id)) {
        members.push(req.user.id);
        await groupsRef.doc(req.params.id).update({ members });
      }
    } else {
      const group = memStore.groups.find(g => g.id === req.params.id);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (!group.members.includes(req.user.id)) group.members.push(req.user.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/groups/:id', authenticate, async (req, res) => {
  try {
    const caller = await findUserById(req.user.id);
    if (!caller || !caller.isAdmin) return res.status(403).json({ error: 'Admin only' });
    if (useFirebase) {
      await groupsRef.doc(req.params.id).delete();
    } else {
      memStore.groups = memStore.groups.filter(g => g.id !== req.params.id);
    }
    io.emit('group-deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comments', async (req, res) => {
  try {
    const comments = await getAllComments();
    comments.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(comments.slice(0, 100));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Comment content is required' });

    let comment;
    if (useFirebase) {
      const ref = await commentsRef.add({ content, userId: req.user.id, username: req.user.username, createdAt: new Date().toISOString() });
      comment = { id: ref.id, content, userId: req.user.id, username: req.user.username };
    } else {
      const id = genId();
      comment = { id, content, userId: req.user.id, username: req.user.username, createdAt: new Date().toISOString() };
      memStore.comments.push(comment);
    }
    io.emit('new-comment', comment);
    res.json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/comments/:id', authenticate, async (req, res) => {
  try {
    const caller = await findUserById(req.user.id);
    if (!caller || !caller.isAdmin) return res.status(403).json({ error: 'Admin only' });
    if (useFirebase) {
      await commentsRef.doc(req.params.id).delete();
    } else {
      memStore.comments = memStore.comments.filter(c => c.id !== req.params.id);
    }
    io.emit('comment-deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const caller = await findUserById(req.user.id);
    if (!caller || !caller.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const [users, messages, groups, comments] = await Promise.all([
      getAllUsers(), getAllMessages(), getAllGroups(), getAllComments(),
    ]);

    res.json({ totalUsers: users.length, totalMessages: messages.length, totalGroups: groups.length, totalComments: comments.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user-online', async (userId) => {
    onlineUsers.set(socket.id, userId);
    try {
      if (useFirebase) {
        await usersRef.doc(userId).update({ isOnline: true });
      } else {
        const u = memStore.users.find(u => u.id === userId);
        if (u) u.isOnline = true;
      }
    } catch {}
    io.emit('user-status', { userId, isOnline: true });
  });

  socket.on('join-group', (groupId) => {
    socket.join(`group:${groupId}`);
  });

  socket.on('leave-group', (groupId) => {
    socket.leave(`group:${groupId}`);
  });

  socket.on('send-message', async (data) => {
    try {
      const msgData = {
        groupId: data.groupId,
        userId: data.userId,
        username: data.username,
        content: data.content || '',
        voiceData: data.voiceData || null,
        messageType: data.voiceData ? 'voice' : 'text',
        createdAt: new Date().toISOString(),
      };

      let msgId;
      if (useFirebase) {
        const ref = await messagesRef.add(msgData);
        msgId = ref.id;
      } else {
        msgId = genId();
        memStore.messages.push({ id: msgId, ...msgData });
      }

      const message = { id: msgId, groupId: msgData.groupId, userId: msgData.userId, username: msgData.username, content: msgData.content, voiceData: msgData.voiceData, messageType: msgData.messageType, createdAt: msgData.createdAt };
      io.to(`group:${data.groupId}`).emit('new-message', message);
    } catch (err) {
      console.error('Send message error:', err);
    }
  });

  socket.on('typing', (data) => {
    socket.to(`group:${data.groupId}`).emit('user-typing', { username: data.username, groupId: data.groupId });
  });

  socket.on('stop-typing', (data) => {
    socket.to(`group:${data.groupId}`).emit('user-stop-typing', { username: data.username, groupId: data.groupId });
  });

  socket.on('disconnect', async () => {
    const userId = onlineUsers.get(socket.id);
    if (userId) {
      try {
        if (useFirebase) {
          await usersRef.doc(userId).update({ isOnline: false });
        } else {
          const u = memStore.users.find(u => u.id === userId);
          if (u) u.isOnline = false;
        }
      } catch {}
      io.emit('user-status', { userId, isOnline: false });
      onlineUsers.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(useFirebase ? 'Storage: Firebase Firestore' : 'Storage: In-Memory (demo mode)');
});
