import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ListEditorProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  addLabel: string;
  placeholder?: string;
  emptyText?: string;
  errorAt?: (index: number) => string | undefined;
}

/** Editable list of strings (command arguments, regular expressions, ...). */
export function ListEditor({ id, value, onChange, addLabel, placeholder, emptyText, errorAt }: ListEditorProps) {
  return (
    <div className="space-y-2">
      {value.length === 0 && emptyText && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {value.map((item, index) => {
        const error = errorAt?.(index);
        return (
          // Plain strings have no identity of their own; the position is the identity.
          // oxlint-disable-next-line react/no-array-index-key
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                id={index === 0 ? id : undefined}
                value={item}
                placeholder={placeholder}
                aria-invalid={!!error}
                className="font-mono text-xs"
                onChange={(event) => onChange(value.map((current, i) => (i === index ? event.target.value : current)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ''])}>
        <Plus data-icon="inline-start" />
        {addLabel}
      </Button>
    </div>
  );
}

interface StatusCodesInputProps {
  id?: string;
  value: number[];
  onChange: (value: number[]) => void;
  invalid?: boolean;
}

/** Tag input for HTTP status codes: type a code and press Enter, comma or space. */
export function StatusCodesInput({ id, value, onChange, invalid }: StatusCodesInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const tokens = draft.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const next = [...value];
    for (const token of tokens) {
      const code = Number(token);
      if (!Number.isInteger(code) || code < 100 || code > 599) {
        setError(`"${token}" is not an HTTP status code (100–599)`);
        return;
      }
      if (!next.includes(code)) next.push(code);
    }
    onChange(next.sort((a, b) => a - b));
    setDraft('');
    setError(null);
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
          (invalid || error) && 'border-destructive',
        )}
      >
        {value.map((code) => (
          <Badge key={code} variant="secondary" className="gap-1 font-mono">
            {code}
            <button
              type="button"
              className="rounded-sm opacity-60 hover:opacity-100"
              aria-label={`Remove ${code}`}
              onClick={() => onChange(value.filter((current) => current !== code))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          value={draft}
          inputMode="numeric"
          placeholder={value.length === 0 ? 'e.g. 429' : 'Add…'}
          className="min-w-16 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
