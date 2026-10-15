import {
  AthenaClient,
  GetQueryResultsCommand,
  QueryResultType,
  type GetQueryResultsCommandInput,
  type GetQueryResultsCommandOutput,
} from '@aws-sdk/client-athena';
import {
  AthenaQueryResultParser,
  type HeaderRowDecision,
  type ParseResultSetDiagnostics,
  type ParseResultSetOptions,
  type ParsedRow,
  type RowParser,
} from 'athena-query-result-parser';
import { DEFAULT_MAX_RESULTS, MAX_MAX_RESULTS, MIN_MAX_RESULTS } from './core/consts';
import {
  AthenaQueryResultPagerConcurrentAccessError,
  AthenaQueryResultPagerEmptyQueryExecutionIdError,
  AthenaQueryResultPagerInvalidMaxResultsError,
} from './core/errors';
import { hasNextPageToken, isBlankQueryExecutionId } from './core/pager-predicates';

/** Default `QueryResultType` forwarded to Athena `GetQueryResults`. */
const DEFAULT_QUERY_RESULT_TYPE = QueryResultType.DATA_ROWS;

/**
 * One page of Athena query results returned by {@link AthenaQueryExecutionPager} after a fetch or generator step.
 *
 * @typeParam T - Row representation; use {@link ParsedRow} or a type produced by {@link RowParser}.
 */
export interface PageResult<T> {
  /** Parsed rows for this page only. */
  rows: T[];
  /** Continuation token for the following page (`undefined` when this is the last page). */
  nextToken?: string;
  /** Same as `rows.length` for convenience. */
  rowCount: number;
}

/**
 * One page of Athena query results with {@link ParseResultSetDiagnostics} from
 * {@link AthenaQueryResultParser.parseResultSetDetailed}.
 */
export interface PageDetailedResult extends PageResult<ParsedRow> {
  /** Parser diagnostics for this page only (header-row decision, raw row count, truncation, …). */
  diagnostics: ParseResultSetDiagnostics;
}

/**
 * Settings applied to every `GetQueryResults` invocation made by {@link AthenaQueryExecutionPager}.
 */
export interface PagerOptions {
  /**
   * `MaxResults` per request — must be an integer from 1 through 1000 (Athena limits).
   * @defaultValue 1000
   */
  maxResults?: number;
  /**
   * Athena `GetQueryResults` {@link QueryResultType} — any member of the AWS SDK enum
   * (for example {@link QueryResultType.DATA_ROWS} for tabular rows or {@link QueryResultType.DATA_MANIFEST}
   * for CTAS / UNLOAD / INSERT manifest outputs when Athena supports them).
   * @defaultValue {@link QueryResultType.DATA_ROWS}
   */
  queryResultType?: QueryResultType;
  /**
   * Options forwarded to every {@link AthenaQueryResultParser.parseResultSet} /
   * {@link AthenaQueryResultParser.parseResultSetWith} call (for example
   * `columnCountMismatchBehavior`, `skipHeaderRow`, `headerRowDetectionStrategy`,
   * `unavailableResultBehavior`, `maxRows`).
   *
   * @see ParseResultSetOptions
   */
  parseResultSetOptions?: ParseResultSetOptions;
}

type NormalizedPagerOptions = Required<Pick<PagerOptions, 'maxResults' | 'queryResultType'>>;

/**
 * Factory for execution-scoped Athena result pagers.
 *
 * Holds shared `AthenaClient` and {@link PagerOptions} only. Call {@link AthenaQueryResultPager.forExecution}
 * to obtain an {@link AthenaQueryExecutionPager} with its own parser state.
 *
 * Does not wait for query completion or add Athena-specific retry: callers should wait until the execution
 * succeeds (for example via `GetQueryExecution`) and configure SDK / application-level retry for throttling.
 *
 * @see {@link https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/athena/command/GetQueryResultsCommand/ | GetQueryResultsCommand (AWS SDK)}
 */
export class AthenaQueryResultPager {

  /**
   * Reports whether another results page is available for the same query execution.
   *
   * @typeParam T - Row type held in {@link PageResult.rows}.
   * @param pageResult - The most recently retrieved page from `fetchPage`, `fetchPageWith`, or a page iterator.
   * @returns `true` when {@link PageResult.nextToken} is defined and another page should be fetched.
   */
  static readonly hasNextPage = <T>(pageResult: PageResult<T>): boolean =>
    hasNextPageToken(pageResult.nextToken);

  /** SDK v3 client used for every `GetQueryResults` call. */
  private readonly client: AthenaClient;
  /** Normalized pager settings (every field set after merging defaults). */
  private readonly options: NormalizedPagerOptions;
  /** Parser options applied on every page parse (undefined uses parser defaults). */
  private readonly parseResultSetOptions?: ParseResultSetOptions;

  /**
   * Creates a pager bound to `client` with optional per-request defaults.
   *
   * @param client - SDK v3 `AthenaClient` used to call `GetQueryResults`.
   * @param options - Optional `MaxResults`, `QueryResultType`, and `ParseResultSetOptions`; defaults apply when omitted.
   * @throws {AthenaQueryResultPagerInvalidMaxResultsError} When `maxResults` is not an integer in `1..1000` inclusive.
   */
  constructor(client: AthenaClient, options: PagerOptions = {}) {
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    if (
      !Number.isInteger(maxResults)
      || maxResults < MIN_MAX_RESULTS
      || maxResults > MAX_MAX_RESULTS
    ) {
      throw new AthenaQueryResultPagerInvalidMaxResultsError(maxResults);
    }

    this.client = client;
    this.options = {
      maxResults,
      queryResultType: options.queryResultType ?? DEFAULT_QUERY_RESULT_TYPE,
    };
    this.parseResultSetOptions = options.parseResultSetOptions;
  }

  /**
   * Returns an execution-scoped handle with its own parser state for `queryExecutionId`.
   *
   * Separate handles may run concurrently. Concurrent fetch or iteration on the **same** handle
   * throws {@link AthenaQueryResultPagerConcurrentAccessError}.
   *
   * @param queryExecutionId - Athena query execution identifier.
   * @returns A handle bound to `queryExecutionId`.
   * @throws {AthenaQueryResultPagerEmptyQueryExecutionIdError} When `queryExecutionId` is empty or whitespace only.
   */
  readonly forExecution = (queryExecutionId: string): AthenaQueryExecutionPager => {
    if (isBlankQueryExecutionId(queryExecutionId)) {
      throw new AthenaQueryResultPagerEmptyQueryExecutionIdError();
    }

    return AthenaQueryExecutionPager.create(
      this.client,
      this.options,
      this.parseResultSetOptions,
      queryExecutionId,
    );
  };
}

/**
 * Paginates `GetQueryResults` for a single Athena query execution.
 *
 * Owns a dedicated {@link AthenaQueryResultParser} so header-row state stays isolated per execution.
 * Overlapping fetch or iteration on this instance throws {@link AthenaQueryResultPagerConcurrentAccessError}.
 *
 * Provides paired APIs for raw {@link ParsedRow} access versus custom {@link RowParser} mapping at the page level
 * (`fetchPage` / `fetchPageWith`, `iteratePages` / `iteratePagesWith`) and at the row level
 * (`iterateRows` with or without `rowParser`). Use {@link AthenaQueryExecutionPager.fetchPageDetailed} when
 * per-page {@link ParseResultSetDiagnostics} is needed.
 *
 * Create via {@link AthenaQueryResultPager.forExecution}.
 */
export class AthenaQueryExecutionPager {

  /**
   * Prefer {@link AthenaQueryResultPager.forExecution}. Validates `queryExecutionId` and builds a handle.
   *
   * @param client - SDK v3 `AthenaClient` used to call `GetQueryResults`.
   * @param options - Normalized `MaxResults` and `QueryResultType`.
   * @param parseResultSetOptions - Options forwarded to every parse call.
   * @param queryExecutionId - Non-empty Athena query execution identifier.
   * @returns A new execution-scoped pager.
   * @throws {AthenaQueryResultPagerEmptyQueryExecutionIdError} When `queryExecutionId` is empty or whitespace only.
   */
  static readonly create = (
    client: AthenaClient,
    options: NormalizedPagerOptions,
    parseResultSetOptions: ParseResultSetOptions | undefined,
    queryExecutionId: string,
  ): AthenaQueryExecutionPager =>
    new AthenaQueryExecutionPager(client, options, parseResultSetOptions, queryExecutionId);

  /** SDK v3 client used for every `GetQueryResults` call. */
  private readonly client: AthenaClient;
  /** Normalized pager settings from the parent {@link AthenaQueryResultPager}. */
  private readonly options: NormalizedPagerOptions;
  /** Parser options applied on every page parse (undefined uses parser defaults). */
  private readonly parseResultSetOptions?: ParseResultSetOptions;
  /** Bound Athena query execution identifier. */
  private readonly queryExecutionId: string;
  /** Stateful parser reused across pages of this execution only. */
  private readonly parser: AthenaQueryResultParser;
  /** True while a fetch or iteration holds exclusive access to this handle. */
  private inFlight = false;

  /**
   * @param client - SDK v3 `AthenaClient` used to call `GetQueryResults`.
   * @param options - Normalized `MaxResults` and `QueryResultType`.
   * @param parseResultSetOptions - Options forwarded to every parse call.
   * @param queryExecutionId - Non-empty Athena query execution identifier.
   */
  private constructor(
    client: AthenaClient,
    options: NormalizedPagerOptions,
    parseResultSetOptions: ParseResultSetOptions | undefined,
    queryExecutionId: string,
  ) {
    if (isBlankQueryExecutionId(queryExecutionId)) {
      throw new AthenaQueryResultPagerEmptyQueryExecutionIdError();
    }

    this.client = client;
    this.options = options;
    this.parseResultSetOptions = parseResultSetOptions;
    this.queryExecutionId = queryExecutionId;
    // Default reusePolicy is 'paginate': retain headers / header-row-dropped across pages of one query.
    this.parser = AthenaQueryResultParser.create();
  }

  /**
   * Marks this handle busy; throws when another operation is already in flight.
   */
  private readonly enter = (): void => {
    if (this.inFlight) {
      throw new AthenaQueryResultPagerConcurrentAccessError();
    }
    this.inFlight = true;
  };

  /**
   * Clears the in-flight flag after an exclusive operation finishes.
   */
  private readonly leave = (): void => {
    this.inFlight = false;
  };

  /**
   * Runs `operation` under exclusive access to this handle.
   *
   * @typeParam T - Result type of `operation`.
   * @param operation - Async work that must not overlap with other uses of this handle.
   * @returns The result of `operation`.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  private readonly runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    this.enter();
    try {
      return await operation();
    } finally {
      this.leave();
    }
  };

  /**
   * Invokes `GetQueryResults` for the bound execution (caller must already hold exclusive access).
   *
   * @param nextToken - Continuation token from a prior page, if any.
   * @returns Raw AWS response for the requested page.
   */
  private readonly sendGetQueryResults = async (
    nextToken?: string,
  ): Promise<GetQueryResultsCommandOutput> => {
    const input: GetQueryResultsCommandInput = {
      QueryExecutionId: this.queryExecutionId,
      NextToken: nextToken,
      MaxResults: this.options.maxResults,
      QueryResultType: this.options.queryResultType,
    };

    return this.client.send(new GetQueryResultsCommand(input));
  };

  /**
   * Fetches one {@link ParsedRow} page without taking exclusive access (caller must already hold it).
   *
   * @param nextToken - Continuation token from a prior page, if any.
   * @returns Parsed rows plus pagination metadata from this response only.
   */
  private readonly fetchPageUnlocked = async (
    nextToken?: string,
  ): Promise<PageResult<ParsedRow>> => {
    const response = await this.sendGetQueryResults(nextToken);
    const rows = this.parser.parseResultSet(response.ResultSet, this.parseResultSetOptions);

    return {
      rows,
      nextToken: response.NextToken,
      rowCount: rows.length,
    };
  };

  /**
   * Fetches one detailed page without taking exclusive access (caller must already hold it).
   *
   * @param nextToken - Continuation token from a prior page, if any.
   * @returns Parsed rows, pagination metadata, and parser diagnostics for this response only.
   */
  private readonly fetchPageDetailedUnlocked = async (
    nextToken?: string,
  ): Promise<PageDetailedResult> => {
    const response = await this.sendGetQueryResults(nextToken);
    const parsed = this.parser.parseResultSetDetailed(response.ResultSet, this.parseResultSetOptions);

    return {
      rows: parsed.rows,
      nextToken: response.NextToken,
      rowCount: parsed.rows.length,
      diagnostics: parsed.diagnostics,
    };
  };

  /**
   * Fetches one mapped page without taking exclusive access (caller must already hold it).
   *
   * @typeParam T - Output type produced by `rowParser`.
   * @param rowParser - Converts each dictionary row into `T`.
   * @param nextToken - Continuation token from a prior page, if any.
   * @returns Transformed rows plus pagination metadata from this response only.
   */
  private readonly fetchPageWithUnlocked = async <T>(
    rowParser: RowParser<T>,
    nextToken?: string,
  ): Promise<PageResult<T>> => {
    const response = await this.sendGetQueryResults(nextToken);
    const rows = this.parser.parseResultSetWith(
      response.ResultSet,
      rowParser,
      this.parseResultSetOptions,
    );

    return {
      rows,
      nextToken: response.NextToken,
      rowCount: rows.length,
    };
  };

  /**
   * Retrieves a single results page as dictionary-shaped {@link ParsedRow} values.
   *
   * Uses {@link AthenaQueryResultParser.parseResultSet} on the AWS response.
   *
   * @param nextToken - Pass `undefined` first; subsequent calls use {@link PageResult.nextToken}.
   * @returns Parsed rows plus pagination metadata from this response only.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  readonly fetchPage = async (nextToken?: string): Promise<PageResult<ParsedRow>> =>
    this.runExclusive(() => this.fetchPageUnlocked(nextToken));

  /**
   * Retrieves one page as {@link ParsedRow} values plus {@link ParseResultSetDiagnostics}.
   *
   * Uses {@link AthenaQueryResultParser.parseResultSetDetailed} on the AWS response.
   *
   * @param nextToken - Pass `undefined` first; subsequent calls use {@link PageDetailedResult.nextToken}.
   * @returns Parsed rows, pagination metadata, and parser diagnostics for this response only.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  readonly fetchPageDetailed = async (nextToken?: string): Promise<PageDetailedResult> =>
    this.runExclusive(() => this.fetchPageDetailedUnlocked(nextToken));

  /**
   * Retrieves one page and maps each {@link ParsedRow} through `rowParser`.
   *
   * Uses {@link AthenaQueryResultParser.parseResultSetWith} on the AWS response.
   *
   * @typeParam T - Output type produced by `rowParser`.
   * @param rowParser - Converts each dictionary row into `T`.
   * @param nextToken - Pass `undefined` first; subsequent calls use {@link PageResult.nextToken}.
   * @returns Transformed rows plus pagination metadata from this response only.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  readonly fetchPageWith = async <T>(
    rowParser: RowParser<T>,
    nextToken?: string,
  ): Promise<PageResult<T>> =>
    this.runExclusive(() => this.fetchPageWithUnlocked(rowParser, nextToken));

  /**
   * Lazily walks all pages for this execution, yielding one {@link PageResult} of {@link ParsedRow} per step.
   *
   * Holds exclusive access for the entire iteration (from first `next()` until completion or early return).
   *
   * @yields One page at a time until AWS returns no `NextToken`.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  async *iteratePages(): AsyncGenerator<PageResult<ParsedRow>> {
    this.enter();
    try {
      let nextToken: string | undefined;

      do {
        const page = await this.fetchPageUnlocked(nextToken);
        yield page;
        nextToken = page.nextToken;
      } while (hasNextPageToken(nextToken));
    } finally {
      this.leave();
    }
  }

  /**
   * Lazily walks all pages for this execution, yielding one {@link PageDetailedResult} per step.
   *
   * Holds exclusive access for the entire iteration (from first `next()` until completion or early return).
   *
   * @yields One page at a time (with diagnostics) until AWS returns no `NextToken`.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  async *iteratePagesDetailed(): AsyncGenerator<PageDetailedResult> {
    this.enter();
    try {
      let nextToken: string | undefined;

      do {
        const page = await this.fetchPageDetailedUnlocked(nextToken);
        yield page;
        nextToken = page.nextToken;
      } while (hasNextPageToken(nextToken));
    } finally {
      this.leave();
    }
  }

  /**
   * Same as {@link AthenaQueryExecutionPager.iteratePages} but maps each row through `rowParser` on every page.
   *
   * Holds exclusive access for the entire iteration (from first `next()` until completion or early return).
   *
   * @typeParam T - Output type emitted in {@link PageResult.rows}.
   * @param rowParser - Converts each parsed row into `T`.
   * @yields Successive {@link PageResult} values whose `rows` are typed as `T`.
   * @throws {AthenaQueryResultPagerConcurrentAccessError} When another operation is already in flight.
   */
  async *iteratePagesWith<T>(
    rowParser: RowParser<T>,
  ): AsyncGenerator<PageResult<T>> {
    this.enter();
    try {
      let nextToken: string | undefined;

      do {
        const page = await this.fetchPageWithUnlocked(rowParser, nextToken);
        yield page;
        nextToken = page.nextToken;
      } while (hasNextPageToken(nextToken));
    } finally {
      this.leave();
    }
  }

  /**
   * Flattens {@link AthenaQueryExecutionPager.iteratePages} into individual {@link ParsedRow} values (one row per `next()`).
   *
   * Only one page of rows is held in memory at a time.
   *
   * @yields Each dictionary-shaped row in execution order.
   */
  iterateRows(): AsyncGenerator<ParsedRow>;

  /**
   * Flattens {@link AthenaQueryExecutionPager.iteratePagesWith} into individual `T` values (one row per `next()`).
   *
   * Only one page of rows is held in memory at a time.
   *
   * @typeParam T - Output type produced by `rowParser`.
   * @param rowParser - Converts each parsed row into `T`.
   * @yields Each transformed row in execution order.
   */
  iterateRows<T>(rowParser: RowParser<T>): AsyncGenerator<T>;

  /**
   * Shared implementation for {@link AthenaQueryExecutionPager.iterateRows} overloads.
   *
   * Holds exclusive access for the entire iteration. Delegates to unlocked page fetches so the
   * lock is not nested under {@link AthenaQueryExecutionPager.fetchPage}.
   */
  async *iterateRows<T>(
    rowParser?: RowParser<T>,
  ): AsyncGenerator<ParsedRow | T> {
    this.enter();
    try {
      let nextToken: string | undefined;

      do {
        const page = rowParser
          ? await this.fetchPageWithUnlocked(rowParser, nextToken)
          : await this.fetchPageUnlocked(nextToken);

        for (const row of page.rows) {
          yield row;
        }
        nextToken = page.nextToken;
      } while (hasNextPageToken(nextToken));
    } finally {
      this.leave();
    }
  }

  /**
   * Returns this handle's most recent header-row decision.
   *
   * Useful when {@link PagerOptions.parseResultSetOptions} uses `skipHeaderRow: 'auto'`.
   *
   * @returns The last {@link HeaderRowDecision}, or `null` before any parse / after {@link AthenaQueryExecutionPager.reset}.
   */
  readonly getLastHeaderRowDecision = (): HeaderRowDecision | null =>
    this.parser.getLastHeaderRowDecision();

  /**
   * Clears this handle's {@link AthenaQueryResultParser} state.
   *
   * Call when you need to clear header-row bookkeeping without starting a new fetch
   * (for example so {@link AthenaQueryExecutionPager.getLastHeaderRowDecision} returns `null`).
   * Prefer a new {@link AthenaQueryResultPager.forExecution} handle for a different query.
   */
  readonly reset = (): void => {
    this.parser.reset();
  };
}
