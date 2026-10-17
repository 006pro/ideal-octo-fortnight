import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';
import { GITHUB_TOOLS } from '../config/mcp.config.js';

/**
 * Test Coverage Analyzer subagent
 * Estimates coverage of changed code and suggests concrete missing tests.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage analyst. Use this agent to evaluate whether the functions and branches changed in a pull ' +
    'request are covered by tests, estimate coverage, and propose specific prioritized test cases with assertions.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  model: 'inherit',
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    GITHUB_TOOLS.getFileContents,
    GITHUB_TOOLS.searchCode
  ]
};
