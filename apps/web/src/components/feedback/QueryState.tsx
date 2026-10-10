import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ErrorCard } from "./ErrorCard";

interface Props<T> {
  query: Pick<UseQueryResult<T>, "data" | "isLoading" | "isError" | "error" | "refetch" | "isFetching">;
  /** What is being loaded, for the error message: "your achievements". */
  what: string;
  /** Placeholder while the first load is in flight. */
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * One place for the three states of a request: skeleton while loading, an error
 * card with a retry button when it failed, the content when there is data.
 */
export function QueryState<T>({ query, what, skeleton, children }: Props<T>) {
  if (query.isLoading) return <div aria-busy="true" aria-live="polite">{skeleton}</div>;
  if (query.isError || query.data === undefined) {
    return <ErrorCard what={what} error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <>{children(query.data)}</>;
}
