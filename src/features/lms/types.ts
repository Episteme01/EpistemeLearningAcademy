export type { Course, CourseEnrollment, LiveClass, Student, WithId } from '@/types/models';
export interface Assignment_ { title: string; instructions: string; courseId?: string; classId?: string; dueAt: unknown; maxScore: number; allowText?: boolean; allowFile?: boolean; teacherUid: string }
