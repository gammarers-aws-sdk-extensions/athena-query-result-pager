import { MAX_MAX_RESULTS, MIN_MAX_RESULTS } from './consts';

const EMPTY_QUERY_EXECUTION_ID_MESSAGE = 'queryExecutionId must be a non-empty string';

const CONCURRENT_ACCESS_MESSAGE =
  'concurrent fetch or iteration is not allowed on the same AthenaQueryExecutionPager';

const describeInvalidMaxResults = (maxResults: number): string =>
  `options.maxResults must be an integer between ${MIN_MAX_RESULTS} and ${MAX_MAX_RESULTS}, got ${String(maxResults)}`;

/**
 * Base error thrown by {@link AthenaQueryResultPager} validation.
 *
 * Catch this type to handle every pager-initiated failure, or catch a subclass for a
 * specific case. {@link code} is a stable machine-readable identifier.
 *
 * Errors propagated from {@link AthenaQueryResultParser} are **not** wrapped; they
 * remain {@link AthenaQueryResultParserError} (or subclasses) when thrown by the parser.
 */
export abstract class AthenaQueryResultPagerError extends Error {
  override readonly name: string = 'AthenaQueryResultPagerError';

  /**
   * Stable error code for logging, metrics, and programmatic handling.
   */
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AthenaQueryResultPagerError.prototype);
  }
}

/**
 * Thrown when `queryExecutionId` is empty or whitespace only
 * (for example on {@link AthenaQueryResultPager.forExecution}).
 */
export class AthenaQueryResultPagerEmptyQueryExecutionIdError extends AthenaQueryResultPagerError {
  override readonly name: string = 'AthenaQueryResultPagerEmptyQueryExecutionIdError';
  readonly code = 'empty-query-execution-id' as const;

  constructor() {
    super(EMPTY_QUERY_EXECUTION_ID_MESSAGE);
    Object.setPrototypeOf(this, AthenaQueryResultPagerEmptyQueryExecutionIdError.prototype);
  }
}

/**
 * Thrown when `options.maxResults` is not an integer in `1..1000` inclusive.
 */
export class AthenaQueryResultPagerInvalidMaxResultsError extends AthenaQueryResultPagerError {
  override readonly name: string = 'AthenaQueryResultPagerInvalidMaxResultsError';
  readonly code = 'invalid-max-results' as const;

  /**
   * The invalid `maxResults` value that was supplied.
   */
  readonly maxResults: number;

  constructor(maxResults: number) {
    super(describeInvalidMaxResults(maxResults));
    this.maxResults = maxResults;
    Object.setPrototypeOf(this, AthenaQueryResultPagerInvalidMaxResultsError.prototype);
  }
}

/**
 * Thrown when a second fetch or iteration starts on the same execution handle
 * while another operation is still in flight.
 */
export class AthenaQueryResultPagerConcurrentAccessError extends AthenaQueryResultPagerError {
  override readonly name: string = 'AthenaQueryResultPagerConcurrentAccessError';
  readonly code = 'concurrent-access' as const;

  constructor() {
    super(CONCURRENT_ACCESS_MESSAGE);
    Object.setPrototypeOf(this, AthenaQueryResultPagerConcurrentAccessError.prototype);
  }
}
