import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter, Search } from 'lucide-react';
import type { EngineeringColumnFilterOption } from '@/lib/engineering-table-filter';

type EngineeringColumnFilterProps = {
  label: string;
  options: EngineeringColumnFilterOption[];
  selectedValues?: string[];
  onApply: (values: string[] | undefined) => void;
};

type MenuPosition = { top: number; left: number };

function getMenuPosition(rect: DOMRect): MenuPosition {
  const width = Math.min(272, window.innerWidth - 16);
  const height = Math.min(360, window.innerHeight - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 4;
  const top = below + height <= window.innerHeight - 8
    ? below
    : Math.max(8, rect.top - height - 4);
  return { top, left };
}

export function EngineeringColumnFilter({
  label,
  options,
  selectedValues,
  onApply,
}: EngineeringColumnFilterProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const active = selectedValues !== undefined;
  const allValues = useMemo(() => options.map((option) => option.value), [options]);
  const shownOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? options.filter((option) => (option.value || '(Blanks)').toLowerCase().includes(query))
      : options;
  }, [options, search]);
  const selectedOptionCount = options.reduce((count, option) => count + Number(draft.includes(option.value)), 0);
  const allSelected = options.length > 0 && selectedOptionCount === options.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedOptionCount > 0 && selectedOptionCount < options.length;
    }
  }, [draft, options.length, selectedOptionCount]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition(getMenuPosition(rect));
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    updatePosition();
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition(getMenuPosition(rect));
    setDraft(selectedValues ? [...selectedValues] : allValues);
    setSearch('');
    setOpen(true);
  };

  const toggleValue = (value: string) => {
    setDraft((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`edm-column-filter-trigger${active ? ' active' : ''}`}
      title={`${active ? 'Filtered' : 'Filter'} ${label}`}
      aria-label={`${active ? 'Edit filter for' : 'Filter'} ${label}`}
      aria-expanded={open}
      onClick={toggleOpen}
      data-testid={`button-filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <Filter size={12}/><ChevronDown size={10}/>
    </button>
    {open && position && createPortal(
      <div
        ref={menuRef}
        className="edm-column-filter-menu"
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-label={`${label} filter`}
        data-testid="menu-column-filter"
      >
        <strong className="edm-column-filter-title">Filter: {label}</strong>
        <label className="edm-column-filter-search">
          <Search size={14}/>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search values…"
            aria-label={`Search ${label} values`}
          />
        </label>
        <label className="edm-column-filter-select-all">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            disabled={!options.length}
            onChange={() => setDraft(allSelected ? [] : allValues)}
          />
          <span>Select all</span>
        </label>
        <div className="edm-column-filter-options" role="group" aria-label={`${label} values`}>
          {!shownOptions.length && <p className="edm-column-filter-empty">{options.length ? 'No matching values.' : 'No values in this drawing yet.'}</p>}
          {shownOptions.map((option) => (
            <label className="edm-column-filter-option" key={JSON.stringify(option.value)}>
              <input type="checkbox" checked={draft.includes(option.value)} onChange={() => toggleValue(option.value)}/>
              <span>{option.value || '(Blanks)'}</span>
              <small>{option.count}</small>
            </label>
          ))}
        </div>
        <div className="edm-column-filter-actions">
          <button type="button" className="edm-column-filter-clear" disabled={!active} onClick={() => { onApply(undefined); setOpen(false); }}>Clear filter</button>
          <span/>
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="apply" disabled={!options.length} onClick={apply}>Apply</button>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
