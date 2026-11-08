import type { Role } from '@/config/permissions';

export type WithId<T> = T & { id: string };
/** Firestore Timestamp | Date | ISO string — normalised with toDate() from lib/utils */
export type TS = unknown;

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
  /** link to students/{id} for student accounts */
  studentId?: string;
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
  address?: string;
  stateOfOrigin?: string;
  religion?: string;
  bloodGroup?: string;
  genotype?: string;
  allergies?: string;
  guardianPhone?: string;
  /** auth uid of the student's own login (or '') */
  studentUid: string;
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
  type: 'text' | 'video' | 'pdf' | 'file';
  content?: string;
  videoUrl?: string;
  fileUrl?: string;
  attachments?: { name: string; url: string }[];
  durationMin?: number;
  preview?: boolean;
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
