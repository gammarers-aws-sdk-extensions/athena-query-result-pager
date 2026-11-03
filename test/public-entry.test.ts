import * as entry from '../src';

/**
 * Runtime names re-exported from `src/index.ts`.
 * Each export compiles to a getter, and coverage counts that getter as a function.
 */
const RUNTIME_EXPORTS = [
  'AthenaQueryExecutionPager',
  'AthenaQueryResultPager',
  'AthenaQueryResultPagerAbortError',
  'AthenaQueryResultPagerConcurrentAccessError',
  'AthenaQueryResultPagerEmptyQueryExecutionIdError',
  'AthenaQueryResultPagerError',
  'AthenaQueryResultPagerInvalidMaxResultsError',
  'AthenaQueryResultParserArgumentError',
  'AthenaQueryResultParserColumnCountMismatchError',
  'AthenaQueryResultParserDuplicateColumnNameError',
  'AthenaQueryResultParserError',
  'AthenaQueryResultParserHeaderRowMismatchError',
  'AthenaQueryResultParserInvalidMaxRowsError',
  'AthenaQueryResultParserMaxRowsExceededError',
  'AthenaQueryResultParserUnavailableResultError',
  'AthenaQueryResultParserUnparseableValueError',
  'EXTRA_COLUMNS_KEY',
  'QueryResultType',
  'headersFromMeta',
  'isHeaderRow',
  'parseResultSetDetailedOnce',
  'parseResultSetIterOnce',
  'parseResultSetOnce',
  'parseResultSetWithOnce',
  'rowToObject',
  'rowToTypedObject',
  'toBoolean',
  'toDate',
  'toNumber',
] as const satisfies readonly (keyof typeof entry)[];

describe('public entry', () => {
  it('should export the runtime API', () => {
    expect(Object.keys(entry).sort()).toEqual([...RUNTIME_EXPORTS].sort());
  });

  it.each(RUNTIME_EXPORTS)('should define %s', (name) => {
    expect(entry[name]).toBeDefined();
  });
});
