# Athena Query Result Pager

![npm](https://img.shields.io/npm/v/athena-query-result-pager)
![license](https://img.shields.io/npm/l/athena-query-result-pager)

Paginate [AWS Athena](https://docs.aws.amazon.com/athena/latest/ug/v3-sdk.html) **`GetQueryResults`** calls with AWS SDK v3. This library walks **`NextToken`**, parses tabular rows with [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser) (0.4+), and forwards **`MaxResults`**, **`QueryResultType`**, and optional **`ParseResultSetOptions`** from **[PagerOptions](#options)** on every page fetch.

Page-level and row-level APIs are symmetric: use the base method for raw **`ParsedRow`** values, or the `*With` / `rowParser` variant for custom types.

## Compared to the AWS SDK paginator

`@aws-sdk/client-athena` already ships [`paginateGetQueryResults`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-athena/Function/paginateGetQueryResults/). It walks **`NextToken`** and yields raw **`GetQueryResultsCommandOutput`** pages — fine if you only need SDK-shaped pages and will parse rows yourself.

**This package is the easier path when you want rows, not raw Athena pages:** header skipping, dictionary / typed rows, and page- or row-level async iteration are built in, so you skip the usual glue code around the official paginator.

| | SDK `paginateGetQueryResults` | This package |
| --- | --- | --- |
| Page walking (`NextToken`) | Yes | Yes |
| Output | Raw Athena / SDK page objects | Parsed **`ParsedRow`** (or custom `T` via **`RowParser`**) |
| Header-row handling & parse options | You implement | Via [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser) (`skipHeaderRow`, mismatch behavior, …) |
| Row-level async iteration | You flatten pages | **`iterateRows`** (one page buffered at a time) |
| Defaults for **`MaxResults`** / **`QueryResultType`** | Per request input | Constructor **`PagerOptions`**, applied every fetch |
| Input checks | SDK only | Fail-fast for empty **`queryExecutionId`** and invalid **`maxResults`** |

Both still require a finished query execution and rely on your **`AthenaClient`** for retries — see **[Caller responsibilities](#caller-responsibilities)**.

## Features

- Sends paginated Athena **`GetQueryResults`** requests (`NextToken` / **`MaxResults`**).
- Forwards **`QueryResultType`** from the pager constructor on each request — accepts the full AWS SDK enum (**`QueryResultType.DATA_ROWS`**, **`QueryResultType.DATA_MANIFEST`**, …). Use **`QueryResultType.DATA_MANIFEST`** for CTAS / UNLOAD / INSERT manifest workflows when Athena allows it.
- Forwards **`parseResultSetOptions`** to every parser invocation — **`columnCountMismatchBehavior`**, **`skipHeaderRow`**, **`headerRowDetectionStrategy`**, and other [parser 0.4+ options](https://www.npmjs.com/package/athena-query-result-parser).
- **Paired APIs** for raw **`ParsedRow`** dictionaries versus typed rows via **`RowParser<T>`**:
  - Page level: **`fetchPage`** / **`fetchPageWith`**, **`iteratePages`** / **`iteratePagesWith`**
  - Row level: **`iterateRows`** (no parser) / **`iterateRows`** (with **`rowParser`**)
- Async generators iterate **page-by-page** or **row-by-row** without holding full result sets in memory (only one page of rows is buffered at a time for row iterators).
- Fail-fast validation: **`maxResults`** must be an integer in **`1..1000`**; **`queryExecutionId`** must be non-empty (**`fetchPage`**, **`fetchPageWith`**).
- Re-exports **`QueryResultType`**, parser types (**`ParseResultSetOptions`**, **`ParsedRow`**, **`RowParser<T>`**, …), and parser utilities (**`rowToTypedObject`**, **`EXTRA_COLUMNS_KEY`**, …) from the package entry point.
- Helpers: **`AthenaQueryResultPager.hasNextPage`**, **`getLastHeaderRowDecision()`**, and **`reset()`** (usually optional — parser state resets automatically when **`queryExecutionId`** changes).
- Does **not** wait for query completion or add Athena-specific retry beyond the AWS SDK client — see **[Caller responsibilities](#caller-responsibilities)**.

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

Runtime dependencies: `@aws-sdk/client-athena`, `athena-query-result-parser` **`^0.4.0`**. Your application typically already instantiates **`AthenaClient`** with credentials and Region.

## Usage

### Create a pager instance

**`AthenaQueryResultPager`** normalizes options at construction time (**defaults**: **`maxResults`** `1000`, **`queryResultType`** `QueryResultType.DATA_ROWS`). **`maxResults`** and **`queryResultType`** are sent on every **`GetQueryResults`** call; **`parseResultSetOptions`** (when set) is applied on every page parse.

```ts
import { AthenaClient } from '@aws-sdk/client-athena';
import { AthenaQueryResultPager, QueryResultType } from 'athena-query-result-pager';

const client = new AthenaClient({ region: 'us-east-1' });
const pager = new AthenaQueryResultPager(client, {
  maxResults: 1000,
  queryResultType: QueryResultType.DATA_ROWS,
});

// Manifest-style outputs (only for supported Athena query types):
const manifestPager = new AthenaQueryResultPager(client, {
  queryResultType: QueryResultType.DATA_MANIFEST,
});

// Parser options (athena-query-result-parser 0.4+), applied on every page parse:
const strictPager = new AthenaQueryResultPager(client, {
  parseResultSetOptions: {
    columnCountMismatchBehavior: 'throw',
    headerRowDetectionStrategy: 'safe',
  },
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

interface MyRow {
  id: string;
  name: string;
}
const rowParser: RowParser<MyRow> = (row) => {
  if (row.name == null || row.name === '') return null;
  return { id: row['id'] ?? '', name: row.name };
};

const page = await pager.fetchPageWith('query-execution-id', rowParser);
// page.rows is MyRow[] (rows where rowParser returned null are omitted)
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

```ts
// Raw ParsedRow rows (delegates to iteratePages)
for await (const row of pager.iterateRows('query-execution-id')) {
  console.log(row);
}

// With custom row parser (delegates to iteratePagesWith)
for await (const row of pager.iterateRows('query-execution-id', rowParser)) {
  console.log(row);
}
```

### Inspect header-row skipping

When **`parseResultSetOptions.skipHeaderRow`** is **`'auto'`**, check whether the first row was skipped:

```ts
await pager.fetchPage('query-execution-id');
const decision = pager.getLastHeaderRowDecision();
console.log(decision?.skipped, decision?.reason);
```

### Reusing a pager across executions

Switching to a different **`queryExecutionId`** on **`fetchPage`** / **`fetchPageWith`** (and iterators that call them) **automatically resets** the bundled parser so header-row handling does not leak between queries. Call **`reset()`** only when you need to clear parser state without starting a new fetch:

```ts
pager.reset();
```

## Caller responsibilities

This library only paginates and parses **`GetQueryResults`**. It does **not** start queries, wait for execution to finish, or wrap Athena errors with custom retry policies. Failures surface as thrown AWS SDK errors (or parser errors) from **`fetchPage`** / **`fetchPageWith`**.

Handle the following in the calling application (or via **`AthenaClient`** configuration):

- **Query not finished yet** — Before paging, wait until **`GetQueryExecution`** reports a terminal state such as **`SUCCEEDED`**. Calling this pager while the query is still **`QUEUED`** / **`RUNNING`** will fail with the usual Athena / SDK error for that situation.
- **Throttling and transient API errors** — Configure retry on the **`AthenaClient`** (AWS SDK v3 retry middleware / client `maxAttempts`, etc.) or retry at the call site around **`fetchPage`** / iterators. This package does not implement Athena-specific backoff for **`ThrottlingException`** or similar.
- **Failed / cancelled queries** — Check execution state (and Athena’s error reason) before or when catching failures; the pager assumes a completed execution that can return result pages.

## Options

### `PagerOptions`

- **`maxResults?: number`**
  - Default **`1000`**.
  - Valid range: integer **`1..1000`** (Athena **`GetQueryResults`** limit).
  - Throws **`RangeError`** when invalid (**constructor**).
- **`queryResultType?: QueryResultType`**
  - Type is the AWS SDK **`QueryResultType`** enum (**`QueryResultType.DATA_ROWS`**, **`QueryResultType.DATA_MANIFEST`**, …) — not restricted to a single literal.
  - Import **`QueryResultType`** from **`athena-query-result-pager`** (re-exported from **`@aws-sdk/client-athena`**).
  - Default **`QueryResultType.DATA_ROWS`**.
  - When set (**including default**), the value appears on **`fetchPage`**, **`fetchPageWith`**, and iterator-driven calls alongside **`MaxResults`**.
- **`parseResultSetOptions?: ParseResultSetOptions`**
  - Forwarded to every **`AthenaQueryResultParser.parseResultSet`** / **`parseResultSetWith`** call on this pager.
  - Use for **`columnCountMismatchBehavior`** (`'silent' | 'throw' | 'warn' | 'extra'`), **`skipHeaderRow`**, **`headerRowDetectionStrategy`**, **`duplicateColumnNames`**, and other options documented in **`athena-query-result-parser`**.
  - Import **`ParseResultSetOptions`** from **`athena-query-result-pager`** (re-exported).
  - Inspect header skipping via **`pager.getLastHeaderRowDecision()`** after a fetch.

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
- **`iterateRows(queryExecutionId)`** → **`AsyncGenerator<ParsedRow>`**
- **`iterateRows<T>(queryExecutionId, rowParser)`** → **`AsyncGenerator<T>`**
- **`getLastHeaderRowDecision()`** → **`HeaderRowDecision | null`**
- **`reset()`** — clears bundled parser state (**header row bookkeeping**). Usually unnecessary: **`fetchPage`** / **`fetchPageWith`** reset automatically when **`queryExecutionId`** changes.
- **`static hasNextPage<T>(pageResult: PageResult<T>)`** → **`boolean`**

### Types and re-exports

- **`PageResult<T>`** — **`{ rows: T[]; nextToken?: string; rowCount: number }`**
- **`PagerOptions`** — **`{ maxResults?: number; queryResultType?: QueryResultType; parseResultSetOptions?: ParseResultSetOptions }`**
- **`QueryResultType`** — enum re-exported from **`@aws-sdk/client-athena`** (**`DATA_ROWS`**, **`DATA_MANIFEST`**, …)
- **`ParseResultSetOptions`**, **`ColumnCountMismatchBehavior`**, **`HeaderRowDecision`**, **`ParsedRow`**, **`RowParser<T>`**, **`TypedParsedRow`**, **`AthenaTypedValue`** — re-exported from **`athena-query-result-parser`**
- **`EXTRA_COLUMNS_KEY`**, **`toNumber`**, **`toBoolean`**, **`toDate`**, **`headersFromMeta`**, **`rowToObject`**, **`rowToTypedObject`**, **`isHeaderRow`** — re-exported parser utilities

## Requirements

- Node.js **`>= 20.0.0`**
- **`@aws-sdk/client-athena`** — provide **`AthenaClient`**; **`QueryResultType`** is also re-exported by this package
- **`athena-query-result-parser`** **`^0.4.0`**

## License

This project is licensed under the (Apache-2.0) License.
