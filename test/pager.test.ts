import { AthenaClient, GetQueryResultsCommand } from '@aws-sdk/client-athena';
import type { GetQueryResultsCommandOutput } from '@aws-sdk/client-athena';
import {
  AthenaQueryResultPager,
  type PageResult,
  type ParsedRow,
} from '../src';

function createMockResultSet(rows: Array<Record<string, string | null>>): GetQueryResultsCommandOutput['ResultSet'] {
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
}

function createMockSend(
  pages: Array<{ rows: ParsedRow[]; nextToken?: string }>,
): jest.Mock {
  const send = jest.fn();
  let callIndex = 0;
  send.mockImplementation(() => {
    const page = pages[callIndex];
    callIndex += 1;
    if (!page) {
      return Promise.resolve({
        ResultSet: createMockResultSet([]),
        NextToken: undefined,
      });
    }
    // Include header row only on the first page (parser skips header once per instance)
    const isFirstPage = callIndex === 1;
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
}

describe('AthenaQueryResultPager', () => {
  describe('constructor', () => {
    it('requires AthenaClient and accepts optional options', () => {
      const client = { send: jest.fn() } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      expect(pager).toBeDefined();
    });

    it('uses default options when not provided', async () => {
      const client = { send: jest.fn().mockResolvedValue({ ResultSet: createMockResultSet([]), NextToken: undefined }) } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      await pager.fetchPage('exec-1');
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueryExecutionId: 'exec-1',
            MaxResults: 1000,
            NextToken: undefined,
          }),
        }),
      );
    });

    it('applies custom maxResults and queryResultType', async () => {
      const client = { send: jest.fn().mockResolvedValue({ ResultSet: createMockResultSet([]), NextToken: undefined }) } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client, {
        maxResults: 100,
        queryResultType: 'DATA_ROWS',
      });
      await pager.fetchPage('exec-1');
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MaxResults: 100,
          }),
        }),
      );
    });
  });

  describe('fetchPage', () => {
    it('calls GetQueryResults with queryExecutionId and nextToken', async () => {
      const send = createMockSend([{ rows: [{ id: '1', name: 'a' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);

      const result = await pager.fetchPage('exec-123');

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.any(GetQueryResultsCommand));
      const cmd = send.mock.calls[0][0];
      expect(cmd.input).toEqual({
        QueryExecutionId: 'exec-123',
        NextToken: undefined,
        MaxResults: 1000,
      });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ id: '1', name: 'a' });
      expect(result.nextToken).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    it('passes nextToken for subsequent pages', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: 'token-2' },
        { rows: [{ id: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);

      const page1 = await pager.fetchPage('exec-1');
      expect(page1.nextToken).toBe('token-2');

      const page2 = await pager.fetchPage('exec-1', 'token-2');
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith(expect.any(GetQueryResultsCommand));
      expect(send.mock.calls[1][0].input.NextToken).toBe('token-2');
      expect(page2.nextToken).toBeUndefined();
    });
  });

  describe('fetchPageWith', () => {
    it('parses rows with custom row parser', async () => {
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
      const pager = new AthenaQueryResultPager(client);
      type User = { id: string; name: string };
      const rowParser = (row: ParsedRow): User => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
      });

      const result = await pager.fetchPageWith<User>('exec-1', rowParser);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: '1', name: 'Alice' });
      expect(result.rows[1]).toEqual({ id: '2', name: 'Bob' });
      expect(result.rowCount).toBe(2);
      expect(result.nextToken).toBeUndefined();
    });
  });

  describe('iteratePages', () => {
    it('yields one page when there is no nextToken', async () => {
      const send = createMockSend([{ rows: [{ x: '1' }], nextToken: undefined }]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      const pages: PageResult<ParsedRow>[] = [];

      for await (const page of pager.iteratePages('exec-1')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].rows).toHaveLength(1);
      expect(pages[0].nextToken).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('yields multiple pages until nextToken is undefined', async () => {
      const send = createMockSend([
        { rows: [{ x: '1' }], nextToken: 't2' },
        { rows: [{ x: '2' }], nextToken: 't3' },
        { rows: [{ x: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      const pages: PageResult<ParsedRow>[] = [];

      for await (const page of pager.iteratePages('exec-1')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(pages[0].rows[0]).toMatchObject({ x: '1' });
      expect(pages[1].rows[0]).toMatchObject({ x: '2' });
      expect(pages[2].rows[0]).toMatchObject({ x: '3' });
      expect(pages[2].nextToken).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(3);
    });
  });

  describe('iteratePagesWith', () => {
    it('yields pages with custom parsed rows', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });
      const pages: PageResult<Item>[] = [];

      for await (const page of pager.iteratePagesWith('exec-1', rowParser)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].rows).toEqual([{ id: '1' }]);
    });
  });

  describe('iterateRows', () => {
    it('yields each row from all pages', async () => {
      const send = createMockSend([
        { rows: [{ id: '1' }, { id: '2' }], nextToken: 't2' },
        { rows: [{ id: '3' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);
      type Item = { id: string };
      const rowParser = (row: ParsedRow): Item => ({ id: String(row.id ?? '') });
      const rows: Item[] = [];

      for await (const row of pager.iterateRows('exec-1', rowParser)) {
        rows.push(row);
      }

      expect(rows).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    });
  });

  describe('reset', () => {
    it('recreates parser instance', async () => {
      const send = createMockSend([
        { rows: [{ a: '1' }], nextToken: undefined },
        { rows: [{ b: '2' }], nextToken: undefined },
      ]);
      const client = { send } as unknown as AthenaClient;
      const pager = new AthenaQueryResultPager(client);

      const page1 = await pager.fetchPage('exec-1');
      expect(page1.rows[0]).toMatchObject({ a: '1' });

      pager.reset();
      const page2 = await pager.fetchPage('exec-2');
      expect(page2.rows[0]).toMatchObject({ b: '2' });
    });
  });

  describe('hasNextPage', () => {
    it('returns true when nextToken is defined', () => {
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], nextToken: 'x', rowCount: 0 })).toBe(true);
    });

    it('returns false when nextToken is undefined', () => {
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], rowCount: 0 })).toBe(false);
      expect(AthenaQueryResultPager.hasNextPage({ rows: [], nextToken: undefined, rowCount: 0 })).toBe(false);
    });
  });
});
