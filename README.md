# Athena Query Result Pager

Paginate AWS Athena query results with the AWS SDK v3. Fetches results page by page and supports raw rows or custom row parsing via [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser).

## Installation

```bash
npm install athena-query-result-pager
```

**Peer dependencies:** `@aws-sdk/client-athena`, `athena-query-result-parser` (installed automatically if missing).

**Requirements:** Node.js >= 20.

## Usage

### Create a pager

```ts
import { AthenaClient } from '@aws-sdk/client-athena';
import { AthenaQueryResultPager } from 'athena-query-result-pager';

const client = new AthenaClient({ region: 'us-east-1' });
const pager = new AthenaQueryResultPager(client, {
  maxResults: 1000,        // optional, default: 1000
  queryResultType: 'DATA_ROWS',  // optional, default: 'DATA_ROWS'
});
```

### Fetch a single page (raw rows)

```ts
const page = await pager.fetchPage('query-execution-id');
console.log(page.rows, page.nextToken, page.rowCount);

if (AthenaQueryResultPager.hasNextPage(page)) {
  const nextPage = await pager.fetchPage('query-execution-id', page.nextToken);
  // ...
}
```

### Fetch a single page with a custom row parser

```ts
import type { RowParser } from 'athena-query-result-pager';

interface MyRow { id: string; name: string; }
const rowParser: RowParser<MyRow> = (row) => ({
  id: row['id'] ?? '',
  name: row['name'] ?? '',
});

const page = await pager.fetchPageWith('query-execution-id', rowParser);
// page.rows is MyRow[]
```

### Iterate pages (async generator)

```ts
// Raw ParsedRow
for await (const page of pager.iteratePages('query-execution-id')) {
  console.log(page.rowCount, page.rows);
}

// With custom row parser
for await (const page of pager.iteratePagesWith('query-execution-id', rowParser)) {
  console.log(page.rowCount, page.rows);
}
```

### Iterate row by row (memory-efficient)

```ts
for await (const row of pager.iterateRows('query-execution-id', rowParser)) {
  console.log(row);
}
```

### Reset before a new query

When processing a different query with the same pager instance, reset the parser state:

```ts
pager.reset();
```

## API

### `AthenaQueryResultPager`

- **`constructor(client: AthenaClient, options?: PagerOptions)`**
- **`fetchPage(queryExecutionId, nextToken?)`** → `Promise<PageResult<ParsedRow>>`
- **`fetchPageWith<T>(queryExecutionId, rowParser, nextToken?)`** → `Promise<PageResult<T>>`
- **`iteratePages(queryExecutionId)`** → `AsyncGenerator<PageResult<ParsedRow>>`
- **`iteratePagesWith<T>(queryExecutionId, rowParser)`** → `AsyncGenerator<PageResult<T>>`
- **`iterateRows<T>(queryExecutionId, rowParser)`** → `AsyncGenerator<T>`
- **`reset()`** — resets parser state for a new query.
- **`static hasNextPage<T>(pageResult: PageResult<T>)`** → `boolean`

### Types

- **`PageResult<T>`** — `{ rows: T[]; nextToken?: string; rowCount: number }`
- **`PagerOptions`** — `{ maxResults?: number; queryResultType?: 'DATA_ROWS' }`
- **`ParsedRow`**, **`RowParser<T>`** — re-exported from `athena-query-result-parser`.

## License

This project is licensed under the Apache-2.0 License.
