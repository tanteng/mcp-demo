# MCP Demo

A simple MCP (Model Context Protocol) server with a web-based configuration interface.

## Features

- MCP server with 5 tools: `greet`, `echo`, `get_config`, `update_config`, `list_items`
- Web-based config UI at `http://localhost:3001`
- Persistent configuration storage

## Quick Start

```bash
# Install dependencies
npm install

# Start the web config server
npm run start:config

# In another terminal, start the MCP server (for testing)
npm run start
```

## Configuration

Open `http://localhost:3001` in your browser to configure:

- **Enable MCP Server**: Toggle MCP functionality
- **Greeting Message**: Customize the greet message (use `{name}` placeholder)
- **Max Results**: Limit list_items output

## MCP Tools

| Tool | Description |
|------|-------------|
| `greet` | Get a personalized greeting |
| `echo` | Echo back input text |
| `get_config` | View current configuration |
| `update_config` | Update configuration via MCP |
| `list_items` | List demo items |

## Usage with OpenClaw

Add to your config:

```json
{
  "mcpServers": {
    "mcp-demo": {
      "command": "node",
      "args": ["/path/to/mcp-demo/src/index.js"]
    }
  }
}
```

## License

MIT
