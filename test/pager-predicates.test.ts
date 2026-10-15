import { hasNextPageToken, isBlankQueryExecutionId } from '../src/core/pager-predicates';

describe('hasNextPageToken', () => {
  it.each([
    [undefined, false],
    ['token', true],
    ['', true],
  ] as const)('hasNextPageToken(%p) → %p', (nextToken, expected) => {
    expect(hasNextPageToken(nextToken)).toBe(expected);
  });
});

describe('isBlankQueryExecutionId', () => {
  it.each([
    ['', true],
    ['   ', true],
    ['\t', true],
    ['exec-1', false],
    [' exec-1 ', false],
  ] as const)('isBlankQueryExecutionId(%p) → %p', (queryExecutionId, expected) => {
    expect(isBlankQueryExecutionId(queryExecutionId)).toBe(expected);
  });
});
