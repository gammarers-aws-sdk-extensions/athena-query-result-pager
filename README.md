# Athena Query Result Pager

![npm](https://img.shields.io/npm/v/athena-query-result-pager)
![license](https://img.shields.io/npm/l/athena-query-result-pager)

Paginate [AWS Athena](https://docs.aws.amazon.com/athena/latest/ug/v3-sdk.html) **`GetQueryResults`** calls with AWS SDK v3. This library walks **`NextToken`**, parses tabular rows with [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser), and forwards **`MaxResults`** and **`QueryResultType`** from **[PagerOptions](#options)** on every [`GetQueryResults`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/athena/command/GetQueryResultsCommand/) request.

## Features

- Sends paginated Athena **`GetQueryResults`** requests (`NextToken` / **`MaxResults`**).
- Forwards **`QueryResultType`** from the pager constructor (`DATA_ROWS`, **`DATA_MANIFEST`**, etc.) on each request — suitable for CTAS / UNLOAD / INSERT manifest workflows when Athena allows it.
- Supports raw **`ParsedRow`** dictionaries and typed rows via **`RowParser<T>`** (including async generators).
- Async generators iterate **page-by-page** (**`iteratePages`**, **`iteratePagesWith`**) or **row-by-row** (**`iterateRows`**) without holding full result sets in memory.
- Fail-fast validation: **`maxResults`** must be an integer in **`1..1000`**; **`queryExecutionId`** must be non-empty ( **`fetchPage`**, **`fetchPageWith`** ).
- Helpers: **`AthenaQueryResultPager.hasNextPage`**, **`reset()`** when reusing one pager across different executions (parser/header state).

## Installation

```bash
npm install athena-query-result-pager
```

```bash
yarn add athena-query-result-pager
```

```bash
pnpm add athena-query-result-pager
```

Runtime dependencies (**direct** once you publish): `@aws-sdk/client-athena`, `athena-query-result-parser`. Your application typically already instantiates **`AthenaClient`** with credentials and Region.

## Usage

### Create a pager instance

**`AthenaQueryResultPager`** options are normalized at construction time (**defaults**: **`maxResults`** `1000`, **`queryResultType`** `QueryResultType.DATA_ROWS`). Both fields are populated on **`GetQueryResults`** for **`fetchPage`**, **`fetchPageWith`**, and all iterators built on those methods.

```ts
import { AthenaClient, QueryResultType } from '@aws-sdk/client-athena';
import { AthenaQueryResultPager } from 'athena-query-result-pager';

const client = new AthenaClient({ region: 'us-east-1' });
const pager = new AthenaQueryResultPager(client, {
  maxResults: 1000,
  queryResultType: QueryResultType.DATA_ROWS,
});

// Manifest-style outputs (only for supported Athena query types):
// new AthenaQueryResultPager(client, { queryResultType: QueryResultType.DATA_MANIFEST })
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

interface MyRow {
  id: string;
  name: string;
}
const rowParser: RowParser<MyRow> = (row) => ({
  id: row['id'] ?? '',
  name: row['name'] ?? '',
});

const page = await pager.fetchPageWith('query-execution-id', rowParser);
// page.rows is MyRow[]
```

### Iterate pages (async generator)

```ts
// Raw ParsedRow pages
for await (const page of pager.iteratePages('query-execution-id')) {
  console.log(page.rowCount, page.rows);
}

// With custom row parser
for await (const page of pager.iteratePagesWith('query-execution-id', rowParser)) {
  console.log(page.rowCount, page.rows);
}
```

### Iterate row by row (memory-efficient)

Requires a **`RowParser`** mapping **`ParsedRow`** to your row type (**`iterateRows`** wraps **`iteratePagesWith`**).

```ts
for await (const row of pager.iterateRows('query-execution-id', rowParser)) {
  console.log(row);
}
```

### Reset before another execution

Reuse the same pager for a **new** **`queryExecutionId`** after resetting the bundled **`AthenaQueryResultParser`** header/skip logic:

```ts
pager.reset();
```

## Options

### `PagerOptions`

- **`maxResults?: number`**
  - Default **`1000`**.
  - Valid range: integer **`1..1000`** (Athena **`GetQueryResults`** limit).
  - Throws **`RangeError`** when invalid (**constructor**).
- **`queryResultType?: QueryResultType`**
  - Same flag as Athena **`GetQueryResults` `QueryResultType`** ( **`DATA_ROWS`**, **`DATA_MANIFEST`**, … ). Import **`QueryResultType`** from **`@aws-sdk/client-athena`** when typing options.
  - Default **`QueryResultType.DATA_ROWS`**.
  - When set (**including default**), the value appears on **`fetchPage`**, **`fetchPageWith`**, and iterator-driven calls alongside **`MaxResults`**.

### Method input validation

- **`fetchPage(queryExecutionId, nextToken?)`**
- **`fetchPageWith(queryExecutionId, rowParser, nextToken?)`**

Both throw if **`queryExecutionId`** is empty or whitespace-only (before invoking AWS).

## API

### `AthenaQueryResultPager`

- **`constructor(client: AthenaClient, options?: PagerOptions)`**
- **`fetchPage(queryExecutionId, nextToken?)`** → **`Promise<PageResult<ParsedRow>>`**
- **`fetchPageWith<T>(queryExecutionId, rowParser, nextToken?)`** → **`Promise<PageResult<T>>`**
- **`iteratePages(queryExecutionId)`** → **`AsyncGenerator<PageResult<ParsedRow>>`**
- **`iteratePagesWith<T>(queryExecutionId, rowParser)`** → **`AsyncGenerator<PageResult<T>>`**
- **`iterateRows<T>(queryExecutionId, rowParser)`** → **`AsyncGenerator<T>`**
- **`reset()`** — new parser instance (**header row bookkeeping** resets).
- **`static hasNextPage<T>(pageResult: PageResult<T>)`** → **`boolean`**

### Types

- **`PageResult<T>`** — **`{ rows: T[]; nextToken?: string; rowCount: number }`**
- **`PagerOptions`** — **`{ maxResults?: number; queryResultType?: QueryResultType }`** (**`QueryResultType`** from **`@aws-sdk/client-athena`**)
- **`ParsedRow`**, **`RowParser<T>`** — re-exported from **`athena-query-result-parser`**.

## Requirements

- Node.js **`>= 20.0.0`**
- AWS SDK for JavaScript v3 — **`@aws-sdk/client-athena`** (`AthenaClient`, **`QueryResultType`**)

## License

This project is licensed under the (Apache-2.0) License.
