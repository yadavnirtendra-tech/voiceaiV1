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
  } else if (provider === 'gemini') {
    return await callGemini(apiKey, contextPrompt);
  } else if (provider === 'anthropic') {
    return await callAnthropic(apiKey, contextPrompt);
  } else if (provider === 'groq') {
    return await callGroq(apiKey, contextPrompt);
  }
}

/**
 * Tool Definition for AI Agents
 */
const CALENDAR_TOOLS = [
  {
    name: "get_calendar_accounts",
    description: "List the user's connected calendar accounts (Google/Outlook) and their IDs.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "create_meeting",
    description: "Create a new meeting in a specific calendar account.",
    parameters: {
      type: "object",
      properties: {
        identityId: { type: "string", description: "The ID of the account to create the meeting in" },
        summary: { type: "string", description: "Title of the meeting" },
        startTime: { type: "string", description: "ISO 8601 start time" },
        endTime: { type: "string", description: "ISO 8601 end time" },
        description: { type: "string" }
      },
      required: ["identityId", "summary", "startTime", "endTime"]
    }
  }
];

async function handleToolCall(toolCall) {
  const { name, arguments: args } = toolCall;
  const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
  
  if (name === 'get_calendar_accounts') {
    const identities = currentUser.identities || [];
    return JSON.stringify(identities.map(id => ({ id: id.id, email: id.providerEmail, type: id.providerType })));
  }
  
  if (name === 'create_meeting') {
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedArgs),
        credentials: 'include'
      });
      const data = await res.json();
      return data.success ? `Successfully booked: ${parsedArgs.summary}` : `Failed: ${data.error}`;
    } catch (e) {
      return `Error creating meeting: ${e.message}`;
    }
  }
  return "Tool not found";
}

async function callGemini(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ function_declarations: CALENDAR_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      })) }]
    })
  });
  
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  
  const part = data.candidates[0].content.parts[0];
  
  if (part.functionCall) {
    addMessage('assistant', `🛠️ Action: Calling ${part.functionCall.name}...`);
    const toolResult = await handleToolCall(part.functionCall);
    // Send tool result back to Gemini for final response
    const finalRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: prompt }] },
          { role: 'model', parts: [{ functionCall: part.functionCall }] },
          { role: 'user', parts: [{ functionResponse: { name: part.functionCall.name, response: { content: toolResult } } }] }
        ]
      })
    });
    const finalData = await finalRes.json();
    return finalData.candidates[0].content.parts[0].text;
  }
  
  return part.text;
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
      messages: [{ role: 'user', content: prompt }],
      tools: CALENDAR_TOOLS.map(t => ({ type: 'function', function: t }))
    })
  });
  
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  
  const message = data.choices[0].message;
  
  if (message.tool_calls) {
    addMessage('assistant', `🛠️ Action: ${message.tool_calls[0].function.name}...`);
    const toolResult = await handleToolCall(message.tool_calls[0].function);
    
    // Follow up with tool result
    const finalRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: prompt },
          message,
          { role: 'tool', tool_call_id: message.tool_calls[0].id, content: toolResult }
        ]
      })
    });
    const finalData = await finalRes.json();
    return finalData.choices[0].message.content;
  }
  
  return message.content;
}

async function callAnthropic(key, prompt) {
  // CORS block remains an issue for browser-only demos without a proxy
  throw new Error('Anthropic direct browser calls are often blocked by CORS. Please use OpenAI, Groq, or Gemini.');
}

async function callGroq(key, prompt) {
  // Groq uses OpenAI-compatible API
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }],
      tools: CALENDAR_TOOLS.map(t => ({ type: 'function', function: t }))
    })
  });
  
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  
  const message = data.choices[0].message;
  
  if (message.tool_calls) {
    const toolResult = await handleToolCall(message.tool_calls[0].function);
    // Simple follow up for Groq
    return `Action: ${message.tool_calls[0].function.name} executed. Result: ${toolResult}`;
  }
  
  return message.content;
}

