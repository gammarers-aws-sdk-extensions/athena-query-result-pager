# Athena Query Result Pager

![npm](https://img.shields.io/npm/v/athena-query-result-pager)
![license](https://img.shields.io/npm/l/athena-query-result-pager)

Paginate AWS Athena query results with AWS SDK v3. This package fetches results page by page and supports raw rows or custom row parsing via [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser).

## Features

- Paginates Athena `GetQueryResults` responses with `nextToken`.
- Supports raw rows (`ParsedRow`) and custom typed row parsing.
- Provides async generators for page-by-page and row-by-row iteration.
- Includes fail-fast input validation:
  - `maxResults` must be an integer in `1..1000`.
  - `queryExecutionId` must be a non-empty string.
- Exposes a simple static utility: `AthenaQueryResultPager.hasNextPage(...)`.

## Installation

```bash
npm install athena-query-result-pager
```

```bash
yarn add athena-query-result-pager
```

Dependencies: `@aws-sdk/client-athena`, `athena-query-result-parser`.

## Usage

### Create a pager instance

```ts
import { AthenaClient } from '@aws-sdk/client-athena';
import { AthenaQueryResultPager } from 'athena-query-result-pager';

const client = new AthenaClient({ region: 'us-east-1' });
const pager = new AthenaQueryResultPager(client, {
  maxResults: 1000,
  queryResultType: 'DATA_ROWS',
});
```

### Fetch one page (raw rows)

```ts
const page = await pager.fetchPage('query-execution-id');
console.log(page.rows, page.nextToken, page.rowCount);

if (AthenaQueryResultPager.hasNextPage(page)) {
  const nextPage = await pager.fetchPage('query-execution-id', page.nextToken);
  // ...
}
```

### Fetch one page with a custom row parser

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

## Options

### `PagerOptions`

- `maxResults?: number`
  - Default: `1000`
  - Valid range: integer `1..1000` (Athena limit)
  - Throws `RangeError` when invalid
- `queryResultType?: 'DATA_ROWS'`
  - Default: `'DATA_ROWS'`

### Method input validation

- `fetchPage(queryExecutionId, nextToken?)`
- `fetchPageWith(queryExecutionId, rowParser, nextToken?)`

Both methods throw an error if `queryExecutionId` is empty or whitespace only.

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

## Requirements

- Node.js `>= 20.0.0`
- AWS SDK v3 client: `@aws-sdk/client-athena`

## License

This project is licensed under the (Apache-2.0) License.
