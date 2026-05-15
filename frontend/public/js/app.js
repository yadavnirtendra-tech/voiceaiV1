// VoiceForge AI - Dashboard Logic
const API_URL = '/api/voice';
const HEALTH_URL = '/api/health';

// State
let agents = [];
let calls = [];
let activeSection = 'dashboard';
let currentWS = null;
let audioContext = null;
let microphoneStream = null;
let scriptProcessor = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    init();
    
    // Auto-refresh stats and health
    setInterval(updateStats, 10000);
    setInterval(checkHealth, 30000);
});

async function init() {
    await updateStats();
    await checkHealth();
    await loadAgents();
    await loadCalls();
    await loadPhoneNumbers();
    
    // Replace icons
    if (window.feather) feather.replace();
}

// ============================================
// NAVIGATION
// ============================================

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('main > section').forEach(s => s.style.display = 'none');
    // Show target
    const target = document.getElementById(`${sectionId}-section`);
    if (target) {
        target.style.display = 'block';
        target.classList.add('fade-in');
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`a[onclick="showSection('${sectionId}')"]`)?.classList.add('active');

    activeSection = sectionId;
    
    // Refresh content
    if (sectionId === 'agents') loadAgents();
    if (sectionId === 'calls') loadCalls();
    if (sectionId === 'numbers') loadPhoneNumbers();
}

// ============================================
// API DATA FETCHING
// ============================================

async function updateStats() {
    try {
        const res = await fetch(`${API_URL}/analytics`);
        const data = await res.json();
        
        document.getElementById('stat-minutes').textContent = data.totalMinutes || 0;
        document.getElementById('stat-calls').textContent = data.totalCalls || 0;
        document.getElementById('stat-latency').textContent = `${data.avgLatencyMs || 0}ms`;
        document.getElementById('stat-cost').textContent = `$${(data.costUsd || 0).toFixed(2)}`;
        
        document.getElementById('active-calls-count').textContent = `${data.activeCalls || 0} Live`;
    } catch (err) {
        console.error('Failed to update stats', err);
    }
}

async function checkHealth() {
    try {
        const res = await fetch(HEALTH_URL);
        const data = await res.json();
        
        const statusIndicator = document.getElementById('system-status-indicator');
        const dot = statusIndicator.querySelector('span:first-child');
        const text = statusIndicator.querySelector('span:last-child');
        
        if (data.status === 'healthy') {
            dot.style.background = 'var(--accent)';
            text.textContent = 'All Systems Go';
        } else {
            dot.style.background = '#f59e0b';
            text.textContent = 'Service Degraded';
        }

        // Update health grid if on settings page
        if (activeSection === 'settings') renderHealth(data.services);
    } catch (err) {
        const statusIndicator = document.getElementById('system-status-indicator');
        statusIndicator.querySelector('span:first-child').style.background = '#ef4444';
        statusIndicator.querySelector('span:last-child').textContent = 'Server Offline';
    }
}

async function loadAgents() {
    try {
        const res = await fetch(`${API_URL}/agents`);
        const data = await res.json();
        agents = data.agents;
        
        renderAgents();
        updateAgentSelects();
    } catch (err) {
        console.error('Failed to load agents', err);
    }
}

async function loadCalls() {
    try {
        const res = await fetch(`${API_URL}/calls`);
        const data = await res.json();
        calls = data.calls;
        
        renderCalls();
    } catch (err) {
        console.error('Failed to load calls', err);
    }
}

async function loadPhoneNumbers() {
    try {
        const res = await fetch(`${API_URL}/phones`);
        const data = await res.json();
        renderPhoneNumbers(data.numbers);
    } catch (err) {
        console.error('Failed to load numbers', err);
    }
}

// ============================================
// RENDERING
// ============================================

function renderAgents() {
    const grid = document.getElementById('agent-grid');
    if (!grid) return;

    if (agents.length === 0) {
        grid.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No agents created yet. Create your first Voice AI agent!</div>';
        return;
    }

    grid.innerHTML = agents.map(agent => `
        <div class="agent-card fade-in">
            <div class="agent-info">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <h3>${agent.name}</h3>
                    <span class="voice-tag">${agent.voice}</span>
                </div>
                <p>${agent.systemPrompt.substring(0, 80)}${agent.systemPrompt.length > 80 ? '...' : ''}</p>
                <div style="display: flex; gap: 0.5rem; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 1rem;">
                    <span><i data-feather="clock" style="width: 12px; height: 12px;"></i> ${agent._count.calls} calls</span>
                    <span><i data-feather="cpu" style="width: 12px; height: 12px;"></i> ${agent.llmModel}</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-ghost" style="flex: 1; padding: 0.5rem;" onclick="editAgent('${agent.id}')">Edit</button>
                    <button class="btn btn-ghost" style="flex: 1; padding: 0.5rem; color: #ef4444;" onclick="deleteAgent('${agent.id}')">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
    
    feather.replace();
}

function updateAgentSelects() {
    const select = document.getElementById('browser-agent-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Choose an agent...</option>' + 
        agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
}

function renderCalls() {
    const tbody = document.getElementById('call-logs-tbody');
    if (!tbody) return;

    if (calls.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 3rem; text-align: center; color: var(--text-dim);">No call logs found.</td></tr>';
        return;
    }

    tbody.innerHTML = calls.map(call => `
        <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 1rem 1.5rem;">
                <div style="font-weight: 600;">${call.agent.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-dim);">${new Date(call.startedAt).toLocaleString()}</div>
            </td>
            <td style="padding: 1rem 1.5rem;">
                <div style="font-size: 0.875rem;">${call.callerNumber || 'Browser'}</div>
                <div style="font-size: 0.75rem; color: var(--text-dim);">Direction: ${call.direction}</div>
            </td>
            <td style="padding: 1rem 1.5rem;">
                <span class="voice-tag" style="background: ${call.status === 'ended' ? 'rgba(255,255,255,0.05)' : 'var(--accent)'}; color: ${call.status === 'ended' ? 'var(--text-dim)' : 'white'};">
                    ${call.status}
                </span>
            </td>
            <td style="padding: 1rem 1.5rem; font-size: 0.875rem;">
                ${Math.floor(call.durationMs / 1000)}s
            </td>
            <td style="padding: 1rem 1.5rem; font-size: 0.875rem;">
                ${call.totalLatencyMs}ms
            </td>
            <td style="padding: 1rem 1.5rem;">
                <button class="btn btn-ghost" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;" onclick="viewTranscript('${call.id}')">
                    View
                </button>
            </td>
        </tr>
    `).join('');
}

function renderHealth(services) {
    const grid = document.getElementById('health-grid');
    if (!grid) return;

    grid.innerHTML = Object.entries(services).map(([name, svc]) => `
        <div class="stat-card fade-in">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <h3 style="text-transform: capitalize;">${name}</h3>
                <span style="width: 10px; height: 10px; border-radius: 50%; background: ${svc.status === 'online' || svc.status === 'configured' ? 'var(--accent)' : '#ef4444'};"></span>
            </div>
            <div class="stat-label">Provider</div>
            <div style="font-size: 0.875rem; margin-bottom: 0.5rem;">${svc.provider}</div>
            <div class="stat-label">Model/Details</div>
            <div style="font-size: 0.875rem; color: var(--text-dim);">${svc.model || svc.voice || (svc.hasNumber ? 'Twilio Active' : 'N/A')}</div>
        </div>
    `).join('');
}

function renderPhoneNumbers(numbers) {
    const grid = document.getElementById('numbers-list');
    if (!grid) return;

    grid.innerHTML = numbers.map(n => `
        <div class="agent-card fade-in">
            <div class="agent-info">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <h3>${n.number}</h3>
                    <span class="voice-tag">Active</span>
                </div>
                <p>Mapped to: <strong>${n.agent.name}</strong></p>
                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                    <button class="btn btn-ghost" style="flex: 1; padding: 0.5rem; color: #ef4444;" onclick="deletePhoneNumber('${n.id}')">Remove</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ============================================
// AGENT ACTIONS
// ============================================

function openAgentModal() {
    document.getElementById('modal-title').textContent = 'Create New Agent';
    document.getElementById('agent-form').reset();
    document.getElementById('agent-form').removeAttribute('data-edit-id');
    document.getElementById('agent-modal').style.display = 'flex';
}

function closeAgentModal() {
    document.getElementById('agent-modal').style.display = 'none';
}

function editAgent(id) {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;

    document.getElementById('modal-title').textContent = 'Edit Agent';
    document.getElementById('agent-name').value = agent.name;
    document.getElementById('agent-voice').value = agent.voice;
    document.getElementById('agent-prompt').value = agent.systemPrompt;
    document.getElementById('agent-greeting').value = agent.greeting;
    document.getElementById('agent-llm').value = agent.llmModel;
    document.getElementById('agent-tokens').value = agent.maxTokens;
    
    document.getElementById('agent-form').setAttribute('data-edit-id', id);
    document.getElementById('agent-modal').style.display = 'flex';
}

document.getElementById('agent-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = e.target.getAttribute('data-edit-id');
    
    const data = {
        name: document.getElementById('agent-name').value,
        voice: document.getElementById('agent-voice').value,
        systemPrompt: document.getElementById('agent-prompt').value,
        greeting: document.getElementById('agent-greeting').value,
        llmModel: document.getElementById('agent-llm').value,
        maxTokens: parseInt(document.getElementById('agent-tokens').value),
    };

    try {
        const method = editId ? 'PUT' : 'POST';
        const url = editId ? `${API_URL}/agents/${editId}` : `${API_URL}/agents`;
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            closeAgentModal();
            loadAgents();
        }
    } catch (err) {
        console.error('Failed to save agent', err);
    }
});

async function deleteAgent(id) {
    if (!confirm('Are you sure you want to delete this agent?')) return;
    try {
        const res = await fetch(`${API_URL}/agents/${id}`, { method: 'DELETE' });
        if (res.ok) loadAgents();
    } catch (err) {
        console.error('Failed to delete agent', err);
    }
}

// ============================================
// BROWSER VOICE SESSIONS (WebSocket)
// ============================================

async function startBrowserCall() {
    const agentId = document.getElementById('browser-agent-select').value;
    if (!agentId) return alert('Please select an agent first');

    const agent = agents.find(a => a.id === agentId);
    document.getElementById('call-agent-name').textContent = agent.name;
    document.getElementById('call-transcript').innerHTML = '';
    document.getElementById('call-ui').style.display = 'block';

    // Initialize Audio
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const source = audioContext.createMediaStreamSource(microphoneStream);
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

        // WS Connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/voice/browser`;
        currentWS = new WebSocket(wsUrl);

        currentWS.onopen = () => {
            currentWS.send(JSON.stringify({ type: 'start', agentId }));
            
            // Start sending audio
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);
            
            scriptProcessor.onaudioprocess = (e) => {
                if (currentWS.readyState === 1) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    // Convert Float32 to Int16
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                    }
                    // Send as base64 chunk
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
                    currentWS.send(JSON.stringify({ type: 'audio', data: base64, format: 'pcm16' }));
                }
            };
        };

        currentWS.onmessage = async (e) => {
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);
                handleWSMessage(msg);
            } else {
                // Binary data (audio response)
                playAudioChunk(e.data);
            }
        };

        currentWS.onclose = () => endBrowserCall(false);
        currentWS.onerror = (err) => {
            console.error('WS Error', err);
            endBrowserCall();
        };

    } catch (err) {
        console.error('Microphone access denied', err);
        alert('Could not access microphone');
        endBrowserCall();
    }
}

function handleWSMessage(msg) {
    const transcript = document.getElementById('call-transcript');
    
    if (msg.type === 'assistant_text' && msg.text) {
        appendMessage('bot', msg.text, msg.isFinal);
    } else if (msg.type === 'transcript' && msg.text) {
        appendMessage('user', msg.text, !msg.partial);
    } else if (msg.type === 'session_ended') {
        endBrowserCall(false);
    }
}

function appendMessage(role, text, isFinal) {
    const transcript = document.getElementById('call-transcript');
    let lastMsg = transcript.lastElementChild;
    
    // If last message is same role and not final, update it
    if (lastMsg && lastMsg.dataset.role === role && lastMsg.dataset.final === 'false') {
        lastMsg.textContent = text;
        lastMsg.dataset.final = isFinal ? 'true' : 'false';
    } else {
        const div = document.createElement('div');
        div.className = `msg msg-${role}`;
        div.dataset.role = role;
        div.dataset.final = isFinal ? 'true' : 'false';
        div.textContent = text;
        transcript.appendChild(div);
    }
    
    transcript.scrollTop = transcript.scrollHeight;
}

async function playAudioChunk(arrayBuffer) {
    if (!audioContext) return;
    try {
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
    } catch (err) {
        console.error('Failed to play audio', err);
    }
}

function endBrowserCall(notifyServer = true) {
    if (notifyServer && currentWS && currentWS.readyState === 1) {
        currentWS.send(JSON.stringify({ type: 'end' }));
    }
    
    if (currentWS) currentWS.close();
    if (microphoneStream) microphoneStream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    
    currentWS = null;
    audioContext = null;
    microphoneStream = null;
    
    document.getElementById('call-ui').style.display = 'none';
    updateStats();
    loadCalls();
}
