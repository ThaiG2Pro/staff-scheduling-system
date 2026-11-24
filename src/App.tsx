/**
 * @file Root React application component routing between `ScheduleListScreen` and
 * `ScheduleWorkspaceScreen` based on `activeScheduleId` and `storageMode`.
 */

import type { LoadStateResult } from './persistence/storageTypes';
import { useScheduleStore, type StoreOptions } from './state/useScheduleStore';
import { ScheduleListScreen } from './ui/screens/ScheduleListScreen';
import { ScheduleWorkspaceScreen } from './ui/screens/ScheduleWorkspaceScreen';

export interface AppProps {
  bootstrapState: LoadStateResult;
  storeOptions?: StoreOptions;
}

/**
 * Root SPA shell initialized cleanly from pre-loaded `bootstrapState`.
 * Always shows `ScheduleListScreen` when storage is locked or no schedule is active.
 *
 * @param props - Pre-loaded hydration result and optional test store dependencies.
 * @returns Active top-level screen.
 */
export function App({ bootstrapState, storeOptions }: AppProps) {
  const store = useScheduleStore(bootstrapState, storeOptions);

  if (store.storageMode === 'normal' && store.activeSchedule !== null) {
    return <ScheduleWorkspaceScreen store={store} schedule={store.activeSchedule} />;
  }

  return <ScheduleListScreen store={store} />;
}
