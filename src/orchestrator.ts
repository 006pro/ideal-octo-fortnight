import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types.js';
import type { ReviewReport } from './types/report-types.js';
import { subagents } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { mcpServersConfig, GITHUB_TOOLS, ESLINT_TOOLS } from './config/mcp.config.js';
import { RateLimiter } from './utils/rate-limiter.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout } from './utils/error-handler.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError,
  logAgentStart
} from './utils/logger.js';

const AGENT_VERSION = '1.0.0';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Model id; defaults to ANTHROPIC_MODEL */
  model?: string;
  /** Max agentic turns for the orchestrator (default: 60) */
  maxTurns?: number;
  /** Timeout for a whole review in ms (default: 20 minutes) */
  timeoutMs?: number;
  /** Retries of the whole review on failure (default: 1) */
  maxRetries?: number;
  /** Base backoff delay between retries in ms (default: 2000) */
  retryDelayMs?: number;
  /** Rate limiter overrides */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Estimated tokens per review, used by the rate limiter (default: 20000) */
  estimatedTokens?: number;
  /** Working directory containing .claude/skills (default: PROJECT_ROOT or cwd) */
  cwd?: string;
}

type FileReview = ReviewReport['fileReviews'][number];

/**
 * Compute summary statistics from the aggregated file reviews.
 * Done in code so scores are derived from the actual findings, not model arithmetic.
 */
export function computeSummary(fileReviews: FileReview[]): ReviewReport['summary'] {
  const totalFiles = fileReviews.length;

  const fileScores = fileReviews.map(
    r => 0.6 * r.codeQuality.overallScore + 0.4 * r.testCoverage.coverageEstimate
  );
  const overallScore = totalFiles === 0
    ? 100
    : Math.round(fileScores.reduce((sum, s) => sum + s, 0) / totalFiles);

  const criticalIssues = fileReviews.reduce(
    (sum, r) => sum + r.codeQuality.issues.filter(
      i => i.severity === 'critical' || i.severity === 'high'
    ).length,
    0
  );

  const highPriorityTests = fileReviews.reduce(
    (sum, r) => sum + r.testCoverage.untestedPaths.filter(
      p => p.priority === 'critical' || p.priority === 'high'
    ).length,
    0
  );

  const refactoringOpportunities = fileReviews.reduce(
    (sum, r) => sum + r.refactorings.suggestions.length,
    0
  );

  return { totalFiles, overallScore, criticalIssues, highPriorityTests, refactoringOpportunities };
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model: string | undefined;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly estimatedTokens: number;
  private readonly cwd: string;
  readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL;
    this.maxTurns = options.maxTurns ?? 60;
    this.timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 2000;
    this.estimatedTokens = options.estimatedTokens ?? 20000;
    this.cwd = options.cwd ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.rateLimiter = new RateLimiter(options.rateLimits);
  }

  /**
   * Build the Agent SDK options for a review
   */
  buildQueryOptions(): Options {
    return {
      model: this.model,
      cwd: this.cwd,
      mcpServers: mcpServersConfig,
      agents: subagents,
      allowedTools: [
        'Task',
        'Skill',
        'Read',
        'Grep',
        'Glob',
        GITHUB_TOOLS.getPullRequest,
        GITHUB_TOOLS.getPullRequestFiles,
        GITHUB_TOOLS.getFileContents,
        GITHUB_TOOLS.searchCode,
        ESLINT_TOOLS.lintFiles
      ],
      // Load skills from <cwd>/.claude/skills
      settingSources: ['project'],
      // Unattended CI use: never prompt, deny anything not in allowedTools
      permissionMode: 'dontAsk',
      maxTurns: this.maxTurns,
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema
      }
    };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    await this.rateLimiter.acquire(this.estimatedTokens);
    try {
      const report = await withRetry(
        () => withTimeout(
          () => this.runReview(owner, repo, prNumber, startedAt),
          this.timeoutMs,
          `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs}ms`
        ),
        this.maxRetries,
        this.retryDelayMs
      );

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, report.metadata.duration);
      return report;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * Run one orchestrator query and turn its structured output into a validated report
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number,
    startedAt: number
  ): Promise<ReviewReport> {
    const structuredOutput = await this.runQuery(buildOrchestratorPrompt(owner, repo, prNumber));

    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new ReviewError(
        'Structured output does not match ReviewReport schema',
        ErrorCodes.VALIDATION_FAILED,
        { issues: parsed.error.issues }
      );
    }

    const report = parsed.data;
    return {
      ...report,
      pullRequest: { owner, repo, number: prNumber },
      summary: computeSummary(report.fileReviews),
      metadata: {
        analyzedAt: new Date().toISOString(),
        duration: Date.now() - startedAt,
        agentVersions: Object.fromEntries(
          Object.keys(subagents).map(name => [name, AGENT_VERSION])
        )
      }
    };
  }

  /**
   * Stream the SDK query and return the final structured_output
   */
  private async runQuery(prompt: string): Promise<unknown> {
    const stream = query({ prompt, options: this.buildQueryOptions() });

    for await (const message of stream) {
      this.logProgress(message);

      if (message.type !== 'result') continue;

      if (message.subtype === 'success') {
        if (message.structured_output === undefined) {
          throw new ReviewError(
            'Review finished without structured output',
            ErrorCodes.STRUCTURED_OUTPUT_FAILED,
            { result: message.result }
          );
        }
        logger.info('Orchestrator finished', {
          turns: message.num_turns,
          costUsd: message.total_cost_usd
        });
        return message.structured_output;
      }

      throw new ReviewError(
        `Orchestrator failed: ${message.subtype}`,
        message.subtype === 'error_max_structured_output_retries'
          ? ErrorCodes.STRUCTURED_OUTPUT_FAILED
          : ErrorCodes.AGENT_FAILED,
        { subtype: message.subtype, turns: message.num_turns }
      );
    }

    throw new ReviewError('Orchestrator ended without a result message', ErrorCodes.AGENT_FAILED);
  }

  /**
   * Log tool calls so subagent dispatch is visible in the logs
   */
  private logProgress(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      logger.info('Orchestrator session started', {
        mcpServers: message.mcp_servers
      });
      return;
    }
    if (message.type !== 'assistant' || message.parent_tool_use_id !== null) return;

    for (const block of message.message.content) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'Task') {
        const input = block.input as { subagent_type?: string; description?: string };
        logAgentStart(input.subagent_type ?? 'unknown', input.description ?? '');
        logger.info('Dispatching subagent', { agent: input.subagent_type });
      } else {
        logger.debug('Tool call', { tool: block.name });
      }
    }
  }
}

export { CodeReviewOrchestrator as Orchestrator };
