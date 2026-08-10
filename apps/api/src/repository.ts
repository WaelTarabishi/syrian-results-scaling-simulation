import type { StudentResult } from "@edge-results/shared";
import type { Pool } from "pg";

export interface ResultRepository {
  findByNormalizedStudentId(normalizedStudentId: string): Promise<StudentResult | null>;
}

interface StudentResultRow {
  student_id: string;
  student_name: string;
  father_name: string;
  academic_year: string;
  score: string;
  grade: string;
  status: "pass" | "fail";
}

export class PostgresResultRepository implements ResultRepository {
  public constructor(private readonly pool: Pool) {}

  public async findByNormalizedStudentId(normalizedStudentId: string): Promise<StudentResult | null> {
    const query = await this.pool.query<StudentResultRow>(
      `select student_id, student_name, father_name, academic_year, score, grade, status
       from student_results
       where student_id_normalized = $1`,
      [normalizedStudentId]
    );

    const row = query.rows[0];
    if (!row) {
      return null;
    }

    return {
      studentId: row.student_id,
      studentName: row.student_name,
      fatherName: row.father_name,
      academicYear: row.academic_year,
      score: Number(row.score),
      grade: row.grade,
      status: row.status
    };
  }
}
