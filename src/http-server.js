import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3002;

let config = { greetingMessage: "Hello {name}!", maxResults: 10, enabled: true, authToken: "" };
let logs = [];

const tools = [
  { name: 'greet', description: 'Get a personalized greeting', inputSchema: { name: { type: 'string', description: 'Name to greet' } } },
  { name: 'echo', description: 'Echo back text', inputSchema: { text: { type: 'string', description: 'Text to echo' } } },
  { name: 'get_config', description: 'Get current configuration', inputSchema: {} },
  { name: 'update_config', description: 'Update server configuration', inputSchema: { greetingMessage: { type: 'string' }, maxResults: { type: 'number' }, enabled: { type: 'boolean' } } },
  { name: 'list_items', description: 'List demo items', inputSchema: { limit: { type: 'number', description: 'Number of items to list' } } }
];

function handleTool(name, args) {
  const start = Date.now();
  let result, error = null;
  try {
    switch (name) {
      case 'greet': result = { content: [{ type: 'text', text: config.enabled ? `${config.greetingMessage.replace('{name}', args?.name || 'User')} Welcome, ${args?.name || 'User'}!` : 'Server is disabled' }] }; break;
      case 'echo': result = { content: [{ type: 'text', text: args?.text || '' }] }; break;
      case 'get_config': result = { content: [{ type: 'text', text: JSON.stringify(config) }] }; break;
      case 'update_config': config = { ...config, ...args }; result = { content: [{ type: 'text', text: 'Configuration updated!' }] }; break;
      case 'list_items': result = { content: [{ type: 'text', text: Array.from({length: Math.min(args?.limit || config.maxResults, 100)}, (_,i)=>`Item ${i+1}`).join('\n') }] }; break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) { error = e.message; }
  logs.unshift({ time: new Date().toISOString(), tool: name, args: JSON.stringify(args), result: error || 'success', duration: Date.now() - start });
  if (logs.length > 200) logs.pop();
  if (error) throw new Error(error);
  return result;
}

const sessions = new Map();
function sendSSE(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session?.res && !session.res.writableEnded) session.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// MCP HTTP Transport
app.get('/mcp', (req, res) => {
  console.log(`[MCP] GET /mcp from ${req.ip}`);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  
  const sessionId = Math.random().toString(36).substring(2);
  sessions.set(sessionId, { res, active: true });
  res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
  res.write(`data: ${JSON.stringify({jsonrpc:'2.0',id:0,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mcp-demo',version:'1.0.0'}}})}\n\n`);
  
  const interval = setInterval(() => { if(!sessions.has(sessionId)){clearInterval(interval);return;} res.write(': keepalive\n\n'); }, 20000);
  req.on('close', () => { clearInterval(interval); sessions.delete(sessionId); });
});

app.post('/mcp', (req, res) => {
  const sessionId = req.query.sessionId;
  console.log(`[MCP] POST /mcp sessionId=${sessionId} method=${req.body.method}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { jsonrpc, method, params, id } = req.body;
  
  // Auth check
  if (config.authToken) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (token !== config.authToken) {
      res.json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized' } });
      return;
    }
  }
  
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

// API
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), sessions: sessions.size, version: '1.0.0' }));
app.get('/api/tools', (req, res) => res.json({ tools }));
app.post('/api/execute', (req, res) => { try { res.json({ success: true, result: handleTool(req.body.tool, req.body.args) }); } catch(e) { res.json({ success: false, error: e.message }); } });
app.get('/api/config', (req, res) => res.json({ greetingMessage: config.greetingMessage, maxResults: config.maxResults, enabled: config.enabled, hasAuth: !!config.authToken }));
app.post('/api/config', (req, res) => { config = {...config, ...req.body}; res.json({success:true}); });
app.get('/api/logs', (req, res) => res.json({ logs: logs.slice(0, 100) }));
app.delete('/api/logs', (req, res) => { logs = []; res.json({success:true}); });

// Web UI
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Demo Server</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--primary:#58a6ff;--green:#238636;--red:#da3633}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:2rem;line-height:1.6}
h1{font-size:2rem;color:var(--primary);margin-bottom:.5rem;display:flex;align-items:center;gap:.5rem}
h2{font-size:1.1rem;color:var(--muted);margin-bottom:1rem;text-transform:uppercase;letter-spacing:.5px}
h3{font-size:.95rem;color:var(--text);margin:.75rem 0 .5rem}
.container{max-width:900px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
.tool{background:rgba(255,255,255,0.03);padding:1rem;border-radius:8px;margin-bottom:.75rem;border:1px solid var(--border)}
.tool:hover{border-color:var(--primary)}
.tool-header{display:flex;justify-content:space-between;align-items:center}
.tool-name{color:var(--primary);font-weight:600;font-size:1rem}
.tool-badge{background:var(--green);color:#fff;padding:.2rem .6rem;border-radius:4px;font-size:.75rem}
.tool-desc{color:var(--muted);font-size:.9rem;margin-top:.5rem}
.tool-params{font-size:.8rem;color:var(--muted);margin-top:.5rem;font-family:monospace;background:rgba(0,0,0,0.3);padding:.5rem;border-radius:4px}
input,select,textarea{width:100%;padding:.75rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.95rem;margin-bottom:.75rem}
input:focus,textarea:focus{outline:none;border-color:var(--primary)}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.6rem 1.2rem;border:none;border-radius:8px;cursor:pointer;font-size:.95rem;font-weight:500;transition:all .2s}
.btn-primary{background:var(--green);color:#fff}
.btn-danger{background:var(--red);color:#fff}
.btn-secondary{background:var(--border);color:var(--text)}
.btn:hover{opacity:.9;transform:translateY(-1px)}
.btn-group{display:flex;gap:.5rem;flex-wrap:wrap}
.checkbox{display:flex;align-items:center;gap:.75rem;margin-bottom:1rem}
.checkbox input{width:auto;margin:0}
pre{background:rgba(0,0,0,0.4);padding:1rem;border-radius:8px;overflow:auto;font-size:.85rem;color:#7ee787;line-height:1.5}
code{background:rgba(255,255,255,0.1);padding:.2rem .4rem;border-radius:4px;font-size:.9em}
.tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
.tab{padding:.6rem 1rem;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--muted);cursor:pointer;transition:all .2s}
.tab:hover{background:var(--border)}
.tab.active{background:var(--primary);color:#fff;border-color:var(--primary)}
.hidden{display:none}
.log-item{padding:.6rem;border-bottom:1px solid var(--border);font-size:.85rem}
.log-item:last-child{border-bottom:none}
.log-time{color:var(--muted);margin-right:.5rem}
.log-tool{color:var(--primary);font-weight:500}
.log-success{color:#3fb950}
.log-error{color:#f85149}
.status{padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
.status-online{background:rgba(35,134,54,0.2);border:1px solid #3fb950}
.status-offline{background:rgba(218,54,51,0.2);border:1px solid #f85149}
.status-dot{width:10px;height:10px;border-radius:50%;background:currentColor}
.alert{background:rgba(88,166,255,0.1);border:1px solid var(--primary);padding:1rem;border-radius:8px;margin-bottom:1rem}
.alert-title{font-weight:600;color:var(--primary);margin-bottom:.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}
.stat{background:rgba(255,255,255,0.03);padding:1rem;border-radius:8px;text-align:center}
.stat-value{font-size:1.5rem;font-weight:700;color:var(--primary)}
.stat-label{font-size:.8rem;color:var(--muted);margin-top:.25rem}
.flex-between{display:flex;justify-content:space-between;align-items:center}
.mt-1{margin-top:1rem}
</style>
</head>
<body>
<div class="container">
<h1>🤖 MCP Demo Server <span style="font-size:1rem;font-weight:normal;color:var(--muted)">v1.0.0</span></h1>

<div class="tabs">
<button class="tab active" id="tab-home" onclick="show('home')">🏠 Home</button>
<button class="tab" id="tab-tools" onclick="show('tools')">🔧 Tools</button>
<button class="tab" id="tab-test" onclick="show('test')">▶️ Test</button>
<button class="tab" id="tab-config" onclick="show('config')">⚙️ Config</button>
<button class="tab" id="tab-logs" onclick="show('logs')">📋 Logs</button>
</div>

<!-- Home Tab -->
<div id="home">
<div class="status status-online" id="statusBar">
<span class="status-dot"></span>
<span id="statusText">Loading...</span>
</div>

<div class="grid mt-1">
<div class="stat"><div class="stat-value" id="uptime">-</div><div class="stat-label">Uptime</div></div>
<div class="stat"><div class="stat-value" id="connections">0</div><div class="stat-label">Connections</div></div>
<div class="stat"><div class="stat-value" id="toolCount">0</div><div class="stat-label">Tools</div></div>
</div>

<div class="card mt-1">
<h2>🚀 Quick Start</h2>
<div class="alert">
<div class="alert-title">📌 连接地址</div>
<code>http://43.134.180.240:3002/mcp</code>
</div>

<h3>OpenClaw / Claude Desktop</h3>
<pre>"mcp-demo": {
  "url": "http://43.134.180.240:3002/mcp"
}</pre>

<h3>Cherry Studio</h3>
<pre>"mcp-demo": {
  "url": "http://43.134.180.240:3002/mcp"
}</pre>

<h3>本地 stdio 模式</h3>
<pre>"mcp-demo": {
  "command": "node",
  "args": ["/path/to/mcp-demo/src/index.js"]
}</pre>
</div>

<div class="card">
<h2>📖 使用文档</h2>
<p style="color:var(--muted);margin-bottom:1rem">MCP (Model Context Protocol) 是一个 AI 与外部工具交互的协议。</p>
<ol style="color:var(--muted);padding-left:1.5rem">
<li>选择上方一种客户端配置方式</li>
<li>添加服务器 URL</li>
<li>保存并连接</li>
<li>开始使用工具！</li>
</ol>
</div>
</div>

<!-- Tools Tab -->
<div id="tools" class="hidden">
<div class="card">
<h2>Available Tools</h2>
<div id="toolsList"></div>
</div>
</div>

<!-- Test Tab -->
<div id="test" class="hidden">
<div class="card">
<h2>🧪 Tool Debugger</h2>
<div style="margin-bottom:1rem">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Select Tool</label>
<select id="toolSelect"></select>
</div>
<div style="margin-bottom:1rem">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Parameters (JSON)</label>
<textarea id="params" rows="4" placeholder='{"name": "Tony"}'></textarea>
</div>
<button class="btn btn-primary" id="executeBtn">▶️ Execute</button>
<div class="mt-1">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Result</label>
<pre id="result">Click Execute to run...</pre>
</div>
</div>
</div>

<!-- Config Tab -->
<div id="config" class="hidden">
<div class="card">
<h2>⚙️ Server Configuration</h2>
<div class="checkbox">
<input type="checkbox" id="enabled">
<label>Enable MCP Server</label>
</div>
<div style="margin-bottom:1rem">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Greeting Message</label>
<input type="text" id="greeting" placeholder="Hello {name}!">
</div>
<div style="margin-bottom:1rem">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Max Results</label>
<input type="number" id="maxResults" min="1" max="100">
</div>
<div class="btn-group">
<button class="btn btn-primary" id="saveBtn">💾 Save</button>
<button class="btn btn-secondary" id="resetBtn">↩️ Reset</button>
</div>
</div>

<div class="card">
<h2>🔐 Authentication (Optional)</h2>
<p style="color:var(--muted);margin-bottom:1rem">设置访问 Token，启用后客户端需要携带 Authorization header</p>
<div style="margin-bottom:1rem">
<label style="color:var(--muted);display:block;margin-bottom:.5rem">Auth Token</label>
<input type="password" id="authToken" placeholder="Leave empty to disable">
</div>
<button class="btn btn-primary" id="saveAuthBtn">💾 Save Auth</button>
</div>
</div>

<!-- Logs Tab -->
<div id="logs" class="hidden">
<div class="flex-between" style="margin-bottom:1rem">
<h2>📋 Request Logs</h2>
<button class="btn btn-danger" id="clearBtn">🗑️ Clear</button>
</div>
<div class="card">
<div id="logsList"></div>
</div>
</div>
</div>

<script>
var tools = [];

function show(tab) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('#home,#tools,#test,#config,#logs').forEach(function(d) { d.classList.add('hidden'); });
  document.getElementById(tab).classList.remove('hidden');
  if (tab === 'logs') loadLogs();
  if (tab === 'config') loadConfig();
}

function loadStatus() {
  fetch('/health').then(function(r) { return r.json(); }).then(function(d) {
    var statusEl = document.getElementById('statusBar');
    statusEl.className = 'status status-online';
    document.getElementById('statusText').innerHTML = '<span class="status-dot"></span> Online | Uptime: ' + Math.floor(d.uptime) + 's';
    document.getElementById('uptime').textContent = formatUptime(d.uptime);
    document.getElementById('connections').textContent = d.sessions;
  }).catch(function() {
    var statusEl = document.getElementById('statusBar');
    statusEl.className = 'status status-offline';
    document.getElementById('statusText').innerHTML = '<span class="status-dot"></span> Offline';
  });
}

function formatUptime(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

fetch('/api/tools').then(function(r) { return r.json(); }).then(function(d) {
  tools = d.tools;
  document.getElementById('toolCount').textContent = tools.length;
  
  var listHtml = '';
  tools.forEach(function(t) {
    var params = JSON.stringify(t.inputSchema, null, 2);
    listHtml += '<div class="tool"><div class="tool-header"><span class="tool-name">' + t.name + '</span><span class="tool-badge">Tool</span></div><div class="tool-desc">' + t.description + '</div>';
    if (params !== '{}') listHtml += '<div class="tool-params">Params: ' + params + '</div>';
    listHtml += '</div>';
  });
  document.getElementById('toolsList').innerHTML = listHtml;
  
  var selectHtml = '';
  tools.forEach(function(t) { selectHtml += '<option value="' + t.name + '">' + t.name + '</option>'; });
  document.getElementById('toolSelect').innerHTML = selectHtml;
});

document.getElementById('executeBtn').onclick = function() {
  var tool = document.getElementById('toolSelect').value;
  var paramsText = document.getElementById('params').value || '{}';
  var args = {};
  try { args = JSON.parse(paramsText); } catch(e) {
    document.getElementById('result').textContent = 'JSON Error: ' + e.message;
    return;
  }
  document.getElementById('result').textContent = 'Executing...';
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
    document.getElementById('authToken').value = '';
    document.getElementById('authToken').placeholder = d.hasAuth ? '••••••••' : 'Leave empty to disable';
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
  }).then(function() { alert('✅ Saved!'); });
};

document.getElementById('resetBtn').onclick = function() {
  if (!confirm('Reset to default?')) return;
  fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({greetingMessage: "Hello {name}!", maxResults: 10, enabled: true})
  }).then(function() { loadConfig(); });
};

document.getElementById('saveAuthBtn').onclick = function() {
  var token = document.getElementById('authToken').value;
  fetch('/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({authToken: token})
  }).then(function() { alert(token ? '✅ Auth saved!' : '✅ Auth disabled!'); });
};

function loadLogs() {
  fetch('/api/logs').then(function(r) { return r.json(); }).then(function(d) {
    if (d.logs.length === 0) {
      document.getElementById('logsList').innerHTML = '<div class="log-item" style="color:var(--muted)">No requests yet</div>';
      return;
    }
    var html = '';
    d.logs.forEach(function(l) {
      var cls = l.result.startsWith('error') ? 'log-error' : 'log-success';
      html += '<div class="log-item"><span class="log-time">' + l.time + '</span><span class="log-tool">' + l.tool + '</span><span class="' + cls + '">' + l.result + '</span> (' + l.duration + 'ms)</div>';
    });
    document.getElementById('logsList').innerHTML = html;
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
