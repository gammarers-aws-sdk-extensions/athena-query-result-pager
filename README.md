# Athena Query Result Pager

[![npm version](https://img.shields.io/npm/v/athena-query-result-pager?style=flat-square)](https://www.npmjs.com/package/athena-query-result-pager)
[![license](https://img.shields.io/npm/l/athena-query-result-pager?style=flat-square)](https://www.npmjs.com/package/athena-query-result-pager)
[![Node.js](https://img.shields.io/node/v/athena-query-result-pager?style=flat-square)](https://www.npmjs.com/package/athena-query-result-pager)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-sdk-extensions/athena-query-result-pager/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-sdk-extensions/athena-query-result-pager/actions/workflows/build.yml)

Paginate [AWS Athena](https://docs.aws.amazon.com/athena/latest/ug/v3-sdk.html) **`GetQueryResults`** calls with AWS SDK v3. This library walks **`NextToken`**, parses tabular rows with [athena-query-result-parser](https://www.npmjs.com/package/athena-query-result-parser) (0.7+), and forwards **`MaxResults`**, **`QueryResultType`**, and optional **`ParseResultSetOptions`** from **`PagerOptions`** on every page fetch.

## Features

- Sends paginated Athena **`GetQueryResults`** requests (`NextToken` / **`MaxResults`**).
- Isolates parser state per query via **`forExecution(queryExecutionId)`** → **`AthenaQueryExecutionPager`** (separate handles may run concurrently; overlapping use of the same handle throws **`AthenaQueryResultPagerConcurrentAccessError`**).
- Forwards **`QueryResultType`** and **`parseResultSetOptions`** on every request / parse (including **`QueryResultType.DATA_MANIFEST`** when Athena supports it).
- Paired page and row APIs for raw **`ParsedRow`** or custom **`RowParser<T>`** (`fetchPage` / `fetchPageWith`, `fetchPageDetailed`, `iteratePages*` / `iterateRows`).
- Async generators walk pages or rows without holding the full result set in memory.
- Fail-fast typed errors for invalid **`maxResults`** and empty **`queryExecutionId`**.
- Re-exports **`QueryResultType`**, parser types, parser errors, and parser utilities from the package entry point.
- Compared with the SDK’s [`paginateGetQueryResults`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-athena/Function/paginateGetQueryResults/): this package returns parsed rows (and optional typed mapping) instead of raw SDK page objects.

## How it works

1. Construct **`AthenaQueryResultPager`** with an **`AthenaClient`** and optional **`PagerOptions`**.
2. Call **`forExecution(queryExecutionId)`** to get an **`AthenaQueryExecutionPager`** with its own parser state.
3. Use **`fetchPage`** / **`fetchPageWith`** / **`fetchPageDetailed`** or the **`iteratePages*`** / **`iterateRows`** generators on that handle; pass **`nextToken`** from the previous page when paging manually.
4. The library does not start queries or wait for completion — wait until the execution succeeds before paging.

## Installation

### npm

```bash
npm install athena-query-result-pager
```

### yarn

```bash
yarn add athena-query-result-pager
```

### pnpm

```bash
pnpm add athena-query-result-pager
```

Runtime dependencies: `@aws-sdk/client-athena`, `athena-query-result-parser` **`^0.7.0`**. Your application typically already instantiates **`AthenaClient`** with credentials and Region.

## Usage

### Create a pager and execution handle

```ts
import { AthenaClient } from '@aws-sdk/client-athena';
import { AthenaQueryResultPager, QueryResultType } from 'athena-query-result-pager';

const client = new AthenaClient({ region: 'us-east-1' });
const pager = new AthenaQueryResultPager(client, {
  maxResults: 1000,
  queryResultType: QueryResultType.DATA_ROWS,
  parseResultSetOptions: {
    columnCountMismatchBehavior: 'throw',
    headerRowDetectionStrategy: 'safe',
  },
});

const execution = pager.forExecution('query-execution-id');
```

### Fetch pages

```ts
const page = await execution.fetchPage();
console.log(page.rows, page.nextToken, page.rowCount);

if (AthenaQueryResultPager.hasNextPage(page)) {
  const nextPage = await execution.fetchPage(page.nextToken);
  // ...
}

const detailed = await execution.fetchPageDetailed();
console.log(detailed.diagnostics.headerRowDecision, detailed.diagnostics.rawRowCount);
```

### Custom row parser

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

const page = await execution.fetchPageWith(rowParser);
```

### Iterate pages or rows

```ts
for await (const page of execution.iteratePages()) {
  console.log(page.rowCount, page.rows);
}

for await (const page of execution.iteratePagesDetailed()) {
  console.log(page.diagnostics.truncatedByMaxRows);
}

for await (const page of execution.iteratePagesWith(rowParser)) {
  console.log(page.rows);
}

for await (const row of execution.iterateRows()) {
  console.log(row);
}

for await (const row of execution.iterateRows(rowParser)) {
  console.log(row);
}
```

### Header-row decision and reset

```ts
await execution.fetchPage();
const decision = execution.getLastHeaderRowDecision();
console.log(decision?.skipped, decision?.reason);

execution.reset();
```

### Concurrent handles

```ts
const execA = pager.forExecution('exec-a');
const execB = pager.forExecution('exec-b');
await Promise.all([execA.fetchPage(), execB.fetchPage()]); // OK

const exec = pager.forExecution('exec-1');
const pending = exec.fetchPage();
await exec.fetchPage(); // throws AthenaQueryResultPagerConcurrentAccessError
await pending;
```

### Caller responsibilities

- **Query not finished yet** — Wait until **`GetQueryExecution`** reports a terminal state such as **`SUCCEEDED`** before paging.
- **Throttling and transient API errors** — Configure retry on **`AthenaClient`** or at the call site; this package does not add Athena-specific backoff.
- **Failed / cancelled queries** — Check execution state before or when catching failures; the pager assumes a completed execution that can return result pages.

AWS SDK errors and parser errors from **`athena-query-result-parser`** are propagated unchanged (not wrapped in pager errors).

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxResults` | `number` | `1000` | Athena `MaxResults` per request; integer **`1..1000`**. Invalid values throw **`AthenaQueryResultPagerInvalidMaxResultsError`**. |
| `queryResultType` | `QueryResultType` | `QueryResultType.DATA_ROWS` | Forwarded on every `GetQueryResults` call. Import from this package (re-exported from `@aws-sdk/client-athena`). |
| `parseResultSetOptions` | `ParseResultSetOptions` | parser defaults | Forwarded to every parse on execution handles (`skipHeaderRow`, `columnCountMismatchBehavior`, `maxRows`, …). |

**`forExecution(queryExecutionId)`** throws **`AthenaQueryResultPagerEmptyQueryExecutionIdError`** when the id is empty or whitespace-only.

## Requirements

- Node.js **`>= 20.0.0`**
- **`@aws-sdk/client-athena`** — provide **`AthenaClient`**; **`QueryResultType`** is also re-exported by this package
- **`athena-query-result-parser`** **`^0.7.0`**

## License

This project is licensed under the (Apache-2.0) License.
