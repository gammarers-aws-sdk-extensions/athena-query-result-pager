import { AthenaClient, GetQueryResultsCommand, QueryResultType, type GetQueryResultsCommandInput } from '@aws-sdk/client-athena';
import { AthenaQueryResultParser, type ParsedRow, type RowParser } from 'athena-query-result-parser';

/** Default maximum number of result rows requested per {@link AthenaQueryResultPager} API call (`MaxResults`). */
const DEFAULT_MAX_RESULTS = 1000;
/** Minimum `MaxResults` value allowed by Athena `GetQueryResults`. */
const MIN_MAX_RESULTS = 1;
/** Maximum `MaxResults` value allowed by Athena `GetQueryResults`. */
const MAX_MAX_RESULTS = 1000;

/** Default `QueryResultType` forwarded to Athena `GetQueryResults`. */
const DEFAULT_QUERY_RESULT_TYPE = QueryResultType.DATA_ROWS;

/**
 * One page of Athena query results returned by {@link AthenaQueryResultPager} after a fetch or generator step.
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
 * Settings applied to every `GetQueryResults` invocation made by {@link AthenaQueryResultPager}.
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
}

/**
 * Paginates Athena `GetQueryResults` (AWS SDK for JavaScript v3): walks `NextToken` and parses tabular rows with
 * `athena-query-result-parser` when needed.
 *
 * Provides paired APIs for raw {@link ParsedRow} access versus custom {@link RowParser} mapping at the page level
 * (`fetchPage` / `fetchPageWith`, `iteratePages` / `iteratePagesWith`) and at the row level
 * (`iterateRows` with or without `rowParser`).
 *
 * Constructor `maxResults` and `queryResultType` are included on every `GetQueryResults` request.
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
  static hasNextPage<T>(pageResult: PageResult<T>): boolean {
    return pageResult.nextToken !== undefined;
  }

  /** SDK v3 client used for every `GetQueryResults` call. */
  private readonly client: AthenaClient;
  /** Normalized pager settings (every field set after merging defaults). */
  private readonly options: Required<PagerOptions>;
  /** Stateful parser reused across calls; recreated by {@link AthenaQueryResultPager.reset}. */
  private parser: AthenaQueryResultParser;

  /**
   * Creates a pager bound to `client` with optional per-request defaults.
   *
   * @param client - SDK v3 `AthenaClient` used to call `GetQueryResults`.
   * @param options - Optional `MaxResults` and `QueryResultType`; defaults apply when omitted.
   * @throws {RangeError} When `maxResults` is not an integer in `1..1000` inclusive.
   */
  constructor(client: AthenaClient, options: PagerOptions = {}) {
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    if (!Number.isInteger(maxResults) || maxResults < MIN_MAX_RESULTS || maxResults > MAX_MAX_RESULTS) {
      throw new RangeError(
        `options.maxResults must be an integer between ${MIN_MAX_RESULTS} and ${MAX_MAX_RESULTS}, got ${String(maxResults)}`,
      );
    }

    this.client = client;
    this.options = {
      maxResults,
      queryResultType: options.queryResultType ?? DEFAULT_QUERY_RESULT_TYPE,
    };
    this.parser = new AthenaQueryResultParser();
  }

  /**
   * Retrieves a single results page as dictionary-shaped {@link ParsedRow} values.
   *
   * Uses {@link AthenaQueryResultParser.parseResultSet} on the AWS response.
   *
   * @param queryExecutionId - Athena query execution identifier.
   * @param nextToken - Pass `undefined` first; subsequent calls use {@link PageResult.nextToken}.
   * @returns Parsed rows plus pagination metadata from this response only.
   * @throws {Error} When `queryExecutionId` is empty or whitespace only.
   */
  async fetchPage(
    queryExecutionId: string,
    nextToken?: string,
  ): Promise<PageResult<ParsedRow>> {
    if (queryExecutionId.trim() === '') {
      throw new Error('queryExecutionId must be a non-empty string');
    }

    const input: GetQueryResultsCommandInput = {
      QueryExecutionId: queryExecutionId,
      NextToken: nextToken,
      MaxResults: this.options.maxResults,
      QueryResultType: this.options.queryResultType,
    };

    const response = await this.client.send(new GetQueryResultsCommand(input));

    const rows = this.parser.parseResultSet(response.ResultSet);

    return {
      rows,
      nextToken: response.NextToken,
      rowCount: rows.length,
    };
  }

  /**
   * Retrieves one page and maps each {@link ParsedRow} through `rowParser`.
   *
   * Uses {@link AthenaQueryResultParser.parseResultSetWith} on the AWS response.
   *
   * @typeParam T - Output type produced by `rowParser`.
   * @param queryExecutionId - Athena query execution identifier.
   * @param rowParser - Converts each dictionary row into `T`.
   * @param nextToken - Pass `undefined` first; subsequent calls use {@link PageResult.nextToken}.
   * @returns Transformed rows plus pagination metadata from this response only.
   * @throws {Error} When `queryExecutionId` is empty or whitespace only.
   */
  async fetchPageWith<T>(
    queryExecutionId: string,
    rowParser: RowParser<T>,
    nextToken?: string,
  ): Promise<PageResult<T>> {
    if (queryExecutionId.trim() === '') {
      throw new Error('queryExecutionId must be a non-empty string');
    }

    const input: GetQueryResultsCommandInput = {
      QueryExecutionId: queryExecutionId,
      NextToken: nextToken,
      MaxResults: this.options.maxResults,
      QueryResultType: this.options.queryResultType,
    };

    const response = await this.client.send(new GetQueryResultsCommand(input));

    const rows = this.parser.parseResultSetWith(response.ResultSet, rowParser);

    return {
      rows,
      nextToken: response.NextToken,
      rowCount: rows.length,
    };
  }

  /**
   * Lazily walks all pages for an execution, yielding one {@link PageResult} of {@link ParsedRow} per step.
   *
   * @param queryExecutionId - Athena query execution identifier.
   * @yields One page at a time until AWS returns no `NextToken`.
   */
  async *iteratePages(
    queryExecutionId: string,
  ): AsyncGenerator<PageResult<ParsedRow>> {
    let nextToken: string | undefined;

    do {
      const page = await this.fetchPage(queryExecutionId, nextToken);
      yield page;
      nextToken = page.nextToken;
    } while (nextToken);
  }

  /**
   * Same as {@link AthenaQueryResultPager.iteratePages} but maps each row through `rowParser` on every page.
   *
   * @typeParam T - Output type emitted in {@link PageResult.rows}.
   * @param queryExecutionId - Athena query execution identifier.
   * @param rowParser - Converts each parsed row into `T`.
   * @yields Successive {@link PageResult} values whose `rows` are typed as `T`.
   */
  async *iteratePagesWith<T>(
    queryExecutionId: string,
    rowParser: RowParser<T>,
  ): AsyncGenerator<PageResult<T>> {
    let nextToken: string | undefined;

    do {
      const page = await this.fetchPageWith(queryExecutionId, rowParser, nextToken);
      yield page;
      nextToken = page.nextToken;
    } while (nextToken);
  }

  /**
   * Flattens {@link AthenaQueryResultPager.iteratePages} into individual {@link ParsedRow} values (one row per `next()`).
   *
   * Only one page of rows is held in memory at a time.
   *
   * @param queryExecutionId - Athena query execution identifier.
   * @yields Each dictionary-shaped row in execution order.
   */
  iterateRows(
    queryExecutionId: string,
  ): AsyncGenerator<ParsedRow>;

  /**
   * Flattens {@link AthenaQueryResultPager.iteratePagesWith} into individual `T` values (one row per `next()`).
   *
   * Only one page of rows is held in memory at a time.
   *
   * @typeParam T - Output type produced by `rowParser`.
   * @param queryExecutionId - Athena query execution identifier.
   * @param rowParser - Converts each parsed row into `T`.
   * @yields Each transformed row in execution order.
   */
  iterateRows<T>(
    queryExecutionId: string,
    rowParser: RowParser<T>,
  ): AsyncGenerator<T>;

  /**
   * Shared implementation for {@link AthenaQueryResultPager.iterateRows} overloads.
   *
   * Delegates to {@link AthenaQueryResultPager.iteratePages} when `rowParser` is omitted; otherwise to
   * {@link AthenaQueryResultPager.iteratePagesWith}.
   */
  async *iterateRows<T>(
    queryExecutionId: string,
    rowParser?: RowParser<T>,
  ): AsyncGenerator<ParsedRow | T> {
    const pages = rowParser
      ? this.iteratePagesWith(queryExecutionId, rowParser)
      : this.iteratePages(queryExecutionId);

    for await (const page of pages) {
      for (const row of page.rows) {
        yield row;
      }
    }
  }

  /**
   * Instantiates a fresh {@link AthenaQueryResultParser} so header-row handling does not leak between queries.
   *
   * Call when reusing this pager for a different `queryExecutionId` than the previous parse sequence.
   */
  reset(): void {
    this.parser = new AthenaQueryResultParser();
  }
}

/** Re-exports {@link QueryResultType} from `@aws-sdk/client-athena`. */
export { QueryResultType } from '@aws-sdk/client-athena';
/** Re-exports `ParsedRow` and `RowParser` from the `athena-query-result-parser` package. */
export type { ParsedRow, RowParser };