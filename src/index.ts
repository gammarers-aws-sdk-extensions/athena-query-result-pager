export {
  AthenaQueryExecutionPager,
  AthenaQueryResultPager,
  type PageDetailedResult,
  type PageResult,
  type PagerOptions,
} from './pager';

export {
  AthenaQueryResultPagerConcurrentAccessError,
  AthenaQueryResultPagerEmptyQueryExecutionIdError,
  AthenaQueryResultPagerError,
  AthenaQueryResultPagerInvalidMaxResultsError,
} from './core/errors';

/** Re-exports {@link QueryResultType} from `@aws-sdk/client-athena`. */
export { QueryResultType } from '@aws-sdk/client-athena';
export {
  AthenaQueryResultParserColumnCountMismatchError,
  AthenaQueryResultParserDuplicateColumnNameError,
  AthenaQueryResultParserError,
  AthenaQueryResultParserHeaderRowMismatchError,
  AthenaQueryResultParserInvalidMaxRowsError,
  AthenaQueryResultParserMaxRowsExceededError,
  AthenaQueryResultParserUnavailableResultError,
  EXTRA_COLUMNS_KEY,
  headersFromMeta,
  isHeaderRow,
  parseResultSetDetailedOnce,
  parseResultSetIterOnce,
  parseResultSetOnce,
  parseResultSetWithOnce,
  rowToObject,
  rowToTypedObject,
  toBoolean,
  toDate,
  toNumber,
} from 'athena-query-result-parser';
export type {
  AthenaQueryResultParserOptions,
  AthenaTypedValue,
  ColumnCountMismatchBehavior,
  HeaderRowDecision,
  MaxRowsExceededBehavior,
  ParseResultSetDiagnostics,
  ParseResultSetDetailedResult,
  ParseResultSetOptions,
  ParseResultSetUnavailableReason,
  ParsedRow,
  ParserReusePolicy,
  RowParser,
  TypedParsedRow,
  UnavailableResultBehavior,
} from 'athena-query-result-parser';
