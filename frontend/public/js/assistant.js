/**
 * OpenCalendar AI Assistant Logic
 * Handles LLM interactions, tool usage, and context enrichment
 */

let calendarContext = [];
let currentUser = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  await fetchUserData();
  await fetchCalendarContext();
  
  // Apply theme if stored
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
});

function loadSettings() {
  const provider = localStorage.getItem('assistant_provider') || 'openai';
  const apiKey = localStorage.getItem('assistant_api_key') || '';
  
  document.getElementById('providerSelect').value = provider;
  document.getElementById('apiKeyInput').value = apiKey;
}

function saveSettings() {
  const provider = document.getElementById('providerSelect').value;
  const apiKey = document.getElementById('apiKeyInput').value;
  
  localStorage.setItem('assistant_provider', provider);
  localStorage.setItem('assistant_api_key', apiKey);
  
  alert('Settings saved successfully!');
}

async function fetchUserData() {
  try {
    const res = await fetch('/api/calendar/profile', { credentials: 'include' });
    const data = await res.json();
    if (data.success) currentUser = data.user;
  } catch (e) {
    console.error('Failed to fetch profile', e);
  }
}

async function fetchCalendarContext() {
  try {
    const res = await fetch('/api/calendar/events?limit=100', { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      calendarContext = data.events.map(ev => ({
        title: ev.summary,
        start: ev.startTime,
        end: ev.endTime,
        provider: ev.identity?.providerType,
        description: ev.description
      }));
    }
  } catch (e) {
    console.error('Context fetch failed', e);
  }
}

async function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const query = input.value.trim();
  if (!query) return;
  
  addMessage('user', query);
  input.value = '';
  
  const assistantMsgEl = addMessage('assistant', 'Thinking...');
  
  try {
    const response = await callLLM(query);
    assistantMsgEl.textContent = response;
  } catch (err) {
    assistantMsgEl.textContent = `Error: ${err.message}. Please check your API key and provider settings.`;
  }
}

function addMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function callLLM(query) {
  const provider = localStorage.getItem('assistant_provider');
  const apiKey = localStorage.getItem('assistant_api_key');
  
  if (!apiKey) {
    throw new Error('No API key found. Please add one in settings');
  }

  // Enrich query with calendar context
  const contextPrompt = `
    User Profile: ${currentUser?.email}
    Current Time: ${new Date().toLocaleString()}
    
    Current Calendar Events:
    ${JSON.stringify(calendarContext.slice(0, 10), null, 2)}
    
    Instructions: You are a smart assistant for OpenCalendar. You can analyze schedules, detect conflicts, and help with HR/Payroll/Inventory data.
    If the user asks about Excel/CSV/HR/Inventory, tell them you are ready to process their file uploads (mocked feature).
    
    User Query: ${query}
  `;

  if (provider === 'openai') {
    return await callOpenAI(apiKey, contextPrompt);
  } else if (provider === 'anthropic') {
    return await callAnthropic(apiKey, contextPrompt);
  } else if (provider === 'groq') {
    return await callGroq(apiKey, contextPrompt);
  }
}

async function callOpenAI(key, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callAnthropic(key, prompt) {
  // Note: Browser CORS might block this, in production we use a proxy
  // This is for demonstration.
  throw new Error('Anthropic direct browser calls are often blocked by CORS. Please use OpenAI or Groq for this demo.');
}

async function callGroq(key, prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}
