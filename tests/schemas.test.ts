import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
  ReviewReportJSONSchema
} from '../src/types/index.js';
import {
  validCodeQuality,
  validTestCoverage,
  validRefactoring,
  validReport
} from './fixtures.js';

describe('CodeQualityResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQuality())).not.toThrow();
  });

  it('accepts an empty issues array', () => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality(), issues: [] })).not.toThrow();
  });

  it.each([0, 100])('accepts boundary score %i', score => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality(), overallScore: score })).not.toThrow();
  });

  it.each([-1, 101])('rejects out-of-range score %i', score => {
    expect(() => CodeQualityResultSchema.parse({ ...validCodeQuality(), overallScore: score })).toThrow(ZodError);
  });

  it('rejects an invalid severity', () => {
    const data = validCodeQuality();
    data.issues[0]!.severity = 'blocker' as never;
    expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid category', () => {
    const data = validCodeQuality();
    data.issues[0]!.category = 'typo' as never;
    expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects a string line number', () => {
    const data = { ...validCodeQuality(), issues: [{ ...validCodeQuality().issues[0], line: '12' }] };
    expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects missing required fields', () => {
    const { summary: _summary, ...withoutSummary } = validCodeQuality();
    expect(() => CodeQualityResultSchema.parse(withoutSummary)).toThrow(ZodError);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverage())).not.toThrow();
  });

  it('accepts empty arrays', () => {
    const data = { ...validTestCoverage(), testFiles: [], untestedPaths: [] };
    expect(() => TestCoverageResultSchema.parse(data)).not.toThrow();
  });

  it.each([0, 100])('accepts boundary coverage %i', coverage => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage(), coverageEstimate: coverage })).not.toThrow();
  });

  it.each([-5, 150])('rejects out-of-range coverage %i', coverage => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage(), coverageEstimate: coverage })).toThrow(ZodError);
  });

  it('rejects a non-boolean hasTests', () => {
    expect(() => TestCoverageResultSchema.parse({ ...validTestCoverage(), hasTests: 'no' })).toThrow(ZodError);
  });

  it('rejects an invalid untested path type and priority', () => {
    const badType = validTestCoverage();
    badType.untestedPaths[0]!.type = 'module' as never;
    expect(() => TestCoverageResultSchema.parse(badType)).toThrow(ZodError);

    const badPriority = validTestCoverage();
    badPriority.untestedPaths[0]!.priority = 'info' as never;
    expect(() => TestCoverageResultSchema.parse(badPriority)).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts valid data', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoring())).not.toThrow();
  });

  it('accepts an empty suggestions array', () => {
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring(), suggestions: [] })).not.toThrow();
  });

  it('rejects an invalid suggestion type and impact', () => {
    const badType = validRefactoring();
    badType.suggestions[0]!.type = 'rewrite' as never;
    expect(() => RefactoringSuggestionSchema.parse(badType)).toThrow(ZodError);

    const badImpact = validRefactoring();
    badImpact.suggestions[0]!.impact = 'critical' as never;
    expect(() => RefactoringSuggestionSchema.parse(badImpact)).toThrow(ZodError);
  });

  it('rejects a suggestion missing before/after code', () => {
    const { before: _before, after: _after, ...rest } = validRefactoring().suggestions[0]!;
    expect(() => RefactoringSuggestionSchema.parse({ ...validRefactoring(), suggestions: [rest] })).toThrow(ZodError);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(() => ReviewReportSchema.parse(validReport())).not.toThrow();
  });

  it('accepts a report with no files and no recommendations', () => {
    const data = { ...validReport(), fileReviews: [], recommendations: [] };
    expect(() => ReviewReportSchema.parse(data)).not.toThrow();
  });

  it('rejects a non-numeric PR number', () => {
    const data = { ...validReport(), pullRequest: { owner: 'a', repo: 'b', number: '1' } };
    expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid recommendation priority', () => {
    const data = validReport();
    data.recommendations[0]!.priority = 'urgent' as never;
    expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects an invalid nested file review', () => {
    const data = validReport();
    data.fileReviews[0]!.codeQuality.overallScore = 200;
    expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
  });

  it('rejects missing metadata and non-string agent versions', () => {
    const { metadata: _metadata, ...withoutMetadata } = validReport();
    expect(() => ReviewReportSchema.parse(withoutMetadata)).toThrow(ZodError);

    const data = validReport();
    (data.metadata.agentVersions as Record<string, unknown>).x = 1;
    expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
  });
});

describe('JSON schema export for SDK structured outputs', () => {
  const schemas = {
    CodeQualityResultJSONSchema,
    TestCoverageResultJSONSchema,
    RefactoringSuggestionJSONSchema,
    ReviewReportJSONSchema
  };

  it.each(Object.entries(schemas))('%s is an object schema without unresolved $refs', (_name, schema) => {
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTypeOf('object');
    // Every $ref (if any) must point inside the schema itself
    const refs = JSON.stringify(schema).match(/"\$ref":"([^"]+)"/g) ?? [];
    for (const ref of refs) {
      expect(ref).toMatch(/"\$ref":"#/);
    }
  });

  it('marks the required ReviewReport properties', () => {
    expect(ReviewReportJSONSchema.required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });

  it('marks the required CodeQualityResult properties and enum values', () => {
    expect(CodeQualityResultJSONSchema.required).toEqual(
      expect.arrayContaining(['file', 'issues', 'overallScore', 'summary'])
    );
    const issues = (CodeQualityResultJSONSchema.properties as Record<string, any>).issues;
    expect(issues.items.properties.severity.enum).toEqual(['critical', 'high', 'medium', 'low', 'info']);
  });

  it('includes score bounds', () => {
    const score = (CodeQualityResultJSONSchema.properties as Record<string, any>).overallScore;
    expect(score.minimum).toBe(0);
    expect(score.maximum).toBe(100);
  });
});
