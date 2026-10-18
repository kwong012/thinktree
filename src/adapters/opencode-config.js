/**
 * Reads opencode's user config so the panel can *identify* what is in play:
 * MCP servers, plugins and agents. Pure filesystem, no network.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), '.config', 'opencode');

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function loadOpencodeConfig({ configDir = CONFIG_DIR } = {}) {
  const cfg = readJson(join(configDir, 'opencode.json'), {});
  const mcp = Object.entries(cfg.mcp || {}).map(([name, v]) => ({
    name,
    type: v.type || 'local',
    enabled: v.enabled !== false,
    command: v.command,
    url: v.url,
  }));

  const plugins = [];
  const pluginDir = join(configDir, 'plugins');
  const pkg = readJson(join(configDir, 'package.json'), {});
  for (const [dep, ver] of Object.entries(pkg.dependencies || {})) {
    if (dep.includes('plugin') || dep.startsWith('@opencode-ai')) plugins.push({ name: dep, version: ver, source: 'package.json' });
  }
  if (existsSync(pluginDir)) {
    for (const f of readdirSync(pluginDir)) plugins.push({ name: f, source: 'plugins/' });
  }
  for (const p of cfg.plugin || []) plugins.push({ name: String(p), source: 'opencode.json' });

  const agents = Object.entries(cfg.agent || {}).map(([name, v]) => ({ name, description: v.description, model: v.model }));
  const agentDir = join(configDir, 'agent');
  if (existsSync(agentDir)) {
    for (const f of readdirSync(agentDir)) {
      if (f.endsWith('.md')) agents.push({ name: f.replace(/\.md$/, ''), source: 'agent/' });
    }
  }

  return { configDir, mcp, plugins, agents };
}

export function mcpServerNames(opts) {
  return loadOpencodeConfig(opts).mcp.filter((m) => m.enabled).map((m) => m.name);
}
