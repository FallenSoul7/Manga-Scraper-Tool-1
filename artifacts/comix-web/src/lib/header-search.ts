import { useEffect, useSyncExternalStore } from "react";

/**
 * A "scope" lets the page that's currently visible take over the global header
 * search bar. The page declares what placeholder to show, what tags can be
 * filtered by (if any), and what to do whenever the user types or toggles a
 * tag. When the scope is cleared the header falls back to its default
 * behavior — routing the query to /search.
 */
export interface SourceTag {
  id: string;
  name: string;
  group?: string;
  count?: number;
}

export interface HeaderSearchScope {
  /** Placeholder shown in the input. */
  placeholder: string;
  /** Initial query value to seed the input. Defaults to "". */
  initialQuery?: string;
  /** Available tags for the filter button. If undefined the button is hidden. */
  availableTags?: SourceTag[];
  /** Initial selected tag ids. */
  initialTagIds?: string[];
  /**
   * Called whenever the user changes the query OR the selected tags. The page
   * decides what to do (filter live, fire a network request, …). The header
   * debounces typing slightly so this isn't called on every keystroke.
   */
  onChange: (query: string, tagIds: string[]) => void;
  /**
   * If true, the header sticks an "x" inside the input that resets the query.
   * Defaults to true.
   */
  showClear?: boolean;
}

let _current: HeaderSearchScope | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return _current;
}

export function useHeaderSearch(): HeaderSearchScope | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Register a search scope for the lifetime of the calling component. Pass a
 * dependency array — the scope will be re-installed whenever the deps change,
 * so the parent can stash fresh callbacks (closures over its current state)
 * without piling up listeners.
 *
 * The scope is automatically removed on unmount, restoring default header
 * behavior for the next page.
 */
export function useRegisterHeaderSearch(
  scope: HeaderSearchScope | null,
  deps: ReadonlyArray<unknown>,
) {
  useEffect(() => {
    _current = scope;
    emit();
    return () => {
      if (_current === scope) {
        _current = null;
        emit();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
