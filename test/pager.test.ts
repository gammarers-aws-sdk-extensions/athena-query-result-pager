import { AthenaClient, GetQueryResultsCommand } from '@aws-sdk/client-athena';
import type { GetQueryResultsCommandOutput } from '@aws-sdk/client-athena';
import {
  AthenaQueryExecutionPager,
  AthenaQueryResultPager,
  AthenaQueryResultPagerConcurrentAccessError,
  AthenaQueryResultPagerEmptyQueryExecutionIdError,
  AthenaQueryResultPagerError,
  AthenaQueryResultPagerInvalidMaxResultsError,
  AthenaQueryResultParserColumnCountMismatchError,
  AthenaQueryResultParserError,
  QueryResultType,
  type PageResult,
  type ParsedRow,
} from '../src';

const createMockResultSet = (
  rows: Array<Record<string, string | null>>,
): GetQueryResultsCommandOutput['ResultSet'] => {
  if (rows.length === 0) {
    return {
      ResultSetMetadata: { ColumnInfo: [] },
      Rows: [],
    };
  }
  const columns = Object.keys(rows[0]);
  return {
    ResultSetMetadata: {
      ColumnInfo: columns.map((name) => ({ Name: name, Type: 'varchar' })),
    },
    Rows: rows.map((r) => ({
      Data: columns.map((col) => ({ VarCharValue: r[col] ?? undefined })),
    })),
  };
};

/** Asserts default pager shape: `MaxResults` 1000 and `QueryResultType` DATA_ROWS. */
const expectDefaultGetQueryResultsShape = (input: {
  MaxResults?: number;
  QueryResultType?: string;
  QueryExecutionId?: string;
  NextToken?: string | undefined;
}): void => {
  expect(input.MaxResults).toBe(1000);
  expect(input.QueryResultType).toBe(QueryResultType.DATA_ROWS);
};

const createMockSend = (
  pages: Array<{ rows: ParsedRow[]; nextToken?: string }>,
): jest.Mock => {
  const send = jest.fn();
  let callIndex = 0;
  send.mockImplementation((command: GetQueryResultsCommand) => {
    const page = pages[callIndex];
    callIndex += 1;
    if (!page) {
      return Promise.resolve({
        ResultSet: createMockResultSet([]),
        NextToken: undefined,
      });
    }
    // Athena includes the header row only on the first page of each execution (no NextToken).
    const isFirstPage = command.input.NextToken === undefined;
    const headerRow = Object.keys(page.rows[0] ?? {}).reduce<Record<string, string | null>>(
      (acc, col) => {
        acc[col] = col;
        return acc;
      },
      {},
    );
    const allRows = isFirstPage ? [headerRow, ...page.rows] : page.rows;
    return Promise.resolve({
      ResultSet: createMockResultSet(allRows),
      NextToken: page.nextToken,
    });
  });
  return send;
};

describe('AthenaQueryResultPager', () => {
  describe('constructor', () => {
    it('should require AthenaClient and accept optional options', () => {
      const client = { send: jest.fn() } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      expect(pager).toBeDefined();
    });

    it('should use default options when not provided', async () => {
      const client = { send: jest.fn().mockResolvedValue({ ResultSet: createMockResultSet([]), NextToken: undefined }) } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      await pager.forExecution('exec-1').fetchPage();
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueryExecutionId: 'exec-1',
            MaxResults: 1000,
            NextToken: undefined,
            QueryResultType: QueryResultType.DATA_ROWS,
          }),
        }),
      );
    });

    it('should apply custom maxResults and queryResultType', async () => {
      const client = { send: jest.fn().mockResolvedValue({ ResultSet: createMockResultSet([]), NextToken: undefined }) } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        maxResults: 100,
        queryResultType: QueryResultType.DATA_MANIFEST,
      });
      await pager.forExecution('exec-1').fetchPage();
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MaxResults: 100,
            QueryResultType: QueryResultType.DATA_MANIFEST,
          }),
        }),
      );
    });

    it.each([0, -1, 1001, 1.5])('should throw AthenaQueryResultPagerInvalidMaxResultsError when maxResults is invalid: %p', (maxResults) => {
      const client = { send: jest.fn() } as unknown as AthenaClient;
      expect(() => new AthenaQueryResultPager(client, { maxResults })).toThrow(
        AthenaQueryResultPagerInvalidMaxResultsError,
      );
      try {
        new AthenaQueryResultPager(client, { maxResults });
      } catch (error) {
        expect(error).toBeInstanceOf(AthenaQueryResultPagerError);
        expect((error as AthenaQueryResultPagerInvalidMaxResultsError).code).toBe('invalid-max-results');
        expect((error as AthenaQueryResultPagerInvalidMaxResultsError).maxResults).toBe(maxResults);
      }
    });

    it('should forward parseResultSetOptions to the parser', async () => {
      const send = createMockSend([{ rows: [{ id: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        parseResultSetOptions: { skipHeaderRow: false },
      });

      const result = await pager.forExecution('exec-1').fetchPage();

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({ id: 'id' });
      expect(result.rows[1]).toMatchObject({ id: '1' });
    });
  });

  describe('forExecution', () => {
    it('should throw AthenaQueryResultPagerEmptyQueryExecutionIdError when queryExecutionId is empty or whitespace only', () => {
      const client = { send: jest.fn() } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);

      expect(() => pager.forExecution('')).toThrow(AthenaQueryResultPagerEmptyQueryExecutionIdError);
      expect(() => pager.forExecution('   ')).toThrow(AthenaQueryResultPagerEmptyQueryExecutionIdError);
      expect(() => pager.forExecution('')).toThrow(
        expect.objectContaining({ code: 'empty-query-execution-id' }),
      );
      expect(client.send).not.toHaveBeenCalled();
    });

    it('should reject blank queryExecutionId from AthenaQueryExecutionPager.create', () => {
      const client = { send: jest.fn() } as unknown as AthenaClient;

      expect(() =>
        AthenaQueryExecutionPager.create(
          client,
          { maxResults: 1000, queryResultType: QueryResultType.DATA_ROWS },
          undefined,
          '',
        ),
      ).toThrow(AthenaQueryResultPagerEmptyQueryExecutionIdError);
    });
  });

  describe('fetchPage', () => {
    it('should call GetQueryResults with queryExecutionId and nextToken', async () => {
      const send = createMockSend([{ rows: [{ id: '1', name: 'a' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-123');

      const result = await execution.fetchPage();

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.any(GetQueryResultsCommand));
      const cmd = send.mock.calls[0][0];
      expect(cmd.input).toEqual({
        QueryExecutionId: 'exec-123',
        NextToken: undefined,
        MaxResults: 1000,
        QueryResultType: QueryResultType.DATA_ROWS,
      });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ id: '1', name: 'a' });
      expect(result.nextToken).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    it('should pass nextToken for subsequent pages', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: 'token-2' },
        { rows: [{ id: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');

      const page1 = await execution.fetchPage();
      expect(page1.nextToken).toBe('token-2');

      const page2 = await execution.fetchPage('token-2');
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith(expect.any(GetQueryResultsCommand));

      const firstInput = send.mock.calls[0][0].input;
      expect(firstInput).toMatchObject({
        QueryExecutionId: 'exec-1',
        NextToken: undefined,
      });
      expectDefaultGetQueryResultsShape(firstInput);

      const secondInput = send.mock.calls[1][0].input;
      expect(secondInput).toMatchObject({
        QueryExecutionId: 'exec-1',
        NextToken: 'token-2',
      });
      expectDefaultGetQueryResultsShape(secondInput);

      expect(page2.nextToken).toBeUndefined();
    });
  });

  describe('fetchPageDetailed', () => {
    it('should return rows matching fetchPage plus parse diagnostics', async () => {
      const send = createMockSend([{ rows: [{ id: '1', name: 'a' }], nextToken: 'token-2' }]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-123');

      const detailed = await execution.fetchPageDetailed();

      expect(send).toHaveBeenCalledTimes(1);
      expect(detailed.rows).toHaveLength(1);
      expect(detailed.rows[0]).toMatchObject({ id: '1', name: 'a' });
      expect(detailed.nextToken).toBe('token-2');
      expect(detailed.rowCount).toBe(1);
      expect(detailed.diagnostics.unavailableReason).toBeNull();
      expect(detailed.diagnostics.headerRowDecision).not.toBeNull();
      expect(detailed.diagnostics.headers).toEqual(['id', 'name']);
      expect(detailed.diagnostics.rawRowCount).toBe(2);
      expect(detailed.diagnostics.parsedRowCount).toBe(1);
      expect(detailed.diagnostics.truncatedByMaxRows).toBe(false);
    });

    it('should expose truncatedByMaxRows when parseResultSetOptions.maxRows truncates', async () => {
      const send = createMockSend([
        {
          rows: [{ id: '1' }, { id: '2' }, { id: '3' }],
          nextToken: undefined,
        },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        parseResultSetOptions: {
          skipHeaderRow: false,
          maxRows: 2,
          maxRowsExceededBehavior: 'truncate',
        },
      });

      const detailed = await pager.forExecution('exec-1').fetchPageDetailed();

      expect(detailed.rows).toHaveLength(2);
      expect(detailed.diagnostics.truncatedByMaxRows).toBe(true);
      expect(detailed.diagnostics.parsedRowCount).toBe(2);
    });
  });

  describe('iteratePagesDetailed', () => {
    it('should yield detailed pages until nextToken is undefined', async () => {
      const send = createMockSend([
        { rows: [{ x: '1' }], nextToken: 't2' },
        { rows: [{ x: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      const pages: Array<{ rowCount: number; hasDiagnostics: boolean }> = [];

      for await (const page of execution.iteratePagesDetailed()) {
        pages.push({ rowCount: page.rowCount, hasDiagnostics: page.diagnostics != null });
      }

      expect(pages).toEqual([
        { rowCount: 1, hasDiagnostics: true },
        { rowCount: 1, hasDiagnostics: true },
      ]);
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchPageWith', () => {
    it('should parse rows with custom row parser', async () => {
      const send = createMockSend([
        {
          rows: [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
          ],
          nextToken: undefined,
        },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      type User = { id: string; name: string };
      const rowParser = (row: ParsedRow): User => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
      });

      const result = await execution.fetchPageWith<User>(rowParser);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.any(GetQueryResultsCommand));
      const cmd = send.mock.calls[0][0];
      expect(cmd.input).toEqual({
        QueryExecutionId: 'exec-1',
        NextToken: undefined,
        MaxResults: 1000,
        QueryResultType: QueryResultType.DATA_ROWS,
      });

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: '1', name: 'Alice' });
      expect(result.rows[1]).toEqual({ id: '2', name: 'Bob' });
      expect(result.rowCount).toBe(2);
      expect(result.nextToken).toBeUndefined();
    });

    it('should forward QueryResultType from constructor options on GetQueryResults', async () => {
      const send = jest.fn().mockResolvedValue({ ResultSet: createMockResultSet([]), NextToken: undefined }) as jest.Mock;
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, { queryResultType: QueryResultType.DATA_MANIFEST });
      const rowParser = (row: ParsedRow): ParsedRow => row;

      await pager.forExecution('exec-ms').fetchPageWith(rowParser);

      expect(send.mock.calls[0][0].input).toMatchObject({
        QueryExecutionId: 'exec-ms',
        QueryResultType: QueryResultType.DATA_MANIFEST,
        MaxResults: 1000,
        NextToken: undefined,
      });
    });
  });

  describe('iteratePages', () => {
    it('should yield one page when there is no nextToken', async () => {
      const send = createMockSend([{ rows: [{ x: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      const pages: PageResult<ParsedRow>[] = [];

      for await (const page of execution.iteratePages()) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].rows).toHaveLength(1);
      expect(pages[0].nextToken).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should yield multiple pages until nextToken is undefined', async () => {
      const send = createMockSend([
        { rows: [{ x: '1' }], nextToken: 't2' },
        { rows: [{ x: '2' }], nextToken: 't3' },
        { rows: [{ x: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      const pages: PageResult<ParsedRow>[] = [];

      for await (const page of execution.iteratePages()) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(pages[0].rows[0]).toMatchObject({ x: '1' });
      expect(pages[1].rows[0]).toMatchObject({ x: '2' });
      expect(pages[2].rows[0]).toMatchObject({ x: '3' });
      expect(pages[2].nextToken).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 3; i += 1) {
        expectDefaultGetQueryResultsShape(send.mock.calls[i][0].input);
        expect(send.mock.calls[i][0].input.QueryExecutionId).toBe('exec-1');
      }
      expect(send.mock.calls[0][0].input.NextToken).toBeUndefined();
      expect(send.mock.calls[1][0].input.NextToken).toBe('t2');
      expect(send.mock.calls[2][0].input.NextToken).toBe('t3');
    });

    it('should include QueryResultType on each page when options override defaults', async () => {
      const send = createMockSend([
        { rows: [{ x: '1' }], nextToken: 't2' },
        { rows: [{ x: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, { maxResults: 500, queryResultType: QueryResultType.DATA_MANIFEST });

      let pageCount = 0;
      for await (const page of pager.forExecution('exec-1').iteratePages()) {
        expect(page.rows).toHaveLength(1);
        pageCount += 1;
      }
      expect(pageCount).toBe(2);

      expect(send).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i += 1) {
        expect(send.mock.calls[i][0].input).toMatchObject({
          MaxResults: 500,
          QueryResultType: QueryResultType.DATA_MANIFEST,
          QueryExecutionId: 'exec-1',
        });
      }
    });
  });

  describe('iteratePagesWith', () => {
    it('should yield pages with custom parsed rows', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });
      const pages: PageResult<Item>[] = [];

      for await (const page of execution.iteratePagesWith(rowParser)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].rows).toEqual([{ id: '1' }]);
      expect(send.mock.calls[0][0].input).toEqual(
        expect.objectContaining({
          QueryResultType: QueryResultType.DATA_ROWS,
          MaxResults: 1000,
        }),
      );
    });

    it('should yield multiple pages with custom parsed rows until nextToken is undefined', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: 't2' },
        { rows: [{ id: '2' }], nextToken: 't3' },
        { rows: [{ id: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });
      const pages: PageResult<Item>[] = [];

      for await (const page of execution.iteratePagesWith(rowParser)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(pages[0].rows).toEqual([{ id: '1' }]);
      expect(pages[1].rows).toEqual([{ id: '2' }]);
      expect(pages[2].rows).toEqual([{ id: '3' }]);
      expect(pages[2].nextToken).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 3; i += 1) {
        expectDefaultGetQueryResultsShape(send.mock.calls[i][0].input);
        expect(send.mock.calls[i][0].input.QueryExecutionId).toBe('exec-1');
      }
      expect(send.mock.calls[0][0].input.NextToken).toBeUndefined();
      expect(send.mock.calls[1][0].input.NextToken).toBe('t2');
      expect(send.mock.calls[2][0].input.NextToken).toBe('t3');
    });
  });

  describe('iterateRows', () => {
    it('should yield each ParsedRow from all pages when rowParser is omitted', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }, { id: '2' }], nextToken: 't2' },
        { rows: [{ id: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      const rows: ParsedRow[] = [];

      for await (const row of execution.iterateRows()) {
        rows.push(row);
      }

      expect(rows).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
      expect(send).toHaveBeenCalledTimes(2);
      expectDefaultGetQueryResultsShape(send.mock.calls[0][0].input);
      expectDefaultGetQueryResultsShape(send.mock.calls[1][0].input);
    });

    it('should yield each row from all pages', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }, { id: '2' }], nextToken: 't2' },
        { rows: [{ id: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });
      const rows: Item[] = [];

      for await (const row of execution.iterateRows(rowParser)) {
        rows.push(row);
      }

      expect(rows).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
      expect(send).toHaveBeenCalledTimes(2);
      expectDefaultGetQueryResultsShape(send.mock.calls[0][0].input);
      expectDefaultGetQueryResultsShape(send.mock.calls[1][0].input);
    });
  });

  describe('reset', () => {
    it('should clear parser state without starting a new fetch', async () => {
      const send = createMockSend([{ rows: [{ a: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');

      await execution.fetchPage();
      expect(execution.getLastHeaderRowDecision()).not.toBeNull();

      execution.reset();
      expect(execution.getLastHeaderRowDecision()).toBeNull();
    });

    it('should isolate parser state across separate forExecution handles', async () => {
      const send = createMockSend([
        { rows: [{ a: '1' }], nextToken: undefined },
        { rows: [{ b: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);

      const page1 = await pager.forExecution('exec-1').fetchPage();
      expect(page1.rows).toEqual([{ a: '1' }]);

      // Separate handles keep independent parsers so header-row handling does not leak.
      const page2 = await pager.forExecution('exec-2').fetchPage();
      expect(page2.rows).toEqual([{ b: '2' }]);
    });

    it('should keep parser state across pages of the same execution handle', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: 'token-2' },
        { rows: [{ id: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');

      const page1 = await execution.fetchPage();
      expect(page1.rows).toEqual([{ id: '1' }]);

      const page2 = await execution.fetchPage('token-2');
      // Second page has no header; keeping state avoids skipping the first data row.
      expect(page2.rows).toEqual([{ id: '2' }]);
    });
  });

  describe('getLastHeaderRowDecision', () => {
    it('should return null before parsing and a decision after fetchPage', async () => {
      const send = createMockSend([{ rows: [{ id: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');

      expect(execution.getLastHeaderRowDecision()).toBeNull();

      await execution.fetchPage();

      expect(execution.getLastHeaderRowDecision()).not.toBeNull();
    });
  });

  describe('concurrent access', () => {
    it('should throw AthenaQueryResultPagerConcurrentAccessError when fetchPage overlaps on the same handle', async () => {
      let resolveFirst!: (value: unknown) => void;
      const firstResponse = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      const send = jest.fn().mockImplementationOnce(() => firstResponse);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');

      const firstFetch = execution.fetchPage();
      await expect(execution.fetchPage()).rejects.toThrow(AthenaQueryResultPagerConcurrentAccessError);
      await expect(execution.fetchPage()).rejects.toMatchObject({ code: 'concurrent-access' });

      resolveFirst({
        ResultSet: createMockResultSet([{ id: 'id' }, { id: '1' }]),
        NextToken: undefined,
      });
      await firstFetch;
    });

    it('should throw AthenaQueryResultPagerConcurrentAccessError when fetch overlaps an active iteration', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: 't2' },
        { rows: [{ id: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const execution = new AthenaQueryResultPager(client).forExecution('exec-1');
      const iterator = execution.iteratePages();

      await iterator.next();
      await expect(execution.fetchPage()).rejects.toThrow(AthenaQueryResultPagerConcurrentAccessError);

      await iterator.return(undefined);
    });

    it('should allow concurrent fetch on separate forExecution handles', async () => {
      const send = createMockSend([
        { rows: [{ a: '1' }], nextToken: undefined },
        { rows: [{ b: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      const exec1 = pager.forExecution('exec-1');
      const exec2 = pager.forExecution('exec-2');

      const [page1, page2] = await Promise.all([exec1.fetchPage(), exec2.fetchPage()]);

      expect(page1.rows).toEqual([{ a: '1' }]);
      expect(page2.rows).toEqual([{ b: '2' }]);
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe('parseResultSetOptions', () => {
    it('should propagate AthenaQueryResultParserError without wrapping in AthenaQueryResultPagerError', async () => {
      const resultSet = {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'id', Type: 'varchar' },
            { Name: 'name', Type: 'varchar' },
          ],
        },
        Rows: [
          { Data: [{ VarCharValue: 'id' }, { VarCharValue: 'name' }] },
          { Data: [{ VarCharValue: '1' }] },
        ],
      };
      const client = {
        send: jest.fn().mockResolvedValue({ ResultSet: resultSet, NextToken: undefined }),
      } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        parseResultSetOptions: {
          skipHeaderRow: false,
          columnCountMismatchBehavior: 'throw',
        },
      });
      const execution = pager.forExecution('exec-1');

      await expect(execution.fetchPage()).rejects.toBeInstanceOf(AthenaQueryResultParserColumnCountMismatchError);
      await expect(execution.fetchPage()).rejects.toBeInstanceOf(AthenaQueryResultParserError);
      await expect(execution.fetchPage()).rejects.not.toBeInstanceOf(AthenaQueryResultPagerError);
      await expect(execution.fetchPage()).rejects.toMatchObject({ code: 'column-count-mismatch' });
    });

    it('should forward parseResultSetOptions to fetchPageWith', async () => {
      const send = createMockSend([{ rows: [{ id: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        parseResultSetOptions: { skipHeaderRow: false },
      });
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });

      const result = await pager.forExecution('exec-1').fetchPageWith(rowParser);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: 'id' });
      expect(result.rows[1]).toEqual({ id: '1' });
    });
  });

  describe('hasNextPage', () => {
    it('should return true when nextToken is defined', () => {
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], nextToken: 'x', rowCount: 0 })).toBe(true);
    });

    it('should return false when nextToken is undefined', () => {
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], rowCount: 0 })).toBe(false);
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], nextToken: undefined, rowCount: 0 })).toBe(false);
    });
  });
});
