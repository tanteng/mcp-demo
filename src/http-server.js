import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3002;

let config = { greetingMessage: "Hello {name}!", maxResults: 10, enabled: true };
let logs = [];

const tools = [
  { name: 'greet', description: 'Get a personalized greeting', inputSchema: { name: { type: 'string' } } },
  { name: 'echo', description: 'Echo back text', inputSchema: { text: { type: 'string' } } },
  { name: 'get_config', description: 'Get configuration', inputSchema: {} },
  { name: 'update_config', description: 'Update configuration', inputSchema: { greetingMessage: {}, maxResults: {}, enabled: {} } },
  { name: 'list_items', description: 'List items', inputSchema: { limit: {} } }
];

function handleTool(name, args) {
  const start = Date.now();
  let result, error = null;
  try {
    switch (name) {
      case 'greet': result = { content: [{ type: 'text', text: config.enabled ? `${config.greetingMessage.replace('{name}', args?.name || 'User')} Welcome, ${args?.name || 'User'}!` : 'Disabled' }] }; break;
      case 'echo': result = { content: [{ type: 'text', text: args?.text || '' }] }; break;
      case 'get_config': result = { content: [{ type: 'text', text: JSON.stringify(config) }] }; break;
      case 'update_config': config = { ...config, ...args }; result = { content: [{ type: 'text', text: 'Updated!' }] }; break;
      case 'list_items': result = { content: [{ type: 'text', text: Array.from({length: Math.min(args?.limit || config.maxResults, 100)}, (_,i)=>`Item ${i+1}`).join('\n') }] }; break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) { error = e.message; }
  logs.unshift({ time: new Date().toISOString(), tool: name, result: error || 'success', duration: Date.now() - start });
  if (logs.length > 100) logs.pop();
  if (error) throw new Error(error);
  return result;
}

const sessions = new Map();
function sendSSE(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session?.res && !session.res.writableEnded) session.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get('/mcp', (req, res) => {
  console.log(`[MCP] GET /mcp from ${req.ip}`);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.flushHeaders();
  
  const sessionId = Math.random().toString(36).substring(2);
  sessions.set(sessionId, { res, active: true });
  res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
  res.write(`data: ${JSON.stringify({jsonrpc:'2.0',id:0,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mcp-demo',version:'1.0.0'}}})}\n\n`);
  
  const interval = setInterval(() => { if(!sessions.has(sessionId)){clearInterval(interval);return;} res.write(': keepalive\n\n'); }, 20000);
  req.on('close', () => { clearInterval(interval); sessions.delete(sessionId); console.log(`[MCP] Session ${sessionId} closed`); });
});

app.post('/mcp', (req, res) => {
  const sessionId = req.query.sessionId;
  console.log(`[MCP] POST /mcp sessionId=${sessionId} method=${req.body.method}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { jsonrpc, method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize': result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-demo', version: '1.0.0' } }; break;
      case 'tools/list': result = { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }; break;
      case 'tools/call': result = handleTool(params.name, params.arguments); break;
      case 'ping': result = {}; break;
      default: res.json({ jsonrpc: '2.0', id, error: { code: -32601 } }); return;
    }
    const response = { jsonrpc: '2.0', id, result };
    if (sessionId && sessions.has(sessionId)) sendSSE(sessionId, response);
    res.json(response);
  } catch (e) { res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); }
});

app.options('/mcp', (req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.sendStatus(200); });

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), sessions: sessions.size }));
app.get('/api/tools', (req, res) => res.json({ tools }));
app.post('/api/execute', (req, res) => { try { res.json({ success: true, result: handleTool(req.body.tool, req.body.args) }); } catch(e) { res.json({ success: false, error: e.message }); } });
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => { config = {...config, ...req.body}; res.json({success:true}); });
app.get('/api/logs', (req, res) => res.json({ logs }));
app.delete('/api/logs', (req, res) => { logs = []; res.json({success:true}); });

// Web UI - separated into a separate HTML file
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>MCP Demo Server</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh;padding:2rem}
h1{font-size:1.8rem;color:#58a6ff;margin-bottom:1.5rem}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.25rem;margin-bottom:1rem}
h2{font-size:.85rem;color:#8b949e;margin-bottom:1rem;text-transform:uppercase}
.tool{background:#21262d;padding:.75rem;border-radius:6px;margin-bottom:.5rem;border:1px solid transparent}
.tool:hover{border-color:#58a6ff}
.tool-name{color:#58a6ff;font-weight:600}
.tool-desc{font-size:.85rem;color:#8b949e}
input,select,textarea{width:100%;padding:.6rem;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:.9rem;margin-bottom:.75rem}
input:focus,textarea:focus{outline:none;border-color:#58a6ff}
.btn{padding:.6rem 1.2rem;border:none;border-radius:6px;cursor:pointer;font-size:.9rem;margin-right:.5rem}
.btn-primary{background:#238636;color:#fff}
.btn-danger{background:#da3633;color:#fff}
.btn:hover{opacity:.9}
.checkbox{display:flex;align-items:center;gap:.5rem;margin-bottom:1rem}
pre{background:#0d1117;padding:.75rem;border-radius:6px;overflow:auto;font-size:.8rem;color:#7ee787}
.tabs{display:flex;gap:.5rem;margin-bottom:1rem}
.tab{padding:.6rem 1rem;background:#21262d;border:none;border-radius:6px;color:#8b949e;cursor:pointer}
.tab.active{background:#58a6ff;color:#fff}
.hidden{display:none}
.log-item{padding:.5rem;border-bottom:1px solid #30363d;font-size:.85rem}
.log-success{color:#3fb950}
.log-error{color:#f85149}
</style>
</head>
<body>
<h1>🤖 MCP Demo Server</h1>
<div class="tabs">
<button class="tab active" id="tab-status" onclick="showTab('status')">Status</button>
<button class="tab" id="tab-tools" onclick="showTab('tools')">Tools</button>
<button class="tab" id="tab-test" onclick="showTab('test')">Test</button>
<button class="tab" id="tab-config" onclick="showTab('config')">Config</button>
<button class="tab" id="tab-logs" onclick="showTab('logs')">Logs</button>
</div>

<div id="status">
<div class="card"><h2>Server Status</h2><div id="serverStatus">Loading...</div></div>
<div class="card"><h2>Connection Config</h2><h3>Remote (MCP HTTP)</h3><pre>"mcp-demo": {"url": "http://43.134.180.240:3002/mcp"}</pre><h3>Local</h3><pre>"mcp-demo": {"command":"node","args":["/root/mcp-demo/src/index.js"]}</pre></div>
</div>

<div id="tools" class="hidden"><div class="card"><h2>Available Tools</h2><div id="toolsList"></div></div></div>

<div id="test" class="hidden">
<div class="card"><h2>Tool Debugger</h2>
<select id="toolSelect"></select>
<textarea id="params" rows="4" placeholder='{"name": "value"}'></textarea>
<button class="btn btn-primary" id="executeBtn">Execute</button>
<pre id="result">Click Execute to run...</pre>
</div>
</div>

<div id="config" class="hidden">
<div class="card"><h2>Configuration</h2>
<div class="checkbox"><input type="checkbox" id="enabled"><label>Enable Server</label></div>
<input id="greeting" placeholder="Greeting message">
<input id="maxResults" type="number" placeholder="Max results">
<button class="btn btn-primary" id="saveBtn">Save</button>
<button class="btn btn-danger" id="resetBtn">Reset</button>
</div>
</div>

<div id="logs" class="hidden">
<div class="card"><button class="btn btn-danger" id="clearBtn">Clear</button></div>
<div class="card"><h2>Request Logs</h2><div id="logsList"></div></div>
</div>

<script>
var tools = [];

function showTab(tab) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('#status,#tools,#test,#config,#logs').forEach(function(d) { d.classList.add('hidden'); });
  document.getElementById(tab).classList.remove('hidden');
  if (tab === 'logs') loadLogs();
  if (tab === 'config') loadConfig();
}

function loadStatus() {
  fetch('/health').then(function(r) { return r.json(); }).then(function(d) {
    document.getElementById('serverStatus').innerHTML = '<p>● Online | Uptime: ' + Math.floor(d.uptime) + 's | Sessions: ' + d.sessions + '</p>';
  }).catch(function() {
    document.getElementById('serverStatus').innerHTML = '<p>● Offline</p>';
  });
}

fetch('/api/tools').then(function(r) { return r.json(); }).then(function(d) {
  tools = d.tools;
  var html = '';
  tools.forEach(function(t) {
    html += '<div class="tool"><div class="tool-name">' + t.name + '</div><div class="tool-desc">' + t.description + '</div></div>';
  });
  document.getElementById('toolsList').innerHTML = html;
  
  var selectHtml = '';
  tools.forEach(function(t) {
    selectHtml += '<option value="' + t.name + '">' + t.name + '</option>';
  });
  document.getElementById('toolSelect').innerHTML = selectHtml;
});

document.getElementById('executeBtn').onclick = function() {
  var tool = document.getElementById('toolSelect').value;
  var paramsText = document.getElementById('params').value || '{}';
  var args = {};
  try {
    args = JSON.parse(paramsText);
  } catch(e) {
    document.getElementById('result').textContent = 'JSON parse error: ' + e.message;
    return;
  }
  fetch('/api/execute', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tool: tool, args: args})
  }).then(function(r) { return r.json(); }).then(function(d) {
    document.getElementById('result').textContent = JSON.stringify(d, null, 2);
  });
};

function loadConfig() {
  fetch('/api/config').then(function(r) { return r.json(); }).then(function(d) {
    document.getElementById('enabled').checked = d.enabled;
    document.getElementById('greeting').value = d.greetingMessage;
    document.getElementById('maxResults').value = d.maxResults;
  });
}

document.getElementById('saveBtn').onclick = function() {
  fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      enabled: document.getElementById('enabled').checked,
      greetingMessage: document.getElementById('greeting').value,
      maxResults: parseInt(document.getElementById('maxResults').value)
    })
  }).then(function() { alert('Saved!'); });
};

document.getElementById('resetBtn').onclick = function() {
  if (!confirm('Reset to default?')) return;
  fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({greetingMessage: "Hello {name}!", maxResults: 10, enabled: true})
  }).then(function() { loadConfig(); });
};

function loadLogs() {
  fetch('/api/logs').then(function(r) { return r.json(); }).then(function(d) {
    var html = '';
    d.logs.forEach(function(l) {
      var cls = l.result.startsWith('error') ? 'log-error' : 'log-success';
      html += '<div class="log-item"><span style="color:#8b949e">' + l.time + '</span> - <span style="color:#58a6ff">' + l.tool + '</span> - <span class="' + cls + '">' + l.result + '</span></div>';
    });
    document.getElementById('logsList').innerHTML = html || 'No logs';
  });
}

document.getElementById('clearBtn').onclick = function() {
  fetch('/api/logs', {method: 'DELETE'}).then(function() { loadLogs(); });
};

setInterval(loadStatus, 5000);
loadStatus();
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(html));

app.listen(PORT, () => console.log(`MCP Demo on port ${PORT}`));
