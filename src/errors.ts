/** Minimum `MaxResults` value allowed by Athena `GetQueryResults`. */
const MIN_MAX_RESULTS = 1;
/** Maximum `MaxResults` value allowed by Athena `GetQueryResults`. */
const MAX_MAX_RESULTS = 1000;

const EMPTY_QUERY_EXECUTION_ID_MESSAGE = 'queryExecutionId must be a non-empty string';

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
  /**
   * Stable error code for logging, metrics, and programmatic handling.
   */
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when `queryExecutionId` is empty or whitespace only.
 */
export class AthenaQueryResultPagerEmptyQueryExecutionIdError extends AthenaQueryResultPagerError {
  readonly code = 'empty-query-execution-id' as const;

  constructor() {
    super(EMPTY_QUERY_EXECUTION_ID_MESSAGE);
  }
}

/**
 * Thrown when `options.maxResults` is not an integer in `1..1000` inclusive.
 */
export class AthenaQueryResultPagerInvalidMaxResultsError extends AthenaQueryResultPagerError {
  readonly code = 'invalid-max-results' as const;

  /**
   * The invalid `maxResults` value that was supplied.
   */
  readonly maxResults: number;

  constructor(maxResults: number) {
    super(describeInvalidMaxResults(maxResults));
    this.maxResults = maxResults;
  }
}
