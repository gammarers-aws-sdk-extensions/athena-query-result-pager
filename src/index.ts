import { AthenaClient, GetQueryResultsCommand, type GetQueryResultsCommandInput } from '@aws-sdk/client-athena';
import { AthenaQueryResultParser, type ParsedRow, type RowParser } from 'athena-query-result-parser';

/** Default maximum number of rows per page. */
const DEFAULT_MAX_RESULTS = 1000;

/** Default query result type for GetQueryResults. */
const DEFAULT_QUERY_RESULT_TYPE = 'DATA_ROWS' as const;

/**
 * Type for a single page of query results.
 */
export interface PageResult<T> {
  /** Parsed row data. */
  rows: T[];
  /** Token for the next page (undefined if no more pages). */
  nextToken?: string;
  /** Number of rows in this page. */
  rowCount: number;
}

/**
 * Options for the pager.
 */
export interface PagerOptions {
  /** Maximum number of rows per page (default: 1000). */
  maxResults?: number;
  /** Query result type (default: 'DATA_ROWS'). */
  queryResultType?: 'DATA_ROWS';
}

/**
 * AthenaQueryResultPager
 * Fetches Athena query results page by page.
 */
export class AthenaQueryResultPager {

  /**
   * Returns whether there is a next page.
   * @param pageResult - Previous page result.
   */
  static hasNextPage<T>(pageResult: PageResult<T>): boolean {
    return pageResult.nextToken !== undefined;
  }

  private readonly client: AthenaClient;
  private readonly options: Required<PagerOptions>;
  private parser: AthenaQueryResultParser;

  constructor(client: AthenaClient, options: PagerOptions = {}) {
    this.client = client;
    this.options = {
      maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
      queryResultType: options.queryResultType ?? DEFAULT_QUERY_RESULT_TYPE,
    };
    this.parser = new AthenaQueryResultParser();
  }

  /**
   * Fetches one page of data as raw ParsedRow.
   * @param queryExecutionId - Query execution ID.
   * @param nextToken - Token for the next page (undefined on first call).
   * @returns Page result.
   */
  async fetchPage(
    queryExecutionId: string,
    nextToken?: string,
  ): Promise<PageResult<ParsedRow>> {
    const input: GetQueryResultsCommandInput = {
      QueryExecutionId: queryExecutionId,
      NextToken: nextToken,
      MaxResults: this.options.maxResults,
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
   * Fetches one page of data and transforms it with a custom row parser.
   * @param queryExecutionId - Query execution ID.
   * @param rowParser - Row parser.
   * @param nextToken - Token for the next page (undefined on first call).
   * @returns Page result.
   */
  async fetchPageWith<T>(
    queryExecutionId: string,
    rowParser: RowParser<T>,
    nextToken?: string,
  ): Promise<PageResult<T>> {
    const input: GetQueryResultsCommandInput = {
      QueryExecutionId: queryExecutionId,
      NextToken: nextToken,
      MaxResults: this.options.maxResults,
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
   * Iterates page by page via AsyncGenerator (raw ParsedRow).
   * @param queryExecutionId - Query execution ID.
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
   * Iterates page by page via AsyncGenerator with a custom row parser.
   * @param queryExecutionId - Query execution ID.
   * @param rowParser - Row parser.
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
   * Iterates row by row via AsyncGenerator (memory-efficient).
   * @param queryExecutionId - Query execution ID.
   * @param rowParser - Row parser.
   */
  async *iterateRows<T>(
    queryExecutionId: string,
    rowParser: RowParser<T>,
  ): AsyncGenerator<T> {
    for await (const page of this.iteratePagesWith(queryExecutionId, rowParser)) {
      for (const row of page.rows) {
        yield row;
      }
    }
  }

  /**
   * Resets the parser state. Call before processing a new query.
   */
  reset(): void {
    this.parser = new AthenaQueryResultParser();
  }
}

/** Re-export of types from athena-query-result-parser. */
export type { ParsedRow, RowParser };