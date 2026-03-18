import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.env.HOME || '/root', '.mcp-demo-config.json');

// Default config
const defaultConfig = {
  greetingMessage: "Hello from MCP Demo!",
  maxResults: 10,
  enabled: true
};

// Load or create config
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

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Tool: get greeting
function getGreeting(args) {
  const config = loadConfig();
  if (!config.enabled) {
    return { content: [{ type: 'text', text: 'MCP Demo is currently disabled.' }] };
  }
  
  const name = args.name || 'User';
  const message = config.greetingMessage.replace('{name}', name);
  return { content: [{ type: 'text', text: `${message} Welcome, ${name}!` }] };
}

// Tool: echo
function echo(args) {
  return { content: [{ type: 'text', text: args.text || '' }] };
}

// Tool: get config
function getConfig() {
  const config = loadConfig();
  return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
}

// Tool: update config
function updateConfig(args) {
  const config = loadConfig();
  const newConfig = { ...config, ...args };
  saveConfig(newConfig);
  return { content: [{ type: 'text', text: 'Config updated successfully!' }] };
}

// Tool: list items (demo)
function listItems(args) {
  const config = loadConfig();
  const limit = Math.min(args.limit || config.maxResults, 100);
  
  const items = [];
  for (let i = 1; i <= limit; i++) {
    items.push(`Item ${i}`);
  }
  
  return { content: [{ type: 'text', text: items.join('\n') }] };
}

const server = new Server(
  {
    name: 'mcp-demo',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'greet',
        description: 'Get a personalized greeting message',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' }
          }
        }
      },
      {
        name: 'echo',
        description: 'Echo back the input text',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to echo' }
          }
        }
      },
      {
        name: 'get_config',
        description: 'Get current MCP Demo configuration',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'update_config',
        description: 'Update MCP Demo configuration',
        inputSchema: {
          type: 'object',
          properties: {
            greetingMessage: { type: 'string' },
            maxResults: { type: 'number' },
            enabled: { type: 'boolean' }
          }
        }
      },
      {
        name: 'list_items',
        description: 'List demo items (respects maxResults config)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of items to list' }
          }
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'greet':
      return getGreeting(args);
    case 'echo':
      return echo(args);
    case 'get_config':
      return getConfig();
    case 'update_config':
      return updateConfig(args);
    case 'list_items':
      return listItems(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Demo Server running on stdio');
}

main();
