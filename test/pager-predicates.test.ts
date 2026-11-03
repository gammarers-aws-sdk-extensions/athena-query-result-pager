import {
  hasNextPageToken,
  isAbortRequested,
  isBlankQueryExecutionId,
  normalizeQueryExecutionId,
} from '../src/core/pager-predicates';

describe('hasNextPageToken', () => {
  it.each([
    [undefined, false],
    ['token', true],
    ['', true],
  ] as const)('hasNextPageToken(%p) → %p', (nextToken, expected) => {
    expect(hasNextPageToken(nextToken)).toBe(expected);
  });
});

describe('isAbortRequested', () => {
  const notAborted = new AbortController().signal;
  const abortedController = new AbortController();
  abortedController.abort();

  it.each([
    [undefined, false],
    [notAborted, false],
    [abortedController.signal, true],
  ] as const)('isAbortRequested(%p) → %p', (signal, expected) => {
    expect(isAbortRequested(signal)).toBe(expected);
  });
});

describe('normalizeQueryExecutionId', () => {
  it.each([
    ['exec-1', 'exec-1'],
    [' exec-1 ', 'exec-1'],
    ['\texec-1\n', 'exec-1'],
    ['exec 1', 'exec 1'],
    ['', ''],
    ['   ', ''],
  ] as const)('normalizeQueryExecutionId(%p) → %p', (queryExecutionId, expected) => {
    expect(normalizeQueryExecutionId(queryExecutionId)).toBe(expected);
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
