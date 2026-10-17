import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';
import { GITHUB_TOOLS } from '../config/mcp.config.js';

/**
 * Refactoring Suggester subagent
 * Identifies design-pattern, modernization, and clean-code opportunities.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring and design advisor. Use this agent to find refactoring opportunities in pull request changes: ' +
    'extract function/class candidates, modern language features, design patterns, dead or redundant code. ' +
    'Returns per-file suggestions with before/after code examples.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: 'inherit',
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    GITHUB_TOOLS.getFileContents
  ]
};
