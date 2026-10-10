import { ArrowDown, ArrowUp } from 'lucide-react';
import { ENGINEERING_FIELDS, FIELD_LABELS } from '@/lib/engineering-data';
import type { EngineeringField } from '@/lib/engineering-data';

export function EngineeringColumnPicker({ order, hidden, onChange }: {
  order: EngineeringField[];
  hidden: EngineeringField[];
  onChange: (order: EngineeringField[], hidden: EngineeringField[]) => void;
}) {
  const move = (index: number, offset: number) => {
    const next = [...order];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next, hidden);
  };
  return <details className="edm-column-picker">
    <summary>Columns ({order.length - hidden.length})</summary>
    <div className="edm-column-options">
      <p>The table and current-view exports use this order. # and Object type always stay visible.</p>
      {order.map((field, index) => <div className="edm-column-option" key={field}>
        <label><input type="checkbox" checked={!hidden.includes(field)} aria-label={`Show ${FIELD_LABELS[field]}`}
          disabled={!hidden.includes(field) && hidden.length === order.length - 1}
          onChange={() => onChange(order, hidden.includes(field) ? hidden.filter((item) => item !== field) : [...hidden, field])}/>{FIELD_LABELS[field]}</label>
        <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${FIELD_LABELS[field]} up`}><ArrowUp size={14}/></button>
        <button type="button" disabled={index === order.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${FIELD_LABELS[field]} down`}><ArrowDown size={14}/></button>
      </div>)}
      <button className="btn subtle" type="button" onClick={() => onChange([...ENGINEERING_FIELDS], [])}>Reset columns</button>
    </div>
  </details>;
}
