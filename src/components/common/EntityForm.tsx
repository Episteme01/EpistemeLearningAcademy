import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useCollection } from '@/hooks/useFirestore';
import { buildSchema, fromFormValues, toFormValues, type FieldDef } from './crudFields';
import { RichTextEditor } from './RichTextEditor';
import { ImageField } from './ImageField';
import { cn } from '@/lib/utils';

type Row = Record<string, unknown> & { id: string };

function RefSelect({ field, id, value, onChange, invalid, describedBy }: {
  field: FieldDef; id: string; value: string; onChange: (id: string, row?: Row) => void; invalid: boolean; describedBy?: string;
}) {
  const ref = field.ref!;
  const { data, loading } = useCollection<Record<string, unknown>>(ref.collection, () => [], ref.collection);
  const rows = (data as Row[]).filter((r) => (ref.filter ? ref.filter(r) : true));
  const opts = rows.map((r) => ({ id: r.id, label: ref.label(r), row: r })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <Select id={id} value={value ?? ''} aria-invalid={invalid} aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value, rows.find((r) => r.id === e.target.value))}>
      <option value="">{loading ? 'Loading…' : 'Select…'}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </Select>
  );
}

export function EntityForm({ fields, initial, onSubmit, onCancel, submitLabel = 'Save', formId }: {
  fields: FieldDef[];
  initial: Record<string, unknown> | null;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  formId?: string;
}) {
  const editing = !!initial;
  const visible = useMemo(() => fields.filter((f) => !(editing && f.createOnly)), [fields, editing]);
  const schema = useMemo(() => buildSchema(visible), [visible]);
  const { register, control, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(fields, initial),
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit(fromFormValues(visible, values));
  });

  const err = (n: string) => (errors[n]?.message as string | undefined);

  return (
    <form id={formId} onSubmit={(e) => { void submit(e); }} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {visible.map((f) => {
        const span = f.span === 2 || f.type === 'textarea' || f.type === 'richtext' || f.type === 'image' || f.type === 'list' ? 'sm:col-span-2' : '';
        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={cn(span, 'self-end pb-2')}>
              <Checkbox label={f.label} {...register(f.name)} />
              {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
            </div>
          );
        }
        return (
          <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err(f.name)} className={span}>
            {(a) => {
              switch (f.type) {
                case 'textarea':
                  return <Textarea {...a} placeholder={f.placeholder} {...register(f.name)} />;
                case 'list':
                  return <Textarea {...a} placeholder={f.placeholder ?? 'One item per line'} {...register(f.name)} />;
                case 'select':
                  return (
                    <Select {...a} {...register(f.name)}>
                      {!f.required || !f.defaultValue ? <option value="">Select…</option> : null}
                      {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  );
                case 'ref':
                  return (
                    <Controller control={control} name={f.name} render={({ field }) => (
                      <RefSelect field={f} id={a.id} invalid={a['aria-invalid']} describedBy={a['aria-describedby']} value={String(field.value ?? '')}
                        onChange={(v, row) => {
                          field.onChange(v);
                          if (f.ref?.labelField) setValue(f.ref.labelField, row ? f.ref.label(row) : '');
                        }} />
                    )} />
                  );
                case 'image':
                  return <Controller control={control} name={f.name} render={({ field }) => <ImageField id={a.id} value={String(field.value ?? '')} onChange={field.onChange} />} />;
                case 'richtext':
                  return <Controller control={control} name={f.name} render={({ field }) => <RichTextEditor id={a.id} invalid={a['aria-invalid']} value={String(field.value ?? '')} onChange={field.onChange} />} />;
                case 'number':
                  return <Input {...a} type="number" inputMode="decimal" step="any" placeholder={f.placeholder} {...register(f.name, { setValueAs: (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)) })} />;
                case 'date':
                  return <Input {...a} type="date" {...register(f.name)} />;
                case 'datetime':
                  return <Input {...a} type="datetime-local" {...register(f.name)} />;
                default:
                  return <Input {...a} type={f.type === 'text' ? 'text' : f.type} placeholder={f.placeholder} {...register(f.name)} />;
              }
            }}
          </Field>
        );
      })}
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
