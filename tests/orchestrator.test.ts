import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validReport } from './fixtures.js';

/**
 * Tests for CodeReviewOrchestrator
 * The Agent SDK's query() is mocked so no API calls or MCP servers are started.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

import { CodeReviewOrchestrator, Orchestrator, computeSummary } from '../src/orchestrator.js';
import { ReviewReportSchema } from '../src/types/index.js';
import { ErrorCodes } from '../src/utils/error-handler.js';

type Message = Record<string, unknown>;

function streamOf(...messages: Message[]) {
  return (async function* () {
    for (const message of messages) yield message;
  })();
}

const taskCall = (agent: string): Message => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    content: [{ type: 'tool_use', id: agent, name: 'Task', input: { subagent_type: agent, description: agent } }]
  }
});

const success = (structured_output: unknown): Message => ({
  type: 'result',
  subtype: 'success',
  num_turns: 5,
  total_cost_usd: 0.1,
  result: '',
  structured_output
});

const AGENTS = ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'];

const newOrchestrator = () =>
  new CodeReviewOrchestrator({ model: 'test-model', maxRetries: 0, cwd: '/tmp/project' });

beforeEach(() => {
  queryMock.mockReset();
});

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
      expect(Orchestrator).toBe(CodeReviewOrchestrator);

      const options = orchestrator.buildQueryOptions();
      expect(options.maxTurns).toBe(60);
      expect(options.permissionMode).toBe('dontAsk');
      expect(options.settingSources).toEqual(['project']);
    });

    it('should accept custom rate limit configuration', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: { maxRequestsPerMinute: 1, maxConcurrent: 1, maxTokensPerMinute: 500 }
      });
      expect(orchestrator.rateLimiter.getStatus()).toMatchObject({ availableRequests: 1, availableTokens: 500 });
      expect(orchestrator.rateLimiter.canProceed(600)).toBe(false);
    });

    it('registers MCP servers, subagents, Task tool, and structured output', () => {
      const options = newOrchestrator().buildQueryOptions();

      expect(options.model).toBe('test-model');
      expect(Object.keys(options.mcpServers ?? {})).toEqual(['github', 'eslint']);
      expect(Object.keys(options.agents ?? {})).toEqual(AGENTS);
      expect(options.allowedTools).toEqual(expect.arrayContaining([
        'Task',
        'Skill',
        'mcp__github__get_pull_request',
        'mcp__github__get_pull_request_files'
      ]));
      expect(options.outputFormat?.type).toBe('json_schema');
      expect(options.outputFormat?.schema).toMatchObject({ type: 'object' });

      for (const agent of Object.values(options.agents ?? {})) {
        expect(agent.model).toBe('inherit');
        expect(agent.tools).toContain('Skill');
        expect(agent.description.length).toBeGreaterThan(20);
      }
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      queryMock.mockReturnValue(streamOf(success(validReport())));
      await newOrchestrator().reviewPullRequest('udacity', 'todo', 2);

      const { prompt } = queryMock.mock.calls[0]![0];
      expect(prompt).toContain('mcp__github__get_pull_request_files');
      expect(prompt).toContain('owner="udacity"');
      expect(prompt).toContain('pull_number=2');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      queryMock.mockReturnValue(streamOf(...AGENTS.map(taskCall), success(validReport())));
      await newOrchestrator().reviewPullRequest('udacity', 'todo', 2);

      const { prompt } = queryMock.mock.calls[0]![0];
      for (const agent of AGENTS) {
        expect(prompt).toContain(`Use the ${agent} agent`);
      }
      expect(prompt).toMatch(/IN PARALLEL/);
    });

    it('should aggregate results into ReviewReport', async () => {
      const raw = validReport();
      raw.summary = { totalFiles: 99, overallScore: 1, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 };
      queryMock.mockReturnValue(streamOf(success(raw)));

      const report = await newOrchestrator().reviewPullRequest('owner', 'repo', 7);

      expect(report.pullRequest).toEqual({ owner: 'owner', repo: 'repo', number: 7 });
      // Summary is recomputed from findings: 0.6*80 + 0.4*50 = 68
      expect(report.summary).toEqual({
        totalFiles: 1,
        overallScore: 68,
        criticalIssues: 1,
        highPriorityTests: 1,
        refactoringOpportunities: 1
      });
      expect(Object.keys(report.metadata.agentVersions)).toEqual(AGENTS);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });

    it('should validate output with Zod schema', async () => {
      queryMock.mockReturnValue(streamOf(success({ pullRequest: {} })));
      const error = await newOrchestrator().reviewPullRequest('a', 'b', 1).catch(e => e);
      expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
      expect(error.metadata.lastErrorCode).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(error.metadata.lastErrorMetadata.issues.length).toBeGreaterThan(0);
    });

    it('should fail when structured output is missing', async () => {
      queryMock.mockReturnValue(streamOf(success(undefined)));
      const error = await newOrchestrator().reviewPullRequest('a', 'b', 1).catch(e => e);
      expect(error.metadata.lastErrorCode).toBe(ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    });

    it('should surface agent failures as AGENT_FAILED', async () => {
      queryMock.mockReturnValue(streamOf({ type: 'result', subtype: 'error_max_turns', num_turns: 60 }));
      const error = await newOrchestrator().reviewPullRequest('a', 'b', 1).catch(e => e);
      expect(error.metadata.lastErrorCode).toBe(ErrorCodes.AGENT_FAILED);
      expect(error.message).toContain('error_max_turns');
    });

    it('should retry failed reviews and release the rate limiter', async () => {
      queryMock
        .mockReturnValueOnce(streamOf({ type: 'result', subtype: 'error_during_execution', num_turns: 1 }))
        .mockReturnValueOnce(streamOf(success(validReport())));

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });
      const report = await orchestrator.reviewPullRequest('a', 'b', 1);

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(report.fileReviews).toHaveLength(1);
      expect(orchestrator.rateLimiter.getStatus().activeRequests).toBe(0);
    });

    it('should report RETRY_EXHAUSTED when every attempt fails', async () => {
      queryMock.mockImplementation(() => streamOf({ type: 'result', subtype: 'error_during_execution', num_turns: 1 }));
      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1, retryDelayMs: 1 });
      const error = await orchestrator.reviewPullRequest('a', 'b', 1).catch(e => e);
      expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
      expect(orchestrator.rateLimiter.getStatus().activeRequests).toBe(0);
    });
  });

  describe('computeSummary', () => {
    it('returns zeros and a perfect score for no files', () => {
      expect(computeSummary([])).toEqual({
        totalFiles: 0,
        overallScore: 100,
        criticalIssues: 0,
        highPriorityTests: 0,
        refactoringOpportunities: 0
      });
    });
  });

  describe('Integration', () => {
    // Requires real API keys; run manually with RUN_INTEGRATION=1
    it.skipIf(!process.env.RUN_INTEGRATION)('should review a real small PR', async () => {
      const { query } = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
        '@anthropic-ai/claude-agent-sdk'
      );
      queryMock.mockImplementation(query);
      const report = await new CodeReviewOrchestrator().reviewPullRequest('udacity', 'cd14715-simple-todo-app', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
      expect(report.fileReviews.length).toBeGreaterThan(0);
    }, 30 * 60 * 1000);
  });
});
