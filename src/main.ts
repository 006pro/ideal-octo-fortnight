import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError } from './utils/error-handler.js';

// Load environment variables
dotenv.config();

const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>\n' +
  'Example: npm run dev -- udacity cd14715-simple-todo-app 1';

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/**
 * Validate command line arguments
 */
function parseArgs(argv: string[]): { owner: string; repo: string; prNumber: number } {
  const [owner, repo, prStr] = argv;

  if (!owner || !repo || !prStr) {
    fail(`Missing arguments.\n${USAGE}`);
  }

  const prNumber = Number.parseInt(prStr, 10);
  if (!/^\d+$/.test(prStr) || !Number.isInteger(prNumber) || prNumber <= 0) {
    fail(`Invalid PR number "${prStr}": must be a positive integer.\n${USAGE}`);
  }

  return { owner, repo, prNumber };
}

/**
 * Validate authentication: Anthropic API key OR AWS Bedrock credentials
 */
function validateAuth(): void {
  const hasAws = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (hasAws) {
    if (!process.env.AWS_REGION) {
      fail('AWS_REGION is required when using AWS Bedrock authentication (e.g. AWS_REGION=us-east-1).');
    }
    console.log('🔐 Using AWS Bedrock authentication');
    return;
  }

  if (hasAnthropic) {
    console.log('🔐 Using Anthropic API authentication');
    return;
  }

  fail(
    'No authentication configured. Set ONE of the following in your environment or .env:\n' +
    '  Option 1 (Anthropic API): ANTHROPIC_API_KEY=sk-ant-...\n' +
    '  Option 2 (AWS Bedrock):   AWS_ACCESS_KEY_ID=..., AWS_SECRET_ACCESS_KEY=..., AWS_REGION=us-east-1'
  );
}

/**
 * Validate the model configuration (required for both auth methods)
 */
function validateModel(): void {
  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      'ANTHROPIC_MODEL environment variable is required. Add it to your .env:\n' +
      '  Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
      '  AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
  }
}

/**
 * Validate the GitHub token. Optional for public repositories, so warn instead of exiting.
 */
function validateGitHubToken(): void {
  if (process.env.GITHUB_TOKEN) {
    console.log('🔑 Using GITHUB_TOKEN for GitHub MCP server');
    return;
  }
  console.warn(
    '⚠️  GITHUB_TOKEN is not set. Public repositories still work, but GitHub API rate limits are low\n' +
    '   and private repositories are inaccessible. Create a token at https://github.com/settings/tokens\n' +
    '   (scopes: repo, read:org) and add GITHUB_TOKEN=ghp_... to your .env.'
  );
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseArgs(process.argv.slice(2));
  validateAuth();
  validateModel();
  validateGitHubToken();

  console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} with model ${process.env.ANTHROPIC_MODEL}...`);

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const reportsDir = path.resolve(process.env.PROJECT_ROOT ?? process.cwd(), 'reports');
    await mkdir(reportsDir, { recursive: true });

    const baseName = `${owner}_${repo}_${prNumber}`;
    const outputs: Array<[string, string]> = [
      [`${baseName}.json`, generator.generateJSONReport(report)],
      [`${baseName}.md`, generator.generateMarkdownReport(report)],
      [`${baseName}.html`, generator.generateHTMLReport(report)]
    ];

    for (const [fileName, content] of outputs) {
      await writeFile(path.join(reportsDir, fileName), content, 'utf-8');
    }

    const { summary } = report;
    console.log('\n✅ Review complete');
    console.log(`   Files reviewed:            ${summary.totalFiles}`);
    console.log(`   Overall score:             ${summary.overallScore}/100`);
    console.log(`   Critical/high issues:      ${summary.criticalIssues}`);
    console.log(`   High-priority tests:       ${summary.highPriorityTests}`);
    console.log(`   Refactoring opportunities: ${summary.refactoringOpportunities}`);
    console.log('\n📄 Reports saved:');
    for (const [fileName] of outputs) {
      console.log(`   ${path.join(reportsDir, fileName)}`);
    }
  } catch (error) {
    console.error(`\n❌ Review failed: ${formatError(error)}`);
    if (process.env.LOG_LEVEL === 'debug' && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`\n❌ Unexpected error: ${formatError(error)}`);
  process.exit(1);
});
