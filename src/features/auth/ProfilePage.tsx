import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from './AuthContext';
import { PhotoControl } from '@/components/common/PhotoControl';
import { patchDoc } from '@/services/db';
import { C } from '@/config/collections';
import { ROLE_LABELS, rolesOf } from '@/config/permissions';
import { NotificationSettings } from '@/features/notices/NotificationSettings';
import { errorMessage } from '@/lib/utils';

export function ProfilePage() {
  const { profile, uid, resetPassword } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  if (!profile || !uid) return null;
  const save = async () => {
    setBusy(true);
    try { await patchDoc(C.users, uid, { displayName: name.trim(), phone: phone.trim() }); toast.success('Profile updated'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="My profile" description={`${rolesOf(profile).map((r) => ROLE_LABELS[r]).join(' · ')} · ${profile.email}`} />
      <Card className="max-w-xl"><CardBody className="space-y-4">
        <PhotoControl collection="users" docId={uid} name={profile.displayName} current={profile.photoRef ?? null} legacyUrl={profile.photoUrl} />
        <Field label="Full name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={() => void save()}>Save</Button>
          <Button variant="outline" onClick={() => { void resetPassword(profile.email).then(() => toast.success('Password reset email sent')); }}>Email me a password reset link</Button>
        </div>
      </CardBody></Card>
      <NotificationSettings />
    </>
  );
}
