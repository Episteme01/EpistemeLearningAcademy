import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, EmptyState, Spinner } from '@/components/ui/data';
import { Dialog, useToast } from '@/components/ui/overlay';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { createDoc, removeDoc } from '@/services/db';
import { notifyCall, notifyOn } from '@/services/push';
import { cleanOffsets } from '@/lib/notifyPolicy';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';

type Notice = { title: string; body: string; audience: string; classId?: string; className?: string; status: string; createdBy: string; createdByName?: string; createdAt?: unknown; recipientCount?: number; emailSent?: number; pushSent?: number; error?: string };
const AUDIENCES: Record<string, string> = { class_parents: 'Parents of a class', class_students: 'Students of a class', class_both: 'Students and parents of a class', all_parents: 'All parents', all_students: 'All students', all_staff: 'All staff' };
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info'> = { queued: 'info', processing: 'warn', sent: 'ok', failed: 'danger' };

export function NoticesPage() {
  const { uid, roles, profile } = useAuth();
  const toast = useToast();
  const leader = roles.some((r) => ['super_admin', 'admin', 'principal'].includes(r));
  const director = roles.includes('director');
  const canSend = leader || roles.includes('teacher');
  const classes = useCollection<{ name: string }>(C.classes, () => (canSend ? [] : null), 'cls');
  // rules can only prove a query that carries the same condition they check
  const all = useCollection<Notice>(C.notices, () => (leader || director ? [] : null), 'all');
  const mine = useCollection<Notice>(C.notices, () => (!leader && !director && uid ? [where('createdBy', '==', uid)] : null), `m${uid}`);
  const got = useCollection<Notice>(C.notices, () => (!leader && !director && uid ? [where('recipientUids', 'array-contains', uid)] : null), `g${uid}`);
  const rows = useMemo(() => {
    const m = new Map<string, Notice & { id: string }>();
    [...all.data, ...mine.data, ...got.data].forEach((n) => m.set(n.id, n));
    return [...m.values()].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  }, [all.data, mine.data, got.data]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ audience: 'class_parents', classId: '', title: '', body: '', sendEmail: true, sendPush: true });
  const [busy, setBusy] = useState(false);
  const audiences = leader ? Object.keys(AUDIENCES) : ['class_parents', 'class_students', 'class_both'];
  const needsClass = f.audience.startsWith('class_');

  const send = async () => {
    if (!uid) return;
    if (!f.title.trim() || !f.body.trim()) return toast.error('Write a title and a message.');
    if (needsClass && !f.classId) return toast.error('Choose a class.');
    setBusy(true);
    try {
      const cls = classes.data.find((c) => c.id === f.classId);
      const id = await createDoc(C.notices, { audience: f.audience, ...(needsClass ? { classId: f.classId, className: cls?.name ?? '' } : {}), title: f.title.trim(), body: f.body.trim(), sendEmail: f.sendEmail, sendPush: f.sendPush, status: 'queued', createdBy: uid, createdByName: profile?.displayName ?? '', createdAt: serverTimestamp() });
      setOpen(false); setF({ ...f, title: '', body: '' });
      if (notifyOn) { try { await notifyCall({ action: 'run-now', noticeId: id }); toast.success('Notice sent'); } catch { toast.success('Notice queued. It will go out within 5 minutes.'); } }
      else toast.success('Notice saved. It will go out once the notification service is switched on.');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const loading = all.loading || mine.loading || got.loading;
  return (
    <>
      <PageHeader title="Notices" description="Messages from the school. Each notice reaches people in the app and, if they allow it, by email and on their phone." actions={canSend ? <Button onClick={() => setOpen(true)}>New notice</Button> : undefined} />
      {leader && <ReminderSettings />}
      {loading ? <Spinner /> : rows.length === 0 ? <Card><EmptyState title="No notices yet" /></Card> : (
        <div className="space-y-3">{rows.map((n) => (
          <Card key={n.id}><CardBody>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-heading font-semibold">{n.title}</p>{(canSend) && <Badge tone={STATUS_TONE[n.status] ?? 'info'}>{n.status}</Badge>}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
            <p className="mt-2 text-xs text-muted">{fmtDate(n.createdAt, true)} · {n.createdByName ?? ''} · {AUDIENCES[n.audience] ?? n.audience}{n.className ? `: ${n.className}` : ''}{canSend && n.status === 'sent' ? ` · ${n.recipientCount ?? 0} people, ${n.emailSent ?? 0} emails, ${n.pushSent ?? 0} phone alerts` : ''}{n.error ? ` · ${n.error}` : ''}</p>
            {(leader || n.createdBy === uid) && <Button className="mt-2" size="sm" variant="ghost" onClick={() => void removeDoc(C.notices, n.id).catch((e) => toast.error(errorMessage(e)))}>Delete</Button>}
          </CardBody></Card>))}</div>)}
      <Dialog open={open} onClose={() => setOpen(false)} title="New notice" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={() => void send()}>Send</Button></>}>
        <div className="space-y-3">
          <Field label="Send to">{(a) => <Select {...a} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{audiences.map((k) => <option key={k} value={k}>{AUDIENCES[k]}</option>)}</Select>}</Field>
          {needsClass && <Field label="Class">{(a) => <Select {...a} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">Choose a class</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
          <Field label="Title">{(a) => <Input {...a} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Message">{(a) => <Textarea {...a} rows={5} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sendEmail} onChange={(e) => setF({ ...f, sendEmail: e.target.checked })} />Also send by email</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sendPush} onChange={(e) => setF({ ...f, sendPush: e.target.checked })} />Also send to phones</label>
        </div>
      </Dialog>
    </>
  );
}

/** Admin-only: reminder timing, channel switches and the one-time push key generator. */
function ReminderSettings() {
  const { roles } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ minutes: '60, 10', hours: '24', classReminders: true, homeworkReminders: true, email: true, push: true });
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getDoc(doc(db(), C.settings, 'notifications')).then((s) => {
      if (!s.exists()) return; const d = s.data();
      setV({ minutes: cleanOffsets(d.reminderMinutes).join(', '), hours: String(d.assignmentHours ?? 24), classReminders: d.classReminders !== false, homeworkReminders: d.homeworkReminders !== false, email: d.email !== false, push: d.push !== false });
    }).catch(() => undefined);
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const minutes = cleanOffsets(v.minutes.split(/[ ,]+/).map(Number));
      const hours = Math.min(168, Math.max(1, Number(v.hours) || 24));
      await setDoc(doc(db(), C.settings, 'notifications'), { reminderMinutes: minutes, assignmentHours: hours, classReminders: v.classReminders, homeworkReminders: v.homeworkReminders, email: v.email, push: v.push, updatedAt: serverTimestamp() });
      toast.success('Reminder settings saved');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const gen = async () => { setBusy(true); try { setKeys(await notifyCall<{ publicKey: string; privateKey: string }>({ action: 'generate-vapid' })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Card className="mb-5"><CardHeader title="Reminder settings" /><CardBody className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class reminders (minutes before start)" hint="e.g. 60, 10">{(a) => <Input {...a} value={v.minutes} onChange={(e) => setV({ ...v, minutes: e.target.value })} />}</Field>
        <Field label="Homework reminder (hours before deadline)">{(a) => <Input {...a} type="number" value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {([['classReminders', 'Class reminders'], ['homeworkReminders', 'Homework reminders'], ['email', 'Email'], ['push', 'Phone alerts']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{l}</label>)}
      </div>
      <div className="flex flex-wrap gap-2"><Button loading={busy} onClick={() => void save()}>Save settings</Button>{roles.includes('super_admin') && notifyOn && <Button variant="outline" loading={busy} onClick={() => void gen()}>Generate phone-alert keys</Button>}</div>
      {keys && <div className="rounded border border-line p-3 text-xs"><p className="font-medium">Save these now. The private key is shown only once and must never go in GitHub.</p><p className="mt-2 break-all"><strong>Public</strong> (put in src/config/notify.json and the Supabase secret VAPID_PUBLIC_KEY): {keys.publicKey}</p><p className="mt-2 break-all"><strong>Private</strong> (Supabase secret VAPID_PRIVATE_KEY only): {keys.privateKey}</p></div>}
    </CardBody></Card>
  );
}
