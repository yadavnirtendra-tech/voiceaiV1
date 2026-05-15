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
    await loadVoices();
    
    // Show correct section from hash
    const section = window.location.hash.replace('#', '') || 'dashboard';
    showSection(section);

    // Replace icons
    if (window.feather) feather.replace();
}

// ============================================
// NAVIGATION
// ============================================

window.addEventListener('hashchange', () => {
    const section = window.location.hash.replace('#', '') || 'dashboard';
    showSection(section);
});

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
    document.querySelectorAll('.nav-link').forEach(l => {
        const href = l.getAttribute('href').replace('#', '');
        if (href === sectionId) {
            l.classList.add('active');
        } else {
            l.classList.remove('active');
        }
    });

    activeSection = sectionId;
    
    // Refresh content
    if (sectionId === 'agents') loadAgents();
    if (sectionId === 'calls') loadCalls();
    if (sectionId === 'numbers') loadPhoneNumbers();
    if (sectionId === 'settings') checkHealth();
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

async function loadVoices() {
    try {
        const res = await fetch(`${API_URL}/voices`);
        if (!res.ok) throw new Error('Failed to fetch voices');
        const data = await res.json();
        const select = document.getElementById('agent-voice');
        if (select && data.voices && data.voices.length > 0) {
            select.innerHTML = data.voices.map(v => `<option value="${v.id}">${v.name} (${v.language})</option>`).join('');
        } else {
            console.warn('No voices returned from server, using defaults');
        }
    } catch (err) {
        console.error('Failed to load voices', err);
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
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <button class="btn btn-ghost" style="flex: 1; padding: 0.5rem;" onclick="editAgent('${agent.id}')">Edit</button>
                    <button class="btn btn-ghost" style="flex: 1; padding: 0.5rem;" onclick="openKnowledgeModal('${agent.id}', '${agent.name}')">Knowledge</button>
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
    
    const agentOptions = agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    select.innerHTML = '<option value="">Choose an agent...</option>' + agentOptions;
    
    const phoneSelect = document.getElementById('phone-agent-select');
    if (phoneSelect) phoneSelect.innerHTML = agentOptions;
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
    console.log('Opening Agent Modal');
    const modal = document.getElementById('agent-modal');
    const form = document.getElementById('agent-form');
    const title = document.getElementById('modal-title');
    
    if (modal && form && title) {
        title.textContent = 'Create New Agent';
        form.reset();
        form.removeAttribute('data-edit-id');
        modal.style.display = 'flex';
    } else {
        console.error('Modal or Form elements not found in DOM');
        alert('Internal UI Error: Modal elements missing. Please refresh the page.');
    }
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
    document.getElementById('agent-transfer').value = agent.transferNumber || '';
    document.getElementById('agent-webhook').value = agent.webhookUrl || '';
    document.getElementById('agent-webhook-events').value = agent.webhookEvents || 'call.started,call.ended,turn.complete';
    document.getElementById('agent-llm').value = agent.llmModel;
    document.getElementById('agent-tokens').value = agent.maxTokens;
    
    document.getElementById('agent-form').setAttribute('data-edit-id', id);
    document.getElementById('agent-modal').style.display = 'flex';
}

document.getElementById('agent-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Agent form submitted');
    
    const editId = e.target.getAttribute('data-edit-id');
    
    const getVal = (id) => {
        const el = document.getElementById(id);
        if (!el) console.warn(`Element #${id} not found`);
        return el ? el.value : '';
    };

    const data = {
        name: getVal('agent-name'),
        voice: getVal('agent-voice'),
        systemPrompt: getVal('agent-prompt'),
        greeting: getVal('agent-greeting'),
        transferNumber: getVal('agent-transfer'),
        webhookUrl: getVal('agent-webhook'),
        webhookEvents: getVal('agent-webhook-events'),
        llmModel: getVal('agent-llm'),
        maxTokens: parseInt(getVal('agent-tokens')) || 150,
    };

    console.log('Sending agent data:', data);

    try {
        const method = editId ? 'PUT' : 'POST';
        const url = editId ? `${API_URL}/agents/${editId}` : `${API_URL}/agents`;
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            console.log('Agent saved successfully');
            closeAgentModal();
            loadAgents();
        } else {
            const errData = await res.json();
            console.error('Server error saving agent:', errData);
            alert(`Error: ${errData.error || 'Failed to save agent'}`);
        }
    } catch (err) {
        console.error('Network error saving agent:', err);
        alert('Connection error. Is the backend server running?');
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

        // Native Browser STT Fallback
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
                const result = event.results[event.results.length - 1];
                const text = result[0].transcript;
                const isFinal = result.isFinal;

                // Send text directly to backend
                if (isFinal && currentWS?.readyState === 1) {
                    currentWS.send(JSON.stringify({ type: 'text', text }));
                }
                
                appendMessage('user', text, isFinal);
            };

            recognition.start();
            sessionStorage.setItem('stt_active', 'true');
        }

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
// ============================================
// PHONE NUMBER ACTIONS
// ============================================

function openNumberModal() {
    document.getElementById('number-form').reset();
    document.getElementById('number-modal').style.display = 'flex';
}

function closeNumberModal() {
    document.getElementById('number-modal').style.display = 'none';
}

document.getElementById('number-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        number: document.getElementById('phone-number-input').value,
        agentId: document.getElementById('phone-agent-select').value,
        label: document.getElementById('phone-label').value,
    };

    try {
        const res = await fetch(`${API_URL}/phones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            closeNumberModal();
            loadPhoneNumbers();
        } else {
            const err = await res.json();
            alert(`Error: ${err.error}`);
        }
    } catch (err) {
        console.error('Failed to add number', err);
    }
});

async function deletePhoneNumber(id) {
    if (!confirm('Are you sure you want to remove this phone number?')) return;
    try {
        const res = await fetch(`${API_URL}/phones/${id}`, { method: 'DELETE' });
        if (res.ok) loadPhoneNumbers();
    } catch (err) {
        console.error('Failed to delete number', err);
    }
}

// ============================================
// TRANSCRIPT VIEWER
// ============================================

async function viewTranscript(id) {
    try {
        const res = await fetch(`${API_URL}/calls/${id}`);
        const data = await res.json();
        const call = data.call;

        document.getElementById('transcript-title').textContent = `Call with ${call.agent.name}`;
        document.getElementById('transcript-subtitle').textContent = `${new Date(call.startedAt).toLocaleString()} • Duration: ${Math.floor(call.durationMs / 1000)}s • Status: ${call.status}`;
        
        const body = document.getElementById('transcript-body');
        body.innerHTML = call.messages.length > 0 
            ? call.messages.map(m => `
                <div class="msg msg-${m.role === 'user' ? 'user' : 'bot'}" style="max-width: 90%; margin-bottom: 0.5rem;">
                    <div style="font-size: 0.7rem; opacity: 0.7; margin-bottom: 0.2rem;">${m.role.toUpperCase()}</div>
                    ${m.content}
                </div>
            `).join('')
            : '<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No messages recorded for this call.</div>';

        document.getElementById('transcript-modal').style.display = 'flex';
        body.scrollTop = 0;
    } catch (err) {
        console.error('Failed to load transcript', err);
        alert('Could not load transcript');
    }
}

function closeTranscriptModal() {
    document.getElementById('transcript-modal').style.display = 'none';
}

// ============================================
// KNOWLEDGE BASE ACTIONS
// ============================================

let currentKbAgentId = null;

async function openKnowledgeModal(agentId, agentName) {
    currentKbAgentId = agentId;
    document.getElementById('kb-agent-name').textContent = `Knowledge Base: ${agentName}`;
    document.getElementById('kb-form').reset();
    document.getElementById('knowledge-modal').style.display = 'flex';
    await loadKnowledgeItems();
}

function closeKnowledgeModal() {
    document.getElementById('knowledge-modal').style.display = 'none';
    currentKbAgentId = null;
}

async function loadKnowledgeItems() {
    try {
        const res = await fetch(`${API_URL}/knowledge/${currentKbAgentId}`);
        const data = await res.json();
        renderKnowledgeItems(data.items);
    } catch (err) {
        console.error('Failed to load KB items', err);
    }
}

function renderKnowledgeItems(items) {
    const list = document.getElementById('kb-items-list');
    if (items.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No knowledge items yet. Add some Q&A to train your agent.</div>';
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="card" style="padding: 1rem; margin-bottom: 0; background: rgba(255,255,255,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                <div style="font-weight: 700; color: var(--primary);">Q: ${item.question}</div>
                <button class="btn btn-ghost" style="padding: 0.2rem; color: #ef4444;" onclick="deleteKnowledgeItem('${item.id}')">
                    <i data-feather="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
            <div style="font-size: 0.875rem; color: var(--text-dim);">A: ${item.answer}</div>
        </div>
    `).join('');
    feather.replace();
}

document.getElementById('kb-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        agentId: currentKbAgentId,
        question: document.getElementById('kb-question').value,
        answer: document.getElementById('kb-answer').value,
        priority: 0
    };

    try {
        const res = await fetch(`${API_URL}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('kb-form').reset();
            loadKnowledgeItems();
        }
    } catch (err) {
        console.error('Failed to add KB item', err);
    }
});

async function deleteKnowledgeItem(id) {
    try {
        const res = await fetch(`${API_URL}/knowledge/${id}`, { method: 'DELETE' });
        if (res.ok) loadKnowledgeItems();
    } catch (err) {
        console.error('Failed to delete KB item', err);
    }
}
