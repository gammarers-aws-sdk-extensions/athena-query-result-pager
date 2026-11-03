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
 * Reports whether `queryExecutionId` is empty or whitespace only.
 *
 * @param queryExecutionId - Athena query execution identifier candidate.
 * @returns `true` when the trimmed id is empty.
 */
export const isBlankQueryExecutionId = (queryExecutionId: string): boolean =>
  queryExecutionId.trim() === '';
