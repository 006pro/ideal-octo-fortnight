import type {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  ReviewReport
} from '../src/types/index.js';

export const validCodeQuality = (file = 'src/app.js'): CodeQualityResult => ({
  file,
  issues: [
    {
      line: 12,
      severity: 'high',
      category: 'security',
      description: 'User input written to innerHTML enables XSS',
      suggestion: 'Use textContent instead of innerHTML'
    },
    {
      line: 30,
      severity: 'low',
      category: 'style',
      description: 'Uses var instead of const',
      suggestion: 'Replace var with const'
    }
  ],
  overallScore: 80,
  summary: 'Mostly fine, one XSS risk.'
});

export const validTestCoverage = (file = 'src/app.js'): TestCoverageResult => ({
  file,
  hasTests: false,
  testFiles: [],
  untestedPaths: [
    {
      type: 'function',
      location: 'searchTodos (line 5)',
      priority: 'high',
      reasoning: 'Core search logic is untested',
      suggestedTest: "expect(searchTodos(todos, 'MILK')).toEqual([milkTodo])"
    }
  ],
  coverageEstimate: 50,
  summary: 'No tests for new search feature.'
});

export const validRefactoring = (file = 'src/app.js'): RefactoringSuggestion => ({
  file,
  suggestions: [
    {
      type: 'modernize',
      location: 'render (line 30)',
      impact: 'low',
      description: 'Use const',
      before: 'var x = 1;',
      after: 'const x = 1;',
      benefits: 'Prevents accidental reassignment'
    }
  ],
  summary: 'Small modernization opportunities.'
});

export const validReport = (): ReviewReport => ({
  pullRequest: { owner: 'udacity', repo: 'todo', number: 2 },
  fileReviews: [
    {
      file: 'src/app.js',
      codeQuality: validCodeQuality(),
      testCoverage: validTestCoverage(),
      refactorings: validRefactoring()
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 70,
    criticalIssues: 1,
    highPriorityTests: 1,
    refactoringOpportunities: 1
  },
  recommendations: [
    {
      priority: 'high',
      category: 'Security',
      description: 'Escape todo titles before rendering',
      files: ['src/app.js']
    }
  ],
  metadata: {
    analyzedAt: '2026-01-01T00:00:00.000Z',
    duration: 0,
    agentVersions: { 'code-quality-analyzer': '1.0.0' }
  }
});
