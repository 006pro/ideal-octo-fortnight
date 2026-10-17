/**
 * Subagent exports
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityAnalyzer } from './code-quality-analyzer.js';
import { testCoverageAnalyzer } from './test-coverage-analyzer.js';
import { refactoringSuggester } from './refactoring-suggester.js';

export { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester };

/**
 * Agents keyed by the names the orchestrator prompt uses to invoke them
 */
export const subagents: Record<string, AgentDefinition> = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester
};
