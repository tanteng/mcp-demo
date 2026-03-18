import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const PORT = process.env.PORT || 3001;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default config
const defaultConfig = {
  greetingMessage: "Hello from MCP Demo!",
  maxResults: 10,
  enabled: true
};

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { ...defaultConfig };
}

// Save config
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// API: Get config
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  res.json(config);
});

// API: Update config
app.post('/api/config', (req, res) => {
  const currentConfig = loadConfig();
  const newConfig = { ...currentConfig, ...req.body };
  saveConfig(newConfig);
  res.json({ success: true, config: newConfig });
});

// API: Reset config
app.post('/api/config/reset', (req, res) => {
  saveConfig(defaultConfig);
  res.json({ success: true, config: defaultConfig });
});

// Serve the config UI
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Demo Config</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.8rem;
      margin-bottom: 1.5rem;
      color: #00d9ff;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .form-group {
      margin-bottom: 1.2rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      color: #aaa;
    }
    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #333;
      border-radius: 8px;
      background: #0f0f23;
      color: #fff;
      font-size: 1rem;
    }
    input:focus {
      outline: none;
      border-color: #00d9ff;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    input[type="checkbox"] {
      width: 20px;
      height: 20px;
      accent-color: #00d9ff;
    }
    .btn {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #00d9ff;
      color: #1a1a2e;
      font-weight: 600;
      width: 100%;
    }
    .btn-primary:hover {
      background: #00b8d9;
    }
    .btn-secondary {
      background: #333;
      color: #fff;
      margin-top: 0.5rem;
    }
    .btn-secondary:hover {
      background: #444;
    }
    .status {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      display: none;
    }
    .status.success {
      background: #1b4332;
      color: #74c69d;
      display: block;
    }
    .status.error {
      background: #4a1515;
      color: #f48c88;
      display: block;
    }
    .section-title {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚙️ MCP Demo Configuration</h1>
    
    <div id="status" class="status"></div>
    
    <div class="card">
      <div class="section-title">Server Settings</div>
      
      <div class="form-group checkbox-group">
        <input type="checkbox" id="enabled">
        <label for="enabled" style="margin: 0;">Enable MCP Server</label>
      </div>
      
      <div class="form-group">
        <label for="greetingMessage">Greeting Message</label>
        <input type="text" id="greetingMessage" placeholder="Hello {name}!">
        <small style="color: #666; font-size: 0.85rem;">Use {name} as placeholder</small>
      </div>
      
      <div class="form-group">
        <label for="maxResults">Max Results</label>
        <input type="number" id="maxResults" min="1" max="100" value="10">
      </div>
      
      <button class="btn btn-primary" onclick="saveConfig()">Save Configuration</button>
      <button class="btn btn-secondary" onclick="resetConfig()">Reset to Default</button>
    </div>
    
    <div class="card">
      <div class="section-title">Usage</div>
      <p style="color: #888; line-height: 1.6;">
        To use this MCP server, add to your Claude/OpenClaw config:
      </p>
      <pre style="background: #0f0f23; padding: 1rem; border-radius: 8px; margin-top: 0.5rem; overflow-x: auto; color: #74c69d; font-size: 0.9rem;">{
  "mcpServers": {
    "mcp-demo": {
      "command": "node",
      "args": ["path/to/mcp-demo/src/index.js"]
    }
  }
}</pre>
    </div>
  </div>
  
  <script>
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        
        document.getElementById('enabled').checked = config.enabled;
        document.getElementById('greetingMessage').value = config.greetingMessage;
        document.getElementById('maxResults').value = config.maxResults;
      } catch (e) {
        showStatus('Failed to load config', 'error');
      }
    }
    
    async function saveConfig() {
      const config = {
        enabled: document.getElementById('enabled').checked,
        greetingMessage: document.getElementById('greetingMessage').value,
        maxResults: parseInt(document.getElementById('maxResults').value)
      };
      
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        
        if (res.ok) {
          showStatus('Configuration saved!', 'success');
        } else {
          showStatus('Failed to save config', 'error');
        }
      } catch (e) {
        showStatus('Error: ' + e.message, 'error');
      }
    }
    
    async function resetConfig() {
      if (!confirm('Reset to default config?')) return;
      
      try {
        const res = await fetch('/api/config/reset', { method: 'POST' });
        if (res.ok) {
          loadConfig();
          showStatus('Config reset to default', 'success');
        }
      } catch (e) {
        showStatus('Failed to reset', 'error');
      }
    }
    
    function showStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status ' + type;
      setTimeout(() => el.className = 'status', 3000);
    }
    
    loadConfig();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`MCP Demo Config Server running at http://localhost:${PORT}`);
});
