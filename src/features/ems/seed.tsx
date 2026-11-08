import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { C } from '@/config/collections';
import { batchSet, createDoc } from '@/services/db';
import { createAccount } from '@/services/accounts';
import { nextStudentNo } from '@/services/counters';
import { errorMessage, slugify } from '@/lib/utils';
import legacy from '@/data/legacySubjects.json';

interface LegacyLesson { id: string; title: string; content: string }
interface LegacySubject { id: string; title: string; description: string; lessons: LegacyLesson[] }

const CLASSES = ['Nursery 1', 'Nursery 2', 'Primary 1', 'Primary 2', 'Primary 3', 'JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'];
const SUBJECTS: [string, string, 'conventional' | 'islamic' | 'ict' | 'skills'][] = [['Mathematics', 'MTH', 'conventional'], ['English Language', 'ENG', 'conventional'], ['Basic Science', 'SCI', 'conventional'], ['Islamic Studies', 'IRS', 'islamic'], ['ICT / Digital Skills', 'ICT', 'ict']];

/** Super-admin only. Writes clearly labelled starter data. Demo accounts are fictional and flagged devOnly. */
export function SeedPage() {
  const { uid, profile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const say = (m: string) => setLog((l) => [...l, m]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); toast.success('Done'); } catch (e) { toast.error(errorMessage(e)); say(`Error: ${errorMessage(e)}`); } finally { setBusy(''); } };

  const structure = () => run('structure', async () => {
    await batchSet(CLASSES.map((n) => ({ col: C.classes, id: slugify(n), data: { name: n, level: n.split(' ')[0] }, merge: true })));
    await batchSet(SUBJECTS.map(([n, code, category]) => ({ col: C.subjects, id: code.toLowerCase(), data: { name: n, code, category }, merge: true })));
    say(`Classes (${CLASSES.length}) and subjects (${SUBJECTS.length}) written.`);
  });

  const courses = () => run('courses', async () => {
    for (const s of legacy as LegacySubject[]) {
      const cid = `legacy-${s.id}`;
      await createDoc(C.courses, { title: s.title, slug: slugify(s.title), description: s.description, category: 'General', instructorUid: uid ?? '', instructorName: profile?.displayName ?? '', status: 'published', visibility: 'students', enrollmentMode: 'open' }, cid);
      await createDoc(C.modules, { courseId: cid, title: 'Lessons', order: 1 }, `${cid}-m1`);
      let i = 0;
      for (const l of s.lessons) { i++; await createDoc(C.lessons, { courseId: cid, moduleId: `${cid}-m1`, title: l.title, order: i, type: 'text', content: l.content }, `${cid}-${l.id}`); }
      say(`Course “${s.title}” with ${s.lessons.length} lessons imported from the legacy site.`);
    }
  });

  const questions = () => run('questions', async () => {
    const qs = [
      { prompt: 'What is 1/4 + 2/4?', options: ['1/4', '3/4', '3/8', '2/4'], ans: 2, topic: 'Fractions' },
      { prompt: 'Which number is the denominator in 3/5?', options: ['3', '5', '8', '15'], ans: 2, topic: 'Fractions' },
      { prompt: 'What is 12 × 6?', options: ['62', '66', '72', '76'], ans: 3, topic: 'Multiplication' },
    ];
    for (const q of qs) {
      const id = await createDoc(C.questions, { type: 'mcq', prompt: q.prompt, options: q.options.map((t, i) => ({ id: `o${i + 1}`, text: t })), marks: 1, subjectId: 'mth', subjectName: 'Mathematics', topic: q.topic, difficulty: 'easy', createdBy: uid ?? '' });
      await batchSet([{ col: C.questionKeys, id, data: { correct: `o${q.ans}` }, merge: false }]);
    }
    say(`${qs.length} sample questions added (Mathematics).`);
  });

  const demo = () => run('demo', async () => {
    if (pw.length < 10) throw new Error('Enter a demo password of at least 10 characters.');
    const stuNo = await nextStudentNo();
    const sid = await createDoc(C.students, { studentNo: stuNo, firstName: 'Demo', lastName: 'Learner', gender: '', classId: 'jss-1', className: 'JSS 1', admissionStatus: 'enrolled', status: 'active', parentUids: [], studentUid: '', demo: true });
    const su = await createAccount({ email: 'demo.student@example.invalid', password: pw, displayName: 'Demo Learner (fictional)', role: 'student', studentId: sid, classId: 'jss-1', devOnly: true });
    await batchSet([{ col: C.students, id: sid, data: { studentUid: su }, merge: true }]);
    await createAccount({ email: 'demo.teacher@example.invalid', password: pw, displayName: 'Demo Teacher (fictional)', role: 'teacher', devOnly: true });
    say('Demo accounts created: demo.student@example.invalid and demo.teacher@example.invalid (devOnly). Delete them before going live.');
  });

  return (
    <>
      <PageHeader title="Seed & import" description="Optional starter data. Safe to skip. Run on a development project first." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader title="1. Classes and subjects" /><CardBody className="space-y-3"><p className="text-sm text-muted">Creates standard classes and subjects. Re-running updates them in place.</p><Button loading={busy === 'structure'} onClick={() => void structure()}>Create</Button></CardBody></Card>
        <Card><CardHeader title="2. Courses from the old website" /><CardBody className="space-y-3"><p className="text-sm text-muted">Imports the five legacy subjects and their lessons into the LMS.</p><Button loading={busy === 'courses'} onClick={() => void courses()}>Import courses</Button></CardBody></Card>
        <Card><CardHeader title="3. Sample questions" /><CardBody className="space-y-3"><p className="text-sm text-muted">Adds a few Mathematics questions to the CBT bank.</p><Button loading={busy === 'questions'} onClick={() => void questions()}>Add questions</Button></CardBody></Card>
        <Card><CardHeader title="4. Fictional demo accounts (dev only)" /><CardBody className="space-y-3"><Field label="Password for demo accounts" hint="Typed here, never stored in code.">{(a) => <Input {...a} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field><Button variant="outline" loading={busy === 'demo'} onClick={() => void demo()}>Create demo accounts</Button></CardBody></Card>
      </div>
      {log.length > 0 && <Card className="mt-4"><CardBody><ul className="list-disc space-y-1 pl-5 text-sm">{log.map((l, i) => <li key={i}>{l}</li>)}</ul></CardBody></Card>}
    </>
  );
}
