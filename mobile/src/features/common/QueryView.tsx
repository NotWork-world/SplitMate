import React from 'react';
import {ErrorState, LoadingState} from '../../design';

type Q<T> = {data?: T; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown};

/** Renders loading / offline / error states for a query, or children with the data. */
export function QueryView<T>({query, children, loadingLabel}: {query: Q<T>; children: (data: T) => React.ReactNode; loadingLabel?: string}) {
  if (query.data !== undefined) {
    return <>{children(query.data)}</>;
  }
  if (query.isError) {
    const err = query.error as {code?: string; message?: string} | undefined;
    return (
      <ErrorState
        offline={err?.code === 'offline'}
        message={err?.message ?? 'Something went wrong.'}
        onRetry={() => query.refetch()}
      />
    );
  }
  return <LoadingState label={loadingLabel} />;
}
