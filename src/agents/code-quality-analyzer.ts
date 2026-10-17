import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';
import { ESLINT_TOOLS, GITHUB_TOOLS } from '../config/mcp.config.js';

/**
 * Code Quality Analyzer subagent
 * Finds security vulnerabilities, performance issues, and maintainability concerns.
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Code quality and security reviewer. Use this agent to analyze changed files in a pull request for ' +
    'security vulnerabilities, performance problems, bug risks, and maintainability/best-practice issues. ' +
    'Returns per-file issues with line numbers, severity, and a quality score.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'inherit',
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    GITHUB_TOOLS.getFileContents,
    ESLINT_TOOLS.lintFiles
  ]
};
