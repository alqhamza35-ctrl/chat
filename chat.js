const API = '';

function getToken() { return localStorage.getItem('token'); }
function getUser() { const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null; }

const token = getToken();
const currentUser = getUser();

if (!token || !currentUser) { location.href = '/'; }

const socket = io();
let currentGroupId = null;
let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let recordingInterval = null;
let recordingSeconds = 0;
let typingTimeout = null;

document.getElementById('currentUsername').textContent = currentUser.username;
document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();

if (currentUser.isAdmin) {
  document.getElementById('navAdmin').style.display = 'block';
  document.getElementById('currentRole').textContent = 'أدمن';
  document.getElementById('currentRole').style.display = 'inline-block';
} else {
  document.getElementById('currentRole').style.display = 'none';
}

socket.emit('user-online', currentUser.id);

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  location.href = '/';
});

document.getElementById('toggleSidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('mobileMenu').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + 'Panel').classList.add('active');
    if (btn.dataset.tab === 'admin') loadAdminPanel();
    if (btn.dataset.tab === 'comments') loadComments();
  });
});

async function apiFetch(url, opts = {}) {
  const res = await fetch(`${API}${url}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (res.status === 401) { localStorage.clear(); location.href = '/'; return; }
  return res.json();
}

async function loadGroups() {
  const groups = await apiFetch('/api/groups');
  const list = document.getElementById('groupsList');
  list.innerHTML = '';
  if (!groups || groups.length === 0) {
    list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-muted)">لا توجد مجموعات بعد</p>';
    return;
  }
  groups.forEach(g => {
    const div = document.createElement('div');
    div.className = 'group-item' + (currentGroupId === g.id ? ' active' : '');
    div.innerHTML = `
      <div class="group-icon">📋</div>
      <div class="group-info">
        <div class="group-name">${esc(g.name)}</div>
        <div class="group-desc">${esc(g.description || 'مجموعة دردشة')}</div>
      </div>
      <div class="group-actions">
        <button class="btn-icon join-btn" title="انضم">➕</button>
        ${currentUser.isAdmin ? `<button class="btn-icon delete-group-btn" title="حذف">🗑</button>` : ''}
      </div>
    `;
    div.querySelector('.group-icon, .group-name, .group-desc').addEventListener('click', () => joinGroupChat(g.id, g.name));
    div.querySelector('.join-btn').addEventListener('click', (e) => { e.stopPropagation(); joinGroup(g.id); });
    const delBtn = div.querySelector('.delete-group-btn');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteGroup(g.id); });
    list.appendChild(div);
  });
}

async function joinGroup(groupId) {
  await apiFetch(`/api/groups/${groupId}/join`, { method: 'POST' });
}

async function deleteGroup(groupId) {
  if (!confirm('هل أنت متأكد من حذف هذه المجموعة؟')) return;
  await apiFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
  if (currentGroupId === groupId) {
    currentGroupId = null;
    document.getElementById('chatMessages').innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">💬</div>
        <h2>مرحباً بك في الدردشة الفورية</h2>
        <p>اختر مجموعة من القائمة الجانبية للبدء في المحادثة</p>
      </div>`;
    document.getElementById('chatInputArea').style.display = 'none';
    document.getElementById('chatTitle').textContent = 'اختر مجموعة للبدء';
    document.getElementById('chatSubtitle').textContent = '';
  }
  loadGroups();
}

async function joinGroupChat(groupId, groupName) {
  if (currentGroupId) socket.emit('leave-group', currentGroupId);
  currentGroupId = groupId;
  socket.emit('join-group', groupId);
  document.getElementById('chatTitle').textContent = groupName;
  document.getElementById('chatInputArea').style.display = 'block';
  document.getElementById('welcomeScreen')?.remove();

  document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.group-item');
  items.forEach(item => {
    if (item.querySelector('.group-name')?.textContent === groupName) item.classList.add('active');
  });

  await loadMessages(groupId);
  document.getElementById('sidebar').classList.remove('open');
}

async function loadMessages(groupId) {
  const messages = await apiFetch(`/api/messages/${groupId}`);
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  if (!messages || messages.length === 0) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted)">لا توجد رسائل بعد. ابدأ المحادثة!</p>';
    return;
  }
  messages.forEach(msg => appendMessage(msg));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg) {
  const container = document.getElementById('chatMessages');
  const emptyMsg = container.querySelector('p');
  if (emptyMsg && emptyMsg.textContent.includes('لا توجد رسائل')) emptyMsg.remove();

  const isSelf = msg.userId === currentUser.id;
  const div = document.createElement('div');
  div.className = `message ${isSelf ? 'self' : 'other'}`;

  let content = '';
  if (msg.messageType === 'voice' && msg.voiceData) {
    content = `<div class="message-voice"><audio controls src="${msg.voiceData}"></audio></div>`;
  } else {
    content = `<div class="message-bubble">${esc(msg.content || '')}</div>`;
  }

  const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }) : '';

  div.innerHTML = `
    ${!isSelf ? `<span class="message-sender">${esc(msg.username)}</span>` : ''}
    ${content}
    <span class="message-time">${time}</span>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
  else {
    socket.emit('typing', { groupId: currentGroupId, username: currentUser.username });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('stop-typing', { groupId: currentGroupId, username: currentUser.username });
    }, 1500);
  }
});

function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content || !currentGroupId) return;
  socket.emit('send-message', {
    groupId: currentGroupId,
    userId: currentUser.id,
    username: currentUser.username,
    content,
  });
  input.value = '';
  socket.emit('stop-typing', { groupId: currentGroupId, username: currentUser.username });
}

socket.on('new-message', (msg) => {
  if (msg.groupId === currentGroupId) appendMessage(msg);
});

socket.on('user-typing', (data) => {
  if (data.groupId === currentGroupId) {
    document.getElementById('chatSubtitle').textContent = `${data.username} يكتب...`;
  }
});

socket.on('user-stop-typing', (data) => {
  if (data.groupId === currentGroupId) {
    document.getElementById('chatSubtitle').textContent = '';
  }
});

socket.on('user-status', (data) => {
  const statusEls = document.querySelectorAll(`[data-user-id="${data.userId}"] .admin-user-status`);
  statusEls.forEach(el => {
    el.className = 'admin-user-status' + (data.isOnline ? ' online' : '');
  });
});

socket.on('group-created', () => loadGroups());
socket.on('group-deleted', (data) => {
  if (data.id === currentGroupId) {
    currentGroupId = null;
    document.getElementById('chatInputArea').style.display = 'none';
  }
  loadGroups();
});

socket.on('new-comment', () => loadComments());
socket.on('comment-deleted', () => loadComments());

document.getElementById('createGroupBtn').addEventListener('click', () => {
  document.getElementById('groupModal').style.display = 'flex';
});
document.getElementById('closeGroupModal').addEventListener('click', () => {
  document.getElementById('groupModal').style.display = 'none';
});
document.getElementById('groupModal').addEventListener('click', (e) => {
  if (e.target.id === 'groupModal') document.getElementById('groupModal').style.display = 'none';
});

document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('groupName').value.trim();
  const desc = document.getElementById('groupDesc').value.trim();
  if (!name) return;
  await apiFetch('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, description: desc }),
  });
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  document.getElementById('groupModal').style.display = 'none';
  loadGroups();
});

const voiceBtn = document.getElementById('voiceBtn');
const voiceRecorder = document.getElementById('voiceRecorder');
const inputRow = document.getElementById('inputRow');
const voicePreview = document.getElementById('voicePreview');
const recordingTimeEl = document.getElementById('recordingTime');

voiceBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(recordedBlob);
      document.getElementById('voicePlayback').src = url;
      voiceRecorder.style.display = 'none';
      voicePreview.style.display = 'flex';
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    voiceRecorder.style.display = 'flex';
    inputRow.style.display = 'none';
    recordingSeconds = 0;
    recordingTimeEl.textContent = '00:00';
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const s = String(recordingSeconds % 60).padStart(2, '0');
      recordingTimeEl.textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    alert('لا يمكن الوصول إلى الميكروفون');
  }
});

document.getElementById('stopRecordingBtn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  clearInterval(recordingInterval);
});

document.getElementById('cancelRecordingBtn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  clearInterval(recordingInterval);
  voiceRecorder.style.display = 'none';
  inputRow.style.display = 'flex';
  recordedBlob = null;
});

document.getElementById('sendVoiceBtn').addEventListener('click', async () => {
  if (!recordedBlob || !currentGroupId) return;
  const reader = new FileReader();
  reader.onload = () => {
    socket.emit('send-message', {
      groupId: currentGroupId,
      userId: currentUser.id,
      username: currentUser.username,
      voiceData: reader.result,
      content: '',
    });
    voicePreview.style.display = 'none';
    inputRow.style.display = 'flex';
    recordedBlob = null;
  };
  reader.readAsDataURL(recordedBlob);
});

document.getElementById('cancelVoiceBtn').addEventListener('click', () => {
  voicePreview.style.display = 'none';
  inputRow.style.display = 'flex';
  recordedBlob = null;
});

document.getElementById('sendCommentBtn').addEventListener('click', sendComment);
document.getElementById('commentInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendComment();
});

async function sendComment() {
  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content) return;
  await apiFetch('/api/comments', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  input.value = '';
}

async function loadComments() {
  const comments = await apiFetch('/api/comments');
  const list = document.getElementById('commentsList');
  list.innerHTML = '';
  if (!comments || comments.length === 0) {
    list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-muted)">لا توجد تعليقات بعد</p>';
    return;
  }
  comments.forEach(c => {
    const div = document.createElement('div');
    div.className = 'comment-item';
    const time = c.createdAt ? new Date(c.createdAt).toLocaleString('ar') : '';
    div.innerHTML = `
      <div class="comment-header">
        <span class="comment-username">${esc(c.username)}</span>
        <span class="comment-time">${time}</span>
      </div>
      <div class="comment-text">${esc(c.content)}</div>
      ${currentUser.isAdmin ? `<button class="comment-delete" data-id="${c.id}">🗑 حذف</button>` : ''}
    `;
    const delBtn = div.querySelector('.comment-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        await apiFetch(`/api/comments/${c.id}`, { method: 'DELETE' });
      });
    }
    list.appendChild(div);
  });
}

async function loadAdminPanel() {
  const stats = await apiFetch('/api/stats');
  const statsEl = document.getElementById('adminStats');
  if (stats) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-number">${stats.totalUsers}</div><div class="stat-label">المستخدمون</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalMessages}</div><div class="stat-label">الرسائل</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalGroups}</div><div class="stat-label">المجموعات</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalComments}</div><div class="stat-label">التعليقات</div></div>
    `;
  }

  const users = await apiFetch('/api/users');
  const usersList = document.getElementById('adminUsersList');
  usersList.innerHTML = '';
  if (!users) return;
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'admin-user-item';
    div.setAttribute('data-user-id', u.id);
    div.innerHTML = `
      <div class="admin-user-info">
        <div class="admin-user-status${u.isOnline ? ' online' : ''}"></div>
        <span>${esc(u.username)} ${u.isAdmin ? '(أدمن)' : ''}</span>
      </div>
      ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm delete-user-btn" data-id="${u.id}">حذف</button>` : ''}
    `;
    const delBtn = div.querySelector('.delete-user-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
        await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
        loadAdminPanel();
      });
    }
    usersList.appendChild(div);
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

loadGroups();
loadComments();
