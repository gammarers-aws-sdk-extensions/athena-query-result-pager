/**
 * Reports whether a `GetQueryResults` continuation token indicates another page.
 *
 * A defined token means continue, including an empty string (unlikely from Athena,
 * but distinct from `undefined`). Callers such as `hasNextPage` share this rule.
 *
 * @param nextToken - Token from a prior page response, if any.
 * @returns `true` when `nextToken` is defined.
 */
export const hasNextPageToken = (nextToken: string | undefined): nextToken is string =>
  nextToken !== undefined;

/**
 * Reports whether the caller has cancelled paging.
 *
 * A missing signal means the caller did not ask to cancel, so paging continues.
 *
 * @param signal - Abort signal from the caller, if any.
 * @returns `true` when the signal exists and is already aborted.
 */
export const isAbortRequested = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

/**
 * Removes leading and trailing whitespace from a query execution id.
 *
 * Internal spaces are kept. Callers still reject the result when it is empty.
 *
 * @param queryExecutionId - Athena query execution identifier candidate.
 * @returns The id with surrounding whitespace removed.
 */
export const normalizeQueryExecutionId = (queryExecutionId: string): string =>
  queryExecutionId.trim();

/**
 * Reports whether `queryExecutionId` is empty or whitespace only.
 *
 * @param queryExecutionId - Athena query execution identifier candidate.
 * @returns `true` when {@link normalizeQueryExecutionId} is empty.
 */
export const isBlankQueryExecutionId = (queryExecutionId: string): boolean =>
  normalizeQueryExecutionId(queryExecutionId) === '';
