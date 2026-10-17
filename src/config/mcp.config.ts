import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations (get_pull_request, get_pull_request_files,
   * get_file_contents, search_code, ...)
   *
   * GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The GitHub MCP server expects GITHUB_PERSONAL_ACCESS_TOKEN as the env var name,
   * so we map our GITHUB_TOKEN from .env to this expected name.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis (lint-files)
   * No authentication required.
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
} satisfies Record<string, McpServerConfig>;

/**
 * MCP tool names exposed by the servers above (format: mcp__<server>__<tool>)
 */
export const GITHUB_TOOLS = {
  getPullRequest: 'mcp__github__get_pull_request',
  getPullRequestFiles: 'mcp__github__get_pull_request_files',
  getFileContents: 'mcp__github__get_file_contents',
  searchCode: 'mcp__github__search_code'
} as const;

export const ESLINT_TOOLS = {
  lintFiles: 'mcp__eslint__lint-files'
} as const;
