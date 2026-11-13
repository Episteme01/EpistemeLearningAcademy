import type { Role } from '@/config/permissions';

export type WithId<T> = T & { id: string };
/** Firestore Timestamp | Date | ISO string — normalised with toDate() from lib/utils */
export type TS = unknown;

import type { FileRef } from '@/lib/fileRef';

export interface UserProfile {
  email: string;
  displayName: string;
  /** Primary role (kept for backward compatibility; always one of `roles`). */
  role: Role;
  /** Every role this person holds. Authoritative; only admins can change it (see firestore.rules). */
  roles?: Role[];
  status: 'active' | 'suspended' | 'pending';
  phone?: string;
  photoUrl?: string;
  /** private profile picture (Supabase). Shown through a short-lived link. */
  photoRef?: FileRef;
  /** link to students/{id} for student accounts */
  studentId?: string;
  /** learners without an email sign in with this username (their Firebase email is a hidden internal one) */
  username?: string;
  loginType?: 'email' | 'username';
  /** class of a student account (denormalised for security rules) */
  classId?: string;
  staffId?: string;
  parentId?: string;
  devOnly?: boolean;
  createdAt?: TS;
  updatedAt?: TS;
}

export interface Student {
  studentNo: string;
  firstName: string;
  lastName: string;
  otherNames?: string;
  gender: 'male' | 'female' | '';
  dob?: string;
  classId: string;
  className?: string;
  programme?: string;
  admissionStatus: 'applicant' | 'admitted' | 'enrolled' | 'graduated' | 'withdrawn';
  status: 'active' | 'suspended' | 'inactive';
  photoUrl?: string;
  photoRef?: FileRef;
  address?: string;
  stateOfOrigin?: string;
  religion?: string;
  bloodGroup?: string;
  genotype?: string;
  allergies?: string;
  guardianPhone?: string;
  /** adult learners sign in with their own email; everyone else uses a username */
  isAdult?: boolean;
  /** username for learners who sign in without an email */
  username?: string;
  /** auth uid of the student's own login (or '') */
  studentUid: string;
  /** auth uids / staff ids of linked teachers */
  teacherUids?: string[];
  teacherIds?: string[];
  /** auth uids of linked parents/guardians */
  parentUids: string[];
  /** parents/{id} documents */
  parentIds: string[];
  admittedAt?: string;
  createdAt?: TS;
  updatedAt?: TS;
}

export interface Parent {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  occupation?: string;
  relationship?: string;
  userUid?: string;
  studentIds: string[];
}

export interface Staff {
  staffNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  department?: string;
  position?: string;
  role?: Role;
  status: 'active' | 'on_leave' | 'resigned' | 'inactive';
  dateJoined?: string;
  userUid?: string;
}

export interface ClassRoom {
  name: string;
  level: string;
  arm?: string;
  capacity?: number;
  classTeacherUid?: string;
  classTeacherName?: string;
  /** subjects this class offers (ids) and their names for display */
  subjectIds?: string[];
  subjectNames?: string[];
}

export interface Subject {
  name: string;
  code: string;
  category: 'conventional' | 'islamic' | 'ict' | 'skills';
  departmentId?: string;
}

export interface AcademicSession {
  name: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

export interface Term {
  sessionId: string;
  sessionName?: string;
  name: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

export interface TeacherAssignment {
  staffUid: string;
  staffName: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  date: string;
  classId: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  status: AttendanceStatus;
  note?: string;
  markedBy: string;
}

export interface FeeItem { label: string; amount: number }

export interface FeeStructure {
  name: string;
  classId?: string;
  termId?: string;
  items: FeeItem[];
  total: number;
  currency: string;
}

export interface Invoice {
  invoiceNo: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  classId?: string;
  termId?: string;
  termName?: string;
  items: FeeItem[];
  total: number;
  paid: number;
  balance: number;
  status: 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled';
  dueDate?: string;
  currency: string;
  /** fee category this invoice was made from (used to stop duplicates and to match advance payments) */
  structureId?: string;
  structureName?: string;
  createdAt?: TS;
}

/** Money received before an invoice existed (or released from a deleted invoice). It waits on the learner's account until applied. */
export interface StudentCredit {
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  amount: number;
  remaining: number;
  receiptNo: string;
  method: 'cash' | 'bank_transfer' | 'pos' | 'online';
  reference?: string;
  paidAt: string;
  termId?: string;
  termName?: string;
  structureId?: string;
  structureName?: string;
  note?: string;
  recordedBy: string;
  currency: string;
  createdAt?: TS;
}

export interface Payment {
  receiptNo: string;
  invoiceId: string;
  invoiceNo: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  amount: number;
  method: 'cash' | 'bank_transfer' | 'pos' | 'online';
  reference?: string;
  paidAt: string;
  recordedBy: string;
  currency: string;
  /** set when the money came from an advance payment (credit) */
  creditId?: string;
  gateway?: { provider: string; status: string };
  createdAt?: TS;
}

export interface ResultRecord {
  termId: string;
  classId: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  subjectId: string;
  subjectName: string;
  ca: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
  teacherComment?: string;
  status: 'draft' | 'submitted' | 'approved';
  enteredBy: string;
}

export interface ReportCard {
  termId: string;
  classId: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  total: number;
  average: number;
  position?: number;
  classSize?: number;
  teacherComment?: string;
  principalComment?: string;
  status: 'draft' | 'approved';
}

export interface Course {
  title: string;
  slug: string;
  description: string;
  category: string;
  thumbnail?: string;
  instructorUid: string;
  instructorName: string;
  durationHours?: number;
  level?: string;
  status: 'draft' | 'published';
  visibility: 'public' | 'students' | 'restricted';
  enrollmentMode: 'open' | 'assigned';
  createdAt?: TS;
}

export interface CourseModule { courseId: string; title: string; order: number }

export interface Lesson {
  courseId: string;
  moduleId: string;
  title: string;
  order: number;
  type: 'text' | 'video' | 'pdf' | 'file' | 'presentation';
  content?: string;
  videoUrl?: string;
  fileUrl?: string;
  /** private submission file (Supabase). */
  fileRef?: FileRef;
  attachments?: { name: string; url: string }[];
  durationMin?: number;
  preview?: boolean;
  /** presentation lessons: a library resource (resources/{id}) or a Google Slides link */
  resourceId?: string; resourceTitle?: string; slidesUrl?: string;
  /** 'watch' = needs tracked playback (direct video files only); default 'manual' */
  completionRule?: 'manual' | 'watch';
}

export interface CourseEnrollment {
  courseId: string;
  courseTitle: string;
  uid: string;
  studentId?: string;
  studentName: string;
  parentUids: string[];
  status: 'active' | 'completed';
  progressPct: number;
  completedLessons: number;
  totalLessons?: number;
  enrolledAt?: TS;
  completedAt?: TS;
  lastActivityAt?: TS;
}

export interface LiveClass {
  title: string;
  description?: string;
  courseId?: string;
  startsAt: TS;
  endsAt: TS;
  meetingUrl: string;
  provider: 'google_meet' | 'teams' | 'zoom' | 'other';
  hostName?: string;
}

export interface ChoiceOption { id: string; text: string }

export interface BankQuestion {
  type: 'mcq' | 'tf' | 'short';
  prompt: string;
  imageUrl?: string;
  options: ChoiceOption[];
  marks: number;
  subjectId: string;
  subjectName?: string;
  classId?: string;
  topic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  createdBy: string;
}

export interface QuestionKeyDoc {
  correct?: string;
  accepted?: string[];
  manual?: boolean;
  explanation?: string;
}

export interface Exam {
  title: string;
  subjectId: string;
  subjectName?: string;
  instructions: string;
  classIds: string[];
  studentUids: string[];
  startsAt: TS;
  endsAt: TS;
  durationMinutes: number;
  passMark: number;
  negativeMarking: { enabled: boolean; penalty: number };
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  questionIds: string[];
  /** 0 = all questions; N = random N per attempt */
  questionCount: number;
  maxAttempts: number;
  releasePolicy: 'immediate' | 'manual';
  status: 'draft' | 'published' | 'closed';
  totalMarks: number;
  createdBy: string;
  createdByName?: string;
}

export interface PaperQuestion {
  type: 'mcq' | 'tf' | 'short';
  prompt: string;
  imageUrl?: string;
  options: ChoiceOption[];
  marks: number;
  topic?: string;
}

export interface Attempt {
  examId: string;
  uid: string;
  studentId?: string;
  studentName: string;
  attemptNo: number;
  attemptKey: string;
  status: 'in_progress' | 'submitted' | 'graded';
  /** server timestamp; deadline = startedAt + exam.durationMinutes (enforced by rules) */
  startedAt: TS;
  questionIds: string[];
  answers: Record<string, string>;
  flagged: string[];
  submittedAt?: TS;
  autoSubmitted?: boolean;
}

export interface CbtResult {
  examId: string;
  examTitle: string;
  attemptId: string;
  uid: string;
  studentId?: string;
  studentName: string;
  studentUid: string;
  parentUids: string[];
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  pendingManual: number;
  outcomes: { questionId: string; status: string; awarded: number; max: number }[];
  manualMarks?: Record<string, number>;
  released: boolean;
  gradedAt?: TS;
  gradedBy?: string;
}


/* ---------------------------------------------------------- Timetable (Phase 2) */
export type SessionStatus = 'scheduled' | 'cancelled' | 'completed';

export interface TimetableSeries {
  title: string;
  description?: string;
  courseId?: string; courseName?: string;
  subjectId?: string; subjectName?: string;
  classId?: string; className?: string;
  teacherUid: string; teacherName: string;
  location?: string;
  online: boolean;
  provider?: string;
  startDate: string; startTime: string; endTime: string; timezone: string;
  recurrence: import('@/lib/schedule/recurrence').Recurrence;
  /** logins of the learners who may attend (after exclusions) */
  studentUids: string[];
  /** student record ids (for names / editing) */
  studentIds: string[];
  excludedStudentIds: string[];
  parentUids: string[];
  viewers: string[];
  status: 'active' | 'cancelled';
  createdBy: string; createdByName: string;
  createdAt?: TS; updatedAt?: TS;
}

/** One concrete class meeting. The meeting URL is NOT stored here (see SessionLink). */
export interface Session {
  seriesId: string; seriesIndex: number;
  title: string; description?: string;
  courseId?: string; courseName?: string;
  subjectId?: string; subjectName?: string;
  classId?: string; className?: string;
  teacherUid: string; teacherName: string;
  location?: string; online: boolean; provider?: string;
  startAt: TS; endAt: TS;
  localDate: string; monthKey: string; timezone: string;
  status: SessionStatus;
  cancelReason?: string;
  rescheduledFrom?: TS;
  /** true once this occurrence was edited on its own; series-wide edits then skip it */
  overridden: boolean;
  studentUids: string[]; parentUids: string[];
  /** teacher + learners + guardians: who may read this session (security rules) */
  viewers: string[];
  createdBy: string; createdByName?: string;
  updatedBy?: string; updatedByName?: string;
  createdAt?: TS; updatedAt?: TS;
}

/** Secret join details. Readable only by schedulers, the teacher, and — inside the join window — the session's audience. */
export interface SessionLink { provider: string; meetingUrl: string; meetingId?: string; passcode?: string; updatedBy?: string; updatedAt?: TS }

export interface SessionAccessLog { sessionId: string; teacherUid: string; uid: string; name: string; role: string; action: 'link_view' | 'link_click'; at?: TS }


/* ------------------------------------------------- Live-class attendance (Phase 3) */
export type AttStatus = 'pending_verification' | 'present' | 'absent' | 'excused' | 'left_early';
export type AttTiming = 'early' | 'on_time' | 'late';
export type AttMethod = 'self_checkin' | 'teacher_confirmed' | 'teacher_marked' | 'auto_finalised';

/** One learner at one session. Document id = `${sessionId}_${studentUid}`, so duplicates are impossible. */
export interface SessionAttendance {
  sessionId: string; seriesId: string;
  studentUid: string; studentId?: string; studentName: string;
  parentUids: string[];
  teacherUid: string; courseId?: string; classId?: string;
  monthKey: string;
  scheduledStart: TS; scheduledEnd: TS;
  /** server time of the learner's own check-in (absent for teacher-marked records) */
  checkInAt?: TS;
  status: AttStatus;
  /** early / on_time / late. Set when a teacher verifies; derived from checkInAt until then. */
  timing?: AttTiming | '';
  method: AttMethod;
  verified: boolean;
  verifiedBy?: string; verifiedByName?: string; markedBy?: string;
  note?: string;
  lastLogId?: string;
  createdAt?: TS; updatedAt?: TS;
}

/** Append-only change history. Every correction needs a written reason. */
export interface AttendanceLog {
  attendanceId: string; sessionId: string; studentUid: string; teacherUid: string;
  by: string; byName: string; byRole: string;
  fromStatus: string; toStatus: string; fromTiming?: string; toTiming?: string;
  reason: string; at?: TS;
}


/* ------------------------------------------------------ Media + resources (Phase 4) */
export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'link';

/** Website media library item (public files in Firebase Storage `public/media`, or an external image URL). */
export interface MediaItem {
  name: string; url: string; path?: string;
  alt?: string; description?: string;
  contentType?: string; kind?: MediaKind; size?: number;
  folder?: string; tags?: string[];
  source?: 'upload' | 'url';
  provider?: 'cloudinary' | 'firebase' | 'link';
  ref?: FileRef;
  uploadedBy?: string; uploadedByName?: string;
  createdAt?: TS; updatedAt?: TS;
}

export type ResourceAudience = 'student' | 'parent' | 'teacher';

/** A learning resource in the central Resources centre: an uploaded file, a library item or an external link. */
export interface Resource {
  title: string; description?: string;
  kind: 'file' | 'link';
  fileKind: MediaKind;
  /** public https link (links and library files). Empty for private uploads. */
  url: string;
  /** private upload in Supabase; opened through a short-lived signed link */
  fileRef?: FileRef | null;
  storagePath?: string; contentType?: string; size?: number; fileName?: string;
  subject?: string; courseId?: string; courseName?: string; classId?: string; className?: string;
  tags: string[];
  /** roles that may see it once published (staff academic roles always see everything) */
  visibleTo: ResourceAudience[];
  published: boolean;
  createdBy: string; createdByName?: string;
  createdAt?: TS; updatedAt?: TS;
}

/** Public Social Spotlight post (collection socialPosts). Media are links only; no video is stored in the app. */
export interface SocialPost {
  type: 'image' | 'video' | 'text';
  /** see SPOTLIGHT_CATEGORIES in lib/spotlight.ts; missing = 'other' */
  category?: string;
  title: string; caption?: string;
  /** sanitised rich text (text posts, and the full text of any post) */
  body?: string;
  thumbnailUrl?: string; imageUrl?: string; videoUrl?: string;
  status: 'draft' | 'published'; featured?: boolean; order?: number;
  publishedAt?: TS; createdAt?: TS; updatedAt?: TS;
}

/** Lesson written in the Lesson Authoring Studio (collection lessonPlans). Teacher-only notes are in lessonGuides/{id}. */
export interface LessonPlan {
  title: string; status: 'draft' | 'review' | 'approved' | 'published' | 'archived';
  curriculumId: string; topicId?: string; subtopicId?: string; week?: number; termId?: string;
  subjectId?: string; subjectName?: string; classId?: string; className?: string; courseId?: string;
  durationMin?: number; objectives?: string[]; materials?: string[]; references?: string[]; supplementary?: { title: string; url: string }[];
  previousKnowledge?: string; introduction?: string; presentation?: string; teacherActivities?: string; learnerActivities?: string; examples?: string;
  practical?: string; assessmentQuestions?: string; assignment?: string; conclusion?: string;
  authorUid: string; authorName?: string; teacherUids: string[]; reviewNote?: string; approvedBy?: string; publishedAt?: TS; version?: number;
  createdAt?: TS; updatedAt?: TS;
}
export interface LessonGuide { notes?: string; preparation?: string; teachingGuidance?: string; expectedAnswers?: string; differentiation?: string; updatedAt?: TS }

/** Per-learner activity on a lesson (collection lessonActivity, id uid_lessonId). Opening a lesson is NOT completion. */
export interface LessonActivity {
  uid: string; courseId: string; lessonId: string; parentUids: string[];
  watchedPct: number; ranges: number[][]; positionSec?: number; durationSec?: number; viewedAt?: TS; updatedAt?: TS;
}
/** Teacher message to a learner's parents (collection learningFeedback). */
export interface LearningFeedback {
  studentId: string; studentUid: string; studentName: string; parentUids: string[];
  courseId?: string; courseTitle?: string; message: string; teacherUid: string; teacherName: string; createdAt?: TS;
}
